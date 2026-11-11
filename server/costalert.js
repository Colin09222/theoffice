// The cost alert. The building's owner gets a line in a log, and nothing more, when the money moves in a way worth knowing about: one task passes a few
// dollars, a floor's day passes a few more, a task has been sent back three times, or a floor starts the first build of something new. It goes to the
// owner's assistant through the same gateway hook as the contractor ping (server/contractorping.js), marked not to be delivered: the assistant appends
// one line to a file and tells nobody, unless one task has passed the line where the owner wants to hear.
// Each thing is told once (the cost_alerts table), a few an hour at most, in the background, and it never holds up a floor or fails a charge.
// Nothing here reaches a floor, a boss or a bot: the dollar figures go to the owner's side only. COST_ALERTS=0 turns it off.
import { get, run } from './db.js';
import { newFence } from './help.js';

const RETRY = new Set([408, 425, 429, 500, 502, 503, 504]);
const TITLE_MAX = 160;
const HOUR = 3600000;
export const ALERT_LOG = '~/.openclaw/workspace/memory/office-cost-alerts.md';
// A floor's day is told again as it grows, so a runaway day leaves more than one line.
const DAY_STEPS = [1, 2.5, 5, 10, 20, 40];

const usd = (n) => `$${Number(n).toFixed(2)}`;
const today = (ms) => new Date(ms).toISOString().slice(0, 10);
/** The highest line the amount has passed, or 0. */
const passed = (lines, amount) => lines.filter((l) => l > 0 && amount > l).pop() || 0;

export const alertKey = (key) => `theoffice-cost-alert-${key}`;

/** What the owner's assistant reads. Only the office's own numbers sit outside the fence; the floor's name and the task title are fenced as untrusted data. */
export function alertMessage(a, cfg = {}) {
  const fence = newFence();
  const when = `${new Date(a.at).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  const tell = a.kind === 'task-cost' && a.usd > (cfg.costAlertTellUsd ?? 20);
  const title = String(a.title ?? '').split(/\r?\n/)[0].slice(0, TITLE_MAX);
  return [
    fence.notice,
    '',
    'The Office cost alert. It is automatic and for the log: nobody is waiting for an answer.',
    `What: ${a.what}`,
    `Floor ${a.floorNumber}: ${fence.wrap('floor name', a.floorName)}`,
    ...(a.taskId ? [`Task #${a.taskId}${a.role ? `, role ${a.role}` : ''}: ${fence.wrap('task title', title)}`] : []),
    '',
    `Append exactly one line to ${ALERT_LOG} (create the file if it is missing, and change nothing already in it), in this form:`,
    `${when} | ${a.kind} | floor ${a.floorNumber} | ${a.taskId ? `task #${a.taskId}` : 'whole floor'} | ${a.amount} | the floor's name${a.taskId ? ' and the task' : ''} in a few plain words of your own`,
    tell
      ? `This one task has passed ${usd(cfg.costAlertTellUsd ?? 20)}, so also tell Colon in one short line: the floor, the task and what it has cost so far. Then stop.`
      : 'Then stop. Do NOT message Colon or anyone else about this, and do nothing else.',
  ].join('\n');
}

