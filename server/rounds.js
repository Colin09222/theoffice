// Loop caps. A project that keeps going round (a test fails, it's sent back or re-planned, the test fails again) stops after a few rounds and goes to the boss
// as one plain question, instead of spending all night on a brief that can't be fully met. The count is per project, over the last day, and starts again
// whenever the boss says something or answers a question: their word is a new direction. Only the manager's own tools are capped: a maker job runs its own
// passes (server/makers.js), and what the building queues for itself (business mode, iPhone builds) isn't a re-plan.
import { get, all, run } from './db.js';

const DAY = 86400000;

/** Since when this floor's rounds count: a day at most, and never from before the boss last had a say. */
export function roundsSince(db, floorId, now) {
  const said = get(db, "SELECT MAX(created_at) t FROM messages WHERE floor_id=? AND role='boss'", floorId)?.t || 0;
  const answered = get(db, 'SELECT MAX(answered_at) t FROM questions WHERE floor_id=?', floorId)?.t || 0;
  return Math.max(now - DAY, said, answered);
}

/** The reports a round answers to: each finished test of the project, and each job on it that failed, once per version of it. */
function triggers(db, floorId, project, since) {
  return all(db, `SELECT t.id, t.revisions FROM tasks t LEFT JOIN agents a ON a.id=t.agent_id WHERE t.floor_id=? AND t.project=? AND t.updated_at>=?
    AND ((a.role='tester' AND t.status IN ('review','done','failed')) OR t.status='failed')`, floorId, project, since).map((t) => `${t.id}:${t.revisions}`);
}

function stopWords(project, n, what) {
  return `stop here. "${project}" has already ${what} ${n} time${n === 1 ? '' : 's'} since the boss last had a say, and going round again won't get it there. Don't send it back or plan it again. `
    + 'If what you have works, ship the best honest version now (approve it and publish it) and tell the boss in a line what is still missing and why. '
    + 'Then ask the boss one plain question with ask_boss, about the one thing that would settle it, and wait for their answer.';
}

/**
 * Called before the manager sends work back or hands out more work on a project. Returns null to go ahead, or the reason it can't.
 * A new round is one that answers a test report (or a failure) no earlier round answered: several send-backs and new tasks in one go are one round.
 */
export function checkRound(db, cfg, floorId, project, { plan = null, now = Date.now() } = {}) {
  if (!project) return null;
  const since = roundsSince(db, floorId, now);
  if (plan !== null && plan !== '') {
    const plans = new Set(all(db, "SELECT DISTINCT plan FROM tasks WHERE floor_id=? AND project=? AND created_at>=? AND plan!=''", floorId, project, since).map((p) => p.plan));
    if (!plans.has(plan) && plans.size >= 1 + cfg.loopMaxReplans) return stopWords(project, plans.size - 1, 'been planned again');
  }
  const rounds = get(db, 'SELECT COUNT(*) n FROM work_rounds WHERE floor_id=? AND project=? AND created_at>=?', floorId, project, since).n;
  const answered = new Set(all(db, 'SELECT triggers FROM work_rounds WHERE floor_id=? AND project=?', floorId, project).flatMap((r) => r.triggers.split(',')));
  const fresh = triggers(db, floorId, project, since).filter((k) => !answered.has(k));
  if (!fresh.length) return null;
  if (rounds >= cfg.loopMaxRetests) return stopWords(project, rounds, 'failed its test and gone back for another go');
  run(db, 'INSERT INTO work_rounds (floor_id,project,triggers,created_at) VALUES (?,?,?,?)', floorId, project, fresh.join(','), now);
  return null;
}
