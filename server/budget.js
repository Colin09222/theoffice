// The building's lifetime limits, one per provider. See docs/DEPLOY-LANES.md.
// The ledger is the only record of what was spent, so the totals can't drift and a restart can't lose them. What is promised to running calls and
// computer sessions sits in budget_holds, which is why the limit can only be overrun by a call already under way. Every figure here is the admin's alone:
// nothing in this file is reachable from a floor's views, its events or a prompt.
import { get, all, run } from './db.js';
import { newFence } from './help.js';

export const PROVIDERS = ['anthropic', 'openrouter'];
const LIMIT = { anthropic: 'budgetAnthropicUsd', openrouter: 'budgetOpenrouterUsd' };
// Less than this left and a provider counts as used up. It is also the least a computer is worth starting for.
export const MIN_ROOM_USD = 0.1;
const FLAGS = [[100, '100%'], [80, '80%'], [50, '50%']];
const money = (n) => Math.round(n * 1e4) / 1e4;

export const providerForRole = (role) => (role?.provider === 'anthropic' ? 'anthropic' : 'openrouter');
/** Who was paid for a ledger row. Matches the SQL that fills in old rows in db.js. '' means neither: a domain comes out of the registrar balance. */
export function providerOf(model, kind) {
  if (kind === 'domain') return '';
  if (kind === 'search') return 'anthropic';
  if (kind === 'image' || kind === 'review') return 'openrouter';
  return model === 'managed-session' || String(model).startsWith('claude-') ? 'anthropic' : 'openrouter';
}

export function createBudget(db, cfg, now = Date.now) {
  const limit = (p) => cfg[LIMIT[p]];
  const spent = (p) => get(db, 'SELECT COALESCE(SUM(cost_usd),0) n FROM ledger WHERE provider=?', p).n;
  const held = (p) => get(db, 'SELECT COALESCE(SUM(usd),0) n FROM budget_holds WHERE provider=?', p).n;
  return {
    limit, spent, held,
    /** Money actually gone, so the provider's roles stop. Raising the limit is the only way back. */
    out: (p) => limit(p) - spent(p) < MIN_ROOM_USD,
    /** What is left once running calls and sessions have had what they were promised. */
    room: (p) => limit(p) - spent(p) - held(p),
    hold(provider, { kind = 'call', floorId = null, agentId = null, taskId = null, usd }) {
      return Number(run(db, 'INSERT INTO budget_holds (provider,kind,floor_id,agent_id,task_id,usd,created_at) VALUES (?,?,?,?,?,?,?)', provider, kind, floorId, agentId, taskId ?? null, usd, now()).lastInsertRowid);
    },
    setHold(id, usd) { run(db, 'UPDATE budget_holds SET usd=? WHERE id=?', usd, id); },
    release(id) { run(db, 'DELETE FROM budget_holds WHERE id=?', id); },
    releaseTask(taskId) { run(db, 'DELETE FROM budget_holds WHERE task_id=?', taskId); },
    /** Calls that were in flight when the process died. Each has no ledger row and now never will. */
    leftoverCalls: () => all(db, "SELECT * FROM budget_holds WHERE kind='call' ORDER BY id"),
    /** A session keeps its hold across a restart, because it may still be running. One whose task has moved on has nothing to hold it for. */
    dropStaleSessionHolds() {
      run(db, "DELETE FROM budget_holds WHERE kind='session' AND id NOT IN (SELECT h.id FROM budget_holds h JOIN tasks t ON t.id=h.task_id WHERE t.session_id!='' AND t.status IN ('todo','doing'))");
    },
  };
}

function providerRow(db, cfg, p) {
  const limit = cfg[LIMIT[p]];
  const spent = get(db, 'SELECT COALESCE(SUM(cost_usd),0) n FROM ledger WHERE provider=?', p).n;
  const held = get(db, 'SELECT COALESCE(SUM(usd),0) n FROM budget_holds WHERE provider=?', p).n;
  const finite = Number.isFinite(limit);
  const reached = finite && limit - spent < MIN_ROOM_USD;
  const percent = !finite ? null : limit > 0 ? spent / limit * 100 : 100;
  // The top flag means the work has stopped, which happens just under the limit itself.
  const flag = reached ? '100%' : finite ? FLAGS.find(([at]) => percent >= at)?.[1] ?? 'none' : 'none';
  return { spentUsd: money(spent), heldUsd: money(held), limitUsd: finite ? limit : null, remainingUsd: finite ? money(Math.max(0, limit - spent)) : null, percent: percent === null ? null : Math.round(percent * 10) / 10, flag, stopped: reached };
}

