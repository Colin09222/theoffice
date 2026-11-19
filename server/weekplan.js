// The weekly plan, with no budget (docs/redesign/ROUND1-REST.md, job 20; the owner's ruling of 2026-11-19). Every Monday at 08:05 New York time (the
// digest's clock, right after the night freeze lifts) the manager drafts one plan for each open floor that has a goal or recent work: one goal, up to 5
// jobs, each with 3 to 5 done-means lines (job 9) and its estimate (job 21) shown as information. One manager call per floor per week at most.
// The boss sees it on the status card with Approve and Edit. Approving starts it. If nobody approves, the manager carries on with the draft after
// WEEKLY_PLAN_AUTOSTART_HOURS (24), exactly as if approved. Nothing ever goes Idle, waits for money or stops spending because of a plan.
// Skipped: demo floors, paused floors, floors stopped at a $0 stop, and floors switched out of weekly plans (admin.mjs plan --floor N off).
// WEEKLY_PLAN=0 turns the Monday draft off building-wide.
import { get, all, run } from './db.js';
import { wallClock } from './modes.js';
import { digestAt } from './owneralerts.js';
import { OWNER_TZ } from './spendcheck.js';
import { cleanChecks } from './brain.js';
import { kindOf, estimateFor, estimateLine } from './estimate.js';
import { LINES_MIN, LINES_MAX } from './donemeans.js';

export const JOBS_MAX = 5;
const ROLES = ['builder', 'writer', 'designer', 'researcher', 'tester'];
const SIZES = ['small', 'standard', 'big'];
const LANES = ['game', 'website', 'business', 'app', 'shop'];
const HOUR = 3600000, DAY = 86400000;
const one = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const fence = (source, text) => `<untrusted_data source="${source}">${String(text).replace(/<\/?\s*untrusted_data/gi, '[untrusted_data')}</untrusted_data>`;

/** The week a moment belongs to, by its Monday in New York: '2026-11-23'. */
export function weekOf(at) {
  const w = wallClock(OWNER_TZ, at);
  return new Date(Date.UTC(w.y, w.m, w.d - ((w.weekday + 6) % 7))).toISOString().slice(0, 10);
}

/** Lines that make a job's done-means (3 to 5), from what the manager wrote, topped up from the job's own words when it wrote too few. */
function linesFor(job) {
  let lines = cleanChecks(job.checks || job.done_means || []).slice(0, LINES_MAX);
  const fill = [`It does what the plan says: ${one(job.title, 120)}`, 'It is live on the floor\'s own site', 'It reads well on a phone', 'Nothing that already worked is broken'];
  for (const f of fill) { if (lines.length >= LINES_MIN) break; if (!lines.includes(f)) lines.push(f); }
  return lines;
}
/** A job as kept: title, who, brief, done-means lines, size, lane, project, and its estimate (information only, never sent to a model). */
export function cleanJob(j, fallbackProject = 'site') {
  const title = one(j?.title, 160);
  if (!title) return null;
  const to = ROLES.includes(String(j.to || '').toLowerCase()) ? String(j.to).toLowerCase() : 'builder';
  const size = SIZES.includes(j.size) ? j.size : 'standard';
  const lane = LANES.includes(j.lane) ? j.lane : '';
  const job = { title, to, brief: one(j.brief || title, 2000), checks: linesFor(j), size, lane, project: slug(j.project) || fallbackProject };
  return job;
}

