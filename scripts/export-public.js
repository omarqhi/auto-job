#!/usr/bin/env node
// Builds the public copy of Auto Job in another folder: code, skills and docs only.
// Nothing personal is copied. Files come from the allow-list below, config.json is rewritten as config.example.json with
// the candidate blanked, and the result is scanned for the candidate's details (plus any terms in export-deny.txt, one per
// line). A single hit stops the export with exit code 1.
//   node scripts/export-public.js <target folder>      (an existing .git folder in the target is kept)

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const target = path.resolve(process.argv[2] || '');
if (!process.argv[2] || target === ROOT || target.startsWith(ROOT + path.sep)) {
  console.error('usage: node scripts/export-public.js <target folder outside this project>');
  process.exit(1);
}

const FILES = ['README.md', 'SETUP.md', 'LICENSE', '.gitignore', 'package.json', 'package-lock.json', 'setup.ps1', 'Auto Job.cmd',
  'apply-selected.ps1', 'run-now.ps1', 'send-email.ps1', 'start-dashboard.ps1', 'start-n8n.ps1', 'resume/master-resume.example.md'];
// folder -> files inside it to leave out (path relative to the folder, forward slashes)
const DIRS = {
  dashboard: /^(state\.json|demo-[^/]*|public\/film\.html)$/,                          // run state, generated demo data, the film driver
  scripts: /^((check|install)-(studio|ponytail)\.ps1|record-[^/]*\.mjs|push-public\.ps1)$/,   // tooling only this PC has
  tests: null, docs: null, '.claude/skills/interview-prep': null,
};
const USER_SKILLS = ['hiring-panel', 'humanizer'];   // third-party (MIT), installed in ~/.claude/skills; shipped so tailoring works after setup.ps1

// 1. empty the target, keeping its git history
fs.mkdirSync(target, { recursive: true });
for (const f of fs.readdirSync(target)) if (f !== '.git') fs.rmSync(path.join(target, f), { recursive: true, force: true });

// 2. copy the allow-list
const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.cpSync(from, to, { recursive: true }); };
for (const f of FILES) copy(path.join(ROOT, f), path.join(target, f));
for (const [dir, skip] of Object.entries(DIRS)) {
  const src = path.join(ROOT, dir);
  if (!fs.existsSync(src)) continue;
  fs.cpSync(src, path.join(target, dir), { recursive: true,
    filter: f => !skip || !skip.test(path.relative(src, f).split(path.sep).join('/')) });
}
for (const s of USER_SKILLS) copy(path.join(os.homedir(), '.claude', 'skills', s), path.join(target, '.claude', 'skills', s));

// 3. example config: same settings, no person
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const me = cfg.candidate;
cfg.candidate = { ...me, name: 'Your Name', email: 'you@example.com', phone: '+00-000-000-0000', linkedin: 'linkedin.com/in/your-profile', degreeNote: '' };
fs.writeFileSync(path.join(target, 'config.example.json'), JSON.stringify(cfg, null, 2) + '\n');

// 4. scan every exported file for personal details
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const word = s => `\\b${esc(s)}\\b`;
const denyFile = path.join(ROOT, 'export-deny.txt');
const terms = [
  word(me.name), ...String(me.name).split(/\s+/).filter(w => w.length >= 4).map(word),
  esc(String(me.name).trim().toLowerCase().replace(/\s+/g, '-')),                       // file-name form, e.g. first-last-resume.pdf
  esc(me.email), word(String(me.email).split('@')[0]),
  String(me.phone || '').replace(/\D/g, '').split('').map(esc).join('[-\\s().]*'),      // the digits, however they are spaced
  esc(String(me.linkedin || '').split('/').filter(Boolean).pop() || ''),
  word(os.userInfo().username),
  ...(fs.existsSync(denyFile) ? fs.readFileSync(denyFile, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(esc) : []),
].filter(t => t.replace(/\\b/g, '').length >= 4);
const personal = new RegExp(terms.join('|'), 'i');
// Public addresses that may contain a term (the GitHub username is part of the repository's own links): export-allow.txt, one per line.
const allowFile = path.join(ROOT, 'export-allow.txt');
const allowed = fs.existsSync(allowFile) ? fs.readFileSync(allowFile, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(Boolean) : [];
const strip = line => allowed.reduce((l, a) => l.split(a).join(''), line);

const hits = [];
let count = 0;
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '.git') walk(f); continue; }
    count++;
    fs.readFileSync(f, 'latin1').split('\n').forEach((line, i) => {
      const m = personal.exec(strip(line));
      if (m) hits.push(`${path.relative(target, f)}:${i + 1}  "${m[0]}"`);
    });
  }
})(target);

if (hits.length) {
  console.error(`STOPPED: personal details found in ${hits.length} place(s). Fix the source, then export again.\n` + hits.slice(0, 40).join('\n'));
  process.exit(1);
}
console.log(`Exported ${count} files to ${target}. No personal details found.`);
