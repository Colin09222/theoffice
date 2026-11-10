// The contractor hold. On a floor the building manager picks, a Builder's or Designer's job never reaches a model: it waits, held for the building's outside contractor,
// and a row in contractor_jobs says what is wanted. Nothing here calls a model, Claude Code or any subscription. It only queues and records. A person (or their own
// agent) picks a job up by hand, puts files on the floor's drive the usual way, and hands it back with `admin.mjs contractor done`, which the server turns into an
// ordinary finished job on its next tick, so whoever comes next (the Tester, say) carries on.
import { get, all, run } from './db.js';
import { newFence } from './help.js';
import { listFiles } from './workspace.js';

export const CONTRACTOR_ROLES = new Set(['builder', 'designer']);
export const SUMMARY_MAX = 6000;
const FILES_LISTED = 200;

export class ContractorError extends Error {}

export const contractorOn = (db, floorId) => get(db, 'SELECT contractor c FROM floors WHERE id=?', floorId)?.c === 1;
/** A task that is with the contractor right now. */
export const heldNow = (t) => !!t && t.status === 'blocked' && t.contractor === 1;

/** Turning the hold off hands anything still held back to the floor's own staff, on the server's next tick. */
export function setContractor(db, floorId, on) {
  run(db, 'UPDATE floors SET contractor=? WHERE id=?', on ? 1 : 0, floorId);
}

/** The job as the contractor needs it: the brief and everything the floor already knows, and the files on the drive they may need. */
export function jobFor(engine, floor, task) {
  const sentBack = (() => {
    if (!task.revisions || !task.transcript) return '';
    try {
      const last = JSON.parse(task.transcript).filter((m) => m.role === 'user' && typeof m.content === 'string' && m.content.startsWith('The Office Manager sent this back')).at(-1);
      return last ? `\n\n${last.content}` : '';
    } catch { return ''; }
  })();
  const brief = `Task #${task.id}: ${task.title}\n${task.project ? `Project slug: ${task.project}\n` : ''}\nBrief from the Office Manager:\n${task.brief}${sentBack}${engine.handoffFor(floor, task)}`;
  const uploads = engine.taskFiles(task).map((f) => f.path);
  const drive = task.project ? listFiles(engine.db, floor.id, `projects/${task.project}/`).map((f) => f.path) : [];
  return { brief, files: [...new Set([...uploads, ...drive])].slice(0, FILES_LISTED) };
}

/** What is waiting for the contractor, and which floors send work out. Everything a floor wrote is fenced as untrusted data. */
export function contractorListing(db, { status = 'held' } = {}) {
  const fence = newFence();
  const where = status === 'all' ? '' : "WHERE j.status='held'";
  const jobs = all(db, `SELECT j.*, f.number, f.name FROM contractor_jobs j JOIN floors f ON f.id=j.floor_id ${where} ORDER BY j.id`).map((j) => ({
    job: j.id, task: j.task_id, floorNumber: j.number, floorName: fence.wrap('floor name', j.name), role: j.role, project: j.project, status: j.status,
    heldSince: new Date(j.created_at).toISOString(), title: fence.wrap('task title', j.title), brief: fence.wrap('brief', j.brief), filesNeeded: JSON.parse(j.files || '[]'),
  }));
  const floors = all(db, "SELECT number, name FROM floors WHERE contractor=1 AND status='active' ORDER BY number").map((f) => ({ number: f.number, name: fence.wrap('floor name', f.name) }));
  return { notice: fence.notice, floorsOn: floors, jobs };
}

export function contractorListingText(listing) {
  const lines = [listing.notice, '', `Contractor hold is on for: ${listing.floorsOn.length ? listing.floorsOn.map((f) => `floor ${f.number}`).join(', ') : 'no floor'}.`, ''];
  if (!listing.jobs.length) lines.push('Nothing held.');
  for (const j of listing.jobs) {
    lines.push(`Task #${j.task} [${j.status}] floor ${j.floorNumber}, ${j.role}${j.project ? `, project ${j.project}` : ''}, held since ${j.heldSince}`, `  floor name: ${j.floorName}`, `  title: ${j.title}`, `  brief: ${j.brief}`);
    lines.push(`  files on the floor's drive: ${j.filesNeeded.length ? j.filesNeeded.join(', ') : 'none yet'}`, '');
  }
  return lines.join('\n');
}

/** The contractor hands a job back. The task finishes with this summary on the server's next tick, like any finished job. */
export function completeJob(db, taskId, summary, now = Date.now()) {
  if (!Number.isSafeInteger(taskId) || taskId <= 0) throw new ContractorError('--task must be a task number from "contractor list".');
  const text = String(summary ?? '').trim();
  if (!text) throw new ContractorError('The summary is empty.');
  if (text.length > SUMMARY_MAX) throw new ContractorError(`The summary is over ${SUMMARY_MAX} characters.`);
  const j = get(db, "SELECT j.id, j.status, t.status ts, t.contractor tc FROM contractor_jobs j LEFT JOIN tasks t ON t.id=j.task_id WHERE j.task_id=? ORDER BY j.id DESC LIMIT 1", taskId);
  if (!j) throw new ContractorError(`Task #${taskId} was never held for the contractor.`);
  if (j.status === 'done') throw new ContractorError(`Task #${taskId} is already handed back. The floor picks it up on the server's next tick.`);
  if (j.status !== 'held' || !heldNow({ status: j.ts, contractor: j.tc })) throw new ContractorError(`Task #${taskId} is no longer held (${j.status === 'held' ? `the task is ${j.ts || 'gone'}` : j.status}), so there is nothing to hand back.`);
  run(db, "UPDATE contractor_jobs SET status='done', summary=?, done_at=? WHERE id=? AND status='held'", text, now, j.id);
}
