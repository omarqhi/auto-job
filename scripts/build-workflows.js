#!/usr/bin/env node
// Generates the two n8n workflows into ./n8n/ from readable source.
//   node scripts/build-workflows.js
// Then: n8n import:workflow --input=n8n/1-daily-apply.json  (and 2-reply-watcher.json)

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..').split(path.sep).join('/');   // forward slashes work for node + cmd
const NODE = 'node';
const TZ = 'Asia/Karachi';

let idn = 0;
const id = () => `node-${++idn}`;
function node(name, type, typeVersion, position, parameters, extra = {}) {
  return { id: id(), name, type, typeVersion, position, parameters, ...extra };
}
function connect(conns, from, to, outIndex = 0) {
  conns[from] = conns[from] || { main: [] };
  while (conns[from].main.length <= outIndex) conns[from].main.push([]);
  conns[from].main[outIndex].push({ node: to, type: 'main', index: 0 });
}
const exec = (name, command, pos, extra = {}) =>
  node(name, 'n8n-nodes-base.executeCommand', 1, pos, { command }, extra);
const code = (name, jsCode, pos, mode = 'runOnceForAllItems', extra = {}) =>
  node(name, 'n8n-nodes-base.code', 2, pos, mode === 'runOnceForAllItems' ? { jsCode } : { mode, jsCode }, extra);

// Credential IDs come from n8n/credential-ids.json (written by scripts/setup-credentials.ps1).
const credFile = path.join(ROOT, 'n8n', 'credential-ids.json');
const creds = fs.existsSync(credFile) ? JSON.parse(fs.readFileSync(credFile, 'utf8')) : [];
const cred = (type, name) => ({ [type]: { id: (creds.find(c => c.type === type && c.name === name) || {}).id || 'REPLACE', name } });
const CRED_APIFY = cred('httpHeaderAuth', 'Apify API');
const CRED_GMAIL = cred('gmailOAuth2', 'Gmail account');
const CRED_GCAL = cred('googleCalendarOAuth2Api', 'Google Calendar account');

const READ_CONFIG = `${NODE} -e "process.stdout.write(require('fs').readFileSync('${ROOT}/config.json','utf8'))"`;
const TRACKER_LIST = `${NODE} "${ROOT}/scripts/tracker.js" list`;

// Shared helper: base64 that works in n8n Code nodes
const B64 = `const b64 = s => (typeof Buffer !== 'undefined') ? Buffer.from(s, 'utf8').toString('base64') : btoa(unescape(encodeURIComponent(s)));`;

/* =========================================================================
   WORKFLOW 1 — Daily: scrape -> filter -> dedup -> tailor -> email -> track
   ========================================================================= */
