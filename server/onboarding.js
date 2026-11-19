// Onboarding (docs/redesign/ROUND1-REST.md, job 23; the spec's Q7 "first 5 minutes" and section 4 "Onboarding"): from a code to a working team in
// about 3 minutes. The code holder sees "This is your floor" and three lane cards (Game, Website, Business), picks a template (its price shown as
// information, from Q7; no price-compare directory), answers three short questions, and the manager shows the plan: the goal, up to 5 jobs, each job's
// done-means lines and "This will cost about $X". One button: Start. Start means start: it is not a price approval and nothing waits on money.
// "Something else" is the plain message box to the manager. One manager call drafts the plan; if its answer can't be read, the template's own plan is
// used, so a new floor is never stuck at this step. ONBOARDING=0 brings back the old setup screen.
import { get, all, run } from './db.js';
import { readDraft, cleanJob, JOBS_MAX } from './weekplan.js';
import { kindOf, estimateFor, estimateLine } from './estimate.js';

const one = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const fence = (source, text) => `<untrusted_data source="${source}">${String(text).replace(/<\/?\s*untrusted_data/gi, '[untrusted_data')}</untrusted_data>`;
/** At most this many plans drafted while a floor is being set up: going back and changing the answers is fine, a loop is not. */
export const DRAFTS_MAX = 6;

/** The three lanes, their templates with the spec's Q7 prices (information only), and their three short questions. */
export const LANES = [
  { id: 'game', label: 'Game', blurb: 'A small game people play in the browser.',
    templates: [{ id: 'arcade', label: 'Arcade game', price: 'About $1 to $3', lane: 'game', project: 'game', size: 'big' }],
    questions: ['What is the game about?', 'How do you win, or score points?', 'Any name or colours?'] },
  { id: 'website', label: 'Website', blurb: 'A site for you, a club, a side project or a local business.',
    templates: [
      { id: 'one-page', label: 'One-page website', price: 'About $1', lane: 'website', project: 'site', size: 'big' },
      { id: 'service', label: 'Local service site with a booking form', price: 'About $2 to start', lane: 'website', project: 'site', size: 'big', form: true },
    ],
    questions: ['Who is it for?', 'What should a visitor do?', 'Any name or colours?'] },
  { id: 'business', label: 'Business', blurb: 'A small business or shop, set up to make its first dollar.',
    templates: [{ id: 'shop', label: 'Business or shop, first pass', price: 'About $2 to $4', lane: 'business', project: 'shop', size: 'big' }],
    questions: ['What do you sell, and to whom?', 'How should a customer buy or get in touch?', 'Any name or colours?'] },
];
const laneOf = (id) => LANES.find((l) => l.id === id) || null;
const templateOf = (lane, id) => lane?.templates.find((t) => t.id === id) || null;

/** The template's own plan, used when the manager's answer can't be read. Three jobs, each with three done-means lines. */
export function templatePlan(lane, tpl, answers) {
  const [a, b] = answers;
  const what = tpl.label.toLowerCase();
  const base = { lane: tpl.lane, project: tpl.project };
  const jobs = lane.id === 'game'
    ? [{ title: 'Build the first playable version', to: 'builder', brief: `An ${what}: ${a}. Winning or scoring: ${b}.`, checks: ['The game opens in a browser', 'You can play a round and see your score', 'It works with a phone\'s touch'], size: 'big' },
      { title: 'Write the title screen and how-to-play line', to: 'writer', brief: `Short, plain words for the ${what}.`, checks: ['The title screen names the game', 'One line says how to play', 'Nothing in it is made up'], size: 'small' },
      { title: 'Publish it and check it on a phone', to: 'builder', brief: 'Put the game live and fix anything that breaks on a phone.', checks: ['The game is live at its link', 'It loads on a phone', 'A round can be finished'], size: 'small' }]
    : [{ title: `Build the ${lane.id === 'business' ? 'shop\'s first page' : 'site'}`, to: 'builder', brief: `A ${what} for ${a}. Visitors should: ${b}.`, checks: ['The page loads', `A visitor can ${one(b, 60).replace(/[.!]+$/, '') || 'get in touch'}`, 'It fits a phone'], size: 'big' },
      { title: 'Write the words', to: 'writer', brief: `Plain words for ${a}.`, checks: ['The heading says what it is', 'It says who it is for', 'Nothing in it is made up'], size: 'standard' },
      { title: 'Publish it and check it on a phone', to: 'builder', brief: 'Put it live and fix anything that breaks on a phone.', checks: ['It is live at its link', 'It loads on a phone', 'Every button does something'], size: 'small' }];
  const goal = lane.id === 'game' ? `A playable ${what} about ${one(a, 80)}` : `A ${what} for ${one(a, 80)}, live`;
  return { goal: one(goal, 200), jobs: jobs.map((j) => cleanJob({ ...base, ...j }, tpl.project)) };
}

