#!/usr/bin/env node
// Job library: every job ever found, its match score and what happened to it. SQLite (built into Node).
//
//   node scripts/jobsdb.js import <found.json> [extra.json...]   add a run's jobs (dedups, scores, marks Pending/Skipped)
//   node scripts/jobsdb.js pick                     choose today's jobs (best first, within the daily cap), mark Processing
//   node scripts/jobsdb.js mark <file|b64:...>      {key, status, resumeType?, ...} after applying / replies
//   node scripts/jobsdb.js stats                    counts for the dashboard and daily report
//
// Statuses: Pending, Skipped, Processing, Review (rewritten resume waiting for your OK), Emailed, Apply manually,
//           Applied by hand (you submitted an Apply manually job yourself), Failed, Reply received
// Env: JOBS_DB (path override, used by tests)

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { scoreJob } = require('./score');

const ROOT = path.resolve(__dirname, '..');
const config = () => JSON.parse(fs.readFileSync(process.env.AUTOJOB_CONFIG || path.join(ROOT, 'config.json'), 'utf8'));   // AUTOJOB_CONFIG: tests
const DB_FILE = process.env.JOBS_DB || path.join(ROOT, 'data', 'jobs.db');
const APPLIED = ['Emailed', 'Apply manually', 'Applied by hand', 'Reply received'];
const TZ = 'Asia/Karachi';
const todayPkt = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const now = () => new Date().toISOString();
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const fuzzyKey = (company, title) => 'ct|' + norm(company) + '|' + norm(title);
const safeKey = key => String(key).replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 80);
// Job links come from scraped pages and postings: keep only http(s), never javascript: or data: links.
const webUrl = u => /^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '';

