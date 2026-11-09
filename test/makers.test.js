// The maker flow: three taps to a building team, the passes the server runs, and Launch. Mock models throughout.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, claim, floorState, until, Client } from './helpers.js';
import { get, all, run } from '../server/db.js';
import { ideaCards, companyCards, surprise, fromWords, parseReport, decide, loadMakersConfig, starterFiles, buildBrief, testBrief, MAKER_TYPES } from '../server/makers.js';
import { checkSite } from '../server/launch-check.js';

const CFG = loadMakersConfig();
const rulesAll = (type, v = true) => Object.fromEntries(CFG.types[type].doneRules.map((r) => [r.id, v]));
const browserOnly = (type) => Object.fromEntries(CFG.types[type].doneRules.map((r) => [r.id, r.check === 'browser' || r.serious === 'major']));

describe('ideas', () => {
  test('three cards per type, each ready for Go, and games mix 2D and 3D', () => {
    for (const type of MAKER_TYPES) {
      const cards = ideaCards(type, { seed: 1 });
      assert.equal(cards.length, 3, type);
      assert.equal(new Set(cards.map((c) => c.id)).size, 3);
      for (const c of cards) { assert.ok(c.name && c.pitch && c.goal && c.plan.length >= 3, `${type} card is complete`); assert.equal(c.type, type); }
    }
    const games = ideaCards('game', { seed: 5 });
    assert.ok(games.some((c) => c.starter === 'game-2d') && games.some((c) => c.starter === 'game-3d'));
  });
  test('cards are tailored to what the company already is', () => {
    const bakery = { name: 'Night Owl Bakery', identity: JSON.stringify({ about: 'a late night bakery and cafe' }) };
    assert.equal(ideaCards('game', { floor: bakery, seed: 2 })[0].id, 'kitchen');
    assert.equal(ideaCards('website', { floor: bakery, seed: 2 })[0].id, 'bakery');
    const band = { name: 'Loud Moths', identity: JSON.stringify({ about: 'a band that plays gigs' }) };
    assert.equal(ideaCards('app', { floor: band, seed: 9 })[0].id, 'setlist');
  });
  test('"Surprise me" and the boss\'s own words both fill in name, goal and plan', () => {
    const s = surprise('app', { seed: 42 });
    assert.ok(s.name && s.goal && s.plan.length);
    const own = fromWords('game', 'a frog who delivers mail across a flying 3d swamp');
    assert.equal(own.name, 'Frog Delivers Mail'); assert.equal(own.starter, 'game-3d'); assert.match(own.pitch, /frog/);
    assert.equal(fromWords('game', 'tiny knights on a chessboard').starter, 'game-2d');
  });
});

describe('ideas fit the company', () => {
  const studio = { name: 'Neon Hive', identity: JSON.stringify({ about: 'a small studio that makes arcade games' }) };
  const made = [{ slug: 'neon-hive', title: 'Neon Hive', description: 'Defend a glowing hive from wasps.', kind: 'game', private: 0 }];
  test('a game studio asking for a website is offered a site for its game, not a band or a bakery', () => {
    for (const seed of [0, 1, 2, 3, 4]) {
      const cards = ideaCards('website', { floor: studio, projects: made, seed, rotate: seed });
      assert.equal(cards.length, 3);
      assert.ok(cards.every((c) => !['band', 'bakery', 'event', 'walker', 'repair'].includes(c.id)), cards.map((c) => c.id).join(','));
      assert.ok(cards.every((c) => /Neon Hive/.test(c.title) || /Neon Hive/.test(c.pitch)));
    }
    const first = ideaCards('website', { floor: studio, projects: made, seed: 7 })[0];
    assert.equal(first.title, 'Neon Hive site'); assert.equal(first.starter, 'website'); assert.match(first.pitch, /Defend a glowing hive/);
    const sur = surprise('website', { floor: studio, projects: made, seed: 3 });
    assert.match(sur.title, /Neon Hive/);
  });
  test('an app and a game use the name and what it makes too', () => {
    const apps = ideaCards('app', { floor: studio, projects: made, seed: 1 });
    assert.ok(apps.every((c) => /Neon Hive/.test(c.title) || /Neon Hive/.test(c.pitch)));
    const games = ideaCards('game', { floor: { name: 'Corner Clinic', identity: JSON.stringify({ about: 'a family dental clinic' }) }, projects: [], seed: 2 });
    assert.ok(games.some((c) => c.title === 'Corner Clinic: the game'));
    assert.ok(games.some((c) => c.starter === 'game-3d') && games.some((c) => c.starter === 'game-2d'));
  });
  test('a brand-new floor still gets the bank ideas', () => {
    assert.equal(companyCards('website', { floor: { name: '' }, projects: [] }).length, 0);
    assert.equal(ideaCards('website', { floor: { name: '' }, seed: 1 }).length, 3);
  });
});

