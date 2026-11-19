// The weekly plan, with no budget (server/weekplan.js; docs/redesign/ROUND1-REST.md, job 20). Monday 08:05 New York: one draft per open floor with a
// goal or recent work, one manager call each. The boss approves or edits it; if the boss does nothing, the team starts on the draft after the wait.
// No floor is ever set Idle or held at $0 by a plan. A floor switched out of weekly plans gets no draft and nothing starts.
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boot, claim, Client, floorState } from './helpers.js';
import { get, all, run, openDb } from '../server/db.js';
import { weekOf, setFloorPlans, readDraft } from '../server/weekplan.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const open = [];
after(async () => { for (const t of open) await t.close(); });
const ET = (s) => Date.parse(`${s}-05:00`);
const PLAN = { goal: 'Get the bakery site ready for orders', jobs: [
  { title: 'Add the opening hours', to: 'builder', brief: 'Add the hours to the footer.', checks: ['The hours show in the footer', 'They match what the boss said', 'It fits a phone'], size: 'small', lane: 'website', project: 'site' },
  { title: 'Write the menu page', to: 'writer', brief: 'Write the menu.', checks: ['The menu page is saved', 'Every item has a price the boss gave'], size: 'standard', lane: 'website', project: 'site' },
] };

function scripted() {
  const calls = [];
  return { calls, chat: async (a) => {
    calls.push(a);
    const content = a.meta?.kind === 'weekplan' ? `Here it is:\n${JSON.stringify(PLAN)}` : 'Done.';
    a.onToken?.(content);
    return { content, toolCalls: [], finish: 'stop', usage: { prompt: 1, completion: 1, cost: 0.001, real: true } };
  } };
}
async function building() {
  const clock = { t: ET('2026-11-23T08:04:00') };  // a Monday
  const llm = scripted();
  const t = await boot({ peopleTalk: false, staffSelfCheck: false, weekPlanTickMs: 3600000 }, { llm, now: () => clock.t });
  open.push(t);
  t.app.engine.runManager = async () => {};
  const floor = async (name, { goal = '', work = false } = {}) => {
    const c = await claim(t, name);
    const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
    if (goal) { run(t.db, 'INSERT OR IGNORE INTO work_modes (floor_id) VALUES (?)', f.id); run(t.db, 'UPDATE work_modes SET goal=? WHERE floor_id=?', goal, f.id); }
    if (work) run(t.db, "INSERT INTO tasks (floor_id,title,status,created_at,updated_at) VALUES (?,'Built the first page','done',?,?)", f.id, clock.t - 86400000, clock.t - 86400000);
    return { c, f };
  };
  const wp = t.app.engine.weekPlans;
  const plans = (f) => all(t.db, 'SELECT * FROM weekly_plans WHERE floor_id=?', f.id);
  const draftCalls = () => llm.calls.filter((x) => x.meta?.kind === 'weekplan').length;
  return { t, clock, llm, floor, wp, plans, draftCalls, db: t.db };
}