function open() {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  const db = new DatabaseSync(DB_FILE);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS jobs (
      key TEXT PRIMARY KEY, fuzzy TEXT, source TEXT, job_id TEXT,
      title TEXT, company TEXT, location TEXT, url TEXT, apply_url TEXT, description TEXT,
      salary_raw TEXT, salary_max INTEGER, level TEXT, seniority TEXT, contact_email TEXT,
      passed INTEGER, reason TEXT, score INTEGER, score_detail TEXT,
      status TEXT, resume_type TEXT, attempts INTEGER DEFAULT 0, notes TEXT,
      found_at TEXT, last_seen_at TEXT, seen_count INTEGER DEFAULT 1,
      applied_at TEXT, applied_day TEXT, updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS jobs_fuzzy ON jobs(fuzzy);
    CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status);
    CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
  `);
  // folder: where a job you added yourself has its rewritten resume waiting for your OK (status Review)
  if (!db.prepare('PRAGMA table_info(jobs)').all().some(c => c.name === 'folder')) db.exec('ALTER TABLE jobs ADD COLUMN folder TEXT');
  return db;
}

// One-time: bring applications made before the library existed into it, so they are never applied to again.
async function migrateTracker(db) {
  if (db.prepare("SELECT v FROM meta WHERE k = 'tracker_migrated'").get()) return;
  const trackerFile = process.env.TRACKER_FILE || path.resolve(ROOT, config().paths.tracker);
  if (fs.existsSync(trackerFile)) {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(trackerFile);
    const ws = wb.getWorksheet('Applications');
    const headers = ws ? ws.getRow(1).values.slice(1) : [];
    const ins = db.prepare(`INSERT OR IGNORE INTO jobs (key, fuzzy, source, job_id, title, company, location, url, salary_raw, salary_max,
      contact_email, passed, status, resume_type, found_at, last_seen_at, applied_at, applied_day, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,'tailored',?,?,?,?,?)`);
    ws?.eachRow((row, n) => {
      if (n === 1) return;
      const r = {}; headers.forEach((h, i) => { let v = row.getCell(i + 1).value; if (v && typeof v === 'object' && 'text' in v) v = v.text; r[h] = v ?? ''; });
      if (!r['Dedup Key']) return;
      const day = r['Applied On'] instanceof Date ? r['Applied On'].toISOString().slice(0, 10) : String(r['Applied On'] || '');
      ins.run(r['Dedup Key'], fuzzyKey(r.Company, r.Title), r.Source, String(r['Job ID'] || ''), r.Title, r.Company, r.Location,
        r['Job URL'], r['Salary (listed)'], Number(r['Salary PKR/mo']) || null, r['Contact Email'], r.Status || 'Emailed',
        now(), now(), day ? day + 'T00:00:00.000Z' : null, day || null, now());
    });
  }
  db.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('tracker_migrated', ?)").run(now());
}

function scorer() {
  const cfg = config();
  const resumePath = path.resolve(ROOT, cfg.candidate.masterResume);
  const resume = fs.existsSync(resumePath) ? fs.readFileSync(resumePath, 'utf8') : '';
  const opts = { titles: cfg.search.keywords, city: cfg.candidate.city || '' };
  return job => scoreJob(job, resume, opts);
}

// Location rule: one of the allowed cities, or a remote job. Remote counts when the location or title says so,
// or the description states it plainly ("fully remote", "work from home"...) - not a passing "remote teams".
const REMOTE_STRONG = /\b(remote|work from home|wfh|anywhere)\b/i;
const REMOTE_IN_TEXT = /\b(fully remote|100% remote|remote (position|role|job|opportunity|work|basis)|work(ing)? from home|work remotely|remote-first|remote only)\b/i;
// A remote job counts only if someone living in Pakistan can take it. The location may say where (e.g. "Remote (open to: USA only)",
// "New York, NY (Remote)"): open worldwide, to Pakistan or to its region is fine; tied to another country is skipped. Not stated: kept.
const REMOTE_OK_FOR_PK = /\b(anywhere|worldwide|global(ly)?|international|pakistan|asia|apac|emea|south asia|middle east|all countries|any country|timezone|time zone|utc|gmt)\b/i;
const FOREIGN_ONLY = /\b(united states|usa|u\.s\.?|us[- ]only|us[- ]based|us|canada|united kingdom|uk|europe|european union|eu|germany|france|netherlands|spain|portugal|poland|ireland|australia|new zealand|india|philippines|latam|latin america|americas|mexico|brazil|south africa|nigeria|kenya|uae|dubai|saudi arabia|qatar|singapore|japan|china|[a-z ]+, (ny|ca|tx|fl|wa|ma|il))\b/i;
const remoteBlockedFor = loc => FOREIGN_ONLY.test(loc) && !REMOTE_OK_FOR_PK.test(loc);
function locationRule(cfg) {
  const cities = (cfg.filters?.allowedCities || []).map(c => String(c).toLowerCase()).filter(Boolean);
  const remoteOk = cfg.filters?.allowRemote !== false;
  if (!cities.length) return () => null;   // no city list = any location
  return j => {
    const loc = String(j.location || '').toLowerCase();
    if (cities.some(c => loc.includes(c))) return null;
    if (!loc && j.source === 'added') return null;   // a post you (or the LinkedIn feed check) added that names no city: not a reason to skip
    if (remoteOk && (REMOTE_STRONG.test(loc) || REMOTE_STRONG.test(j.title || '') || REMOTE_IN_TEXT.test(j.description || ''))) {
      return remoteBlockedFor(j.location || '') ? `Remote, but not open to Pakistan (${j.location})` : null;
    }
    const where = j.location ? ` (${j.location})` : '';
    return `Outside ${cfg.filters.allowedCities.join(' / ')}${where}${remoteOk ? ' and not remote' : ''}`;
  };
}

// Relevance gate on top of the pay/seniority filter: right location, enough match score, not restricted to another gender.
function relevance() {
  const cfg = config();
  const minScore = cfg.matching?.minScore ?? 0;
  const restricted = cfg.filters?.restrictedTitlePattern ? new RegExp(cfg.filters.restrictedTitlePattern, 'i') : null;
  const wrongPlace = locationRule(cfg);
  return (j, sc) => {
    if (!j.passed) return { passed: false, reason: j.reason || '' };
    const where = wrongPlace(j);
    if (where) return { passed: false, reason: where };
    if (restricted && restricted.test(j.title)) return { passed: false, reason: 'Restricted to female applicants' };
    if (sc.score < minScore) return { passed: false, reason: `Low match (${sc.score}/100, needs ${minScore})` };
    return { passed: true, reason: '' };
  };
}

async function importJobs(db, jobs) {
  await migrateTracker(db);
  const score = scorer();
  const isRelevant = relevance();
  const byKey = db.prepare('SELECT key FROM jobs WHERE key = ?');
  const byFuzzy = db.prepare('SELECT key FROM jobs WHERE fuzzy = ? LIMIT 1');
  const seen = db.prepare('UPDATE jobs SET last_seen_at = ?, seen_count = seen_count + 1 WHERE key = ?');
  const ins = db.prepare(`INSERT INTO jobs (key, fuzzy, source, job_id, title, company, location, url, apply_url, description,
    salary_raw, salary_max, level, seniority, contact_email, passed, reason, score, score_detail, status, found_at, last_seen_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const s = { found: 0, new: 0, duplicates: 0, passed: 0, skipped: 0 };
  db.exec('BEGIN');
  try {
    for (const j of jobs) {
      if (!j || j._candidate || !j.title || !j.source) continue;   // _candidate: unprocessed lead, handled by extract-jobs.js
      s.found++;
      const key = `${j.source}|${j.jobId}`, fz = fuzzyKey(j.company, j.title);
      const existing = byKey.get(key) || (norm(j.company) && byFuzzy.get(fz));   // no company: title alone is not a duplicate
      if (existing) { s.duplicates++; seen.run(now(), existing.key); continue; }
      const sc = score(j);
      const rel = isRelevant(j, sc);
      ins.run(key, fz, j.source, String(j.jobId), j.title, j.company || '', j.location || '', webUrl(j.url), webUrl(j.applyUrl) || webUrl(j.url),
        String(j.description || '').slice(0, 20000), j.salaryRaw || '', j.salaryMax ?? null, j.level || '', j.seniority || '',
        j.contactEmail || '', rel.passed ? 1 : 0, rel.reason, sc.score, JSON.stringify(sc), rel.passed ? 'Pending' : 'Skipped',
        now(), now(), now());
      s.new++; rel.passed ? s.passed++ : s.skipped++;
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  s.pendingTotal = db.prepare("SELECT COUNT(*) c FROM jobs WHERE status = 'Pending'").get().c;
  return s;
}

function pick(db) {
  const cfg = config();
  const today = todayPkt();
  const done = db.prepare(`SELECT COUNT(*) c FROM jobs WHERE applied_day = ? AND status IN (${APPLIED.map(() => '?').join(',')})`).get(today, ...APPLIED).c;
  // maxApplicationsPerDay 0 = no fixed limit: apply to every relevant job, up to the safety cap.
  const limit = Number(cfg.limits.maxApplicationsPerDay) > 0 ? Number(cfg.limits.maxApplicationsPerDay) : (cfg.limits.safetyCapPerDay || 40);
  const cap = Math.max(0, limit - done);
  if (!cap) return [];
  const minScore = cfg.matching?.minScore ?? 0;
  const staleProcessing = new Date(Date.now() - 6 * 3600e3).toISOString();
  const oldest = new Date(Date.now() - (cfg.limits.pendingDays || 14) * 86400e3).toISOString();
  const target = cfg.filters.targetMonthlyPkr;
  const rows = db.prepare(`
    SELECT * FROM jobs
    WHERE found_at >= ? AND score >= ?
      AND (status = 'Pending' OR (status = 'Failed' AND attempts < 2) OR (status = 'Processing' AND updated_at < ?))
    ORDER BY
      CASE WHEN salary_max >= ? THEN 3 WHEN salary_max IS NULL THEN 2 ELSE 1 END DESC,
      score DESC, (contact_email <> '') DESC, COALESCE(salary_max, 0) DESC, found_at DESC
    LIMIT ?`).all(oldest, minScore, staleProcessing, target, cap);
  const mark = db.prepare("UPDATE jobs SET status = 'Processing', attempts = attempts + 1, updated_at = ? WHERE key = ?");
  // Jobs that entered the pool before the restricted-title rule existed are caught here.
  const restricted = cfg.filters?.restrictedTitlePattern ? new RegExp(cfg.filters.restrictedTitlePattern, 'i') : null;
  // ...and the location rule, for jobs that were already pending when it was added or changed.
  const wrongPlace = locationRule(cfg);
  const skip = db.prepare("UPDATE jobs SET status = 'Skipped', passed = 0, reason = ?, updated_at = ? WHERE key = ?");
  const usable = rows.filter(r => {
    const why = restricted && restricted.test(r.title) ? 'Restricted to female applicants' : wrongPlace(r);
    if (why) { skip.run(why, now(), r.key); return false; }
    return true;
  });
  return usable.map(r => { mark.run(now(), r.key); return asJob(r); });
}

// A library row in the shape the apply loop expects (same as pick() returns).
function asJob(r) {
  const safe = safeKey(r.key);
  return {
    source: r.source, jobId: r.job_id, title: r.title, company: r.company, location: r.location, url: r.url, applyUrl: r.apply_url,
    description: r.description, salaryRaw: r.salary_raw, salaryMax: r.salary_max, level: r.level, seniority: r.seniority,
    contactEmail: r.contact_email, score: r.score, scoreDetail: JSON.parse(r.score_detail || '{}'),
    folder: r.folder || '', dedupKey: r.key, fileName: safe + '.json', jobFile: path.join(ROOT, 'applications', '_queue', safe + '.json').split(path.sep).join('/'),
  };
}

// ---- Apply to a job you picked in the dashboard (Skipped or Pending), with the resume you chose.
const MANUAL_QUEUE = process.env.MANUAL_QUEUE || path.join(ROOT, 'applications', '_queue', 'manual-apply.json');   // env: tests
function queueManual(db, key, mode) {
  // reviewed: send the resume + email you approved in the dashboard, exactly as they are
  if (!['master', 'tailor', 'reviewed'].includes(mode)) throw new Error('mode must be master, tailor or reviewed');
  const r = db.prepare('SELECT * FROM jobs WHERE key = ?').get(key);
  if (!r) throw new Error('Job not found in the library.');
  if (mode === 'reviewed' && (r.status !== 'Review' || !r.folder)) throw new Error('This job has no rewritten resume waiting for you.');
  if ([...APPLIED, 'Processing'].includes(r.status)) throw new Error(`This job is already ${r.status.toLowerCase()}.`);
  db.prepare("UPDATE jobs SET status = 'Processing', notes = ?, updated_at = ? WHERE key = ?").run(`Chosen by you (${{ master: 'master resume', tailor: 'hiring panel', reviewed: 'resume you approved' }[mode]})`, now(), key);
  const job = { ...asJob(r), tailorMode: mode, chosenByYou: true };
  fs.mkdirSync(path.dirname(MANUAL_QUEUE), { recursive: true });
  fs.writeFileSync(MANUAL_QUEUE, JSON.stringify([job]));
  return job;
}
// After a picked-job run ends: if the workflow never recorded the job, mark it Failed and drop the leftover queue.
function failIfProcessing(db, key) {
  fs.rmSync(MANUAL_QUEUE, { force: true });
  return Number(db.prepare("UPDATE jobs SET status = 'Failed', notes = 'Apply run ended before the job was recorded - try again', updated_at = ? WHERE key = ? AND status = 'Processing'")
    .run(now(), key).changes);
}
// Read and clear the queue (called by the "Apply to Selected Jobs" workflow).
function takeManual() {
  if (!fs.existsSync(MANUAL_QUEUE)) return [];
  const jobs = JSON.parse(fs.readFileSync(MANUAL_QUEUE, 'utf8'));
  fs.rmSync(MANUAL_QUEUE, { force: true });
  return jobs;
}

function mark(db, p) {
  if (!p.key) throw new Error('mark needs a key');
  const sets = ['updated_at = ?'], vals = [now()];
  if (p.status) { sets.push('status = ?'); vals.push(p.status); }
  if (p.resumeType) { sets.push('resume_type = ?'); vals.push(p.resumeType); }
  if (p.notes != null) { sets.push('notes = ?'); vals.push(String(p.notes).slice(0, 1000)); }
  if (p.folder) { sets.push('folder = ?'); vals.push(p.folder); }
  if (p.reason != null) { sets.push('reason = ?'); vals.push(String(p.reason).slice(0, 300)); }
  if (p.status && ['Emailed', 'Apply manually'].includes(p.status)) { sets.push('applied_at = ?', 'applied_day = ?'); vals.push(now(), todayPkt()); }
  vals.push(p.key);
  return { updated: Number(db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE key = ?`).run(...vals).changes) };
}

function stats(db) {
  const one = (sql, ...a) => db.prepare(sql).get(...a).c;
  const today = todayPkt();
  const weekAgo = new Date(Date.now() - 7 * 86400e3).toISOString();
  const inList = APPLIED.map(() => '?').join(',');
  const block = since => ({
    found: one('SELECT COUNT(*) c FROM jobs WHERE found_at >= ?', since) + one('SELECT COALESCE(SUM(seen_count - 1), 0) c FROM jobs WHERE last_seen_at >= ?', since),
    unique: one('SELECT COUNT(*) c FROM jobs WHERE found_at >= ?', since),
    matched: one('SELECT COUNT(*) c FROM jobs WHERE found_at >= ? AND passed = 1', since),
    skipped: one("SELECT COUNT(*) c FROM jobs WHERE found_at >= ? AND status = 'Skipped'", since),
    applied: one(`SELECT COUNT(*) c FROM jobs WHERE applied_at >= ? AND status IN (${inList})`, since, ...APPLIED),
    emailed: one("SELECT COUNT(*) c FROM jobs WHERE applied_at >= ? AND status IN ('Emailed', 'Reply received')", since),
    manual: one("SELECT COUNT(*) c FROM jobs WHERE applied_at >= ? AND status = 'Apply manually'", since),
    byHand: one("SELECT COUNT(*) c FROM jobs WHERE applied_at >= ? AND status = 'Applied by hand'", since),
    tailored: one(`SELECT COUNT(*) c FROM jobs WHERE applied_at >= ? AND status IN (${inList}) AND resume_type = 'tailored'`, since, ...APPLIED),
    asIs: one(`SELECT COUNT(*) c FROM jobs WHERE applied_at >= ? AND status IN (${inList}) AND resume_type = 'master'`, since, ...APPLIED),
    replies: one("SELECT COUNT(*) c FROM jobs WHERE status = 'Reply received' AND updated_at >= ?", since),
  });
  return {
    all: block('0000'), week: block(weekAgo),
    today: { applied: one(`SELECT COUNT(*) c FROM jobs WHERE applied_day = ? AND status IN (${inList})`, today, ...APPLIED) },
    // applications per day for the last 14 days (Pakistan dates, oldest first), for the dashboard chart
    daily: Array.from({ length: 14 }, (_, i) => {
      const day = new Date(Date.now() - (13 - i) * 86400e3).toLocaleDateString('en-CA', { timeZone: TZ });
      return { day, applied: one(`SELECT COUNT(*) c FROM jobs WHERE applied_day = ? AND status IN (${inList})`, day, ...APPLIED) };
    }),
    pending: one("SELECT COUNT(*) c FROM jobs WHERE status = 'Pending'"),
    processing: one("SELECT COUNT(*) c FROM jobs WHERE status = 'Processing'"),
    failed: one("SELECT COUNT(*) c FROM jobs WHERE status = 'Failed'"),
    pendingStrong: one("SELECT COUNT(*) c FROM jobs WHERE status = 'Pending' AND score >= ?", config().matching?.sendAsIsAt ?? 80),
  };
}

function list(db, { status, q, limit = 300 } = {}) {
  const where = [], vals = [];
  if (status === 'Applied') { where.push(`status IN (${APPLIED.map(() => '?').join(',')})`); vals.push(...APPLIED); }
  else if (status === 'Matched') where.push("status <> 'Skipped'");   // the library's default view: everything that passed your rules
  else if (status) { where.push('status = ?'); vals.push(status); }
  if (q) { where.push('(title LIKE ? OR company LIKE ? OR location LIKE ?)'); vals.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const rows = db.prepare(`SELECT key, source, title, company, location, apply_url, salary_raw, salary_max, contact_email, passed, reason,
      score, score_detail, status, resume_type, found_at, seen_count, applied_at FROM jobs
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY found_at DESC, score DESC LIMIT ?`).all(...vals, Number(limit));
  return rows.map(r => ({ ...r, score_detail: JSON.parse(r.score_detail || 'null') }));
}

module.exports = { open, importJobs, pick, mark, stats, list, migrateTracker, queueManual, takeManual, failIfProcessing, fuzzyKey, asJob, locationRule, DB_FILE };

if (require.main === module) {
  (async () => {
    const [cmd, arg, ...more] = process.argv.slice(2);
    const readArg = () => JSON.parse(arg.startsWith('b64:') ? Buffer.from(arg.slice(4), 'base64').toString('utf8') : fs.readFileSync(arg, 'utf8'));
    const db = open();
    let out;
    if (cmd === 'import') {
      // import <file> [more files...] - e.g. the scraped jobs plus the jobs extracted from Google/posts/alerts
      const all = [];
      for (const f of [arg, ...more]) {
        if (f !== arg && !fs.existsSync(f)) continue;
        const d = f === arg ? readArg() : JSON.parse(fs.readFileSync(f, 'utf8'));
        all.push(...(Array.isArray(d) ? d : [d]));
      }
      out = await importJobs(db, all);
    }
    else if (cmd === 'pick') { await migrateTracker(db); out = pick(db); }
    else if (cmd === 'mark') out = mark(db, readArg());
    else if (cmd === 'take-manual') out = takeManual();
    else if (cmd === 'stats') { await migrateTracker(db); out = stats(db); }
    else { console.error('usage: jobsdb.js import|pick|mark|stats'); process.exit(2); }
    process.stdout.write(JSON.stringify(out) + '\n');
  })().catch(e => { process.stdout.write(JSON.stringify({ ok: false, error: e.message }) + '\n'); process.exit(1); });
}