/** What the manager reads. The boss's answers are fenced as data; no money in it. */
export function onboardingPrompt(floor, lane, tpl, answers) {
  const system = `You are the Office Manager of a brand-new company on floor ${floor.number} of The Office. The boss has just arrived and picked: ${lane.label}, "${tpl.label}".
Draft the first plan: one goal in one line, and at most ${JOBS_MAX} jobs that get there, the first live version as soon as possible (usually 3 jobs). For each job: a short title, who does it
(builder, writer, designer or researcher), a brief of a few lines from the boss's answers, 3 to 5 "done means" lines anyone could check by opening the result, a size (big for the first build,
standard, or small for a change), the lane (${tpl.lane}) and the project slug (${tpl.project}). Also a short company name: the one the boss gave, else a plain one from their answers.
Nothing invented beyond the answers. Answer with JSON only: {"name": "...", "goal": "...", "jobs": [{"title": "...", "to": "builder", "brief": "...", "checks": ["..."], "size": "big", "lane": "${tpl.lane}", "project": "${tpl.project}"}]}`;
  const user = lane.questions.map((q, i) => `${q} ${fence('boss', answers[i] || '(no answer)')}`).join('\n');
  return { system, user };
}

/** The plan as the boss sees it: goal, jobs with their done-means lines, and one estimate line for the whole plan (information only). */
export function onboardingView(db, p, { estimates = true } = {}) {
  if (!p) return null;
  const jobs = JSON.parse(p.jobs || '[]');
  // The plan is one job on the timeline (one plan, one project), so it is estimated as one: its kind from all its steps, as server/estimate.js does.
  const kind = kindOf(jobs.map((j) => ({ lane: j.lane, size: j.size, title: j.title, brief: j.brief })).concat(p.form ? [{ title: 'booking form' }] : []));
  const usd = estimates ? estimateFor(db, kind).usd : 0;
  return { id: p.id, status: p.status, lane: p.lane, template: p.template, name: p.name, goal: p.goal, startedAt: p.started_at,
    jobs: jobs.map(({ title, to, checks }) => ({ title, to, checks })), steps: jobs.length,
    ...(estimates && usd ? { estimate: { usd, line: estimateLine(usd) } } : {}) };
}
export const latestOnboarding = (db, floorId) => get(db, 'SELECT * FROM onboarding_plans WHERE floor_id=? ORDER BY id DESC LIMIT 1', floorId);

