// ATS-style match score (0-100) between a job posting and the master resume. Local, free, deterministic.
//
//   Skills/keywords the posting asks for that the resume has   50
//   Job title fits the titles you search for                   25
//   Seniority fit (manager-level, years asked <= your years)   15
//   Location fit (your city, Pakistan or remote)               10
//
// Used to decide: score >= config.matching.sendAsIsAt  -> send the master resume as-is
//                 below that                          -> tailor with /hiring-panel

// HR-domain terms an ATS would look for. Each entry: canonical name -> patterns that count as a mention.
const TERMS = {
  'recruitment': [/recruit/, /talent acquisition/, /hiring/, /sourcing/],
  'onboarding': [/onboard/, /induction/],
  'offboarding': [/offboard/, /exit interview/, /separation/],
  'payroll': [/payroll/],
  'compensation': [/compensation/, /salary (bands?|structure|review)/, /\bc&b\b/, /rewards?/],
  'benefits': [/benefits?/, /provident fund/, /\beobi\b/, /\bpessi\b/, /medical insurance/],
  'performance management': [/performance (management|review|appraisal|cycle)/, /appraisal/],
  'kpi': [/\bkpis?\b/, /\bokrs?\b/],
  'employee relations': [/employee relations/, /grievance/, /disciplinary/, /disputes?/],
  'pip': [/\bpips?\b/, /performance improvement plan/],
  'policies & sops': [/polic(y|ies)/, /\bsops?\b/, /handbook/],
  'labour law': [/labou?r law/, /employment law/, /legal compliance/, /\bcompliance\b/],
  'hris': [/\bhris\b/, /\bhrms\b/, /zoho people/, /bamboohr/, /workday/, /successfactors/, /oracle hcm/],
  'attendance & leave': [/attendance/, /\bleaves?\b/, /time ?keeping/],
  'workforce planning': [/workforce planning/, /manpower planning/, /headcount/, /organi[sz]ational design/],
  'training & development': [/training/, /learning (and|&) development/, /\bl&d\b/, /upskill/],
  'engagement & culture': [/engagement/, /culture/, /retention/],
  'hr analytics & reporting': [/hr (analytics|metrics|reports?|dashboards?)/, /reporting/, /dashboards?/],
  'stakeholder partnering': [/business partner/, /\bhrbp\b/, /stakeholder/, /department heads?/],
  'call center / bpo': [/call cent(er|re)/, /\bbpo\b/, /contact cent(er|re)/],
  'it / software industry': [/software/, /\bit services\b/, /\bsaas\b/, /tech(nology)? company/],
  'remote / international teams': [/remote/, /international/, /cross[- ]border/, /global teams?/],
  'excel / google sheets': [/excel/, /google sheets/, /spreadsheets?/],
  'english & urdu': [/english/, /urdu/],
};

// Words that describe level, not field. Ignored when comparing job titles.
const GENERIC_TITLE_WORDS = new Set(['senior', 'sr', 'junior', 'jr', 'lead', 'head', 'manager', 'management', 'director',
  'officer', 'executive', 'assistant', 'associate', 'specialist', 'principal', 'chief', 'vp', 'deputy', 'general', 'team']);
// A title that names this field (HR) at all.
const FIELD_TITLE = /\b(hr|human resources?|people|talent|recruit\w*|hrbp|personnel|workforce)\b/i;

const SENIOR_TITLE = /\b(head|manager|lead|director|senior|sr\.?|principal|vp|chief|business partner)\b/i;
const JUNIOR_TITLE = /\b(intern|internship|trainee|junior|jr\.?|assistant|coordinator|officer|executive)\b/i;

function termsIn(text) {
  const t = String(text || '').toLowerCase();
  return Object.keys(TERMS).filter(k => TERMS[k].some(re => re.test(t)));
}

function tokens(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9& ]+/g, ' ').split(/\s+/)
    .filter(w => w && !['of', 'and', 'the', 'for', '&', 'a', 'an', '-'].includes(w));
}

// Years of experience the resume claims ("9+ years") — fall back to 0 if absent.
function resumeYears(resume) {
  const m = String(resume).match(/(\d{1,2})\+?\s*years/i);
  return m ? Number(m[1]) : 0;
}
// Years the posting asks for ("6+ years", "minimum 5 years", "5-7 years").
function yearsAsked(text) {
  const m = String(text || '').match(/(\d{1,2})\s*(?:\+|-\s*\d{1,2})?\s*(?:years|yrs)/i);
  return m ? Number(m[1]) : null;
}

/**
 * @param job     { title, description, location }
 * @param resume  master resume text (markdown)
 * @param opts    { titles: [searched job titles], city: 'Lahore' }
 * @returns { score, parts: {skills, title, seniority, location}, matched: [], missing: [] }
 */
function scoreJob(job, resume, opts = {}) {
  const resumeTerms = new Set(termsIn(resume));
  const asked = termsIn(`${job.title}\n${job.description}`);

  // Skills (50): share of the posting's terms the resume covers.
  // A posting with none of these terms is almost certainly not in this field, so it earns next to nothing.
  const matched = asked.filter(t => resumeTerms.has(t));
  const missing = asked.filter(t => !resumeTerms.has(t));
  // Thin postings (fewer than 5 recognisable terms) can't prove a strong fit, so they are scored out of 5.
  const skills = asked.length ? Math.round(50 * matched.length / Math.max(asked.length, 5)) : 5;

  // Title (25): role words only. "Senior", "Manager", "Head" say nothing about the field
  // (a Sales Manager is not an HR Manager), so they are ignored when comparing titles.
  const domain = s => tokens(s).filter(w => !GENERIC_TITLE_WORDS.has(w))
    .map(w => ['human', 'resources', 'resource', 'people', 'personnel'].includes(w) ? 'hr' : w);
  const jt = new Set(domain(job.title));
  let best = 0;
  for (const want of opts.titles || []) {
    const w = [...new Set(domain(want))];
    if (w.length) best = Math.max(best, w.filter(x => jt.has(x)).length / w.length);
  }
  const fieldSignal = FIELD_TITLE.test(job.title);
  const title = Math.round(fieldSignal ? 15 + 10 * best : 10 * best);

  // Seniority (15): manager-level title, and not asking for more years than the resume has.
  let seniority = SENIOR_TITLE.test(job.title) ? 10 : JUNIOR_TITLE.test(job.title) ? 2 : 6;
  const need = yearsAsked(job.description), have = resumeYears(resume);
  if (need == null || have >= need) seniority += 5;
  else if (have >= need - 2) seniority += 2;
  seniority = Math.min(15, seniority);

  // Location (10)
  const loc = String(job.location || '').toLowerCase();
  const city = String(opts.city || '').toLowerCase();
  const location = city && loc.includes(city) ? 10 : /remote/.test(loc) || /remote/i.test(job.description || '') ? 9
    : /pakistan/.test(loc) ? 6 : loc ? 3 : 5;

  let score = Math.max(0, Math.min(100, skills + title + seniority + location));
  // A junior role is a level mismatch for this resume: never a "strong match" that gets the master resume as-is.
  if (JUNIOR_TITLE.test(job.title) && !SENIOR_TITLE.test(job.title)) score = Math.min(score, 65);
  return { score, parts: { skills, title, seniority, location }, matched, missing };
}

module.exports = { scoreJob, termsIn, TERMS };