describe('the Tester\'s report', () => {
  test('reads the office-verdict block, and a plain PASS or FAIL without one', () => {
    const r = parseReport('# Report\nfine\n```office-verdict\n{"verdict":"pass","rules":{"loads":true,"fps":null,"x y":true},"bugs":["a",{"severity":"blocker","text":"b"}],"regressions":["c"]}\n```');
    assert.equal(r.verdict, 'pass'); assert.deepEqual(r.rules, { loads: true, fps: null });
    assert.deepEqual(r.bugs.map((b) => b.severity), ['major', 'blocker']); assert.deepEqual(r.regressions, ['c']);
    assert.equal(parseReport('Verdict: FAIL').verdict, 'fail');
    assert.equal(parseReport('no idea'), null);
  });
});

describe('loop control', () => {
  const job = (o = {}) => ({ type: 'game', pass: 0, depth: 3, fails: 0, best: {}, launchable: false, tokens: 0, ...o });
  const test0 = (rules, extra = {}) => ({ step: 'test', ok: true, report: { verdict: 'pass', rules, bugs: [], regressions: [], ...extra } });
  test('a first version that passes the browser rules is launchable, and the next depth pass gets queued with what is unmet', () => {
    const d = decide(job(), test0(browserOnly('game')));
    assert.equal(d.action, 'build'); assert.equal(d.pass, 1); assert.equal(d.patch.launchable, true);
    assert.ok(d.unmet.some((u) => /3 distinct mechanics/.test(u)));
  });
  test('a job runs its minimum depth passes even when every done-rule already passes', () => {
    const early = decide(job(), test0(rulesAll('game')));
    assert.equal(early.action, 'build'); assert.equal(early.pass, 1); assert.equal(early.patch.launchable, true);
    assert.equal(decide(job({ pass: 2 }), test0(rulesAll('game'))).pass, 3);
    assert.equal(decide(job({ pass: 3 }), test0(rulesAll('game'))).action, 'ready');
    const site = { type: 'website', pass: 0, depth: 3, fails: 0, best: {}, launchable: false, tokens: 0 };
    assert.equal(decide(site, test0(rulesAll('website'))).action, 'build', 'a website gets its one polish pass');
    assert.equal(decide({ ...site, pass: 1 }, test0(rulesAll('website'))).action, 'ready');
    assert.equal(CFG.types.game.minDepthPasses, 3); assert.equal(CFG.types.app.minDepthPasses, 1); assert.equal(CFG.types.website.minDepthPasses, 1);
  });
  test('each game depth pass has its own job, and the brief names it', () => {
    assert.equal(CFG.types.game.passJobs.length, 3);
    for (const p of [1, 2, 3]) assert.ok(buildBrief({ type: 'game', title: 'T', depth: 3 }, p).includes(CFG.types.game.passJobs[p - 1].split(':')[0]));
    assert.match(testBrief({ type: 'game', title: 'T' }, 2, { computer: true }), /final boss/); assert.match(testBrief({ type: 'game', title: 'T' }, 0, { computer: true }), /debug copy/);
    assert.doesNotMatch(testBrief({ type: 'website', title: 'T' }, 1, { computer: true }), /final boss/);
  });
  test('the bug list feeds the next pass', () => {
    const d = decide(job(), { step: 'test', ok: true, report: { verdict: 'fail', rules: { ...browserOnly('game'), inputs: false }, bugs: [{ severity: 'major', text: 'Touch does nothing' }], regressions: [] } });
    assert.equal(d.action, 'build'); assert.equal(d.patch.launchable, false);
    assert.ok(d.bugs.some((b) => /Touch does nothing/.test(b.text))); assert.ok(d.bugs.some((b) => /Done-rule failing/.test(b.text)));
    const brief = buildBrief({ type: 'game', title: 'T', depth: 3 }, d.pass, d);
    assert.match(brief, /Touch does nothing/); assert.match(brief, /^\[Maker\] build 0/); assert.match(brief, /Fix pass/);
  });
  test('a regression blocks: it is not passing, it is a blocker, and the last good version stays the launch candidate', () => {
    const d = decide(job({ pass: 1, best: { inputs: true }, launchable: true, lastPassing: 0 }), test0({ ...browserOnly('game'), inputs: false }));
    assert.equal(d.passing, false); assert.equal(d.action, 'build');
    assert.ok(d.regressions.length); assert.ok(d.bugs[0].text.startsWith('Regression:')); assert.equal(d.patch.lastPassing, 0);
    const brief = buildBrief({ type: 'game', title: 'T', depth: 3 }, 2, d);
    assert.match(brief, /REGRESSIONS/);
  });
  test('a pass that fails twice asks the boss instead of looping', () => {
    const bad = { step: 'test', ok: true, report: { verdict: 'fail', rules: {}, bugs: [{ severity: 'blocker', text: 'x' }], regressions: [] } };
    const first = decide(job(), bad);
    assert.equal(first.action, 'build');
    const fix1 = decide(job({ ...first.patch }), bad);
    assert.equal(fix1.action, 'build', 'a first failed fix goes round again');
    assert.equal(decide(job({ ...fix1.patch }), bad).action, 'ask', 'two failed fixes ask the boss');
    const soft = { step: 'test', ok: true, report: { verdict: 'fail', rules: {}, bugs: [{ severity: 'minor', text: 'x' }], regressions: [] } };
    assert.equal(decide(job(), soft).pass, 0, 'a failed version is redone at the same pass');
    assert.equal(decide(job({ fails: 1 }), soft).action, 'ask', 'a pass that fails twice without a serious bug still asks');
    assert.equal(decide(job({ fails: 1 }), { step: 'build', ok: false }).action, 'ask');
    assert.equal(decide(job(), { step: 'build', ok: false }).action, 'build');
    assert.equal(decide(job({ fails: 1 }), { step: 'test', ok: false }).action, 'ask');
  });
  test('an open major bug holds Launch, a fix pass follows, and two failed fixes ask the boss', () => {
    const report = (o = {}) => ({ step: 'test', ok: true, report: { verdict: 'pass', rules: browserOnly('game'), bugs: [{ severity: 'major', text: 'A ?wave=9 link cheats the board' }], regressions: [], ...o } });
    const first = decide(job(), report());
    assert.equal(first.action, 'build'); assert.equal(first.pass, 0, 'no depth pass used'); assert.equal(first.fix, true); assert.ok(first.patch.held.some((b) => /cheats/.test(b.text))); assert.equal(first.patch.launchable, true); assert.equal(first.passing, true); assert.equal(first.clean, false);
    const second = decide(job({ ...first.patch }), report());
    assert.equal(second.action, 'build'); assert.equal(second.patch.fixTries, 1); assert.ok(second.patch.held);
    const third = decide(job({ ...second.patch }), report());
    assert.equal(third.action, 'ask'); assert.match(third.why, /tried 2 times/);
    const fixed = decide(job({ ...second.patch }), test0(browserOnly('game')));
    assert.equal(fixed.action, 'build'); assert.equal(fixed.pass, 1); assert.equal(fixed.patch.held, null); assert.equal(fixed.clean, true); assert.equal(fixed.patch.fixTries, 0);
    const cheatRule = decide(job(), test0({ ...browserOnly('game'), nocheats: false }));
    assert.equal(cheatRule.fix, true, 'a cheat left in the build is a major bug even if the Tester forgot to list it');
    assert.ok(cheatRule.bugs.some((b) => b.severity === 'major' && /cheat/.test(b.text)));
    const tokenCap = { ...CFG, passes: { ...CFG.passes, maxJobTokens: 1000 } };
    assert.equal(decide(job({ tokens: 1000 }), report(), tokenCap).action, 'ask', 'out of work with a serious bug open is the boss\'s call');
  });
  test('the brief for a fix pass lists the bugs and the re-test checks them', () => {
    const d = decide(job(), { step: 'test', ok: true, report: { verdict: 'pass', rules: browserOnly('game'), bugs: [{ severity: 'major', text: 'Save is lost on reload' }], regressions: [] } });
    const b = buildBrief({ type: 'game', title: 'T', depth: 3 }, d.pass, d);
    assert.match(b, /Fix pass on T/); assert.match(b, /\[major\] Save is lost/); assert.match(b, /debug hook/);
    assert.match(testBrief({ type: 'game', title: 'T' }, 0, { computer: true, recheck: d.serious }), /tried to fix these[\s\S]*Save is lost/);
  });
  test('passes and tokens are capped', () => {
    assert.equal(decide(job({ pass: 3, launchable: true }), test0(browserOnly('game'))).action, 'ready');
    assert.equal(decide(job({ depth: 0 }), test0(browserOnly('game'))).action, 'ready');
    assert.equal(CFG.passes.maxJobTokens, 0, 'no job is stopped at a count of tokens by default');
    assert.equal(decide(job({ tokens: 1e12 }), test0(browserOnly('game'))).action, 'build', 'and a very long job carries on');
    const tokenCap = { ...CFG, passes: { ...CFG.passes, maxJobTokens: 1000 } };
    assert.equal(decide(job({ tokens: 1000 }), test0(browserOnly('game')), tokenCap).action, 'ready');
    assert.equal(decide(job({ tokens: 1000 }), { step: 'test', ok: true, report: { verdict: 'fail', rules: {}, bugs: [], regressions: [] } }, tokenCap).action, 'ask');
    assert.equal(decide(job({ depth: 9 }), test0(browserOnly('game'))).pass, 1);
  });
  test('the Tester\'s brief holds the verdict template, the done-rules and the quality bars from config', () => {
    const b = testBrief({ type: 'game', title: 'T' }, 0, { computer: true });
    assert.match(b, /office-verdict/); assert.match(b, /playtest\.mjs/); assert.match(b, /nosoftlock/); assert.match(b, /softlockSeconds 60/);
    assert.match(testBrief({ type: 'app', title: 'T' }, 1, { computer: false }), /no browser here/);
  });
});

