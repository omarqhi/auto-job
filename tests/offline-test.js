#!/usr/bin/env node
// Offline tests: runs the n8n Code-node logic from the generated workflows against fixtures.
// No Apify, Gmail, Calendar or Claude calls are made.
//   node scripts/build-workflows.js && node tests/offline-test.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const npmRoot = execSync('npm root -g').toString().trim();
const { DateTime } = require(path.join(npmRoot, 'n8n', 'node_modules', 'luxon'));
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
cfg.search.keywords = ['senior manager', 'product manager'];           // test keywords
cfg.filters.minMonthlyPkr = 120000;                                    // fixtures below are written around a fixed 120k minimum
const wf1 = require(path.join(ROOT, 'n8n', '1-daily-apply.json'));
const wf2 = require(path.join(ROOT, 'n8n', '2-reply-watcher.json'));

let pass = 0, fail = 0;
const check = (name, cond, info = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + info}`); };

const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
const codeOf = (wf, name) => wf.nodes.find(n => n.name === name).parameters.jsCode;
const items = arr => arr.map(json => ({ json }));
// Build an n8n-like `$` accessor from { nodeName: [json, ...] }
const dollar = data => name => {
  if (!(name in data)) throw new Error(`Node '${name}' hasn't been executed`);
  const list = items(data[name]);
  return { first: () => list[0], all: () => list, item: list[0] };
};
async function runAll(wf, name, input, data) {
  const $input = { all: () => items(input), first: () => items(input)[0] };
  return new AsyncFn('$input', '$', 'DateTime', codeOf(wf, name))($input, dollar(data), DateTime);
}
async function runEach(wf, name, json, data) {
  return new AsyncFn('$json', '$', 'DateTime', codeOf(wf, name))(json, dollar(data), DateTime);
}