/** Spent, limit and remaining per provider, and what each floor has spent. Floors that were since deleted stay in: their money is still gone. */
export function budgetReport(db, cfg, { fenced = true, now = Date.now } = {}) {
  const fence = fenced ? newFence() : null;
  const providers = Object.fromEntries(PROVIDERS.map((p) => [p, providerRow(db, cfg, p)]));
  const rows = all(db, "SELECT l.floor_id id, f.number, f.name, l.provider, SUM(l.cost_usd) usd FROM ledger l LEFT JOIN floors f ON f.id=l.floor_id WHERE l.provider!='' GROUP BY l.floor_id, l.provider");
  const byFloor = new Map();
  for (const r of rows) {
    const row = byFloor.get(r.id) || { floorNumber: r.number ?? null, floorName: r.number == null ? '(floor no longer exists)' : fence ? fence.wrap('floor-name', r.name) : r.name, anthropicUsd: 0, openrouterUsd: 0, totalUsd: 0 };
    row[`${r.provider}Usd`] = money(r.usd);
    row.totalUsd = money(row.totalUsd + r.usd);
    byFloor.set(r.id, row);
  }
  const order = ['none', '50%', '80%', '100%'];
  return {
    ...(fence ? { notice: fence.notice, fence: fence.nonce } : {}),
    generatedAt: new Date(now()).toISOString(),
    flag: order[Math.max(...PROVIDERS.map((p) => order.indexOf(providers[p].flag)))],
    providers,
    floors: [...byFloor.values()].sort((a, b) => b.totalUsd - a.totalUsd),
  };
}
/** The same report for a person at a terminal. */
export function budgetReportText(r) {
  const usd = (n) => (n === null ? 'no limit' : `$${n.toFixed(2)}`);
  const lines = [];
  if (r.notice) lines.push(r.notice, '');
  for (const p of PROVIDERS) {
    const x = r.providers[p];
    lines.push(`${p.padEnd(11)} spent ${usd(x.spentUsd)} of ${usd(x.limitUsd)}, ${usd(x.remainingUsd)} left, ${usd(x.heldUsd)} held by running work${x.flag === 'none' ? '' : `  [${x.flag}]`}${x.stopped ? '  STOPPED' : ''}`);
  }
  lines.push('');
  if (!r.floors.length) lines.push('Nothing spent yet.');
  for (const f of r.floors) lines.push(`${String(f.floorNumber ?? '-').padStart(3)}  ${usd(f.totalUsd).padStart(9)}  (Anthropic ${usd(f.anthropicUsd)}, OpenRouter ${usd(f.openrouterUsd)})  ${f.floorName}`);
  return lines.join('\n');
}

// ---- figures already written down by earlier versions ----
// A report, a tool result or something the manager said while it could see the day's spend. They go once, at the first boot of this version, because they would
// otherwise reach a boss in the chat history, a visitor on a public-chat floor, or a model replaying its own past.
const AMOUNT = '\\$\\s?\\d[\\d,]*(?:\\.\\d+)?';
const REPORT_LINE = new RegExp(`^- Cost: ${AMOUNT}[^\\n]*\\n?`, 'gm');
const TOOL_COST = new RegExp(`(?:\\\\n|\\s)*\\(cost ${AMOUNT}\\)`, 'g');
const PICTURE_COST = new RegExp(`( KB), ${AMOUNT}\\)`, 'g');
// Any sentence that talks about the budget or what was spent loses its amounts. A price on something the boss is deciding on doesn't talk like that.
const SPEND_SENTENCE = /[^.!?\n]*\b(?:spent|spending|budget|burn(?:ed|t)?|so far today|cost so far|daily cap)\b[^.!?\n]*(?:\.\d+[^.!?\n]*)*[.!?]?/gi;
const hasAmount = new RegExp(AMOUNT);
const amounts = new RegExp(AMOUNT, 'g');
export function scrubSpendText(text) {
  const s = String(text ?? '');
  if (!s.includes('$')) return s;
  return s.replace(REPORT_LINE, '').replace(TOOL_COST, '').replace(PICTURE_COST, '$1)').replace(SPEND_SENTENCE, (m) => (hasAmount.test(m) ? m.replace(amounts, '[amount removed]') : m));
}
export function scrubOldSpend(db) {
  if (get(db, "SELECT 1 x FROM settings WHERE key='spend_scrub_v1'")) return;
  const fix = (table, column, where = '1=1') => {
    for (const r of all(db, `SELECT rowid id, ${column} v FROM ${table} WHERE ${column} LIKE '%$%' AND ${where}`)) {
      const next = scrubSpendText(r.v);
      if (next !== r.v) run(db, `UPDATE ${table} SET ${column}=? WHERE rowid=?`, next, r.id);
    }
  };
  fix('messages', 'text');
  fix('tasks', 'result');
  fix('tasks', 'brief');
  // Only work that can still run: a finished task's transcript never goes near a model or a view again.
  fix('tasks', 'transcript', "status IN ('todo','doing','blocked','review')");
  for (const r of all(db, "SELECT id, data FROM events WHERE type='message' AND data LIKE '%$%'")) {
    let d; try { d = JSON.parse(r.data); } catch { continue; }
    const next = scrubSpendText(d.text);
    if (next !== d.text) run(db, 'UPDATE events SET data=? WHERE id=?', JSON.stringify({ ...d, text: next }), r.id);
  }
  // Orders may not exist yet in a brand-new building; if so there is nothing old in them.
  if (get(db, "SELECT 1 x FROM sqlite_master WHERE type='table' AND name='standing_runs'")) fix('standing_runs', 'report');
  run(db, "INSERT INTO settings (key,value) VALUES ('spend_scrub_v1',?)", String(Date.now()));
}