function dailyWorkflow() {
  const nodes = [], c = {};
  const add = n => (nodes.push(n), n.name);

  const trigger = add(node('Every Day 9:00 PKT', 'n8n-nodes-base.scheduleTrigger', 1.2, [0, 300],
    { rule: { interval: [{ field: 'cronExpression', expression: '0 9 * * *' }] } }));

  // `n8n execute` (the dashboard's Apply now / run-now.ps1) can only start from a manual trigger, not the schedule.
  const manual = add(node('Run Now (dashboard)', 'n8n-nodes-base.manualTrigger', 1, [0, 480], {}));

  const readCfg = add(exec('Read Config', READ_CONFIG, [220, 300]));
  const loadCfg = add(code('Load Config', `return [{ json: JSON.parse($input.first().json.stdout) }];`, [440, 300]));

  const usage = add(node('Apify Monthly Usage', 'n8n-nodes-base.httpRequest', 4.2, [660, 300], {
    url: 'https://api.apify.com/v2/users/me/usage/monthly',
    authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth', options: {},
  }, { credentials: CRED_APIFY }));

  const plan = add(code('Budget Guard + Plan Scrapes', `
const cfg = $('Load Config').first().json;
const used = Number($input.first().json?.data?.totalUsageCreditsUsdAfterVolumeDiscount ?? 0);
if (used >= cfg.limits.apifyStopAtUsd) {
  // Budget reached for this month: skip scraping, but still apply to jobs waiting in the pending pool.
  return [{ json: { skip: true, apifyUsedUsd: used } }];
}
const s = cfg.search;
const kws = s.keywords.filter(k => k && !/^FILL/i.test(k));
if (!kws.length) throw new Error('config.json search.keywords is empty - add job titles first');
const per = total => Math.max(5, Math.floor(total / kws.length));
const runs = [];
for (const k of kws) {
  runs.push({ source: 'linkedin', actor: 'valig~linkedin-jobs-scraper', maxUsd: 0.05,
    input: { keywords: k, location: s.linkedinLocation, datePosted: 'r86400', limit: per(s.linkedinPerRun) } });
  runs.push({ source: 'indeed', actor: 'valig~indeed-jobs-scraper', maxUsd: 0.02,
    input: { country: s.indeedCountry, title: k, location: s.indeedLocation || undefined, limit: per(s.indeedPerRun), datePosted: '1' } });
}
// Extra sources (results are turned into jobs later by scripts/extract-jobs.js).
const src = cfg.sources || {};
const g = src.googleSearch || {};
if (g.enabled && (g.queries || []).length) {
  // Every Boolean query runs daily, plus one of rotateQueries (taking turns day by day) so no single site crowds out the rest.
  const day = Math.floor(Date.now() / 86400000), rot = g.rotateQueries || [];
  const picked = [...g.queries, ...(rot.length ? [rot[day % rot.length]] : [])];
  runs.push({ source: 'google', actor: 'apify~google-search-scraper', maxUsd: 0.03,
    input: { queries: picked.join('\\n'), maxPagesPerQuery: 1, countryCode: 'pk', languageCode: 'en', quickDateRange: g.dateRange || 'd3', saveHtmlToKeyValueStore: false } });
}
const p = src.linkedinPosts || {};
if (p.enabled && (p.queries || []).length) {
  runs.push({ source: 'posts', actor: 'harvestapi~linkedin-post-search', maxUsd: 0.06,
    input: { searchQueries: p.queries, maxPosts: p.maxPostsPerQuery || 8, postedLimit: '24h', sortBy: 'date' } });
}
return runs.map(r => ({ json: { ...r, apifyUsedUsd: used } }));
`, [880, 300]));

  const scrape = add(node('Run Apify Scraper', 'n8n-nodes-base.httpRequest', 4.2, [1100, 300], {
    method: 'POST',
    url: '=https://api.apify.com/v2/acts/{{ $json.actor }}/run-sync-get-dataset-items?timeout=280&clean=true&maxTotalChargeUsd={{ $json.maxUsd }}',
    authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
    sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.input) }}',
    options: { timeout: 300000 },
  }, { credentials: CRED_APIFY, onError: 'continueRegularOutput' }));

  const normalize = add(code('Normalize + Pay/Seniority Filter', `
const cfg = $('Load Config').first().json;
const f = cfg.filters;
const senior = new RegExp(f.seniorTitlePattern, 'i');
const exclude = new RegExp(f.excludeTitlePattern, 'i');
const PER_MONTH = { HOUR: 173, DAY: 22, WEEK: 4.33, MONTH: 1, YEAR: 1 / 12 };
const FX = { PKR: 1, USD: f.usdToPkr, EUR: f.usdToPkr * 1.08, GBP: f.usdToPkr * 1.27, AED: f.usdToPkr / 3.67, SAR: f.usdToPkr / 3.75 };

const monthly = (amt, unit, cur) => amt == null ? null : Math.round(amt * (PER_MONTH[unit] ?? 1) * (FX[cur] ?? 1));

function parseSalaryText(s) {
  if (!s) return null;
  const cur = /PKR|Rs\\.?|\\u20A8/i.test(s) ? 'PKR' : /USD|\\$/.test(s) ? 'USD' : /EUR|\\u20AC/.test(s) ? 'EUR'
            : /GBP|\\u00A3/.test(s) ? 'GBP' : /AED/i.test(s) ? 'AED' : /SAR/i.test(s) ? 'SAR' : 'PKR';
  const unit = /(\\bhr\\b|hour)/i.test(s) ? 'HOUR' : /\\bday/i.test(s) ? 'DAY' : /(\\bwk\\b|week)/i.test(s) ? 'WEEK'
             : /(\\byr\\b|year|annum|annual|\\bpa\\b)/i.test(s) ? 'YEAR' : 'MONTH';
  const nums = [...s.matchAll(/(\\d[\\d,]*(?:\\.\\d+)?)\\s*([kKmM])?(?![a-zA-Z])/g)].map(m => {
    let n = parseFloat(m[1].replace(/,/g, ''));
    if (/k/i.test(m[2] || '')) n *= 1e3; if (/m/i.test(m[2] || '')) n *= 1e6;
    return n;
  }).filter(n => n >= 10);
  if (!nums.length) return null;
  return { min: monthly(Math.min(...nums), unit, cur), max: monthly(Math.max(...nums), unit, cur) };
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/gi;
const BAD_EMAIL = /(no-?reply|donotreply|example\\.|@linkedin\\.|@indeed\\.|@google\\.|sentry|\\.(png|jpe?g|gif|svg)$)/i;
const findEmail = text => ((text || '').match(EMAIL_RE) || []).map(e => e.replace(/\\.$/, '')).find(e => !BAD_EMAIL.test(e)) || '';

function normalize(j) {
  if (!j || j.error || !j.title) return null;
  if ('recruiterName' in j || 'companyName' in j) {               // LinkedIn (valig)
    const sal = parseSalaryText(j.salary);
    return { source: 'linkedin', jobId: String(j.id), title: j.title, company: j.companyName, location: j.location,
      url: j.url, applyUrl: j.applyUrl || j.url, description: j.description || '', salaryRaw: j.salary || '',
      salaryMin: sal?.min ?? null, salaryMax: sal?.max ?? null, level: j.experienceLevel || '' };
  }
  if (j.key && j.employer) {                                       // Indeed (valig)
    const b = j.baseSalary || {};
    const cur = b.currencyCode || 'PKR', unit = b.unitOfWork || 'MONTH';
    const raw = b.min || b.max ? \`\${cur} \${b.min ?? ''}-\${b.max ?? ''} / \${unit}\` : '';
    return { source: 'indeed', jobId: String(j.key), title: j.title, company: j.employer?.name || '',
      location: [j.location?.city, j.location?.countryName].filter(Boolean).join(', '),
      url: j.url, applyUrl: j.jobUrl || j.url, description: j.description?.text || '', salaryRaw: raw,
      salaryMin: monthly(b.min ?? b.max, unit, cur), salaryMax: monthly(b.max ?? b.min, unit, cur), level: '' };
  }
  return null;                                                     // unknown shape
}

// Every job is kept and labelled: passed=true goes to the pending pool, passed=false is recorded as Skipped with the reason.
const out = [];
for (const item of $input.all()) {
  const r = item.json || {};
  // Google results and LinkedIn posts are leads, not jobs yet: pass them on for scripts/extract-jobs.js.
  if (Array.isArray(r.organicResults)) {
    for (const o of r.organicResults) if (o && o.url) out.push({ _candidate: true, kind: 'google', url: o.url, title: o.title || '', snippet: o.description || '' });
    continue;
  }
  if (typeof r.content === 'string' && (r.author || r.linkedinUrl) && !('companyName' in r)) {
    const url = r.linkedinUrl || r.url || r.postUrl;
    if (url) out.push({ _candidate: true, kind: 'post', url, title: r.content.split('\\n')[0].slice(0, 120),
      text: r.content.slice(0, 6000), author: [r.author?.name, r.author?.info || r.author?.headline].filter(Boolean).join(', ') });
    continue;
  }
  const j = normalize(r);
  if (!j) continue;
  const isSenior = senior.test(j.title) || f.seniorLevels.includes(j.level);
  const hasPay = j.salaryMax != null;
  j.seniority = f.seniorLevels.includes(j.level) ? j.level : isSenior ? 'Senior (title)' : (j.level || '');
  j.contactEmail = findEmail(j.description);
  // Rule: listed pay (top of range) >= minimum, OR no pay listed but a senior role. Junior titles never pass.
  if (exclude.test(j.title)) { j.passed = false; j.reason = 'Junior or entry-level title'; }
  else if (hasPay && j.salaryMax < f.minMonthlyPkr) { j.passed = false; j.reason = \`Pay below minimum (Rs \${j.salaryMax.toLocaleString('en-PK')} a month)\`; }
  else if (!hasPay && !isSenior) { j.passed = false; j.reason = 'No pay listed and not a senior role'; }
  else { j.passed = true; j.reason = ''; }
  out.push(j);
}
// Downstream nodes need at least one item to run (the library still picks pending jobs from earlier days).
return out.length ? out.map(json => ({ json })) : [{ json: { _empty: true } }];
`, [1320, 300]));

  // Job library (data/jobs.db): records every job found, scores it, removes duplicates, keeps a pending pool.
  const FOUND_FILE = `${ROOT}/applications/_queue/found-{{ $execution.id }}.json`;
  const foundToFile = add(node('Found Jobs -> JSON File', 'n8n-nodes-base.convertToFile', 1.1, [1540, 300],
    { operation: 'toJson', mode: 'once', options: { fileName: 'found.json' } }));
  const saveFound = add(node('Save Found Jobs', 'n8n-nodes-base.readWriteFile', 1, [1760, 300],
    { operation: 'write', fileName: '=' + FOUND_FILE, options: {} }));
  // Job-alert emails (Rozee, Mustakbil, Glassdoor, Google Alerts...) from your Gmail, saved for extract-jobs.js.
  const ALERTS_FILE = `${ROOT}/applications/_queue/alerts-{{ $execution.id }}.json`;
  const EXTRA_FILE = `${ROOT}/applications/_queue/extra-{{ $execution.id }}.json`;
  const gmailAlerts = add(node('Read Job-Alert Emails', 'n8n-nodes-base.gmail', 2.1, [0, 0], {
    operation: 'getAll', returnAll: false, limit: 40, simple: false,
    filters: { q: "={{ $('Load Config').first().json.sources?.emailAlerts?.enabled === false ? 'label:none-autojob-disabled' : $('Load Config').first().json.sources?.emailAlerts?.gmailQuery }}" },
    options: {},
  }, { credentials: CRED_GMAIL, onError: 'continueRegularOutput', alwaysOutputData: true, executeOnce: true }));
  const alertsPick = add(code('Keep Email Bodies', `
return $input.all().filter(i => i.json && (i.json.html || i.json.textAsHtml))
  .map(i => ({ json: { subject: i.json.subject || '', html: String(i.json.html || i.json.textAsHtml).slice(0, 300000) } }));
`, [0, 0], 'runOnceForAllItems', { alwaysOutputData: true }));
  const alertsToFile = add(node('Alert Emails -> JSON File', 'n8n-nodes-base.convertToFile', 1.1, [0, 0],
    { operation: 'toJson', mode: 'once', options: { fileName: 'alerts.json' } }));
  const saveAlerts = add(node('Save Alert Emails', 'n8n-nodes-base.readWriteFile', 1, [0, 0],
    { operation: 'write', fileName: '=' + ALERTS_FILE, options: {} }));
  const extract = add(exec('Extract Jobs from Google, Posts & Alerts',
    `=${NODE} "${ROOT}/scripts/extract-jobs.js" "${FOUND_FILE}" "${ALERTS_FILE}" "${EXTRA_FILE}"`, [0, 0], { executeOnce: true }));
  const library = add(exec('Add to Job Library (score + dedup)', `=${NODE} "${ROOT}/scripts/jobsdb.js" import "${FOUND_FILE}" "${EXTRA_FILE}"`, [1980, 300], { executeOnce: true }));
  const pickNode = add(exec("Pick Today's Jobs", `${NODE} "${ROOT}/scripts/jobsdb.js" pick`, [2200, 300], { executeOnce: true }));

  const picks = add(code('Jobs To Apply', `
const out = JSON.parse(String($input.first().json.stdout || '[]').trim().split(/\\r?\\n/).pop() || '[]');
if (!Array.isArray(out)) throw new Error('jobsdb pick failed: ' + JSON.stringify(out));
return out.map(json => ({ json }));
`, [2420, 300]));

  const loop = add(node('Loop Jobs (one at a time)', 'n8n-nodes-base.splitInBatches', 3, [1980, 300], { options: {} }));

  const toFile = add(node('Job -> JSON File', 'n8n-nodes-base.convertToFile', 1.1, [2200, 460],
    { operation: 'toJson', mode: 'each', options: { fileName: '={{ $json.fileName }}' } }));
  const saveJob = add(node('Save Job File', 'n8n-nodes-base.readWriteFile', 1, [2420, 460],
    { operation: 'write', fileName: "={{ $('Loop Jobs (one at a time)').item.json.jobFile }}", options: {} }));
  const tailor = add(exec('Tailor Resume (/hiring-panel)',
    `=${NODE} "${ROOT}/scripts/tailor.js" "{{ $('Loop Jobs (one at a time)').item.json.jobFile }}"`, [2640, 460]));

  const parse = add(code('Parse Tailor Result', `
const lines = String($json.stdout || '').trim().split(/\\r?\\n/);
let r; try { r = JSON.parse(lines.pop()); } catch (e) { r = { ok: false, error: 'bad tailor output: ' + ($json.stderr || $json.stdout || '').slice(-300) }; }
return { json: { ...$('Loop Jobs (one at a time)').item.json, tailor: r } };
`, [2860, 460], 'runOnceForEachItem'));

  const okIf = add(node('Tailored OK?', 'n8n-nodes-base.if', 2, [3080, 460], {
    conditions: { options: { caseSensitive: true, typeValidation: 'loose' }, combinator: 'and',
      conditions: [{ id: 'c1', leftValue: '={{ $json.tailor.ok }}', rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }] },
    options: {},
  }));

  const emailIf = add(node('Has Contact Email?', 'n8n-nodes-base.if', 2, [3300, 380], {
    conditions: { options: { caseSensitive: true, typeValidation: 'loose' }, combinator: 'and',
      conditions: [{ id: 'c2', leftValue: '={{ $json.contactEmail }}', rightValue: '', operator: { type: 'string', operation: 'notEmpty', singleValue: true } }] },
    options: {},
  }));

  const readPdf = add(node('Read Resume PDF', 'n8n-nodes-base.readWriteFile', 1, [3520, 300],
    // glob: the resume and, when tailor.js wrote one, the cover letter next to it (<name>-cover-letter.pdf)
    { fileSelector: "={{ $json.tailor.pdfPath.replaceAll('\\\\', '/').replace(/-resume\\.pdf$/, '-{resume,cover-letter}.pdf') }}", options: {} }));
  // Two files arrive as two items; Gmail needs both on one item, or it would send two emails.
  const attach = add(code('Attach Files', `
const all = $input.all();
const isCover = i => /cover-letter\\.pdf$/i.test(i.binary?.data?.fileName || '');
const r = all.findIndex(i => !isCover(i)), cover = all.find(isCover);
if (r < 0) throw new Error('Resume PDF not found');
return [{ json: all[r].json, binary: { data: all[r].binary.data, ...(cover ? { cover: cover.binary.data } : {}) }, pairedItem: { item: r } }];
`, [3630, 300], 'runOnceForAllItems'));

  const send = add(node('Send Application (Gmail)', 'n8n-nodes-base.gmail', 2.1, [3740, 300], {
    sendTo: "={{ $('Parse Tailor Result').item.json.contactEmail }}",
    subject: "={{ $('Parse Tailor Result').item.json.tailor.emailSubject }}",
    emailType: 'text',
    message: "={{ $('Parse Tailor Result').item.json.tailor.emailBody }}",
    options: { appendAttribution: false, attachmentsUi: { attachmentsBinary: [{ property: "={{ $binary.cover ? 'data,cover' : 'data' }}" }] },
      senderName: "={{ $('Load Config').first().json.candidate.name }}" },
  }, { credentials: CRED_GMAIL, onError: 'continueRegularOutput' }));

  const rowFields = (status, extra) => `
${B64}
const j = $('Parse Tailor Result').item.json;
const row = {
  'Applied On': DateTime.now().setZone('${TZ}').toISODate(), 'Source': j.source, 'Job ID': j.jobId, 'Dedup Key': j.dedupKey,
  'Title': j.title, 'Company': j.company, 'Location': j.location, 'Salary (listed)': j.salaryRaw || 'Not listed',
  'Salary PKR/mo': j.salaryMax ?? '', 'Seniority': j.seniority, 'Job URL': j.applyUrl || j.url,
  'Contact Email': j.contactEmail, 'Resume PDF': j.tailor?.pdfPath || '',
  'Match Score': j.score ?? '', 'Resume Type': j.tailor?.resumeType === 'master' ? 'Master (as-is)' : j.tailor?.ok ? 'Tailored' : '', ${extra}
};
for (const k in row) if (typeof row[k] === 'string') row[k] = row[k].slice(0, 400);
const libraryUpdate = { key: j.dedupKey, status: row.Status, resumeType: j.tailor?.resumeType || null, notes: row.Notes || '' };
return { json: { row, b64: b64(JSON.stringify(row)), libB64: b64(JSON.stringify(libraryUpdate)) } };
`;
  const rowSent = add(code('Row: Emailed', rowFields('Emailed',
    `'Status': $json.threadId ? 'Emailed' : 'Failed', 'Gmail Thread ID': $json.threadId || '', 'Notes': $json.threadId ? '' : 'Gmail send failed: ' + JSON.stringify($json.error || $json).slice(0, 300)`),
    [3960, 300], 'runOnceForEachItem'));
  const rowManual = add(code('Row: Apply Manually', rowFields('Apply manually',
    `'Status': 'Apply manually', 'Notes': 'No email in listing - resume ready, apply via Job URL'`), [3520, 480], 'runOnceForEachItem'));
  const rowFail = add(code('Row: Tailor Failed', rowFields('Failed',
    `'Status': 'Failed', 'Notes': 'Tailoring failed: ' + String(j.tailor?.error || '').slice(0, 300)`), [3300, 620], 'runOnceForEachItem'));

  // Library first: it is what stops re-applying. If Excel has the tracker open, the email is still never sent twice.
  const append = add(exec('Record in Tracker + Library',
    `=${NODE} "${ROOT}/scripts/jobsdb.js" mark "b64:{{ $json.libB64 }}" && ${NODE} "${ROOT}/scripts/tracker.js" append "b64:{{ $json.b64 }}"`, [4180, 460],
    { onError: 'continueRegularOutput' }));

  const stats = add(exec('Library Stats', `${NODE} "${ROOT}/scripts/jobsdb.js" stats`, [2200, 140], { executeOnce: true }));

  const report = add(code('Build Daily Report', `
const lib = JSON.parse(String($('Library Stats').first().json.stdout || '{}').trim().split(/\\r?\\n/).pop() || '{}');
let found = {}; try { found = JSON.parse(String($('Add to Job Library (score + dedup)').first().json.stdout).trim().split(/\\r?\\n/).pop()); } catch (e) {}
const rows = [];
for (const n of ['Row: Emailed', 'Row: Apply Manually', 'Row: Tailor Failed']) {
  try { rows.push(...$(n).all().map(i => i.json.row)); } catch (e) { /* branch did not run */ }
}
const by = s => rows.filter(r => r.Status === s);
const line = r => \`- [\${r['Match Score']}/100, \${r['Resume Type'] || 'no resume'}] \${r.Title} @ \${r.Company} (\${r['Salary (listed)']}) \${r['Job URL']}\`;
const used = $('Budget Guard + Plan Scrapes').first()?.json?.apifyUsedUsd ?? 0;
const body = [
  \`Auto Job daily run - \${DateTime.now().setZone('${TZ}').toFormat('dd LLL yyyy')}\`, '',
  \`Jobs found today: \${found.found ?? 0} (\${found.new ?? 0} new, \${found.duplicates ?? 0} already seen)\`,
  \`Matched your filters: \${found.passed ?? 0}. Skipped: \${found.skipped ?? 0}. Waiting in the pending pool: \${lib.pending ?? '?'}\`, '',
  \`Emailed (\${by('Emailed').length}):\`, ...by('Emailed').map(line), '',
  \`Apply manually - resume ready (\${by('Apply manually').length}):\`, ...by('Apply manually').map(line), '',
  \`Failed (\${by('Failed').length}):\`, ...by('Failed').map(r => line(r) + ' -> ' + r.Notes), '',
  \`All time: \${lib.all?.unique ?? '?'} jobs found, \${lib.all?.applied ?? '?'} applied (\${lib.all?.tailored ?? 0} tailored, \${lib.all?.asIs ?? 0} master resume as-is), \${lib.all?.replies ?? 0} replies\`,
  \`Apify usage this month: $\${Number(used).toFixed(2)} of $\${$('Load Config').first().json.limits.apifyMonthlyBudgetUsd}\`,
].join('\\n');
return [{ json: { subject: \`Auto Job: \${by('Emailed').length} emailed, \${by('Apply manually').length} to apply manually\`, body } }];
`, [2420, 140], 'runOnceForAllItems', { executeOnce: true }));

  const sendReport = add(node('Email Me the Report', 'n8n-nodes-base.gmail', 2.1, [2640, 140], {
    sendTo: "={{ $('Load Config').first().json.candidate.email }}",
    subject: '={{ $json.subject }}', emailType: 'text', message: '={{ $json.body }}',
    options: { appendAttribution: false },
  }, { credentials: CRED_GMAIL, onError: 'continueRegularOutput' }));

  const scrapeIf = add(node('Scrape Today?', 'n8n-nodes-base.if', 2, [990, 300], {
    conditions: { options: { caseSensitive: true, typeValidation: 'loose' }, combinator: 'and',
      conditions: [{ id: 'c3', leftValue: '={{ $json.skip }}', rightValue: true, operator: { type: 'boolean', operation: 'notEquals' } }] },
    options: {},
  }, { executeOnce: false }));
  const anyIf = add(node('Anything To Apply?', 'n8n-nodes-base.if', 2, [2310, 300], {
    conditions: { options: { caseSensitive: true, typeValidation: 'loose' }, combinator: 'and',
      conditions: [{ id: 'c4', leftValue: "={{ String($json.stdout || '').trim() }}", rightValue: '[]', operator: { type: 'string', operation: 'notEquals' } }] },
    options: {},
  }));

  // Lay the main row out left-to-right without overlaps.
  const order = [trigger, readCfg, loadCfg, usage, plan, scrapeIf, scrape, normalize, foundToFile, saveFound,
    gmailAlerts, alertsPick, alertsToFile, saveAlerts, extract, library, pickNode, anyIf, picks, loop];
  order.forEach((name, i) => { nodes.find(n => n.name === name).position = [i * 220, 300]; });
  const shift = order.length * 220 - 1980;   // branch nodes were placed relative to the old loop position
  for (const n of nodes) if (!order.includes(n.name) && ![stats, report, sendReport].includes(n.name)) n.position = [n.position[0] + shift, n.position[1]];
  [stats, report, sendReport].forEach((name, i) => { nodes.find(n => n.name === name).position = [(order.length + i) * 220, 120]; });

  nodes.find(n => n.name === manual).position = [0, 480];
  connect(c, trigger, readCfg); connect(c, manual, readCfg);
  connect(c, readCfg, loadCfg); connect(c, loadCfg, usage); connect(c, usage, plan);
  connect(c, plan, scrapeIf);
  connect(c, scrapeIf, scrape, 0); connect(c, scrapeIf, normalize, 1);   // budget reached -> skip straight to the library
  connect(c, scrape, normalize); connect(c, normalize, foundToFile); connect(c, foundToFile, saveFound);
  connect(c, saveFound, gmailAlerts); connect(c, gmailAlerts, alertsPick); connect(c, alertsPick, alertsToFile);
  connect(c, alertsToFile, saveAlerts); connect(c, saveAlerts, extract); connect(c, extract, library);
  connect(c, library, pickNode); connect(c, pickNode, anyIf);
  connect(c, anyIf, picks, 0); connect(c, anyIf, stats, 1);              // nothing to apply -> still send the report
  connect(c, picks, loop);
  connect(c, loop, stats, 0);         // "done" output
  connect(c, stats, report);
  connect(c, loop, toFile, 1);        // "loop" output
  connect(c, toFile, saveJob); connect(c, saveJob, tailor); connect(c, tailor, parse); connect(c, parse, okIf);
  connect(c, okIf, emailIf, 0); connect(c, okIf, rowFail, 1);
  connect(c, emailIf, readPdf, 0); connect(c, emailIf, rowManual, 1);
  connect(c, readPdf, attach); connect(c, attach, send); connect(c, send, rowSent);
  connect(c, rowSent, append); connect(c, rowManual, append); connect(c, rowFail, append);
  connect(c, append, loop);
  connect(c, report, sendReport);

  return { id: 'm6fIQatHAJkUlDIP', name: 'Auto Job - 1. Daily Scrape, Tailor & Apply', nodes, connections: c,
    settings: { executionOrder: 'v1', timezone: TZ, saveManualExecutions: true }, pinData: {} };
}

