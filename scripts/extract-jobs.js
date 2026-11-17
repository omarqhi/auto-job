#!/usr/bin/env node
// Turns loose leads into structured jobs: Google results and LinkedIn "hiring" posts (from the Apify run),
// Google Alerts RSS feeds, and job-alert emails from Gmail.
//
//   node scripts/extract-jobs.js <found.json> [alertEmails.json] <out.json>
//
// 1. collect candidates (url + title + snippet/text), skipping LinkedIn/Indeed job pages (Apify already covers them)
// 2. drop anything already in the job library (by URL)
// 3. open each page to read the full posting (posts already carry their text)
// 4. Claude Haiku extracts title/company/location/pay/email in batches and discards non-job pages
// 5. apply the same pay/seniority rules as the main filter (scripts/rules.js)
// Prints one JSON summary line; writes { jobs: [...] } to <out.json> for scripts/jobsdb.js import.
// Test hooks: EXTRACT_NO_FETCH=1 (no network), EXTRACT_FAKE=<file> (canned Claude answers instead of calling Claude).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { makeRules } = require('./rules');

const ROOT = path.resolve(__dirname, '..');
process.env.PONYTAIL_DEFAULT_MODE = 'off';   // ponytail plugin is for coding sessions, not job extraction
const config = () => JSON.parse(fs.readFileSync(process.env.AUTOJOB_CONFIG || path.join(ROOT, 'config.json'), 'utf8'));
const BATCH = 6;

// ------------------------------------------------------------------ helpers
const decode = s => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
// Strip tags twice: feeds often carry escaped markup (&lt;b&gt;), which only becomes a tag once decoded.
const removeTags = s => s
  .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, '\n')
  .replace(/<[^>]+>/g, ' ');
const stripTags = html => removeTags(decode(removeTags(String(html || ''))))
  .replace(/[ \t\r]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n\s*\n+/g, '\n').trim();

// Unwrap redirect links (Google Alerts, Outlook safelinks, email click-trackers that carry the real URL).
function unwrapUrl(u) {
  try {
    const url = new URL(decode(u));
    for (const k of ['url', 'q', 'u', 'redirect', 'target', 'dest']) {
      const v = url.searchParams.get(k);
      if (v && /^https?:\/\//i.test(v)) return unwrapUrl(v);
    }
    for (const k of [...url.searchParams.keys()]) if (/^(utm_|ref|trk|tracking|src$|fbclid|gclid)/i.test(k)) url.searchParams.delete(k);
    url.hash = '';
    return url.toString();
  } catch { return null; }
}
// Apify already scrapes these boards daily, so their links are skipped here.
const coveredByApify = u => /linkedin\.com\/(jobs|comm\/jobs)/i.test(u) || /(^|\/\/|\.)indeed\.com/i.test(u);
const SKIP_HOST = /(google\.[a-z.]+\/(search|preferences)|accounts\.google|unsubscribe|facebook\.com|twitter\.com|x\.com|instagram\.com|youtube\.com|play\.google|apps\.apple)/i;

// Google Alerts feeds are Atom: <entry><title>..</title><link href="https://www.google.com/url?...&url=REAL"/><content>..</content>
function parseRss(xml, kind = 'alert') {
  const out = [];
  for (const m of String(xml).matchAll(/<(entry|item)\b[\s\S]*?<\/\1>/gi)) {
    const e = m[0];
    const href = (e.match(/<link[^>]*href="([^"]+)"/i) || e.match(/<link>([\s\S]*?)<\/link>/i) || [])[1];
    const url = href && unwrapUrl(href);
    if (!url) continue;
    out.push({ kind, url, title: stripTags((e.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]),
      snippet: stripTags((e.match(/<(content|description|summary)[^>]*>([\s\S]*?)<\/\1>/i) || [])[2]).slice(0, 600) });
  }
  return out;
}

// Job-alert emails: keep links whose text or URL looks like a job posting.
const JOBISH = /\b(job|jobs|career|careers|vacanc|opening|hiring|position|apply|manager|hr|human resource|head|lead|officer|executive|partner)\b/i;
function linksFromEmail(msg) {
  const html = msg.html || msg.textAsHtml || '';
  const out = [], seen = new Set();
  for (const m of html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = unwrapUrl(m[1]);
    const label = stripTags(m[2]).replace(/\s+/g, ' ').trim();
    if (!url || seen.has(url) || SKIP_HOST.test(url) || label.length < 4 || label.length > 140) continue;
    if (!JOBISH.test(label) && !/\/(job|jobs|career|careers|vacanc|opening)/i.test(url)) continue;
    seen.add(url);
    out.push({ kind: 'email', url, title: label, snippet: `From job alert: ${msg.subject || ''}`.slice(0, 300) });
    if (out.length >= 15) break;
  }
  return out;
}

async function fetchText(url) {
  if (process.env.EXTRACT_NO_FETCH === '1') return '';
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(12000),
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', 'Accept-Language': 'en' } });
    if (!r.ok || !/text|html|xml|json/i.test(r.headers.get('content-type') || 'text/html')) return '';
    return stripTags((await r.text()).slice(0, 400000)).slice(0, 7000);
  } catch { return ''; }
}

