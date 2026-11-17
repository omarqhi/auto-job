// Auto Job dashboard client. Talks only to the local server (dashboard/server.js).
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Only http(s) links are ever rendered: a job posting could carry a javascript: link.
const webUrl = u => /^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '';
const fileUrl = p => '/files/' + String(p).split('/').map(encodeURIComponent).join('/');
const pkr = n => n == null || n === '' ? null : 'Rs ' + Number(n).toLocaleString('en-PK');
const VIA = { linkedin: 'LinkedIn', indeed: 'Indeed', google: 'Google', post: 'LinkedIn post', alert: 'Google Alert', email: 'job-alert email' };
const via = s => VIA[s] ? `<span class="via">via ${VIA[s]}</span>` : '';
const payShort = n => Number(n) >= 1000 && Number(n) % 1000 === 0 ? `${Number(n) / 1000}k` : Number(n).toLocaleString('en-PK');

async function api(path, opts = {}) {
  const init = { method: opts.method || 'GET', headers: {} };
  if (init.method === 'POST') init.headers['X-AutoJob'] = '1';
  if (opts.json) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.json); }
  if (opts.body) { init.body = opts.body; Object.assign(init.headers, opts.headers || {}); }
  const r = await fetch(path, init);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}

let toastTimer;
function toast(msg, kind = 'ok') {
  const t = $('#toast'); t.textContent = msg; t.dataset.kind = kind; t.dataset.show = 'true';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.dataset.show = 'false'; }, kind === 'error' ? 6000 : 3200);
}

function when(ms) {
  if (!ms) return '';
  const d = new Date(ms), now = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `today at ${time}`;
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ` at ${time}`;
}
function dayLabel(iso) {
  if (!iso) return '';
  const today = new Date().toLocaleDateString('en-CA');
  if (iso === today) return 'Today';
  return new Date(iso + 'T00:00:00').toLocaleDateString([], { day: 'numeric', month: 'short' });
}

/* ------------------------------------------------------------ status: n8n, run, schedule */
let status = null, pollTimer, prevApplying = null;

// Say how the picked job actually ended, not just that the run stopped.
async function finishedToast(done) {
  let job;
  try { job = (await api(`/api/jobs?status=&q=${encodeURIComponent(done.title)}`)).find(j => j.key === done.key); } catch {}
  if (job?.status === 'Failed') toast(`Could not apply to ${done.title}. You can try again from the job library.`, 'error');
  else if (job?.status === 'Apply manually') toast(`Resume ready for ${done.title}. No email in the listing, so apply via the job link.`);
  else if (job?.status === 'Emailed') toast(`Applied: ${done.title} was emailed.`);
  else toast(`Finished: ${done.title}. See its stamp in the job library.`);
}

async function refreshStatus() {
  try { status = await api('/api/status'); }
  catch { status = null; }
  renderStatus();
  clearTimeout(pollTimer);
  const busy = status?.run?.running || status?.schedule?.op?.status === 'working' || status?.n8n === 'starting' || !!status?.applying || addBusy();
  renderAdding();
  // When a job picked from the library finishes, refresh the library and applications so its new stamp shows.
  if (prevApplying && !status?.applying) { finishedToast(prevApplying); loadLibrary(); loadApps(); loadStats(); }
  else if (!prevApplying && status?.applying && !$('#panel-library').hidden) loadLibrary();   // show the spinner on its row
  prevApplying = status?.applying || null;
  pollTimer = setTimeout(refreshStatus, busy ? 3000 : 15000);
}

function renderStatus() {
  const svc = $('#service'), label = $('#serviceLabel'), sbtn = $('#serviceBtn');
  if (!status) {
    svc.dataset.state = 'down'; label.textContent = 'Dashboard server is not responding'; sbtn.hidden = true;
    return;
  }
  window.renderAvatar?.(status);
  const li = status.linkedin, liNote = $('#liNote');
  liNote.hidden = !li; liNote.dataset.kind = li?.stage === 'error' ? 'error' : '';
  if (li) liNote.textContent = 'LinkedIn feed: ' + (li.stage === 'reading' ? 'reading your feed for hiring posts…'
    : li.stage === 'applying' ? `${li.found} hiring ${li.found === 1 ? 'post' : 'posts'} found, working on them (${li.added} done)`
    : li.stage === 'done' ? `${li.found} hiring ${li.found === 1 ? 'post' : 'posts'} found, ${li.added} new. See them in the job library.`
    : li.message);
  if (status.candidate) {
    $('#whoami').textContent = `${status.candidate}'s job search`;
    const initials = status.candidate.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
    document.querySelectorAll('.avatar').forEach(a => { a.textContent = initials; });
  }
  // The Automation pill: the state of n8n and the daily run at a glance.
  const pill = $('#autoPill'), pillState = status.n8n === 'starting' || status.schedule?.op?.status === 'working' ? ['busy', 'Starting…']
    : status.n8n !== true ? ['down', 'n8n stopped'] : status.run?.running ? ['busy', 'Applying now']
    : status.schedule?.active ? ['up', 'Automation active'] : ['paused', 'Automation paused'];
  pill.dataset.state = pillState[0]; $('#autoLabel').textContent = pillState[1];
  if (status.minMonthlyPkr) {
    const where = status.where?.length ? `, ${status.where.join(' or ')}` : '';
    $('#pickDetail').textContent = `${payShort(status.minMonthlyPkr)}+ PKR a month or a senior role${where}, no repeats`;
  }

  const switching = status.schedule?.op?.status === 'working';
  const starting = status.n8n === 'starting', up = status.n8n === true;
  svc.dataset.state = switching || starting ? 'busy' : up ? 'up' : 'down';
  label.textContent = switching ? 'Restarting n8n…' : starting ? 'Starting n8n… (can take 2–3 minutes)' : up ? 'n8n is running' : 'n8n is stopped';
  sbtn.hidden = switching || starting || status.run.running;   // no second click while n8n is still loading
  sbtn.textContent = up ? 'Stop n8n' : 'Start n8n';
  sbtn.dataset.action = up ? 'stop' : 'start';

  // schedule switch
  const sw = $('#scheduleToggle'), hint = $('#scheduleHint');
  sw.checked = !!status.schedule?.active;
  sw.disabled = switching || status.schedule?.active === null;
  const op = status.schedule?.op, opFor = which => op && (op.which || 'daily') === which;
  hint.textContent = switching && opFor('daily') ? 'Switching… this restarts n8n'
    : op?.status === 'error' && opFor('daily') ? op.error
    : status.schedule?.active === null ? 'Checking…'
    : status.schedule.active ? 'On' : 'Off, apply by hand';
  // reply watcher: its own switch, so replies are caught even when daily applying is off
  const rw = $('#repliesToggle');
  rw.checked = !!status.schedule?.replies;
  rw.disabled = switching || status.schedule?.active === null;
  $('#repliesHint').textContent = switching && opFor('replies') ? 'Switching… this restarts n8n'
    : op?.status === 'error' && opFor('replies') ? op.error
    : status.schedule?.replies ? 'On: drafts + calendar' : 'Off: replies not checked';

  renderReplies();
  renderNotifs();
  renderRun();

  // facts
  const t = status.today;
  $('#factToday').textContent = t.cap ? `${t.total} of ${t.cap}` : String(t.total);
  const lr = status.lastRun;
  $('#factLast').textContent = !lr ? 'Not run yet' : lr.error ? `${when(lr.finishedAt)}: failed` : `${when(lr.finishedAt)}: ${lr.emailed} emailed, ${lr.manual} to apply by hand`;
  const b = status.budget;
  if (b.used == null) { $('#factBudget').textContent = `Shown after first run (limit $${b.limit})`; $('#budgetBar').style.width = '0'; }
  else {
    $('#factBudget').textContent = `$${b.used.toFixed(2)} of $${Number(b.limit).toFixed(2)}`;
    const bar = $('#budgetBar'); bar.style.width = Math.min(100, b.used / b.limit * 100) + '%';
    bar.dataset.level = b.used >= b.stopAt ? 'stop' : b.used >= b.limit * 0.7 ? 'warn' : 'ok';
  }
}