/* =========================================================================
   WORKFLOW 2 — Reply watcher: employer email -> draft reply + calendar task
   ========================================================================= */
function replyWorkflow() {
  const nodes = [], c = {};
  const add = n => (nodes.push(n), n.name);

  const trigger = add(node('New Gmail Message', 'n8n-nodes-base.gmailTrigger', 1.2, [0, 300], {
    pollTimes: { item: [{ mode: 'everyX', value: 15, unit: 'minutes' }] },
    simple: false,
    filters: { q: 'in:inbox -from:me newer_than:2d -category:promotions -category:social' },
    options: {},
  }, { credentials: CRED_GMAIL }));

  const readCfg = add(exec('Read Config', READ_CONFIG, [220, 300], { executeOnce: true }));
  const readTracker = add(exec('Read Tracker (Excel)', TRACKER_LIST, [440, 300], { executeOnce: true }));

  const match = add(code('Match to Application', `
const cfg = JSON.parse($('Read Config').first().json.stdout);
const tracker = JSON.parse($('Read Tracker (Excel)').first().json.stdout || '[]');
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const GENERIC = /^(gmail|googlemail|yahoo|outlook|hotmail|live|icloud|proton|protonmail|linkedin|indeed|google|rozee|glassdoor)\\./i;
const out = [];
for (const { json: m } of $('New Gmail Message').all()) {
  const from = (m.from?.value?.[0]?.address || '').toLowerCase();
  if (!from || from === cfg.candidate.email.toLowerCase()) continue;
  const domain = from.split('@')[1] || '';
  const subj = String(m.subject || '').toLowerCase();
  let row = tracker.find(r => r['Gmail Thread ID'] && r['Gmail Thread ID'] === m.threadId)
         || tracker.find(r => r['Contact Email'] && r['Contact Email'].toLowerCase() === from);
  if (!row && domain && !GENERIC.test(domain)) {
    // hr@acme.com.pk -> "acme", not "com"
    const base = domain.replace(/\\.(com|org|net|edu|gov|co|ac)(\\.[a-z]{2})$/, '$2').split('.').slice(-2)[0];
    if (base.length >= 3) row = tracker.find(r => norm(r.Company).replace(/ /g, '').includes(base));
  }
  if (!row) row = tracker.find(r => norm(r.Company).length >= 4 && norm(subj).includes(norm(r.Company)));
  if (!row) continue;                                    // not about one of our applications
  if (String(row.Notes || '').includes(m.id)) continue;  // already handled
  const folder = row['Resume PDF'] ? row['Resume PDF'].replace(/[\\\\/][^\\\\/]+$/, '') : '';
  const safe = 'reply_' + m.id;
  out.push({ json: {
    messageId: m.id, threadId: m.threadId, from, fromName: m.from?.value?.[0]?.name || '', subject: m.subject || '',
    text: String(m.text || '').slice(0, 8000), row,
    job: { title: row.Title, company: row.Company, folder },
    inFile: '${ROOT}/applications/_queue/' + safe + '.json', fileName: safe + '.json',
  } });
}
return out;
`, [660, 300]));

  const toFile = add(node('Email -> JSON File', 'n8n-nodes-base.convertToFile', 1.1, [880, 300],
    { operation: 'toJson', mode: 'each', options: { fileName: '={{ $json.fileName }}' } }));
  const save = add(node('Save Email File', 'n8n-nodes-base.readWriteFile', 1, [1100, 300],
    { operation: 'write', fileName: "={{ $('Match to Application').item.json.inFile }}", options: {} }));
  const draft = add(exec('Draft Reply (Claude)',
    `=${NODE} "${ROOT}/scripts/draft-reply.js" "{{ $('Match to Application').item.json.inFile }}"`, [1320, 300]));

  const parse = add(code('Parse Draft + Pick Reminder Time', `
const lines = String($json.stdout || '').trim().split(/\\r?\\n/);
let r; try { r = JSON.parse(lines.pop()); } catch (e) { r = { ok: false, error: 'bad output' }; }
const m = $('Match to Application').item.json;
const reply = r.ok ? r.replyBody
  : \`Dear \${m.fromName || 'Hiring Team'},\\n\\nThank you for getting back to me regarding the \${m.job.title} role. [FILL: your reply]\\n\\nBest regards,\`;
// Reminder: within working hours today (+1h) or tomorrow 10:00 PKT.
let start = DateTime.now().setZone('${TZ}').plus({ hours: 1 }).startOf('hour');
if (start.hour >= 18 || start.hour < 9) start = (start.hour >= 18 ? start.plus({ days: 1 }) : start).set({ hour: 10, minute: 0 });
return { json: { ...m, intent: r.intent || 'other', summary: r.summary || ('Reply from ' + m.from), replyBody: reply,
  start: start.toISO(), end: start.plus({ minutes: 30 }).toISO() } };
`, [1540, 300], 'runOnceForEachItem'));

  const gDraft = add(node('Create Gmail Draft Reply', 'n8n-nodes-base.gmail', 2.1, [1760, 300], {
    resource: 'draft', operation: 'create',
    subject: "={{ $json.subject.startsWith('Re:') ? $json.subject : 'Re: ' + $json.subject }}",
    emailType: 'text', message: '={{ $json.replyBody }}',
    options: { threadId: '={{ $json.threadId }}', sendTo: '={{ $json.from }}' },
  }, { credentials: CRED_GMAIL }));

  const cal = add(node('Calendar: Reply Reminder', 'n8n-nodes-base.googleCalendar', 1.3, [1980, 300], {
    calendar: { __rl: true, mode: 'list', value: 'primary' },
    start: "={{ $('Parse Draft + Pick Reminder Time').item.json.start }}",
    end: "={{ $('Parse Draft + Pick Reminder Time').item.json.end }}",
    additionalFields: {
      summary: "=Reply: {{ $('Parse Draft + Pick Reminder Time').item.json.job.company }} - {{ $('Parse Draft + Pick Reminder Time').item.json.job.title }} ({{ $('Parse Draft + Pick Reminder Time').item.json.intent }})",
      description: "={{ $('Parse Draft + Pick Reminder Time').item.json.summary }}\n\nA draft reply is waiting in Gmail Drafts.\nThread: https://mail.google.com/mail/u/0/#all/{{ $('Parse Draft + Pick Reminder Time').item.json.threadId }}",
    },
  }, { credentials: CRED_GCAL }));

  const patch = add(code('Build Tracker Update', `
${B64}
const p = $('Parse Draft + Pick Reminder Time').item.json;
const patch = { key: p.row['Dedup Key'], 'Status': 'Reply received', 'Reply Received': DateTime.now().setZone('${TZ}').toISODate(),
  'Reply Summary': String(p.summary).slice(0, 400), 'Calendar Event': $json.htmlLink || $json.id || '',
  'Notes': (String(p.row.Notes || '') + ' | msg:' + p.messageId + ' (' + p.intent + ')').slice(-400) };
const lib = { key: p.row['Dedup Key'], status: 'Reply received', notes: String(p.summary).slice(0, 400) };
return { json: { b64: b64(JSON.stringify(patch)), libB64: b64(JSON.stringify(lib)) } };
`, [2200, 300], 'runOnceForEachItem'));

  const upd = add(exec('Update Tracker + Library',
    `=${NODE} "${ROOT}/scripts/tracker.js" update "b64:{{ $json.b64 }}" && ${NODE} "${ROOT}/scripts/jobsdb.js" mark "b64:{{ $json.libB64 }}"`, [2420, 300]));

  connect(c, trigger, readCfg); connect(c, readCfg, readTracker); connect(c, readTracker, match);
  connect(c, match, toFile); connect(c, toFile, save); connect(c, save, draft); connect(c, draft, parse);
  connect(c, parse, gDraft); connect(c, gDraft, cal); connect(c, cal, patch); connect(c, patch, upd);

  return { id: '0QgDofql1793MxW3', name: 'Auto Job - 2. Reply Watcher (Draft + Calendar)', nodes, connections: c,
    settings: { executionOrder: 'v1', timezone: TZ }, pinData: {} };
}