function extractWithClaude(batch) {
  if (process.env.EXTRACT_FAKE) {
    const canned = JSON.parse(fs.readFileSync(process.env.EXTRACT_FAKE, 'utf8'));
    return batch.map((c, i) => ({ i, ...(canned[c.url] || { isJobPosting: false }) }));
  }
  const listing = batch.map((c, i) => `### ${i}\nURL: ${c.url}\nTitle: ${c.title}\n${c.author ? 'Posted by: ' + c.author + '\n' : ''}Text:\n${(c.text || c.snippet || '').slice(0, 5000)}`).join('\n\n');
  const prompt =
    `Below are ${batch.length} web pages or LinkedIn posts that might be job openings. For each, decide if it is a CURRENT job ` +
    `opening (an employer hiring for a specific role) - not news, a list of many jobs, a CV, an article or someone looking for work.\n\n${listing}\n\n` +
    `Answer with ONLY a JSON array, one object per item, no code fences: ` +
    `{"i": number, "isJobPosting": boolean, "title": string, "company": string, "location": string (city/country as written, "Remote" if remote), ` +
    `"remote": boolean, "remoteFrom": string (remote jobs only: where the candidate may live or must be authorised to work, ` +
    `e.g. "Anywhere", "USA only", "EU", "Asia", "Pakistan"; "" if the text does not say), "salaryText": string ("" if none), "email": string (application email if given, else ""), ` +
    `"applyUrl": string (best link to apply, else ""), "description": string (the role's duties and requirements, max 1200 chars)}. ` +
    `Use only what the text says; leave a field "" when it is not stated.`;
  const r = spawnSync('claude', ['-p', '--model', 'haiku'], { input: prompt, encoding: 'utf8', shell: true, timeout: 5 * 60 * 1000, cwd: ROOT, maxBuffer: 10 * 1024 * 1024 });
  const m = String(r.stdout || '').match(/\[[\s\S]*\]/);
  if (r.status !== 0 || !m) throw new Error('Claude extraction failed: ' + String(r.stderr || r.stdout || '').slice(-300));
  return JSON.parse(m[0]);
}

function seenUrls() {
  try {
    const { DatabaseSync } = require('node:sqlite');
    const file = process.env.JOBS_DB || path.join(ROOT, 'data', 'jobs.db');
    if (!fs.existsSync(file)) return new Set();
    const db = new DatabaseSync(file, { readOnly: true });
    const s = new Set(db.prepare('SELECT url, apply_url FROM jobs').all().flatMap(r => [r.url, r.apply_url]).filter(Boolean));
    db.close();
    return s;
  } catch { return new Set(); }
}