const STEP_ORDER = ['find', 'pick', 'tailor', 'send'];
let lastSaid = '';
function renderRun() {
  const btn = $('#runBtn'), title = $('#runTitle'), sub = $('#runSub'), hint = $('#runHint'), ring = $('#ringProgress');
  const r = status.run;
  let active = null, pct = 0;

  if (r.running) {
    btn.dataset.state = 'running'; btn.disabled = true;
    if (r.stage === 'find') { active = 'find'; pct = 12; title.textContent = 'Searching'; sub.textContent = 'Finding today\'s jobs'; }
    else if (r.stage === 'tailor') {
      active = 'tailor'; pct = 22 + 70 * (r.tailored / Math.max(1, r.picked));
      title.textContent = `${r.tailored} of ${r.picked}`; sub.textContent = 'Resumes tailored';
    } else { active = 'send'; pct = 96; title.textContent = 'Sending'; sub.textContent = 'Emailing and recording'; }
    hint.textContent = `Started ${when(r.startedAt)}. Each resume takes a few minutes. You can close this page.`;
    $('#tailorDetail').textContent = r.picked ? `Hiring panel review, ${r.tailored} of ${r.picked} done` : 'Hiring panel review for each job';
  } else {
    $('#tailorDetail').textContent = 'Hiring panel review for each job';
    const t = status.today, limit = t.cap || t.safetyCap;
    const full = t.total >= limit;
    if (status.n8n === 'starting') { btn.dataset.state = 'blocked'; btn.disabled = true; title.textContent = 'Apply now'; sub.textContent = 'Waiting for n8n'; hint.textContent = 'n8n is starting. This button turns on when it is ready.'; }
    else if (status.n8n !== true) { btn.dataset.state = 'blocked'; btn.disabled = false; title.textContent = 'Apply now'; sub.textContent = 'Start n8n first'; hint.textContent = 'n8n must be running. Use Start n8n at the top.'; }
    else if (full) { btn.dataset.state = 'blocked'; btn.disabled = false; title.textContent = 'All done'; sub.textContent = `${t.total} sent today`;
      hint.textContent = t.cap ? 'Today\'s limit is reached. Raise it in Settings to send more.' : `The safety limit of ${t.safetyCap} a day is reached.`; }
    else { btn.dataset.state = 'ready'; btn.disabled = false; title.textContent = 'Apply now';
      sub.textContent = t.cap ? `Up to ${t.cap - t.total} jobs today` : `Every job scoring ${t.minScore}+`; hint.textContent = status.lastRun?.error ? `Last run failed. ${status.lastRun.error.replace(/^The run stopped with an error: /, '')}` : ''; }
    hint.dataset.kind = !r.running && status.lastRun?.error && hint.textContent.startsWith('Last run failed') ? 'error' : '';
  }

  // Announce run progress once per change, not on every poll.
  const said = r.running ? `${title.textContent}. ${sub.textContent}.` : (lastSaid ? 'Run finished.' : '');
  if (said && said !== lastSaid) $('#runLive').textContent = said;
  lastSaid = r.running ? said : '';

  ring.style.strokeDasharray = `${pct} 100`;
  ring.style.opacity = pct > 0 ? 1 : 0;   // a zero-length round cap would still draw a dot
  const idx = STEP_ORDER.indexOf(active);
  document.querySelectorAll('#steps li').forEach((li, i) => {
    li.dataset.status = !r.running ? '' : i < idx || (active === 'tailor' && i === 1) ? 'done' : (i === idx || (active === 'find' && i === 1)) ? 'active' : '';
  });
}

$('#runBtn').addEventListener('click', async () => {
  if (!status) return;
  if (status.n8n !== true) return toast(status.n8n === 'starting' ? 'n8n is still starting. Try again in a minute.' : 'Start n8n first, then apply.', 'error');
  if (status.today.total >= (status.today.cap || status.today.safetyCap)) return switchTab('settings');
  try { await api('/api/run', { method: 'POST' }); toast('Applying to today\'s jobs. This takes a while.'); }
  catch (e) { toast(e.message, 'error'); }
  refreshStatus();
});

$('#serviceBtn').addEventListener('click', async e => {
  const b = e.currentTarget, action = b.dataset.action;
  b.disabled = true; $('#service').dataset.state = 'busy';
  $('#serviceLabel').textContent = action === 'start' ? 'Starting n8n…' : 'Stopping n8n…';
  try {
    const r = await api(`/api/n8n/${action}`, { method: 'POST' });
    toast(action === 'stop' ? 'n8n stopped' : r.state === 'up' ? 'n8n is running' : 'Starting n8n. This can take 2–3 minutes.');
  }
  catch (err) { toast(err.message, 'error'); }
  b.disabled = false; refreshStatus();
});

$('#scheduleToggle').addEventListener('change', async e => {
  const on = e.target.checked;
  try { await api('/api/schedule', { method: 'POST', json: { on } }); toast(on ? 'Turning on daily applying…' : 'Turning off daily applying…'); }
  catch (err) { e.target.checked = !on; toast(err.message, 'error'); }
  refreshStatus();
});

$('#repliesToggle').addEventListener('change', async e => {
  const on = e.target.checked;
  try { await api('/api/replies-watch', { method: 'POST', json: { on } }); toast(on ? 'Turning on the reply watcher…' : 'Turning off the reply watcher…'); }
  catch (err) { e.target.checked = !on; toast(err.message, 'error'); }
  refreshStatus();
});

// Employer replies from the last 14 days, as a banner at the top. Each opens that application.
function renderReplies() {
  const list = status?.replies || [];
  $('#replies').hidden = !list.length;
  $('#repliesList').innerHTML = list.map(r => `<li>
    <span class="replies-who"><b>${esc(r.company || 'An employer')}</b> about ${esc(r.title)}<small>${esc(dayLabel(String(r.updated_at).slice(0, 10)))}</small></span>
    <span class="replies-what">${esc(r.notes || 'Open it to see their message.')}</span>
    <button class="btn btn-quiet" type="button" data-reply="${esc(r.key)}">Open</button></li>`).join('');
}
$('#repliesList').addEventListener('click', e => { const b = e.target.closest('[data-reply]'); if (b) openDrawer(b.dataset.reply); });

