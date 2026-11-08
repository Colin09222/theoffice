// Standing orders: recurring jobs the boss sets, run through the ordinary engine on a schedule. See docs/DEPLOY-PLUS.md.
// An order fires as a boss message ("Standing order #N: ..."), so the manager plans it through the same tool loop, limits and caps as
// anything typed in chat. Nothing here can spend beyond those rules, and a domain still needs the boss's own click.
import { get, all, run, tx } from './db.js';
import { capOrNull } from './config.js';

const DAY = 86400000, HOUR = 3600000;
// A due order whose floor is busy waits this long for a gap before that occurrence is written off.
const GRACE_MS = 6 * HOUR;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const IDLE_PREFIX = 'Paused: you have not opened the floor in';
export const idleReason = (days) => `${IDLE_PREFIX} ${days} days`;
const PERIOD_HOURS = { day: 24, week: 168 };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS standing_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT, floor_id INTEGER NOT NULL, text TEXT NOT NULL, schedule TEXT NOT NULL,
  next_run_at INTEGER NOT NULL, last_run_at INTEGER, status TEXT NOT NULL DEFAULT 'active', pause_reason TEXT NOT NULL DEFAULT '',
  fail_streak INTEGER NOT NULL DEFAULT 0, runs INTEGER NOT NULL DEFAULT 0, est_usd REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, set_by TEXT NOT NULL DEFAULT 'boss'
);
CREATE INDEX IF NOT EXISTS standing_orders_floor ON standing_orders(floor_id, id);
CREATE INDEX IF NOT EXISTS standing_orders_due ON standing_orders(status, next_run_at);
CREATE TABLE IF NOT EXISTS standing_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, floor_id INTEGER NOT NULL,
  started_at INTEGER NOT NULL, finished_at INTEGER, status TEXT NOT NULL DEFAULT 'running',
  cost_usd REAL NOT NULL DEFAULT 0, est_usd REAL NOT NULL DEFAULT 0, tasks_done INTEGER NOT NULL DEFAULT 0, tasks_failed INTEGER NOT NULL DEFAULT 0,
  published TEXT NOT NULL DEFAULT '[]', report TEXT NOT NULL DEFAULT '',
  after_message_id INTEGER NOT NULL DEFAULT 0, after_task_id INTEGER NOT NULL DEFAULT 0, after_ledger_id INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS standing_runs_order ON standing_runs(order_id, id);