describe('the weekly plan', () => {
  test('at a fake Monday 08:05 a floor with a goal or recent work gets one draft, with done-means lines and estimates; others get none', async () => {
    const b = await building();
    const goal = await b.floor('Goal Co', { goal: 'Sell 10 cakes' });
    const busy = await b.floor('Busy Co', { work: true });
    const idle = await b.floor('Quiet Co');
    const paused = await b.floor('Paused Co', { goal: 'x' });
    run(b.db, 'UPDATE floors SET paused=1 WHERE id=?', paused.f.id);
    const off = await b.floor('Off Co', { goal: 'x' });
    setFloorPlans(b.db, off.f.id, false);
    const demo = await b.floor('Demo Co', { goal: 'x' });
    run(b.db, 'UPDATE floors SET filler=1 WHERE id=?', demo.f.id);
    await b.wp.tick();
    assert.equal(b.draftCalls(), 0, '08:04: not yet');
    b.clock.t = ET('2026-11-23T08:05:00');
    await b.wp.tick(); await b.wp.tick();
    assert.equal(b.draftCalls(), 2, 'one manager call for each of the two floors, once');
    for (const x of [goal, busy]) {
      const [p, ...more] = b.plans(x.f);
      assert.equal(more.length, 0); assert.equal(p.status, 'draft'); assert.equal(p.week, '2026-11-23'); assert.equal(p.goal, PLAN.goal);
      const jobs = JSON.parse(p.jobs);
      assert.equal(jobs.length, 2); assert.ok(jobs.every((j) => j.checks.length >= 3 && j.checks.length <= 5), 'every job has 3 to 5 done-means lines');
      assert.equal(p.autostart_at, b.clock.t + 24 * 3600000);
    }
    for (const x of [idle, paused, off, demo]) assert.equal(b.plans(x.f).length, 0, x.f.name);
    const boss = await floorState(goal.c);
    assert.equal(boss.weekPlan.status, 'draft');
    assert.deepEqual(boss.weekPlan.jobs.map((j) => j.estimate.line), ['This will cost about $0.40.', 'This will cost about $1.']);
    const visitor = (await new Client(b.t).get(`/api/floors/${goal.c.slug}`)).data;
    assert.equal(visitor.weekPlan, undefined); assert.doesNotMatch(JSON.stringify(visitor), /cost about/);
    assert.equal((await new Client(b.t).get(`/api/floors/${goal.c.slug}/weekplan`)).status, 401);
    const prompt = JSON.stringify(b.llm.calls.find((x) => x.meta?.kind === 'weekplan').messages);
    assert.doesNotMatch(prompt, /\$\d|cost about|budget/i, 'no money in what the manager reads');
    assert.equal(weekOf(ET('2026-11-29T23:00:00')), '2026-11-23'); assert.equal(weekOf(ET('2026-11-30T00:30:00')), '2026-11-30');
  });

  test('the boss approves: the jobs go to the staff in order under one plan, through the ordinary engine', async () => {
    const b = await building();
    const x = await b.floor('Approve Co', { goal: 'Sell cakes' });
    b.clock.t = ET('2026-11-23T08:05:00');
    await b.wp.tick();
    const r = await x.c.post(`/api/floors/${x.c.slug}/weekplan/approve`, {});
    assert.equal(r.status, 200); assert.equal(r.data.plan.status, 'started');
    const tasks = all(b.db, 'SELECT * FROM tasks WHERE floor_id=? AND plan LIKE ? ORDER BY id', x.f.id, 'This week:%');
    assert.deepEqual(tasks.map((t) => t.title), PLAN.jobs.map((j) => j.title));
    assert.deepEqual(JSON.parse(tasks[1].depends_on), [tasks[0].id], 'in order');
    assert.equal(JSON.parse(tasks[1].checks).length, 3, 'two lines from the manager, topped up to three');
    assert.ok(tasks.every((t) => t.job_est_usd > 0), 'each carries its estimate, as information');
    assert.equal((await x.c.post(`/api/floors/${x.c.slug}/weekplan/approve`, {})).status, 409, 'once');
  });

  test('the boss edits: a new goal, a job reworded, one removed and one added; then it starts as edited', async () => {
    const b = await building();
    const x = await b.floor('Edit Co', { work: true });
    b.clock.t = ET('2026-11-23T08:05:00');
    await b.wp.tick();
    const r = await x.c.post(`/api/floors/${x.c.slug}/weekplan/edit`, { goal: 'Open for Christmas orders', jobs: [{ keep: 0, title: 'Add the Christmas hours' }, { title: 'Add a gift box page' }] });
    assert.equal(r.status, 200);
    assert.equal(r.data.plan.goal, 'Open for Christmas orders'); assert.deepEqual(r.data.plan.jobs.map((j) => j.title), ['Add the Christmas hours', 'Add a gift box page']);
    assert.equal(r.data.plan.status, 'draft', 'editing is not approving');
    await x.c.post(`/api/floors/${x.c.slug}/weekplan/approve`, {});
    assert.deepEqual(all(b.db, "SELECT title FROM tasks WHERE floor_id=? AND plan LIKE 'This week:%' ORDER BY id", x.f.id).map((t) => t.title), ['Add the Christmas hours', 'Add a gift box page']);
    const other = await claim(b.t, 'Other Co');
    assert.equal((await other.post(`/api/floors/${x.c.slug}/weekplan/edit`, { goal: 'x' })).status, 403);
  });

  test('a boss who does nothing: the manager carries on with the draft after the wait, as if approved; nothing goes Idle or waits for money', async () => {
    const b = await building();
    const x = await b.floor('Silent Co', { goal: 'Sell cakes' });
    b.clock.t = ET('2026-11-23T08:05:00');
    await b.wp.tick();
    b.clock.t += 23 * 3600000; await b.wp.tick();
    assert.equal(b.plans(x.f)[0].status, 'draft', 'not before the wait is up');
    assert.equal(get(b.db, 'SELECT COUNT(*) n FROM tasks WHERE floor_id=? AND plan LIKE ?', x.f.id, 'This week:%').n, 0);
    b.clock.t += 3600000; await b.wp.tick();
    assert.equal(b.plans(x.f)[0].status, 'started');
    assert.equal(get(b.db, 'SELECT COUNT(*) n FROM tasks WHERE floor_id=? AND plan LIKE ?', x.f.id, 'This week:%').n, 2);
    const f = get(b.db, 'SELECT * FROM floors WHERE id=?', x.f.id);
    assert.deepEqual([f.paused, f.budget_out, f.status], [0, '', 'active'], 'never paused, stopped or idled by the plan');
    // A floor with no plan at all works as it always did: the boss asks, the team works.
    const free = await b.floor('No Plan Co');
    const mgr = get(b.db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", free.f.id);
    b.t.app.engine.assignTask(free.f, mgr, { to: 'writer', title: 'Words', brief: 'b', plan: '', project: 'w', dependsOn: [], afterPrevious: false });
    assert.equal(get(b.db, 'SELECT paused FROM floors WHERE id=?', free.f.id).paused, 0);
  });

  test('a floor switched out of weekly plans gets no draft and nothing starts, even a draft made before; admin.mjs plan shows, switches and asks for one', async () => {
    const b = await building();
    const x = await b.floor('Tire Co', { goal: 'Count tapped calls' });
    b.clock.t = ET('2026-11-23T08:05:00');
    await b.wp.tick();
    setFloorPlans(b.db, x.f.id, false);
    b.clock.t += 48 * 3600000; await b.wp.tick();
    assert.equal(b.plans(x.f)[0].status, 'draft', 'switched off: the old draft never starts');
    assert.equal(get(b.db, 'SELECT COUNT(*) n FROM tasks WHERE floor_id=? AND plan LIKE ?', x.f.id, 'This week:%').n, 0);
    b.clock.t = ET('2026-11-30T08:05:00'); await b.wp.tick();
    assert.equal(b.plans(x.f).length, 1, 'and no new draft next Monday');
    const dir = mkdtempSync(join(tmpdir(), 'plan-'));
    try {
      const db = openDb(dir);
      run(db, "INSERT INTO floors (slug,number,name,colors,boss,decor,recovery_hash,created_at) VALUES ('tirerx',6,'TheTireRx','{}','{}','{}','x',1)");
      db.close();
      const cli = (...a) => spawnSync(process.execPath, ['--no-warnings', join(ROOT, 'scripts/admin.mjs'), 'plan', ...a], { env: { PATH: process.env.PATH, DATA_DIR: dir, ADMIN_PASSWORD: 'x' }, encoding: 'utf8', timeout: 30000 });
      let r = cli('--floor', '6', 'off');
      assert.equal(r.status, 0, r.stderr); assert.equal(JSON.parse(r.stdout).weeklyPlans, 'off');
      r = cli('--floor', '6', '--draft-now'); assert.notEqual(r.status, 0, 'no draft for a floor that is off');
      r = cli('--floor', '6', 'on', '--draft-now'); assert.equal(r.status, 0, r.stderr);
      assert.equal(JSON.parse(r.stdout).weeklyPlans, 'on');
      const db2 = openDb(dir); assert.ok(get(db2, 'SELECT draft_asked FROM weekly_plan_floors').draft_asked); db2.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
    // --draft-now on a running server: the next tick drafts, on any day.
    const y = await b.floor('Asked Co', { goal: 'More visitors' });
    b.clock.t = ET('2026-12-02T10:00:00');  // a Wednesday
    run(b.db, 'INSERT INTO weekly_plan_floors (floor_id,off,draft_asked,updated_at) VALUES (?,0,?,?)', y.f.id, b.clock.t, b.clock.t);
    await b.wp.tick();
    assert.equal(b.plans(y.f).length, 1); assert.equal(b.plans(y.f)[0].week, '2026-11-30');
  });

  test('WEEKLY_PLAN=0: no Monday draft; a manager answer that isn\'t a plan is dropped', async () => {
    const b = await building();
    b.t.cfg.weeklyPlan = false;
    const x = await b.floor('Nope Co', { goal: 'x' });
    b.clock.t = ET('2026-11-23T08:05:00'); await b.wp.tick();
    assert.equal(b.plans(x.f).length, 0);
    assert.equal(readDraft('no json here'), null); assert.equal(readDraft('{"goal":"x","jobs":[]}'), null);
    assert.equal(readDraft(JSON.stringify({ goal: 'g', jobs: Array.from({ length: 8 }, (_, i) => ({ title: `J${i}` })) })).jobs.length, 5, 'at most 5 jobs');
  });
});