// The bell: its light is on while there are notifications you haven't opened yet. What you've seen is remembered
// in this browser only (a convenience; the list itself always comes from the server).
const SEEN_KEY = 'autojob-seen-notifications';
let seen = new Set(), greeted = false;
try { seen = new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch {}
const NOTIF_ICON = { reply: '✉', review: '✎', failed: '!', run: '✓' };
function renderNotifs() {
  const list = status?.notifications || [];
  const fresh = list.filter(n => !seen.has(n.id));
  $('#bellLight').hidden = !fresh.length;
  $('#bellBtn').setAttribute('aria-label', fresh.length ? `Notifications, ${fresh.length} new` : 'Notifications');
  // When the dashboard opens with something new waiting, say so once.
  if (!greeted && status) { greeted = true; if (fresh.length) toast(`${fresh.length} new notification${fresh.length > 1 ? 's' : ''}. See the bell at the top.`); }
  if (!$('#notifPanel').hidden) drawNotifs(list);
}
function drawNotifs(list) {
  $('#notifList').innerHTML = list.length ? list.map(n => `<li data-kind="${n.kind}" data-new="${!seen.has(n.id)}">
      <button type="button" data-notif="${esc(n.id)}" ${n.key ? `data-key="${esc(n.key)}"` : ''}>
        <span class="notif-icon" aria-hidden="true">${NOTIF_ICON[n.kind] || '•'}</span>
        <span class="notif-body"><b>${esc(n.title)}</b>${n.text ? `<small>${esc(n.text)}</small>` : ''}<small class="notif-when">${esc(when(n.at))}</small></span>
      </button></li>`).join('')
    : '<li class="notif-empty">Nothing new in the last 14 days.</li>';
}
function closeNotifs() { $('#notifPanel').hidden = true; $('#bellBtn').setAttribute('aria-expanded', 'false'); }
$('#bellBtn').addEventListener('click', e => {
  e.stopPropagation();
  if (!$('#notifPanel').hidden) return closeNotifs();
  const list = status?.notifications || [];
  drawNotifs(list);   // new ones stay highlighted while the panel is open
  $('#notifPanel').hidden = false; $('#bellBtn').setAttribute('aria-expanded', 'true');
  list.forEach(n => seen.add(n.id));
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-300))); } catch {}
  $('#bellLight').hidden = true; $('#bellBtn').setAttribute('aria-label', 'Notifications');
});
$('#notifList').addEventListener('click', e => {
  const b = e.target.closest('[data-notif]'); if (!b) return;
  closeNotifs();
  if (b.dataset.key) openDrawer(b.dataset.key); else switchTab('apps');
});
document.addEventListener('click', e => { if (!e.target.closest('.notif')) closeNotifs(); if (!e.target.closest('.auto')) closeAuto(); });
// Automation pill: opens the n8n status and the two daily switches.
function closeAuto() { $('#autoPanel').hidden = true; $('#autoPill').setAttribute('aria-expanded', 'false'); }
$('#autoPill').addEventListener('click', e => {
  e.stopPropagation();
  const open = $('#autoPanel').hidden;
  $('#autoPanel').hidden = !open; $('#autoPill').setAttribute('aria-expanded', String(open));
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#autoPanel').hidden) { closeAuto(); $('#autoPill').focus(); } });
// Top search: shows matching jobs in the job library (all statuses).
$('#topSearchForm').addEventListener('submit', e => {
  e.preventDefault();
  libFilter = ''; $('#libSearch').value = $('#topSearch').value.trim();
  switchTab('library');
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#notifPanel').hidden) { closeNotifs(); $('#bellBtn').focus(); } });

/* ------------------------------------------------------------ ledger (job library stats) */
let stats = null, range = 'all';
const n = v => Number(v || 0).toLocaleString();
async function loadStats() {
  try { stats = await api('/api/stats'); } catch { return; }
  renderStats();
}
function renderStats() {
  if (!stats) return;
  const b = stats[range];
  $('#sFound').textContent = n(b.unique);
  $('#sFoundSub').textContent = b.found > b.unique ? `${n(b.found - b.unique)} repeat sightings ignored` : 'LinkedIn and Indeed';
  $('#sMatched').textContent = n(b.matched);
  $('#sMatchedSub').textContent = b.skipped ? `${n(b.skipped)} skipped by your rules` : `Pay ${payShort(status?.minMonthlyPkr || 100000)}+ or a senior role`;
  $('#sApplied').textContent = n(b.applied);
  $('#sAppliedSub').textContent = `${n(b.emailed)} emailed${b.byHand ? `, ${n(b.byHand)} applied by you` : ''}, ${n(b.manual)} to apply by hand`;
  $('#sReplies').textContent = n(b.replies);
  $('#sRepliesSub').textContent = b.applied ? `${Math.round(100 * b.replies / b.applied)}% reply rate` : 'None yet';
  // Funnel bars: each stage as a share of unique jobs found (one hue, magnitude only).
  const base = Math.max(1, b.unique);
  [['bFound', b.unique, 'jobs found'], ['bMatched', b.matched, 'matched your filters'], ['bApplied', b.applied, 'applied'], ['bReplies', b.replies, 'replies']]
    .forEach(([id, v, what]) => {
      const el = $('#' + id); el.style.transform = `scaleX(${b.unique ? Math.max(v ? .02 : 0, v / base) : 0})`;
      el.parentElement.title = b.unique ? `${n(v)} ${what}, ${Math.round(100 * v / base)}% of jobs found` : '';
    });

  const total = b.tailored + b.asIs;
  const pt = total ? Math.round(100 * b.tailored / total) : 0;
  $('#splitT').style.width = total ? (100 * b.tailored / total) + '%' : '0';
  $('#splitM').style.width = total ? (100 * b.asIs / total) + '%' : '0';
  // Direct labels only where the segment is wide enough to hold them; the legend always carries the numbers.
  $('#splitTLabel').textContent = total && b.tailored / total >= .14 ? `${pt}% tailored` : '';
  $('#splitMLabel').textContent = total && b.asIs / total >= .14 ? `${100 - pt}% as-is` : '';
  $('#splitBar').setAttribute('aria-label', total ? `${n(b.tailored)} tailored, ${n(b.asIs)} sent with the master resume as-is` : 'No applications yet');
  $('#sTailored').textContent = n(b.tailored); $('#sAsIs').textContent = n(b.asIs);
  $('#sThreshold').textContent = stats.sendAsIsAt; $('#sPending').textContent = n(stats.pending);
  $('#libCount').textContent = stats.all.unique || '';
  // Applications per day, last 14 days: one bar per day, today last.
  const daily = stats.daily || [], top = Math.max(1, ...daily.map(d => d.applied));
  $('#dailyBars').innerHTML = daily.map((d, i) =>
    `<span class="${i === daily.length - 1 ? 'today' : ''}" style="--h:${d.applied ? Math.max(6, 100 * d.applied / top) : 2}%" title="${esc(dayLabel(d.day))}: ${d.applied} applied"></span>`).join('');
  const total14 = daily.reduce((s, d) => s + d.applied, 0);
  $('#dailyBars').setAttribute('aria-label', `${total14} applications in the last 14 days, ${daily.at(-1)?.applied || 0} today`);
}
document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
  range = b.dataset.range;
  document.querySelectorAll('.seg button').forEach(x => x.setAttribute('aria-pressed', x === b));
  renderStats();
}));

function scoreHtml(score) {
  if (score == null || score === '') return '<span class="score" data-band="none" title="Not scored"><b>–</b></span>';
  const t = stats?.sendAsIsAt ?? 80, s = Number(score);
  const band = s >= t ? 'strong' : s >= 60 ? 'fair' : 'weak';
  const label = s >= t ? 'Strong match' : s >= 60 ? 'Fair match' : 'Weak match';
  return `<span class="score" data-band="${band}" style="--v:${s}" title="${label}: ${s} out of 100"><b>${s}</b></span>`;
}

/* ------------------------------------------------------------ job library */
// Opens on Matched: jobs that passed your rules. Skipped ones (other cities, low pay...) stay one click away.
let lib = [], libFilter = 'Matched', libTimer, openDetail = null;
const LIB_FILTERS = [['Matched', 'Matched'], ['', 'All'], ['Review', 'Ready for you'], ['Pending', 'Pending'], ['Applied', 'Applied'], ['Skipped', 'Skipped'], ['Failed', 'Failed']];
async function loadLibrary() {
  const q = $('#libSearch').value.trim();
  try { lib = await api(`/api/jobs?status=${encodeURIComponent(libFilter)}&q=${encodeURIComponent(q)}`); }
  catch (e) { return toast(e.message, 'error'); }
  $('#libFilters').innerHTML = LIB_FILTERS.map(([k, l]) => `<button class="filter" type="button" data-f="${k}" aria-pressed="${libFilter === k}">${l}</button>`).join('');
  renderLibrary(q);
}
// Skipped and Pending jobs can be applied to by hand, with the resume you choose.
function applyButtons(j) {
  const a = status?.applying;
  if (a && a.key === j.key) return `<span class="applying"><span class="spinner"></span>Applying with ${a.mode === 'master' ? 'master resume' : 'hiring panel'}…</span>`;
  const busy = !!a || status?.run?.running;
  const dis = busy ? 'disabled title="Wait for the current run to finish"' : '';
  return `<span class="apply-btns">
    <button class="btn btn-quiet" type="button" data-apply="master" ${dis}>Apply with master resume</button>
    <button class="btn btn-quiet" type="button" data-apply="tailor" ${dis}>Apply with hiring panel</button></span>`;
}
function libState(j) {
  if (j.status === 'Skipped') return `<span class="state" data-s="Skipped">Skipped<small>${esc(j.reason)}</small></span>${applyButtons(j)}`;
  if (j.status === 'Pending') return `<span class="state" data-s="Pending">Pending<small>Waiting for a free slot in the daily limit</small></span>${applyButtons(j)}`;
  if (j.status === 'Processing') return `<span class="state" data-s="Processing">${status?.adding?.key === j.key && status.adding.stage === 'tailoring' ? 'Hiring panel is rewriting your resume' : 'Being applied to now'}</span>${status?.applying?.key === j.key ? applyButtons(j) : ''}`;
  if (j.status === 'Review') return `<span class="stamp" data-s="Review">Ready for you</span><span class="rtype">Rewritten resume, not sent yet</span>
    <span class="apply-btns"><button class="btn btn-quiet" type="button" data-review>Review and decide</button></span>`;
  const rt = j.resume_type === 'master' ? 'Master resume as-is' : j.resume_type === 'tailored' ? 'Tailored resume' : '';
  return `<span class="stamp" data-s="${esc(j.status)}">${esc(STAMP_TEXT[j.status] || j.status)}</span>${rt ? `<span class="rtype">${rt}</span>` : ''}${j.status === 'Failed' ? applyButtons(j) : ''}${j.status === 'Apply manually' ? `<span class="apply-btns"><button class="btn btn-quiet" type="button" data-applied>I've applied</button></span>` : ''}`;
}
function renderLibrary(q) {
  const empty = lib.length === 0;
  $('#libEmpty').hidden = !empty; $('#libWrap').hidden = empty;
  $('#libEmptyTitle').textContent = q || libFilter ? 'No jobs match' : 'The library is empty';
  $('#libEmptyText').textContent = q || libFilter ? 'Try another filter or search.' : 'Every job a run finds is recorded here with its match score, including the ones that were skipped and why.';
  $('#libBody').innerHTML = lib.map(j => {
    const pay = pkr(j.salary_max);
    const hasDetail = j.matched.length || j.missing.length;
    return `<tr data-key="${esc(j.key)}" class="${hasDetail ? 'expandable' : ''}" ${hasDetail ? 'tabindex="0" aria-expanded="false"' : ''}>
      <td>${scoreHtml(j.score)}</td>
      <td><span class="role-title">${webUrl(j.apply_url) ? `<a href="${esc(webUrl(j.apply_url))}" target="_blank" rel="noopener">${esc(j.title)}</a>` : esc(j.title)}</span>
          <span class="role-co">${esc(j.company)}${j.location ? ', ' + esc(j.location) : ''}${via(j.source)}</span>
          ${j.linkedin ? `<span class="li-row"><button class="btn btn-quiet" type="button" data-li-copy>Copy LinkedIn comment</button>${webUrl(j.linkedin.url) ? `<a href="${esc(webUrl(j.linkedin.url))}" target="_blank" rel="noopener">Open post</a>` : ''}</span>` : ''}</td>
      <td class="num">${pay ? esc(pay) : '<span class="pay-none">Not listed</span>'}</td>
      <td>${libState(j)}</td>
      <td>${esc(dayLabel(String(j.found_at || '').slice(0, 10)))}</td>
    </tr>`;
  }).join('');
}
function detailRow(j) {
  const p = j.parts;
  return `<tr class="detail"><td colspan="5">
    ${j.matched.length ? `<div>On your resume<div class="skill-list">${j.matched.map(s => `<span class="skill has">${esc(s)}</span>`).join('')}</div></div>` : ''}
    ${j.missing.length ? `<div style="margin-top:10px">Asked for, not on your resume<div class="skill-list">${j.missing.map(s => `<span class="skill miss">${esc(s)}</span>`).join('')}</div></div>` : ''}
    ${p ? `<p class="parts">Skills ${p.skills}/50, title ${p.title}/25, seniority ${p.seniority}/15, location ${p.location}/10</p>` : ''}
  </td></tr>`;
}
function toggleDetail(tr) {
  if (!tr || !tr.classList.contains('expandable')) return;
  const open = tr.nextElementSibling?.classList.contains('detail');
  document.querySelectorAll('#libBody tr.detail').forEach(d => { d.previousElementSibling.setAttribute('aria-expanded', 'false'); d.remove(); });
  if (open) return;
  const j = lib.find(x => x.key === tr.dataset.key);
  tr.insertAdjacentHTML('afterend', detailRow(j)); tr.setAttribute('aria-expanded', 'true');
}
$('#libBody').addEventListener('click', async e => {
  if (e.target.closest('button[data-review]')) { e.stopPropagation(); return openDrawer(e.target.closest('tr').dataset.key); }
  if (e.target.closest('button[data-li-copy]')) {
    e.stopPropagation();
    const c = lib.find(x => x.key === e.target.closest('tr').dataset.key)?.linkedin?.comment || '';
    return navigator.clipboard.writeText(c).then(() => toast('Comment copied. Open the post and paste it.'), () => toast('Copy failed.', 'error'));
  }
  const done = e.target.closest('button[data-applied]');
  if (done) {
    e.stopPropagation(); done.disabled = true;
    try {
      const r = await api('/api/applied-by-hand', { method: 'POST', json: { key: done.closest('tr').dataset.key } });
      toast(r.warning || 'Marked as applied.', r.warning ? 'error' : 'ok');
    } catch (err) { toast(err.message, 'error'); }
    loadLibrary(); loadApps(); loadStats(); return;
  }
  const b = e.target.closest('button[data-apply]');
  if (b) {
    e.stopPropagation();
    const key = b.closest('tr').dataset.key, mode = b.dataset.apply;
    const j = lib.find(x => x.key === key);
    b.closest('.apply-btns').querySelectorAll('button').forEach(x => { x.disabled = true; });
    try {
      await api('/api/apply-selected', { method: 'POST', json: { key, mode } });
      toast(mode === 'master' ? `Applying to ${j?.title} with your master resume. About a minute.` : `Applying to ${j?.title} with the hiring panel. A few minutes.`);
    } catch (err) { toast(err.message, 'error'); }
    await refreshStatus(); loadLibrary();
    return;
  }
  if (!e.target.closest('a')) toggleDetail(e.target.closest('tr:not(.detail)'));
});
$('#libBody').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.target.closest('a')) toggleDetail(e.target.closest('tr:not(.detail)')); });
$('#libFilters').addEventListener('click', e => { const b = e.target.closest('.filter'); if (b) { libFilter = b.dataset.f; loadLibrary(); } });
$('#libSearch').addEventListener('input', () => { clearTimeout(libTimer); libTimer = setTimeout(loadLibrary, 250); });

