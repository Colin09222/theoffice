// The tight loop (docs/redesign/OFFICE-ANSWERS-1.md, Q9 loop limits; job 10): one fix round per job, one plan rewrite per project, at most 5 jobs in a
// plan, at most 3 jobs queued ahead on the team's own list, no new plan while one is open, and 15 steps for an edit (40 for a build). After the fix round
// the job ships as the best honest version, with what failed under "Not done yet", and the boss is asked one question.
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, claim, until } from './helpers.js';
import { get, all, run } from '../server/db.js';
import { loadConfig } from '../server/config.js';
import { toolsForRole } from '../server/tools.js';
import { checkRound } from '../server/rounds.js';

const open = [];
after(async () => { for (const t of open) await t.close(); });
const LINES = ['The page loads', 'The form sends', 'It fits a phone'];

function scripted({ staff } = {}) {
  const calls = [];
  return { calls, chat: async (a) => {
    calls.push(a);
    const r = a.meta.kind === 'staff' && staff ? staff(a) : { content: 'Done.' };
    a.onToken?.(r.content || '');
    return { content: r.content || '', toolCalls: r.toolCalls || [], finish: 'stop', usage: { prompt: 10, completion: 5, cost: 0.001, real: true } };
  } };
}
async function floor(llm, overrides = {}) {
  const t = await boot({ peopleTalk: false, staffSelfCheck: false, ...overrides }, { llm });
  open.push(t);
  const c = await claim(t, `Loop ${open.length}`);
  const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
  const mgr = get(t.db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", f.id);
  const e = t.app.engine;
  e.runManager = async () => {};
  if (!get(t.db, "SELECT 1 x FROM agents WHERE floor_id=? AND role='tester'", f.id)) e.hireStaff(f, 'tester');
  const tool = (name, args, bossTurn = false) => { const x = e.toolCtx(f, mgr, null, toolsForRole('manager')); x.bossTurn = bossTurn; return e.tools.exec(x, name, JSON.stringify(args)); };
  const task = (id) => get(t.db, 'SELECT * FROM tasks WHERE id=?', id);
  return { t, f, mgr, e, tool, task, db: t.db, llm };
}
const idOf = (out) => Number(/#(\d+)/.exec(out)?.[1]);

describe('the tight loop', () => {
  test('the defaults: one fix round, one plan rewrite, 5 jobs a plan, 3 queued ahead, 15 steps for an edit and 40 for a build', () => {
    const c = loadConfig({});
    assert.deepEqual([c.loopMaxRetests, c.loopMaxReplans, c.loopMaxFixRounds, c.loopMaxPlanJobs, c.loopMaxQueued, c.loopOnePlan, c.maxEditSteps, c.maxStaffSteps], [1, 1, 1, 5, 3, true, 15, 40]);
    const off = loadConfig({ LOOP_MAX_FIX_ROUNDS: 'off', LOOP_MAX_PLAN_JOBS: 'off', LOOP_ONE_PLAN: '0', LOOP_MAX_RETESTS: '2' });
    assert.deepEqual([off.loopMaxFixRounds, off.loopMaxPlanJobs, off.loopOnePlan, off.loopMaxRetests], [Infinity, Infinity, false, 2]);
  });

  test('one fix round per job: the second send-back ships it as Work in progress with the failed lines under "Not done yet" and asks the boss one question', async () => {
    const h = await floor(scripted({ staff: (a) => ({ content: a.meta.role === 'tester' ? 'Test report:\n1. PASS - loads\n2. FAIL - nothing arrived\n3. PASS - fits' : 'Built.' }) }));
    const b = h.e.assignTask(h.f, h.mgr, { to: 'builder', title: 'Booking form', brief: 'Build it.', plan: 'Bookings', project: 'site', dependsOn: [], afterPrevious: false, checks: LINES });
    await until(() => h.task(b.id).status === 'review', { what: 'the build' });
    const t1 = h.e.assignTask(h.f, h.mgr, { to: 'tester', title: 'Test it', brief: 'Test it.', plan: 'Bookings', project: 'site', dependsOn: [b.id], afterPrevious: false, checks: LINES });
    await until(() => h.task(t1.id).status === 'review', { what: 'the test' });
    assert.match(await h.tool('review_task', { task_id: b.id, verdict: 'revise', notes: 'The form must send.' }), /Sent #\d+ back/, 'the one fix round');
    await until(() => h.task(b.id).status === 'review', { what: 'the fix' });
    const out = await h.tool('review_task', { task_id: b.id, verdict: 'revise', notes: 'Still not sending.' });
    assert.match(out, /has had its one fix round, so it ships as it stands, marked Work in progress\. Not done yet: The form sends\./);
    assert.match(out, /ask them one plain question with ask_boss/);
    const row = h.task(b.id);
    assert.equal(row.status, 'done'); assert.equal(row.revisions, 1, 'never a second fix round'); assert.equal(row.wip, 1);
    assert.deepEqual(JSON.parse(row.not_done), ['The form sends']);
  });

  test('one plan rewrite per project: a third plan is refused', async () => {
    const h = await floor(scripted());
    h.e.setGlobalPause(true);
    const put = (plan) => run(h.db, "INSERT INTO tasks (floor_id,plan,title,agent_id,project,status,created_at,updated_at) VALUES (?,?,'x',?,'site','done',?,?)", h.f.id, plan, h.mgr.id, h.e.now(), h.e.now());
    put('Launch');
    assert.equal(checkRound(h.db, h.t.cfg, h.f.id, 'site', { plan: 'Rewrite', now: h.e.now() }), null, 'the one rewrite');
    put('Rewrite');
    assert.match(checkRound(h.db, h.t.cfg, h.f.id, 'site', { plan: 'Third', now: h.e.now() }), /has already been planned again 1 time/);
  });

  test('at most 5 jobs in a plan, and no new plan while one is open', async () => {
    const h = await floor(scripted());
    run(h.db, 'UPDATE floors SET paused=1 WHERE id=?', h.f.id);
    for (let i = 1; i <= 5; i++) assert.match(await h.tool('assign_task', { to: 'writer', title: `Page ${i}`, brief: 'Write it.', plan: 'Launch', project: `p${i}`, checks: LINES, intent: 'pages' }), /assigned/);
    assert.match(await h.tool('assign_task', { to: 'writer', title: 'Page 6', brief: 'Write it.', plan: 'Launch', project: 'p6', checks: LINES, intent: 'pages' }), /already has 5 jobs, the most a plan can have/);
    assert.match(await h.tool('assign_task', { to: 'writer', title: 'Other', brief: 'Write it.', plan: 'Next week', project: 'q', checks: LINES, intent: 'more' }), /plan "Launch" is still open .* No new plan starts while one is open/);
    for (const t of all(h.db, "SELECT id FROM tasks WHERE floor_id=? AND plan='Launch'", h.f.id)) await h.tool('cancel_task', { task_id: t.id }, true);
    assert.match(await h.tool('assign_task', { to: 'writer', title: 'Other', brief: 'Write it.', plan: 'Next week', project: 'q', checks: LINES, intent: 'more' }), /assigned/, 'once the open plan is closed, the next one starts');
  });

  test('an edit has 15 steps; a build keeps 40', async () => {
    const looping = (a) => ({ content: '', toolCalls: [{ id: `l${a.meta.step}`, name: 'list_files', args: '{}' }] });
    const h = await floor(scripted({ staff: looping }));
    const edit = h.e.assignTask(h.f, h.mgr, { to: 'writer', title: 'Fix a word', brief: 'b', plan: '', project: 'site', dependsOn: [], afterPrevious: false, size: 'small' });
    await until(() => h.task(edit.id).status === 'failed', { what: 'the edit to run out of steps' });
    assert.equal(h.llm.calls.filter((c) => c.meta.kind === 'staff' && c.meta.task.id === edit.id).length, 15);
    const build = h.e.assignTask(h.f, h.mgr, { to: 'builder', title: 'Build it', brief: 'b', plan: '', project: 'big', dependsOn: [], afterPrevious: false, size: 'big' });
    await until(() => h.task(build.id).status === 'failed', { what: 'the build to run out of steps' });
    assert.equal(h.llm.calls.filter((c) => c.meta.kind === 'staff' && c.meta.task.id === build.id).length, 40);
  });

  test('at most 3 jobs queued ahead on the team\'s own next-up list', async () => {
    const h = await floor(scripted());
    await h.tool('update_backlog', { next_up: ['one', 'two', 'three', 'four', 'five', 'six'] }, true);
    assert.deepEqual(JSON.parse(get(h.db, 'SELECT backlog b FROM work_modes WHERE floor_id=?', h.f.id).b), ['one', 'two', 'three']);
  });
});
