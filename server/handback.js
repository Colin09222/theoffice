// Re-hold rules (docs/redesign/OFFICE-ANSWERS-1.md, section 5). On 16 November a TheTireRx task the contractor had finished and handed back came
// straight back as "held for the contractor" four or five times in twenty minutes, with a new ping each time. The cause: the engine checked the
// floor's contractor switch every time a Builder picked a task up, so a task the manager sent back after its handback was held all over again.
// Now the routing is decided once, when a task is made (tasks.contractor_route); a task the contractor handed back (tasks.handed_back_at) can never be
// held again, and a try is refused, logged and listed for the admin; a Tester failure on handed-back work becomes one fix task on the floor; each task
// is pinged at most once, ever; and "sent back" counts only Tester failures (tasks.tester_fails). Nothing here calls a model.
import { get, all, run } from './db.js';
import { parseReport } from './makers.js';
import { newFence } from './help.js';

/** Whether a Tester's report says the work failed. The verdict block a maker job writes wins; otherwise the report's first line, then any FAIL in capitals. */
export function testerFailed(text) {
  const s = String(text || '');
  const v = parseReport(s);
  if (v) return v.verdict === 'fail';
  const first = s.split('\n').map((l) => l.trim()).find(Boolean) || '';
  if (/\bFAIL(?:ED|S)?\b/.test(first)) return true;
  if (/\bPASS(?:ED|ES)?\b/.test(first)) return false;
  return /\bFAIL(?:ED|S)?\b/.test(s);
}

/** What a Tester's task tested: the jobs it waited on, or else the last job finished on its project before it started. Never another test. */
export function testedBy(db, testTask) {
  const deps = (() => { try { return JSON.parse(testTask.depends_on || '[]').map(Number).filter(Number.isInteger); } catch { return []; } })();
  const notTests = "a.role IS NOT 'tester'";
  if (deps.length) return all(db, `SELECT t.* FROM tasks t LEFT JOIN agents a ON a.id=t.agent_id WHERE t.floor_id=? AND t.id IN (${deps.map(() => '?').join(',')}) AND ${notTests}`, testTask.floor_id, ...deps);
  if (!testTask.project) return [];
  const last = get(db, `SELECT t.* FROM tasks t LEFT JOIN agents a ON a.id=t.agent_id WHERE t.floor_id=? AND t.project=? AND t.id<? AND t.status IN ('review','done') AND ${notTests} ORDER BY t.id DESC LIMIT 1`, testTask.floor_id, testTask.project, testTask.id);
  return last ? [last] : [];
}

/** Rule 2: a try to hold handed-back work is refused. It goes in the server log and in a row the admin lists with `admin.mjs contractor refusals`. */
export function refuseHold(db, { floorId, taskId, why, now = Date.now(), log = () => {} }) {
  run(db, 'INSERT INTO hold_refusals (floor_id,task_id,why,created_at) VALUES (?,?,?,?)', floorId, taskId, why, now);
  log('warn', 'refused to hold handed-back work for the contractor again', { floor: floorId, task: taskId, why });
}

/** Rule 4: true the first time a task is pinged, false ever after. */
export const firstPing = (db, taskId, jobId, now = Date.now()) => run(db, 'INSERT OR IGNORE INTO contractor_pings (task_id,job_id,created_at) VALUES (?,?,?)', taskId, jobId, now).changes > 0;

/** Refused re-holds for the admin, newest first. Task titles are fenced: a floor wrote them. */
export function refusalListing(db, { since = 0, limit = 200 } = {}) {
  const fence = newFence();
  const rows = all(db, 'SELECT r.*, f.number, t.title FROM hold_refusals r LEFT JOIN floors f ON f.id=r.floor_id LEFT JOIN tasks t ON t.id=r.task_id WHERE r.created_at>=? ORDER BY r.id DESC LIMIT ?', since, limit);
  return { notice: fence.notice, refusals: rows.map((r) => ({ at: new Date(r.created_at).toISOString(), floorNumber: r.number ?? null, task: r.task_id, title: fence.wrap('task title', r.title || ''), why: r.why })) };
}
export function refusalListingText(l) {
  const lines = [l.notice, ''];
  if (!l.refusals.length) lines.push('No re-hold was refused.');
  for (const r of l.refusals) lines.push(`${r.at}  floor ${r.floorNumber ?? '-'}  task #${r.task}  ${r.why}`, `  title: ${r.title}`);
  return lines.join('\n');
}