/* ------------------------------------------------------------ add a job you found */
const addBusy = () => ['reading', 'tailoring'].includes(status?.adding?.stage);
let prevAddStage = null;
function renderAdding() {
  const ad = status?.adding, el = $('#addStatus');
  $('#addBtn').disabled = addBusy();
  if (ad?.stage === 'reading') el.innerHTML = '<span class="spinner"></span>Reading and scoring the job. About a minute.';
  else if (ad?.stage === 'tailoring') el.innerHTML = `<span class="spinner"></span>${esc(ad.title)}: the hiring panel is rewriting your resume. This takes several minutes. You can leave this page.`;
  else if (ad && prevAddStage && ['reading', 'tailoring'].includes(prevAddStage)) el.textContent = ad.message;   // only announce a result you were waiting for
  el.dataset.kind = ad?.stage === 'error' ? 'error' : '';
  if (ad && prevAddStage !== ad.stage && ['done', 'error', 'tailoring'].includes(ad.stage) && prevAddStage) { loadLibrary(); loadStats(); }
  prevAddStage = ad?.stage || null;
}
const readAsDataUrl = file => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error('Could not read that image.')); r.readAsDataURL(file); });
$('#addJobForm').addEventListener('submit', async e => {
  e.preventDefault();
  const text = $('#addText').value.trim(), file = $('#addImage').files[0], url = $('#addUrl').value.trim();
  const say = (t, kind = 'error') => { $('#addStatus').textContent = t; $('#addStatus').dataset.kind = kind; };
  if (!text && !file) return say('Paste the job description or add a screenshot of the post.');
  if (file && !/^image\/(png|jpeg|webp)$/.test(file.type)) return say('The screenshot must be a PNG, JPG or WebP image.');
  if (file && file.size > 10 * 1024 * 1024) return say('That image is over 10 MB. Crop it or save it smaller.');
  if (url && !/^https?:\/\/\S+$/i.test(url)) return say('The job link must start with http:// or https://');
  $('#addBtn').disabled = true;
  try {
    await api('/api/add-job', { method: 'POST', json: { text, url, image: file ? await readAsDataUrl(file) : '' } });
    $('#addJobForm').reset();
    prevAddStage = 'reading';
  } catch (err) { say(err.message); $('#addBtn').disabled = false; return; }
  refreshStatus();
});