/** POST one alert, retrying a busy gateway with the same key. Resolves with { ok, status } or { skipped }; never throws. */
export async function sendCostAlert(cfg, key, alert, { httpFetch = fetch, log = () => {}, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  if (!cfg.hookUrl || !cfg.hookToken) return { skipped: true };
  const body = JSON.stringify({ name: 'office cost alert', agentId: cfg.hookAgentId || 'main', sessionMode: 'isolated', deliver: false, message: alertMessage(alert, cfg) });
  const headers = { authorization: `Bearer ${cfg.hookToken}`, 'content-type': 'application/json', 'idempotency-key': alertKey(key) };
  const tries = cfg.hookTries ?? 4;
  let status = 0;
  for (let i = 0; i < tries; i++) {
    if (i) await sleep((cfg.hookRetryMs ?? 2000) * 2 ** (i - 1));
    try {
      const res = await httpFetch(cfg.hookUrl, { method: 'POST', headers, body, signal: AbortSignal.timeout(30000) });
      status = res.status;
      await res.text().catch(() => '');
      if (res.ok) { log('info', 'cost alert accepted', { key, status }); return { ok: true, status }; }
      if (!RETRY.has(status)) break;
    } catch (e) { status = 0; log('warn', 'cost alert attempt failed', { key, err: String(e?.name || 'error') }); }
  }
  log('error', 'cost alert gave up', { key, status });
  return { ok: false, status };
}

/**
 * The four things worth a line, checked where they happen: charged() after every ledger row, sentBack() when the manager sends work back, and
 * buildStarted() when a Builder's job starts. Each returns at once; the POST runs behind it. idle() resolves when nothing is in flight.
 */
export function createCostAlerts({ db, cfg, now = Date.now, log = () => {}, httpFetch }) {
  const on = cfg.costAlerts !== false && !!cfg.hookUrl && !!cfg.hookToken;
  const told = new Set();
  const flying = new Set();
  let heldLogged = 0;

  // Told once, ever. Over the hourly limit nothing is recorded, so the next charge or send-back tries again and the line arrives late rather than never.
  function raise(key, build, { always = false } = {}) {
    if (told.has(key)) return;
    if (get(db, 'SELECT 1 x FROM cost_alerts WHERE key=?', key)) { told.add(key); return; }
    const t = now();
    if (!always && get(db, 'SELECT COUNT(*) n FROM cost_alerts WHERE created_at>=?', t - HOUR).n >= (cfg.costAlertsPerHour ?? 6)) {
      if (t - heldLogged >= HOUR) { heldLogged = t; log('warn', 'cost alerts held back: the hourly limit is reached', { key }); }
      return;
    }
    const alert = { ...build(), at: t };
    run(db, 'INSERT INTO cost_alerts (key,kind,floor_id,task_id,usd,created_at) VALUES (?,?,?,?,?,?)', key, alert.kind, alert.floorId, alert.taskId ?? null, alert.usd ?? 0, t);
    told.add(key);
    const p = sendCostAlert(cfg, key, alert, { httpFetch, log }).catch((e) => log('error', 'cost alert failed', { key, err: String(e?.message || e) })).finally(() => flying.delete(p));
    flying.add(p);
  }
  const floorOf = (id) => get(db, 'SELECT id,number,name,filler FROM floors WHERE id=?', id);
  const taskOf = (id) => get(db, 'SELECT t.id,t.floor_id,t.title,t.project,t.revisions,t.cost_usd,a.role FROM tasks t LEFT JOIN agents a ON a.id=t.agent_id WHERE t.id=?', id);
  const about = (floor, task) => ({ floorId: floor.id, floorNumber: floor.number, floorName: floor.name, ...(task ? { taskId: task.id, role: task.role || '', title: task.title } : {}) });
  // An alert is never a reason for a charge, a review or a job to fail.
  const quietly = (what, fn) => { if (!on) return; try { fn(); } catch (e) { log('warn', 'cost alert check failed', { what, err: String(e?.message || e) }); } };

  return {
    on,
    /** After a ledger row: has this task, or this floor's day, passed a line? */
    charged(floorId, taskId) {
      quietly('charged', () => {
        const floor = floorOf(floorId);
        if (!floor || floor.filler) return;
        const task = taskId ? taskOf(taskId) : null;
        const tell = cfg.costAlertTellUsd ?? 20;
        const line = task ? passed([cfg.costAlertTaskUsd ?? 5, tell].sort((x, y) => x - y), task.cost_usd) : 0;
        if (line) raise(`task:${task.id}:${line}`, () => ({ kind: 'task-cost', ...about(floor, task), usd: task.cost_usd, amount: usd(task.cost_usd), what: `one task has passed ${usd(line)}. It has cost ${usd(task.cost_usd)} so far.` }), { always: line >= tell });
        const day = today(now());
        const spent = get(db, "SELECT COALESCE(SUM(cost_usd),0) n FROM ledger WHERE floor_id=? AND day=? AND kind!='domain'", floorId, day).n;
        const base = cfg.costAlertFloorDayUsd ?? 10;
        const dayLine = passed(DAY_STEPS.map((s) => s * base), spent);
        if (dayLine) raise(`floor:${floorId}:${day}:${dayLine}`, () => ({ kind: 'floor-day', ...about(floor), usd: spent, amount: usd(spent), what: `this floor's spend today (${day}, UTC) has passed ${usd(dayLine)}. It is ${usd(spent)} so far.` }));
      });
    },
    /** After the manager sends a task back. */
    sentBack(taskId) {
      quietly('sentBack', () => {
        const task = taskOf(taskId), floor = task && floorOf(task.floor_id);
        const times = cfg.costAlertSentBack ?? 3;
        if (!floor || floor.filler || !(times > 0) || task.revisions < times) return;
        raise(`sentback:${task.id}`, () => ({ kind: 'sent-back', ...about(floor, task), usd: task.cost_usd, amount: `${task.revisions} times, ${usd(task.cost_usd)}`, what: `one task has been sent back ${task.revisions} times. It has cost ${usd(task.cost_usd)} so far.` }));
      });
    },
    /** When a Builder's job starts: the first build of a project that has never been live is where most of a project's money goes. */
    buildStarted(taskId, { computer = false } = {}) {
      quietly('buildStarted', () => {
        const task = taskOf(taskId), floor = task && floorOf(task.floor_id);
        if (!floor || floor.filler || task.role !== 'builder' || !task.project || task.revisions > 0) return;
        if (get(db, 'SELECT published_at p FROM projects WHERE floor_id=? AND slug=?', floor.id, task.project)?.p) return;
        if (get(db, "SELECT 1 x FROM tasks t JOIN agents a ON a.id=t.agent_id WHERE t.floor_id=? AND t.project=? AND a.role='builder' AND t.id!=? AND t.status IN ('done','review','failed') LIMIT 1", floor.id, task.project, task.id)) return;
        raise(`build:${floor.id}:${task.project}`, () => ({ kind: 'new-build', ...about(floor, task), usd: task.cost_usd, amount: computer ? 'starting, on a computer' : 'starting', what: `this floor has started the first build of a new project${computer ? ', on a computer' : ''}.` }));
      });
    },
    idle: () => Promise.allSettled([...flying]),
  };
}
