// The contractor, manual only (docs/redesign/OFFICE-ANSWERS-1.md, Q11 and section 5 "When the contractor is used"; job 19). Nothing is routed to the outside
// contractor automatically any more: the queue stays, and only the owner fills it, by pressing Send out on a stuck job (admin.mjs contractor send-out, or
// the button by the stuck jobs on the admin page). At most CONTRACTOR_SENDOUT_PER_WEEK (2) a week across the building. Work the contractor already handed
// back is never sent out again (re-hold rule 2). The engine holds a sent-out task on its next tick, the usual way (server/contractor.js).
import { get, all, run } from './db.js';
import { CONTRACTOR_ROLES } from './contractor.js';
import { weekStart } from './spendcheck.js';
import { newFence } from './help.js';

export class SendOutError extends Error {}
const HOUR = 3600000;

/** Jobs the owner may want to send out: open and not moved for STUCK_HOURS, or failed in the last two days. Not demo floors, not already sent. */
export function stuckJobs(db, { now = Date.now(), hours = 6, limit = 50 } = {}) {
  return all(db, `SELECT t.id, t.title, t.status, t.updated_at, t.project, t.handed_back_at, t.sent_out_at, a.role, f.number, f.name FROM tasks t JOIN floors f ON f.id=t.floor_id LEFT JOIN agents a ON a.id=t.agent_id
    WHERE f.filler=0 AND f.status='active' AND t.sent_out_at IS NULL AND t.contractor=0
      AND ((t.status IN ('todo','doing','blocked') AND t.updated_at<?) OR (t.status='failed' AND t.updated_at>=?)) ORDER BY t.updated_at LIMIT ?`, now - hours * HOUR, now - 48 * HOUR, limit);
}
export const sendOutsThisWeek = (db, now = Date.now()) => get(db, 'SELECT COUNT(*) n FROM tasks WHERE sent_out_at>=?', weekStart(now)).n;

/** Why a job can't be sent out, or null. */
export function sendOutProblem(db, cfg, t, now = Date.now()) {
  if (!t) return 'There is no such task.';
  if (t.handed_back_at) return `Task #${t.id} was already done by the contractor and handed back, so it can't go to them again. Give what is still missing as a new job.`;
  if (t.sent_out_at) return `Task #${t.id} has already been sent out.`;
  if (!CONTRACTOR_ROLES.has(t.role)) return `Task #${t.id} is a ${t.role || 'manager'}'s job; the contractor takes Builder, Designer and Researcher jobs.`;
  if (t.status === 'doing') return `Task #${t.id} is running right now. Pause the floor or let it stop, then send it out.`;
  if (t.status === 'cancelled') return `Task #${t.id} was cancelled.`;
  const used = sendOutsThisWeek(db, now), most = cfg.contractorSendOutPerWeek ?? 2;
  if (used >= most) return `${used} jobs have gone to the contractor this week, the most there may be (CONTRACTOR_SENDOUT_PER_WEEK=${most}). The count starts again on Monday.`;
  return null;
}

/** The owner presses Send out. The task goes back in line and the engine holds it for the contractor on its next tick, with one ping. */
export function sendOut(db, cfg, taskId, now = Date.now()) {
  const t = get(db, 'SELECT t.*, a.role FROM tasks t LEFT JOIN agents a ON a.id=t.agent_id WHERE t.id=?', taskId);
  const problem = sendOutProblem(db, cfg, t, now);
  if (problem) throw new SendOutError(problem);
  run(db, "UPDATE tasks SET sent_out_at=?, contractor_route=1, status='todo', updated_at=? WHERE id=?", now, now, taskId);
  return { task: taskId, left: Math.max(0, (cfg.contractorSendOutPerWeek ?? 2) - sendOutsThisWeek(db, now)) };
}

/** The stuck jobs for the admin, titles fenced. */
export function stuckListing(db, cfg, { now = Date.now(), fenced = true } = {}) {
  const fence = fenced ? newFence() : null;
  return {
    ...(fence ? { notice: fence.notice } : {}),
    sentOutThisWeek: sendOutsThisWeek(db, now), mostAWeek: cfg.contractorSendOutPerWeek ?? 2,
    jobs: stuckJobs(db, { now }).map((t) => ({ task: t.id, floorNumber: t.number, role: t.role, status: t.status, since: new Date(t.updated_at).toISOString(), title: fence ? fence.wrap('task title', t.title) : t.title, canSendOut: !sendOutProblem(db, cfg, { ...t, status: t.status }, now) })),
  };
}
