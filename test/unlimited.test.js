// Work caps are off unless someone sets one. These tests run with no caps at all and look at what that could have broken: a number the platform can't take,
// a first session holding all the money, a prompt that outgrows the model, and memory that grows for as long as a job runs.
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { getEventListeners } from 'node:events';
import { boot, claim, until, sleep, floorState } from './helpers.js';
import { get, all, run } from '../server/db.js';
import { createMockSessions } from '../server/mock-sessions.js';
import { loadConfig, loadModels, capOrNull } from '../server/config.js';
import { pause } from '../server/limiter.js';
import { trimSteps } from '../server/engine.js';
import { computerPrompt, managerPrompt } from '../server/prompts.js';

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
async function floor(llm, overrides = {}, deps = {}) {
  const t = await boot(overrides, { ...(llm ? { llm } : {}), ...deps });
  open.push(t);
  const c = await claim(t, `Busy ${open.length}`);
  const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
  const mgr = get(t.db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", f.id);
  return { t, c, f, mgr, e: t.app.engine };
}
const assign = (h, n = 0, { to = 'writer', project = 'p' } = {}) => h.e.assignTask(h.f, h.mgr, { to, title: `T${n}`, brief: 'b', plan: '', project, dependsOn: [], afterPrevious: false });
const statusOf = (h, id) => get(h.t.db, 'SELECT status FROM tasks WHERE id=?', id)?.status;
const said = (h, role) => all(h.t.db, 'SELECT text FROM messages WHERE floor_id=? AND role=? ORDER BY id', h.f.id, role).map((m) => m.text);
/** Every tool result has to come straight after the assistant turn that asked for it. Anything else is an error at every provider. */
function assertWellFormed(messages) {
  let waiting = new Set();
  for (const m of messages) {
    if (m.role === 'tool') { assert.ok(waiting.delete(m.tool_call_id), `a tool result with no call in front of it: ${m.tool_call_id}`); continue; }
    assert.equal(waiting.size, 0, 'a call was left without its result');
    waiting = new Set((m.tool_calls || []).map((c) => c.id));
  }
}

describe('the settings', () => {
  test('every work cap is off by default', () => {
    const c = loadConfig({});
    for (const k of ['floorDailyUsd', 'globalDailyUsd', 'taskMaxUsd', 'sessionMaxUsd', 'maxStaff', 'maxStaffSteps', 'maxManagerSteps', 'maxOpenTasks', 'maxTasksPerDay', 'maxRevisions', 'sessionMaxSteps', 'sessionMaxMinutes', 'maxSessionsFloor', 'maxSessionsGlobal', 'maxFixTurns', 'imagesPerFloorDay', 'imagesPerTask', 'reviewsPerFloorDay', 'searchesPerFloorDay', 'ordersPerFloor', 'ordersMaxFails']) assert.equal(c[k], Infinity, k);
    assert.equal(c.sessionWrapUp, false);
  });
  test('what was kept on purpose is still on', () => {
    const c = loadConfig({});
    assert.equal(c.budgetAnthropicUsd, 120); assert.equal(c.budgetOpenrouterUsd, 120);
    assert.equal(c.maxCallsFloor, 3); assert.equal(c.maxCallsGlobal, 6);
    assert.equal(c.domainMaxUsd, 25); assert.equal(c.domainsPerFloorDay, 2); assert.equal(c.domainsGlobalDay, 6);
    assert.equal(c.helpPerFloorDay, 5); assert.equal(c.quotaBytes, 100 * 1024 * 1024);
  });
  test('a number turns a cap on, and nothing else does', () => {
    const on = loadConfig({ MAX_STAFF_STEPS: '14', MAX_MANAGER_STEPS: '8', MAX_OPEN_TASKS: '14', MAX_TASKS_PER_DAY: '60', MAX_REVISIONS: '2', MAX_STAFF: '8', SESSION_MAX_STEPS: '40', SESSION_MAX_MINUTES: '30', MAX_SESSIONS_FLOOR: '2', MAX_SESSIONS_GLOBAL: '4', MAX_FIX_TURNS: '2', TASK_MAX_USD: '3', SESSION_MAX_USD: '5', FLOOR_DAILY_USD: '10', GLOBAL_DAILY_USD: '25' });
    assert.deepEqual([on.maxStaffSteps, on.maxManagerSteps, on.maxOpenTasks, on.maxTasksPerDay, on.maxRevisions, on.maxStaff], [14, 8, 14, 60, 2, 8]);
    assert.deepEqual([on.sessionMaxSteps, on.sessionMaxMinutes, on.maxSessionsFloor, on.maxSessionsGlobal, on.maxFixTurns], [40, 30, 2, 4, 2]);
    assert.deepEqual([on.taskMaxUsd, on.sessionMaxUsd, on.floorDailyUsd, on.globalDailyUsd], [3, 5, 10, 25]);
    // A zero would otherwise stop a floor dead or hang its queue for ever, and a typo shouldn't do either.
    for (const v of ['off', '', 'lots', '0', '-3', 'Infinity', 'NaN']) assert.equal(loadConfig({ MAX_STAFF_STEPS: v, MAX_SESSIONS_GLOBAL: v }).maxStaffSteps, Infinity, v);
    for (const v of ['off', '', 'lots', 'Infinity']) assert.equal(loadConfig({ SESSION_MAX_USD: v, TASK_MAX_USD: v }).sessionMaxUsd, Infinity, v);
  });
  test('a typo can still never switch off the building\'s own limits', () => {
    assert.equal(loadConfig({ BUDGET_ANTHROPIC_USD: 'lots' }).budgetAnthropicUsd, 120);
    assert.equal(loadConfig({ BUDGET_OPENROUTER_USD: '' }).budgetOpenrouterUsd, 120);
  });
  test('the slice a session is promised is always a real number', () => {
    assert.equal(loadConfig({}).sessionSliceUsd, 2);
    for (const v of ['off', 'lots', '0', '-1', '0.05', 'Infinity']) assert.equal(loadConfig({ SESSION_SLICE_USD: v }).sessionSliceUsd, 2, v);
    assert.equal(loadConfig({ SESSION_SLICE_USD: '5' }).sessionSliceUsd, 5);
  });
  test('capOrNull is what a cap looks like outside this process', () => {
    assert.equal(capOrNull(Infinity), null); assert.equal(capOrNull(8), 8);
  });
});

describe('prompts and pages with no caps', () => {
  const models = loadModels();
  test('no prompt mentions a limit that isn\'t there, or the word Infinity', () => {
    const cfg = loadConfig({ AI_MODE: 'mock' });
    const p = computerPrompt(cfg, 'builder', models.all.builder);
    assert.doesNotMatch(p, /Infinity|undefined|about \d+ steps/);
    assert.match(p, /Every step costs real money/);
    assert.match(computerPrompt({ ...cfg, sessionMaxSteps: 40 }, 'builder', models.all.builder), /about 40 steps/);
    assert.doesNotMatch(managerPrompt({ name: 'A', number: 1, tagline: '' }, { name: 'B' }, { manager: 'M' }, cfg), /Infinity/);
  });
  test('the manager\'s state message has no staff limit in it unless one is set', async () => {
    const h = await floor(scripted());
    const state = h.e.managerContext(h.f, h.mgr).messages.at(-1).content;
    assert.doesNotMatch(state, /Staff limit|Infinity/);
    const capped = await floor(scripted(), { maxStaff: 6 });
    assert.match(capped.e.managerContext(capped.f, capped.mgr).messages.at(-1).content, /Staff limit 6\./);
  });
  test('what the owner\'s page gets is JSON a browser can use: null, not a number that isn\'t one', async () => {
    const h = await floor(scripted());
    const res = await h.c.get(`/api/floors/${h.c.slug}`);
    assert.equal(res.data.hiring.cap, null);
    assert.equal(res.data.orderLimits.perFloor, null);
    assert.equal(res.data.orderLimits.maxFails, null);
    assert.doesNotMatch(JSON.stringify(res.data), /Infinity/);
    const capped = await floor(scripted(), { maxStaff: 6, ordersPerFloor: 3, ordersMaxFails: 3 });
    const set = (await capped.c.get(`/api/floors/${capped.c.slug}`)).data;
    assert.equal(set.hiring.cap, 6); assert.equal(set.orderLimits.perFloor, 3); assert.equal(set.orderLimits.maxFails, 3);
  });
  test('a floor can hire every job there is with no cap in the way', async () => {
    const h = await floor(scripted());
    for (const role of ['analyst', 'marketer', 'tester', 'illustrator']) assert.match(h.e.hireStaff(h.f, role, ''), /Hired/);
    assert.equal(get(h.t.db, "SELECT COUNT(*) n FROM agents WHERE floor_id=? AND role!='manager'", h.f.id).n, 8);
  });
});

describe('staff and managers with no step limit', () => {
  test('a staff member goes well past the old 14 steps, and is never told to wrap up', async () => {
    const llm = scripted({ staff: (a) => (a.meta.step < 40 ? { toolCalls: [['list_files', {}]] } : { content: 'All done.' }), manager: () => ({ content: 'ok' }) });
    const h = await floor(llm);
    const { id } = assign(h); h.e.kick();
    await until(() => ['review', 'done', 'failed'].includes(statusOf(h, id)), { what: 'the task to finish' });
    assert.notEqual(statusOf(h, id), 'failed');
    const calls = llm.calls.filter((c) => c.meta.kind === 'staff');
    assert.equal(calls.length, 41);
    assert.ok(!calls.some((c) => c.messages.some((m) => /steps left/.test(String(m.content)))));
  });
  test('a manager goes well past the old 8 steps, and the boss hears the answer rather than "ran out of room"', async () => {
    const llm = scripted({ manager: (a) => (a.meta.step < 20 ? { toolCalls: [['list_files', {}]] } : { content: 'Sorted.' }) });
    const h = await floor(llm);
    h.e.bossMessage(h.f, 'sort it');
    await until(() => said(h, 'manager').includes('Sorted.'), { what: 'the manager to answer' });
    assert.ok(!said(h, 'office').some((t) => /ran out of room/.test(t)));
    assert.ok(!llm.calls.some((c) => c.messages.some((m) => /steps left/.test(String(m.content)))));
  });
  test('a set cap still stops the run, with its warning', async () => {
    const llm = scripted({ staff: () => ({ toolCalls: [['list_files', {}]] }), manager: () => ({ content: 'ok' }) });
    const h = await floor(llm, { maxStaffSteps: 5 });
    const { id } = assign(h); h.e.kick();
    await until(() => statusOf(h, id) === 'failed', { what: 'it to stop' });
    assert.equal(llm.calls.filter((c) => c.meta.kind === 'staff').length, 5);
    assert.ok(llm.calls.some((c) => c.messages.some((m) => /three steps left/.test(String(m.content)))));
  });
  test('sending work back has no limit by default, and has one when set', async () => {
    const h = await floor(scripted({ staff: () => ({ content: 'Again.' }), manager: () => ({ content: 'ok' }) }));
    const { id } = assign(h); h.e.setGlobalPause(true);
    for (let i = 0; i < 5; i++) {
      run(h.t.db, "UPDATE tasks SET status='review' WHERE id=?", id);
      assert.match(h.e.reviewTask(h.f, h.mgr, id, 'revise', 'more'), /Sent #\d+ back/);
    }
    const capped = await floor(scripted(), { maxRevisions: 1 });
    const t = assign(capped); capped.e.setGlobalPause(true);
    run(capped.t.db, "UPDATE tasks SET status='review' WHERE id=?", t.id);
    assert.match(capped.e.reviewTask(capped.f, capped.mgr, t.id, 'revise', 'more'), /Sent #\d+ back/);
    run(capped.t.db, "UPDATE tasks SET status='review' WHERE id=?", t.id);
    assert.match(capped.e.reviewTask(capped.f, capped.mgr, t.id, 'revise', 'more'), /can't go round again/);
  });
});

describe('no limit on tasks', () => {
  test('a floor can hold far more than the old limits, and a set cap still refuses', async () => {
    const h = await floor(scripted());
    h.e.setGlobalPause(true);
    for (let i = 0; i < 70; i++) assign(h, i);
    assert.equal(get(h.t.db, 'SELECT COUNT(*) n FROM tasks WHERE floor_id=?', h.f.id).n, 70);
    const few = await floor(scripted(), { maxOpenTasks: 3 });
    few.e.setGlobalPause(true);
    for (let i = 0; i < 3; i++) assign(few, i);
    assert.throws(() => assign(few, 3), /too many open tasks/);
    const daily = await floor(scripted(), { maxTasksPerDay: 3 });
    daily.e.setGlobalPause(true);
    for (let i = 0; i < 3; i++) assign(daily, i);
    assert.throws(() => assign(daily, 3), /task limit for today/);
  });
  test('the manager reads about a bounded number of them, reports first, and knows there are more', async () => {
    const h = await floor(scripted());
    h.e.setGlobalPause(true);
    for (let i = 0; i < 70; i++) assign(h, i);
    run(h.t.db, "UPDATE tasks SET status='review', result=? WHERE floor_id=? AND id IN (SELECT id FROM tasks WHERE floor_id=? ORDER BY id DESC LIMIT 50)", 'r'.repeat(5000), h.f.id, h.f.id);
    const { messages, meta } = h.e.managerContext(h.f, h.mgr);
    const state = messages.at(-1).content;
    assert.equal((state.match(/#\d+ \[(todo|review)\]/g) || []).length, 40);
    assert.equal((state.match(/#\d+ \[review\]/g) || []).length, 40, 'a report waiting for a verdict comes before a job not started');
    assert.match(state, /and 30 more on the board/);
    assert.equal(meta.toReview.length, 40); assert.equal(meta.reviewsWaiting, 50); assert.equal(meta.openCount, 20);
    assert.ok(state.length < 120000, `the state message is ${state.length} characters`);
  });
  test('more reports than one look can hold all get read, because the manager goes round again', async () => {
    const llm = scripted({ manager: (a) => (a.meta.step === 0 && a.meta.toReview.length ? { toolCalls: a.meta.toReview.map((t) => ['review_task', { task_id: t.id, verdict: 'approve' }]) } : { content: 'ok' }) });
    const h = await floor(llm);
    h.e.setGlobalPause(true);
    for (let i = 0; i < 90; i++) assign(h, i);
    run(h.t.db, "UPDATE tasks SET status='review', result='r' WHERE floor_id=?", h.f.id);
    run(h.t.db, 'UPDATE floors SET manager_wake=1 WHERE id=?', h.f.id);
    h.e.setGlobalPause(false);
    await until(() => !get(h.t.db, "SELECT COUNT(*) n FROM tasks WHERE floor_id=? AND status='review'", h.f.id).n, { what: 'every report to be read' });
    assert.equal(get(h.t.db, "SELECT COUNT(*) n FROM tasks WHERE floor_id=? AND status='done'", h.f.id).n, 90);
  });
  test('but a look that gets through nothing doesn\'t go round again and burn money', async () => {
    const llm = scripted({ manager: () => ({ content: 'Not now.' }) });
    const h = await floor(llm);
    h.e.setGlobalPause(true);
    for (let i = 0; i < 60; i++) assign(h, i);
    run(h.t.db, "UPDATE tasks SET status='review', result='r' WHERE floor_id=?", h.f.id);
    // Still open, so nothing is settled by default either.
    run(h.t.db, "UPDATE tasks SET status='blocked' WHERE id=(SELECT MAX(id) FROM tasks WHERE floor_id=?)", h.f.id);
    run(h.t.db, 'UPDATE floors SET manager_wake=1 WHERE id=?', h.f.id);
    h.e.setGlobalPause(false);
    await until(() => said(h, 'manager').includes('Not now.'), { what: 'the manager to answer' });
    await sleep(150);
    assert.equal(llm.calls.filter((c) => c.meta.kind === 'manager').length, 1);
  });
});

describe('a long run stays a size a model and this server can hold', () => {
  const step = (i, n = 20000) => [
    { role: 'assistant', content: null, tool_calls: [{ id: `c${i}`, type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: `c${i}`, content: 'x'.repeat(n) },
  ];
  const opening = () => [{ role: 'system', content: 'rules' }, { role: 'user', content: 'the brief' }];
  test('under the limit nothing changes', () => {
    const m = [...opening(), ...step(1), ...step(2)];
    assert.deepEqual(trimSteps(m, 2), []);
    assert.equal(m.length, 6);
  });
  test('old steps go whole, the opening stays, the latest stays, and every result keeps its call', () => {
    const m = opening();
    for (let i = 0; i < 40; i++) m.push(...step(i));
    const dropped = trimSteps(m, 2);
    assert.ok(dropped.length > 0);
    assert.equal(m[0].content, 'rules'); assert.equal(m[1].content, 'the brief');
    assert.match(m[2].content, /Earlier steps of this job were dropped/);
    assert.equal(m.at(-1).tool_call_id, 'c39');
    assertWellFormed(m);
    assert.ok(JSON.stringify(m).length < 170000, 'cut well below the trigger');
  });
  test('it only ever says so once', () => {
    const m = opening();
    for (let round = 0; round < 4; round++) { for (let i = 0; i < 30; i++) m.push(...step(`${round}-${i}`)); trimSteps(m, 2); }
    assert.equal(m.filter((x) => /Earlier steps of this job/.test(String(x.content))).length, 1);
    assertWellFormed(m);
  });
  test('what the boss or the manager said is kept, but not without end', () => {
    const m = opening();
    for (let i = 0; i < 40; i++) { m.push(...step(i)); m.push({ role: 'user', content: `The Office Manager sent this back: note ${i}` }); }
    trimSteps(m, 2);
    const notes = m.filter((x) => /note \d+/.test(String(x.content)));
    assert.ok(!notes.some((x) => /note 0$/.test(x.content)), 'the oldest can go in the end');
    assert.ok(notes.length >= 12);
    assert.ok(notes.some((x) => /note 39/.test(x.content)));
    assertWellFormed(m);
  });
  test('one enormous latest step is kept, because the model has to see what it just asked for', () => {
    const m = opening();
    for (let i = 0; i < 5; i++) m.push(...step(i));
    m.push(...step('big', 500000));
    trimSteps(m, 2);
    assert.equal(m.at(-1).tool_call_id, 'cbig');
    assertWellFormed(m);
    assert.equal(m.filter((x) => x.role === 'tool').length, 1);
  });
  test('Claude\'s replayed turns go whole too', () => {
    const m = opening();
    for (let i = 0; i < 30; i++) { const s = step(i); s[0].anthropic_content = [{ type: 'thinking', thinking: 't'.repeat(3000), signature: 's' }, { type: 'tool_use', id: `c${i}`, name: 'read_file', input: {} }]; m.push(...s); }
    trimSteps(m, 2);
    assertWellFormed(m);
    for (const x of m) if (x.role === 'assistant') assert.equal(x.anthropic_content[0].type, 'thinking', 'a kept turn is untouched');
  });
  test('a staff run of hundreds of big steps never sends or stores more than the window', async () => {
    const body = 'y'.repeat(35000);
    const llm = scripted({
      staff: (a) => (a.meta.step === 0 ? { toolCalls: [['write_file', { path: 'projects/p/big.md', content: body }]] } : a.meta.step < 150 ? { toolCalls: [['read_file', { path: 'projects/p/big.md' }]] } : { content: 'All done.' }),
      manager: () => ({ content: 'ok' }),
    });
    const h = await floor(llm);
    const { id } = assign(h); h.e.kick();
    let biggest = 0;
    await until(() => { biggest = Math.max(biggest, get(h.t.db, 'SELECT LENGTH(transcript) n FROM tasks WHERE id=?', id).n); return ['review', 'done', 'failed'].includes(statusOf(h, id)); }, { what: 'the long task', timeout: 60000 });
    assert.notEqual(statusOf(h, id), 'failed');
    const calls = llm.calls.filter((c) => c.meta.kind === 'staff');
    assert.equal(calls.length, 151);
    for (const c of calls) {
      assertWellFormed(c.messages);
      assert.ok(JSON.stringify(c.messages).length < 340000, 'what goes to the model stays bounded');
      assert.equal(c.messages[1].role, 'user'); assert.match(c.messages[1].content, /Task #/);
    }
    assert.ok(biggest < 340000, `what is stored stays bounded, and was ${biggest}`);
  });
});

describe('sources are still checked after their steps are gone', () => {
  const body = (url) => `## What we found\nThe market is real. Source: ${url}\n`.repeat(3);
  async function publishWith(links) {
    const llm = scripted({ staff: (a) => [
      () => ({ toolCalls: [['write_file', { path: 'projects/r/index.md', content: body(links.cited) }]] }),
      () => ({ toolCalls: [['publish_project', { project: 'r', title: 'R', kind: 'research' }]] }),
    ][a.meta.step]?.() || { content: 'Done.' }, manager: () => ({ content: 'ok' }) });
    const h = await floor(llm);
    h.e.setGlobalPause(true);
    const { id } = h.e.assignTask(h.f, h.mgr, { to: 'researcher', title: 'Dig', brief: 'b', plan: '', project: 'r', dependsOn: [], afterPrevious: false, lane: 'business' });
    h.e.keepLinks(id, links.dropped);
    h.e.setGlobalPause(false); h.e.kick();
    await until(() => !['todo', 'doing'].includes(statusOf(h, id)) && !h.e.runs.size, { what: 'the research' });
    const tool = llm.calls.filter((c) => c.meta.kind === 'staff').at(-1).messages.filter((m) => m.role === 'tool').map((m) => m.content).join('\n');
    return { h, id, tool, live: !!get(h.t.db, "SELECT published_at p FROM projects WHERE slug='r' AND floor_id=?", h.f.id)?.p };
  }
  test('a page opened in a step that has since been dropped still counts as opened', async () => {
    const r = await publishWith({ cited: 'https://www.rover.example-site.net/austin/', dropped: [{ role: 'tool', content: 'Page: https://rover.example-site.net/austin?ref=1 says plenty' }] });
    assert.doesNotMatch(r.tool, /nobody here opened/);
    assert.ok(r.live);
  });
  test('so does a source a page showed without its https', async () => {
    const r = await publishWith({ cited: 'https://other-source.org/report', dropped: [{ role: 'tool', content: 'See other-source.org/report for more' }] });
    assert.doesNotMatch(r.tool, /nobody here opened/);
  });
  test('an error or a reading of our own draft proves nothing, as it never did', async () => {
    const cited = 'https://invented-source.net/made-up';
    for (const content of [`Error: could not open ${cited}`, `<untrusted_data source="workspace:projects/r/index.md">${cited}</untrusted_data>`]) {
      const r = await publishWith({ cited, dropped: [{ role: 'tool', content }] });
      assert.match(r.tool, /nobody here opened/);
      assert.ok(!r.live);
    }
  });
  test('the list of links stays bounded', async () => {
    const h = await floor(scripted());
    h.e.setGlobalPause(true);
    const { id } = assign(h);
    for (let round = 0; round < 40; round++) h.e.keepLinks(id, [{ role: 'tool', content: Array.from({ length: 200 }, (_, i) => `https://site-${round}-${i}.example.net/page`).join(' ') }]);
    const links = get(h.t.db, 'SELECT seen_links s FROM tasks WHERE id=?', id).s;
    assert.ok(links.length <= 32000);
    assert.match(links, /site-39-199\.example\.net/, 'the newest stay');
    assert.doesNotMatch(links, /site-0-0\./, 'the oldest go');
    assert.match(links.split('\n')[0], /^https:\/\/site-/, 'and none is left cut in half');
  });
  test('a page full of nonsense can\'t tie the server up', async () => {
    const h = await floor(scripted());
    h.e.setGlobalPause(true);
    const { id } = assign(h);
    const started = Date.now();
    h.e.keepLinks(id, [{ role: 'tool', content: 'a-'.repeat(40000) }, { role: 'tool', content: 'a.'.repeat(40000) }, { role: 'tool', content: `${'a'.repeat(80000)}.` }]);
    assert.ok(Date.now() - started < 2000);
  });
});

describe('computers with no limits of their own', () => {
  const finished = (api, text = 'All done.') => { api.save([{ path: 'index.html', data: Buffer.from('<!doctype html><title>x</title>') }]); api.message(text); };
  const TINY = { input_tokens: 10, output_tokens: 0 };
  // At $4 a million, what a step costs on the ledger comes out the same as what the platform charges for it.
  const usageFor = (usd) => ({ input_tokens: Math.round(usd * 250000), output_tokens: 0 });
  async function computerFloor(script = {}, overrides = {}) {
    const sessions = createMockSessions({}, script);
    const h = await floor(null, { computerEnabled: true, outputLagMs: 0, ...overrides }, { sessions });
    h.e.runManager = async () => {};
    h.sessions = sessions;
    h.settle = (id, statuses = ['review', 'failed', 'blocked', 'done', 'cancelled']) => until(() => { const r = get(h.t.db, 'SELECT * FROM tasks WHERE id=?', id); return statuses.includes(r.status) && !h.e.runs.size ? r : null; }, { timeout: 30000, what: 'the computer to finish' });
    h.go = (o = {}) => { const r = assign(h, 0, { to: 'builder', project: 'game', ...o }); h.e.kick(); return r; };
    return h;
  }
  const allAmounts = (h) => [...h.sessions.calls.sessions.map((p) => p.budget), ...h.sessions.calls.updates.map((u) => u.params.budget)].map((b) => b.max_list_cost.amount);

  test('the platform is always given a whole number of cents', async () => {
    const h = await computerFloor({ stepUsd: 0.5, usage: usageFor(0.5), async onTurn(api) { for (let i = 0; i < 12; i++) { await api.step(); await sleep(5); } finished(api); } });
    const row = await h.settle(h.go().id);
    assert.equal(row.status, 'review');
    assert.equal(h.sessions.calls.sessions[0].budget.max_list_cost.amount, '200');
    for (const a of allAmounts(h)) assert.match(a, /^\d+$/);
    assert.doesNotMatch(JSON.stringify([h.sessions.calls.sessions, h.sessions.calls.updates]), /Infinity|null|NaN/);
    assert.doesNotMatch(h.sessions.calls.agents[0].system, /Infinity|undefined/);
  });
  test('even with the building\'s own limit switched off', async () => {
    const h = await computerFloor({ stepUsd: 0.5, usage: usageFor(0.5), async onTurn(api) { for (let i = 0; i < 8; i++) { await api.step(); await sleep(5); } finished(api); } }, { budgetAnthropicUsd: Infinity });
    const row = await h.settle(h.go().id);
    assert.equal(row.status, 'review');
    for (const a of allAmounts(h)) assert.match(a, /^\d+$/);
    assert.equal(get(h.t.db, "SELECT COALESCE(SUM(usd),0) n FROM budget_holds").n, 0);
  });
  test('a session keeps going past its first slice without ever stopping or being told to wrap up', async () => {
    const h = await computerFloor({ stepUsd: 0.5, usage: usageFor(0.5), async onTurn(api) { for (let i = 0; i < 12; i++) { await api.step(); await sleep(5); } finished(api); } });
    const row = await h.settle(h.go().id);
    assert.equal(row.status, 'review'); assert.match(row.result, /All done/);
    assert.equal(h.sessions.calls.sessions.length, 1, 'all in the one session');
    assert.ok(h.sessions.calls.updates.length >= 2, 'topped up along the way');
    const events = [...h.sessions.sessions.values()][0].events;
    assert.ok(!events.some((e) => e.stop_reason?.type === 'budget_reached'), 'it never reached its cap');
    assert.ok(!h.sessions.calls.sends.some((s) => s.ev.type === 'user.interrupt'));
    assert.ok(!h.sessions.calls.sends.some((s) => /nearly up|Stop polishing|steps left/.test(JSON.stringify(s.ev))));
    assert.ok(row.session_charged >= 5.9, 'and all of it is on the ledger');
    assert.equal(get(h.t.db, "SELECT COUNT(*) n FROM budget_holds").n, 0, 'nothing is left held');
  });
  test('one that reaches its cap before the next slice goes back in line and carries on where it was', async () => {
    // Its usage says next to nothing, so the runner sees no reason to top up until the platform has already stopped it.
    const h = await computerFloor({ stepUsd: 0.5, usage: TINY, async onTurn(api) { for (let i = 0; i < 14; i++) await api.step(); finished(api, 'Finished the whole job.'); } });
    const row = await h.settle(h.go().id, ['review', 'failed', 'done']);
    assert.equal(row.status, 'review'); assert.match(row.result, /Finished the whole job/);
    assert.equal(h.sessions.calls.sessions.length, 1);
    const events = [...h.sessions.sessions.values()][0].events;
    assert.ok(events.some((e) => e.stop_reason?.type === 'budget_reached'), 'it did reach its cap');
    assert.ok(!h.sessions.calls.sends.some((s) => s.ev.type === 'user.interrupt'), 'an interrupt would have ended its turn for good');
    assert.equal(events.filter((e) => e.type === 'span.model_request_start').length, 14, 'every step ran');
    assert.ok(row.session_charged >= 6.9);
  });
  test('a live session never holds more than its slice, so the rest of the building carries on', async () => {
    let most = 0; let h;
    h = await computerFloor({ stepUsd: 0.5, usage: usageFor(0.5), async onTurn(api) { for (let i = 0; i < 10; i++) { await api.step(); await sleep(5); most = Math.max(most, h.e.budget.held('anthropic')); assert.ok(h.e.budget.room('anthropic') > 100); } finished(api); } });
    await h.settle(h.go().id);
    assert.ok(most > 0 && most <= 2.001, `it held ${most}`);
  });
  test('more sessions run at once than the old limits allowed', async () => {
    let live = 0, peak = 0;
    const sessions = createMockSessions({}, { async onTurn(api) { live++; peak = Math.max(peak, live); await api.step(); while (peak < 6) await sleep(5); live--; finished(api); } });
    const t = await boot({ computerEnabled: true, outputLagMs: 0 }, { sessions });
    open.push(t);
    t.app.engine.runManager = async () => {};
    const ids = [];
    for (let i = 0; i < 3; i++) {
      const c = await claim(t, `Crowded ${i}`);
      const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
      const mgr = get(t.db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", f.id);
      t.app.engine.hireStaff(f, 'tester', '');
      for (const to of ['builder', 'tester']) ids.push(t.app.engine.assignTask(f, mgr, { to, title: 'Go', brief: 'b', plan: '', project: `p-${to}`, dependsOn: [], afterPrevious: false }).id);
    }
    t.app.engine.kick();
    await until(() => ids.every((id) => get(t.db, 'SELECT status FROM tasks WHERE id=?', id).status !== 'doing' && get(t.db, 'SELECT status FROM tasks WHERE id=?', id).status !== 'todo'), { timeout: 30000, what: 'all six' });
    assert.equal(peak, 6);
  });
  test('a set limit on sessions still holds', async () => {
    let live = 0, peak = 0;
    const h = await computerFloor({ async onTurn(api) { live++; peak = Math.max(peak, live); await api.step(); await sleep(30); live--; finished(api); } }, { maxSessionsGlobal: 1 });
    h.e.hireStaff(h.f, 'tester', '');
    const a = h.go({ project: 'one' }); const b = h.go({ to: 'tester', project: 'two' });
    await h.settle(a.id); await h.settle(b.id);
    assert.equal(peak, 1);
  });
  test('the building\'s limit is still what stops it: not a cent past it, and it is told to save first', async () => {
    const h = await computerFloor({ stepUsd: 0.2, usage: usageFor(0.2), async onTurn(api) { for (let i = 0; i < 100; i++) { await api.step(); await sleep(3); } finished(api); } }, { budgetAnthropicUsd: 1 });
    const { id } = h.go();
    await until(() => said(h, 'budget').length || said(h, 'office').some((t) => /out of budget/.test(t)), { what: 'the boss to be told', timeout: 30000 });
    await until(() => !h.e.runs.size, { what: 'the run to stop' });
    assert.equal(statusOf(h, id), 'todo', 'the task is waiting, not failed');
    assert.ok(h.e.budget.spent('anthropic') <= 1.21, `spent ${h.e.budget.spent('anthropic')}`);
    assert.ok(h.sessions.calls.sends.some((s) => /nearly up/.test(JSON.stringify(s.ev))));
    assert.equal(h.sessions.calls.sends.filter((s) => /nearly up/.test(JSON.stringify(s.ev))).length, 1);
  });
  test('two sessions near the limit can\'t both be promised the same dollars', async () => {
    let most = 0; let h;
    h = await computerFloor({ stepUsd: 0.1, usage: usageFor(0.1), async onTurn(api) { for (let i = 0; i < 60; i++) { await api.step(); await sleep(2); most = Math.max(most, h.e.budget.spent('anthropic') + h.e.budget.held('anthropic')); } finished(api); } }, { budgetAnthropicUsd: 3 });
    h.e.hireStaff(h.f, 'tester', '');
    h.go({ project: 'one' }); h.go({ to: 'tester', project: 'two' });
    await until(() => h.e.budget.out('anthropic') && !h.e.runs.size, { what: 'the limit to be reached', timeout: 30000 });
    assert.ok(most <= 3.25, `promised ${most}`);
    assert.ok(h.e.budget.spent('anthropic') <= 3.25, `spent ${h.e.budget.spent('anthropic')}`);
  });
  test('the wrap-up nudge only comes when it is switched on', async () => {
    const turn = async (api) => { for (let i = 0; i < 25; i++) await api.step(); finished(api); };
    const off = await computerFloor({ onTurn: turn });
    const a = off.e.assignTask(off.f, off.mgr, { to: 'builder', title: 'Go', brief: 'b', plan: '', project: 'game', dependsOn: [], afterPrevious: false, lane: 'website' }); off.e.kick();
    await off.settle(a.id);
    assert.ok(!off.sessions.calls.sends.some((s) => /Stop polishing/.test(JSON.stringify(s.ev))));
    const on = await computerFloor({ onTurn: turn }, { sessionWrapUp: true });
    const b = on.e.assignTask(on.f, on.mgr, { to: 'builder', title: 'Go', brief: 'b', plan: '', project: 'game', dependsOn: [], afterPrevious: false, lane: 'website' }); on.e.kick();
    await on.settle(b.id);
    assert.ok(on.sessions.calls.sends.some((s) => /Stop polishing/.test(JSON.stringify(s.ev))));
  });
  test('a save that won\'t go through keeps getting another try by default, and gets a set number when set', async () => {
    let tries = 0;
    const turn = async (api) => { tries++; await api.step(); if (tries >= 6) finished(api, 'Fixed it.'); };
    const h = await computerFloor({ onTurn: turn });
    const row = await h.settle(h.go().id);
    assert.equal(row.status, 'review'); assert.equal(tries, 6);
    let few = 0;
    const capped = await computerFloor({ async onTurn(api) { few++; await api.step(); } }, { maxFixTurns: 2 });
    const r2 = await capped.settle(capped.go().id);
    assert.equal(r2.status, 'failed'); assert.match(r2.result, /could not be saved/); assert.equal(few, 3);
  });
  test('hitting the platform\'s own limit on starting sessions is a wait, not an outage', async () => {
    const h = await computerFloor({ async onTurn(api) { await api.step(); finished(api); } });
    const real = h.sessions.createSession; let tries = 0;
    h.sessions.createSession = async (p) => { if (++tries <= 3) throw Object.assign(new Error('rate limited'), { status: 429, retryable: true }); return real(p); };
    h.e.computer.rateLimitWaitMs = 1;
    const row = await h.settle(h.go().id);
    assert.equal(row.status, 'review'); assert.equal(tries, 4);
    assert.equal(get(h.t.db, 'SELECT paused FROM floors WHERE id=?', h.f.id).paused, 0);
    assert.equal(h.sessions.calls.deleted.length, 1, 'and its upload is cleaned up once');
  });
  test('stopping the floor while it waits for that doesn\'t leave it waiting', async () => {
    const h = await computerFloor({ async onTurn(api) { await api.step(); finished(api); } });
    h.sessions.createSession = async () => { throw Object.assign(new Error('rate limited'), { status: 429 }); };
    h.e.computer.rateLimitWaitMs = 60000;
    h.go();
    await until(() => h.e.runs.size === 1 && h.sessions.calls.uploads.length, { what: 'it to start waiting' });
    await sleep(20);
    h.e.pauseFloor(h.f.id, 'Paused by the boss');
    h.e.haltFloorRuns(h.f.id, 'pause');
    await until(() => !h.e.runs.size, { what: 'it to stop waiting' });
    assert.equal(h.sessions.calls.deleted.length, 1);
  });
  test('a job that runs for days can lose computers along the way, as long as each got somewhere', async () => {
    let runs = 0;
    const h = await computerFloor({ async onTurn(api) { runs++; for (let i = 0; i < 12; i++) await api.step(); if (runs <= 4) api.terminate(); finished(api, 'Got there.'); } });
    const row = await h.settle(h.go().id, ['review', 'failed', 'done']);
    assert.equal(row.status, 'review'); assert.equal(runs, 5);
    assert.equal(get(h.t.db, 'SELECT paused FROM floors WHERE id=?', h.f.id).paused, 0);
  });
  test('but computers that die straight away still stop the floor, rather than loop', async () => {
    const h = await computerFloor({ async onTurn(api) { await api.step(); api.terminate(); } });
    h.go();
    await until(() => get(h.t.db, 'SELECT paused FROM floors WHERE id=?', h.f.id).paused === 1, { what: 'the pause', timeout: 30000 });
    assert.ok(h.sessions.calls.sessions.length <= 4);
  });
  for (const ignoreListFrom of [false, true]) {
    test(`a very long session keeps only a window of event ids, and reconnecting neither repeats nor misses anything${ignoreListFrom ? ', even if the platform ignores the filter' : ''}`, async () => {
      const STEPS = 2600;
      const h = await computerFloor({ ignoreListFrom, stepUsd: 0, usage: TINY, async onTurn(api) {
        // A wait after each drop, so the reconnect happens here rather than after the session has finished.
        for (let i = 0; i < STEPS; i++) { await api.step(); if (i % 650 === 649) { api.dropStreams(); await sleep(450); } }
        finished(api);
      } }, { sessionMaxSteps: STEPS + 8 });  // counting anything twice would hit this
      const comp = h.e.computer;
      comp.seenWindowMs = 1;
      let most = 0;
      const real = comp.seenBefore.bind(comp);
      comp.seenBefore = (st, ev) => { const r = real(st, ev); most = Math.max(most, st.seen.size); return r; };
      const row = await h.settle(h.go().id);
      assert.equal(row.status, 'review', row.result);
      assert.ok(most <= 2001, `it remembered ${most} ids`);
      if (!ignoreListFrom) assert.ok(h.sessions.calls.lists.some(Boolean), 'and stopped asking for all of history');
    });
  }
  test('a restart counts the whole history again, so it can\'t reset the steps', async () => {
    const h = await computerFloor({ stepUsd: 0, usage: TINY, async onTurn(api) { for (let i = 0; i < 2500; i++) await api.step(); finished(api); } }, { sessionMaxSteps: 10000 });
    h.e.computer.seenWindowMs = 1;
    const row = await h.settle(h.go().id);
    const events = [...h.sessions.sessions.values()][0].events;
    const comp = h.e.computer;
    const st = comp.newState(h.f, get(h.t.db, "SELECT * FROM agents WHERE floor_id=? AND role='builder'", h.f.id), row, new AbortController().signal);
    for await (const ev of h.sessions.listEvents(row.session_id, st.listFrom)) { if (!comp.seenBefore(st, ev)) await comp.onEvent(st, ev, false); }
    assert.equal(st.steps, 2500);
    assert.equal(events.filter((e) => e.type === 'span.model_request_start').length, 2500);
    assert.ok(st.seen.size <= 2000);
  });
});

describe('what a long run leaves behind in memory', () => {
  test('waiting leaves nothing on the signal, however often it happens', async () => {
    const ctl = new AbortController();
    for (let i = 0; i < 50; i++) await pause(0, ctl.signal);
    assert.equal(getEventListeners(ctl.signal, 'abort').length, 0);
  });
  test('and it still stops at once when the signal goes', async () => {
    const ctl = new AbortController();
    const waiting = pause(60000, ctl.signal);
    ctl.abort(new Error('stop'));
    await assert.rejects(waiting, /stop/);
    assert.equal(getEventListeners(ctl.signal, 'abort').length, 0);
    await assert.rejects(pause(1, ctl.signal), /stop/, 'already stopped');
  });
  test('a call waiting a long time for room adds no listeners to its run', async () => {
    let signal = null;
    const llm = scripted({ staff: () => ({ content: 'Done.' }), manager: () => ({ content: 'ok' }) });
    const h = await floor(llm, { budgetAnthropicUsd: 50 });
    // All the room there is, held by a session that hasn't finished: a call has to wait, and keeps checking.
    const hold = h.e.budget.hold('anthropic', { kind: 'session', floorId: h.f.id, agentId: h.mgr.id, usd: 50 });
    const { id } = assign(h); h.e.kick();
    await until(() => h.e.runs.size === 1, { what: 'the run to start' });
    signal = [...h.e.runs.values()][0].ctl.signal;
    await sleep(50);
    assert.ok(getEventListeners(signal, 'abort').length <= 2, `${getEventListeners(signal, 'abort').length} listeners`);
    assert.equal(llm.calls.length, 0, 'and it really is waiting');
    h.e.budget.release(hold);
    await until(() => statusOf(h, id) !== 'doing' && statusOf(h, id) !== 'todo', { what: 'it to carry on', timeout: 10000 });
  });
  test('the list of internal errors doesn\'t grow for ever', async () => {
    const h = await floor(scripted());
    for (let i = 0; i < 500; i++) h.e.fail('test', new Error(`e${i}`));
    assert.ok(h.e.errors.length <= 100);
    assert.match(h.e.errors.at(-1), /e499/);
    h.e.errors.length = 0;
  });
  test('a viewer that stops reading is let go instead of piling up here', async () => {
    const h = await floor(scripted());
    h.e.setGlobalPause(true);
    const socket = connect(h.t.port, '127.0.0.1');
    await new Promise((r) => socket.once('connect', r));
    socket.write(`GET /theoffice/api/floors/${h.c.slug}/stream HTTP/1.1\r\nHost: ${h.t.host}\r\nAccept: text/event-stream\r\n\r\n`);
    const bus = h.t.app.bus ?? h.e.bus;
    await until(() => bus.total === 1, { what: 'the stream to open' });
    socket.pause();
    socket.on('error', () => {});
    const pad = 'x'.repeat(65536);
    let sent = 0;
    while (bus.total === 1 && sent < 2000) { h.e.emit(h.f.id, 'noise', { pad }, { persist: false }); sent++; await new Promise((r) => setImmediate(r)); }
    assert.equal(bus.total, 0, `still subscribed after ${sent * 64} KB`);
    socket.destroy();
  });
  test('a viewer that keeps up is left alone', async () => {
    const h = await floor(scripted());
    h.e.setGlobalPause(true);
    const res = await fetch(`${h.t.base}/api/floors/${h.c.slug}/stream`);
    const reader = res.body.getReader();
    const reading = (async () => { for (;;) { const { done } = await reader.read(); if (done) return; } })();
    const bus = h.e.bus;
    await until(() => bus.total === 1, { what: 'the stream to open' });
    for (let i = 0; i < 300; i++) { h.e.emit(h.f.id, 'noise', { pad: 'x'.repeat(4096) }, { persist: false }); await new Promise((r) => setImmediate(r)); }
    assert.equal(bus.total, 1);
    await reader.cancel(); await reading;
  });
});

describe('standing orders with no cap', () => {
  test('a floor can hold more than the old three, and one that keeps failing keeps running', async () => {
    const h = await floor(scripted({ manager: () => ({ content: 'ok' }) }));
    for (let i = 0; i < 5; i++) {
      const r = await h.c.post(`/api/floors/${h.c.slug}/orders`, { text: `Order ${i}`, schedule: { every: 'day', at: '09:00' } });
      assert.equal(r.status, 201, JSON.stringify(r.data));
    }
    const s = await floorState(h.c);
    assert.equal(s.orderLimits.perFloor, null);
  });
  test('a set cap still refuses', async () => {
    const h = await floor(scripted({ manager: () => ({ content: 'ok' }) }), { ordersPerFloor: 1 });
    const ok = await h.c.post(`/api/floors/${h.c.slug}/orders`, { text: 'One', schedule: { every: 'day', at: '09:00' } });
    assert.equal(ok.status, 201);
    const no = await h.c.post(`/api/floors/${h.c.slug}/orders`, { text: 'Two', schedule: { every: 'day', at: '09:00' } });
    assert.equal(no.status, 409);
  });
});