(async () => {
  // ---------- 1. Budget guard + plan ----------
  const planName = 'Budget Guard + Plan Scrapes';
  let runs = await runAll(wf1, planName, [{ data: { totalUsageCreditsUsdAfterVolumeDiscount: 0.4 } }], { 'Load Config': [cfg] });
  const boards = runs.filter(r => /^valig~/.test(r.json.actor));
  check('plan: 2 keywords -> 4 job-board runs (LinkedIn + Indeed each)', boards.length === 4, boards.length);
  check('plan: no paid Google Jobs actor', runs.every(r => !/google-jobs/i.test(r.json.actor)));
  check('plan: per-keyword limit splits budget (40/2=20)', boards.every(r => r.json.input.limit === 20));
  check('plan: last 24h only', boards.every(r => ['r86400', '1'].includes(r.json.input.datePosted)));
  const gRun = runs.find(r => r.json.source === 'google'), pRun = runs.find(r => r.json.source === 'posts');
  const gq = gRun?.json.input.queries.split('\n') || [];
  check('plan: Google run = every Boolean query + one rotating remote-site query, Pakistan, recent only',
    gq.length === cfg.sources.googleSearch.queries.length + 1 && cfg.sources.googleSearch.rotateQueries.includes(gq[gq.length - 1]) &&
    gRun.json.input.countryCode === 'pk' && gRun.json.input.quickDateRange === 'd3', JSON.stringify(gRun?.json.input));
  check('plan: LinkedIn hiring-posts run, last 24h, capped posts', pRun && pRun.json.input.postedLimit === '24h' && pRun.json.input.maxPosts === cfg.sources.linkedinPosts.maxPostsPerQuery);
  const off = { ...cfg, sources: { ...cfg.sources, googleSearch: { ...cfg.sources.googleSearch, enabled: false }, linkedinPosts: { ...cfg.sources.linkedinPosts, enabled: false } } };
  runs = await runAll(wf1, planName, [{ data: { totalUsageCreditsUsdAfterVolumeDiscount: 0.4 } }], { 'Load Config': [off] });
  check('plan: extra sources switch off cleanly', runs.length === 4, runs.length);
  runs = await runAll(wf1, planName, [{ data: { totalUsageCreditsUsdAfterVolumeDiscount: 2.85 } }], { 'Load Config': [cfg] });
  check('plan: budget >= $2.80 -> skip scraping, still continue to pending pool', runs.length === 1 && runs[0].json.skip === true);
  const noKw = { ...cfg, search: { ...cfg.search, keywords: ['FILL FROM RESUME'] } };
  let threw = false; try { await runAll(wf1, planName, [{ data: {} }], { 'Load Config': [noKw] }); } catch { threw = true; }
  check('plan: placeholder keywords -> clear error', threw);

  // ---------- 2. Normalize + filter ----------
  const li = (id, title, companyName, experienceLevel, salary, description = '') => ({ id, url: 'https://pk.linkedin.com/jobs/view/' + id, title, companyName, location: 'Lahore, Pakistan', experienceLevel, salary, applyUrl: '', recruiterName: '', description });
  const ind = (key, title, name, min, max, unit = 'MONTH', cur = 'PKR', text = '') => ({ key, title, url: 'https://pk.indeed.com/viewjob?jk=' + key, jobUrl: '', employer: { name }, location: { city: 'Karachi', countryName: 'Pakistan' }, baseSalary: { min, max, unitOfWork: min || max ? unit : null, currencyCode: min || max ? cur : null }, description: { text } });
  const raw = [
    li('L1', 'Senior Manager - Partner Compliance', 'The Citizens Foundation', 'Mid-Senior level', ''),
    li('L2', 'Factory Manager', 'Shan Foods', 'Mid-Senior level', '', 'Email your CV at careers@shanfoods.com.'),
    li('L3', 'Senior Manager Product - Core Cards', 'Recruit AI', 'Mid-Senior level', 'PKR 300,000.00/mo - PKR 350,000.00/mo'),
    li('L4', 'Head of Key Accounts', 'Reckitt', 'Not Applicable', ''),
    li('L5', 'Customer Support Agent', 'Z', 'Entry level', ''),
    li('L6', 'Senior Engineer', 'Low Pay Co', 'Mid-Senior level', 'PKR 90,000/mo'),
    li('L7', 'Junior Product Manager', 'J', 'Mid-Senior level', ''),
    ind('I1', 'Senior Manager - Early Years', 'ITA', 140000, 160000),
    ind('I2', 'Sales Manager', 'Trax', 80000, 100000),
    ind('I3', 'Senior Manager HR/Head HR', 'Absolute RM', null, null, 'MONTH', 'PKR', 'Share resume at hr@absolute.com.pk or noreply@indeed.com'),
    ind('I4', 'Backend Engineer', 'Remote US Co', 30000, 40000, 'YEAR', 'USD'),
    ind('I5', 'Data Analyst', 'Yearly PK', 1800000, 2400000, 'YEAR', 'PKR'),
    { title: 'Senior Data Engineer', company_name: 'Acme', detected_extensions: { salary: '$60K a year' }, job_id: 'g1' },  // Google-shaped: must be ignored
    { error: 'scraper failed' },
  ];
  const all = (await runAll(wf1, 'Normalize + Pay/Seniority Filter', raw, { 'Load Config': [cfg] })).map(i => i.json);
  const norm = all.filter(j => j.passed);
  const ids = norm.map(j => j.jobId);
  const has = id => ids.includes(id);
  const reasonOf = id => all.find(j => j.jobId === id)?.reason || '';
  check('filter: every job kept & labelled (12 real jobs, Google/error ignored)', all.length === 12, all.length);
  check('filter: passes listed pay >= 120k (L3 350k, I1 160k)', has('L3') && has('I1'));
  check('filter: passes senior roles with no pay (L1, L2, L4, I3)', ['L1', 'L2', 'L4', 'I3'].every(has), ids);
  check('filter: pay < 120k skipped with reason (L6, I2)', !has('L6') && /Pay below minimum/.test(reasonOf('L6')) && /Pay below/.test(reasonOf('I2')));
  check('filter: junior / non-senior no-pay skipped with reason (L7, L5)', /Junior/.test(reasonOf('L7')) && /not a senior/.test(reasonOf('L5')));
  check('filter: USD/year converted ($40k/yr -> 933k PKR/mo)', norm.find(j => j.jobId === 'I4')?.salaryMax === 933333);
  check('filter: PKR/year converted (2.4M/yr -> 200k/mo)', norm.find(j => j.jobId === 'I5')?.salaryMax === 200000);
  check('filter: real email extracted, noreply skipped', norm.find(j => j.jobId === 'I3')?.contactEmail === 'hr@absolute.com.pk');
  check('filter: seniority label from title when level N/A', norm.find(j => j.jobId === 'L4')?.seniority === 'Senior (title)');
  // Google results and LinkedIn posts come out of Normalize as leads (_candidate), not jobs.
  const leads = (await runAll(wf1, 'Normalize + Pay/Seniority Filter', [
    { searchQuery: { term: 'x' }, organicResults: [{ title: 'HR Manager - Acme', url: 'https://acme.pk/careers/hr', description: 'Lahore' }, { title: 'No url' }] },
    { content: 'We are hiring an HR Manager in Lahore!\nSend CV to jobs@acme.pk', linkedinUrl: 'https://www.linkedin.com/posts/acme-123', author: { name: 'Sara K', info: 'Talent at Acme' } },
  ], { 'Load Config': [cfg] })).map(i => i.json);
  check('normalize: Google results + posts become leads, not jobs', leads.length === 2 && leads.every(l => l._candidate) && leads[0].kind === 'google' && leads[1].kind === 'post' && /jobs@acme\.pk/.test(leads[1].text));

  // scripts/rules.js must decide exactly like the Normalize node (it judges the extracted jobs).
  const { makeRules } = require(path.join(ROOT, 'scripts', 'rules.js'));
  const R = makeRules(cfg.filters);
  const mismatch = all.filter(j => { const k = R.apply({ ...j, contactEmail: '' }); return k.passed !== j.passed || k.reason !== j.reason; }).map(j => j.jobId);
  check('rules.js: same pass/skip decisions and reasons as the n8n filter (12 jobs)', mismatch.length === 0, mismatch.join(','));
  const noPay = title => R.apply({ title, level: '', salaryMax: null, description: '' }).passed;
  // Postings that ask for an HR degree get an honest degree line in the cover email.
  const { asksForHrDegree } = require(path.join(ROOT, 'scripts', 'rules.js'));
  check('degree line: HR-degree requirements are recognised',
    ['MBA in HR required', 'Masters in Human Resource Management is a must', 'BBA (HRM) or equivalent', 'Graduate degree in HR preferred', "Master's degree in Human Resources"].every(asksForHrDegree));
  check('degree line: other postings are left alone',
    ![ 'MBA in Finance required', 'Bachelor degree in any discipline', '5 years of HR experience', 'Strong HR background, CS degree welcome'].some(asksForHrDegree));
  // Remote jobs: anywhere in the world, as long as someone living in Pakistan can take it.
  const where = require(path.join(ROOT, 'scripts', 'jobsdb.js')).locationRule({ filters: { allowedCities: ['Lahore'], allowRemote: true } });
  const rLoc = (location, description = '') => where({ title: 'HR Manager', location, description });
  check('location rule: an added post that names no city is kept, a scraped job without one is not',
    where({ title: 'HR Manager', location: '', source: 'added' }) === null && !!where({ title: 'HR Manager', location: '', source: 'linkedin' }));
  check('remote rule: open worldwide / to Pakistan / region / not stated -> kept',
    [rLoc('Remote (open to: Anywhere)'), rLoc('Remote (open to: Worldwide)'), rLoc('Pakistan (Remote)'), rLoc('Remote (open to: Asia, EMEA)'),
     rLoc('Remote'), rLoc('Karachi', 'This is a fully remote role.'), rLoc('Lahore, Pakistan')].every(r => r === null));
  check('remote rule: remote but tied to another country -> skipped with the reason',
    [rLoc('Remote (open to: USA only)'), rLoc('New York, NY (Remote)'), rLoc('Remote (open to: EU)'), rLoc('United Kingdom (Remote)')]
      .every(r => /^Remote, but not open to Pakistan/.test(r || '')), rLoc('Remote (open to: USA only)'));
  check('remote rule: an onsite job in another city is still skipped', /^Outside Lahore/.test(rLoc('Karachi, Pakistan') || ''));
  check('rules: Talent Acquisition Specialist with no pay listed is kept; other specialists are not',
    noPay('Talent Acquisition Specialist') && noPay('TA Specialist - Lahore') && !noPay('Talent Acquisition Executive') && !noPay('Payroll Specialist'));
  check('rules.js: salary parsing matches ("PKR 300,000.00/mo - PKR 350,000.00/mo" -> 350k)', R.parseSalaryText('PKR 300,000.00/mo - PKR 350,000.00/mo')?.max === 350000);

  // The minimum comes from config: at 100k, a job paying up to Rs 100,000 now counts, 90k still doesn't.
  const at100 = (await runAll(wf1, 'Normalize + Pay/Seniority Filter', raw, { 'Load Config': [{ ...cfg, filters: { ...cfg.filters, minMonthlyPkr: 100000 } }] })).map(i => i.json);
  check('filter: 100k minimum keeps Rs 100,000 (I2), still skips 90k (L6)', at100.find(j => j.jobId === 'I2')?.passed === true && at100.find(j => j.jobId === 'L6')?.passed === false);
  const none = (await runAll(wf1, 'Normalize + Pay/Seniority Filter', [{ skip: true }], { 'Load Config': [cfg] })).map(i => i.json);
  check('filter: no jobs scraped -> one placeholder item so the run continues', none.length === 1 && none[0]._empty === true);

  // ---------- 3. Match score ----------
  const { scoreJob } = require(path.join(ROOT, 'scripts', 'score.js'));
  const master = fs.readFileSync(path.join(ROOT, 'resume', 'master-resume.md'), 'utf8');
  const sopts = { titles: cfg.search.keywords, city: 'Lahore' };
  const sample = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'sample-job.json'), 'utf8'));
  const sHr = scoreJob(sample, master, sopts);
  const sOff = scoreJob({ title: 'Senior Backend Engineer', location: 'Karachi, Pakistan', description: 'Node.js, Kubernetes, Go, 8+ years' }, master, sopts);
  const sJun = scoreJob({ title: 'HR Assistant', location: 'Lahore', description: 'Recruitment support, filing' }, master, sopts);
  check('score: HR Manager in Lahore scores high (>= 80)', sHr.score >= 80, JSON.stringify(sHr));
  check('score: unrelated engineering role scores low (< 50)', sOff.score < 50, sOff.score);
  check('score: junior HR title scores below the manager role', sJun.score < sHr.score, `${sJun.score} vs ${sHr.score}`);
  check('score: stays within 0-100 and lists matched/missing skills', sHr.score <= 100 && sHr.matched.length > 0 && Array.isArray(sHr.missing));

  // ---------- 4. Job library (SQLite, temp DB) ----------
  const today = DateTime.now().setZone('Asia/Karachi').toISODate();
  const tmpDb = path.join(os.tmpdir(), `autojob-test-${Date.now()}.db`);
  const tmpTracker = path.join(os.tmpdir(), `autojob-trk-${Date.now()}.xlsx`);
  // The library reads its own config file; these tests pin a fixed 5-a-day limit and no score gate.
  const tmpCfg = path.join(os.tmpdir(), `autojob-cfg-${Date.now()}.json`);
  const writeCfg = over => fs.writeFileSync(tmpCfg, JSON.stringify({ ...cfg,
    filters: { ...cfg.filters, allowedCities: [], ...(over.filters || {}) },
    matching: { ...cfg.matching, minScore: 0, ...(over.matching || {}) }, limits: { ...cfg.limits, maxApplicationsPerDay: 5, ...(over.limits || {}) } }));
  writeCfg({});
  const libEnv = { ...process.env, JOBS_DB: tmpDb, TRACKER_FILE: tmpTracker, AUTOJOB_CONFIG: tmpCfg };
  const trk = (...a) => JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'tracker.js'), ...a], { env: libEnv }).toString());
  const lib = (...a) => JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'jobsdb.js'), ...a], { env: libEnv }).toString().trim().split(/\r?\n/).pop());
  const b64j = o => 'b64:' + Buffer.from(JSON.stringify(o)).toString('base64');
  // A pre-existing tracker (applications made before the library existed) must be migrated and never re-applied.
  trk('init');
  trk('append', b64j([{ 'Applied On': '2026-10-01', Source: 'linkedin', 'Job ID': 'L3', 'Dedup Key': 'linkedin|L3', Title: 'Senior Manager Product - Core Cards', Company: 'Recruit AI', Status: 'Emailed' }]));
  const foundFile = path.join(os.tmpdir(), `autojob-found-${Date.now()}.json`);
  fs.writeFileSync(foundFile, JSON.stringify([...all, { ...all.find(j => j.jobId === 'I1') }, { _empty: true }]));
  const imp = lib('import', foundFile);
  check('library: counts found / new / duplicates', imp.found === 13 && imp.duplicates === 2 && imp.new === 11, JSON.stringify(imp));
  check('library: passed vs skipped split', imp.passed + imp.skipped === imp.new && imp.skipped === 4, JSON.stringify(imp));
  const imp2 = lib('import', foundFile);
  check('library: re-importing the same jobs adds nothing', imp2.new === 0 && imp2.duplicates === 13, JSON.stringify(imp2));
  // A posting can carry a harmful link: only http(s) links are ever stored.
  const badLink = path.join(os.tmpdir(), `autojob-badlink-${Date.now()}.json`);
  fs.writeFileSync(badLink, JSON.stringify([{ source: 'post', jobId: 'XSS1', title: 'HR Manager', company: 'Trap Co', location: 'Lahore',
    url: 'javascript:alert(1)', applyUrl: ' JavaScript:fetch("/api/config")' }, { source: 'post', jobId: 'OK1', title: 'HR Manager', company: 'Good Co',
    location: 'Lahore', url: 'https://good.pk/job', applyUrl: '' }]));
  lib('import', badLink); fs.rmSync(badLink, { force: true });
  const linkDb = new (require('node:sqlite').DatabaseSync)(tmpDb, { readOnly: true });
  const linkRows = linkDb.prepare("SELECT job_id, url, apply_url FROM jobs WHERE job_id IN ('XSS1','OK1')").all();
  linkDb.close();
  const xss = linkRows.find(r => r.job_id === 'XSS1'), ok1 = linkRows.find(r => r.job_id === 'OK1');
  check('links: javascript: links from a posting are dropped, normal links kept', xss.url === '' && xss.apply_url === '' && ok1.apply_url === 'https://good.pk/job', JSON.stringify(linkRows));
  const noCo = path.join(os.tmpdir(), `autojob-noco-${Date.now()}.json`);
  fs.writeFileSync(noCo, JSON.stringify([1, 2].map(n => ({ source: 'post', jobId: 'P' + n, title: 'HR Manager', company: '', location: 'Lahore' }))));
  const impNoCo = lib('import', noCo); fs.rmSync(noCo, { force: true });
  check('library: two posts with no company and the same title are not duplicates', impNoCo.new === 2 && impNoCo.duplicates === 0, JSON.stringify(impNoCo));
  const picks1 = lib('pick');
  check('library: picks at most the daily cap (5)', picks1.length === 5, picks1.length);
  check('library: never picks an already-applied job (L3 from tracker)', !picks1.some(p => p.dedupKey === 'linkedin|L3'));
  check('library: picks carry score + job file path', picks1.every(p => typeof p.score === 'number' && p.jobFile.includes('/applications/_queue/')));
  const order = picks1.map(p => p.score);
  check('library: ordered by pay tier, then score', picks1[0].salaryMax >= cfg.filters.targetMonthlyPkr || picks1[0].salaryMax == null, JSON.stringify(order));
  for (const p of picks1.slice(0, 4)) lib('mark', b64j({ key: p.dedupKey, status: 'Emailed', resumeType: p.score >= 80 ? 'master' : 'tailored' }));
  lib('mark', b64j({ key: picks1[4].dedupKey, status: 'Failed', notes: 'test' }));
  const picks2 = lib('pick');
  check('library: 4 applied today -> only 1 more allowed', picks2.length === 1, picks2.length);
  check('library: a failed job is retried once', picks2[0]?.dedupKey === picks1[4].dedupKey || picks2.length === 1);
  const libStats = lib('stats');
  const st0 = libStats;
  check('stats: applied today = 4, all-time applied = 5 (incl. migrated)', st0.today.applied === 4 && st0.all.applied === 5, JSON.stringify(st0.today) + JSON.stringify(st0.all));
  check('stats: tailored + sent-as-is = all applied (migrated rows count as tailored)', st0.all.tailored + st0.all.asIs === st0.all.applied, JSON.stringify(st0.all));
  check('stats: pending pool reported', st0.pending === imp.passed - 5, `${st0.pending} vs ${imp.passed - 5}`);
  for (const f of [tmpDb, tmpDb + '-wal', tmpDb + '-shm', tmpTracker, foundFile]) fs.rmSync(f, { force: true });

  // ---------- 4b. "Every relevant job": no daily number, minimum score, restricted titles ----------
  const tmpDb2 = path.join(os.tmpdir(), `autojob-test2-${Date.now()}.db`);
  const env2 = { ...libEnv, JOBS_DB: tmpDb2, TRACKER_FILE: path.join(os.tmpdir(), `autojob-none-${Date.now()}.xlsx`) };
  const lib2 = (...a) => JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'jobsdb.js'), ...a], { env: env2 }).toString().trim().split(/\r?\n/).pop());
  writeCfg({ limits: { maxApplicationsPerDay: 0, safetyCapPerDay: 40 }, matching: { minScore: 70 } });
  const hrDesc = 'Own recruitment, onboarding, payroll, performance management, KPIs, employee relations, HR policies and SOPs, HRIS (Zoho People). 6+ years.';
  const mk = (id, title, extra = {}) => ({ source: 'test', jobId: id, title, company: 'Co ' + id, location: 'Lahore, Pakistan', description: hrDesc, passed: true, reason: '', ...extra });
  const many = Array.from({ length: 12 }, (_, i) => mk('R' + i, i % 2 ? 'HR Manager' : 'Head of HR'));
  const odd = [
    mk('X1', 'Assistant Manager MIS', { description: 'Maintain MIS reports, SQL, Excel dashboards.' }),
    mk('X2', 'Human Resource Manager (Female)'),
    mk('X3', 'Sales Manager', { passed: false, reason: 'Pay below minimum (Rs 90,000 a month)' }),
  ];
  const f2 = path.join(os.tmpdir(), `autojob-found2-${Date.now()}.json`);
  fs.writeFileSync(f2, JSON.stringify([...many, ...odd]));
  const imp3 = lib2('import', f2);
  check('relevant: 12 HR jobs kept, MIS + female-only + low pay skipped', imp3.passed === 12 && imp3.skipped === 3, JSON.stringify(imp3));
  const picks3 = lib2('pick');
  check('relevant: no daily number -> all 12 relevant jobs picked in one run', picks3.length === 12, picks3.length);
  check('relevant: off-field and restricted jobs never picked', !picks3.some(p => /MIS|Female/i.test(p.title)));
  writeCfg({ limits: { maxApplicationsPerDay: 0, safetyCapPerDay: 3 }, matching: { minScore: 70 } });
  const f3 = path.join(os.tmpdir(), `autojob-found3-${Date.now()}.json`);
  fs.writeFileSync(f3, JSON.stringify(Array.from({ length: 6 }, (_, i) => mk('S' + i, 'HR Business Partner'))));
  lib2('import', f3);
  for (const p of picks3) lib2('mark', b64j({ key: p.dedupKey, status: 'Emailed', resumeType: 'master' }));
  const picks4 = lib2('pick');
  check('relevant: safety cap still applies (12 sent today, cap 3 -> 0 more)', picks4.length === 0, picks4.length);
  for (const f of [tmpDb2, tmpDb2 + '-wal', tmpDb2 + '-shm', f2, f3]) fs.rmSync(f, { force: true });

  // ---------- 4c. Location: Lahore or remote only ----------
  const tmpDb3 = path.join(os.tmpdir(), `autojob-test3-${Date.now()}.db`);
  const env3 = { ...env2, JOBS_DB: tmpDb3 };
  const lib3 = (...a) => JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'jobsdb.js'), ...a], { env: env3 }).toString().trim().split(/\r?\n/).pop());
  writeCfg({ limits: { maxApplicationsPerDay: 0 }, matching: { minScore: 0 }, filters: { allowedCities: ['Lahore'], allowRemote: true } });
  const loc = (id, title, location, extra = '') => mk(id, title, { location, description: hrDesc + ' ' + extra });
  const places = [
    loc('L1', 'HR Manager', 'Lahore, Punjab, Pakistan'),
    loc('L2', 'Head of HR', 'Karachi, Sindh, Pakistan'),
    loc('L3', 'HR Business Partner (Remote)', 'Karachi, Pakistan'),
    loc('L4', 'HR Operations Manager', 'Islamabad, Pakistan', 'This is a fully remote position.'),
    loc('L5', 'HR Manager', 'Faisalabad, Pakistan', 'You will support remote teams across regions.'),
    loc('L6', 'People Lead', 'Remote'),
  ];
  const f4 = path.join(os.tmpdir(), `autojob-found4-${Date.now()}.json`);
  fs.writeFileSync(f4, JSON.stringify(places));
  lib3('import', f4);
  const keep = lib3('pick').map(p => p.jobId).sort().join(',');
  check('location: Lahore + remote (title/location/"fully remote") kept; Karachi + "remote teams" skipped', keep === 'L1,L3,L4,L6', keep);
  const { DatabaseSync } = require('node:sqlite');
  const db3 = new DatabaseSync(tmpDb3);
  const why = db3.prepare("SELECT reason FROM jobs WHERE job_id = 'L2'").get().reason;
  db3.close();
  check('location: skip reason names the city', /Outside Lahore \(Karachi, Sindh, Pakistan\) and not remote/.test(why), why);
  for (const f of [tmpDb3, tmpDb3 + '-wal', tmpDb3 + '-shm', f4]) fs.rmSync(f, { force: true });

  // ---------- 4d. Extra sources: Google, posts, alert emails, RSS -> extract-jobs.js (offline, canned Claude answers) ----------
  const X = require(path.join(ROOT, 'scripts', 'extract-jobs.js'));
  const rss = `<feed><entry><title type="html">&lt;b&gt;HR Manager&lt;/b&gt; - Lahore</title>
    <link href="https://www.google.com/url?rct=j&amp;sa=t&amp;url=https://brightco.pk/jobs/hr-manager&amp;ct=ga"/>
    <content type="html">We are hiring an HR Manager</content></entry></feed>`;
  const feedItems = X.parseRss(rss);
  check('extract: Google Alerts RSS link unwrapped to the real page', feedItems.length === 1 && feedItems[0].url === 'https://brightco.pk/jobs/hr-manager' && feedItems[0].title === 'HR Manager - Lahore', JSON.stringify(feedItems));
  const email = { subject: 'New jobs for you', html: `
    <a href="https://www.rozee.pk/job/hr-manager-lahore-123?utm_source=alert">HR Manager - Lahore</a>
    <a href="https://www.linkedin.com/comm/jobs/view/999">Head of HR</a>
    <a href="https://www.rozee.pk/unsubscribe?x=1">Unsubscribe</a>
    <a href="https://www.rozee.pk/">Rozee.pk</a>` };
  const eLinks = X.linksFromEmail(email);
  check('extract: alert email -> job links only (tracking stripped, unsubscribe ignored)',
    eLinks.some(l => l.url === 'https://www.rozee.pk/job/hr-manager-lahore-123') && !eLinks.some(l => /unsubscribe|rozee\.pk\/$/.test(l.url)), JSON.stringify(eLinks.map(l => l.url)));

  const tmpDb4 = path.join(os.tmpdir(), `autojob-test4-${Date.now()}.db`);
  const env4 = { ...env2, JOBS_DB: tmpDb4, EXTRACT_NO_FETCH: '1' };
  writeCfg({ limits: { maxApplicationsPerDay: 0 }, matching: { minScore: 0 } });
  // An already-known page must be skipped before any extraction work.
  const known = path.join(os.tmpdir(), `autojob-known-${Date.now()}.json`);
  fs.writeFileSync(known, JSON.stringify([mk('K1', 'HR Manager', { url: 'https://known.pk/job/1', applyUrl: 'https://known.pk/job/1' })]));
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'jobsdb.js'), 'import', known], { env: env4 });
  const found5 = path.join(os.tmpdir(), `autojob-found5-${Date.now()}.json`);
  fs.writeFileSync(found5, JSON.stringify([
    mk('J1', 'HR Manager'),                                                          // a normal job: ignored by extract
    { _candidate: true, kind: 'google', url: 'https://acme.pk/careers/hr-manager', title: 'HR Manager - Acme', snippet: 'Lahore' },
    { _candidate: true, kind: 'google', url: 'https://news.pk/article/hr-trends', title: 'HR trends 2026', snippet: 'news' },
    { _candidate: true, kind: 'google', url: 'https://pk.indeed.com/viewjob?jk=1', title: 'HR Manager', snippet: '' },
    { _candidate: true, kind: 'google', url: 'https://known.pk/job/1', title: 'HR Manager', snippet: '' },
    { _candidate: true, kind: 'post', url: 'https://www.linkedin.com/posts/acme-1', title: 'We are hiring', text: 'Hiring HR Business Partner, Lahore. Email hr@acme.pk', author: 'Sara' },
    { _candidate: true, kind: 'google', url: 'https://cheap.pk/jobs/hr', title: 'HR Officer', snippet: '' },
  ]));
  const emails5 = path.join(os.tmpdir(), `autojob-emails5-${Date.now()}.json`);
  fs.writeFileSync(emails5, JSON.stringify([email]));
  const fake = path.join(os.tmpdir(), `autojob-fake-${Date.now()}.json`);
  fs.writeFileSync(fake, JSON.stringify({
    'https://acme.pk/careers/hr-manager': { isJobPosting: true, title: 'HR Manager', company: 'Acme', location: 'Lahore, Pakistan', salaryText: 'PKR 250,000 per month', email: '', applyUrl: '', description: hrDesc },
    'https://www.linkedin.com/posts/acme-1': { isJobPosting: true, title: 'HR Business Partner', company: 'Acme', location: 'Lahore', salaryText: '', email: 'hr@acme.pk', applyUrl: '', description: hrDesc },
    'https://www.rozee.pk/job/hr-manager-lahore-123': { isJobPosting: true, title: 'Head of HR', company: 'Rozee Co', location: 'Karachi', remote: true, salaryText: '', email: '', applyUrl: '', description: hrDesc },
    'https://cheap.pk/jobs/hr': { isJobPosting: true, title: 'HR Manager', company: 'Cheap', location: 'Lahore', salaryText: 'Rs 60,000 a month', email: '', applyUrl: '', description: hrDesc },
  }));
  const extra5 = path.join(os.tmpdir(), `autojob-extra5-${Date.now()}.json`);
  const xs = JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'extract-jobs.js'), found5, emails5, extra5], { env: { ...env4, EXTRACT_FAKE: fake } }).toString().trim().split(/\r?\n/).pop());
  const xjobs = JSON.parse(fs.readFileSync(extra5, 'utf8'));
  const byUrl = u => xjobs.find(j => j.url === u);
  check('extract: Indeed/LinkedIn job pages left to Apify; known page skipped', xs.coveredByApify >= 2 && xs.alreadyKnown === 1, JSON.stringify(xs));
  check('extract: news page discarded as not a job', !byUrl('https://news.pk/article/hr-trends') && xs.notJobs >= 1);
  check('extract: Google job extracted with pay -> passes (250k)', byUrl('https://acme.pk/careers/hr-manager')?.passed === true && byUrl('https://acme.pk/careers/hr-manager')?.salaryMax === 250000);
  check('extract: post keeps the application email', byUrl('https://www.linkedin.com/posts/acme-1')?.contactEmail === 'hr@acme.pk' && byUrl('https://www.linkedin.com/posts/acme-1')?.source === 'post');
  check('extract: remote alert job marked remote', /Remote/.test(byUrl('https://www.rozee.pk/job/hr-manager-lahore-123')?.location || ''));
  check('extract: same pay rule applied (Rs 60,000 -> skipped)', byUrl('https://cheap.pk/jobs/hr')?.passed === false && /Pay below minimum/.test(byUrl('https://cheap.pk/jobs/hr')?.reason));
  const imp5 = JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'jobsdb.js'), 'import', found5, extra5], { env: env4 }).toString().trim().split(/\r?\n/).pop());
  check('library: imports scraped + extracted jobs together, ignores raw leads', imp5.new === 5 && imp5.found === 5, JSON.stringify(imp5));
  // ---------- 4e. Apply to a skipped job you picked (dashboard buttons) ----------
  const mq = path.join(os.tmpdir(), `autojob-manual-${Date.now()}.json`);
  process.env.JOBS_DB = tmpDb4; process.env.MANUAL_QUEUE = mq; process.env.AUTOJOB_CONFIG = tmpCfg;
  delete require.cache[require.resolve(path.join(ROOT, 'scripts', 'jobsdb.js'))];
  const J = require(path.join(ROOT, 'scripts', 'jobsdb.js'));
  const jdb = J.open();
  const skippedRow = jdb.prepare("SELECT key FROM jobs WHERE status = 'Skipped' LIMIT 1").get();
  const queued = J.queueManual(jdb, skippedRow.key, 'tailor');
  const nowStatus = jdb.prepare('SELECT status FROM jobs WHERE key = ?').get(skippedRow.key).status;
  const st14 = J.stats(jdb).daily;
  check('stats: 14 days of applications, oldest first, ending today, adding up to today\'s count',
    st14.length === 14 && st14[13].day === new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }) && st14[0].day < st14[13].day &&
    st14[13].applied === J.stats(jdb).today.applied);
  const matchedView = J.list(jdb, { status: 'Matched' }), allView = J.list(jdb, {});
  check('library: Matched view hides skipped jobs, All shows them',
    matchedView.length > 0 && matchedView.every(j => j.status !== 'Skipped') && allView.some(j => j.status === 'Skipped'));
  check('manual apply: skipped job queued with chosen mode, marked Processing', queued.tailorMode === 'tailor' && queued.dedupKey === skippedRow.key && nowStatus === 'Processing' && fs.existsSync(mq));
  let dup = null; try { J.queueManual(jdb, skippedRow.key, 'master'); } catch (e) { dup = e.message; }
  check('manual apply: same job cannot be queued twice while in progress', /already processing/.test(dup || ''), dup);
  let badMode = null; try { J.queueManual(jdb, skippedRow.key, 'other'); } catch (e) { badMode = e.message; }
  check('manual apply: only master or tailor modes', /mode must be/.test(badMode || ''));
  const taken = J.takeManual();
  check('manual apply: workflow takes the queue once, then it is empty', taken.length === 1 && taken[0].tailorMode === 'tailor' && !fs.existsSync(mq) && J.takeManual().length === 0);
  // n8n run failed before recording the job: it must not stay stuck in Processing
  const failedN = J.failIfProcessing(jdb, skippedRow.key);
  const afterFail = jdb.prepare('SELECT status FROM jobs WHERE key = ?').get(skippedRow.key).status;
  check('manual apply: failed run -> job Failed, can be picked again', failedN === 1 && afterFail === 'Failed' && J.queueManual(jdb, skippedRow.key, 'master').tailorMode === 'master');
  jdb.prepare("UPDATE jobs SET status = 'Emailed' WHERE key = ?").run(skippedRow.key);
  check('manual apply: a recorded job is left alone and the queue is cleared', J.failIfProcessing(jdb, skippedRow.key) === 0 && !fs.existsSync(mq));

  // ---------- 4g. A job you add yourself (pasted text / screenshot), then a rewritten resume you approve ----------
  const addDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autojob-add-'));
  fs.writeFileSync(path.join(addDir, 'post.txt'), 'We are hiring an HR Manager in Lahore...');
  const addFake = path.join(addDir, 'fake.json');
  const addJob = answer => {
    fs.writeFileSync(addFake, JSON.stringify(answer));
    return JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'add-job.js'), addDir],
      { env: { ...process.env, JOBS_DB: tmpDb4, AUTOJOB_CONFIG: tmpCfg, ADDJOB_FAKE: addFake } }).toString().trim().split(/\r?\n/).pop());
  };
  const goodPost = { isJobPosting: true, title: 'HR Manager', company: 'Pasted Co', location: 'Lahore', salaryText: 'PKR 250,000 per month', email: 'jobs@pasted.pk', applyUrl: '', description: hrDesc };
  const added = addJob(goodPost);
  check('add job: read, scored and saved like a scraped job', added.ok && added.key.startsWith('added|') && added.status === 'Pending' && Number.isFinite(added.score) && added.contactEmail === 'jobs@pasted.pk', JSON.stringify(added));
  const again = addJob(goodPost);
  check('add job: the same post added twice is not a new job', again.ok && again.duplicate && again.key === added.key, JSON.stringify(again));
  const notJob = addJob({ isJobPosting: false, title: '' });
  check('add job: something that is not a job post is refused', !notJob.ok && /does not look like a job post/.test(notJob.error));
  const lowPay = addJob({ ...goodPost, company: 'Low Pay Co', salaryText: 'Rs 60,000 a month' });
  check('add job: same rules as the daily run (Rs 60,000 -> skipped)', lowPay.ok && lowPay.status === 'Skipped' && /Pay below minimum/.test(lowPay.reason), JSON.stringify(lowPay));
  // Rewritten resume waiting for your OK: "send" uses exactly the approved PDF + email, with no new Claude run.
  let notReview = null; try { J.queueManual(jdb, added.key, 'reviewed'); } catch (e) { notReview = e.message; }
  check('review: a job without a rewritten resume cannot be sent as reviewed', /no rewritten resume/.test(notReview || ''));
  const slugName = String(cfg.candidate.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  fs.writeFileSync(path.join(addDir, `${slugName}-resume.pdf`), '%PDF-1.4 test');
  fs.writeFileSync(path.join(addDir, 'email.json'), JSON.stringify({ subject: 'Approved subject', body: 'Approved body' }));
  J.mark(jdb, { key: added.key, status: 'Review', resumeType: 'tailored', folder: addDir });
  const approved = J.queueManual(jdb, added.key, 'reviewed');
  J.takeManual();
  const jobFile = path.join(addDir, 'job.json'); fs.writeFileSync(jobFile, JSON.stringify(approved));
  const sent = JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'tailor.js'), jobFile]).toString().trim().split(/\r?\n/).pop());
  check('review: approved resume and email are sent as they are', sent.ok && sent.folder === addDir && sent.emailSubject === 'Approved subject' && sent.emailBody === 'Approved body' && path.basename(sent.pdfPath) === `${slugName}-resume.pdf`, JSON.stringify(sent));
  fs.rmSync(addDir, { recursive: true, force: true });
  // "I've applied" on an Apply-by-hand job: still counted as applied, no longer "to apply by hand", never re-applied.
  J.mark(jdb, { key: lowPay.key, status: 'Apply manually' });
  const before = J.stats(jdb).all;
  J.mark(jdb, { key: lowPay.key, status: 'Applied by hand' });
  const after = J.stats(jdb).all;
  let reapply = null; try { J.queueManual(jdb, lowPay.key, 'master'); } catch (e) { reapply = e.message; }
  check('applied by hand: moves from "to apply" to "applied by you", total unchanged, cannot be re-applied',
    after.manual === before.manual - 1 && after.byHand === before.byHand + 1 && after.applied === before.applied && /already applied by hand/.test(reapply || ''), JSON.stringify({ before, after, reapply }));
  jdb.close();
  delete process.env.JOBS_DB; delete process.env.MANUAL_QUEUE; delete process.env.AUTOJOB_CONFIG;
  for (const f of [tmpDb4, tmpDb4 + '-wal', tmpDb4 + '-shm', known, found5, emails5, fake, extra5, tmpCfg, mq]) fs.rmSync(f, { force: true });

  // ---------- 4f. Workflow 3 reuses the daily apply loop exactly ----------
  const wf3 = require(path.join(ROOT, 'n8n', '3-apply-selected.json'));
  const loopNames = ['Tailor Resume (/hiring-panel)', 'Send Application (Gmail)', 'Row: Emailed', 'Record in Tracker + Library'];
  const same = loopNames.every(nm => JSON.stringify(wf3.nodes.find(n => n.name === nm)?.parameters) === JSON.stringify(wf1.nodes.find(n => n.name === nm)?.parameters));
  check('workflow 3: apply steps identical to the daily run (tailor, Gmail, rows, record)', same);
  // Workflow 4 + its queue: "Send now" from the Emails & cover letters tab.
  const wf4 = require(path.join(ROOT, 'n8n', '4-send-email.json'));
  const g4 = name => wf4.nodes.find(n => n.name === name);
  check('workflow 4: reads the queued email, attaches the resume only when asked, records the result',
    wf4.connections['Attach Resume?'].main[0][0].node === 'Read Resume PDF' && wf4.connections['Attach Resume?'].main[1][0].node === 'Send (Gmail)' &&
    g4('Send With Resume (Gmail)').parameters.options.attachmentsUi && !g4('Send (Gmail)').parameters.options.attachmentsUi &&
    wf4.connections['Result'].main[0][0].node === 'Record Result');
  const sq = fs.mkdtempSync(path.join(os.tmpdir(), 'autojob-send-'));
  const sqRun = (...a) => JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'send-queue.js'), ...a], { env: { ...process.env, SEND_QUEUE_DIR: sq } }).toString().trim());
  fs.writeFileSync(path.join(sq, 'send-email.json'), JSON.stringify({ id: 'w1', to: 'hr@acme.pk', subject: 'S', body: 'B', attachment: '' }));
  const taken1 = sqRun('take'), taken2 = sqRun('take');
  sqRun('done', 'b64:' + Buffer.from(JSON.stringify({ ok: true, id: 'w1' })).toString('base64'));
  const sentResult = JSON.parse(fs.readFileSync(path.join(sq, 'send-email-result.json'), 'utf8'));
  check('send queue: an email is taken once (never sent twice) and the result is recorded',
    taken1.length === 1 && taken1[0].to === 'hr@acme.pk' && taken2.length === 0 && sentResult.ok && sentResult.id === 'w1');
  fs.rmSync(sq, { recursive: true, force: true });
  const rec = wf1.nodes.find(n => n.name === 'Record in Tracker + Library');
  check('record: library marked before Excel, run continues if Excel is locked',
    rec.parameters.command.indexOf('jobsdb.js') < rec.parameters.command.indexOf('tracker.js') && rec.onError === 'continueRegularOutput');
  // Your copy of each resume: "<Name> - <Company>.pdf", unsafe file-name characters removed, a second job at the same company kept.
  const copyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autojob-copies-'));
  process.env.RESUME_COPY_DIR = copyDir;
  const { saveResumeCopy } = require(path.join(ROOT, 'scripts', 'resume-copy.js'));
  const srcPdf = path.join(copyDir, 'src.pdf'); fs.writeFileSync(srcPdf, '%PDF test');
  const c1 = saveResumeCopy(srcPdf, 'Sam Khan', 'TUV Austria'), c2 = saveResumeCopy(srcPdf, 'Sam Khan', 'TUV Austria');
  const c3 = saveResumeCopy(srcPdf, 'Sam Khan', 'A/B: Co. Ltd.');
  check('resume copy: named "Name - Company.pdf", second job at the same company kept, unsafe characters removed',
    path.basename(c1) === 'Sam Khan - TUV Austria.pdf' && path.basename(c2) === 'Sam Khan - TUV Austria (2).pdf' && path.basename(c3) === 'Sam Khan - A B Co. Ltd.pdf',
    [c1, c2, c3].map(f => f && path.basename(f)).join(' | '));
  check('resume copy: a failed copy never throws', saveResumeCopy(path.join(copyDir, 'missing.pdf'), 'Sam Khan', 'X') === null);
  delete process.env.RESUME_COPY_DIR; fs.rmSync(copyDir, { recursive: true, force: true });
  const tailorSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'tailor.js'), 'utf8');
  check('tailor: Claude can only read/write inside the job folder', /'Read\(\.\/\*\*\),Edit\(\.\/\*\*\),/.test(tailorSrc) && !/Write\(/.test(tailorSrc) && !/'Read,/.test(tailorSrc));
  check('workflow 3: starts from the chosen job, ends after the loop', wf3.connections['Read Chosen Job'] && wf3.connections['Loop Jobs (one at a time)'].main[0].length === 0);

  // ---------- 5. Tracker row + Excel append/update (temp file) ----------
  const job = { ...norm.find(j => j.jobId === 'I3'), dedupKey: 'indeed|I3', score: 84, tailor: { ok: true, pdfPath: 'C:\\x\\resume.pdf', resumeType: 'master' } };
  const rowRes = await runEach(wf1, 'Row: Emailed', { threadId: 'T123' }, { 'Parse Tailor Result': [job] });
  check('row: Emailed status + thread id', rowRes.json.row.Status === 'Emailed' && rowRes.json.row['Gmail Thread ID'] === 'T123');
  check('row: records match score + resume type', rowRes.json.row['Match Score'] === 84 && rowRes.json.row['Resume Type'] === 'Master (as-is)');
  const libUpd = JSON.parse(Buffer.from(rowRes.json.libB64, 'base64').toString());
  check('row: library update carries status + resume type', libUpd.key === 'indeed|I3' && libUpd.status === 'Emailed' && libUpd.resumeType === 'master');
  const rowFailSend = await runEach(wf1, 'Row: Emailed', { error: { message: 'quota' } }, { 'Parse Tailor Result': [job] });
  check('row: Gmail error -> Failed', rowFailSend.json.row.Status === 'Failed');
  const tmp = path.join(os.tmpdir(), `autojob-test-${Date.now()}.xlsx`);
  const env = { ...process.env, TRACKER_FILE: tmp };
  const tr = (...a) => JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'tracker.js'), ...a], { env }).toString());
  tr('init');
  check('excel: append via b64', tr('append', 'b64:' + rowRes.json.b64).appended === 1);
  const patch = Buffer.from(JSON.stringify({ key: 'indeed|I3', Status: 'Reply received', 'Reply Summary': 'Interview Tue' })).toString('base64');
  check('excel: update via b64', tr('update', 'b64:' + patch).updated === 1);
  const listed = tr('list');
  check('excel: row persisted & updated', listed.length === 1 && listed[0].Status === 'Reply received' && listed[0]['Contact Email'] === 'hr@absolute.com.pk');
  fs.unlinkSync(tmp);
  // A tracker made before Match Score / Resume Type existed: new columns are added and values land under the right header.
  const ExcelJS = require(path.join(ROOT, 'node_modules', 'exceljs'));
  const oldWb = new ExcelJS.Workbook();
  oldWb.addWorksheet('Applications').addRow(['Applied On', 'Source', 'Dedup Key', 'Title', 'Company', 'Status']);
  await oldWb.xlsx.writeFile(tmp);
  tr('append', 'b64:' + rowRes.json.b64);
  const oldRows = tr('list');
  check('excel: old tracker gets new columns, values in the right place',
    oldRows.length === 1 && oldRows[0]['Match Score'] === 84 && oldRows[0]['Resume Type'] === 'Master (as-is)' && oldRows[0].Status === 'Emailed' && oldRows[0]['Dedup Key'] === 'indeed|I3', JSON.stringify(oldRows[0]));
  fs.unlinkSync(tmp);

  // ---------- 5. Reply watcher: matching ----------
  const trk2 = [
    { 'Dedup Key': 'indeed|I3', Company: 'Absolute Resource Management', Title: 'Senior Manager HR', 'Contact Email': 'hr@absolute.com.pk', 'Gmail Thread ID': 'T123', 'Resume PDF': 'C:\\apps\\a\\resume.pdf', Notes: '' },
    { 'Dedup Key': 'linkedin|C1', Company: 'Combined Fabrics', Title: 'HR Manager', 'Contact Email': '', 'Gmail Thread ID': '', Notes: '' },
    { 'Dedup Key': 'linkedin|P5', Company: 'Packages Limited', Title: 'HR Business Partner', 'Contact Email': '', 'Gmail Thread ID': '', Notes: '' },
    { 'Dedup Key': 'linkedin|L4', Company: 'Reckitt', Title: 'Head of Key Accounts', 'Contact Email': '', 'Gmail Thread ID': '', Notes: '' },
    { 'Dedup Key': 'linkedin|L9', Company: 'Systems Limited', Title: 'Lead Engineer', 'Contact Email': '', 'Gmail Thread ID': '', Notes: 'msg:OLD1 (other)' },
  ];
  const msg = (id, threadId, address, subject) => ({ id, threadId, from: { value: [{ address, name: 'HR' }] }, subject, text: 'Hello' });
  const mail = [
    msg('M1', 'T123', 'someone@other.com', 'Re: Application'),            // thread match
    msg('M2', 'X', 'talent@reckitt.com', 'Your application'),             // company domain match
    msg('M3', 'Y', 'friend@gmail.com', 'Weekend plans'),                  // unrelated
    msg('M4', 'Z', 'recruiter@gmail.com', 'Systems Limited - next steps'), // company in subject
    msg('OLD1', 'Z', 'hr@systemsltd.com', 'Systems Limited'),             // already handled
    msg('M6', 'Q', cfg.candidate.email, 'Re: Application'),               // own email
    msg('M7', 'R', 'careers@packages.com.pk', 'Interview'),               // .com.pk domain -> "packages", not "com"
  ];
  const matched = (await runAll(wf2, 'Match to Application', [], {
    'Read Config': [{ stdout: JSON.stringify(cfg) }], 'Read Tracker (Excel)': [{ stdout: JSON.stringify(trk2) }],
    'New Gmail Message': mail })).map(i => i.json);
  const mm = Object.fromEntries(matched.map(m => [m.messageId, m.row['Dedup Key']]));
  check('reply: thread-id match', mm.M1 === 'indeed|I3');
  check('reply: company-domain match', mm.M2 === 'linkedin|L4');
  check('reply: company-name-in-subject match', mm.M4 === 'linkedin|L9');
  check('reply: .com.pk sender matched to its company, not "Combined Fabrics"', mm.M7 === 'linkedin|P5', mm.M7);
  check('reply: unrelated / own / already-handled ignored', !('M3' in mm) && !('M6' in mm) && !('OLD1' in mm), JSON.stringify(mm));
  check('reply: resume folder derived', matched.find(m => m.messageId === 'M1')?.job.folder === 'C:\\apps\\a');

  // ---------- 6. Reply watcher: draft parsing + reminder time ----------
  const m1 = matched.find(m => m.messageId === 'M1');
  const good = await runEach(wf2, 'Parse Draft + Pick Reminder Time',
    { stdout: 'noise\n' + JSON.stringify({ ok: true, intent: 'interview_invite', summary: 'Interview Tue 3pm', replyBody: 'Thank you...' }) },
    { 'Match to Application': [m1] });
  const st = DateTime.fromISO(good.json.start).setZone('Asia/Karachi');
  check('draft: parsed intent + reply', good.json.intent === 'interview_invite' && good.json.replyBody === 'Thank you...');
  check('draft: reminder in working hours 09-18 PKT', st.hour >= 9 && st.hour < 18, st.toISO());
  check('draft: 30-min event', DateTime.fromISO(good.json.end).diff(DateTime.fromISO(good.json.start), 'minutes').minutes === 30);
  const bad = await runEach(wf2, 'Parse Draft + Pick Reminder Time', { stdout: 'garbage' }, { 'Match to Application': [m1] });
  check('draft: Claude failure -> fallback template with [FILL]', /\[FILL/.test(bad.json.replyBody));

  // ---------- 7. Daily report ----------
  const rep = await runAll(wf1, 'Build Daily Report', [], {
    'Library Stats': [{ stdout: JSON.stringify({ pending: 7, all: { unique: 40, applied: 9, tailored: 6, asIs: 3, replies: 1 } }) }],
    'Add to Job Library (score + dedup)': [{ stdout: JSON.stringify({ found: 30, new: 22, duplicates: 8, passed: 12, skipped: 10 }) }],
    'Load Config': [cfg], 'Budget Guard + Plan Scrapes': [{ apifyUsedUsd: 0.42 }],
    'Row: Emailed': [rowRes.json], 'Row: Apply Manually': [{ row: { ...rowRes.json.row, Status: 'Apply manually' } }] });
  const body = rep[0].json.body;
  check('report: counts + apify spend', /1 emailed, 1 to apply manually/.test(rep[0].json.subject) && /\$0\.42/.test(body));
  check('report: found / matched / pending numbers', /Jobs found today: 30 \(22 new, 8 already seen\)/.test(body) && /Matched your filters: 12/.test(body) && /pending pool: 7/.test(body), body);
  check('report: all-time tailored vs as-is', /6 tailored, 3 master resume as-is/.test(body));
  check('report: each line shows score + resume type', /\[84\/100, Master \(as-is\)\]/.test(body));

  // ---------- Cover letter: attached next to the resume as a second PDF ----------
  {
    const run = all => new AsyncFn('$input', codeOf(wf1, 'Attach Files'))({ all: () => all });
    const file = name => ({ json: { n: name }, binary: { data: { fileName: name } } });
    const both = await run([file('sam-khan-cover-letter.pdf'), file('sam-khan-resume.pdf')]);
    check('cover letter: resume + cover letter become one email with two attachments',
      both.length === 1 && both[0].binary.data.fileName === 'sam-khan-resume.pdf' && both[0].binary.cover.fileName === 'sam-khan-cover-letter.pdf');
    const one = await run([file('sam-khan-resume.pdf')]);
    check('cover letter: older applications without one still send the resume', one.length === 1 && one[0].binary.data && !one[0].binary.cover);
    const wf3 = require(path.join(ROOT, 'n8n', '3-apply-selected.json'));
    check('cover letter: daily run and Apply-selected both go Read -> Attach Files -> Gmail',
      [wf1, wf3].every(w => w.connections['Read Resume PDF'].main[0][0].node === 'Attach Files' && w.connections['Attach Files'].main[0][0].node === 'Send Application (Gmail)'));
  }

  // ---------- 8. Dashboard avatar states ----------
  {
    const el = () => ({ dataset: {}, setAttribute() {}, prepend() {}, querySelector: () => ({}), set innerHTML(v) {} });
    const win = { document: { getElementById: el, createElement: el } };
    win.window = win;
    require('vm').runInNewContext(fs.readFileSync(path.join(ROOT, 'dashboard', 'public', 'avatar', 'avatar.js'), 'utf8'), win);
    const st = win.avatarStateOf;
    check('avatar: find -> searching, added job read -> reading', st({ run: { running: true, stage: 'find' } }) === 'search' && st({ run: {}, adding: { stage: 'reading' } }) === 'review');
    check('avatar: tailor/apply-yourself -> tailoring, send -> sending', st({ run: { running: true, stage: 'tailor' } }) === 'tailor' && st({ run: {}, applying: { key: 'k' } }) === 'tailor' && st({ run: { running: true, stage: 'send' } }) === 'send');
    check('avatar: nothing running -> idle', st({ run: { running: false, stage: 'tailor' } }) === 'idle' && st(null) === 'idle');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e); process.exit(1); });

