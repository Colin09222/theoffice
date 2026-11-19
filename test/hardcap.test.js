// OPT-IN ONLY (HARD_CAP_ENDS=1, TASK_MAX_USD=5): the owner dropped job 7 on 2026-11-19; the defaults are the old $40 safety net and its old stop.
// The hard cap per task (docs/redesign/OFFICE-ANSWERS-1.md, Q8; job 7): a task that reaches $5 (TASK_MAX_USD) is ended, not just flagged. What it saved
// ships as it stands, marked Work in progress, with a "Not done yet" list; with nothing saved it closes. The manager tells the boss one plain line and the
// owner gets one alert. A task can carry its own cap (Tier 3's $6). The costs here are fake: each model call says what it cost.
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, claim, until } from './helpers.js';
import { get, all, run } from '../server/db.js';
import { loadConfig } from '../server/config.js';
import { laneBSettings } from '../server/laneb-config.js';

const open = [];
after(async () => { for (const t of open) await t.close(); });

/** A Builder that saves a file (or doesn't) and keeps working; each call costs `usd`. */
function costly({ usd = 2, save = true } = {}) {
  const calls = [];
  return { calls, chat: async (a) => {
    calls.push(a);
    const toolCalls = a.meta.kind === 'staff' ? [save ? { id: `w${calls.length}`, name: 'write_file', args: JSON.stringify({ path: 'projects/site/index.html', content: `<h1>v${calls.length}</h1>` }) } : { id: `l${calls.length}`, name: 'list_files', args: '{}' }] : [];
    return { content: 'Working on it.', toolCalls, finish: 'stop', usage: { prompt: 10, completion: 5, cost: usd, real: true } };
  } };
}
async function floor(llm, overrides = {}) {
  const seen = [];
  // Off by default since the owner's ruling of 2026-11-19 (no budget rules): these tests turn job 7 on, at $5, to keep the opt-in working.
  const t = await boot({ taskMaxUsd: 5, hardCapEnds: true, peopleTalk: false, staffSelfCheck: true, hookUrl: 'http://gw/hooks/agent', hookToken: 'tok', hookRetryMs: 1, ...overrides }, { llm, httpFetch: async (u, o) => { seen.push(JSON.parse(o.body)); return new Response('{}'); } });
  open.push(t);
  const c = await claim(t, `Capped ${open.length}`);
  const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
  const mgr = get(t.db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", f.id);
  const e = t.app.engine;
  e.runManager = async () => {};
  const go = (extra = {}) => e.assignTask(f, mgr, { to: 'builder', title: 'Build the booking form', brief: 'Build it.', plan: '', project: 'site', dependsOn: [], afterPrevious: false, checks: ['The form loads', 'A booking reaches the inbox'], ...extra });
  const settle = (id) => until(() => { const r = get(t.db, 'SELECT * FROM tasks WHERE id=?', id); return ['review', 'failed', 'done'].includes(r.status) && !e.runs.size ? r : null; }, { what: 'the task to end' });
  const said = () => all(t.db, "SELECT text FROM messages WHERE floor_id=? AND role='manager' ORDER BY id", f.id).map((m) => m.text);
  return { t, f, e, go, settle, said, seen };
}

describe('the owner\'s ruling of 2026-11-19: no budget rules', () => {
  test('by default the per-task net is the old $40, a task that reaches it gets the old stop, and Tier 3 carries no dollar cap of its own', () => {
    const c = loadConfig({});
    assert.equal(c.taskMaxUsd, 40); assert.equal(c.hardCapEnds, false); assert.equal(c.tier3CapUsd, 0);
    assert.equal(laneBSettings({ HARD_CAP_ENDS: '1' }).hardCapEnds, true, 'job 7 is opt-in only');
    assert.equal(laneBSettings({ HARD_CAP_ENDS: '0' }).hardCapEnds, false);
    assert.equal(laneBSettings({ TIER3_CAP_USD: '6' }).tier3CapUsd, 6, 'a Tier 3 cap is opt-in only');
    assert.equal(loadConfig({ TASK_MAX_USD: '5' }).taskMaxUsd, 5);
  });
});

describe('the hard cap per task', () => {
  test('a task that reaches $5 with work saved is ended and ships as Work in progress; the boss hears one plain line; the owner one alert', async () => {
    const llm = costly({ usd: 2 });
    const h = await floor(llm);
    const row = await h.settle(h.go().id);
    assert.equal(row.status, 'done', 'ended and shipped');
    assert.equal(row.cost_usd, 6, 'three $2 calls: it stopped at the first look past $5');
    assert.equal(llm.calls.filter((c) => c.meta.kind === 'staff').length, 3, 'no call after the cap');
    assert.equal(row.wip, 1); assert.ok(row.capped_at);
    assert.deepEqual(JSON.parse(row.not_done), ['The form loads', 'A booking reaches the inbox'], 'nothing was ticked PASS, so both lines are not done yet');
    assert.match(row.result, /shipped as it stands, marked Work in progress/); assert.match(row.result, /Not done yet:\n- The form loads\n- A booking reaches the inbox/);
    const lines = h.said().filter((m) => /I stopped/.test(m));
    assert.equal(lines.length, 1, 'one plain line');
    assert.match(lines[0], /^Boss, I stopped "Build the booking form" where it was: it ships as it stands, marked Work in progress\. Not done yet: The form loads; A booking reaches the inbox\./);
    assert.doesNotMatch(lines[0], /\$|\d/, 'no figure');
    await h.e.ownerAlerts.idle();
    const capped = h.seen.filter((b) => /ended at its cap/.test(b.name));
    assert.equal(capped.length, 1); assert.equal(capped[0].deliver, true);
    assert.match(capped[0].message, new RegExp(`task #${row.id} was ended at its \\$5\\.00 cap, after \\$6\\.00`));
  });

  test('with nothing usable saved it closes', async () => {
    const h = await floor(costly({ usd: 3, save: false }));
    const row = await h.settle(h.go({ project: 'empty' }).id);
    assert.equal(row.status, 'failed'); assert.equal(row.wip, 0); assert.ok(row.capped_at);
    assert.match(row.result, /nothing usable saved, so it is closed/);
    assert.equal(h.said().filter((m) => /nothing usable was saved, so I closed it/.test(m)).length, 1);
  });

  test('a task with its own cap (Tier 3\'s $6) goes on past $5 and stops at its own', async () => {
    const llm = costly({ usd: 1.25 });
    const h = await floor(llm);
    const id = h.go().id;
    run(h.t.db, 'UPDATE tasks SET cap_usd=6 WHERE id=?', id);
    const row = await h.settle(id);
    assert.equal(row.cost_usd, 6.25, 'five calls: past $5, stopped at the first look past $6');
    assert.equal(h.e.taskCap(row), 6);
    assert.equal(row.status, 'done');
  });

  test('TASK_MAX_USD sets the cap; HARD_CAP_ENDS=0 goes back to the old stop', async () => {
    const h = await floor(costly({ usd: 2 }), { taskMaxUsd: 3, hardCapEnds: false });
    const row = await h.settle(h.go().id);
    assert.equal(row.cost_usd, 4); assert.equal(row.status, 'failed'); assert.equal(row.capped_at, null);
    assert.match(row.result, /Stopped by the building/);
  });
});