export function installOnboarding(ext) {
  const { db, cfg, engine, log = () => {}, now, hooks, GET, POST, json, readJson, limit, requireOwner, HttpError } = ext;
  if (!engine) return null;
  const on = () => cfg.onboarding !== false;
  const view = (p) => onboardingView(db, p, { estimates: cfg.jobEstimates !== false });
  const lanesOut = () => LANES.map(({ id, label, blurb, templates, questions }) => ({ id, label, blurb, questions, templates: templates.map(({ id: t, label: l, price }) => ({ id: t, label: l, price })) }));
  /** A floor still being set up: nothing handed out yet and no plan started. */
  const fresh = (f) => !get(db, "SELECT 1 x FROM tasks WHERE floor_id=? LIMIT 1", f.id) && !get(db, "SELECT 1 x FROM onboarding_plans WHERE floor_id=? AND status='started'", f.id);

  hooks.snapshot.push((f, viewer, out) => {
    if (!viewer.owner || !on() || f.status !== 'active') return;
    const p = latestOnboarding(db, f.id);
    if (p?.status === 'started' || !fresh(f)) return;
    out.onboarding = { on: true, plan: p && p.status === 'draft' ? view(p) : null };
  });

  GET('/api/floors/:slug/onboarding', async ({ req, res, p }) => {
    const f = requireOwner(req, p.slug);
    json(res, 200, { on: on(), lanes: lanesOut(), plan: view(latestOnboarding(db, f.id)) });
  });

  /** One manager call: the plan from the boss's three answers. Falls back to the template's own plan. */
  POST('/api/floors/:slug/onboarding/plan', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug); limit('mutate', ip);
    if (!on()) throw new HttpError(404, 'off', 'Onboarding is switched off.');
    if (!fresh(f)) throw new HttpError(409, 'started', 'This floor has already started work.');
    const b = await readJson(req, 8192);
    const lane = laneOf(b.lane); const tpl = templateOf(lane, b.template);
    if (!lane || !tpl) throw new HttpError(400, 'bad_lane', 'Pick a lane and a template.');
    const answers = lane.questions.map((_, i) => one(Array.isArray(b.answers) ? b.answers[i] : '', 300));
    if (!answers[0] || !answers[1]) throw new HttpError(400, 'bad_answers', 'Answer the first two questions. A few words is plenty.');
    if ((get(db, 'SELECT COUNT(*) n FROM onboarding_plans WHERE floor_id=?', f.id)?.n || 0) >= DRAFTS_MAX) throw new HttpError(429, 'too_many', 'That\'s a lot of plans. Start this one, or tell the manager what you want.');
    const mgr = get(db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", f.id);
    let plan = null, name = '';
    if (mgr) {
      try {
        const { system, user } = onboardingPrompt(f, lane, tpl, answers);
        const r = await engine.callLLM({ floorId: f.id, agent: mgr, project: '', tier: engine.floorTier ? engine.floorTier(f.id) : '' }, { messages: [{ role: 'system', content: system }, { role: 'user', content: user }], tools: [], meta: { kind: 'onboarding', floorId: f.id, floorSlug: f.slug } });
        plan = readDraft(r.content, tpl.project);
        try { name = one(JSON.parse(String(r.content).match(/\{[\s\S]*\}/)?.[0] || '{}').name, 60); } catch { /* no name: the manager asks in the chat */ }
      } catch (e) { log('warn', 'onboarding plan call failed', { floor: f.number, err: String(e?.message || e).slice(0, 160) }); }
    }
    if (!plan) plan = templatePlan(lane, tpl, answers);
    // The template's lane and project hold for every job, so the plan is one job on the timeline.
    const jobs = plan.jobs.slice(0, JOBS_MAX).map((j) => ({ ...j, lane: tpl.lane, project: tpl.project }));
    // The booking form is what makes a service site (and its price): it stays in the first job's brief whatever the manager wrote.
    if (tpl.form && !jobs.some((j) => /\bform\b/i.test(`${j.title} ${j.brief}`))) jobs[0] = { ...jobs[0], brief: `${jobs[0].brief} With a booking form.`.slice(0, 2000) };
    run(db, "UPDATE onboarding_plans SET status='replaced' WHERE floor_id=? AND status='draft'", f.id);
    run(db, "INSERT INTO onboarding_plans (floor_id,status,lane,template,form,answers,name,goal,jobs,created_at) VALUES (?,'draft',?,?,?,?,?,?,?,?)", f.id, lane.id, tpl.id, tpl.form ? 1 : 0, JSON.stringify(answers), name.length >= 2 ? name : '', plan.goal, JSON.stringify(jobs), now());
    json(res, 200, { plan: view(latestOnboarding(db, f.id)) });
  });

  /** Start: the plan's jobs go to the staff, in order, at once. Not a price approval. */
  POST('/api/floors/:slug/onboarding/start', async ({ req, res, p, ip }) => {
    let f = requireOwner(req, p.slug); limit('mutate', ip);
    const b = await readJson(req, 2048);
    const plan = latestOnboarding(db, f.id);
    if (!plan || plan.status !== 'draft' || (b.plan && Number(b.plan) !== plan.id)) throw new HttpError(409, 'no_plan', 'There is no plan to start. Pick a lane again.');
    if (!fresh(f)) throw new HttpError(409, 'started', 'This floor has already started work.');
    // Claimed before any job is handed out, so a double tap starts it once.
    if (!run(db, "UPDATE onboarding_plans SET status='started', started_at=? WHERE id=? AND status='draft'", now(), plan.id).changes) throw new HttpError(409, 'no_plan', 'That plan has already started.');
    // A floor with no company name yet takes the one from the answers (the boss can rename it under Customise).
    if (!f.name && plan.name && engine.company?.setCompany) { try { engine.company.setCompany(f, { name: plan.name, what_it_does: plan.goal.slice(0, 200) }); f = get(db, 'SELECT * FROM floors WHERE id=?', f.id); } catch { /* the manager asks in the chat */ } }
    const mgr = get(db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", f.id);
    const jobs = JSON.parse(plan.jobs || '[]');
    const ids = []; let prev = null;
    for (const j of jobs) {
      try {
        const t = engine.assignTask(f, mgr, { to: j.to, title: j.title, brief: j.brief, plan: plan.goal.slice(0, 120), project: j.project, dependsOn: prev ? [prev] : [], afterPrevious: false, lane: j.lane, size: j.size, checks: j.checks });
        ids.push(t.id); prev = t.id;
      } catch (e) { log('warn', 'onboarding job not handed out', { floor: f.number, err: String(e?.message || e).slice(0, 160) }); }
    }
    if (!ids.length) { run(db, "UPDATE onboarding_plans SET status='draft', started_at=NULL WHERE id=?", plan.id); throw new HttpError(500, 'not_started', 'The plan didn\'t start. Try again, or tell the manager.'); }
    run(db, 'UPDATE onboarding_plans SET task_ids=? WHERE id=?', JSON.stringify(ids), plan.id);
    if (get(db, "SELECT 1 x FROM sqlite_master WHERE type='table' AND name='work_modes'")) {
      run(db, 'INSERT OR IGNORE INTO work_modes (floor_id) VALUES (?)', f.id);
      run(db, "UPDATE work_modes SET goal=? WHERE floor_id=? AND goal=''", plan.goal, f.id);
    }
    engine.managerSays(f.id, `We're on it: ${plan.goal}. ${jobs.length} step${jobs.length === 1 ? '' : 's'}, and you'll see each one on the timeline as it happens.`);
    engine.kick();
    json(res, 200, { ok: true, tasks: ids, plan: view(latestOnboarding(db, f.id)) });
  });
  return null;
}