/* ------------------------------------------------------------ interview prep (any pasted job description) */
let preps = [], prepTimer, prepOpen = null;
async function loadPreps() {
  try { preps = await api('/api/preps'); } catch (e) { return toast(e.message, 'error'); }
  const running = preps.some(p => p.state && !p.state.done);
  $('#prepList').innerHTML = preps.length ? preps.map(p => {
    const st = p.state && !p.state.done ? '<span class="applying"><span class="spinner"></span>Preparing… about 5 to 8 minutes</span>'
      : p.ready ? '' : `<small class="prep-failed">${esc(p.state?.error || 'This one did not finish. Paste the job description again.')}</small>`;
    return `<li><button type="button" data-prep-id="${esc(p.id)}" ${p.ready ? '' : 'disabled'} aria-current="${prepOpen === p.id}">
      ${p.score != null ? scoreHtml(p.score) : '<span class="score" data-band="none"><b>–</b></span>'}
      <span class="prep-item"><b>${esc(p.title)}</b><small>${esc(when(p.createdAt))} · ${esc(p.resume || '')}</small>${st}</span></button></li>`;
  }).join('') : '<li class="notif-empty">Nothing yet. Paste a job description to get your first prep.</li>';
  clearTimeout(prepTimer);
  if (running && !$('#panel-prep').hidden) prepTimer = setTimeout(loadPreps, 8000);
  // A prep you just started finishes while you watch: open it.
  if (prepOpen && preps.find(p => p.id === prepOpen)?.ready && $('#prepView').hidden) openPrep(prepOpen);
}
async function openPrep(id) {
  let d; try { d = await api('/api/prep?id=' + encodeURIComponent(id)); } catch (e) { return toast(e.message, 'error'); }
  prepOpen = id;
  $('#prepViewTitle').textContent = d.title;
  $('#prepViewMeta').textContent = `Made ${when(d.createdAt)} from ${d.resume}${d.score != null ? ` · match score ${d.score}/100` : ''}`;
  $('#prepViewDoc').innerHTML = d.html || '<p class="muted">Not ready yet.</p>';
  $('#prepView').hidden = false;
  $('#prepView').scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.querySelectorAll('#prepList [data-prep-id]').forEach(b => b.setAttribute('aria-current', b.dataset.prepId === id));
}
$('#prepList').addEventListener('click', e => { const b = e.target.closest('[data-prep-id]'); if (b && !b.disabled) openPrep(b.dataset.prepId); });
document.querySelectorAll('input[name="prepResume"]').forEach(r => r.addEventListener('change', () => {
  $('#prepFile').hidden = !$('input[name="prepResume"][value="upload"]').checked;
}));
$('#prepForm').addEventListener('submit', async e => {
  e.preventDefault();
  const say = (t, kind = 'error') => { $('#prepStatus').textContent = t; $('#prepStatus').dataset.kind = kind; };
  const jd = $('#prepJd').value.trim(), upload = $('input[name="prepResume"][value="upload"]').checked, file = $('#prepFile').files[0];
  if (jd.length < 80) return say('Paste the full job description (at least a few lines).');
  if (upload && !file) return say('Choose the resume file, or pick "My master resume".');
  if (file && !/\.(pdf|docx|md|txt)$/i.test(file.name)) return say('Upload the resume as a PDF, Word (.docx), .md or .txt file.');
  if (file && file.size > 8 * 1024 * 1024) return say('That resume file is over 8 MB.');
  $('#prepBtn').disabled = true;
  try {
    const r = await api('/api/prep', { method: 'POST', json: { jd, role: $('#prepRole').value.trim(),
      resume: upload ? { name: file.name, data: await readAsDataUrl(file) } : null } });
    prepOpen = r.id; $('#prepView').hidden = true;
    $('#prepForm').reset(); $('#prepFile').hidden = true;
    say('Preparing your interview. It appears in the list when ready, about 5 to 8 minutes. You can leave this page.', 'ok');
    toast('Interview prep started.');
  } catch (err) { say(err.message); }
  $('#prepBtn').disabled = false;
  loadPreps();
});

/* ------------------------------------------------------------ emails & cover letters */
// What each kind asks for: [context field label, context required?, job description required?]
const WRITE_FORM = {
  cover: [null, false, true], apply: [null, false, true],
  reply: ["Their email (paste the employer's message)", true, false],
  questions: ['The questions from the application form (paste them all)', true, false],
  followup: ['Notes (optional): when you applied, anything to mention', false, false],
  thanks: ['Interview notes (optional): who you met, what you talked about', false, false],
};
const writeKind = () => document.querySelector('input[name="writeKind"]:checked').value;
function syncWriteForm() {
  const [ctxLabel, , jdNeeded] = WRITE_FORM[writeKind()];
  $('#writeContextField').hidden = !ctxLabel; if (ctxLabel) $('#writeContextLabel').textContent = ctxLabel;
  $('#writeJdHint').textContent = jdNeeded ? '' : '(optional, helps)';
  document.querySelectorAll('#writeKinds .filter').forEach(l => l.setAttribute('aria-pressed', l.querySelector('input').checked));
}
document.querySelectorAll('input[name="writeKind"]').forEach(r => r.addEventListener('change', syncWriteForm));
document.querySelectorAll('input[name="writeResume"]').forEach(r => r.addEventListener('change', () => {
  $('#writeFile').hidden = !$('input[name="writeResume"][value="upload"]').checked;
}));
syncWriteForm();

let writings = [], writeTimer, sendTimer, writeOpen = null;
async function loadWritings() {
  try { writings = await api('/api/writings'); } catch (e) { return toast(e.message, 'error'); }
  const running = writings.some(w => w.state && !w.state.done);
  $('#writeList').innerHTML = writings.length ? writings.map(w => {
    const st = w.state && !w.state.done ? '<span class="applying"><span class="spinner"></span>Writing… about a minute</span>'
      : w.ready ? '' : `<small class="prep-failed">${esc(w.state?.error || 'This one did not finish. Try again.')}</small>`;
    return `<li><button type="button" data-write-id="${esc(w.id)}" ${w.ready ? '' : 'disabled'} aria-current="${writeOpen === w.id}">
      <span class="notif-icon" aria-hidden="true">${w.kind === 'cover' ? '📄' : '✉'}</span>
      <span class="prep-item"><b>${esc(w.title)}</b><small>${esc(when(w.createdAt))} · ${esc(w.resume || '')}</small>${st}</span></button></li>`;
  }).join('') : '<li class="notif-empty">Nothing yet. Choose what you need and press Write it.</li>';
  clearTimeout(writeTimer);
  if (running && !$('#panel-write').hidden) writeTimer = setTimeout(loadWritings, 4000);
  if (writeOpen && writings.find(w => w.id === writeOpen)?.ready && $('#writeView').hidden) openWriting(writeOpen);
}
async function openWriting(id) {
  let w; try { w = await api('/api/writing?id=' + encodeURIComponent(id)); } catch (e) { return toast(e.message, 'error'); }
  writeOpen = id;
  $('#writeViewTitle').textContent = w.title;
  $('#writeViewMeta').textContent = `${w.kindLabel} · written ${when(w.createdAt)} from ${w.resume}`;
  $('#writeSubject').hidden = !w.subject; $('#writeSubject').textContent = w.subject ? `Subject: ${w.subject}` : '';
  $('#writeBody').textContent = w.body.replace(/\*\*(.+?)\*\*/g, '$1');
  // Application questions: one block per question, each with its own Copy button for pasting into the form.
  if (w.kind === 'questions') $('#writeBody').innerHTML = w.body.split(/^###\s+/m).filter(s => s.trim()).map(s => {
    const [q, ...a] = s.split('\n'), answer = a.join('\n').replace(/\*\*(.+?)\*\*/g, '$1').trim();
    return `<div class="qa"><p class="qa-q">${esc(q.trim())}</p><p class="qa-a">${esc(answer)}</p>
      <button class="btn btn-quiet" type="button" data-copy-answer="${esc(answer)}">Copy answer</button></div>`;
  }).join('');
  // Send now (emails only): one confirm click, then n8n's Gmail sends it; the item is stamped Sent so it can't go twice.
  const sendBox = w.kind === 'cover' || w.kind === 'questions' ? ''
    : w.sent?.ok ? `<span class="stamp" data-s="Emailed">Sent to ${esc(w.sent.to)} · ${esc(when(w.sent.at))}</span>`
    : w.sending ? `<span class="applying"><span class="spinner"></span>Sending to ${esc(w.sending.to)}… about a minute</span>`
    : `<div class="send-box">
        ${w.sent && !w.sent.ok ? `<p class="callout"><strong>Not sent.</strong> ${esc(w.sent.error || '')}</p>` : ''}
        <label class="send-to" for="sendTo">To</label>
        <input id="sendTo" type="email" value="${esc(w.suggestedTo || '')}" placeholder="hr@company.com" autocomplete="off">
        <label class="check"><input type="checkbox" id="sendAttach" ${w.kind === 'apply' ? 'checked' : ''}> Attach my resume PDF</label>
        <button class="btn btn-primary" type="button" data-send-now>Send now</button>
        <button class="btn" type="button" data-send-cancel hidden>Cancel</button>
      </div>`;
  $('#writeActions').innerHTML = `<button class="btn ${w.kind === 'cover' ? 'btn-primary' : ''}" type="button" data-copy-write>Copy${w.subject ? ' subject and email' : ' letter'}</button>` +
    (w.pdf ? `<a class="btn" href="${fileUrl(w.pdf)}" download>Download PDF</a>` : '') + sendBox;
  $('#writeActions').onclick = async e => {
    if (e.target.closest('[data-copy-write]')) {
      const text = (w.subject ? `Subject: ${w.subject}\n\n` : '') + $('#writeBody').textContent;
      return navigator.clipboard.writeText(text).then(() => toast('Copied. Paste it into your email or the job site.'), () => toast('Copy failed. Select the text instead.', 'error'));
    }
    const sendBtn = e.target.closest('[data-send-now]'), cancel = $('#writeActions [data-send-cancel]');
    if (e.target.closest('[data-send-cancel]')) { const b = $('#writeActions [data-send-now]'); delete b.dataset.confirm; b.textContent = 'Send now'; cancel.hidden = true; return; }
    if (!sendBtn) return;
    const to = $('#sendTo').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) return toast('Enter the email address to send to.', 'error');
    if (!sendBtn.dataset.confirm) { sendBtn.dataset.confirm = '1'; sendBtn.textContent = `Yes, send to ${to}`; cancel.hidden = false; return; }
    sendBtn.disabled = true;
    try { await api('/api/write/send', { method: 'POST', json: { id, to, attachResume: $('#sendAttach').checked } }); toast(`Sending to ${to}…`); }
    catch (err) { toast(err.message, 'error'); }
    openWriting(id);
  };
  clearTimeout(sendTimer);
  if (w.sending) sendTimer = setTimeout(() => { if (writeOpen === id) openWriting(id); }, 5000);
  else if (w.sent?.ok && $('#writeView').dataset.wasSending === id) toast(`Sent to ${w.sent.to}.`);
  $('#writeView').dataset.wasSending = w.sending ? id : '';
  $('#writeView').hidden = false;
  $('#writeView').scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.querySelectorAll('#writeList [data-write-id]').forEach(b => b.setAttribute('aria-current', b.dataset.writeId === id));
}
$('#writeList').addEventListener('click', e => { const b = e.target.closest('[data-write-id]'); if (b && !b.disabled) openWriting(b.dataset.writeId); });
$('#writeBody').addEventListener('click', e => {
  const b = e.target.closest('[data-copy-answer]'); if (!b) return;
  navigator.clipboard.writeText(b.dataset.copyAnswer).then(() => toast('Answer copied.'), () => toast('Copy failed. Select the text instead.', 'error'));
});
// From the Interview prep tab: jump straight to answering application-form questions.
$('#prepQuestionsBtn').addEventListener('click', () => {
  switchTab('write');
  $('input[name="writeKind"][value="questions"]').checked = true; syncWriteForm();
  if ($('#prepJd').value.trim()) $('#writeJd').value = $('#prepJd').value;   // reuse a job description already pasted there
  $('#writeContext').focus();
});
$('#writeForm').addEventListener('submit', async e => {
  e.preventDefault();
  const say = (t, kind = 'error') => { $('#writeStatus').textContent = t; $('#writeStatus').dataset.kind = kind; };
  const kind = writeKind(), [, ctxNeeded, jdNeeded] = WRITE_FORM[kind];
  const jd = $('#writeJd').value.trim(), context = $('#writeContextField').hidden ? '' : $('#writeContext').value.trim();
  const upload = $('input[name="writeResume"][value="upload"]').checked, file = $('#writeFile').files[0];
  if (jdNeeded && jd.length < 80) return say('Paste the full job description (at least a few lines).');
  if (ctxNeeded && context.length < 20) return say("Paste the employer's email you want to reply to.");
  if (upload && !file) return say('Choose the resume file, or pick "My master resume".');
  if (file && !/\.(pdf|docx|md|txt)$/i.test(file.name)) return say('Upload the resume as a PDF, Word (.docx), .md or .txt file.');
  if (file && file.size > 8 * 1024 * 1024) return say('That resume file is over 8 MB.');
  $('#writeBtn').disabled = true;
  try {
    const r = await api('/api/write', { method: 'POST', json: { kind, jd, context, role: $('#writeRole').value.trim(),
      resume: upload ? { name: file.name, data: await readAsDataUrl(file) } : null } });
    writeOpen = r.id; $('#writeView').hidden = true;
    $('#writeForm').reset(); $('#writeFile').hidden = true; syncWriteForm();
    say('Writing it now. It opens here when ready, about a minute.', 'ok');
  } catch (err) { say(err.message); }
  $('#writeBtn').disabled = false;
  loadWritings();
});

