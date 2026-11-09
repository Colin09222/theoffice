// How the bots build: the playbooks that decide whether the work is any good, the design review that has to close its loop, and the starter a game or app asked for in chat begins on.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { get, run } from '../server/db.js';
import { loadModels, loadConfig } from '../server/config.js';
import { toolsForRole, toolDefs } from '../server/tools.js';
import { createMedia } from '../server/media.js';
import { managerPrompt, laneBrief, computerPrompt, computerBriefing, staffPrompt, howYouWork, LANES } from '../server/prompts.js';
import { createMockSessions } from '../server/mock-sessions.js';
import { STREAM_QUIET_MS } from '../server/anthropic.js';
import { boot, claim, until, sleep } from './helpers.js';

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
  test('nobody is told to skimp, on a first build or a change to something live', () => {
    assert.doesNotMatch(full, /dearest kind of work/);
    assert.match(full, /first version is what the boss judges the company by/);
    assert.doesNotMatch(laneBrief('website', 'builder', FULL), /about \d+ steps/);
    assert.doesNotMatch(full, /no Tester unless the change is big/);
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
  test('the same screenshots again get the last review back: no paid call, no extra look, and new pictures are a new review', async () => {
    const { h, calls, review } = await reviewer(['1. [broken] The button is too small.\n3. Score: 5/10. Verdict: FIX FIRST', '1. [better] Spacing.\n3. Score: 8/10. Verdict: SHIP']);
    const paid = () => get(h.t.db, "SELECT COUNT(*) n, COALESCE(SUM(cost_usd),0) usd FROM ledger WHERE floor_id=? AND kind='review'", h.f.id);
    const both = { file: 'projects/teacups/shot.png', phone_file: 'projects/teacups/phone.png' };
    const first = await review(both);
    assert.equal(calls.length, 1); assert.equal(paid().n, 1);
    // Nothing was changed, and the same pictures are sent in again.
    const again = await review({ ...both, about: 'the same page, described differently' });
    assert.equal(calls.length, 1, 'nothing went to the other lab'); assert.deepEqual({ ...paid() }, { n: 1, usd: 0.01 }, 'and nothing went on the ledger');
    assert.match(again, /nothing has changed since the last review/); assert.match(again, /\[broken\] The button is too small/, 'the last review, whole');
    assert.match(again, /^<untrusted_data source="design review from another lab">/, 'still data');
    assert.ok(first.includes('[broken] The button is too small'));
    assert.equal(stored(h).rounds, 1, 'it does not count as another look'); assert.equal(stored(h).verdict, 'fix first');
    assert.equal(get(h.t.db, 'SELECT COUNT(*) n FROM budget_holds').n, 0);
    // The page was changed, so the screenshot is different: that is a real second review.
    const changed = Buffer.concat([TINY, Buffer.from([0])]);
    run(h.t.db, "UPDATE files SET content=?, size=? WHERE floor_id=? AND path='projects/teacups/shot.png'", new Uint8Array(changed), changed.length, h.f.id);
    const second = await review(both);
    assert.equal(calls.length, 2); assert.equal(paid().n, 2);
    assert.match(second, /Verdict: SHIP/); assert.doesNotMatch(second, /nothing has changed/);
    assert.equal(stored(h).rounds, 2); assert.equal(stored(h).verdict, 'ship');
    // What the boss's page is sent has the verdict, not the stored copy of the whole review.
    run(h.t.db, "UPDATE projects SET published_at=1 WHERE floor_id=? AND slug='teacups'", h.f.id);
    const view = (await h.c.get(`/api/floors/${h.c.slug}`)).data.projects.find((p) => p.slug === 'teacups');
    assert.equal(view.designReview.verdict, 'ship'); assert.equal(view.designReview.full, undefined); assert.equal(view.designReview.shots, undefined);
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

const STAFF = ['builder', 'designer', 'tester', 'researcher', 'writer', 'analyst', 'marketer', 'illustrator'];
const person = (role) => ({ name: 'S', title: 'T', role });
// Everything a bot is told before and during a job, on each path.
const everyPrompt = (cfg) => [managerPrompt(floor, BOSS, ROSTER, cfg), managerPrompt(floor, BOSS, ROSTER, BARE), ...STAFF.flatMap((r) => [staffPrompt(floor, person(r), {}, { lane: '' }, cfg), computerPrompt(cfg, r, {}), computerBriefing(floor, person(r), {}, { id: 1, title: 'x', brief: 'y', project: 'p', lane: '' }, cfg)]), ...LANES.flatMap((lane) => STAFF.flatMap((r) => [laneBrief(lane, r, cfg), computerBriefing(floor, person(r), {}, { id: 1, title: 'x', brief: 'y', project: 'p', lane }, cfg)]))];

test('a screenshot saved again while it is being read is looked for again, instead of stopping the floor', async () => {
  const { Computer } = await import('../server/computer.js');
  let tries = 0;
  const client = { listOutputs: async () => [{ filename: 'review-2.png', id: tries ? 'new' : 'old', size: 9, createdAt: String(tries) }], download: async (id) => { tries++; if (id === 'old') throw Object.assign(new Error('not found'), { status: 404 }); return Buffer.from('picture'); } };
  const computer = new Computer({ cfg: { maxSessionsFloor: 1, maxSessionsGlobal: 1 } }, client);
  computer.outputWaitMs = 5000;
  const st = { id: 'sesn_1', ctx: {} };
  computer.equip(st);
  assert.equal(String(await st.ctx.readOutput('review-2.png')), 'picture'); assert.equal(tries, 2);
});

test('a model that thinks for a long time is not taken for a dead connection', () => {
  assert.ok(STREAM_QUIET_MS >= 15 * 60_000, `${STREAM_QUIET_MS}`);
});

describe('how everyone in the building works', () => {
  const ALL = everyPrompt(FULL);
  const HURRY = /about \d+ steps|aim for about|aim to be done|real money|every (step|call) costs|costs? money|as few (staff|steps)|dearest|cheap wins|cheapest|one round of fixes|twice is the limit|big steps|in one go|batch work|no test suite|no notes files|expect about|at most three|keep the plan small|don't over-engineer|steps left|stop polishing|one quick|\bquick wins\b|15 to 30 minutes/i;
  test('no prompt tells anyone to hurry, or what anything costs, or how many steps they have', () => {
    for (const p of ALL) assert.doesNotMatch(p, HURRY);
  });
  test('the block opens every working prompt, ahead of the playbooks and the docs, on both paths', () => {
    const atTop = (prompt, before) => { const i = prompt.indexOf('How you work.'); assert.ok(i >= 0 && i < 700 && i < prompt.indexOf(before), `at ${i} of ${prompt.length}`); assert.match(prompt, /Done means good\. There is no step target and no time target/); };
    atTop(managerPrompt(floor, BOSS, ROSTER, FULL), 'The lanes.'); atTop(managerPrompt(floor, BOSS, ROSTER, BARE), 'The lanes.');
    for (const r of STAFF) atTop(staffPrompt(floor, person(r), {}, { lane: '' }, FULL), 'Workspace:');
    for (const r of ['builder', 'tester']) atTop(computerPrompt(FULL, r, {}), 'Setting up, always first');
    assert.doesNotMatch(staffPrompt(floor, person('lawyer'), {}, {}, FULL), /How you work\./, 'the Lawyer keeps its own brief');
  });
  test('every bullet is there, in words that fit the job and the path', () => {
    const bullets = [/Done means good/, /Before you .* read everything you were given/, /Nothing empty, nothing "coming soon", no placeholders|Anything empty, "coming soon" or a placeholder is a bug/, /Look at what/, /harshest critic/, /Never claim what/, /find out why before trying again/, /Say what you really think/];
    for (const r of ['manager', ...STAFF]) for (const b of bullets) assert.match(howYouWork(r, { browser: r === 'builder' || r === 'tester' }), b, r);
    assert.match(howYouWork('builder', { browser: true }), /Run it\. Use it the way a stranger would, on a phone and on a desktop/);
    assert.match(howYouWork('builder'), /You have no browser here/); assert.match(howYouWork('tester'), /You have no browser here/);
    assert.match(howYouWork('manager'), /Look at what your team actually made/); assert.match(howYouWork('tester', { browser: true }), /your own fixes included/);
    assert.match(howYouWork('researcher'), /Open every link you cite/); assert.match(howYouWork('designer'), /Open every picture you make/);
  });
  test('nothing else in a prompt argues with it', () => {
    const f = managerPrompt(floor, BOSS, ROSTER, FULL);
    assert.match(f, /as many times as it takes/); assert.match(f, /Never promise a time/); assert.doesNotMatch(f, /Once\.$/m);
    assert.doesNotMatch(computerPrompt(FULL, 'builder', {}), /A third only if|whatever else is quick/);
    assert.match(computerPrompt(FULL, 'builder', {}), /Write whatever checks and notes you need to be sure/);
    assert.doesNotMatch(laneBrief('game', 'builder', FULL), /one quick playthrough|bot runs/);
    assert.match(computerBriefing(floor, person('builder'), {}, { id: 1, title: 'x', brief: 'y', project: 'p', lane: 'game' }, FULL), /Remember how you work: done means good/, 'and it is what a computer reads last');
  });
});

describe('the one limit left: a ceiling on one task, for a stuck loop', () => {
  const usageFor = (usd) => ({ input_tokens: Math.round(usd * 250000), output_tokens: 0 });
  async function floorWith(script, over) {
    const sessions = createMockSessions({}, script);
    const h = await start({ computerEnabled: true, outputLagMs: 0, ...over }, { sessions });
    h.e = h.t.app.engine; h.sessions = sessions; h.e.stopped = false; h.e.runManager = async () => {};
    h.go = () => { const r = h.e.assignTask(h.f, h.mgr, { to: 'builder', title: 'Build the thing', brief: 'b', plan: '', project: 'stuck', dependsOn: [], afterPrevious: false }); h.e.kick(); return r; };
    h.settle = (id) => until(() => { const r = get(h.t.db, 'SELECT * FROM tasks WHERE id=?', id); return ['review', 'failed', 'blocked', 'done', 'cancelled'].includes(r.status) && !h.e.runs.size ? r : null; }, { timeout: 30000, what: 'the computer to finish' });
    h.boss = () => get(h.t.db, "SELECT text FROM messages WHERE floor_id=? AND role='budget' ORDER BY id DESC LIMIT 1", h.f.id)?.text || '';
    return h;
  }
  test('it is on by default, and no prompt ever mentions it', () => {
    assert.equal(loadConfig({}).taskMaxUsd, 40);
    for (const p of everyPrompt({ ...FULL, taskMaxUsd: 40 })) assert.doesNotMatch(p, /\b40\b.*(dollar|usd)|\$40|task ?max|ceiling/i);
  });
  test('a stuck job stops there, gets one last save, and the boss is told plainly, without a figure', async () => {
    let saved = false;
    const h = await floorWith({ stepUsd: 0.3, usage: usageFor(0.3), async onTurn(api) { for (let i = 0; i < 500; i++) { await api.step(); await sleep(1); if (api.session.queue.length && /Save your work now/.test(api.session.queue[0])) { api.save([{ path: 'index.html', data: Buffer.from('<h1>all of it</h1>') }]); saved = true; api.message('Saved what I had.'); return; } } } }, { taskMaxUsd: 1.2 });
    const row = await h.settle(h.go().id);
    assert.equal(row.status, 'failed'); assert.ok(saved, 'it was asked to save, and did');
    assert.match(String(fileIn(h, 'stuck', 'index.html')), /all of it/, 'and that work came back');
    assert.match(row.result, /Stopped by the building/); assert.match(row.result, /Don't start it again unless the boss says to/);
    assert.doesNotMatch(row.result, /\$|\bspen[dt]\b|\bbudget\b|\blimit\b|\bceiling\b/i);
    const notice = h.boss();
    assert.match(notice, /I stopped "Build the thing"/); assert.match(notice, /is on the drive/); assert.doesNotMatch(notice, /\$|\d|\bbudget\b/i);
    assert.ok(row.cost_usd <= 2.1, `it stopped near the ceiling: ${row.cost_usd}`);
  });
  test('one that never saves is still stopped, and the boss hears the newest work may be missing', async () => {
    const h = await floorWith({ stepUsd: 0.3, usage: usageFor(0.3), async onTurn(api) { for (let i = 0; i < 500; i++) { await api.step(); await sleep(1); } } }, { taskMaxUsd: 1.2 });
    const row = await h.settle(h.go().id);
    assert.equal(row.status, 'failed'); assert.ok(row.cost_usd <= 2.1, `${row.cost_usd}`);
    assert.match(h.boss(), /couldn't bring back its last save/);
  });
  test('the ceiling coming up while a job waited in line still lets it save', async () => {
    // Usage that says next to nothing, so it is the platform that stops it at the end of the slice and sends it back in line.
    let saved = false;
    const h = await floorWith({ stepUsd: 0.5, usage: { input_tokens: 10, output_tokens: 0 }, async onTurn(api) { for (let i = 0; i < 500; i++) { await api.step(); await sleep(1); if (api.session.queue.length && /Save your work now/.test(api.session.queue[0])) { api.save([{ path: 'index.html', data: Buffer.from('<h1>from the queue</h1>') }]); saved = true; return; } } } }, { taskMaxUsd: 2.05 });
    const row = await h.settle(h.go().id);
    assert.equal(row.status, 'failed'); assert.ok(saved); assert.match(String(fileIn(h, 'stuck', 'index.html')), /from the queue/);
    assert.match(row.result, /Stopped by the building/);
  });
});
