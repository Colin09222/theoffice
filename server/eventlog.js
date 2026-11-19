// The job event log (docs/redesign/OFFICE-ANSWERS-2.md, Q24 idea 1; job r2-j47): every job keeps its events with their times, so Replay (r2-j48)
// can play a real past job back. A job is a job card (server/jobcards.js). What is kept: the card's own changes, each task change, handoffs,
// talk beats (assign, handoff, findings, review), a Tester's check, and the launch. Kept for JOB_EVENTS_DAYS (default 35, never under 30), well
// past the floor's own event list, which keeps only its last 1,500. Raw on the server; whoever reads it applies the visitor's rules (r2-j48).
// Nothing here calls a model. JOB_EVENTS=0 stops the recording.
import { get, run } from './db.js';
import { jobKey } from './jobcards.js';

const DAY = 86400000;
const BEATS = new Set(['assign', 'handoff', 'findings', 'review', 'plan']);
const short = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** How many days the log keeps: JOB_EVENTS_DAYS, never fewer than 30 (the spec's floor). */
export const keepDays = (cfg) => Math.max(30, Number(cfg.jobEventsDays) || 35);

/** The job card a task belongs to, by its key: the same card the timeline shows. */
function cardOfTask(db, taskId) {
  const t = get(db, 'SELECT id, floor_id, plan, project FROM tasks WHERE id=?', taskId);
  if (!t) return null;
  const c = get(db, 'SELECT id FROM job_cards WHERE floor_id=? AND key=?', t.floor_id, jobKey(t));
  return c ? { card: c.id, task: t.id, project: t.project || '' } : null;
}
/** The job someone is on: their latest task's card. Handoffs and talk lines name people, not tasks. */
function cardOfAgent(db, floorId, agentId) {
  const t = get(db, "SELECT id FROM tasks WHERE floor_id=? AND agent_id=? AND status!='cancelled' ORDER BY updated_at DESC, id DESC LIMIT 1", floorId, agentId);
  return t ? cardOfTask(db, t.id) : null;
}

/**
 * One event from the engine, as the log keeps it: { card, task, kind, project, data } or null when it is not part of a job. The data is the few
 * fields a replay needs, never a whole report.
 */
export function logEntry(db, floorId, type, d = {}) {
  if (type === 'task' && d.id) {
    const c = cardOfTask(db, d.id); if (!c) return null;
    const t = get(db, 'SELECT title, status, agent_id FROM tasks WHERE id=?', d.id);
    return { ...c, kind: 'task', data: { status: t.status, title: short(t.title, 120), agent: t.agent_id } };
  }
  if (type === 'beat' && d.task) { const c = cardOfTask(db, d.task); return c && { ...c, kind: 'check', data: { passed: !!d.passed, agent: d.agent } }; }
  if (type === 'handoff' && d.from != null) { const c = cardOfAgent(db, floorId, d.from); return c && { ...c, kind: 'handoff', data: { from: d.from, to: d.to } }; }
  const beat = d.beat || d.kind;
  if (type === 'talk' && BEATS.has(beat) && typeof d.from === 'number') {
    const c = cardOfAgent(db, floorId, beat === 'assign' ? d.to ?? d.from : d.from); if (!c) return null;
    // The words as the boss heard them, and as a visitor may (pub), and whether they stay with the boss (hush), the same rules as live talk.
    return { ...c, kind: 'talk', data: { beat, from: d.from, to: d.to ?? null, text: short(d.text, 200), ...(d.pub ? { pub: short(d.pub, 200) } : {}), ...(d.hush ? { hush: true } : {}) } };
  }
  if (type === 'project' && d.slug) {
    const p = get(db, 'SELECT published_at FROM projects WHERE floor_id=? AND slug=?', floorId, d.slug);
    const c = get(db, 'SELECT id FROM job_cards WHERE floor_id=? AND project=? ORDER BY updated_at DESC, id DESC LIMIT 1', floorId, d.slug);
    return c && p?.published_at ? { card: c.id, task: null, project: d.slug, kind: 'launch', data: { slug: d.slug, at: p.published_at } } : null;
  }
  if (type === 'jobcard' && d.id) return { card: d.id, task: null, project: d.project || '', kind: 'card', data: { state: d.state, step: d.step, steps: d.steps, who: short(d.who, 40), line: short(d.line, 160), title: short(d.title, 120) } };
  return null;
}

export function installEventLog(ext) {
  const { db, cfg, engine, now, log } = ext;
  const emit = engine.emit.bind(engine);
  engine.emit = (floorId, type, data, opts) => {
    emit(floorId, type, data, opts);
    if (cfg.jobEvents === false) return;
    try {
      const e = logEntry(db, floorId, type, data || {});
      if (e) run(db, 'INSERT INTO job_events (floor_id, card_id, task_id, kind, project, data, created_at) VALUES (?,?,?,?,?,?,?)', floorId, e.card, e.task, e.kind, e.project, JSON.stringify(e.data), now());
    } catch (err) { log?.('warn', 'job event log', { err: String(err?.message || err).slice(0, 160) }); }
  };
  /** Old events go after keepDays; checked hourly. */
  const prune = (at = now()) => run(db, 'DELETE FROM job_events WHERE created_at < ?', at - keepDays(cfg) * DAY).changes;
  ext.pruneJobEvents = prune;
  let timer = null;
  return {
    prune,
    start() { prune(); timer = setInterval(() => prune(), 3600000); timer.unref?.(); },
    stop() { clearInterval(timer); timer = null; },
  };
}