/* ------------------------------------------------------------ tabs */
const TABS = ['apps', 'library', 'prep', 'write', 'resume', 'settings'];
function switchTab(name, focus = false) {
  for (const t of TABS) {
    const tab = $(`#tab-${t}`), panel = $(`#panel-${t}`), on = t === name;
    tab.setAttribute('aria-selected', on); tab.tabIndex = on ? 0 : -1; panel.hidden = !on;
    if (on && focus) tab.focus();
  }
  // The run cards and replies banner belong to the Overview; other sections get the whole page.
  $('.bento').hidden = name !== 'apps'; $('#replies').classList.toggle('off-view', name !== 'apps');
  window.scrollTo({ top: 0 });
  if (name === 'library') loadLibrary();
  if (name === 'resume') loadResume();
  if (name === 'prep') loadPreps();
  if (name === 'write') loadWritings();
  if (name === 'settings') loadSettings();
  if (name === 'apps') loadApps();
}
TABS.forEach((t, i) => {
  const el = $(`#tab-${t}`);
  el.addEventListener('click', () => switchTab(t));
  el.addEventListener('keydown', e => {
    if (['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) {   // the rail is vertical; both work
      e.preventDefault();
      const n = TABS[(i + (['ArrowRight', 'ArrowDown'].includes(e.key) ? 1 : TABS.length - 1)) % TABS.length];
      switchTab(n, true);
    }
  });
});

/* ------------------------------------------------------------ applications */
let apps = [], filter = 'all';
const FILTERS = [['all', 'All'], ['Emailed', 'Emailed'], ['Apply manually', 'Apply by hand'], ['Applied by hand', 'Applied by you'], ['Reply received', 'Replied'], ['Failed', 'Failed']];
const STAMP_TEXT = { 'Emailed': 'Emailed', 'Apply manually': 'Apply by hand', 'Applied by hand': 'Applied by you', 'Reply received': 'Replied', 'Failed': 'Failed', 'Review': 'Ready for you' };

async function loadApps() {
  try { apps = await api('/api/applications'); } catch (e) { toast(e.message, 'error'); return; }
  $('#appsCount').textContent = apps.length || '';
  renderFilters(); renderApps();
}
function renderFilters() {
  const counts = apps.reduce((m, a) => (m[a.Status] = (m[a.Status] || 0) + 1, m), {});
  $('#filters').innerHTML = FILTERS
    .filter(([k]) => k === 'all' || counts[k])
    .map(([k, label]) => `<button class="filter" type="button" data-f="${esc(k)}" aria-pressed="${filter === k}">${esc(label)} ${k === 'all' ? apps.length : counts[k]}</button>`).join('');
}
$('#filters').addEventListener('click', e => {
  const b = e.target.closest('.filter'); if (!b) return;
  filter = b.dataset.f; renderFilters(); renderApps();
});
function renderApps() {
  const list = filter === 'all' ? apps : apps.filter(a => a.Status === filter);
  $('#appsEmpty').hidden = apps.length > 0;
  $('#filters').hidden = apps.length === 0;
  $('.table-wrap').hidden = apps.length === 0;
  $('#appsBody').innerHTML = list.map(a => {
    const pay = pkr(a['Salary PKR/mo']);
    return `<tr data-key="${esc(a['Dedup Key'])}" tabindex="0">
      <td><span class="stamp" data-s="${esc(a.Status)}">${esc(STAMP_TEXT[a.Status] || a.Status)}</span>${a['Resume Type'] ? `<span class="rtype">${esc(a['Resume Type'])}</span>` : ''}</td>
      <td>${scoreHtml(a['Match Score'])}</td>
      <td><span class="role-title">${esc(a.Title)}</span><span class="role-co">${esc(a.Company)}${a.Location ? ', ' + esc(a.Location) : ''}${via(a.Source)}</span></td>
      <td class="num">${pay ? esc(pay) : '<span class="pay-none">Not listed</span>'}</td>
      <td>${esc(dayLabel(a['Applied On']))}</td>
      <td><button class="btn btn-quiet" type="button">Review</button></td>
    </tr>`;
  }).join('');
}
$('#appsBody').addEventListener('click', e => { const tr = e.target.closest('tr'); if (tr) openDrawer(tr.dataset.key); });
$('#appsBody').addEventListener('keydown', e => { if (e.key === 'Enter') { const tr = e.target.closest('tr'); if (tr) openDrawer(tr.dataset.key); } });

/* ------------------------------------------------------------ review drawer */
let lastFocus = null, drawerKey = null, drawerPoll;
async function openDrawer(key) {
  lastFocus = document.activeElement; drawerKey = key;
  let d; try { d = await api('/api/application?key=' + encodeURIComponent(key)); } catch (e) { return toast(e.message, 'error'); }
  const a = d.row;
  $('#drawerCompany').textContent = a.Company;
  $('#drawerTitle').textContent = a.Title;
  const pay = pkr(a['Salary PKR/mo']);
  $('#drawerMeta').innerHTML = `<span class="stamp" data-s="${esc(a.Status)}">${esc(STAMP_TEXT[a.Status] || a.Status)}</span>
    <span>${esc(a.Location || '')}</span><span>${pay ? esc(pay) + ' a month' : 'Pay not listed'}</span>
    <span>${a.Status === 'Emailed' ? 'Sent to ' + esc(a['Contact Email']) : ''}</span>`;

  const appRow = apps.find(x => x['Dedup Key'] === key) || {};
  const rt = d.retailor;
  const retailoring = rt && !rt.done;
  const review = a.Status === 'Review';   // a job you added: rewritten resume waiting for your decision
  const replied = a.Status === 'Reply received', prepping = d.prep && !d.prep.done;
  const busy = !!status?.applying || status?.run?.running;
  $('#drawerActions').innerHTML = [
    review && a['Contact Email'] ? `<button class="btn btn-primary" type="button" data-send ${busy ? 'disabled title="Wait for the current run to finish"' : ''}>Send email to ${esc(a['Contact Email'])}</button>` : '',
    // a link, so the posting opens in a new tab straight from your click (no pop-up blocker)
    review ? (webUrl(a['Job URL']) ? `<a class="btn ${a['Contact Email'] ? '' : 'btn-primary'}" href="${esc(webUrl(a['Job URL']))}" target="_blank" rel="noopener" data-self>I'll apply myself</a>`
      : `<button class="btn ${a['Contact Email'] ? '' : 'btn-primary'}" type="button" data-self>I'll apply myself</button>`) : '',
    !review && webUrl(a['Job URL']) ? `<a class="btn ${a.Status === 'Apply manually' ? 'btn-primary' : ''}" href="${esc(webUrl(a['Job URL']))}" target="_blank" rel="noopener">Open job posting</a>` : '',
    a.Status === 'Apply manually' ? `<button class="btn" type="button" data-applied>I've applied</button>` : '',
    d.pdf ? `<a class="btn" href="${fileUrl(d.pdf)}" download>Download resume PDF</a>` : '',
    d.email ? `<button class="btn" type="button" data-copy="email">Copy cover email</button>` : '',
    appRow.canRetailor ? `<button class="btn" type="button" data-retailor ${retailoring ? 'disabled' : ''}>${retailoring ? 'Re-tailoring…' : 'Re-tailor resume'}</button>` : '',
    // An employer replied: get ready for the interview.
    replied ? `<button class="btn btn-primary" type="button" data-prep ${prepping ? 'disabled' : ''}>${prepping ? 'Preparing…' : d.prepHtml ? 'Redo interview prep' : 'Prepare for interview'}</button>` : '',
    replied ? `<button class="btn" type="button" data-practice>Copy mock-interview command</button>` : '',
  ].join('');

  const parts = [];
  if (review) parts.push(`<p class="callout"><strong>Nothing has been sent yet.</strong> The hiring panel rewrote your resume for this job. Check it and the cover email below, then ${a['Contact Email'] ? 'send the email, or ' : ''}apply yourself through the job posting${a['Job URL'] ? '' : ' (no link was given, so apply wherever you found it)'}.</p>`);
  if (a.Status === 'Apply manually') parts.push(`<p class="callout"><strong>This listing has no email address.</strong> Open the job posting, upload the resume PDF below, and paste the cover email where it asks for one. Then press I've applied.</p>`);
  if (a.Status === 'Failed') parts.push(`<p class="callout"><strong>This application didn't go through.</strong> ${esc(a.Notes || '')}</p>`);
  if (a['Reply Summary']) parts.push(`<section><h3>Their reply</h3><p class="letter">${esc(a['Reply Summary'])}${a['Calendar Event'] ? '\n\nA draft answer is waiting in Gmail Drafts, with a reminder in your calendar.' : ''}</p></section>`);
  if (prepping) parts.push(`<p class="callout converting"><span class="spinner"></span>Writing your answers, then a hiring panel (recruiter, hiring manager, skeptic) reviews them and they are rewritten. About 5 to 8 minutes. You can close this panel.</p>`);
  if (d.prep?.done && !d.prep.ok) parts.push(`<p class="callout"><strong>Interview prep failed.</strong> ${esc(d.prep.error || '')}</p>`);
  if (d.prepHtml) parts.push(`<section><details class="panel-wrap" open><summary>Interview prep</summary><div class="panel-doc">${d.prepHtml}</div>
    <p class="help">For a live mock interview (one question at a time, scored), use Copy mock-interview command and paste it into Claude in the Auto Job folder.</p></details></section>`);
  if (rt?.done) parts.push(`<p class="callout">${rt.ok ? '<strong>Re-tailored.</strong> The resume and email below are the new versions.' : '<strong>Re-tailoring failed.</strong> ' + esc(rt.error || '')}</p>`);
  // The resume as formatted text. Never an embedded PDF: browsers set to download PDFs saved a copy every time
  // this panel opened or refreshed. The PDF downloads only from the Download resume PDF button.
  if (d.resumeHtml) parts.push(`<section><h3>${/master/i.test(a['Resume Type'] || '') ? 'Resume sent (master, as-is)' : 'Tailored resume'}</h3><article class="doc sheet resume-inline">${d.resumeHtml}</article></section>`);
  if (d.email) parts.push(`<section><h3>Cover email</h3><div class="letter"><span class="letter-subject">${esc(d.email.subject)}</span>${esc(d.email.body)}</div></section>`);
  if (d.panelHtml) parts.push(`<section><details class="panel-wrap"><summary>What the hiring panel said</summary><div class="panel-doc">${d.panelHtml}</div></details></section>`);
  if (!parts.length) parts.push('<p class="muted">No files were saved for this application.</p>');
  $('#drawerBody').innerHTML = parts.join('');

  $('#drawerActions').onclick = async e => {
    if (e.target.closest('[data-prep]')) {
      e.target.closest('[data-prep]').disabled = true;
      try { await api('/api/interview-prep', { method: 'POST', json: { key } }); toast('Preparing your interview answers with a hiring-panel review. About 5 to 8 minutes.'); }
      catch (err) { toast(err.message, 'error'); }
      return openDrawer(key);
    }
    if (e.target.closest('[data-practice]')) {
      const cmd = `/interview-prep ${a.Company} - ${a.Title}`;
      await navigator.clipboard.writeText(cmd).then(() => toast('Copied. Paste it into Claude in the Auto Job folder to start the mock interview.'),
        () => toast(`Copy failed. Type this in Claude: ${cmd}`, 'error'));
      return;
    }
    if (e.target.closest('[data-applied]')) {
      e.target.closest('[data-applied]').disabled = true;
      try {
        const r = await api('/api/applied-by-hand', { method: 'POST', json: { key } });
        toast(r.warning || `Marked as applied: ${a.Title}.`, r.warning ? 'error' : 'ok');
      } catch (err) { toast(err.message, 'error'); }
      await loadApps(); loadLibrary(); loadStats(); openDrawer(key); return;
    }
    if (e.target.closest('[data-send]')) {
      e.target.closest('[data-send]').disabled = true;
      try { await api('/api/review/send', { method: 'POST', json: { key } }); toast(`Sending your application for ${a.Title}. About a minute.`); closeDrawer(); }
      catch (err) { toast(err.message, 'error'); }
      refreshStatus(); loadLibrary(); return;
    }
    if (e.target.closest('[data-self]')) {
      try {
        const r = await api('/api/review/self', { method: 'POST', json: { key } });
        toast(r.warning || `Marked as applied by you. Upload the resume PDF and paste the cover email on the job site.`, r.warning ? 'error' : 'ok');
        r.warning ? closeDrawer() : openDrawer(key);   // now an "Apply by hand" application, with its PDF and email still here
      } catch (err) { toast(err.message, 'error'); }
      loadLibrary(); loadApps(); loadStats(); return;
    }
    if (e.target.closest('[data-copy]')) {
      await navigator.clipboard.writeText(`${d.email.subject}\n\n${d.email.body}`).then(() => toast('Cover email copied'), () => toast('Copy failed. Select the text instead.', 'error'));
    }
    if (e.target.closest('[data-retailor]')) {
      try { await api('/api/retailor', { method: 'POST', json: { key } }); toast('Re-tailoring. This takes a few minutes.'); openDrawer(key); }
      catch (err) { toast(err.message, 'error'); }
    }
  };

  clearTimeout(drawerPoll);
  if (retailoring || prepping) drawerPoll = setTimeout(() => { if (drawerKey === key) openDrawer(key); }, 8000);

  const dr = $('#drawer');
  if (dr.getAttribute('aria-hidden') === 'true') {
    dr.setAttribute('aria-hidden', 'false'); $('#scrim').hidden = false; document.body.style.overflow = 'hidden';
    $('#drawerClose').focus();
  }
}
function closeDrawer() {
  clearTimeout(drawerPoll); drawerKey = null;
  $('#drawer').setAttribute('aria-hidden', 'true'); $('#scrim').hidden = true; document.body.style.overflow = '';
  lastFocus?.focus?.();
}
$('#drawerClose').addEventListener('click', closeDrawer);
$('#scrim').addEventListener('click', closeDrawer);
document.addEventListener('keydown', e => {
  if (!drawerKey) return;
  if (e.key === 'Escape') return closeDrawer();
  if (e.key !== 'Tab') return;
  // Keep keyboard focus inside the open review panel (it is a modal dialog).
  const focusable = [...$('#drawer').querySelectorAll('a[href], button:not([disabled]), iframe, summary, [tabindex="0"]')]
    .filter(el => el.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0], last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  else if (!$('#drawer').contains(document.activeElement)) { e.preventDefault(); first.focus(); }
});

/* ------------------------------------------------------------ master resume */
let resumePoll;
async function loadResume() {
  let d; try { d = await api('/api/resume'); } catch (e) { return toast(e.message, 'error'); }
  $('#masterDoc').innerHTML = d.master ? d.master.html : '<p class="muted">No master resume yet. Upload one to start.</p>';
  $('#masterMeta').textContent = d.master ? `Last changed ${when(d.master.updated)}. Used for every application.` : '';

  const cand = $('#candidate'), job = d.job;
  clearTimeout(resumePoll);
  $('#drop').dataset.busy = job?.status === 'converting';
  if (job?.status === 'converting') {
    cand.hidden = false; $('#candTitle').textContent = 'Reading your file';
    $('#candMeta').textContent = job.name;
    $('#candDoc').innerHTML = '<div class="converting"><span class="spinner"></span>Turning it into a clean resume. This takes about a minute.</div>';
    $('#candActions').hidden = true;
    resumePoll = setTimeout(loadResume, 4000);
  } else if (job?.status === 'error') {
    cand.hidden = false; $('#candTitle').textContent = 'Couldn\'t read that file';
    $('#candMeta').textContent = job.name; $('#candDoc').innerHTML = `<p class="callout">${esc(job.error)}</p>`;
    $('#candActions').hidden = false; $('#candAccept').hidden = true;
  } else if (d.candidate) {
    cand.hidden = false; $('#candTitle').textContent = 'Check the new resume';
    $('#candMeta').textContent = 'Compare it with the current one. Nothing changes until you choose Use this resume.';
    $('#candDoc').innerHTML = d.candidate.html; $('#candActions').hidden = false; $('#candAccept').hidden = false;
  } else cand.hidden = true;
}
async function upload(file) {
  if (!file) return;
  if (!/\.(docx|pdf|md|txt)$/i.test(file.name)) return toast('Upload a Word (.docx), PDF, .md or .txt file.', 'error');
  try {
    await api('/api/resume/upload', { method: 'POST', body: file, headers: { 'X-Filename': encodeURIComponent(file.name), 'Content-Type': 'application/octet-stream' } });
    toast('Uploaded. Reading it now.');
  } catch (e) { toast(e.message, 'error'); }
  loadResume();
}
const drop = $('#drop');
drop.addEventListener('click', () => $('#fileInput').click());
drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#fileInput').click(); } });
$('#fileInput').addEventListener('change', e => { upload(e.target.files[0]); e.target.value = ''; });
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.dataset.over = 'true'; }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.dataset.over = 'false'; }));
drop.addEventListener('drop', e => upload(e.dataTransfer.files[0]));
$('#candAccept').addEventListener('click', async () => {
  try { await api('/api/resume/accept', { method: 'POST' }); toast('New master resume in use. The old one is saved in resume/history.'); }
  catch (e) { toast(e.message, 'error'); }
  loadResume();
});
$('#candDiscard').addEventListener('click', async () => {
  try { await api('/api/resume/discard', { method: 'POST' }); toast('Discarded. Your master resume is unchanged.'); } catch (e) { toast(e.message, 'error'); }
  loadResume();
});