describe('starters', () => {
  test('every starter passes the pre-publish checklist with no errors or invented claims', () => {
    for (const name of ['game-2d', 'game-3d', 'app', 'website']) {
      const files = starterFiles(name).map((f) => ({ path: f.path, data: f.data.replaceAll('{{TITLE}}', 'Moth Run').replaceAll('{{PITCH}}', 'Dodge the moths and keep the lamp lit all night.') }));
      assert.ok(files.some((f) => f.path === 'index.html') && files.some((f) => f.path === 'STARTER.md'), name);
      const r = checkSite({ files, kind: name.startsWith('game') ? 'game' : 'site' });
      assert.deepEqual(r.errors, [], `${name}: ${r.errors.join('; ')}`); assert.deepEqual(r.claims, [], `${name}: ${r.claims.join('; ')}`);
      for (const p of ['page title', 'search description', 'works on phones (viewport)', 'social preview text', 'favicon']) assert.ok(r.passed.includes(p), `${name}: ${p}`);
    }
  });
});

describe('three taps to a team that is building, then Launch', () => {
  let t, c;
  before(async () => { t = await boot({ maxRevisions: 2 }); c = await claim(t); });
  after(() => t.close());
  const fid = () => get(t.db, 'SELECT id FROM floors WHERE slug=?', c.slug).id;
  const job = () => get(t.db, 'SELECT * FROM maker_jobs WHERE floor_id=? ORDER BY id DESC LIMIT 1', fid());

  test('only the boss sees ideas or can start one, and bad input changes nothing', async () => {
    const visitor = new Client(t);
    assert.equal((await visitor.get(`/api/floors/${c.slug}/makers/ideas?type=game`)).status >= 400, true);
    assert.equal((await c.get(`/api/floors/${c.slug}/makers/ideas?type=nope`)).status, 400);
    assert.equal((await visitor.post(`/api/floors/${c.slug}/makers/start`, { type: 'game', name: 'x' })).status >= 400, true);
    assert.equal((await c.post(`/api/floors/${c.slug}/makers/start`, { type: 'business' })).status, 400);
    assert.equal((await c.post(`/api/floors/${c.slug}/makers/launch`, {})).status, 400);
    assert.equal(get(t.db, 'SELECT COUNT(*) n FROM tasks WHERE floor_id=?', fid()).n, 0);
  });

  test('pick a type, a card, Go: the plan is on the board at once with the starter in the project, and no manager call was needed', async () => {
    const ideas = await c.get(`/api/floors/${c.slug}/makers/ideas?type=game`);
    assert.equal(ideas.status, 200); assert.equal(ideas.data.cards.length, 3); assert.ok(ideas.data.surprise.name);
    const card = ideas.data.cards.find((x) => x.starter === 'game-2d') || ideas.data.cards[0];
    const r = await c.post(`/api/floors/${c.slug}/makers/start`, { type: 'game', idea: card.id, name: card.name, pitch: card.pitch, goal: card.goal, plan: card.plan, starter: 'game-2d' });
    assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.makers.job.stage, 'doc');
    const tasks = all(t.db, 'SELECT t.title, a.role FROM tasks t JOIN agents a ON a.id=t.agent_id WHERE t.floor_id=? ORDER BY t.id', fid());
    assert.deepEqual(tasks.map((x) => x.role), ['designer', 'builder', 'tester']);
    const files = all(t.db, 'SELECT path FROM files WHERE floor_id=? AND path LIKE ?', fid(), `projects/${job().project}/%`).map((f) => f.path.split('/').slice(2).join('/'));
    for (const f of ['index.html', 'game.js', 'kit.js', 'kit.css', 'STARTER.md']) assert.ok(files.includes(f), f);
    assert.ok(!get(t.db, 'SELECT content FROM files WHERE floor_id=? AND path=?', fid(), `projects/${job().project}/index.html`).content.includes('{{TITLE}}'));
    assert.equal((await c.post(`/api/floors/${c.slug}/makers/start`, { type: 'app', name: 'Another' })).status, 400, 'one job at a time');
  });

  test('the passes run on their own: first version passes, a depth pass meets the rest, it stops early and offers Launch', async () => {
    const s = await until(async () => { const st = await floorState(c); return st.makers?.job?.stage === 'ready' ? st : null; }, { what: 'job ready', timeout: 20000 });
    const j = s.makers.job;
    assert.equal(j.launchable, true); assert.equal(j.launched, false); assert.equal(j.pass, 3, 'all three depth passes ran');
    for (const p of [1, 2, 3]) assert.ok(j.steps.some((x) => x.label === `Depth pass ${p}` && x.state === 'done'), `depth pass ${p} shows done`);
    assert.equal(get(t.db, "SELECT COUNT(*) n FROM tasks WHERE floor_id=? AND status IN ('todo','doing','review')", fid()).n, 0);
    assert.ok(s.messages.some((m) => m.role === 'manager' && /passed the Tester/.test(m.text)));
    assert.equal(get(t.db, 'SELECT published_at p FROM projects WHERE floor_id=? AND slug=?', fid(), j.project).p, null, 'nothing is live before Launch');
    assert.ok(!t.app.engine.unpublishedWork(fid()).some((p) => p.slug === j.project), 'the manager is not told to publish it behind the boss\'s back');
  });

  test('Launch publishes the tested version and gives a share link', async () => {
    const r = await c.post(`/api/floors/${c.slug}/makers/launch`, {});
    assert.equal(r.status, 200, JSON.stringify(r.data)); assert.match(r.data.url, new RegExp(`/f/${c.slug}/`)); assert.equal(r.data.makers.job.launched, true);
    const pub = all(t.db, 'SELECT path FROM published_files WHERE floor_id=? AND project=?', fid(), job().project).map((x) => x.path);
    assert.ok(pub.includes('index.html') && pub.includes('game.js')); assert.ok(!pub.includes('TEST-REPORT.md') && !pub.some((p) => p.startsWith('notes/')));
    const page = await fetch(`${t.base}/f/${c.slug}/${job().project}/`);
    assert.equal(page.status, 200);
    const lib = await fetch(`${t.base}/f/${c.slug}/${job().project}/_office/phaser.min.js`);
    assert.equal(lib.status, 200); assert.ok((await lib.text()).length > 500000);
  });
});

