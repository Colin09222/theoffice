// Status from code (docs/redesign/OFFICE-ANSWERS-1.md, Q5, job 12): one timeline card per job, made when the job's first task is made and
// updated in place every time one of its tasks changes. Every word on it is put together here from the task rows: step N of M, who, what,
// when. No model writes any of it. Jobs 13 (the Timeline tab) and 15 (the status card) read these cards.
//
// A job is the tasks the manager handed out together under one plan for one project (tasks.plan + tasks.project). A task given out on its own,
// with no plan, is a job of one step. Cards are kept in job_cards (server/db.js, lane A block).
//
// STATUS_FROM_CODE=0 brings the old way back: the manager's words after a work-mode round reach the chat again, and the staff's planning
// huddle is written by the talk model again.
import { createHash } from 'node:crypto';
import { get, all, run } from './db.js';
import { redactor } from './engine.js';

const GONE = new Set(['cancelled']);
const DONE = new Set(['done']);
export const PRIVATE_JOB = 'Working on something private';
const short = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
/** The job a task belongs to. */
export const jobKey = (t) => (t.plan ? `p:${t.project || ''}:${createHash('sha256').update(String(t.plan)).digest('hex').slice(0, 16)}` : `t:${t.id}`);
/** A plan's name: its first line, or the first task's title. */
const jobTitle = (tasks) => {
  const first = String(tasks[0]?.plan || '').split(/\n|(?<=[.!?])\s/)[0].replace(/^[#*\-\s]+/, '');
  return short(first || tasks[0]?.title || 'A job', 80);
};

/**
 * What a job's card says, from its tasks (oldest first). Pure: the same rows always give the same card.
 * state: 'todo' (nothing started), 'working', 'review' (handed in), 'waiting' (stuck on the boss or someone), 'done', 'failed', 'cancelled'.
 */
export function cardFor(tasks, nameOf = () => '') {
  const live = tasks.filter((t) => !GONE.has(t.status));
  if (!live.length) return { state: 'cancelled', step: 0, steps: 0, agentId: null, who: '', line: 'Called off' };
  const steps = live.length;
  const doneN = live.filter((t) => DONE.has(t.status)).length;
  const doing = live.find((t) => t.status === 'doing') || live.find((t) => t.status === 'review') || live.find((t) => t.status === 'blocked');
  const failed = live.filter((t) => t.status === 'failed');
  const next = live.find((t) => t.status === 'todo');
  const lastDone = [...live].reverse().find((t) => DONE.has(t.status));
  const of = (n) => `Step ${n} of ${steps}`;
  const step = (t) => live.indexOf(t) + 1;
  if (doing) {
    const who = nameOf(doing.agent_id);
    const verb = doing.status === 'review' ? 'handed in' : doing.status === 'blocked' ? 'is waiting on' : 'is on';
    const state = doing.status === 'review' ? 'review' : doing.status === 'blocked' ? 'waiting' : 'working';
    return { state, step: step(doing), steps, agentId: doing.agent_id, who, line: `${of(step(doing))}: ${who ? `${who} ${verb} ` : ''}${short(doing.title, 90)}` };
  }
  if (doneN === steps) {
    const who = nameOf(lastDone?.agent_id);
    return { state: 'done', step: steps, steps, agentId: lastDone?.agent_id ?? null, who, line: `Done${steps > 1 ? `, all ${steps} steps` : ''}${who ? `. ${who} finished ${short(lastDone.title, 70)}` : ''}` };
  }
  if (failed.length && !next) {
    const f = failed.at(-1); const who = nameOf(f.agent_id);
    return { state: 'failed', step: step(f), steps, agentId: f.agent_id, who, line: `${of(step(f))}: ${who ? `${who} could not finish ` : 'Could not finish '}${short(f.title, 80)}` };
  }
  const who = nameOf(next?.agent_id);
  return { state: doneN ? 'working' : 'todo', step: step(next), steps, agentId: next?.agent_id ?? null, who, line: `${of(step(next))}: up next${who ? ` for ${who}` : ''}, ${short(next.title, 80)}` };
}

/** Rebuild the card for the job this task belongs to. Returns the card row, or null. */
export function refreshCard(db, taskId, now = Date.now()) {
  const t = get(db, 'SELECT id, floor_id, plan, project, created_at FROM tasks WHERE id=?', taskId);
  if (!t) return null;
  const key = jobKey(t);
  const tasks = t.plan
    ? all(db, 'SELECT id, title, plan, project, status, agent_id, created_at, updated_at FROM tasks WHERE floor_id=? AND plan=? AND project=? ORDER BY id', t.floor_id, t.plan, t.project || '')
    : all(db, 'SELECT id, title, plan, project, status, agent_id, created_at, updated_at FROM tasks WHERE id=?', t.id);
  const names = new Map(all(db, 'SELECT id, name FROM agents WHERE floor_id=?', t.floor_id).map((a) => [a.id, a.name]));
  const c = cardFor(tasks, (id) => names.get(id) || '');
  const was = get(db, 'SELECT * FROM job_cards WHERE floor_id=? AND key=?', t.floor_id, key);
  const title = was?.title || jobTitle(tasks);
  const fields = [c.state, c.step, c.steps, c.agentId, c.who, c.line, JSON.stringify(tasks.map((x) => x.id))];
  if (was && was.state === c.state && was.step === c.step && was.steps === c.steps && was.line === c.line && (was.agent_id ?? null) === (c.agentId ?? null) && was.task_ids === fields[6]) return null;
  const done = ['done', 'failed', 'cancelled'].includes(c.state) ? (was?.done_at || now) : null;
  if (was) run(db, 'UPDATE job_cards SET state=?, step=?, steps=?, agent_id=?, who=?, line=?, task_ids=?, updated_at=?, done_at=? WHERE id=?', ...fields, now, done, was.id);
  else run(db, 'INSERT INTO job_cards (floor_id, key, project, title, state, step, steps, agent_id, who, line, task_ids, created_at, updated_at, done_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', t.floor_id, key, t.project || '', title, ...fields, now, now, done);
  return get(db, 'SELECT * FROM job_cards WHERE floor_id=? AND key=?', t.floor_id, key);
}

/** A manager's words after a round it ran on its own: kept for its memory, never shown in the chat (STATUS_FROM_CODE=0 shows them again). */
export function markQuiet(db, floorId, messageId) { run(db, 'INSERT OR IGNORE INTO quiet_messages (message_id, floor_id) VALUES (?,?)', messageId, floorId); }

/** A card as the boss reads it. */
export const cardView = (r) => ({ id: r.id, project: r.project, title: r.title, state: r.state, step: r.step, steps: r.steps, agentId: r.agent_id, who: r.who, line: r.line, thumb: r.thumb || null, createdAt: r.created_at, updatedAt: r.updated_at, doneAt: r.done_at });
/** A card as a visitor reads it: private work says only that it is private; names of private things are taken out of the rest. */
export function publicCard(db, floor, r) {
  const priv = r.project ? !!get(db, 'SELECT private FROM projects WHERE floor_id=? AND slug=?', floor.id, r.project)?.private : !!floor.default_private;
  if (priv) return { ...cardView(r), project: '', title: PRIVATE_JOB, line: PRIVATE_JOB, thumb: null };
  const hide = redactor(db, floor.id);
  return { ...cardView(r), title: hide(r.title), line: hide(r.line) };
}
/** The floor's newest cards, newest first. */
export function floorCards(db, floor, { owner = false, limit = 30 } = {}) {
  return all(db, 'SELECT * FROM job_cards WHERE floor_id=? ORDER BY updated_at DESC, id DESC LIMIT ?', floor.id, limit).map((r) => (owner ? cardView(r) : publicCard(db, floor, r)));
}

export function installJobCards(ext) {
  const { db, cfg, engine, hooks, now } = ext;
  // Every task change already goes out through emitTask; the card for its job follows it, and goes out too: whole to the boss, as a visitor
  // may read it to everyone else.
  const emitTask = engine.emitTask.bind(engine);
  engine.emitTask = (id) => {
    emitTask(id);
    if (cfg.jobCards === false) return;
    try {
      const r = refreshCard(db, id, now());
      if (!r) return;
      const floor = get(db, 'SELECT id, default_private FROM floors WHERE id=?', r.floor_id);
      engine.emit(r.floor_id, 'jobcard', cardView(r), { persist: false, ownerOnly: true, project: r.project });
      engine.emit(r.floor_id, 'jobcard_public', publicCard(db, floor, r), { persist: false });
    } catch (e) { ext.log?.('warn', 'job card', { err: String(e?.message || e).slice(0, 160) }); }
  };
  hooks.snapshot.push((f, viewer, out) => {
    if (cfg.jobCards !== false) out.jobs = floorCards(db, f, { owner: viewer.owner });
    if (Array.isArray(out.messages)) {
      const quiet = new Set(all(db, 'SELECT message_id id FROM quiet_messages WHERE floor_id=?', f.id).map((r) => r.id));
      if (quiet.size) out.messages = out.messages.filter((m) => !quiet.has(m.id));
    }
  });
  return null;
}
