// Builds dashboard/demo-jobs.db with sample jobs so `node dashboard/demo.js` has something to show.
// Never touches data/jobs.db.
const fs = require('fs');
const path = require('path');
process.env.JOBS_DB = path.join(__dirname, 'demo-jobs.db');
process.env.TRACKER_FILE = path.join(__dirname, 'demo-tracker.xlsx');
for (const f of ['', '-wal', '-shm']) fs.rmSync(process.env.JOBS_DB + f, { force: true });
const jobsdb = require('../scripts/jobsdb.js');

const hr = 'Own full-cycle recruitment and onboarding, payroll inputs, performance management and KPIs, employee relations and grievances, HR policies and SOPs, HRIS (Zoho People). ';
const J = (source, jobId, title, company, location, salaryMax, description, passed, reason = '', contactEmail = '') =>
  ({ source, jobId, title, company, location, url: `https://example.com/${jobId}`, applyUrl: `https://example.com/${jobId}`,
     description, salaryRaw: salaryMax ? `PKR ${salaryMax.toLocaleString()} / month` : '', salaryMax, contactEmail, passed, reason });

const jobs = [
  J('linkedin', 'd1', 'HR Manager', 'Northwind Software', 'Lahore, Pakistan', 280000, hr + '7+ years, IT/software company.', true, '', 'careers@example.com'),
  J('indeed', 'd2', 'Head of People', 'Bluepeak Labs', 'Lahore, Pakistan', null, hr + 'Culture, engagement and retention. 8+ years.', true),
  J('linkedin', 'd3', 'HR Business Partner', 'Meridian Systems', 'Karachi, Pakistan', 320000, hr + 'Partner with department heads, labour law, compensation and benefits. 10+ years.', true),
  J('indeed', 'd4', 'HR Operations Manager', 'Callbridge', 'Lahore, Pakistan', 210000, 'Call center HR operations, attendance and leave, payroll, workforce planning, 6+ years.', true),
  J('linkedin', 'd5', 'Senior Manager Talent Acquisition', 'Rideline', 'Karachi, Pakistan', null, 'Lead technical hiring and sourcing, stakeholder management, ATS, employer branding, 8+ years.', true),
  J('linkedin', 'd6', 'Manager Human Resources', 'Telenova', 'Islamabad, Pakistan', 350000, hr + 'Training and development, HR analytics dashboards, 10+ years.', true),
  J('indeed', 'd7', 'HR Officer', 'Small Co', 'Lahore, Pakistan', 70000, 'Recruitment support and attendance.', false, 'Pay below minimum (Rs 70,000 a month)'),
  J('linkedin', 'd8', 'Junior HR Executive', 'Retail Co', 'Lahore, Pakistan', null, 'Filing and onboarding paperwork.', false, 'Junior or entry-level title'),
  J('indeed', 'd9', 'Sales Manager', 'Parcelway', 'Karachi, Pakistan', 100000, 'Meet sales targets.', false, 'Pay below minimum (Rs 100,000 a month)'),
  J('linkedin', 'd10', 'Recruiter', 'Agency', 'Remote', null, 'Source candidates.', false, 'No pay listed and not a senior role'),
];

(async () => {
  const db = jobsdb.open();
  const imp = await jobsdb.importJobs(db, jobs);
  // Make the second import count as repeat sightings.
  await jobsdb.importJobs(db, jobs.slice(0, 4));
  const picked = jobsdb.pick(db);
  const outcomes = [['Emailed', 'master'], ['Apply manually', 'master'], ['Emailed', 'tailored'], ['Reply received', 'tailored']];
  picked.slice(0, 4).forEach((p, i) => {
    jobsdb.mark(db, { key: p.dedupKey, status: outcomes[i][0] === 'Reply received' ? 'Emailed' : outcomes[i][0], resumeType: outcomes[i][1] });
    if (outcomes[i][0] === 'Reply received') jobsdb.mark(db, { key: p.dedupKey, status: 'Reply received' });
  });
  if (picked[4]) jobsdb.mark(db, { key: picked[4].dedupKey, status: 'Pending' });
  console.log('import', JSON.stringify(imp));
  console.log('stats', JSON.stringify(jobsdb.stats(db).all), 'pending', jobsdb.stats(db).pending);
})();
