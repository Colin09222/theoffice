// Filler companies: scripted demo floors. They must look alive, cost nothing, call no model and belong to nobody.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, Client, claim, adminClient, floorState, until, sse, sleep } from './helpers.js';
import { seedFillers, removeFiller, listFillers, COMPANIES, DISCLAIMER } from '../server/filler.js';
import { loadConfig, loadModels } from '../server/config.js';

const fillerFloors = (t) => t.db.prepare('SELECT * FROM floors WHERE filler=1 ORDER BY number DESC').all();

describe('filler companies', () => {
  let t; const llmCalls = { n: 0 };
  // A model that explodes if anyone so much as looks at it. Filler floors must never get this far.
  // A real floor in the same building may cast its people. Any call for a filler floor is the failure.
  const llm = { chat(x) { if (x?.meta?.kind === 'talk' && !t.db.prepare('SELECT filler FROM floors WHERE id=?').get(x.meta.floorId)?.filler) throw new Error('no model in this test'); llmCalls.n++; throw new Error('a filler floor called the model'); } };
  before(async () => { t = await boot({ fillerCompanies: true, fillerTickMs: 20 }, { llm }); });
  after(() => t.close());

  test('seeds the companies once, high up, never on floor 1, and seeding again is a no-op', () => {
    const rows = fillerFloors(t);
    assert.equal(rows.length, COMPANIES.length);
    for (const f of rows) {
      assert.ok(f.number >= 2 && f.number <= t.cfg.towerFloors - 3, `floor ${f.number}`);
      assert.equal(f.public_chat, 0); assert.equal(f.status, 'active');
      assert.ok(f.recovery_hash.includes(':'));
    }
    assert.equal(new Set(rows.map((f) => f.name)).size, COMPANIES.length);
    const again = seedFillers(t.db, { cfg: t.cfg, models: t.app.engine.models, engine: t.app.engine });
    assert.equal(again.seeded.length, 0);
    assert.ok(again.skipped.every((s) => s.why === 'exists'));
    assert.equal(fillerFloors(t).length, COMPANIES.length);
    assert.equal(t.db.prepare('SELECT COUNT(*) n FROM agents a JOIN floors f ON f.id=a.floor_id WHERE f.filler=1').get().n, COMPANIES.length * Object.keys(loadModels().roles).length);
  });

  test('the directory counts them as taken, marks them, and the vacant floor is still 1', async () => {
    assert.equal((await new Client(t).get('/api/floors')).data.vacant, 1);
    const real = await claim(t, 'Real Co');
    assert.equal(real.number, 1);
    const r = await new Client(t).get('/api/floors');
    assert.equal(r.status, 200);
    const cards = r.data.floors.filter((c) => c.filler === true);
    assert.equal(cards.length, COMPANIES.length);
    assert.equal(r.data.vacant, 2);
    assert.equal(r.data.towerFloors, t.cfg.towerFloors);
    const mine = r.data.floors.find((c) => c.slug === real.slug);
    assert.ok(mine && !('filler' in mine), 'a real floor carries no filler flag');
    assert.ok(cards.every((c) => c.name && c.tagline && c.colors.primary));
  });

  test('a visitor snapshot is marked filler, read-only, with no chat', async () => {
    const f = fillerFloors(t)[0];
    const s = await floorState(new Client(t), f.slug);
    assert.equal(s.floor.filler, true);
    assert.equal(s.viewer.owner, false);
    assert.equal(s.floor.publicChat, false);
    assert.equal(s.messages, undefined);
    assert.equal(s.agents.length, Object.keys(loadModels().roles).length);
    assert.ok(s.agents.every((a) => a.name && a.look.hair));
  });

  test('the scene runs: feed lines, tasks moving, states changing; no model, no spend, no runs', async () => {
    const f = fillerFloors(t)[0];
    const c = new Client(t);
    const stream = sse(c, f.slug);
    const states = new Set(); const statuses = new Set();
    await until(async () => {
      const s = await floorState(c, f.slug);
      for (const a of s.agents) states.add(a.state);
      for (const x of s.tasks) statuses.add(x.status);
      return s.feed.length >= 3 && statuses.has('doing') && statuses.has('done') && states.size >= 3 ? s : null;
    }, { timeout: 20000, every: 25, what: 'the filler scene to move' });
    await stream.close();
    assert.ok(states.has('idle') && [...states].some((x) => ['typing', 'browsing', 'reading', 'thinking', 'talking'].includes(x)), [...states].join());
    const types = new Set(stream.events.map((e) => e.type));
    assert.ok(types.has('feed') && types.has('task') && types.has('agent'), [...types].join());
    // The scene runs on its own clock, so on a busy machine the assigning can happen before this stream connects. What it wrote to the feed still counts.
    const feedLines = [...stream.events.filter((e) => e.type === 'feed').map((e) => e.data.text), ...(await floorState(c, f.slug)).feed.map((x) => x.text)];
    assert.ok(feedLines.some((x) => /^started "/.test(x)) && feedLines.some((x) => /^gave \w+ a task: "/.test(x)), feedLines.join('|'));
    assert.equal(llmCalls.n, 0);
    assert.equal(t.app.engine.runs.size, 0);
    assert.equal(t.db.prepare('SELECT COUNT(*) n FROM ledger').get().n, 0);
    assert.deepEqual(t.app.engine.errors, []);
    assert.ok(!t.logs.some((l) => l.includes('"filler"') && l.includes('"error"')), t.logs.filter((l) => l.includes('filler')).join('\n'));
    const s = await floorState(c, f.slug);
    assert.equal(s.spend, undefined); assert.equal(t.app.engine.spentToday(t.db.prepare('SELECT id FROM floors WHERE slug=?').get(f.slug).id), 0);
  });

  test('publishes a small demo note with the disclaimer and no links, and keeps the board short', async () => {
    const f = fillerFloors(t)[0];
    const c = new Client(t);
    const s = await until(async () => { const x = await floorState(c, f.slug); return x.projects.length ? x : null; }, { timeout: 30000, every: 50, what: 'a filler project' });
    const p = s.projects[0];
    assert.equal(p.kind, 'doc'); assert.equal(p.private, false);
    const page = await c.raw('GET', `/f/${f.slug}/${p.slug}/`);
    assert.equal(page.status, 200);
    const body = await page.text();
    assert.ok(body.includes(DISCLAIMER));
    assert.ok(!/https?:\/\//i.test(body), 'no outbound links');
    assert.ok(body.includes(f.name));
    assert.ok(t.db.prepare("SELECT COUNT(*) n FROM tasks WHERE floor_id=? AND status='done'").get(f.id).n <= 30);
  });

  test('nobody can log in, claim the floor, chat or change settings', async () => {
    const f = fillerFloors(t)[0];
    const c = new Client(t);
    assert.equal((await c.post('/api/login', { slug: f.slug, recoveryCode: 'RECOVER-AAAAA-BBBBB-CCCCC-DDDDD-EEEEE' })).status, 401);
    assert.equal((await c.post('/api/login', { slug: f.slug, recoveryCode: f.recovery_hash })).status, 401);
    assert.equal((await c.post('/api/claim', { code: t.code(f.number), name: 'Squatter', bossName: 'S' })).status, 409);
    assert.equal((await c.post(`/api/floors/${f.slug}/chat`, { text: 'hello?' })).status, 401);
    assert.equal((await c.post(`/api/floors/${f.slug}/control`, { action: 'pause' })).status, 401);
    assert.equal((await c.post(`/api/floors/${f.slug}/settings`, { name: 'Mine now' })).status, 401);
    const admin = await adminClient(t);
    assert.equal((await admin.post('/api/admin/codes', { floor: f.number })).status, 409);
    assert.equal(t.db.prepare('SELECT COUNT(*) n FROM sessions WHERE floor_id=?').get(f.id).n, 0);
  });

  test('admin sees the badge, removes one, and seeding does not bring it back unless revived', async () => {
    const admin = await adminClient(t);
    const o = await admin.get('/api/admin/overview');
    const marked = o.data.floors.filter((r) => r.filler === true);
    assert.equal(marked.length, COMPANIES.length);
    assert.ok(o.data.floors.filter((r) => !r.filler).every((r) => !('filler' in r)));
    const victim = marked[0];
    assert.equal((await new Client(t).post('/api/admin/filler/remove', { id: victim.id })).status, 401);
    assert.equal((await admin.post('/api/admin/filler/remove', { id: 999999 })).status, 404);
    const r = await admin.post('/api/admin/filler/remove', { id: victim.id });
    assert.equal(r.status, 200); assert.equal(r.data.removed.id, victim.id);
    assert.equal(fillerFloors(t).length, COMPANIES.length - 1);
    assert.equal(t.db.prepare('SELECT COUNT(*) n FROM floors WHERE id=?').get(victim.id).n, 0);
    assert.equal(t.db.prepare('SELECT COUNT(*) n FROM tasks WHERE floor_id=?').get(victim.id).n, 0);
    const direct = seedFillers(t.db, { cfg: t.cfg, models: t.app.engine.models, engine: t.app.engine });
    assert.equal(direct.seeded.length, 0); assert.ok(direct.skipped.some((s) => s.why === 'removed'));
    const plain = await admin.post('/api/admin/filler/seed', {});
    assert.equal(plain.status, 200); assert.equal(plain.data.seeded.length, 0);
    assert.equal(fillerFloors(t).length, COMPANIES.length - 1);
    const revived = await admin.post('/api/admin/filler/seed', { revive: true });
    assert.equal(revived.data.seeded.length, 1);
    assert.equal(fillerFloors(t).length, COMPANIES.length);
    assert.notEqual(fillerFloors(t).find((f) => f.name === victim.name).id, victim.id);
  });

  test('the CLI functions free a floor without an engine, the scene copes, and a code can then be issued for it', async () => {
    const f = fillerFloors(t).at(-1);
    const before = t.app.engine.errors.length;
    const r = removeFiller(t.db, { number: f.number });
    assert.equal(r.number, f.number);
    assert.equal(t.db.prepare('SELECT COUNT(*) n FROM floors WHERE number=?').get(f.number).n, 0);
    await sleep(250);  // several ticks on a floor that has vanished under the scene
    assert.equal(t.app.engine.errors.length, before);
    assert.ok(!t.logs.some((l) => l.includes('"filler"') && l.includes('"error"')));
    assert.equal((await new Client(t).get(`/api/floors/${f.slug}`)).status, 404);
    const listed = listFillers(t.db);
    assert.equal(listed.floors.length, COMPANIES.length - 1);
    assert.ok(listed.removed.some((x) => x.key === r.key && x.floorNumber === f.number));
    const admin = await adminClient(t);
    assert.equal((await admin.post('/api/admin/codes', { floor: f.number })).status, 201);
    // The CLI's seed revives it, with no engine at hand, and lands it somewhere other than the floor that now has a code.
    const back = seedFillers(t.db, { cfg: t.cfg, models: loadModels(), revive: true });
    assert.equal(back.seeded.length, 1);
    assert.notEqual(back.seeded[0].number, f.number);
    const nf = t.db.prepare('SELECT * FROM floors WHERE id=?').get(back.seeded[0].id);
    assert.equal(nf.filler, 1);
    assert.equal(t.db.prepare('SELECT COUNT(*) n FROM agents WHERE floor_id=?').get(nf.id).n, Object.keys(loadModels().roles).length);
    // The running server picks the new floor up on its next tick.
    await until(async () => { const s = await floorState(new Client(t), nf.slug); return s.tasks.length ? s : null; }, { timeout: 20000, every: 50, what: 'the revived floor to start working' });
  });
});

describe('filler companies are off by default', () => {
  let t; before(async () => { t = await boot(); }); after(() => t.close());
  test('no env flag means no filler floors and untouched floor cards', async () => {
    assert.equal(loadConfig({}).fillerCompanies, false);
    assert.equal(loadConfig({ FILLER_COMPANIES: '1', FILLER_TICK_MS: '5000' }).fillerTickMs, 5000);
    assert.equal(fillerFloors(t).length, 0);
    await claim(t, 'Hat Museum');
    const r = await new Client(t).get('/api/floors');
    assert.equal(r.data.floors.length, 1);
    assert.ok(!('filler' in r.data.floors[0]));
    assert.equal(r.data.vacant, 2);
  });
});
