// Work modes: when the team works. "When I ask" (the default) is how a floor has always worked. "Set hours" and "Nonstop" let the manager pick
// the next most useful piece of work toward the company's goal whenever the floor is quiet, and run it through the ordinary engine and staff,
// on the autonomous models (config/models.json). See docs/WORK-MODES.md.
// It borrows the standing orders' machinery: their time zone maths, their list of reasons a floor can't start, and their before-and-after marks
// that tell when a job is over. Nothing here can spend beyond the building's own limits, and a purchase still needs the boss's own click.
import { get, all, run, tx } from './db.js';
import { validTz, tzOffset, wallToUtc } from './orders.js';

const MODES = ['ask', 'hours', 'nonstop'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_WORDS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const WEEKDAYS = [1, 2, 3, 4, 5];
const GOAL_MAX = 300, ITEM_MAX = 160, ITEMS_KEPT = 8, SUMMARY_MAX = 400;
export const MODE_NOTE = 'Work mode:';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS work_modes (
  floor_id INTEGER PRIMARY KEY, mode TEXT NOT NULL DEFAULT 'ask', days TEXT NOT NULL DEFAULT '[1,2,3,4,5]', start_at TEXT NOT NULL DEFAULT '09:00',
  end_at TEXT NOT NULL DEFAULT '17:00', tz TEXT NOT NULL DEFAULT 'UTC', tz_set INTEGER NOT NULL DEFAULT 0, goal TEXT NOT NULL DEFAULT '',
  backlog TEXT NOT NULL DEFAULT '[]', paused_reason TEXT NOT NULL DEFAULT '', fail_streak INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0,
  recapped_run INTEGER NOT NULL DEFAULT 0, open_state INTEGER NOT NULL DEFAULT -1, updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS mode_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, floor_id INTEGER NOT NULL, day TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER,
  status TEXT NOT NULL DEFAULT 'running', summary TEXT NOT NULL DEFAULT '', tasks_done INTEGER NOT NULL DEFAULT 0, tasks_failed INTEGER NOT NULL DEFAULT 0,
  waiting INTEGER NOT NULL DEFAULT 0, published TEXT NOT NULL DEFAULT '[]', after_message_id INTEGER NOT NULL DEFAULT 0, after_task_id INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS mode_runs_floor ON mode_runs(floor_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS mode_runs_one_running ON mode_runs(floor_id) WHERE status='running';
`;

export class ModeError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }

// ---- schedule maths ----
const toMin = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };
/** What a wall clock in tz reads at utcMs. */
export function wallClock(tz, utcMs) {
  const local = new Date(utcMs + tzOffset(tz, utcMs));
  return { weekday: local.getUTCDay(), minutes: local.getUTCHours() * 60 + local.getUTCMinutes(), day: local.toISOString().slice(0, 10), y: local.getUTCFullYear(), m: local.getUTCMonth(), d: local.getUTCDate() };
}
/** Whether set hours are open at utcMs. Hours that end before they start run overnight, and belong to the day they start on. */
export function isOpen(h, utcMs) {
  if (h.mode === 'nonstop') return true;
  if (h.mode !== 'hours') return false;
  const { weekday, minutes } = wallClock(validTz(h.tz) || 'UTC', utcMs);
  const s = toMin(h.start), e = toMin(h.end);
  if (s < e) return h.days.includes(weekday) && minutes >= s && minutes < e;
  return (h.days.includes(weekday) && minutes >= s) || (h.days.includes((weekday + 6) % 7) && minutes < e);
}
/** The first instant after fromMs at which set hours open, or null when they never do. */
export function nextOpening(h, fromMs) {
  if (h.mode !== 'hours' || !h.days.length) return null;
  const tz = validTz(h.tz) || 'UTC';
  const { y, m, d } = wallClock(tz, fromMs);
  const [hh, mm] = h.start.split(':').map(Number);
  for (let i = 0; i <= 8; i++) {
    if (!h.days.includes(new Date(Date.UTC(y, m, d + i)).getUTCDay())) continue;
    const at = wallToUtc(tz, y, m, d + i, hh, mm);
    if (at > fromMs) return at;
  }
  return null;
}

/** Checks a mode from the boss's form or the manager's tool. Returns { hours } or { error }. Days come as 0 (Sunday) to 6, as names, or as "weekdays". */
export function parseMode(input) {
  const i = input && typeof input === 'object' ? input : {};
  const alias = { when_asked: 'ask', on_call: 'ask', 'on call': 'ask', set_hours: 'hours', 'set hours': 'hours', '24/7': 'nonstop', always: 'nonstop' };
  const mode = MODES.includes(i.mode) ? i.mode : alias[String(i.mode || '').toLowerCase()];
  if (!mode) return { error: 'Choose a work mode: "ask" (only when the boss asks), "hours" (set hours) or "nonstop".' };
  const tz = validTz(i.tz);
  if (tz === null) return { error: 'That time zone is not one I know. Use a name like Europe/London or America/New_York.' };
  const out = { mode, tz };
  const time = (v) => { const s = String(v ?? '').trim(); const m = s.match(/^(\d{1,2}):?([0-5]\d)$/); if (!m || Number(m[1]) > 23) return null; return `${m[1].padStart(2, '0')}:${m[2]}`; };
  const days = parseDays(i.days === undefined ? WEEKDAYS : i.days);
  const start = time(i.start ?? '09:00'), end = time(i.end ?? '17:00');
  // The hours are kept while another mode is on, so going back to set hours finds them as they were.
  if (mode !== 'hours') return { hours: { ...out, days: days || WEEKDAYS, start: start && end && start !== end ? start : '09:00', end: start && end && start !== end ? end : '17:00' } };
  if (!days) return { error: 'Pick the days, such as ["mon","tue","wed","thu","fri"], or "weekdays".' };
  if (!start || !end) return { error: 'Give the hours as HH:MM on a 24-hour clock, like 09:00 and 17:00.' };
  if (start === end) return { error: 'Opening and closing times are the same. For around the clock, choose nonstop.' };
  return { hours: { ...out, days, start, end } };
}
function parseDays(v) {
  if (typeof v === 'string') {
    const s = v.toLowerCase().replace(/[^a-z]/g, '');
    if (s === 'weekdays' || s === 'workdays') return WEEKDAYS;
    if (s === 'weekends' || s === 'weekend') return [0, 6];
    if (s === 'everyday' || s === 'daily' || s === 'alldays' || s === 'allweek') return [0, 1, 2, 3, 4, 5, 6];
    return parseDays(v.split(/[,\s]+/).filter(Boolean));
  }
  if (!Array.isArray(v) || !v.length || v.length > 14) return null;
  const set = new Set();
  for (const d of v) {
    const n = typeof d === 'number' ? d : /^\d$/.test(String(d)) ? Number(d) : DAY_WORDS[String(d).toLowerCase().slice(0, 3)];
    if (!Number.isInteger(n) || n < 0 || n > 6) return null;
    set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

// ---- words ----
const clock = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); const h12 = h % 12 || 12; return m ? `${h12}:${String(m).padStart(2, '0')}` : String(h12); };
/** What the sign by the door says. */
export function signLabel(h) {
  if (h.mode === 'nonstop') return 'Open 24/7';
  if (h.mode === 'hours') return `Open ${clock(h.start)}–${clock(h.end)}`;
  return 'On call';
}
export function daysLabel(days) {
  const d = [...days].sort((a, b) => a - b);
  if (d.length === 7) return 'Every day';
  if (d.join() === '1,2,3,4,5') return 'Mon–Fri';
  if (d.join() === '0,6') return 'Weekends';
  const run = d.length >= 3 && d.every((x, i) => i === 0 || x === d[i - 1] + 1);
  return run ? `${DAY_NAMES[d[0]]}–${DAY_NAMES[d.at(-1)]}` : d.map((x) => DAY_NAMES[x]).join(', ');
}
const hhmm12 = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`; };
export function describeMode(h) {
  if (h.mode === 'nonstop') return 'nonstop, around the clock';
  if (h.mode === 'hours') return `${hhmm12(h.start)} to ${hhmm12(h.end)}, ${daysLabel(h.days)} (${h.tz})`;
  return 'only when you ask';
}
const plain = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export function installModes(ext) {
  const { db, cfg, engine, log, now, hooks, GET, POST, json, readJson, limit, requireOwner, HttpError } = ext;
  db.exec(SCHEMA);
  const seenRunning = new Set();  // runs a tick has already seen, so a run never finishes on the tick that started it
  let timer = null, stopped = false;
  const gapMs = () => Math.max(0, Number(cfg.autopilotGapMin ?? 5)) * 60000;
  const maxFails = () => Math.max(1, Number(cfg.autopilotMaxFails ?? 3));

  const rowOf = (floorId) => get(db, 'SELECT * FROM work_modes WHERE floor_id=?', floorId)
    || { floor_id: floorId, mode: 'ask', days: '[1,2,3,4,5]', start_at: '09:00', end_at: '17:00', tz: 'UTC', tz_set: 0, goal: '', backlog: '[]', paused_reason: '', fail_streak: 0, next_at: 0, recapped_run: 0, open_state: -1, updated_at: 0 };
  const hoursOf = (row) => ({ mode: row.mode, days: JSON.parse(row.days || '[]'), start: row.start_at, end: row.end_at, tz: row.tz });
  const patch = (floorId, fields) => {
    run(db, 'INSERT OR IGNORE INTO work_modes (floor_id) VALUES (?)', floorId);
    const keys = Object.keys(fields);
    run(db, `UPDATE work_modes SET ${keys.map((k) => `${k}=?`).join(', ')}, updated_at=? WHERE floor_id=?`, ...keys.map((k) => fields[k]), now(), floorId);
  };
  const runningRun = (floorId) => get(db, "SELECT * FROM mode_runs WHERE floor_id=? AND status='running'", floorId);
  // Everyone in the room is told; what the goal and the list say is the boss's alone.
  const changed = (floorId) => engine.emit(floorId, 'work_mode', {}, { persist: false });
  const planChanged = (floorId) => engine.emit(floorId, 'work_plan', {}, { persist: false, ownerOnly: true });

  /** Work that can go ahead now. A task waiting on the boss's answer, and anything queued behind it, doesn't hold the team up, and nor does a request waiting for a Buy click. */
  function busy(floorId) {
    if (get(db, 'SELECT manager_wake w FROM floors WHERE id=?', floorId)?.w) return true;
    for (const r of engine.runs.values()) if (r.floorId === floorId) return true;
    if (get(db, "SELECT 1 x FROM tasks WHERE floor_id=? AND status='doing' LIMIT 1", floorId)) return true;
    const todo = all(db, "SELECT id,depends_on FROM tasks WHERE floor_id=? AND status='todo'", floorId);
    if (!todo.length) return false;
    const blocked = new Set(all(db, "SELECT id FROM tasks WHERE floor_id=? AND status='blocked'", floorId).map((r) => r.id));
    const deps = new Map(todo.map((t) => [t.id, JSON.parse(t.depends_on || '[]')]));
    const waits = (id, seen) => blocked.has(id) || (!seen.has(id) && deps.has(id) && (seen.add(id), deps.get(id).some((d) => waits(d, seen))));
    return todo.some((t) => !waits(t.id, new Set()));
  }
  /** Why a job can't start on this floor now, or null. Each clears by itself, or by a hand the boss or the building manager already has. */
  function blocker(floor) {
    if (floor.status !== 'active' || floor.filler || !floor.name) return 'closed';
    if (engine.globalPaused() || floor.paused) return 'paused';
    const state = engine.floorState(floor.id);
    if (state.budgetStopped) return 'gone home for today';
    if (engine.budget.out(engine.agentProvider({ role: 'manager' }))) return 'work has stopped for now';
    if (busy(floor.id)) return 'busy';
    // A standing order that has come due goes first. It needs the same quiet floor.
    if (get(db, "SELECT 1 x FROM standing_orders WHERE floor_id=? AND status='active' AND next_run_at<=?", floor.id, now())) return 'a standing order is due';
    return null;
  }

  // ---- what the boss and the visitors see ----
  function publicView(floorId) {
    const row = rowOf(floorId); const h = hoursOf(row); const t = now();
    const paused = !!row.paused_reason;
    const open = !paused && isOpen(h, t);
    return {
      mode: h.mode, label: paused ? 'On call' : signLabel(h), days: h.mode === 'hours' ? daysLabel(h.days) : '',
      // Outside set hours everyone goes home. Anything the boss asks for still gets done: they come back in for it.
      closed: h.mode === 'hours' && !paused && !open, opensAt: h.mode === 'hours' && !paused && !open ? nextOpening(h, t) : null, paused,
    };
  }
  function ownerView(floorId) {
    const row = rowOf(floorId); const h = hoursOf(row);
    const last = get(db, "SELECT * FROM mode_runs WHERE floor_id=? AND status!='running' ORDER BY id DESC LIMIT 1", floorId);
    return {
      ...publicView(floorId), start: h.start, end: h.end, dayList: h.days, tz: h.tz, tzSet: !!row.tz_set, goal: row.goal, nextUp: JSON.parse(row.backlog || '[]'),
      pausedReason: row.paused_reason, running: !!runningRun(floorId), text: describeMode(h),
      lastJob: last ? { status: last.status, summary: last.summary, finishedAt: last.finished_at } : null,
    };
  }

  // ---- the boss's and the manager's operations ----
  function set(floor, input, { by = 'boss' } = {}) {
    const row = rowOf(floor.id);
    const tzIn = input?.tz === undefined || input?.tz === null || input?.tz === '' ? row.tz : input.tz;
    const was = hoursOf(row);
    const r = parseMode({ mode: input?.mode, days: input?.days ?? was.days, start: input?.start ?? was.start, end: input?.end ?? was.end, tz: tzIn });
    if (r.error) throw new ModeError(400, 'bad_mode', r.error);
    const h = r.hours;
    // A new mode or new hours start straight away; saving the same ones again (a new goal, say) keeps the gap after the last job.
    const fresh = JSON.stringify(was) !== JSON.stringify({ mode: h.mode, days: h.days, start: h.start, end: h.end, tz: h.tz }) || !!row.paused_reason;
    const fields = { mode: h.mode, days: JSON.stringify(h.days), start_at: h.start, end_at: h.end, tz: h.tz, paused_reason: '', fail_streak: 0, next_at: fresh ? now() : row.next_at, open_state: -1 };
    if (input?.tz !== undefined && input?.tz !== null && input?.tz !== '') fields.tz_set = 1;
    if (typeof input?.goal === 'string') fields.goal = plain(input.goal, GOAL_MAX);
    patch(floor.id, fields);
    if (fresh) {
      const line = h.mode === 'nonstop' ? 'Now working nonstop: whenever the floor is quiet, I pick the next most useful job toward our goal and the team gets on with it.'
        : h.mode === 'hours' ? `Now working ${describeMode(h)}. Inside those hours I keep the team on the next most useful job; outside them everyone goes home, and you can still call me.`
          : 'Back on call: the team works when you ask.';
      engine.officeNotice(floor.id, line);
      log('info', 'work mode', { floorId: floor.id, mode: h.mode, by });
    }
    changed(floor.id); planChanged(floor.id);
    engine.kick();
    return ownerView(floor.id);
  }
  /** The manager's goal and next-up list, and its line on the job it just did. */
  function updatePlan(floor, { goal, nextUp, summary } = {}) {
    const fields = {};
    if (typeof goal === 'string' && goal.trim()) fields.goal = plain(goal, GOAL_MAX);
    if (Array.isArray(nextUp)) fields.backlog = JSON.stringify(nextUp.map((x) => plain(x, ITEM_MAX)).filter(Boolean).slice(0, ITEMS_KEPT));
    if (Object.keys(fields).length) patch(floor.id, fields);
    const r = runningRun(floor.id);
    if (r && typeof summary === 'string' && summary.trim()) run(db, 'UPDATE mode_runs SET summary=? WHERE id=?', plain(summary, SUMMARY_MAX), r.id);
    planChanged(floor.id);
    return ownerView(floor.id);
  }
  /** The boss's own time zone, learnt from their browser until they pick one. */
  function learnZone(floor, tz) {
    const z = validTz(tz);
    const row = rowOf(floor.id);
    if (!z || row.tz_set || row.tz === z) return false;
    patch(floor.id, { tz: z });
    changed(floor.id);
    return true;
  }
  function stateLine(floorId) {
    const row = rowOf(floorId); const h = hoursOf(row);
    const list = JSON.parse(row.backlog || '[]');
    const mode = row.paused_reason ? `paused (${row.paused_reason})` : h.mode === 'ask' ? 'on call: the team works only when the boss asks' : `${describeMode(h)}${isOpen(h, now()) ? ', open now' : ', closed now'}`;
    return `Work mode: ${mode}. Goal: ${row.goal || 'none yet'}. Next up: ${list.length ? list.map((x, i) => `${i + 1}. ${x}`).join(' ') : 'nothing listed'}.`;
  }

  // ---- the runner ----
  function startRun(floor, row) {
    const t = now(); const h = hoursOf(row);
    const mark = (sql) => get(db, sql, floor.id).n;
    const afterMsg = mark('SELECT COALESCE(MAX(id),0) n FROM messages WHERE floor_id=?');
    const afterTask = mark('SELECT COALESCE(MAX(id),0) n FROM tasks WHERE floor_id=?');
    tx(db, () => {
      run(db, 'INSERT INTO mode_runs (floor_id,day,started_at,after_message_id,after_task_id) VALUES (?,?,?,?,?)', floor.id, wallClock(h.tz, t).day, t, afterMsg, afterTask);
      patch(floor.id, { next_at: t + gapMs() });
    });
    const list = JSON.parse(row.backlog || '[]');
    // In the manager's own reading, after the stable part of its prompt, so the cache holds. It is never shown as the boss's words.
    engine.addMessage(floor.id, 'note', null, `${MODE_NOTE} the boss has set the team to work on its own (${signLabel(h)}), and the floor is quiet. Pick the next most useful piece of work toward the company's goal and get it done now, through your staff as usual. `
      + `Goal: ${row.goal || 'not set yet: write one from what the company does and what the boss has asked for so far'}. Next up: ${list.length ? list.map((x, i) => `${i + 1}. ${x}`).join(' ') : 'nothing listed yet: start the list'}. `
      + 'Make the calls yourself and say what you assumed. Only buying something (a request that waits for the boss\'s Buy click) and questions only the boss can answer go to the boss, and while one waits, the team moves on to other work. '
      + 'Keep the job small enough to finish in one go. When it is done, call update_backlog with the goal, the next-up list and a line or two for the boss on what this job did.');
    run(db, 'UPDATE floors SET manager_wake=1 WHERE id=?', floor.id);
    const mgr = get(db, "SELECT id,name FROM agents WHERE floor_id=? AND role='manager'", floor.id);
    engine.feed(floor.id, mgr, 'picked the next job to work on', '');
    engine.kick();
    planChanged(floor.id);
  }
  function finishRun(r, floor, { timedOut, brokeDown }) {
    const t = now();
    const tasks = all(db, 'SELECT id,title,status FROM tasks WHERE floor_id=? AND id>? AND auto=1', floor.id, r.after_task_id);
    const done = tasks.filter((x) => x.status === 'done' || x.status === 'review').length;
    const failed = tasks.filter((x) => x.status === 'failed').length;
    const waiting = tasks.filter((x) => x.status === 'blocked').length + get(db, "SELECT COUNT(*) n FROM questions WHERE floor_id=? AND answer IS NULL AND created_at>=?", floor.id, r.started_at).n;
    const published = all(db, 'SELECT slug,title FROM projects WHERE floor_id=? AND published_at IS NOT NULL AND published_at>=? ORDER BY published_at', floor.id, r.started_at).map((p) => ({ slug: p.slug, title: p.title, url: engine.liveUrl(floor, p.slug) }));
    const status = timedOut || brokeDown || failed > 0 ? 'failed' : 'done';
    const row = rowOf(floor.id);
    const streak = status === 'failed' ? row.fail_streak + 1 : 0;
    tx(db, () => {
      run(db, 'UPDATE mode_runs SET finished_at=?, status=?, tasks_done=?, tasks_failed=?, waiting=?, published=? WHERE id=?', t, status, done, failed, waiting, JSON.stringify(published), r.id);
      patch(floor.id, { fail_streak: streak, next_at: t + gapMs() });
    });
    seenRunning.delete(r.id);
    // The digest: a line or two, in the manager's voice. Never a figure about money.
    const next = JSON.parse(rowOf(floor.id).backlog || '[]')[0];
    const did = r.summary ? (/[.!?]$/.test(r.summary.trim()) ? r.summary.trim() : `${r.summary.trim()}.`)
      : status === 'failed' ? `${timedOut ? 'That job ran too long and I stopped it.' : brokeDown ? 'That job stopped when the floor was paused.' : `${failed === 1 ? 'One task' : `${failed} tasks`} couldn't finish.`}`
        : done ? `Finished ${tasks.filter((x) => x.status === 'done' || x.status === 'review').slice(0, 3).map((x) => `"${x.title}"`).join(', ')}.` : 'Looked over where things stand.';
    const live = published.length ? ` Live: ${published.slice(0, 3).map((p) => `[${p.title.replace(/[[\]]/g, '')}](${p.url})`).join(', ')}.` : '';
    const wait = waiting ? ' One thing waits on you, and the team has moved on to other work.' : '';
    engine.officeNotice(floor.id, `**On our own:** ${did}${live}${wait}${next ? ` Next up: ${next}.` : ''}`);
    if (streak >= maxFails() && row.mode !== 'ask' && !row.paused_reason) {
      patch(floor.id, { paused_reason: `${streak} jobs in a row didn't finish` });
      engine.officeNotice(floor.id, `${streak} jobs in a row didn't finish, so I've stopped picking work on our own. Have a look at what went wrong in the Work tab, then turn the work mode back on under Customise, or tell me to carry on.`);
      log('warn', 'work mode paused', { floorId: floor.id, streak });
      changed(floor.id);
    }
    // Set hours that closed while this job ran over get their recap now.
    const h = hoursOf(rowOf(floor.id));
    if (h.mode === 'hours' && !isOpen(h, t)) maybeRecap(floor, rowOf(floor.id), { closing: true });
    planChanged(floor.id);
  }
  /** One recap a day, once the day is over or the set hours have closed, of the jobs the team did on its own. Only for the boss. */
  function maybeRecap(floor, row, { closing }) {
    const h = hoursOf(row); const today = wallClock(h.tz, now()).day;
    const pending = all(db, "SELECT * FROM mode_runs WHERE floor_id=? AND id>? AND status!='running' ORDER BY id", floor.id, row.recapped_run);
    const runs = closing ? pending : pending.filter((x) => x.day < today);
    if (!runs.length) return;
    const done = runs.filter((x) => x.status === 'done').length, failed = runs.length - done;
    const published = []; const seen = new Set();
    for (const x of runs) for (const p of JSON.parse(x.published || '[]')) if (!seen.has(p.slug)) { seen.add(p.slug); published.push(p); }
    const next = JSON.parse(row.backlog || '[]')[0];
    const [y, m, d] = runs.at(-1).day.split('-').map(Number);
    const when = `${DAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d}`;
    const lines = [`**Recap for ${when}:** the team did ${runs.length} ${runs.length === 1 ? 'job' : 'jobs'} on its own: ${done} done${failed ? `, ${failed} didn't finish` : ''}.`];
    if (published.length) lines.push(`- Published: ${published.slice(0, 6).map((p) => `[${p.title.replace(/[[\]]/g, '')}](${p.url})`).join(', ')}.`);
    if (next) lines.push(`- Next up: ${next}.`);
    patch(floor.id, { recapped_run: runs.at(-1).id });
    engine.reportToBoss(floor.id, lines.join('\n'));
  }
  function step(floor, row) {
    const t = now(); const h = hoursOf(row);
    // Opening and closing time: everyone in the room sees the sign change, and closing time brings the recap.
    const open = !row.paused_reason && isOpen(h, t);
    let closing = false;
    if (h.mode === 'hours' && row.open_state !== (open ? 1 : 0)) {
      patch(floor.id, { open_state: open ? 1 : 0 });
      changed(floor.id);
      closing = !open && row.open_state === 1;
    }
    const r = runningRun(floor.id);
    if (r) {
      const timedOut = t - r.started_at >= Number(cfg.autopilotRunTimeoutMin ?? 180) * 60000;
      const brokeDown = !!floor.paused && floor.pause_reason !== 'Paused by the boss';
      if (!timedOut && !brokeDown) {
        if (!seenRunning.has(r.id)) { seenRunning.add(r.id); return; }
        if (busy(floor.id)) return;
      }
      finishRun(r, floor, { timedOut, brokeDown });
      return;
    }
    maybeRecap(floor, rowOf(floor.id), { closing });
    if (h.mode === 'ask' || row.paused_reason || !open || t < row.next_at) return;
    if (blocker(floor)) return;
    startRun(floor, rowOf(floor.id));
  }
  function tick() {
    if (stopped || engine.stopped) return;
    try {
      const rows = all(db, "SELECT w.* FROM work_modes w WHERE w.mode!='ask' OR EXISTS (SELECT 1 FROM mode_runs r WHERE r.floor_id=w.floor_id AND (r.status='running' OR r.id>w.recapped_run))");
      for (const row of rows) {
        const floor = get(db, 'SELECT * FROM floors WHERE id=?', row.floor_id);
        if (!floor) { tx(db, () => { run(db, 'DELETE FROM mode_runs WHERE floor_id=?', row.floor_id); run(db, 'DELETE FROM work_modes WHERE floor_id=?', row.floor_id); }); continue; }
        step(floor, row);
      }
    } catch (e) { log('error', 'modes', { err: String(e?.message || e).slice(0, 200) }); }
  }

  // ---- hooks and routes ----
  hooks.snapshot.push((f, viewer, out) => {
    out.floor.workMode = publicView(f.id);
    if (viewer.owner) out.workPlan = ownerView(f.id);
  });
  hooks.floorCard.push((f, card) => { const v = publicView(f.id); card.workMode = { label: v.label, closed: v.closed }; });
  const wrap = (fn) => { try { return fn(); } catch (e) { if (e instanceof ModeError) throw new HttpError(e.status, e.code, e.message); throw e; } };
  GET('/api/floors/:slug/work-mode', async ({ req, res, p }) => {
    const f = requireOwner(req, p.slug);
    json(res, 200, { workMode: ownerView(f.id) });
  });
  POST('/api/floors/:slug/work-mode', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug); limit('mutate', ip);
    const b = await readJson(req, 8 * 1024);
    json(res, 200, { workMode: wrap(() => set(f, { mode: b.mode, days: b.days, start: b.start, end: b.end, tz: b.tz, goal: b.goal }, { by: 'boss' })) });
  });
  POST('/api/floors/:slug/work-mode/zone', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug); limit('mutate', ip);
    const b = await readJson(req, 1024);
    json(res, 200, { learnt: learnZone(f, b.tz) });
  });

  engine.modes = {
    set, updatePlan, learnZone, stateLine, tick, busy, publicView, ownerView,
    running: (floorId) => !!runningRun(floorId),
    // Staff go home outside set hours, unless the boss has brought them back in for something.
    closed: (floorId) => publicView(floorId).closed && !busy(floorId),
    brief: (floorId) => { const row = rowOf(floorId); return { goal: row.goal, nextUp: JSON.parse(row.backlog || '[]'), label: signLabel(hoursOf(row)) }; },
  };
  return {
    start() {
      stopped = false;
      timer = setInterval(tick, cfg.modesTickMs ?? 5000);
      timer.unref?.();
    },
    stop() { stopped = true; clearInterval(timer); timer = null; },
  };
}