CREATE INDEX IF NOT EXISTS standing_runs_status ON standing_runs(status);
CREATE UNIQUE INDEX IF NOT EXISTS standing_runs_one_running ON standing_runs(order_id) WHERE status='running';
`;

export class OrderError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }

// ---- schedule maths: UTC, or any IANA zone the runtime knows, through Intl ----
export function validTz(tz) {
  if (tz === undefined || tz === null || tz === '' || tz === 'UTC') return 'UTC';
  if (typeof tz !== 'string' || tz.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(tz)) return null;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { return null; }
}
const fmtCache = new Map();
export function tzOffset(tz, utcMs) {
  if (tz === 'UTC') return 0;
  let f = fmtCache.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }); fmtCache.set(tz, f); }
  const p = {}; for (const x of f.formatToParts(new Date(utcMs))) p[x.type] = x.value;
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(utcMs / 1000) * 1000;
}
// The instant at which a wall clock in tz reads the given date and time.
export function wallToUtc(tz, y, m, d, hh, mm) {
  const guess = Date.UTC(y, m, d, hh, mm);
  const once = guess - tzOffset(tz, guess);
  return guess - tzOffset(tz, once);  // a second pass settles a guess that landed across a clock change
}
/** The first instant strictly after fromMs at which the schedule falls due. */
export function nextRunAt(schedule, fromMs) {
  const tz = validTz(schedule.tz) || 'UTC';
  const [hh, mm] = String(schedule.at).split(':').map(Number);
  const local = new Date(fromMs + tzOffset(tz, fromMs));
  const y = local.getUTCFullYear(), m = local.getUTCMonth(), d = local.getUTCDate();
  for (let i = 0; i <= 8; i++) {
    const wd = new Date(Date.UTC(y, m, d + i)).getUTCDay();
    if (schedule.every === 'week' && wd !== schedule.weekday) continue;
    const at = wallToUtc(tz, y, m, d + i, hh, mm);
    if (at > fromMs) return at;
  }
  return fromMs + 7 * DAY;  // unreachable: eight days always hold a slot
}
/** Checks a schedule from the boss or the manager. Returns { schedule } or { error }. */
export function parseSchedule(input, cfg = {}) {
  const i = input && typeof input === 'object' ? input : {};
  const every = i.every === 'day' || i.every === 'week' ? i.every : null;
  if (!every) return { error: 'Choose every day or every week.' };
  const at = typeof i.at === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(i.at) ? i.at : null;
  if (!at) return { error: 'Give a time as HH:MM, like 09:00.' };
  const tz = validTz(i.tz);
  if (tz === null) return { error: 'That time zone is not one I know. Use a name like Europe/London, or leave it as UTC.' };
  const minHours = Number(cfg.ordersMinHours) || 24;
  if (PERIOD_HOURS[every] < minHours) return { error: `Orders can run at most once every ${minHours} hours.` };
  const schedule = { every, at, tz };
  if (every === 'week') {
    const wd = Number(i.weekday);
    if (!Number.isInteger(wd) || wd < 0 || wd > 6) return { error: 'Pick a weekday, 0 (Sunday) to 6 (Saturday).' };
    schedule.weekday = wd;
  }
  return { schedule };
}
export const describeSchedule = (s) => `Every ${s.every === 'week' ? WEEKDAYS[s.weekday] : 'day'} at ${s.at} ${s.tz || 'UTC'}`;

const runView = (r) => ({ id: r.id, orderId: r.order_id, startedAt: r.started_at, finishedAt: r.finished_at, status: r.status, tasksDone: r.tasks_done, tasksFailed: r.tasks_failed, published: JSON.parse(r.published || '[]'), report: r.report });

export function installOrders(ext) {
  const { db, cfg, engine, log, now, hooks, GET, POST, json, readJson, limit, requireOwner, HttpError, clean2 } = ext;
  db.exec(SCHEMA);
  if (!all(db, 'PRAGMA table_info(standing_orders)').some((c) => c.name === 'set_by')) db.exec("ALTER TABLE standing_orders ADD COLUMN set_by TEXT NOT NULL DEFAULT 'boss'");
  const seenRunning = new Set();  // runs seen by a previous tick, so a run never finishes on the tick that started it
  let timer = null; let stopped = false;

  const changed = (floorId) => engine.emit(floorId, 'orders', {}, { persist: false, ownerOnly: true });
  const orderRow = (floorId, id) => get(db, 'SELECT * FROM standing_orders WHERE id=? AND floor_id=?', id, floorId);
  const countFor = (floorId) => get(db, "SELECT COUNT(*) n FROM standing_orders WHERE floor_id=? AND status IN ('active','paused')", floorId).n;
  const estimate = (orderId) => {
    const rows = all(db, "SELECT cost_usd FROM standing_runs WHERE order_id=? AND status='done' ORDER BY id DESC LIMIT 5", orderId);
    return rows.length ? rows.reduce((s, r) => s + r.cost_usd, 0) / rows.length : cfg.ordersEstimateUsd;
  };
  const view = (o) => ({
    id: o.id, text: o.text, schedule: JSON.parse(o.schedule), scheduleText: describeSchedule(JSON.parse(o.schedule)), nextRunAt: o.next_run_at, lastRunAt: o.last_run_at,
    status: o.status, pauseReason: o.pause_reason, failStreak: o.fail_streak, runs: o.runs, createdAt: o.created_at, updatedAt: o.updated_at,
    running: !!get(db, "SELECT 1 x FROM standing_runs WHERE order_id=? AND status='running'", o.id),
    history: all(db, 'SELECT * FROM standing_runs WHERE order_id=? ORDER BY id DESC LIMIT 10', o.id).map(runView),
  });
  const list = (floorId) => all(db, 'SELECT * FROM standing_orders WHERE floor_id=? ORDER BY id', floorId).map(view);
  const limits = () => ({ perFloor: capOrNull(cfg.ordersPerFloor), minHours: cfg.ordersMinHours, idleDays: cfg.ordersIdleDays, maxFails: capOrNull(cfg.ordersMaxFails) });

  // The boss is here. Orders that were only waiting for that carry on, from the next slot rather than the one they missed.
  function touch(floorId) {
    const t = now();
    run(db, 'UPDATE floors SET last_opened_at=? WHERE id=?', t, floorId);
    const idle = all(db, "SELECT * FROM standing_orders WHERE floor_id=? AND status='paused' AND pause_reason LIKE ?", floorId, `${IDLE_PREFIX}%`);
    for (const o of idle) run(db, "UPDATE standing_orders SET status='active', pause_reason='', fail_streak=0, next_run_at=?, updated_at=? WHERE id=?", nextRunAt(JSON.parse(o.schedule), t), t, o.id);
    if (idle.length) changed(floorId);
  }
  function pauseOrder(o, reason) {
    run(db, "UPDATE standing_orders SET status='paused', pause_reason=?, updated_at=? WHERE id=?", reason, now(), o.id);
    changed(o.floor_id);
  }

  // ---- the boss's and the manager's operations ----
  const cleanText = (v) => {
    const text = clean2(v);
    if (text.length < 3) throw new OrderError(400, 'bad_text', 'Say what the staff should do, in a few words at least.');
    if (text.length > 2000) throw new OrderError(413, 'too_large', 'Keep a standing order under 2000 characters.');
    return text;
  };
  const schedOf = (input) => { const r = parseSchedule(input, cfg); if (r.error) throw new OrderError(400, 'bad_schedule', r.error); return r.schedule; };
  function create(floor, { text, schedule, setBy = 'boss' }) {
    const clean = cleanText(text); const sched = schedOf(schedule);
    if (countFor(floor.id) >= cfg.ordersPerFloor) throw new OrderError(409, 'too_many', `A floor can have ${cfg.ordersPerFloor} standing orders. Delete one first.`);
    const t = now();
    const r = run(db, 'INSERT INTO standing_orders (floor_id,text,schedule,next_run_at,est_usd,created_at,updated_at,set_by) VALUES (?,?,?,?,?,?,?,?)', floor.id, clean, JSON.stringify(sched), nextRunAt(sched, t), cfg.ordersEstimateUsd, t, t, setBy);
    touch(floor.id);
    changed(floor.id);
    return view(orderRow(floor.id, Number(r.lastInsertRowid)));
  }
  function update(floor, id, patch) {
    const o = orderRow(floor.id, id);
    if (!o) throw new OrderError(404, 'not_found', 'No such standing order.');
    const t = now();
    const text = patch.text === undefined ? o.text : cleanText(patch.text);
    const sched = patch.schedule === undefined ? JSON.parse(o.schedule) : schedOf(patch.schedule);
    let status = o.status, reason = o.pause_reason, streak = o.fail_streak;
    if (patch.status !== undefined) {
      if (patch.status !== 'active' && patch.status !== 'paused') throw new OrderError(400, 'bad_status', 'Status is active or paused.');
      status = patch.status;
      if (status === 'active') { reason = ''; streak = 0; } else if (o.status === 'active') reason = 'Paused by you';
    }
    // A new schedule, or coming back from a pause, starts from the next slot: never from one that slipped by while it was off.
    const next = patch.schedule !== undefined || (status === 'active' && o.status !== 'active') || o.next_run_at < t ? nextRunAt(sched, t) : o.next_run_at;
    // Only the boss's own route comes through here, and saving the words makes them the boss's.
    run(db, 'UPDATE standing_orders SET text=?, schedule=?, next_run_at=?, status=?, pause_reason=?, fail_streak=?, updated_at=?, set_by=? WHERE id=?', text, JSON.stringify(sched), next, status, reason, streak, t, patch.text === undefined ? o.set_by : 'boss', o.id);
    changed(floor.id);
    return view(orderRow(floor.id, o.id));
  }
  function remove(floor, id) {
    const o = orderRow(floor.id, id);
    if (!o) throw new OrderError(404, 'not_found', 'No such standing order.');
    tx(db, () => { run(db, 'DELETE FROM standing_runs WHERE order_id=?', o.id); run(db, 'DELETE FROM standing_orders WHERE id=?', o.id); });
    changed(floor.id);
    return true;
  }
  const busy = (floorId) => {
    if (get(db, "SELECT 1 x FROM tasks WHERE floor_id=? AND status IN ('todo','doing','blocked','review') LIMIT 1", floorId)) return true;
    if (get(db, 'SELECT manager_wake w FROM floors WHERE id=?', floorId)?.w) return true;
    for (const r of engine.runs.values()) if (r.floorId === floorId) return true;
    return false;
  };
  /** Why an order can't start on this floor right now, or null. Every one of these clears by itself or by a hand the boss already has. */
  function blocker(floor) {
    if (floor.status !== 'active') return 'the floor is closed by the building manager';
    if (floor.filler) return 'this is a scripted floor';
    if (engine.globalPaused()) return 'the building is paused';
    if (floor.paused) return 'the floor is paused';
    if (engine.floorState(floor.id).budgetStopped) return 'everyone has gone home for today';
    if (engine.budget.out(engine.agentProvider({ role: 'manager' }))) return 'work has stopped for now';
    if (busy(floor.id)) return 'the floor was busy';
    return null;
  }
  function startRun(floor, o, { advance }) {
    const t = now();
    const mark = (sql) => get(db, sql, floor.id).n;
    const afterMsg = mark('SELECT COALESCE(MAX(id),0) n FROM messages WHERE floor_id=?');
    const afterTask = mark('SELECT COALESCE(MAX(id),0) n FROM tasks WHERE floor_id=?');
    const afterLedger = mark('SELECT COALESCE(MAX(id),0) n FROM ledger WHERE floor_id=?');
    // One transaction: the run row and the advanced next slot land together, so a crash or a second process can never fire this slot twice.
    const runId = tx(db, () => {
      const r = run(db, 'INSERT INTO standing_runs (order_id,floor_id,started_at,status,est_usd,after_message_id,after_task_id,after_ledger_id) VALUES (?,?,?,?,?,?,?,?)', o.id, floor.id, t, 'running', o.est_usd, afterMsg, afterTask, afterLedger);
      if (advance) run(db, 'UPDATE standing_orders SET next_run_at=?, updated_at=? WHERE id=?', nextRunAt(JSON.parse(o.schedule), Math.max(t, o.next_run_at)), t, o.id);
      return Number(r.lastInsertRowid);
    });
    if (o.set_by === 'boss') engine.bossMessage(floor, `Standing order #${o.id}: ${o.text}`);
    else {
      // Words the manager wrote never come back as the boss's. They would count as what the boss said, in the manager's reading and in the check on published claims.
      engine.addMessage(floor.id, 'note', null, `Standing order #${o.id}, which you set up, has come due. Carry it out now: ${o.text}`);
      run(db, 'UPDATE floors SET manager_wake=1 WHERE id=?', floor.id);
      engine.kick();
    }
    changed(floor.id);
    return runId;
  }
  function runNow(floor, id) {
    const o = orderRow(floor.id, id);
    if (!o) throw new OrderError(404, 'not_found', 'No such standing order.');
    if (get(db, "SELECT 1 x FROM standing_runs WHERE order_id=? AND status='running'", o.id)) throw new OrderError(409, 'running', 'That order is running right now.');
    const fresh = get(db, 'SELECT * FROM floors WHERE id=?', floor.id);
    const why = blocker(fresh);
    if (why) throw new OrderError(409, 'busy', `Not now: ${why}. Try again when the floor is quiet.`);
    touch(floor.id);
    const runId = startRun(fresh, o, { advance: false });
    return runView(get(db, 'SELECT * FROM standing_runs WHERE id=?', runId));
  }
  function skipOccurrence(floor, o, why) {
    const t = now();
    tx(db, () => {
      run(db, 'INSERT INTO standing_runs (order_id,floor_id,started_at,finished_at,status,est_usd,report) VALUES (?,?,?,?,?,?,?)', o.id, floor.id, t, t, 'failed', o.est_usd, `Skipped: ${why}.`);
      run(db, 'UPDATE standing_orders SET next_run_at=?, updated_at=? WHERE id=?', nextRunAt(JSON.parse(o.schedule), t), t, o.id);
    });
    changed(floor.id);
  }

  // ---- the runner ----
  function fireDue() {
    const t = now();
    const due = all(db, "SELECT o.* FROM standing_orders o JOIN floors f ON f.id=o.floor_id WHERE o.status='active' AND o.next_run_at<=? AND f.filler=0 ORDER BY o.id", t);
    for (const o of due) {
      const floor = get(db, 'SELECT * FROM floors WHERE id=?', o.floor_id);
      if (!floor) { run(db, 'DELETE FROM standing_orders WHERE id=?', o.id); continue; }
      if (t - floor.last_opened_at > cfg.ordersIdleDays * DAY) {
        pauseOrder(o, idleReason(cfg.ordersIdleDays));
        engine.officeNotice(floor.id, `Standing order #${o.id} is paused: you have not opened the floor in ${cfg.ordersIdleDays} days. Now that you're back it will carry on from its next slot.`);
        continue;
      }
      if (o.fail_streak >= cfg.ordersMaxFails) { pauseOrder(o, `Paused: ${o.fail_streak} runs in a row failed`); continue; }
      const why = blocker(floor);
      if (why) { if (t - o.next_run_at >= GRACE_MS) skipOccurrence(floor, o, why); continue; }
      if (get(db, "SELECT 1 x FROM standing_runs WHERE order_id=? AND status='running'", o.id)) continue;  // a Run-now is still going
      startRun(floor, o, { advance: true });
    }
  }
  function finishRuns() {
    const running = all(db, "SELECT r.*, o.text FROM standing_runs r JOIN standing_orders o ON o.id=r.order_id WHERE r.status='running' ORDER BY r.id");
    for (const r of running) {
      const floor = get(db, 'SELECT * FROM floors WHERE id=?', r.floor_id);
      if (!floor) { run(db, 'DELETE FROM standing_runs WHERE id=?', r.id); continue; }
      const t = now();
      const timedOut = t - r.started_at >= cfg.ordersRunTimeoutMin * 60000;
      const brokeDown = !!floor.paused && floor.pause_reason !== 'Paused by the boss';
      if (!timedOut && !brokeDown) {
        if (!seenRunning.has(r.id)) { seenRunning.add(r.id); continue; }
        if (busy(floor.id)) continue;
        const spoke = get(db, "SELECT 1 x FROM messages WHERE floor_id=? AND role='manager' AND id>?", floor.id, r.after_message_id);
        const made = get(db, 'SELECT 1 x FROM tasks WHERE floor_id=? AND id>?', floor.id, r.after_task_id);
        if (!spoke && !made) continue;
      }
      finishRun(r, floor, { timedOut, brokeDown });
    }
    // Rows for runs that are gone (a deleted order) need no memory.
    if (seenRunning.size > running.length) { const live = new Set(running.map((r) => r.id)); for (const id of seenRunning) if (!live.has(id)) seenRunning.delete(id); }
  }
  function finishRun(r, floor, { timedOut, brokeDown }) {
    const t = now();
    const tasks = all(db, 'SELECT id,title,status,project FROM tasks WHERE floor_id=? AND id>?', floor.id, r.after_task_id);
    const done = tasks.filter((x) => x.status === 'done').length;
    const failed = tasks.filter((x) => x.status === 'failed').length;
    const cost = get(db, 'SELECT COALESCE(SUM(cost_usd),0) n FROM ledger WHERE floor_id=? AND id>?', floor.id, r.after_ledger_id).n;
    const published = all(db, 'SELECT slug,title FROM projects WHERE floor_id=? AND published_at IS NOT NULL AND published_at>=? ORDER BY published_at', floor.id, r.started_at).map((p) => ({ slug: p.slug, title: p.title, url: engine.liveUrl(floor, p.slug) }));
    const status = timedOut || brokeDown || failed > 0 ? 'failed' : 'done';
    const mins = Math.max(1, Math.round((t - r.started_at) / 60000));
    const lines = [`**Standing order #${r.order_id}** ${status === 'done' ? 'ran' : 'did not finish'}: _${r.text.slice(0, 140).replace(/[*_`]/g, '')}${r.text.length > 140 ? '…' : ''}_`];
    if (timedOut) lines.push(`- Timed out after ${cfg.ordersRunTimeoutMin} minutes. Whatever is still open carries on as normal work.`);
    else if (brokeDown) lines.push(`- Stopped because the floor was paused: ${floor.pause_reason}`);
    else lines.push(`- Took about ${mins} ${mins === 1 ? 'minute' : 'minutes'}.`);
    lines.push(`- Tasks: ${done} done${failed ? `, ${failed} could not finish` : ''}${tasks.length === 0 ? ' (the manager answered without assigning work)' : ''}.`);
    if (published.length) lines.push(`- Published: ${published.map((p) => `[${p.title.replace(/[[\]]/g, '')}](${p.url})`).join(', ')}.`);
    const report = lines.join('\n');
    const o = get(db, 'SELECT * FROM standing_orders WHERE id=?', r.order_id);
    const streak = status === 'failed' ? (o?.fail_streak ?? 0) + 1 : 0;
    tx(db, () => {
      run(db, 'UPDATE standing_runs SET finished_at=?, status=?, cost_usd=?, tasks_done=?, tasks_failed=?, published=?, report=? WHERE id=?', t, status, cost, done, failed, JSON.stringify(published), report, r.id);
      if (o) run(db, 'UPDATE standing_orders SET runs=runs+1, last_run_at=?, fail_streak=?, est_usd=?, updated_at=? WHERE id=?', t, streak, estimate(o.id), t, o.id);
    });
    seenRunning.delete(r.id);
    engine.reportToBoss(floor.id, report);
    if (o && o.status === 'active' && streak >= cfg.ordersMaxFails) {
      pauseOrder(o, `Paused: ${streak} runs in a row failed`);
      engine.officeNotice(floor.id, `Standing order #${o.id} has failed ${streak} times in a row, so I've paused it. Have a look at the reports under Orders and press Resume when you want it back on.`);
    }
    changed(floor.id);
  }
  function tick() {
    if (stopped || engine.stopped) return;
    try { finishRuns(); fireDue(); } catch (e) { log('error', 'orders', { err: String(e?.message || e).slice(0, 200) }); }
  }

  // ---- hooks and routes ----
  hooks.snapshot.push((f, viewer, out) => {
    if (!viewer.owner) return;
    touch(f.id);
    out.orders = list(f.id);
    out.orderLimits = limits();
  });
  hooks.adminFloor.push((f, row) => { row.orders = countFor(f.id); });
  const wrap = (fn) => { try { return fn(); } catch (e) { if (e instanceof OrderError) throw new HttpError(e.status, e.code, e.message); throw e; } };
  const idOf = (p) => { const n = Number(p.id); if (!Number.isInteger(n) || n <= 0 || !/^\d+$/.test(p.id)) throw new HttpError(404, 'not_found'); return n; };
  GET('/api/floors/:slug/orders', async ({ req, res, p }) => {
    const f = requireOwner(req, p.slug);
    json(res, 200, { orders: list(f.id), limits: limits() });
  });
  POST('/api/floors/:slug/orders', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug); limit('mutate', ip);
    const b = await readJson(req, 16 * 1024);
    json(res, 201, { order: wrap(() => create(f, { text: b.text, schedule: b.schedule })) });
  });
  POST('/api/floors/:slug/orders/:id', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug); limit('mutate', ip);
    const b = await readJson(req, 16 * 1024);
    json(res, 200, { order: wrap(() => update(f, idOf(p), { text: b.text, schedule: b.schedule, status: b.status })) });
  });
  POST('/api/floors/:slug/orders/:id/delete', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug); limit('mutate', ip);
    await readJson(req, 1024);
    wrap(() => remove(f, idOf(p)));
    json(res, 200, { ok: true });
  });
  POST('/api/floors/:slug/orders/:id/run', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug); limit('mutate', ip);
    await readJson(req, 1024);
    json(res, 202, { ok: true, run: wrap(() => runNow(f, idOf(p))) });
  });

  // Reached by the manager's tools, and by tests.
  engine.orders = { create, update, remove, runNow, list, tick, touch, describe: describeSchedule, nextRunAt, idleReason: () => idleReason(cfg.ordersIdleDays) };
  return {
    start() {
      stopped = false;
      // Runs left 'running' by a restart are picked up by the ticks as they are; their slot was advanced when they started, so nothing fires twice.
      timer = setInterval(tick, cfg.ordersTickMs);
      timer.unref?.();
    },
    stop() { stopped = true; clearInterval(timer); timer = null; },
  };
}