/* ------------------------------------------------------------ settings */
let keywords = [];
function renderChips() {
  const box = $('#kwChips'), input = $('#kwInput');
  box.querySelectorAll('.chip').forEach(c => c.remove());
  keywords.forEach((k, i) => {
    const c = document.createElement('span'); c.className = 'chip';
    c.innerHTML = `${esc(k)}<button type="button" aria-label="Remove ${esc(k)}" data-i="${i}"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2 2 10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>`;
    box.insertBefore(c, input);
  });
}
$('#kwChips').addEventListener('click', e => {
  const b = e.target.closest('button[data-i]');
  if (b) { keywords.splice(Number(b.dataset.i), 1); renderChips(); $('#kwInput').focus(); }
  else $('#kwInput').focus();
});
$('#kwInput').addEventListener('keydown', e => {
  const v = e.target.value.trim();
  if ((e.key === 'Enter' || e.key === ',') && v) {
    e.preventDefault();
    if (keywords.length >= 8) return setMsg('You can search up to 8 titles.', 'error');
    if (!keywords.some(k => k.toLowerCase() === v.toLowerCase())) keywords.push(v);
    e.target.value = ''; renderChips();
  } else if (e.key === 'Enter') e.preventDefault();
  else if (e.key === 'Backspace' && !e.target.value && keywords.length) { keywords.pop(); renderChips(); }
});
function setMsg(t, kind = '') { const m = $('#settingsMsg'); m.textContent = t; m.dataset.kind = kind; }
async function loadSettings() {
  let c; try { c = await api('/api/config'); } catch (e) { return toast(e.message, 'error'); }
  keywords = [...c.keywords]; renderChips();
  $('#location').value = c.linkedinLocation || ''; $('#minPay').value = c.minMonthlyPkr; $('#targetPay').value = c.targetMonthlyPkr; $('#cap').value = c.maxApplicationsPerDay; $('#minScore').value = c.minScore;
  $('#cities').value = (c.allowedCities || []).join(', '); $('#allowRemote').checked = !!c.allowRemote;
  $('#rssFeeds').value = (c.alertsRss || []).join('\n');
  $('#asIs').value = c.sendAsIsAt;
  setMsg('');
}
$('#settingsForm').addEventListener('submit', async e => {
  e.preventDefault();
  const pending = $('#kwInput').value.trim(); if (pending && !keywords.includes(pending)) { keywords.push(pending); $('#kwInput').value = ''; renderChips(); }
  if (!keywords.length) return setMsg('Add at least one job title.', 'error');
  if (Number($('#targetPay').value) < Number($('#minPay').value)) return setMsg('Target pay should be at least the minimum pay.', 'error');
  try {
    await api('/api/config', { method: 'POST', json: { keywords, linkedinLocation: $('#location').value, minMonthlyPkr: $('#minPay').value, targetMonthlyPkr: $('#targetPay').value, maxApplicationsPerDay: $('#cap').value, minScore: $('#minScore').value, sendAsIsAt: $('#asIs').value,
      allowedCities: $('#cities').value.split(',').map(s => s.trim()).filter(Boolean), allowRemote: $('#allowRemote').checked,
      alertsRss: $('#rssFeeds').value.split(/\s+/).map(s => s.trim()).filter(Boolean) } });
    setMsg('Settings saved. They apply from the next run.', 'ok'); refreshStatus(); loadStats();
  } catch (err) { setMsg(err.message, 'error'); }
});

/* ------------------------------------------------------------ start */
refreshStatus();
loadStats().then(loadApps);
setInterval(() => {
  if (drawerKey) return;
  loadStats();
  if (!$('#panel-apps').hidden) loadApps();
}, 20000);
