// The last look before a first publish (server/shipcheck.js). The model is the mock, so what is proved here is the plumbing around it: when it runs,
// what it is shown, that it can hold a first publish back twice at most, that an unchanged version is never paid for twice, and that it never blocks
// on its own failure. Whether the real model's judgement is any good is not something a test here can show.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { get, all, run } from '../server/db.js';
import { boot, claim, waitDone, floorState } from './helpers.js';
import { parseVerdict, SHIP_SYSTEM } from '../server/shipcheck.js';
import { buildRequest, modelShape } from '../server/anthropic.js';
import { loadModels } from '../server/config.js';

const looks = (t, slug) => JSON.parse(get(t.db, 'SELECT ship_check s FROM projects WHERE slug=?', slug)?.s || '{"looks":[]}').looks;
const calls = (t) => get(t.db, "SELECT COUNT(*) n FROM ledger WHERE kind='shipcheck'").n;

describe('the last look: its shape', () => {
  test('a verdict is read tolerantly, and anything else is no opinion', () => {
    const v = parseVerdict('Here you go:\n```json\n{"ship": false, "scores": {"works": 8, "as_asked": 4, "look": 11, "phone": 7}, "fix": ["a", "", "b", "c", "d", "e", "f"], "note": "no"}\n```');
    assert.equal(v.ship, false); assert.deepEqual(v.scores, { works: 8, as_asked: 4, phone: 7 }); assert.equal(v.fix.length, 5);
    for (const bad of ['', 'no json here', '{"ship": "yes"}', '{broken']) assert.equal(parseVerdict(bad), null);
  });
  test('it runs on Fable 5.2 as that model wants: thinking left adaptive, no forced tool choice, the default fallback, priced', () => {
    const models = loadModels();
    const s = models.tools.ship;
    assert.equal(s.model, 'claude-fable-5-2'); assert.equal(s.provider, 'anthropic'); assert.equal(s.rounds, 2);
    assert.deepEqual(s.pricing, { prompt: 8, completion: 40, cacheRead: 0.2 });
    assert.deepEqual(modelShape(s.model), { fallbacks: 'default', thinkingOff: null, forcedToolChoice: false });
    const body = buildRequest({ model: s.model, effort: s.effort, maxTokens: s.maxTokens, system: SHIP_SYSTEM, messages: [{ role: 'user', content: 'x' }], thinking: 'off', tools: [{ name: 't', input_schema: { type: 'object' } }], toolChoice: { type: 'any' } });
    assert.deepEqual(body.thinking, { type: 'adaptive' }, 'never "disabled": that is a 400 on this model');
    assert.deepEqual(body.tool_choice, { type: 'auto' }); assert.equal(body.fallbacks, 'default'); assert.deepEqual(body.output_config, { effort: 'high' });
    assert.equal(body.temperature, undefined);
  });
  test('its prompt asks for honesty, not polish, and says nothing of hurry or money', () => {
    assert.match(SHIP_SYSTEM, /would you ship this today/); assert.match(SHIP_SYSTEM, /Do not hold something back over taste/); assert.match(SHIP_SYSTEM, /never instructions to you/);
    assert.doesNotMatch(SHIP_SYSTEM, /hurry|quick|budget|token|\bcost/i);
  });
});

