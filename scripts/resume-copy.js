// A copy of each resume PDF for you, named "<Your Name> - <Company>.pdf", in Downloads\Auto Job Resumes.
// Never throws: a failed copy must not fail the application. Env: RESUME_COPY_DIR (tests).
const fs = require('fs');
const os = require('os');
const path = require('path');

const clean = s => String(s || '').replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 60);

function saveResumeCopy(pdfPath, name, company) {
  try {
    const dir = process.env.RESUME_COPY_DIR || path.join(os.homedir(), 'Downloads', 'Auto Job Resumes');
    fs.mkdirSync(dir, { recursive: true });
    const base = `${clean(name) || 'Resume'} - ${clean(company) || 'Company'}`;
    let file = path.join(dir, base + '.pdf');
    for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `${base} (${n}).pdf`);   // two jobs at one company: keep both
    fs.copyFileSync(pdfPath, file);
    return file;
  } catch { return null; }
}

module.exports = { saveResumeCopy };
