// How the bots build: the playbooks that decide whether the work is any good, the design review that has to close its loop, and the starter a game or app asked for in chat begins on.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { get, run } from '../server/db.js';
import { loadModels } from '../server/config.js';
import { toolsForRole, toolDefs } from '../server/tools.js';
import { createMedia } from '../server/media.js';
import { managerPrompt, laneBrief, computerPrompt, LANES } from '../server/prompts.js';
import { createMockSessions } from '../server/mock-sessions.js';
import { boot, claim } from './helpers.js';

const TINY = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/rcg7WQAAAABJRU5ErkJggg==', 'base64');
const floor = { name: 'A', number: 1, tagline: '' };
const BOSS = { name: 'B' }, ROSTER = { manager: 'M' };
const FULL = { appsBaseDomain: 'apps.example', computerEnabled: true, openrouterKey: 'k', anthropicKey: 'k' };
const BARE = { aiMode: 'live' };
const open = [];
after(async () => { for (const t of open) await t.close(); });

async function start(over = {}, deps = {}) {
  const t = await boot({ appsBaseDomain: 'apps.localhost', appsScheme: 'http', mediaMock: true, searchMock: true, publicOrigin: '', ...over }, deps);
  open.push(t);
  await t.app.engine.stop(); // these tests look at what gets set up, so nothing should start running
  const c = await claim(t, `Build ${open.length}`);
  const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
  const mgr = get(t.db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", f.id);
  const agent = (role) => get(t.db, 'SELECT * FROM agents WHERE floor_id=? AND role=?', f.id, role);
  return { t, c, f, mgr, agent };
}
const fileIn = (h, slug, name) => get(h.t.db, 'SELECT content FROM files WHERE floor_id=? AND path=?', h.f.id, `projects/${slug}/${name}`)?.content;

describe('the playbooks', () => {
  const full = managerPrompt(floor, BOSS, ROSTER, FULL);
  test('a game gets a Designer before the Builder, on a floor with computers', () => {
    const game = full.split(/^GAME$/m)[1].split(/^WEBSITE$/m)[0];
    assert.match(game, /Designer first/);
    assert.ok(game.indexOf('Designer') < game.indexOf('Builder'));
    assert.doesNotMatch(managerPrompt(floor, BOSS, ROSTER, BARE).split(/^GAME$/m)[1].split(/^WEBSITE$/m)[0], /Designer first/);
    assert.match(laneBrief('game', 'designer', FULL), /notes\/design\.md/);
  });
  test('the app lane exists in chat, with the Tester\'s sign-up checks and nothing about it on a bare floor', () => {
    assert.ok(LANES.includes('app'));
    assert.ok(toolDefs(toolsForRole('manager'), FULL, 'manager').find((d) => d.function?.name === 'assign_task' || d.name === 'assign_task'));
    const app = full.split(/^APP$/m)[1].split(/^BUSINESS$/m)[0];
    assert.match(app, /lane app/); assert.match(app, /second account/); assert.match(app, /Nobody publishes before the Tester/);
    assert.doesNotMatch(managerPrompt(floor, BOSS, ROSTER, BARE), /^APP$/m);
    assert.match(laneBrief('app', 'tester', FULL), /Begin your reply with PASS|begin your reply with PASS/);
  });
  test('a game is built and judged for a portrait phone first', () => {
    const b = laneBrief('game', 'builder', FULL), t = laneBrief('game', 'tester', FULL);
    assert.match(b, /portrait phone is the main screen/); assert.match(b, /STARTER\.md/);
    assert.match(t, /fill most of a portrait phone/); assert.match(t, /notes\/shots\/phone\.jpg/);
  });
  test('the review loop is the rule: both sizes, and a second look', () => {
    assert.match(computerPrompt(FULL, 'builder', {}), /phone_file/); assert.match(computerPrompt(FULL, 'builder', {}), /a second review is expected/);
    assert.match(laneBrief('website', 'builder', FULL), /call review_design with a desktop and a phone screenshot/);
    assert.match(laneBrief('website', 'tester', FULL), /marked \[broken\]/);
    assert.doesNotMatch(laneBrief('website', 'builder', BARE), /review_design/);
  });
  test('hollow pages: facts are asked for at the start, and nothing ships empty', () => {
    assert.match(full, /Send me your prices and area/);
    assert.match(laneBrief('website', 'writer', FULL), /Never leave a section empty/);
    assert.match(laneBrief('website', 'designer', FULL), /Unless the boss sent photos/);
  });
  test('a first build isn\'t told to skimp, and a change to something live still is', () => {
    assert.doesNotMatch(full, /dearest kind of work/);
    assert.match(full, /first version is what the boss judges the company by/);
    assert.doesNotMatch(laneBrief('website', 'builder', FULL), /about 15 steps/);
  });
  test('the manager looks before it approves', () => {
    assert.match(full, /notes\/shots\/phone\.jpg/); assert.match(full, /still says FIX FIRST/);
  });
});

describe('a game or app asked for in chat starts on the starter', () => {
  const sessions = () => createMockSessions({}, {});
  const seedOn = async () => start({ computerEnabled: true }, { sessions: sessions() });
  const assign = (h, over) => h.t.app.engine.assignTask(h.f, h.mgr, { to: 'builder', title: 'Build it', brief: 'Build a frog game', plan: '', project: 'frog', private: false, dependsOn: [], ...over });
  test('a new game project gets the kit and a filled-in title', async () => {
    const h = await seedOn();
    assign(h, { lane: 'game' });
    assert.ok(fileIn(h, 'frog', 'STARTER.md'), 'the starter arrived');
    assert.ok(fileIn(h, 'frog', 'kit.js')); assert.ok(fileIn(h, 'frog', 'game.js'));
    assert.match(String(fileIn(h, 'frog', 'index.html')), /<title>Frog<\/title>/);
    assert.doesNotMatch(String(fileIn(h, 'frog', 'index.html')), /\{\{TITLE\}\}/);
  });
  test('a new app project gets the app starter', async () => {
    const h = await seedOn();
    assign(h, { lane: 'app', project: 'shifts', brief: 'A shift swap app' });
    assert.ok(fileIn(h, 'shifts', 'STARTER.md')); assert.ok(fileIn(h, 'shifts', 'app.js'));
  });
  test('it never touches a project that already has something in it, or a floor without computers', async () => {
    const h = await seedOn();
    run(h.t.db, 'INSERT INTO files (floor_id,path,content,size,updated_at) VALUES (?,?,?,?,?)', h.f.id, 'projects/frog/index.html', 'mine', 4, 1);
    assign(h, { lane: 'game' });
    assert.equal(fileIn(h, 'frog', 'STARTER.md'), undefined);
    assert.equal(fileIn(h, 'frog', 'index.html'), 'mine');
    assign(h, { lane: 'website', project: 'plain', brief: 'A site' });
    assert.equal(fileIn(h, 'plain', 'STARTER.md'), undefined);
    const bare = await start({ computerEnabled: false });
    assign(bare, { lane: 'game' });
    assert.equal(fileIn(bare, 'frog', 'STARTER.md'), undefined);
  });
});

describe('the design review', () => {
  const reviewer = async (replies) => {
    const calls = [];
    const f = async (u, init) => { calls.push(JSON.parse(init.body)); return new Response(JSON.stringify({ choices: [{ message: { content: replies[Math.min(calls.length - 1, replies.length - 1)] } }], usage: { cost: 0.01 } }), { status: 200 }); };
    const h = await start({ mediaMock: false, openrouterKey: 'K', computerEnabled: true }, { media: createMedia({ cfg: { openrouterKey: 'K', openrouterBase: 'http://x.invalid' }, tools: loadModels().tools, httpFetch: f }), sessions: createMockSessions({}, {}) });
    for (const n of ['shot.png', 'phone.png']) run(h.t.db, 'INSERT INTO files (floor_id,path,content,size,updated_at) VALUES (?,?,?,?,?)', h.f.id, `projects/teacups/${n}`, new Uint8Array(TINY), TINY.length, 1);
    h.t.app.engine.upsertProject(h.f, 'teacups', { title: 'x' });
    const tester = get(h.t.db, "SELECT * FROM agents WHERE floor_id=? AND role='builder'", h.f.id);
    const ctx = h.t.app.engine.toolCtx(h.f, tester, null, toolsForRole('builder'));
    const review = (args) => h.t.app.engine.tools.exec(ctx, 'review_design', JSON.stringify({ project: 'teacups', ...args }));
    return { h, calls, review };
  };
  const stored = (h) => JSON.parse(get(h.t.db, "SELECT design_review d FROM projects WHERE slug='teacups'").d);
  test('it sees both sizes, and the score and verdict are recorded', async () => {
    const { h, calls, review } = await reviewer(['1. [broken] The phone hero is cut off.\n2. None seen.\n3. Score: 6/10. Verdict: FIX FIRST']);
    const out = await review({ file: 'projects/teacups/shot.png', phone_file: 'projects/teacups/phone.png' });
    assert.match(out, /untrusted_data/);
    const parts = calls[0].messages[0].content;
    assert.equal(parts.filter((p) => p.type === 'image_url').length, 2);
    assert.match(parts[0].text, /\[broken\]/); assert.match(parts[0].text, /phone view/);
    const s = stored(h); assert.equal(s.verdict, 'fix first'); assert.equal(s.score, 6); assert.equal(s.rounds, 1);
  });
  test('a second review counts, and "ship" isn\'t mistaken for fix first', async () => {
    const { h, review } = await reviewer(['1. [broken] Too small.\n3. Verdict: FIX FIRST', '1. [better] Nothing to fix first, a minor spacing nit.\n2. None seen.\n3. Score: 8 out of 10. Verdict: SHIP']);
    await review({ file: 'projects/teacups/shot.png' });
    await review({ file: 'projects/teacups/shot.png', phone_file: 'projects/teacups/phone.png' });
    const s = stored(h); assert.equal(s.verdict, 'ship'); assert.equal(s.score, 8); assert.equal(s.rounds, 2);
  });
  test('the Tester is handed it, and the manager reads the verdict', async () => {
    const { h } = await reviewer(['x']);
    run(h.t.db, "UPDATE projects SET design_review=? WHERE floor_id=? AND slug='teacups'", JSON.stringify({ at: 1, model: 'm', verdict: 'fix first', score: 6, rounds: 2, text: '[broken] The hero is cut off on a phone.' }), h.f.id);
    run(h.t.db, 'UPDATE projects SET published_at=? WHERE floor_id=? AND slug=?', 1, h.f.id, 'teacups');
    h.t.app.engine.hireStaff(h.f, 'tester');
    const tester = get(h.t.db, "SELECT * FROM agents WHERE floor_id=? AND role='tester'", h.f.id);
    const { id } = h.t.app.engine.assignTask(h.f, h.mgr, { to: 'tester', title: 'Test it', brief: 'Test it', plan: '', project: 'teacups', private: false, dependsOn: [] });
    const task = get(h.t.db, 'SELECT * FROM tasks WHERE id=?', id);
    assert.equal(task.agent_id, tester.id);
    const text = h.t.app.engine.handoffFor(h.f, task);
    assert.match(text, /\[broken\] The hero is cut off/); assert.match(text, /fix first \(6\/10\) after 2 looks/);
    const builderTask = { ...task, agent_id: h.agent('builder').id };
    assert.doesNotMatch(h.t.app.engine.handoffFor(h.f, builderTask), /The last outside design review/);
    const state = h.t.app.engine.managerContext(h.f, h.mgr).messages.at(-1).content;
    assert.match(state, /design review: fix first \(6\/10\) after 2 looks/);
  });
});
