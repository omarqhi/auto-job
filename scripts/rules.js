// Pay / seniority / junior-title rules for jobs that don't come through the n8n Normalize node
// (Google results, LinkedIn posts, job alerts). Mirrors that node's logic exactly; tests/offline-test.js checks parity.

function makeRules(f) {
  const senior = new RegExp(f.seniorTitlePattern, 'i');
  const exclude = new RegExp(f.excludeTitlePattern, 'i');
  const PER_MONTH = { HOUR: 173, DAY: 22, WEEK: 4.33, MONTH: 1, YEAR: 1 / 12 };
  const FX = { PKR: 1, USD: f.usdToPkr, EUR: f.usdToPkr * 1.08, GBP: f.usdToPkr * 1.27, AED: f.usdToPkr / 3.67, SAR: f.usdToPkr / 3.75 };
  const monthly = (amt, unit, cur) => amt == null ? null : Math.round(amt * (PER_MONTH[unit] ?? 1) * (FX[cur] ?? 1));

  function parseSalaryText(s) {
    if (!s) return null;
    const cur = /PKR|Rs\.?|₨/i.test(s) ? 'PKR' : /USD|\$/.test(s) ? 'USD' : /EUR|€/.test(s) ? 'EUR'
              : /GBP|£/.test(s) ? 'GBP' : /AED/i.test(s) ? 'AED' : /SAR/i.test(s) ? 'SAR' : 'PKR';
    const unit = /(\bhr\b|hour)/i.test(s) ? 'HOUR' : /\bday/i.test(s) ? 'DAY' : /(\bwk\b|week)/i.test(s) ? 'WEEK'
               : /(\byr\b|year|annum|annual|\bpa\b)/i.test(s) ? 'YEAR' : 'MONTH';
    const nums = [...s.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*([kKmM])?(?![a-zA-Z])/g)].map(m => {
      let n = parseFloat(m[1].replace(/,/g, ''));
      if (/k/i.test(m[2] || '')) n *= 1e3; if (/m/i.test(m[2] || '')) n *= 1e6;
      return n;
    }).filter(n => n >= 10);
    if (!nums.length) return null;
    return { min: monthly(Math.min(...nums), unit, cur), max: monthly(Math.max(...nums), unit, cur) };
  }

  const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  const BAD_EMAIL = /(no-?reply|donotreply|example\.|@linkedin\.|@indeed\.|@google\.|sentry|\.(png|jpe?g|gif|svg)$)/i;
  const findEmail = text => ((text || '').match(EMAIL_RE) || []).map(e => e.replace(/\.$/, '')).find(e => !BAD_EMAIL.test(e)) || '';

  // Same decision as the Normalize node: listed pay (top of range) >= minimum, or no pay but a senior role; never junior titles.
  function apply(j) {
    const isSenior = senior.test(j.title) || (f.seniorLevels || []).includes(j.level);
    const hasPay = j.salaryMax != null;
    j.seniority = (f.seniorLevels || []).includes(j.level) ? j.level : isSenior ? 'Senior (title)' : (j.level || '');
    if (!j.contactEmail) j.contactEmail = findEmail(j.description);
    if (exclude.test(j.title)) { j.passed = false; j.reason = 'Junior or entry-level title'; }
    else if (hasPay && j.salaryMax < f.minMonthlyPkr) { j.passed = false; j.reason = `Pay below minimum (Rs ${j.salaryMax.toLocaleString('en-PK')} a month)`; }
    else if (!hasPay && !isSenior) { j.passed = false; j.reason = 'No pay listed and not a senior role'; }
    else { j.passed = true; j.reason = ''; }
    return j;
  }

  return { parseSalaryText, findEmail, apply, monthly };
}

// Does the posting ask for an HR degree (MBA / BBA / Masters in HR or HRM)? Used to add an honest degree line to the cover email.
const HR_DEGREE = /\b(MBA|M\.B\.A|BBA|Masters?|Master'?s|MS|M\.?Phil|post ?graduate|degree|graduate)\b[^.\n]{0,60}\b(HRM|HR|human resources?|personnel management)\b/i;
const asksForHrDegree = text => HR_DEGREE.test(String(text || ''));

module.exports = { makeRules, asksForHrDegree };
