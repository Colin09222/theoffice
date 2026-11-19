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
import { queueJobShot } from './shots.js';

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

/** A card as the boss reads it. `base` is the office's path, for the thumbnail's address. */
export const cardView = (r, floor = null, base = '/theoffice') => ({ id: r.id, project: r.project, title: r.title, state: r.state, step: r.step, steps: r.steps, agentId: r.agent_id, who: r.who, line: r.line,
  thumb: r.thumb && floor?.slug ? `${base}/api/floors/${floor.slug}/jobshot/${r.thumb}` : null, createdAt: r.created_at, updatedAt: r.updated_at, doneAt: r.done_at });
const isPrivateCard = (db, floor, r) => (r.project ? !!get(db, 'SELECT private FROM projects WHERE floor_id=? AND slug=?', floor.id, r.project)?.private : !!floor.default_private);
/** A card as a visitor reads it: private work says only that it is private; names of private things are taken out of the rest. */
export function publicCard(db, floor, r, base) {
  if (isPrivateCard(db, floor, r)) return { ...cardView(r, floor, base), project: '', title: PRIVATE_JOB, line: PRIVATE_JOB, thumb: null };
  const hide = redactor(db, floor.id);
  return { ...cardView(r, floor, base), title: hide(r.title), line: hide(r.line) };
}
/** The floor's newest cards, newest first. */
export function floorCards(db, floor, { owner = false, limit = 30, base } = {}) {
  return all(db, 'SELECT * FROM job_cards WHERE floor_id=? ORDER BY updated_at DESC, id DESC LIMIT ?', floor.id, limit).map((r) => (owner ? cardView(r, floor, base) : publicCard(db, floor, r, base)));
}

const LANE_WORDS = { game: 'Game', website: 'Website', business: 'Business' };
/**
 * What the floor's status card says (docs/redesign, Q4, job 15), from rows alone: lane, goal, now (step N of M), next, last shipped.
 * A visitor's copy has private work taken out, as everywhere else. No model is asked anything.
 */
export function statusFor(db, floor, { owner = false, base = '/theoffice', liveUrl = null } = {}) {
  const hide = owner ? (x) => x : redactor(db, floor.id);
  const has = (t) => !!get(db, "SELECT 1 x FROM sqlite_master WHERE type='table' AND name=?", t);
  const priv = (project) => (project ? !!get(db, 'SELECT private FROM projects WHERE floor_id=? AND slug=?', floor.id, project)?.private : !!floor.default_private);
  const visible = (project) => owner || !priv(project);
  let lane = get(db, "SELECT lane FROM tasks WHERE floor_id=? AND lane!='' ORDER BY id DESC LIMIT 1", floor.id)?.lane || '';
  if (has('business_journeys') && get(db, "SELECT 1 x FROM business_journeys WHERE floor_id=? AND status='active'", floor.id)) lane = 'business';
  const cards = all(db, 'SELECT * FROM job_cards WHERE floor_id=? ORDER BY updated_at DESC, id DESC LIMIT 20', floor.id);
  const open = cards.find((c) => !['done', 'failed', 'cancelled'].includes(c.state) && visible(c.project));
  const now = open ? (owner ? cardView(open, floor, base) : publicCard(db, floor, open, base)) : null;
  const goalRow = has('work_modes') ? get(db, 'SELECT goal FROM work_modes WHERE floor_id=?', floor.id)?.goal : '';
  const goal = goalRow ? hide(String(goalRow).split('\n')[0].slice(0, 140)) : now ? now.title : '';
  // Next: the first job step waiting to start that isn't the one Now already names.
  const nextTask = all(db, "SELECT id, title, project FROM tasks WHERE floor_id=? AND status='todo' ORDER BY id LIMIT 10", floor.id).find((t) => visible(t.project) && !(now && now.state === 'todo' && now.line.includes(String(t.title).slice(0, 40))));
  const shipped = get(db, `SELECT slug, title, kind, published_at FROM projects WHERE floor_id=? AND published_at IS NOT NULL ${owner ? '' : 'AND private=0'} ORDER BY published_at DESC LIMIT 1`, floor.id);
  const shot = shipped && get(db, 'SELECT taken_at FROM launch_shots WHERE floor_id=? AND project=? AND image IS NOT NULL', floor.id, shipped.slug);
  return {
    lane: LANE_WORDS[lane] || '',
    goal,
    now: now ? { line: now.line, step: now.step, steps: now.steps, who: now.who, title: now.title, state: now.state } : null,
    next: nextTask ? hide(nextTask.title) : '',
    lastShipped: shipped ? { slug: shipped.slug, title: shipped.title, kind: shipped.kind, publishedAt: shipped.published_at, url: liveUrl ? liveUrl(shipped.slug) : null,
      thumb: shot ? `${base}/api/building/shot/${floor.slug}/${shipped.slug}?v=${shot.taken_at}` : `${base}/api/building/thumb/${floor.slug}/${shipped.slug}` } : null,
  };
}

