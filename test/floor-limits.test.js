// What one floor may spend and which model its work runs on, against a faked ledger at every boundary. And a project with its own domain living at that domain.
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, claim, until, hostFetch, floorState } from './helpers.js';
import { get, all, run } from '../server/db.js';
import { loadModels, routeFor } from '../server/config.js';
import { appLabel } from '../server/apps.js';
import { computerRole } from '../server/computer.js';
import { createMockClient } from '../server/mock.js';
import { createMockSessions } from '../server/mock-sessions.js';

const APPS = 'apps.localhost';
const open = [];
after(async () => { for (const t of open) await t.close(); });
const NO_OTHER_LIMITS = { floorDailyUsd: Infinity, globalDailyUsd: Infinity, taskMaxUsd: Infinity, budgetAnthropicUsd: 100000, budgetOpenrouterUsd: 100000 };
const start = async (over = {}, deps = {}) => { const t = await boot({ peopleTalk: false, ...NO_OTHER_LIMITS, ...over }, { models: loadModels(), ...deps }); open.push(t); return t; };
const floorOf = (t, c) => get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
const spend = (t, floorId, provider, usd, when = Date.now()) => run(t.db, "INSERT INTO ledger (floor_id,day,agent_id,model,prompt_tokens,completion_tokens,cost_usd,created_at,kind,provider) VALUES (?,?,NULL,?,0,0,?,?,'model',?)", floorId, new Date().toISOString().slice(0, 10), provider === 'anthropic' ? 'claude-opus-5-5' : 'google/gemini-3.1-pro-preview', usd, when, provider);
const wipe = (t, floorId) => run(t.db, 'DELETE FROM ledger WHERE floor_id=?', floorId);
const models = loadModels();
const recording = (seen) => { const inner = createMockClient({ mockDelayMs: 2 }); return { ...inner, chat(x) { seen.push({ model: x.model, effort: x.effort, role: x.meta?.role, kind: x.meta?.kind }); return inner.chat(x); } }; };
const assign = (t, floor, to) => { const mgr = get(t.db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", floor.id); const r = t.app.engine.assignTask(floor, mgr, { to, title: 'A small job', brief: 'Write a note.', plan: '', project: 'things', private: false, dependsOn: [] }); t.app.engine.kick(); return r; };
const taskOf = (t, id) => get(t.db, 'SELECT * FROM tasks WHERE id=?', id);
const notices = (t, floor) => all(t.db, "SELECT text FROM messages WHERE floor_id=? AND role='budget' ORDER BY id", floor.id).map((m) => m.text);

describe('per-floor models and limits', () => {
  test('every Claude boundary puts the roles that shape the work on the right model, and nobody else moves', async () => {
    const t = await start();
    const b = t.app.engine.budget;
    const f = floorOf(t, await claim(t, 'Tiered'));
    for (const [s, tier, model, builderEffort] of [
      [0, 'fable', 'claude-fable-5-2', 'xhigh'], [19.99, 'fable', 'claude-fable-5-2', 'xhigh'],
      [20, 'opus', 'claude-opus-5-5', 'xhigh'], [49.99, 'opus', 'claude-opus-5-5', 'xhigh'],
      [50, 'sonnet', 'claude-sonnet-5-5', 'high'], [84.99, 'sonnet', 'claude-sonnet-5-5', 'high'],
    ]) {
      wipe(t, f.id);
      if (s) spend(t, f.id, 'anthropic', s);
      assert.equal(b.tier(f.id), tier, `tier at $${s}`);
      assert.equal(b.out('anthropic', f.id), false, `not paused at $${s}`);
      for (const role of ['builder', 'designer', 'manager']) assert.equal(routeFor(models, role, { tier }).model, model, `${role} at $${s}`);
      assert.equal(routeFor(models, 'builder', { tier }).effort, builderEffort);
      assert.equal(computerRole(models, 'builder', { tier }).model, model, 'the Builder on a computer moves too');
      assert.equal(routeFor(models, 'builder', { tier }).pricing, models.prices[model], 'and is priced as that model');
      assert.equal(routeFor(models, 'researcher', { tier }).model, 'claude-opus-5-5', 'the Researcher stays');
      assert.equal(routeFor(models, 'lawyer', { tier }).model, 'claude-sonnet-5-5', 'the Lawyer stays');
      assert.equal(computerRole(models, 'tester', { tier }).model, 'claude-opus-5-5', 'the Tester stays');
    }
  });

  test('a job the team picked for itself stays on the autonomous model', () => {
    for (const tier of ['fable', 'opus', 'sonnet']) assert.equal(routeFor(models, 'builder', { tier, autonomous: true }).model, models.autonomous.model);
  });

  test('$85 of Claude pauses the floor and $25 of OpenRouter pauses its OpenRouter work, each exactly at the line', async () => {
    const t = await start();
    const b = t.app.engine.budget;
    const f = floorOf(t, await claim(t, 'Stops'));
    spend(t, f.id, 'anthropic', 84.99);
    assert.equal(b.out('anthropic', f.id), false);
    spend(t, f.id, 'anthropic', 0.01);
    assert.equal(b.out('anthropic', f.id), true, 'paused at $85');
    assert.equal(b.out('openrouter', f.id), false, 'Claude spend does not touch OpenRouter');
    assert.ok(b.room('anthropic', f.id) <= 0.000001);
    spend(t, f.id, 'openrouter', 24.99);
    assert.equal(b.out('openrouter', f.id), false);
    spend(t, f.id, 'openrouter', 0.01);
    assert.equal(b.out('openrouter', f.id), true, 'paused at $25');
    assert.equal(b.out('anthropic'), false, 'and the building as a whole is not out');
  });

  test('only spend since the first boot counts, and each floor is counted on its own', async () => {
    const t = await start();
    const b = t.app.engine.budget;
    const f = floorOf(t, await claim(t, 'Old Money')), g = floorOf(t, await claim(t, 'Other Co'));
    spend(t, f.id, 'anthropic', 500, Date.now() - 3600000);
    spend(t, f.id, 'openrouter', 500, Date.now() - 3600000);
    assert.equal(b.tier(f.id), 'fable');
    assert.equal(b.out('anthropic', f.id), false);
    assert.equal(b.out('openrouter', f.id), false);
    spend(t, f.id, 'anthropic', 85);
    assert.equal(b.out('anthropic', f.id), true);
    assert.equal(b.out('anthropic', g.id), false, 'the floor next door is untouched');
    assert.equal(b.tier(g.id), 'fable');
  });

  test('a top-up moves one floor: stops, switch points, partly, and back to the defaults', async () => {
    const t = await start();
    const b = t.app.engine.budget;
    const f = floorOf(t, await claim(t, 'Topped Up')), g = floorOf(t, await claim(t, 'Not Topped'));
    spend(t, f.id, 'anthropic', 85);
    spend(t, g.id, 'anthropic', 85);
    assert.equal(b.out('anthropic', f.id), true);
    b.setFloorOverride(f.id, { claudeStopUsd: 120 });
    assert.equal(b.out('anthropic', f.id), false, 'topped up');
    assert.equal(b.out('anthropic', g.id), true, 'and only that floor');
    assert.equal(b.tier(f.id), 'sonnet', 'still the last tier');
    spend(t, f.id, 'anthropic', 35);
    assert.equal(b.out('anthropic', f.id), true, 'paused again at its new stop');
    b.setFloorOverride(f.id, { openrouterStopUsd: 40 });
    assert.equal(b.floorStatus(f.id).claudeStopUsd, 120, 'a later top-up keeps the earlier one');
    assert.equal(b.floorStatus(f.id).openrouterStopUsd, 40);
    wipe(t, f.id); spend(t, f.id, 'anthropic', 25);
    b.setFloorOverride(f.id, { fableUntilUsd: 30 });
    assert.equal(b.tier(f.id), 'fable', 'the switch points can move too');
    b.setFloorOverride(f.id, null);
    assert.equal(b.floorStatus(f.id).claudeStopUsd, 85);
    assert.equal(b.tier(f.id), 'opus');
  });

  test('what is promised to running work comes out of the floor as well as the building', async () => {
    const t = await start();
    const b = t.app.engine.budget;
    const f = floorOf(t, await claim(t, 'Held'));
    const id = b.hold('anthropic', { floorId: f.id, usd: 80 });
    assert.equal(b.room('anthropic', f.id), 5);
    assert.equal(b.room('anthropic'), 100000 - 80, 'the building is counted without the floor');
    b.release(id);
    assert.equal(b.room('anthropic', f.id), 85);
  });

  test('the pause goes through the building-budget path: the boss hears no number, the queue waits, a top-up starts it again', async () => {
    const seen = [];
    const t = await start({}, { llm: recording(seen) });
    t.app.engine.runManager = async () => {};
    const f = floorOf(t, await claim(t, 'Paused Co'));
    spend(t, f.id, 'anthropic', 85);
    const { id } = assign(t, f, 'researcher');
    await until(() => get(t.db, 'SELECT budget_out b FROM floors WHERE id=?', f.id).b === 'anthropic', { what: 'the floor to stop' });
    assert.equal(taskOf(t, id).status, 'todo', 'the job waits');
    assert.equal(seen.filter((x) => x.kind === 'staff').length, 0, 'and no model was called for it');
    await until(() => notices(t, f).length === 1, { what: 'the boss to hear' });
    assert.ok(!/\$|\d|budget|limit|credit/i.test(notices(t, f)[0]), 'the notice names no number, limit or cost');
    t.app.engine.budget.setFloorOverride(f.id, { claudeStopUsd: 200 });
    await until(() => get(t.db, 'SELECT budget_out b FROM floors WHERE id=?', f.id).b === '', { what: 'the floor to start again' });
    await until(() => taskOf(t, id).status !== 'todo', { what: 'the job to start' });
    assert.ok(/back at work/.test(notices(t, f).at(-1)));
  });

  test('real calls run on the tier, pinned to the task once it has started', async () => {
    const seen = [];
    const t = await start({}, { llm: recording(seen) });
    t.app.engine.runManager = async () => {};
    const f = floorOf(t, await claim(t, 'On Fable'));
    const { id } = assign(t, f, 'designer');
    await until(() => seen.some((x) => x.kind === 'staff'), { what: 'the designer to work' });
    assert.equal(seen.find((x) => x.kind === 'staff').model, 'claude-fable-5-2');
    await until(() => taskOf(t, id).status !== 'doing', { what: 'it to finish' });
    assert.equal(taskOf(t, id).model_tier, 'fable', 'the task keeps the tier it started on');
    const g = floorOf(t, await claim(t, 'On Sonnet'));
    spend(t, g.id, 'anthropic', 60);
    assign(t, g, 'designer');
    await until(() => seen.some((x) => x.kind === 'staff' && x.model === 'claude-sonnet-5-5'), { what: 'the next floor to be on Sonnet' });
    assert.equal(seen.find((x) => x.model === 'claude-sonnet-5-5').effort, 'high');
    // A computer that was already running before the tiers arrived is on the role's own model.
    assert.equal(t.app.engine.taskTier({ id: 999999, floor_id: f.id, model_tier: '', session_id: 'sesn_x' }), 'opus');
  });

  test('a computer on a tier is its own Managed Agents agent, and the role\'s own one is left alone', async () => {
    const t = await start({ computerEnabled: true }, { sessions: createMockSessions({}) });
    await t.app.engine.computer.agentRef('builder', { tier: 'fable' });
    await t.app.engine.computer.agentRef('builder', { tier: 'opus' });
    assert.ok(get(t.db, "SELECT 1 x FROM settings WHERE key='ma_agent_builder-fable'"), 'a Fable agent for the tier');
    assert.ok(get(t.db, "SELECT 1 x FROM settings WHERE key='ma_agent_builder'"), 'the role\'s own agent, for the middle tier');
  });
});

describe('a project with its own domain lives at that domain', () => {
  const domainOn = async (over = {}) => {
    const t = await start({ appsBaseDomain: APPS, appsScheme: 'http', publicOrigin: '', ...over });
    t.app.engine.runManager = async () => {};
    const c = await claim(t, `Site ${open.length}`);
    const floor = floorOf(t, c);
    t.app.engine.upsertProject(floor, 'launch', { title: 'Launch', kind: 'site', published: true, sources: [] });
    run(t.db, 'INSERT INTO published_files (floor_id,project,path,content,size) VALUES (?,?,?,?,?)', floor.id, 'launch', 'index.html', '<!doctype html><h1>Tiny Teacups</h1>', 36);
    const label = appLabel(t.db, floor, 'launch');
    const at = (path, method = 'GET') => hostFetch(t.port, path, { method, headers: { host: `${label}.${APPS}` } });
    const connect = () => run(t.db, "INSERT INTO domain_orders (floor_id,domain,project,status,quoted_usd,created_at,updated_at) VALUES (?,'tinyteacups.com','launch','live',10,?,?)", floor.id, Date.now(), Date.now());
    return { t, c, floor, at, connect };
  };

  test('no domain: the apps address keeps working and is where links go', async () => {
    const { t, floor, at } = await domainOn();
    const r = await at('/');
    assert.equal(r.status, 200);
    assert.ok(t.app.engine.liveUrl(floor, 'launch').includes(APPS));
  });

  test('a connected domain gets a permanent redirect that keeps path and query, for GET and HEAD', async () => {
    const { at, connect } = await domainOn();
    connect();
    const r = await at('/about?ref=x&y=2');
    assert.equal(r.status, 301);
    assert.equal(r.headers.get('location'), 'https://tinyteacups.com/about?ref=x&y=2');
    assert.equal((await at('/', 'HEAD')).headers.get('location'), 'https://tinyteacups.com/');
    assert.equal((await at('//evil.example/x')).headers.get('location'), 'https://tinyteacups.com/', 'nothing strange gets through in the path');
    for (const path of ['/_data/state', '/_office/cloud/status']) assert.notEqual((await at(path)).status, 301, `${path} still answers for a tab left open on the old address`);
    assert.equal((await at('/about', 'POST')).status, 405, 'and it was only ever a page, so anything but a read is refused as before');
  });

  test('the real domain still serves, and it is what links, cards and the Projects tab point at', async () => {
    const { t, c, floor, connect } = await domainOn();
    connect();
    const page = await hostFetch(t.port, '/', { headers: { host: 'tinyteacups.com' } });
    assert.equal(page.status, 200);
    assert.equal(t.app.engine.liveUrl(floor, 'launch'), 'https://tinyteacups.com/');
    const state = await floorState(c);
    assert.equal(state.projects.find((p) => p.slug === 'launch').appUrl, 'https://tinyteacups.com/');
    const friendly = await hostFetch(t.port, `/theoffice/f/${floor.slug}/launch/sub?q=1`, { headers: { host: '127.0.0.1' } });
    assert.equal(friendly.headers.get('location'), 'https://tinyteacups.com/sub?q=1');
  });

  test('a private project keeps its apps address: a domain is not a way past private, and the preview pass still works', async () => {
    const { t, floor, at, connect } = await domainOn();
    connect();
    run(t.db, 'UPDATE projects SET private=1 WHERE floor_id=? AND slug=?', floor.id, 'launch');
    const r = await at('/');
    assert.equal(r.status, 404, 'hidden, not redirected');
    assert.equal(r.headers.get('location'), null);
  });
});