/* =========================================================================
   WORKFLOW 3 - Apply to jobs you picked in the dashboard's job library.
   Reuses the daily workflow's apply loop node-for-node (tailor -> email or manual -> tracker + library),
   so both always behave the same. Started by the dashboard with `n8n execute` (manual trigger).
   ========================================================================= */
function selectedWorkflow(daily) {
  const LOOP = ['Read Config', 'Load Config', 'Loop Jobs (one at a time)', 'Job -> JSON File', 'Save Job File', 'Tailor Resume (/hiring-panel)',
    'Parse Tailor Result', 'Tailored OK?', 'Has Contact Email?', 'Read Resume PDF', 'Attach Files', 'Send Application (Gmail)',
    'Row: Emailed', 'Row: Apply Manually', 'Row: Tailor Failed', 'Record in Tracker + Library'];
  const nodes = daily.nodes.filter(n => LOOP.includes(n.name)).map(n => JSON.parse(JSON.stringify(n)));
  const c = {};
  for (const [from, v] of Object.entries(daily.connections)) {
    if (!LOOP.includes(from) || from === 'Load Config') continue;      // Load Config is re-wired below
    const main = v.main.map(outs => outs.filter(t => LOOP.includes(t.node)));
    if (main.some(o => o.length)) c[from] = { main };
  }
  // Loop "done" output went to Library Stats in the daily flow; here the run simply ends.
  c['Loop Jobs (one at a time)'].main[0] = [];
  const add = n => (nodes.push(n), n.name);
  const start = add(node('Apply Chosen Job (dashboard)', 'n8n-nodes-base.manualTrigger', 1, [0, 300], {}));
  const take = add(exec('Read Chosen Job', `${NODE} "${ROOT}/scripts/jobsdb.js" take-manual`, [660, 300], { executeOnce: true }));
  const jobs = add(code('Jobs To Apply', `
const out = JSON.parse(String($input.first().json.stdout || '[]').trim().split(/\\r?\\n/).pop() || '[]');
if (!Array.isArray(out)) throw new Error('No chosen job found: ' + JSON.stringify(out));
return out.map(json => ({ json }));
`, [880, 300]));
  connect(c, start, 'Read Config'); connect(c, 'Read Config', 'Load Config'); connect(c, 'Load Config', take);
  connect(c, take, jobs); connect(c, jobs, 'Loop Jobs (one at a time)');
  // Tidy layout: same relative positions as the daily loop, shifted to start after the new nodes.
  const loopX = daily.nodes.find(n => n.name === 'Loop Jobs (one at a time)').position[0];
  for (const n of nodes) {
    if (n.name === 'Read Config') n.position = [220, 300];
    else if (n.name === 'Load Config') n.position = [440, 300];
    else if (LOOP.includes(n.name)) n.position = [n.position[0] - loopX + 1100, n.position[1]];
  }
  return { id: 'AutoJobApplySel1', name: 'Auto Job - 3. Apply to Selected Jobs (dashboard)', nodes, connections: c,
    settings: { executionOrder: 'v1', timezone: TZ, saveManualExecutions: true }, pinData: {} };
}

