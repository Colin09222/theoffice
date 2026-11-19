// Done-means lines (server/donemeans.js; redesign job 9): every new job stores 3 to 5 lines before work starts, frozen once it starts and changed only on the
// boss's word; the Tester checks only those lines, its report lists only those lines with PASS or FAIL and evidence, and anything else goes to the project's
// Later list, never back to the Builder.
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, claim, until } from './helpers.js';
import { get, all, run } from '../server/db.js';
import { toolsForRole } from '../server/tools.js';
import { readTestReport, laterList } from '../server/donemeans.js';

const open = [];
after(async () => { for (const t of open) await t.close(); });

const LINES = ['The booking form loads on a phone', 'A booking reaches the boss\'s inbox', 'The page says thanks after sending'];
function scripted(testerReply) {
  const calls = [];
  return { calls, chat: async (a) => {
    calls.push(a);
    const content = a.meta.role === 'tester' ? testerReply : 'Done.\n\nSelf-check:\n1. PASS - opened it on a phone\n2. PASS - sent one, it arrived\n3. PASS - the thanks line shows';
    a.onToken?.(content);
    return { content, toolCalls: [], finish: 'stop', usage: { prompt: 10, completion: 5, cost: 0.001, real: true } };
  } };
}
async function floor(llm, overrides = {}) {
  const t = await boot({ peopleTalk: false, ...overrides }, { llm });
  open.push(t);
  const c = await claim(t, `Lines ${open.length}`);
  const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
  const mgr = get(t.db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", f.id);
  const e = t.app.engine;
  e.runManager = async () => {};
  if (!get(t.db, "SELECT 1 x FROM agents WHERE floor_id=? AND role='tester'", f.id)) e.hireStaff(f, 'tester');
  const ctx = (bossTurn = false) => { const x = e.toolCtx(f, mgr, null, toolsForRole('manager')); x.bossTurn = bossTurn; return x; };
  const tool = (name, args, bossTurn = false) => e.tools.exec(ctx(bossTurn), name, JSON.stringify(args));
  const task = (id) => get(t.db, 'SELECT * FROM tasks WHERE id=?', id);
  const idOf = (out) => Number(/#(\d+)/.exec(out)?.[1]);
  return { t, f, e, tool, task, idOf, db: t.db };
}
const job = (extra = {}) => ({ to: 'builder', title: 'Booking form', brief: 'Build the booking form and publish it.', plan: 'Bookings', project: 'site', intent: 'a booking form', ...extra });

describe('done-means lines', () => {
  test('every new job stores 3 to 5 lines before work starts; fewer or more is refused', async () => {
    const h = await floor(scripted('PASS'));
    run(h.db, 'UPDATE floors SET paused=1 WHERE id=?', h.f.id);  // nothing starts while this test looks
    for (const checks of [[], LINES.slice(0, 2), [...LINES, 'a', 'Fourth line here', 'Fifth line here', 'Sixth line here']]) {
      const out = await h.tool('assign_task', job({ checks }));
      assert.match(out, /3 to 5 "done means" lines|at most 5 "done means" lines/, `${checks.length} lines: ${out}`);
    }
    assert.equal(get(h.db, 'SELECT COUNT(*) n FROM tasks WHERE floor_id=?', h.f.id).n, 0, 'nothing was made');
    const id = h.idOf(await h.tool('assign_task', job({ checks: LINES })));
    assert.deepEqual(JSON.parse(h.task(id).checks), LINES, 'stored as data on the task');
    assert.match(h.task(id).brief, /Done means:\n1\. The booking form loads on a phone\n2\. A booking reaches the boss's inbox\n3\. The page says thanks after sending$/);
    assert.equal(h.task(id).checks_frozen_at, null, 'not frozen before work starts');
    const typed = h.idOf(await h.tool('assign_task', job({ project: 'other', brief: 'Fix the header. Done means: logo shows; menu opens; it fits a phone' })));
    assert.equal(JSON.parse(h.task(typed).checks).length, 3, 'lines typed into the brief count too');
  });

  test('frozen once work starts: the manager can\'t change them, the boss can (an amend on the boss\'s turn)', async () => {
    const h = await floor(scripted('PASS'));
    run(h.db, 'UPDATE floors SET paused=1 WHERE id=?', h.f.id);
    const id = h.idOf(await h.tool('assign_task', job({ checks: LINES })));
    assert.match(await h.tool('amend_task', { task_id: id, checks: LINES.slice(0, 2) }), /3 to 5/);
    assert.match(await h.tool('amend_task', { task_id: id, checks: [...LINES.slice(0, 2), 'The page names the studio'] }), /Changed #/, 'before work starts the manager may still change them');
    run(h.db, 'UPDATE floors SET paused=0 WHERE id=?', h.f.id);
    await until(() => h.task(id).checks_frozen_at, { what: 'work to start' });
    await until(() => h.task(id).status === 'review', { what: 'the job to finish' });
    assert.match(await h.tool('amend_task', { task_id: id, checks: LINES }), /frozen\. Only the boss can change them/);
    assert.equal(JSON.parse(h.task(id).checks)[2], 'The page names the studio');
    assert.match(await h.tool('amend_task', { task_id: id, checks: LINES }, true), /as the boss asked/);
    assert.deepEqual(JSON.parse(h.task(id).checks), LINES); assert.ok(h.task(id).checks_amended_at);
    assert.match(h.task(id).brief, /3\. The page says thanks after sending$/);
  });

  test('the Tester checks only the job\'s lines; its report lists only those; other ideas go to the Later list, never back to the Builder', async () => {
    const reply = 'I went through it.\n\nTest report:\n1. PASS - loaded at 390px, form visible\n2. FAIL - sent one, nothing reached the inbox after 2 minutes\n3. PASS - "Thanks, we\'ll be in touch" showed\n4. FAIL - there is no dark mode\n\nLater:\n- Add a dark mode\n- The logo could be bigger';
    const h = await floor(scripted(reply));
    const b = h.idOf(await h.tool('assign_task', job({ checks: LINES })));
    await until(() => h.task(b).status === 'review', { what: 'the build' });
    const tt = h.idOf(await h.tool('assign_task', { to: 'tester', title: 'Test the booking form', brief: 'Test it. Done means: it has a dark mode; the logo is big', plan: 'Bookings', project: 'site', depends_on: [b], intent: 'a booking form' }));
    assert.deepEqual(JSON.parse(h.task(tt).checks), LINES, 'the Tester takes the tested job\'s lines, not its own');
    assert.doesNotMatch(h.task(tt).brief, /dark mode/); assert.match(h.task(tt).brief, /check only the "Done means" lines above/);
    await until(() => h.task(tt).status === 'review', { what: 'the test' });
    const r = h.task(tt).result;
    assert.match(r, /^Tested against its 3 "done means" lines: 2 PASS, 1 FAIL, 0 NOT CHECKED\./);
    assert.match(r, /2\. FAIL \("A booking reaches the boss's inbox"\): sent one, nothing reached the inbox/);
    assert.doesNotMatch(r, /dark mode|logo/i, 'nothing beyond the lines goes back');
    assert.match(r, /2 other things the Tester noticed went to the project's Later list/);
    assert.deepEqual(JSON.parse(h.task(tt).test_lines).map((l) => l.verdict), ['pass', 'fail', 'pass']);
    assert.deepEqual(laterList(h.db, h.f.id, 'site').map((l) => l.text), ['Add a dark mode', 'The logo could be bigger']);
    assert.equal(h.task(b).tester_fails, 1, 'a failed line is a Tester failure');
    const state = h.e.managerContext(get(h.db, 'SELECT * FROM floors WHERE id=?', h.f.id), get(h.db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", h.f.id)).messages.at(-1).content;
    assert.doesNotMatch(state, /dark mode/i, 'the manager is never handed the Later ideas to send back');
  });

  test('reading a report: a line it never reached is NOT CHECKED; no heading still reads the numbered lines', () => {
    const r = readTestReport('1. PASS - fine\n3. FAIL - broken', LINES);
    assert.deepEqual(r.lines.map((l) => l.verdict), ['pass', 'unchecked', 'fail']);
    assert.equal(r.failed, true); assert.deepEqual(r.later, []);
    assert.equal(readTestReport('anything', []), null);
  });

  test('DONE_MEANS=0 goes back to free-form checks', async () => {
    const h = await floor(scripted('FAIL - broken'), { doneMeans: false });
    run(h.db, 'UPDATE floors SET paused=1 WHERE id=?', h.f.id);
    const out = await h.tool('assign_task', job({ checks: ['One line'] }));
    assert.match(out, /assigned/);
  });
});