// ------------------------------------------------------------------ main
async function main(foundFile, emailsFile, outFile) {
  const cfg = config();
  const src = cfg.sources || {};
  const rules = makeRules(cfg.filters);
  const stats = { candidates: 0, alreadyKnown: 0, coveredByApify: 0, fetched: 0, notJobs: 0, jobs: 0, errors: [] };

  // 1. candidates
  let cands = [];
  const found = fs.existsSync(foundFile) ? JSON.parse(fs.readFileSync(foundFile, 'utf8')) : [];
  cands.push(...(Array.isArray(found) ? found : []).filter(j => j && j._candidate));
  if (emailsFile && fs.existsSync(emailsFile)) {
    const emails = JSON.parse(fs.readFileSync(emailsFile, 'utf8'));
    for (const msg of Array.isArray(emails) ? emails : [emails]) if (msg && (msg.html || msg.textAsHtml)) cands.push(...linksFromEmail(msg));
  }
  for (const feed of src.alertsRss || []) {
    if (process.env.EXTRACT_NO_FETCH === '1') break;
    try { const r = await fetch(feed, { signal: AbortSignal.timeout(15000) }); cands.push(...parseRss(await r.text())); }
    catch (e) { stats.errors.push('RSS ' + feed.slice(0, 60) + ': ' + e.message); }
  }

  // 2. de-duplicate and drop what's known or covered elsewhere
  const known = seenUrls(), seen = new Set(), keep = [];
  for (const c of cands) {
    if (!c.url) continue;
    const u = unwrapUrl(c.url) || c.url;
    if (seen.has(u)) continue; seen.add(u);
    stats.candidates++;
    if (coveredByApify(u)) { stats.coveredByApify++; continue; }
    if (known.has(u)) { stats.alreadyKnown++; continue; }
    keep.push({ ...c, url: u });
  }
  const todo = keep.slice(0, src.maxExtractPerRun || 30);

  // 3. read the full page (posts already have their text)
  for (const c of todo) {
    if (c.kind === 'post' && c.text) continue;
    const t = await fetchText(c.url);
    if (t) { c.text = t; stats.fetched++; }
  }

  // 4. extract with Claude Haiku, 5. apply the rules
  const jobs = [];
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    let answers = [];
    try { answers = extractWithClaude(batch); } catch (e) { stats.errors.push(e.message); continue; }
    for (const a of answers) {
      const c = batch[a.i];
      if (!c) continue;
      if (!a.isJobPosting || !a.title) { stats.notJobs++; continue; }
      const sal = rules.parseSalaryText(a.salaryText);
      let location = a.location || '';
      if (a.remote && !/remote/i.test(location)) location = location ? `${location} (Remote)` : 'Remote';
      if (a.remote && a.remoteFrom) location += ` (open to: ${a.remoteFrom})`;   // read by the remote country rule in jobsdb.js
      const j = rules.apply({
        source: c.kind, jobId: crypto.createHash('sha1').update(c.url).digest('hex').slice(0, 16),
        title: a.title, company: a.company || '', location, url: c.url, applyUrl: a.applyUrl || c.url,
        description: a.description || c.snippet || '', salaryRaw: a.salaryText || '',
        salaryMin: sal?.min ?? null, salaryMax: sal?.max ?? null, level: '', contactEmail: a.email || '',
      });
      jobs.push(j);
    }
  }
  stats.jobs = jobs.length;
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(jobs));
  return { ok: true, ...stats };
}

module.exports = { parseRss, linksFromEmail, unwrapUrl, stripTags, coveredByApify };

if (require.main === module) {
  const a = process.argv.slice(2);
  const [foundFile, emailsFile, outFile] = a.length >= 3 ? a : [a[0], null, a[1]];
  main(foundFile, emailsFile, outFile)
    .then(s => process.stdout.write(JSON.stringify(s) + '\n'))
    .catch(e => { if (outFile) fs.writeFileSync(outFile, '[]'); process.stdout.write(JSON.stringify({ ok: false, error: e.message }) + '\n'); });
}
