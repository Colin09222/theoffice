// A floor moved wholesale onto OpenRouter (floor-limit --openrouter-only): every Claude call it makes goes there on one model, it is billed and capped
// as OpenRouter, and its Builder works without a computer, since Managed Agents is the Claude API only.
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { boot, claim, until } from './helpers.js';
import { get, all, run, openDb } from '../server/db.js';
import { loadModels, routeFor, overFloor, openrouterName } from '../server/config.js';
import { computerRole } from '../server/computer.js';
import { createMockClient } from '../server/mock.js';
import { createMockSessions } from '../server/mock-sessions.js';
import { claudeExtras } from '../server/llm.js';
import { createRouter } from '../server/anthropic.js';
import { toolsForRole } from '../server/tools.js';

const ROOT = resolve(import.meta.dirname, '..');
const OR = { provider: 'openrouter', model: 'anthropic/claude-sonnet-5.5', effort: 'high' };
const models = (() => { const m = loadModels(); return { ...m, floorLimits: { ...m.floorLimits, fableUntilUsd: 20, opusUntilUsd: 50, claudeStopUsd: 85, openrouterStopUsd: 25 } }; })();
const open = [];
after(async () => { for (const t of open) await t.close(); });
const NO_OTHER_LIMITS = { floorDailyUsd: Infinity, globalDailyUsd: Infinity, taskMaxUsd: Infinity, budgetAnthropicUsd: 100000, budgetOpenrouterUsd: 100000 };
const start = async (over = {}, deps = {}) => { const t = await boot({ peopleTalk: false, ...NO_OTHER_LIMITS, ...over }, { models, ...deps }); open.push(t); return t; };
const floorOf = (t, c) => get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
const spend = (t, floorId, provider, usd) => run(t.db, "INSERT INTO ledger (floor_id,day,agent_id,model,prompt_tokens,completion_tokens,cost_usd,created_at,kind,provider) VALUES (?,?,NULL,?,0,0,?,?,'model',?)", floorId, new Date().toISOString().slice(0, 10), provider === 'anthropic' ? 'claude-opus-5-5' : 'anthropic/claude-sonnet-5.5', usd, Date.now(), provider);
const recording = (seen) => { const inner = createMockClient({ mockDelayMs: 2 }); return { ...inner, chat(x) { seen.push({ model: x.model, provider: x.provider, effort: x.effort, kind: x.meta?.kind }); return inner.chat(x); } }; };
const assign = (t, floor, to, project = 'things') => { const mgr = get(t.db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", floor.id); const r = t.app.engine.assignTask(floor, mgr, { to, title: 'A small job', brief: 'Write a note.', plan: '', project, private: false, dependsOn: [] }); t.app.engine.kick(); return r; };
const taskOf = (t, id) => get(t.db, 'SELECT * FROM tasks WHERE id=?', id);
const ledger = (t, floorId) => all(t.db, 'SELECT model, kind, provider, cost_usd FROM ledger WHERE floor_id=? ORDER BY id', floorId);

describe('a floor on OpenRouter only', () => {
  test('every Claude role goes to OpenRouter on the floor\'s model and effort, whatever the tier or work mode; OpenRouter roles keep their own', () => {
    for (const [key, role] of Object.entries(models.all)) {
      for (const tier of ['', 'fable', 'opus', 'sonnet']) for (const autonomous of [false, true]) {
        const r = routeFor(models, key, { tier, autonomous, floorRoute: OR });
        assert.equal(r.provider, 'openrouter', `${key} ${tier} ${autonomous}`);
        const wasClaude = routeFor(models, key, { tier, autonomous }).provider === 'anthropic';
        if (wasClaude) { assert.equal(r.model, OR.model, key); assert.equal(r.effort, 'high', key); assert.equal(r.pricing, models.prices[OR.model], `${key} is priced as that model`); }
        else assert.equal(r.model, role.model, `${key} keeps its own OpenRouter model`);
      }
      assert.equal(routeFor(models, key, { computer: true, floorRoute: OR }), null, `${key} has no computer there`);
      assert.equal(computerRole(models, key, {}) === null, !role.computer, 'and other floors keep theirs');
    }
    assert.equal(routeFor(models, 'manager', { floorRoute: { ...OR, model: 'anthropic/claude-opus-5.5', effort: 'medium' } }).effort, 'medium');
    assert.equal(routeFor(models, 'manager', {}).provider, 'anthropic', 'no override, no change');
  });

  test('small talk and app AI keep their own model under its OpenRouter name; a work answer keeps its effort', () => {
    assert.equal(openrouterName('claude-haiku-5-5'), 'anthropic/claude-haiku-5.5');
    assert.equal(openrouterName('claude-sonnet-5-5'), 'anthropic/claude-sonnet-5.5');
    assert.equal(openrouterName('google/gemini-3.1-pro-preview'), 'google/gemini-3.1-pro-preview');
    const talk = overFloor({ provider: 'anthropic', model: 'claude-haiku-5-5', effort: 'low' }, OR, models.prices, { sameModel: true });
    assert.deepEqual([talk.provider, talk.model, talk.effort], ['openrouter', 'anthropic/claude-haiku-5.5', 'low']);
    assert.ok(models.prices[talk.model]?.prompt > 0, 'priced');
    const ans = overFloor({ provider: 'anthropic', model: 'claude-opus-5-5', effort: 'medium' }, OR, models.prices, { keepEffort: true });
    assert.deepEqual([ans.model, ans.effort], [OR.model, 'medium']);
    assert.equal(overFloor({ provider: 'openrouter', model: 'x/y' }, OR, models.prices).model, 'x/y');
  });

  test('OpenRouter is asked for Claude\'s thinking and prompt caching, and nothing else gets them', () => {
    assert.deepEqual(claudeExtras('anthropic/claude-sonnet-5.5', { effort: 'high' }), { reasoning: { effort: 'high' }, cache_control: { type: 'ephemeral' } });
    assert.deepEqual(claudeExtras('anthropic/claude-opus-5.5', { effort: 'max', cache: false }), { reasoning: { effort: 'xhigh' } });
    assert.deepEqual(claudeExtras('anthropic/claude-sonnet-5.5', {}), { cache_control: { type: 'ephemeral' } });
    assert.deepEqual(claudeExtras('google/gemini-3.1-pro-preview', { effort: 'high' }), {});
  });

  test('the router sends a picture to OpenRouter as an image part and drops the Claude-only fields', async () => {
    let got = null;
    const router = createRouter({ anthropic: { chat: () => assert.fail('went to the Claude API') }, openrouter: { chat: (x) => { got = x; return {}; } } });
    await router.chat({ provider: 'openrouter', model: OR.model, messages: [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'look', office_blocks: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } }, { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'x' } }] },
      { role: 'assistant', content: 'ok', anthropic_content: [{ type: 'thinking', thinking: 'hm' }] },
    ] });
    assert.deepEqual(got.messages[1].content, [{ type: 'text', text: 'look' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QUJD' } }]);
    assert.deepEqual(got.messages[2], { role: 'assistant', content: 'ok' });
  });

  test('a floor past its Claude stop works on, billed to OpenRouter, the Builder without a computer, and nothing lands on Claude', async () => {
    const seen = []; let sessionCalls = 0;
    const sessions = new Proxy(createMockSessions({}), { get: (o, k) => (typeof o[k] === 'function' ? (...a) => { sessionCalls++; return o[k](...a); } : o[k]) });
    const t = await start({ computerEnabled: true }, { llm: recording(seen), sessions });
    t.app.engine.runManager = async () => {};
    const f = floorOf(t, await claim(t, 'Tire Co')), g = floorOf(t, await claim(t, 'Other Co'));
    spend(t, f.id, 'anthropic', 85);
    const b = t.app.engine.budget;
    assert.equal(b.out('anthropic', f.id), true, 'its Claude money is used up');
    b.setFloorOverride(f.id, { providerOverride: OR, openrouterStopUsd: 25 });
    assert.deepEqual(b.floorRoute(f.id), OR); assert.equal(b.floorRoute(g.id), null);
    assert.equal(t.app.engine.agentProvider({ role: 'builder' }, f.id), 'openrouter');
    assert.equal(t.app.engine.agentProvider({ role: 'builder' }, g.id), 'anthropic', 'another floor\'s Builder still has its computer');
    assert.equal(t.app.engine.computer.handles('builder', f.id), false);
    assert.equal(t.app.engine.floorCfg(f.id).computerEnabled, false, 'its prompts are written for no computer');
    assert.equal(t.app.engine.floorCfg(g.id).computerEnabled, true);
    const before = sessionCalls;
    const r = assign(t, f, 'researcher'), bd = assign(t, f, 'builder', 'site');
    for (const id of [r.id, bd.id]) await until(() => !['todo', 'doing'].includes(taskOf(t, id).status), { what: `task ${id} to finish` });
    for (const id of [r.id, bd.id]) assert.notEqual(taskOf(t, id).status, 'failed');
    assert.equal(taskOf(t, bd.id).session_id, '', 'the Builder worked without a computer');
    assert.equal(sessionCalls, before, 'and no Managed Agents session was touched');
    const staff = seen.filter((x) => x.kind === 'staff');
    assert.ok(staff.length >= 2);
    for (const x of staff) assert.deepEqual([x.provider, x.model, x.effort], ['openrouter', OR.model, 'high']);
    const rows = ledger(t, f.id).slice(1);
    assert.ok(rows.length >= 2);
    for (const x of rows) assert.equal(x.provider, 'openrouter', `${x.kind} ${x.model} billed to OpenRouter`);
    assert.equal(get(t.db, 'SELECT budget_out b FROM floors WHERE id=?', f.id).b, '', 'the floor is not stopped');
    assert.equal(all(t.db, "SELECT 1 FROM messages WHERE floor_id=? AND role='budget'", f.id).length, 0, 'and the boss heard nothing about money');
  });

  test('the floor\'s OpenRouter stop still holds it, exactly at the line', async () => {
    const seen = [];
    const t = await start({}, { llm: recording(seen) });
    t.app.engine.runManager = async () => {};
    const f = floorOf(t, await claim(t, 'Capped Co'));
    const b = t.app.engine.budget;
    b.setFloorOverride(f.id, { providerOverride: OR, openrouterStopUsd: 10, claudeStopUsd: 0 });
    spend(t, f.id, 'openrouter', 9.99);
    assert.equal(b.out('openrouter', f.id), false);
    spend(t, f.id, 'openrouter', 0.01);
    assert.equal(b.out('openrouter', f.id), true);
    const { id } = assign(t, f, 'writer');
    await until(() => get(t.db, 'SELECT budget_out b FROM floors WHERE id=?', f.id).b === 'openrouter', { what: 'the floor to stop' });
    assert.equal(taskOf(t, id).status, 'todo', 'the job waits');
    assert.equal(seen.filter((x) => x.kind === 'staff').length, 0, 'and no model was called');
    b.setFloorOverride(f.id, { openrouterStopUsd: 20 });
    await until(() => taskOf(t, id).status !== 'todo', { what: 'the job to start after a top-up' });
    await until(() => taskOf(t, id).status !== 'doing', { what: 'it to finish' });
    assert.ok(ledger(t, f.id).every((x) => x.provider === 'openrouter'));
  });

  test('web search there is an OpenRouter search, billed to OpenRouter', async () => {
    const t = await start({ mediaMock: true, searchMock: true });
    t.app.engine.runManager = async () => {};
    const f = floorOf(t, await claim(t, 'Search Co'));
    t.app.engine.budget.setFloorOverride(f.id, { providerOverride: OR, claudeStopUsd: 0 });
    const researcher = get(t.db, "SELECT * FROM agents WHERE floor_id=? AND role='researcher'", f.id);
    const ctx = t.app.engine.toolCtx(f, researcher, null, toolsForRole('researcher'));
    assert.match(await t.app.engine.tools.exec(ctx, 'web_search', JSON.stringify({ query: 'tire shops in phoenix' })), /untrusted_data/);
    const row = ledger(t, f.id).find((x) => x.kind === 'search');
    assert.deepEqual([row.provider, row.model], ['openrouter', OR.model]);
  });

  test('the ship check there runs on the floor\'s model, billed to OpenRouter', async () => {
    const seen = [];
    const t = await start({}, { llm: recording(seen) });
    t.app.engine.runManager = async () => {};
    const f = floorOf(t, await claim(t, 'Ship Co'));
    t.app.engine.budget.setFloorOverride(f.id, { providerOverride: OR, claudeStopUsd: 0 });
    run(t.db, "INSERT INTO projects (floor_id,slug,title,created_at) VALUES (?,?,?,?)", f.id, 'site', 'Site', Date.now());
    run(t.db, "INSERT INTO files (floor_id,path,content,size,updated_at) VALUES (?,?,?,?,?)", f.id, 'projects/site/index.html', '<h1>Tires</h1>', 14, Date.now());
    await t.app.engine.shipCheck(f, 'site', { kind: 'site', directory: '' });
    const call = seen.find((x) => x.kind === 'shipcheck');
    assert.ok(call, 'the look happened');
    assert.deepEqual([call.provider, call.model], ['openrouter', OR.model]);
    assert.ok(ledger(t, f.id).filter((x) => x.kind === 'shipcheck').every((x) => x.provider === 'openrouter'));
  });

  test('floor-limit --openrouter-only sets it, --no-openrouter-only and --clear take it away', () => {
    const dir = mkdtempSync(join(tmpdir(), 'office-or-'));
    try {
      const db = openDb(dir);
      run(db, "INSERT INTO floors (slug,number,name,colors,boss,decor,recovery_hash,created_at) VALUES ('tirerx',6,'TireRx','{}','{}','{}','x',1)");
      db.close();
      const cli = (...a) => { const r = spawnSync(process.execPath, ['--no-warnings', join(ROOT, 'scripts/admin.mjs'), 'floor-limit', '--floor', '6', ...a], { env: { PATH: process.env.PATH, DATA_DIR: dir, ADMIN_PASSWORD: 'admin-fake-do-not-print', OPENROUTER_API_KEY: 'sk-or-fake-do-not-print' }, encoding: 'utf8', timeout: 30000 }); return r; };
      let r = cli('--openrouter-only', 'anthropic/claude-sonnet-5.5', '--effort', 'high', '--openrouter', '65.45', '--claude', '129.34');
      assert.equal(r.status, 0, r.stderr);
      let s = JSON.parse(r.stdout);
      assert.deepEqual(s.providerOverride, OR); assert.equal(s.openrouterStopUsd, 65.45); assert.equal(s.claudeStopUsd, 129.34);
      assert.ok(!(r.stdout + r.stderr).includes('sk-or-fake'), 'no key printed');
      s = JSON.parse(cli('--openrouter', '70').stdout);
      assert.deepEqual(s.providerOverride, OR, 'a later top-up keeps it');
      assert.notEqual(cli('--openrouter-only', '--effort').status, 0, 'a model id is needed');
      assert.notEqual(cli('--openrouter-only', 'anthropic/claude-sonnet-5.5', '--effort', 'huge').status, 0, 'and a real effort');
      s = JSON.parse(cli('--no-openrouter-only').stdout);
      assert.equal(s.providerOverride, null); assert.equal(s.openrouterStopUsd, 70, 'only the route goes');
      cli('--openrouter-only', 'anthropic/claude-opus-5.5', '--effort', 'medium');
      s = JSON.parse(cli('--clear').stdout);
      assert.equal(s.providerOverride, null); assert.equal(s.overridden, false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