/* =========================================================================
   WORKFLOW 4 - Send one email you wrote in the dashboard's "Emails & cover letters" tab and pressed Send now on.
   The dashboard queues it (applications/_queue/send-email.json) and starts this with `n8n execute`.
   ========================================================================= */
function sendWorkflow() {
  const nodes = [], c = {};
  const add = n => (nodes.push(n), n.name);
  const start = add(node('Send Email (dashboard)', 'n8n-nodes-base.manualTrigger', 1, [0, 300], {}));
  const take = add(exec('Read Email To Send', `${NODE} "${ROOT}/scripts/send-queue.js" take`, [220, 300], { executeOnce: true }));
  const mail = add(code('Email To Send', `
const out = JSON.parse(String($input.first().json.stdout || '[]').trim().split(/\\r?\\n/).pop() || '[]');
if (!Array.isArray(out) || !out.length) throw new Error('No email waiting to be sent.');
return out.map(json => ({ json }));
`, [440, 300]));
  const hasFile = add(node('Attach Resume?', 'n8n-nodes-base.if', 2, [660, 300], {
    conditions: { options: { caseSensitive: true, typeValidation: 'loose' }, combinator: 'and',
      conditions: [{ id: 'a1', leftValue: '={{ $json.attachment }}', rightValue: '', operator: { type: 'string', operation: 'notEmpty', singleValue: true } }] },
    options: {},
  }));
  const readFile = add(node('Read Resume PDF', 'n8n-nodes-base.readWriteFile', 1, [880, 200],
    { fileSelector: "={{ $json.attachment.replaceAll('\\\\', '/') }}", options: {} }));
  const gmail = (name, pos, attach) => node(name, 'n8n-nodes-base.gmail', 2.1, pos, {
    sendTo: "={{ $('Email To Send').item.json.to }}",
    subject: "={{ $('Email To Send').item.json.subject }}",
    emailType: 'text',
    message: "={{ $('Email To Send').item.json.body }}",
    options: { appendAttribution: false, senderName: "={{ $('Email To Send').item.json.senderName }}",
      ...(attach ? { attachmentsUi: { attachmentsBinary: [{ property: 'data' }] } } : {}) },
  }, { credentials: CRED_GMAIL, onError: 'continueRegularOutput' });
  const sendWith = add(gmail('Send With Resume (Gmail)', [1100, 200], true));
  const sendWithout = add(gmail('Send (Gmail)', [1100, 400], false));
  const result = add(code('Result', `
${B64}
const ok = !!($json.id || $json.threadId);
return { json: { b64: b64(JSON.stringify({ ok, id: $('Email To Send').item.json.id, threadId: $json.threadId || '',
  error: ok ? '' : JSON.stringify($json.error || $json).slice(0, 300) })) } };
`, [1320, 300], 'runOnceForEachItem'));
  const done = add(exec('Record Result', `=${NODE} "${ROOT}/scripts/send-queue.js" done "b64:{{ $json.b64 }}"`, [1540, 300]));
  connect(c, start, take); connect(c, take, mail); connect(c, mail, hasFile);
  connect(c, hasFile, readFile, 0); connect(c, hasFile, sendWithout, 1);
  connect(c, readFile, sendWith); connect(c, sendWith, result); connect(c, sendWithout, result); connect(c, result, done);
  return { id: 'AutoJobSendMail1', name: 'Auto Job - 4. Send Email (dashboard)', nodes, connections: c,
    settings: { executionOrder: 'v1', timezone: TZ, saveManualExecutions: true }, pinData: {} };
}

fs.mkdirSync(path.join(ROOT, 'n8n'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'applications', '_queue'), { recursive: true });
const daily = dailyWorkflow();
for (const [file, wf] of [['1-daily-apply.json', daily], ['2-reply-watcher.json', replyWorkflow()], ['3-apply-selected.json', selectedWorkflow(daily)], ['4-send-email.json', sendWorkflow()]]) {
  fs.writeFileSync(path.join(ROOT, 'n8n', file), JSON.stringify(wf, null, 2));
  console.log('wrote n8n/' + file + ' (' + wf.nodes.length + ' nodes)');
}