/** What the manager reads to draft the plan. Facts only; no money anywhere in it. */
export function draftPrompt(db, floor) {
  const mode = get(db, "SELECT goal, backlog FROM work_modes WHERE floor_id=?", floor.id) || {};
  const recent = all(db, "SELECT title, status, project FROM tasks WHERE floor_id=? AND created_at>=? AND status!='cancelled' ORDER BY id DESC LIMIT 15", floor.id, Date.now() - 14 * DAY);
  const live = all(db, 'SELECT slug, title, kind FROM projects WHERE floor_id=? AND published_at IS NOT NULL ORDER BY published_at DESC LIMIT 6', floor.id);
  const boss = all(db, "SELECT text FROM messages WHERE floor_id=? AND role='boss' ORDER BY id DESC LIMIT 5", floor.id).map((m) => one(m.text, 300)).reverse();
  const system = `You are the Office Manager of "${one(floor.name, 80) || 'a new company'}", floor ${floor.number} of The Office. It is Monday morning: draft this week's plan for the boss.
One goal for the week, in one line, and at most ${JOBS_MAX} jobs that get there, smallest useful steps first. For each job: a short title, who does it (builder, writer, designer or researcher),
a brief of a few lines, ${LINES_MIN} to ${LINES_MAX} "done means" lines anyone could check by opening the result, a size (small for a change to something live, standard, or big for a first build),
the lane if you know it (game, website, business) and the project slug it works on. Build on what is already live; don't start over. Nothing invented.
Answer with JSON only: {"goal": "...", "jobs": [{"title": "...", "to": "builder", "brief": "...", "checks": ["..."], "size": "standard", "lane": "website", "project": "site"}]}`;
  const user = [
    `The floor's goal so far: ${mode.goal ? fence('goal', one(mode.goal, 300)) : 'none set'}.`,
    `Live now: ${live.length ? live.map((p) => `${p.slug} (${p.kind}): ${fence('title', one(p.title, 80))}`).join('; ') : 'nothing yet'}.`,
    `Jobs in the last two weeks: ${recent.length ? recent.map((t) => `[${t.status}] ${fence('job', one(t.title, 100))}${t.project ? ` in ${t.project}` : ''}`).join('; ') : 'none'}.`,
    `Next-up list: ${(() => { try { const l = JSON.parse(mode.backlog || '[]'); return l.length ? fence('next up', l.join('; ')) : 'empty'; } catch { return 'empty'; } })()}.`,
    `What the boss said most recently: ${boss.length ? fence('boss', boss.join(' / ')) : 'nothing yet'}.`,
  ].join('\n');
  return { system, user };
}
/** The manager's answer, read as a plan: { goal, jobs } or null. */
export function readDraft(text, fallbackProject) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  let v; try { v = JSON.parse(m[0]); } catch { return null; }
  const jobs = (Array.isArray(v?.jobs) ? v.jobs : []).map((j) => cleanJob(j, fallbackProject)).filter(Boolean).slice(0, JOBS_MAX);
  const goal = one(v?.goal, 200);
  return goal && jobs.length ? { goal, jobs } : null;
}

/** The estimate the boss reads beside each job (job 21), worked out by code when the plan is shown. */
const withEstimate = (db, j) => { const e = estimateFor(db, kindOf([{ lane: j.lane, size: j.size, title: j.title, brief: j.brief }])); return { ...j, estimate: { usd: e.usd, line: estimateLine(e.usd) } }; };
export function planView(db, p, { estimates = true } = {}) {
  if (!p) return null;
  const jobs = JSON.parse(p.jobs || '[]');
  return { id: p.id, week: p.week, status: p.status, goal: p.goal, autostartAt: p.autostart_at, approvedAt: p.approved_at, startedAt: p.started_at,
    jobs: jobs.map((j) => (estimates ? withEstimate(db, j) : j)).map(({ title, to, size, checks, estimate }) => ({ title, to, size, checks, ...(estimate ? { estimate } : {}) })) };
}

export const floorOff = (db, floorId) => !!get(db, 'SELECT off FROM weekly_plan_floors WHERE floor_id=?', floorId)?.off;
export function setFloorPlans(db, floorId, on, at = Date.now()) {
  run(db, 'INSERT INTO weekly_plan_floors (floor_id,off,updated_at) VALUES (?,?,?) ON CONFLICT(floor_id) DO UPDATE SET off=excluded.off, updated_at=excluded.updated_at', floorId, on ? 0 : 1, at);
}
/** Ask the server to draft one now (admin.mjs plan --floor N --draft-now): picked up on its next tick. */
export function askDraftNow(db, floorId, at = Date.now()) {
  run(db, 'INSERT INTO weekly_plan_floors (floor_id,off,draft_asked,updated_at) VALUES (?,0,?,?) ON CONFLICT(floor_id) DO UPDATE SET draft_asked=excluded.draft_asked, updated_at=excluded.updated_at', floorId, at, at);
}
export const currentPlan = (db, floorId) => get(db, 'SELECT * FROM weekly_plans WHERE floor_id=? ORDER BY id DESC LIMIT 1', floorId);

