#!/usr/bin/env node
// Excel application tracker (tracker/applications.xlsx).
//   node scripts/tracker.js init                 create the workbook if missing
//   node scripts/tracker.js list                 print all rows as JSON array
//   node scripts/tracker.js append <rows.json>   append row object(s)
//   node scripts/tracker.js update <patch.json>  {"key": "<Dedup Key>", ...fields} - update matching row(s)
//   (<rows.json>/<patch.json> may also be "b64:<base64 JSON>")

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const ROOT = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const FILE = process.env.TRACKER_FILE || path.resolve(ROOT, config.paths.tracker);   // TRACKER_FILE: used by tests

const COLUMNS = [
  ['Applied On', 12], ['Source', 10], ['Job ID', 14], ['Dedup Key', 30], ['Title', 38], ['Company', 26],
  ['Location', 22], ['Salary (listed)', 26], ['Salary PKR/mo', 14], ['Seniority', 16], ['Job URL', 40],
  ['Contact Email', 28], ['Status', 16], ['Resume PDF', 40], ['Gmail Thread ID', 20], ['Reply Received', 14],
  ['Reply Summary', 40], ['Calendar Event', 20], ['Notes', 40], ['Match Score', 12], ['Resume Type', 14],
];

// Older workbooks may lack newer columns: add any missing headers at the end (never reorder existing ones).
function ensureColumns(ws) {
  const have = ws.getRow(1).values.slice(1);
  for (const [h, width] of COLUMNS) {
    if (have.includes(h)) continue;
    const c = have.length + 1;
    ws.getRow(1).getCell(c).value = h;
    ws.getColumn(c).width = width;
    have.push(h);
  }
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
  return have;
}

async function load() {
  const wb = new ExcelJS.Workbook();
  if (fs.existsSync(FILE)) { await wb.xlsx.readFile(FILE); return wb; }
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const ws = wb.addWorksheet('Applications', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = COLUMNS.map(([header, width]) => ({ header, key: header, width }));
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
  ws.autoFilter = { from: 'A1', to: { row: 1, column: COLUMNS.length } };
  await save(wb);
  return wb;
}

async function save(wb) {
  try { await wb.xlsx.writeFile(FILE); }
  catch (e) {
    if (e.code === 'EBUSY' || e.code === 'EPERM') throw new Error('Tracker is open in Excel - close it so the workflow can write: ' + FILE);
    throw e;
  }
}

function rows(ws) {
  const headers = ws.getRow(1).values.slice(1);
  const list = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const o = {};
    headers.forEach((h, i) => {
      let v = row.getCell(i + 1).value;
      if (v && typeof v === 'object' && 'text' in v) v = v.text;      // hyperlinks
      if (v instanceof Date) v = v.toISOString().slice(0, 10);
      o[h] = v ?? '';
    });
    list.push(o);
  });
  return list;
}

(async () => {
  const [cmd, arg] = process.argv.slice(2);
  const wb = await load();
  const ws = wb.getWorksheet('Applications');
  // arg is a JSON file path, or "b64:<base64 JSON>" when called inline from n8n
  const readArg = () => JSON.parse(arg.startsWith('b64:')
    ? Buffer.from(arg.slice(4), 'base64').toString('utf8')
    : fs.readFileSync(arg, 'utf8'));

  if (cmd === 'init') { console.log(JSON.stringify({ ok: true, file: FILE })); return; }
  if (cmd === 'list') { console.log(JSON.stringify(rows(ws))); return; }

  if (cmd === 'append') {
    let data = readArg(); if (!Array.isArray(data)) data = [data];
    const headers = ensureColumns(ws);
    for (const r of data) ws.addRow(headers.map(h => r[h] ?? ''));
    await save(wb);
    console.log(JSON.stringify({ ok: true, appended: data.length }));
    return;
  }

  if (cmd === 'update') {
    const patch = readArg();
    const headers = ensureColumns(ws);
    const keyCol = headers.indexOf('Dedup Key') + 1;
    let n = 0;
    ws.eachRow((row, i) => {
      if (i === 1 || row.getCell(keyCol).value !== patch.key) return;
      for (const [k, v] of Object.entries(patch)) {
        const c = headers.indexOf(k);
        if (c >= 0) row.getCell(c + 1).value = v;
      }
      n++;
    });
    await save(wb);
    console.log(JSON.stringify({ ok: true, updated: n }));
    return;
  }

  console.error('unknown command'); process.exit(2);
})().catch(e => { console.log(JSON.stringify({ ok: false, error: e.message })); process.exit(1); });