describe('a floor with no company yet', () => {
  let t, c;
  before(async () => { t = await boot(); c = await claim(t, 'Soon Named'); });
  after(() => t.close());
  test('is named after what it is making, and the app starter goes in', async () => {
    const fid = get(t.db, 'SELECT id FROM floors WHERE slug=?', c.slug).id;
    t.db.prepare("UPDATE floors SET name='' WHERE id=?").run(fid);
    const r = await c.post(`/api/floors/${c.slug}/makers/start`, { type: 'app', name: 'Shift Swap', pitch: 'Teammates swap shifts in a tap.' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(get(t.db, 'SELECT name FROM floors WHERE id=?', fid).name, 'Shift Swap');
    const files = all(t.db, 'SELECT path FROM files WHERE floor_id=? AND path LIKE ?', fid, 'projects/shift-swap/%').map((f) => f.path);
    assert.ok(files.includes('projects/shift-swap/app.js') && files.includes('projects/shift-swap/STARTER.md'));
    const roles = all(t.db, 'SELECT a.role FROM tasks t JOIN agents a ON a.id=t.agent_id WHERE t.floor_id=? ORDER BY t.id', fid).map((x) => x.role);
    assert.deepEqual(roles.slice(0, 3), ['writer', 'builder', 'tester']);
  });
});

describe('work stopped from outside the loop', () => {
  let t, c;
  before(async () => { t = await boot(); c = await claim(t, 'Stop Start'); });
  after(() => t.close());
  test('"Stop all" mid-job turns into a question, and Try again starts over from the design doc', async () => {
    const fid = get(t.db, 'SELECT id FROM floors WHERE slug=?', c.slug).id;
    t.app.engine.setGlobalPause(true);
    assert.equal((await c.post(`/api/floors/${c.slug}/makers/start`, { type: 'game', name: 'Halted', pitch: 'A game that gets stopped.' })).status, 200);
    t.app.engine.cancelOpen(fid);
    const s = await floorState(c);
    assert.equal(s.makers.job.stage, 'asking'); assert.match(s.makers.job.asking.why, /stopped/);
    t.app.engine.setGlobalPause(false);
    const r = await c.post(`/api/floors/${c.slug}/makers/decide`, { choice: 'retry' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const done = await until(async () => { const st = await floorState(c); return st.makers?.job?.stage === 'ready' ? st : null; }, { what: 'ready after retry', timeout: 20000 });
    assert.equal(done.makers.job.launchable, true);
  });
});

describe('a job that keeps failing asks the boss, and the boss decides', () => {
  let t, c;
  before(async () => { t = await boot(); c = await claim(t, 'Broken Co'); });
  after(() => t.close());
  test('two failing passes, then a question with buttons instead of a loop', async () => {
    const r = await c.post(`/api/floors/${c.slug}/makers/start`, { type: 'website', name: 'Shop Front', pitch: 'A bike stand site [broken]' });
    assert.equal(r.status, 200);
    const s = await until(async () => { const st = await floorState(c); return st.makers?.job?.stage === 'asking' ? st : null; }, { what: 'asking', timeout: 20000 });
    assert.equal(s.makers.job.asking.canLaunch, false);
    assert.ok(s.messages.some((m) => /serious bug/.test(m.text) && /Keep trying/.test(m.text)));
    const fid = get(t.db, 'SELECT id FROM floors WHERE slug=?', c.slug).id;
    assert.equal(get(t.db, "SELECT COUNT(*) n FROM tasks t JOIN agents a ON a.id=t.agent_id WHERE t.floor_id=? AND a.role='tester'", fid).n, 3, 'it stopped after the first try and two failed fixes');
    const stop = await c.post(`/api/floors/${c.slug}/makers/decide`, { choice: 'stop' });
    assert.equal(stop.status, 200); assert.equal(stop.data.makers.job.stage, 'stopped');
    assert.equal((await c.post(`/api/floors/${c.slug}/makers/decide`, { choice: 'retry' })).status, 400);
  });
});

describe('a serious bug holds Launch', () => {
  let t, c;
  before(async () => { t = await boot(); c = await claim(t, 'Cheat Co'); });
  after(() => t.close());
  const job = async () => (await floorState(c)).makers.job;
  const fid = () => get(t.db, 'SELECT id FROM floors WHERE slug=?', c.slug).id;
  const testers = () => get(t.db, "SELECT COUNT(*) n FROM tasks t JOIN agents a ON a.id=t.agent_id WHERE t.floor_id=? AND a.role='tester'", fid()).n;

  test('a cheat that stays through two fixes reaches the boss, who can keep trying or launch anyway, and Launch alone is refused', async () => {
    assert.equal((await c.post(`/api/floors/${c.slug}/makers/start`, { type: 'game', name: 'Hive Cheat', pitch: 'Bugs versus bees [cheat]' })).status, 200);
    let j = await until(async () => { const v = await job(); return v?.stage === 'asking' ? v : null; }, { what: 'asking', timeout: 20000 });
    assert.equal(testers(), 3, 'the first test and two failed fixes');
    assert.equal(j.launchable, false, 'no plain Launch while it is held');
    assert.equal(j.asking.held, true); assert.equal(j.asking.canLaunch, true); assert.ok(j.asking.flaws.some((b) => /wave=9/.test(b)));
    const refused = await c.post(`/api/floors/${c.slug}/makers/launch`, {});
    assert.equal(refused.status, 400); assert.match(refused.data.message || refused.data.error || JSON.stringify(refused.data), /serious bug/);
    assert.equal(get(t.db, 'SELECT published_at p FROM projects WHERE floor_id=? AND slug=?', fid(), j.project).p, null, 'nothing went live');
    // Keep trying goes round again.
    assert.equal((await c.post(`/api/floors/${c.slug}/makers/decide`, { choice: 'retry' })).status, 200);
    j = await until(async () => { const v = await job(); return v?.stage === 'asking' ? v : null; }, { what: 'asking again', timeout: 20000 });
    assert.equal(testers(), 5, 'two more fix attempts');
    // Launch anyway, with the warning kept on the card.
    const went = await c.post(`/api/floors/${c.slug}/makers/launch`, { anyway: true });
    assert.equal(went.status, 200, JSON.stringify(went.data));
    assert.equal(went.data.makers.job.launched, true); assert.ok(went.data.makers.job.launchedWith.some((b) => /wave=9/.test(b)));
    const s = await floorState(c);
    assert.ok(s.messages.some((m) => /known serious bug/.test(m.text)));
  });

  test('a job can\'t launch anyway unless the boss was asked', async () => {
    const d = await boot(); const co = await claim(d, 'Other Co');
    await co.post(`/api/floors/${co.slug}/makers/start`, { type: 'website', name: 'Plain Site', pitch: 'A plain site' });
    assert.equal((await co.post(`/api/floors/${co.slug}/makers/launch`, { anyway: true })).status, 400, 'no version has passed yet');
    await d.close();
  });
});

describe('a major bug found once is fixed before Launch comes back', () => {
  let t, c;
  before(async () => { t = await boot(); c = await claim(t, 'Fix Co'); });
  after(() => t.close());
  test('the fix pass uses no depth pass, and all three still run', async () => {
    assert.equal((await c.post(`/api/floors/${c.slug}/makers/start`, { type: 'game', name: 'Once Bug', pitch: 'Mostly fine [major-once]' })).status, 200);
    const j = await until(async () => { const s = await floorState(c); return s.makers?.job?.stage === 'ready' ? s.makers.job : null; }, { what: 'ready', timeout: 30000 });
    assert.equal(j.pass, 3); assert.equal(j.launchable, true); assert.equal(j.held, null);
    const fid = get(t.db, 'SELECT id FROM floors WHERE slug=?', c.slug).id;
    assert.equal(get(t.db, "SELECT COUNT(*) n FROM tasks WHERE floor_id=? AND title LIKE 'Fix the serious bugs%'", fid).n, 1);
    assert.equal(get(t.db, "SELECT COUNT(*) n FROM tasks t JOIN agents a ON a.id=t.agent_id WHERE t.floor_id=? AND a.role='tester'", fid).n, 5, 'first test, re-test, three depth passes');
    assert.equal((await c.post(`/api/floors/${c.slug}/makers/launch`, {})).status, 200);
  });
});

describe('a test of files the Tester has already been through is not run again', () => {
  let t, c;
  before(async () => { t = await boot(); c = await claim(t, 'Idle Co'); });
  after(() => t.close());
  test('a pass whose build changed nothing live gets the last report back, and the loop carries on from it', async () => {
    assert.equal((await c.post(`/api/floors/${c.slug}/makers/start`, { type: 'game', name: 'Still Hive', pitch: 'Bugs versus bees [idle]' })).status, 200);
    const j = await until(async () => { const s = await floorState(c); return s.makers?.job?.stage === 'ready' ? s.makers.job : null; }, { what: 'ready', timeout: 30000 });
    const fid = get(t.db, 'SELECT id FROM floors WHERE slug=?', c.slug).id;
    const tests = all(t.db, "SELECT t.id, t.title, t.status, t.result, t.cost_usd, m.pass FROM tasks t JOIN maker_tasks m ON m.task_id=t.id WHERE t.floor_id=? AND m.step='test' ORDER BY t.id", fid);
    assert.deepEqual(tests.map((x) => x.pass), [0, 1, 2, 3], 'every pass still has its test on the board');
    assert.ok(tests.every((x) => x.status === 'done'));
    // Only the first one was played. The Builder's depth passes changed nothing that goes live, so the others had nothing new to test.
    assert.ok(tests[0].cost_usd > 0); assert.doesNotMatch(tests[0].result, /has changed since the last test/);
    for (const x of tests.slice(1)) { assert.equal(x.cost_usd, 0, `pass ${x.pass} cost nothing`); assert.match(x.result, /Nothing that goes live in Still Hive has changed since the last test/); }
    const tester = get(t.db, "SELECT id FROM agents WHERE floor_id=? AND role='tester'", fid).id;
    const first = get(t.db, "SELECT COUNT(*) n FROM ledger WHERE floor_id=? AND agent_id=? AND kind='model'", fid, tester).n;
    assert.ok(first > 0);
    assert.equal(get(t.db, "SELECT COUNT(*) n FROM ledger l WHERE l.floor_id=? AND l.agent_id=? AND l.kind='model' AND l.created_at>(SELECT updated_at FROM tasks WHERE id=?)", fid, tester, tests[0].id).n, 0, 'the Tester\'s model was never called again');
    // The verdict it stands on is the one the Tester really gave: a pass, so the job is launchable, with the same rules still unmet.
    assert.equal(j.launchable, true); assert.equal(j.pass, 3); assert.equal(j.report.verdict, 'pass');
    assert.equal((await c.post(`/api/floors/${c.slug}/makers/launch`, {})).status, 200);
  });
  test('a version that did change is always played, and so is one the live check has found a problem in', async () => {
    const d = await boot(); const co = await claim(d, 'Busy Co');
    try {
      assert.equal((await co.post(`/api/floors/${co.slug}/makers/start`, { type: 'game', name: 'Busy Hive', pitch: 'Bugs versus bees' })).status, 200);
      await until(async () => { const s = await floorState(co); return s.makers?.job?.stage === 'ready'; }, { what: 'ready', timeout: 30000 });
      const fid = get(d.db, 'SELECT id FROM floors WHERE slug=?', co.slug).id;
      const tests = all(d.db, "SELECT t.result, t.cost_usd FROM tasks t JOIN maker_tasks m ON m.task_id=t.id WHERE t.floor_id=? AND m.step='test'", fid);
      assert.ok(tests.length >= 2 && tests.every((x) => x.cost_usd > 0 && !/has changed since the last test/.test(x.result)), 'every changed version was really tested');
      // The hook itself: same files as tested, so the report would stand, unless the live link check has found something the report never saw.
      const job = get(d.db, 'SELECT * FROM maker_jobs WHERE floor_id=?', fid);
      const floor = get(d.db, 'SELECT * FROM floors WHERE id=?', fid);
      const { id } = d.app.engine.assignTask(floor, get(d.db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", fid), { to: 'tester', title: 'Play-test again', brief: 'x', plan: '', project: job.project, dependsOn: [] });
      d.app.engine.cancelTask(floor, id);
      run(d.db, "UPDATE maker_jobs SET stage='test' WHERE id=?", job.id);
      run(d.db, 'INSERT INTO maker_tasks (task_id, job_id, step, pass) VALUES (?,?,?,?)', id, job.id, 'test', job.pass);
      assert.match(d.app.engine.makers.sameAsTested(floor, { id }), /office-verdict/);
      const st = JSON.parse(job.state);
      run(d.db, 'UPDATE maker_jobs SET state=? WHERE id=?', JSON.stringify({ ...st, liveBugs: [{ severity: 'major', text: 'The live link check failed: blank page' }] }), job.id);
      assert.equal(d.app.engine.makers.sameAsTested(floor, { id }), null, 'a live problem is new, so it is tested for real');
      run(d.db, 'UPDATE maker_jobs SET state=? WHERE id=?', JSON.stringify(st), job.id);
      run(d.db, "UPDATE files SET content=content || ' ', size=size+1, updated_at=updated_at+1 WHERE floor_id=? AND path=?", fid, `projects/${job.project}/build.js`);
      assert.equal(d.app.engine.makers.sameAsTested(floor, { id }), null, 'one byte different is a different version');
      // A file that never goes live does not make it a new version.
      run(d.db, "UPDATE files SET content=?, size=size-1, updated_at=updated_at+1 WHERE floor_id=? AND path=?", st.tested ? get(d.db, 'SELECT content c FROM files WHERE floor_id=? AND path=?', fid, `projects/${job.project}/build.js`).c.slice(0, -1) : '', fid, `projects/${job.project}/build.js`);
      run(d.db, "UPDATE files SET content=content || 'more notes', size=size+10, updated_at=updated_at+5 WHERE floor_id=? AND path LIKE ?", fid, `projects/${job.project}/notes/%`);
      assert.match(d.app.engine.makers.sameAsTested(floor, { id }), /office-verdict/);
    } finally { await d.close(); }
  });
});

describe('the job card is honest about passes', () => {
  let t, c;
  before(async () => { t = await boot(); c = await claim(t, 'Site Co'); });
  after(() => t.close());
  test('a website that finished after its one polish pass shows the other passes skipped, not unticked', async () => {
    assert.equal((await c.post(`/api/floors/${c.slug}/makers/start`, { type: 'website', name: 'Full Site', pitch: 'A complete site [full]' })).status, 200);
    const j = await until(async () => { const s = await floorState(c); return s.makers?.job?.stage === 'ready' ? s.makers.job : null; }, { what: 'ready', timeout: 20000 });
    const pass = (n) => j.steps.find((x) => x.label === `Polish pass ${n}`);
    assert.equal(pass(1).state, 'done'); assert.equal(pass(2).state, 'skipped'); assert.equal(pass(3).state, 'skipped');
    assert.ok(j.steps.every((x) => x.state !== 'todo' && x.state !== 'doing'), 'nothing is left looking like it might still happen');
  });
});

describe('the two plain pages', () => {
  let t;
  before(async () => { t = await boot(); });
  after(() => t.close());
  test('about and privacy are served, honest and contactable, and the lobby links them', async () => {
    for (const [path, want] of [['/privacy', /office@iscolinfree\.com/], ['/about', /office@iscolinfree\.com/]]) {
      const r = await fetch(`${t.base}${path}`);
      assert.equal(r.status, 200, path);
      assert.match(r.headers.get('content-type') || '', /text\/html/);
      const html = await r.text();
      assert.match(html, want); assert.ok(!/\$\d/.test(html), 'no money figures');
    }
    const privacy = await (await fetch(`${t.base}/privacy`)).text();
    assert.match(privacy, /Limited Use/); assert.match(privacy, /Anthropic and OpenRouter/);
  });
});