export function installWeekPlans(ext) {
  const { db, cfg, engine, log = () => {}, now, hooks, GET, POST, json, readJson, limit, requireOwner, HttpError } = ext;
  let timer = null, busy = false;
  const autostartMs = () => Math.max(0, Number(cfg.weeklyPlanAutostartHours ?? 24)) * HOUR;

  /** Why a floor gets no draft this week, or null. */
  function skip(f) {
    if (f.status !== 'active' || f.filler) return 'demo or closed';
    if (f.paused) return 'paused';
    if (floorOff(db, f.id)) return 'switched off';
    if (f.budget_out || ['anthropic', 'openrouter'].some((p) => engine.budget.out(p, f.id))) return 'stopped at its limit';
    const goal = get(db, "SELECT goal FROM work_modes WHERE floor_id=? AND goal!=''", f.id);
    const recent = get(db, "SELECT 1 x FROM tasks WHERE floor_id=? AND created_at>=? AND status!='cancelled' LIMIT 1", f.id, now() - 14 * DAY);
    return goal || recent ? null : 'no goal and no recent work';
  }
  /** One manager call: the draft. Returns the plan row, or null. */
  async function draft(f, week) {
    const mgr = get(db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", f.id);
    if (!mgr) return null;
    // At most one draft a floor a week: the row is claimed before the call, so a slow call or a second tick can't make another.
    const claimed = run(db, "INSERT OR IGNORE INTO weekly_plans (floor_id,week,status,goal,jobs,created_at) VALUES (?,?,'drafting','','[]',?)", f.id, week, now()).changes;
    if (!claimed) return null;
    const id = get(db, 'SELECT id FROM weekly_plans WHERE floor_id=? AND week=?', f.id, week).id;
    try {
      const { system, user } = draftPrompt(db, f);
      const mainProject = get(db, 'SELECT slug FROM projects WHERE floor_id=? AND published_at IS NOT NULL ORDER BY published_at DESC LIMIT 1', f.id)?.slug || 'site';
      const res = await engine.callLLM({ floorId: f.id, agent: mgr, project: '', tier: engine.floorTier ? engine.floorTier(f.id) : '' }, { messages: [{ role: 'system', content: system }, { role: 'user', content: user }], tools: [], meta: { kind: 'weekplan', floorId: f.id, floorSlug: f.slug } });
      const plan = readDraft(res.content, mainProject);
      if (!plan) { run(db, "UPDATE weekly_plans SET status='failed' WHERE id=?", id); log('warn', 'weekly plan draft unreadable', { floor: f.number }); return null; }
      run(db, "UPDATE weekly_plans SET status='draft', goal=?, jobs=?, autostart_at=? WHERE id=?", plan.goal, JSON.stringify(plan.jobs), now() + autostartMs(), id);
      run(db, 'UPDATE weekly_plan_floors SET draft_asked=NULL WHERE floor_id=?', f.id);
      engine.officeNotice(f.id, `This week's plan is ready on your status card: ${plan.goal} Approve it, change it, or leave it: the team starts on it by itself tomorrow morning.`);
      engine.emit(f.id, 'weekplan', planView(db, currentPlan(db, f.id), { estimates: cfg.jobEstimates !== false }), { persist: false, ownerOnly: true });
      return currentPlan(db, f.id);
    } catch (e) {
      run(db, "UPDATE weekly_plans SET status='failed' WHERE id=?", id);
      log('warn', 'weekly plan draft failed', { floor: f.number, err: String(e?.message || e).slice(0, 160) });
      return null;
    }
  }
  /** The plan's jobs go to the staff through the ordinary engine, in order, under one plan name. Returns false if it has to wait (another plan is still open). */
  function startPlan(p) {
    const f = get(db, 'SELECT * FROM floors WHERE id=?', p.floor_id);
    if (!f || f.status !== 'active' || floorOff(db, f.id)) return false;
    // Job 10: no new plan while one is open. The week's plan waits its turn; it is never dropped and nothing stops meanwhile.
    if (get(db, "SELECT 1 x FROM tasks WHERE floor_id=? AND status IN ('todo','doing','blocked') AND plan!='' AND plan NOT LIKE 'This week:%' LIMIT 1", f.id)) return false;
    const mgr = get(db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", f.id);
    const planName = `This week: ${p.goal}`.slice(0, 120);
    const jobs = JSON.parse(p.jobs || '[]').slice(0, JOBS_MAX);
    const ids = []; let prev = null;
    for (const j of jobs) {
      try {
        const t = engine.assignTask(f, mgr, { to: j.to, title: j.title, brief: j.brief, plan: planName, project: j.project, dependsOn: prev ? [prev] : [], afterPrevious: false, lane: j.lane, size: j.size, checks: j.checks });
        ids.push(t.id); prev = t.id;
      } catch (e) { log('warn', 'weekly plan job not handed out', { floor: f.number, err: String(e?.message || e).slice(0, 160) }); }
    }
    // The floor's goal follows the week's, when it has none of its own.
    if (get(db, "SELECT 1 x FROM sqlite_master WHERE type='table' AND name='work_modes'")) {
      run(db, 'INSERT OR IGNORE INTO work_modes (floor_id) VALUES (?)', f.id);
      run(db, "UPDATE work_modes SET goal=? WHERE floor_id=? AND goal=''", p.goal, f.id);
    }
    run(db, "UPDATE weekly_plans SET status='started', started_at=?, task_ids=? WHERE id=?", now(), JSON.stringify(ids), p.id);
    engine.officeNotice(f.id, `This week's plan has started: ${jobs.length} job${jobs.length === 1 ? '' : 's'} toward "${p.goal}".`);
    engine.emit(f.id, 'weekplan', planView(db, currentPlan(db, f.id), { estimates: cfg.jobEstimates !== false }), { persist: false, ownerOnly: true });
    engine.kick();
    return true;
  }
  async function tick() {
    if (busy) return; busy = true;
    try {
      const t = now();
      // Plans waiting to start: approved ones at once, drafts once their wait is up.
      for (const p of all(db, "SELECT * FROM weekly_plans WHERE status='approved' OR (status='draft' AND autostart_at<=?)", t)) startPlan(p);
      if (cfg.weeklyPlan === false) return;
      const w = wallClock(OWNER_TZ, t);
      const monday = w.weekday === 1 && t >= digestAt(cfg, t);
      const asked = new Set(all(db, 'SELECT floor_id FROM weekly_plan_floors WHERE draft_asked IS NOT NULL AND off=0').map((r) => r.floor_id));
      if (!monday && !asked.size) return;
      const week = weekOf(t);
      for (const f of all(db, "SELECT * FROM floors WHERE status='active' ORDER BY number")) {
        if (!monday && !asked.has(f.id)) continue;
        if (get(db, 'SELECT 1 x FROM weekly_plans WHERE floor_id=? AND week=?', f.id, week)) {
          if (asked.has(f.id)) { run(db, "DELETE FROM weekly_plans WHERE floor_id=? AND week=? AND status IN ('failed')", f.id, week); if (get(db, 'SELECT 1 x FROM weekly_plans WHERE floor_id=? AND week=?', f.id, week)) { run(db, 'UPDATE weekly_plan_floors SET draft_asked=NULL WHERE floor_id=?', f.id); continue; } } else continue;
        }
        if (skip(f)) { if (asked.has(f.id)) run(db, 'UPDATE weekly_plan_floors SET draft_asked=NULL WHERE floor_id=?', f.id); continue; }
        await draft(f, week);
      }
    } catch (e) { log('error', 'weekly plans', { err: String(e?.message || e).slice(0, 200) }); } finally { busy = false; }
  }

  // ---- the boss's side ----
  hooks.snapshot.push((f, viewer, out) => {
    if (!viewer.owner) return;
    const p = currentPlan(db, f.id);
    if (p && ['draft', 'approved', 'started'].includes(p.status) && p.week === weekOf(now())) out.weekPlan = planView(db, p, { estimates: cfg.jobEstimates !== false });
  });
  const planFor = (f) => { const p = currentPlan(db, f.id); if (!p || !['draft', 'approved'].includes(p.status)) throw new HttpError(409, 'no_plan', 'There is no plan waiting this week.'); return p; };
  GET('/api/floors/:slug/weekplan', async ({ req, res, p }) => {
    const f = requireOwner(req, p.slug);
    json(res, 200, { plan: planView(db, currentPlan(db, f.id), { estimates: cfg.jobEstimates !== false }), off: floorOff(db, f.id) });
  });
  POST('/api/floors/:slug/weekplan/approve', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug); limit('mutate', ip);
    const plan = planFor(f);
    run(db, "UPDATE weekly_plans SET status='approved', approved_at=? WHERE id=?", now(), plan.id);
    startPlan(currentPlan(db, f.id));
    json(res, 200, { plan: planView(db, currentPlan(db, f.id), { estimates: cfg.jobEstimates !== false }) });
  });
  POST('/api/floors/:slug/weekplan/edit', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug); limit('mutate', ip);
    const plan = planFor(f);
    const b = await readJson(req, 16384);
    const had = JSON.parse(plan.jobs || '[]');
    const goal = typeof b.goal === 'string' && one(b.goal, 200) ? one(b.goal, 200) : plan.goal;
    // The boss's list: kept jobs by their number (reworded if a new title came with them), and new ones by title.
    const list = Array.isArray(b.jobs) ? b.jobs : had.map((_, i) => ({ keep: i }));
    const jobs = [];
    for (const x of list.slice(0, JOBS_MAX)) {
      if (Number.isInteger(x?.keep) && had[x.keep]) { const j = had[x.keep]; const title = one(x.title, 160); jobs.push(title ? { ...j, title, brief: j.brief === j.title ? title : j.brief } : j); } else if (one(x?.title, 160)) jobs.push(cleanJob({ title: x.title, to: x.to || 'builder', brief: x.title, size: 'standard' }, had[0]?.project || 'site'));
    }
    if (!jobs.length) throw new HttpError(400, 'no_jobs', 'A plan needs at least one job.');
    run(db, 'UPDATE weekly_plans SET goal=?, jobs=?, edited_at=? WHERE id=?', goal, JSON.stringify(jobs), now(), plan.id);
    json(res, 200, { plan: planView(db, currentPlan(db, f.id), { estimates: cfg.jobEstimates !== false }) });
  });

  const api = {
    tick, draft, startPlan,
    start() { if (timer) return; timer = setInterval(() => { tick(); }, cfg.weekPlanTickMs ?? 60000); timer.unref?.(); tick(); },
    stop() { clearInterval(timer); timer = null; },
  };
  engine.weekPlans = api;
  return api;
}