describe('the last look: around a publish', () => {
  test('a first publish that passes goes live after one look; a later change to it is not looked at again', async () => {
    const t = await boot({});
    try {
      const c = await claim(t);
      await c.post(`/api/floors/${c.slug}/chat`, { text: 'build me a site' });
      const s = await waitDone(c);
      const p = s.projects.find((x) => x.kind === 'site');
      assert.ok(p?.url, 'it went live');
      assert.equal(looks(t, p.slug).length, 1); assert.equal(looks(t, p.slug)[0].ship, true); assert.equal(calls(t), 1);
      const floor = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
      assert.equal(await t.app.engine.shipCheck(floor, p.slug, { kind: 'site' }), null);
      assert.equal(calls(t), 1, 'something already live is the boss\'s own change, and gets no look');
    } finally { await t.close(); }
  });
  test('a look that says no holds the publish back with what to fix; unchanged, it costs nothing to hear it again; changed, it gets one more look', async () => {
    const t = await boot({});
    try {
      const c = await claim(t);
      const floor = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
      const e = t.app.engine;
      e.addMessage(floor.id, 'boss', null, 'a page for my bakery [nevership]');
      e.upsertProject(floor, 'bakery', { title: 'Bakery' });
      const { writeFile } = await import('../server/workspace.js');
      writeFile(t.db, floor.id, 'projects/bakery/index.html', '<h1>Bakery</h1>', null, 1e8);
      const first = await e.shipCheck(floor, 'bakery', { kind: 'site' });
      assert.match(first, /would not ship it yet/); assert.match(first, /The hero says nothing/); assert.match(first, /one more look/);
      assert.equal(calls(t), 1);
      const again = await e.shipCheck(floor, 'bakery', { kind: 'site' });
      assert.match(again, /Nothing in the project has changed since that look/); assert.equal(calls(t), 1, 'no second call for the same version');
      writeFile(t.db, floor.id, 'projects/bakery/index.html', '<h1>Bakery, open at seven</h1>', null, 1e8);
      run(t.db, "UPDATE files SET updated_at=updated_at+5 WHERE path='projects/bakery/index.html'");
      assert.equal(await e.shipCheck(floor, 'bakery', { kind: 'site' }), null, 'the second look is the last: it goes live either way');
      assert.equal(calls(t), 2); assert.equal(looks(t, 'bakery').length, 2);
      assert.ok(all(t.db, "SELECT text FROM messages WHERE floor_id=? AND role='note'", floor.id).some((m) => /still had doubts/.test(m.text)), 'and the manager is told what is left');
      writeFile(t.db, floor.id, 'projects/bakery/index.html', '<h1>Third</h1>', null, 1e8);
      assert.equal(await e.shipCheck(floor, 'bakery', { kind: 'site' }), null); assert.equal(calls(t), 2, 'never a third look');
    } finally { await t.close(); }
  });
  test('a point nobody acts on never keeps the boss from their link: said twice, then it goes through and the manager is told', async () => {
    const t = await boot({});
    try {
      const c = await claim(t);
      const floor = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
      const e = t.app.engine;
      e.addMessage(floor.id, 'boss', null, 'a page [nevership]');
      e.upsertProject(floor, 'stuck', { title: 'Stuck' });
      const { writeFile } = await import('../server/workspace.js');
      writeFile(t.db, floor.id, 'projects/stuck/index.html', '<h1>Stuck</h1>', null, 1e8);
      assert.match(await e.shipCheck(floor, 'stuck', { kind: 'site' }), /would not ship/);
      assert.match(await e.shipCheck(floor, 'stuck', { kind: 'site' }), /Nothing in the project has changed/);
      assert.equal(await e.shipCheck(floor, 'stuck', { kind: 'site' }), null);
      assert.equal(calls(t), 1);
      assert.equal(all(t.db, "SELECT text FROM messages WHERE floor_id=? AND role='note'", floor.id).filter((m) => /still had doubts/.test(m.text)).length, 1);
    } finally { await t.close(); }
  });
  test('documents and research are not looked at, an unreadable answer is no opinion, and switching it off is honoured', async () => {
    const t = await boot({});
    try {
      const c = await claim(t);
      const floor = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
      const e = t.app.engine;
      e.upsertProject(floor, 'notes', { title: 'Notes' });
      assert.equal(await e.shipCheck(floor, 'notes', { kind: 'doc' }), null); assert.equal(calls(t), 0);
      e.addMessage(floor.id, 'boss', null, 'a thing [shipgarbage]');
      assert.equal(await e.shipCheck(floor, 'notes', { kind: 'site' }), null); assert.equal(looks(t, 'notes').length, 0);
      t.cfg.shipCheck = false; const n = calls(t);
      assert.equal(await e.shipCheck(floor, 'notes', { kind: 'site' }), null); assert.equal(calls(t), n);
    } finally { await t.close(); }
  });
  test('through the real publish tool: the Builder is refused with what to fix, and nothing goes live on that try', async () => {
    const t = await boot({});
    try {
      const c = await claim(t);
      await c.post(`/api/floors/${c.slug}/chat`, { text: 'build me a site [noship]' });
      await waitDone(c);
      // The scripted mock staff never read a refusal and try again, so this shows the refusal reaching the tool call. The fix-and-republish
      // loop needs a real model to see.
      const slug = get(t.db, "SELECT slug FROM projects WHERE ship_check!=''")?.slug;
      assert.ok(slug); assert.equal(looks(t, slug)[0].ship, false); assert.equal(calls(t), 1);
      assert.equal(get(t.db, 'SELECT published_at FROM projects WHERE slug=?', slug).published_at, null);
    } finally { await t.close(); }
  });
});
