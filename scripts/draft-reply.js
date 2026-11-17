#!/usr/bin/env node
// Draft a reply to an employer email about an application.
// Usage: node scripts/draft-reply.js <incoming.json>
//   incoming.json = { from, subject, text, job: { title, company, folder } }
// Prints one JSON line: { ok, replyBody, summary, intent, error }

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
process.env.PONYTAIL_DEFAULT_MODE = 'off';   // ponytail plugin is for coding sessions, not email replies
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));

function out(o) { process.stdout.write(JSON.stringify(o) + '\n'); process.exit(0); }

try {
  const msg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const resumePath = msg.job && msg.job.folder ? path.join(msg.job.folder, 'resume-final.md') : null;
  const resume = resumePath && fs.existsSync(resumePath) ? fs.readFileSync(resumePath, 'utf8').slice(0, 6000) : '';

  const prompt =
    `You are drafting an email reply for ${config.candidate.name}, who applied for "${msg.job?.title}" at ${msg.job?.company}.\n` +
    `Incoming email from ${msg.from}, subject "${msg.subject}":\n---\n${String(msg.text || '').slice(0, 6000)}\n---\n` +
    (resume ? `Candidate resume for reference:\n---\n${resume}\n---\n` : '') +
    `Respond with ONLY a JSON object, no code fences: {"intent": one of "interview_invite","info_request","rejection","assessment","offer","other", ` +
    `"summary": one sentence describing what the employer wants and any deadline/date, ` +
    `"replyBody": a polite, concise plain-text reply (under 150 words) that the candidate can review and send. ` +
    `If they propose times, accept one generally and ask to confirm; if they ask for info you don't have, write [FILL: ...] for the candidate to complete. ` +
    `Never invent facts. Sign as ${config.candidate.name}.}`;

  const r = spawnSync('claude', ['-p', '--model', 'haiku'], {
    input: prompt, encoding: 'utf8', shell: true, timeout: 5 * 60 * 1000, cwd: ROOT,
  });
  if (r.status !== 0) throw new Error(`claude exited ${r.status}: ${(r.stderr || '').slice(-500)}`);
  const m = r.stdout.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('No JSON in model output');
  const j = JSON.parse(m[0]);
  out({ ok: true, intent: j.intent, summary: j.summary, replyBody: j.replyBody });
} catch (e) {
  out({ ok: false, error: String(e && e.message || e) });
}
