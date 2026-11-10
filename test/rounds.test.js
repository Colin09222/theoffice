// Loop caps (server/rounds.js): a project that keeps failing its test, or keeps being planned again, stops and goes to the boss as one question.
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, claim, until, sleep } from './helpers.js';
import { get, all, run } from '../server/db.js';
import { toolsForRole } from '../server/tools.js';
import { checkRound } from '../server/rounds.js';
import { managerPrompt, computerPrompt, howYouWork, TEST_TO_BRIEF } from '../server/prompts.js';

const open = [];
after(async () => { for (const t of open) await t.close(); });

function scripted({ manager, staff } = {}) {
  const calls = [];
  return { calls, chat: async (a) => {
    calls.push(a);
    const r = (a.meta.kind === 'manager' ? manager : staff)?.(a) || { content: 'Done.' };
    if (r.content) a.onToken?.(r.content);
    return { content: r.content || '', toolCalls: (r.toolCalls || []).map((c, i) => ({ id: `t${a.meta.step}-${i}`, name: c[0], args: JSON.stringify(c[1]) })), finish: 'stop', usage: { prompt: 10, completion: 5, cost: 0.001, real: true } };
  } };
}
async function floor(llm, overrides = {}) {
  const t = await boot({ peopleTalk: false, ...overrides }, llm ? { llm } : {});
  open.push(t);
  const c = await claim(t, `Round ${open.length}`);
  const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
  const mgr = get(t.db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", f.id);
  if (!get(t.db, "SELECT 1 x FROM agents WHERE floor_id=? AND role='tester'", f.id)) t.app.engine.hireStaff(f, 'tester');
  return { t, f, mgr, e: t.app.engine, db: t.db };
}
const agentOf = (h, role) => get(h.db, 'SELECT id FROM agents WHERE floor_id=? AND role=?', h.f.id, role).id;
// A task as it stands on the board, written straight in: these tests are about the counting, not the running.
const put = (h, role, { status = 'review', plan = 'Launch', project = 'site', at = h.e.now() } = {}) => Number(run(h.db, 'INSERT INTO tasks (floor_id,plan,title,brief,agent_id,project,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)', h.f.id, plan, `${role} job`, 'b', agentOf(h, role), project, status, at, at).lastInsertRowid);
const check = (h, opts = {}) => checkRound(h.db, h.t.cfg, h.f.id, opts.project ?? 'site', { now: h.e.now(), ...opts });

describe('rounds of rework', () => {
  test('after two failed re-tests the third go is refused; a round answers each test report once', async () => {
    const h = await floor(scripted());
    h.e.setGlobalPause(true);
    put(h, 'builder');
    assert.equal(check(h), null, 'nothing tested yet, so nothing to count');
    put(h, 'tester');                                    // the first test fails
    assert.equal(check(h), null);                        // round 1: fix it
    assert.equal(check(h), null, 'more work in answer to the same report is the same round');
    put(h, 'tester');                                    // the re-test fails
    assert.equal(check(h), null);                        // round 2
    put(h, 'tester', { status: 'failed' });              // and again
    const stop = check(h);
    assert.match(stop, /stop here\. "site" has already failed its test and gone back for another go 2 times/);
    assert.match(stop, /ship the best honest version/); assert.match(stop, /ask the boss one plain question with ask_boss/);
    assert.equal(get(h.db, "SELECT COUNT(*) n FROM work_rounds WHERE project='site'").n, 2);
    assert.equal(check(h, { project: 'other' }), null, 'each project counts for itself');
  });

  test('the boss having a say starts the count again, and so does a new day', async () => {
    const h = await floor(scripted());
    h.e.setGlobalPause(true);
    for (let i = 0; i < 2; i++) { put(h, 'tester'); assert.equal(check(h), null); }
    put(h, 'tester');
    assert.ok(check(h));
    await sleep(5);
    run(h.db, "INSERT INTO messages (floor_id,role,text,created_at) VALUES (?,'boss','just ship what works and add the second shop later',?)", h.f.id, h.e.now());
    await sleep(5);
    put(h, 'tester');
    assert.equal(check(h), null, 'a fresh report after the boss spoke is a fresh round');
    const later = h.e.now() + 25 * 3600000;
    put(h, 'tester', { at: later });
    assert.equal(checkRound(h.db, h.t.cfg, h.f.id, 'site', { now: later + 1 }), null);
  });

  test('a project planned again three times gets no fourth plan, but its own plans carry on', async () => {
    const h = await floor(scripted());
    h.e.setGlobalPause(true);
    for (const p of ['Launch', 'Fix', 'Second sources', 'Directory']) put(h, 'researcher', { plan: p, status: 'done' });
    assert.match(check(h, { plan: 'Again' }), /has already been planned again 3 times/);
    assert.equal(check(h, { plan: 'Directory' }), null, 'more tasks in a plan already under way are fine');
    assert.equal(check(h, { plan: 'Again', project: 'elsewhere' }), null);
  });

  test('"off" turns both caps off', async () => {
    const h = await floor(scripted(), { loopMaxRetests: Infinity, loopMaxReplans: Infinity });
    h.e.setGlobalPause(true);
    for (let i = 0; i < 6; i++) { put(h, 'tester', { plan: `P${i}` }); assert.equal(check(h, { plan: `Q${i}` }), null); }
  });

  test('the manager\'s tools refuse the send-back and the new plan at the cap, and the boss\'s own turn is never stopped by an old count', async () => {
    const h = await floor(scripted());
    h.e.setGlobalPause(true);
    const ctx = h.e.toolCtx(h.f, h.mgr, null, toolsForRole('manager'));
    const exec = (name, args) => h.e.tools.exec(ctx, name, JSON.stringify(args));
    const b = put(h, 'builder');
    for (let i = 0; i < 2; i++) { put(h, 'tester'); run(h.db, "UPDATE tasks SET status='review' WHERE id=?", b); assert.match(await exec('review_task', { task_id: b, verdict: 'revise', notes: 'fix it' }), /Sent #\d+ back/); }
    put(h, 'tester'); run(h.db, "UPDATE tasks SET status='review' WHERE id=?", b);
    assert.match(await exec('review_task', { task_id: b, verdict: 'revise', notes: 'fix it again' }), /^Error: stop here/);
    assert.equal(get(h.db, 'SELECT status FROM tasks WHERE id=?', b).status, 'review', 'it stays as it is, ready to ship');
    assert.match(await exec('review_task', { task_id: b, verdict: 'approve' }), /Approved/, 'approving is always fine');
    assert.match(await exec('assign_task', { to: 'builder', title: 'Try once more', brief: 'b', plan: 'Launch', project: 'site' }), /^Error: stop here/);
    assert.match(await exec('assign_task', { to: 'writer', title: 'Something else', brief: 'b', plan: 'Blog', project: 'blog' }), /assigned/);
    run(h.db, "INSERT INTO messages (floor_id,role,text,created_at) VALUES (?,'boss','ok try one more fix',?)", h.f.id, h.e.now() + 1);
    await sleep(5);
    assert.match(await exec('assign_task', { to: 'builder', title: 'One more fix', brief: 'b', plan: 'Launch', project: 'site' }), /assigned/);
  });

  test('a floor whose Tester always fails it stops after the cap instead of going round all night', async () => {
    let plans = 0;
    const llm = scripted({
      manager: (a) => {
        if (a.meta.step > 0) return { content: 'On it.' };
        const back = a.meta.toReview.some((t) => /test/i.test(t.title));
        if (!a.meta.isFreshBoss && !back) return { content: 'Waiting.' };
        plans++;
        return { toolCalls: [
          ['assign_task', { to: 'builder', title: `Build ${plans}`, brief: 'Build the site. Done means: it works.', plan: `Plan ${plans}`, project: 'site' }],
          ['assign_task', { to: 'tester', title: `Test ${plans}`, brief: 'Test it.', plan: `Plan ${plans}`, project: 'site', after_previous: true }],
        ] };
      },
      staff: (a) => ({ content: a.meta.role === 'tester' ? 'FAIL: the second shop\'s prices are missing.' : 'Built.' }),
    });
    const h = await floor(llm);
    h.e.bossMessage(h.f, 'make a tire price site');
    await until(() => llm.calls.some((c) => c.meta.kind === 'manager' && c.messages.some((m) => m.role === 'tool' && /stop here/.test(String(m.content)))), { what: 'the cap to stop the manager', timeout: 30000 });
    await sleep(400);
    const builds = all(h.db, "SELECT t.id FROM tasks t JOIN agents a ON a.id=t.agent_id WHERE t.floor_id=? AND a.role='builder'", h.f.id).length;
    assert.equal(builds, 3, 'the first build and two more goes, then no more');
    const calls = llm.calls.length;
    await sleep(400);
    assert.equal(llm.calls.length, calls, 'and the floor is quiet');
  });
});

describe('the prompts', () => {
  test('the manager ships the best honest version and sends back only for the brief; the Tester tests the brief and nothing more', () => {
    const m = managerPrompt({ name: 'A', number: 1, tagline: '' }, { name: 'B' }, { manager: 'M' }, { appsBaseDomain: 'apps.example', computerEnabled: true, openrouterKey: 'k', anthropicKey: 'k' });
    assert.match(m, /Ship when it's good enough\. If the brief can't be fully met/);
    assert.match(m, /a second source that isn't available/);
    assert.match(m, /never for extras nobody asked for/);
    assert.doesNotMatch(m, /as many times as it takes/);
    assert.match(howYouWork('tester'), /Test what the brief asked for and nothing more/);
    assert.ok(computerPrompt({ computerEnabled: true }, 'tester', {}).includes(TEST_TO_BRIEF));
    assert.doesNotMatch(howYouWork('tester'), /however many checks pass/);
  });
});
