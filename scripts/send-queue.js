#!/usr/bin/env node
// Hand-off between the dashboard's "Send now" and n8n workflow 4 (Gmail lives in n8n).
//   node scripts/send-queue.js take              print the queued email as a 1-item JSON array, and clear the queue
//   node scripts/send-queue.js done <b64:json>   record the Gmail result for the dashboard
// Env: SEND_QUEUE_DIR (tests)
const fs = require('fs');
const path = require('path');

const DIR = process.env.SEND_QUEUE_DIR || path.join(__dirname, '..', 'applications', '_queue');
const QUEUE = path.join(DIR, 'send-email.json'), RESULT = path.join(DIR, 'send-email-result.json');

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'take') {
  const job = fs.existsSync(QUEUE) ? JSON.parse(fs.readFileSync(QUEUE, 'utf8')) : null;
  fs.rmSync(QUEUE, { force: true });
  console.log(JSON.stringify(job ? [job] : []));
} else if (cmd === 'done') {
  const r = JSON.parse(Buffer.from(String(arg).replace(/^b64:/, ''), 'base64').toString('utf8'));
  fs.writeFileSync(RESULT, JSON.stringify({ ...r, at: Date.now() }));
  console.log(JSON.stringify({ ok: true }));
} else {
  console.error('usage: send-queue.js take | done <b64:json>');
  process.exit(1);
}