export function installJobCards(ext) {
  const { db, cfg, engine, hooks, now, GET, send, floorBySlug, viewerFor, HttpError, BASE } = ext;
  const sendCard = (r) => {
    const floor = get(db, 'SELECT id, slug, default_private FROM floors WHERE id=?', r.floor_id);
    engine.emit(r.floor_id, 'jobcard', cardView(r, floor, BASE), { persist: false, ownerOnly: true, project: r.project });
    engine.emit(r.floor_id, 'jobcard_public', publicCard(db, floor, r, BASE), { persist: false });
  };
  // A step photo arrived (server/shots.js): the card goes out again with its thumbnail.
  ext.cardChanged = (cardId) => { const r = get(db, 'SELECT * FROM job_cards WHERE id=?', cardId); if (r) sendCard(r); };
  const askShot = (r, step) => { if (r && queueJobShot(db, { floorId: r.floor_id, cardId: r.id, step, project: r.project, now: now() })) ext.shotsNudge?.(); };
  // Every task change already goes out through emitTask; the card for its job follows it, and goes out too: whole to the boss, as a visitor
  // may read it to everyone else.
  const emitTask = engine.emitTask.bind(engine);
  engine.emitTask = (id) => {
    emitTask(id);
    if (cfg.jobCards === false) return;
    try {
      const r = refreshCard(db, id, now());
      if (!r) return;
      sendCard(r);
      // A step handed in or finished on a project that is up: one photo of it for the timeline (four a job at most).
      const t = get(db, 'SELECT status, project FROM tasks WHERE id=?', id);
      if (t && ['done', 'review'].includes(t.status) && t.project) askShot(r, `task:${id}`);
    } catch (e) { ext.log?.('warn', 'job card', { err: String(e?.message || e).slice(0, 160) }); }
  };
  // Going live is a step everyone wants to see: the newest card for that project gets a photo of the live page.
  const emitProject = engine.emitProject.bind(engine);
  engine.emitProject = (floorId, slug) => {
    emitProject(floorId, slug);
    if (cfg.jobCards === false) return;
    try {
      const at = get(db, 'SELECT published_at FROM projects WHERE floor_id=? AND slug=?', floorId, slug)?.published_at;
      if (at) askShot(get(db, 'SELECT * FROM job_cards WHERE floor_id=? AND project=? ORDER BY updated_at DESC, id DESC LIMIT 1', floorId, slug), `publish:${at}`);
    } catch (e) { ext.log?.('warn', 'job card shot', { err: String(e?.message || e).slice(0, 160) }); }
  };
  // A step photo. The boss sees every one of their floor's; a visitor only one of public work.
  GET('/api/floors/:slug/jobshot/:id', async ({ req, res, p }) => {
    const f = floorBySlug(p.slug);
    const shot = /^\d{1,12}$/.test(p.id) ? get(db, 'SELECT s.image, c.project, c.floor_id FROM job_shots s JOIN job_cards c ON c.id = s.card_id WHERE s.id=? AND s.floor_id=? AND s.image IS NOT NULL', Number(p.id), f.id) : null;
    if (!shot) throw new HttpError(404, 'not_found');
    const viewer = viewerFor(req, f);
    if (!viewer.owner && (f.filler && !cfg.demoFloorsPublic ? false : isPrivateCard(db, f, shot))) throw new HttpError(404, 'not_found');
    send(res, 200, Buffer.from(shot.image), { 'content-type': 'image/jpeg', 'cache-control': viewer.owner ? 'private, max-age=3600' : 'public, max-age=3600' });
  });
  hooks.snapshot.push((f, viewer, out) => {
    if (cfg.jobCards !== false) out.jobs = floorCards(db, f, { owner: viewer.owner, base: BASE });
    if (cfg.jobCards !== false) out.status = statusFor(db, f, { owner: viewer.owner, base: BASE, liveUrl: (slug) => engine.liveUrl(f, slug) });
    if (Array.isArray(out.messages)) {
      const quiet = new Set(all(db, 'SELECT message_id id FROM quiet_messages WHERE floor_id=?', f.id).map((r) => r.id));
      if (quiet.size) out.messages = out.messages.filter((m) => !quiet.has(m.id));
    }
  });
  return null;
}
