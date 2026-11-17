// One real Claude Haiku extraction on two sample leads (no Apify, no page fetching). Run: node tests/extract-live-check.js
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const tmp = n => path.join(os.tmpdir(), `autojob-live-${Date.now()}-${n}`);
const found = tmp('found.json'), out = tmp('out.json');
fs.writeFileSync(found, JSON.stringify([
  { _candidate: true, kind: 'post', url: 'https://www.linkedin.com/posts/sample-hiring-1', author: 'Ayesha Khan, Talent Acquisition at Nimbus Retail',
    title: 'We are hiring!', text: 'We are hiring an HR Manager for our Lahore head office (Gulberg). 7+ years in HR operations, payroll and employee relations, ' +
    'Zoho People a plus. Salary PKR 220,000 - 260,000 per month. Send your CV to careers@nimbusretail.pk with subject "HR Manager".' },
  { _candidate: true, kind: 'google', url: 'https://example-news.pk/hr-trends-2026', title: '5 HR trends Pakistani companies should watch',
    snippet: 'An article about hybrid work, AI in recruitment and employee wellbeing across Pakistan in 2026.' },
]));
const env = { ...process.env, EXTRACT_NO_FETCH: '1', JOBS_DB: tmp('jobs.db') };
const summary = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'extract-jobs.js'), found, out], { env, timeout: 300000 }).toString().trim();
console.log('summary:', summary);
console.log('jobs:', JSON.stringify(JSON.parse(fs.readFileSync(out, 'utf8')).map(j => ({ title: j.title, company: j.company, location: j.location,
  salaryMax: j.salaryMax, email: j.contactEmail, passed: j.passed, reason: j.reason })), null, 1));
for (const f of [found, out]) fs.rmSync(f, { force: true });
