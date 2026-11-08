// The maker flow: three taps to a building team, the passes the server runs, and Launch. Mock models throughout.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, claim, floorState, until, Client } from './helpers.js';
import { get, all } from '../server/db.js';
import { ideaCards, surprise, fromWords, parseReport, decide, loadMakersConfig, starterFiles, buildBrief, testBrief, MAKER_TYPES } from '../server/makers.js';
import { checkSite } from '../server/launch-check.js';

const CFG = loadMakersConfig();
const rulesAll = (type, v = true) => Object.fromEntries(CFG.types[type].doneRules.map((r) => [r.id, v]));
const browserOnly = (type) => Object.fromEntries(CFG.types[type].doneRules.map((r) => [r.id, r.check === 'browser']));

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
  test('it stops early once every done-rule passes', () => {
    const d = decide(job(), test0(rulesAll('game')));
    assert.equal(d.action, 'ready'); assert.equal(d.patch.launchable, true);
  });
  test('the bug list feeds the next pass', () => {
    const d = decide(job(), { step: 'test', ok: true, report: { verdict: 'fail', rules: { ...browserOnly('game'), inputs: false }, bugs: [{ severity: 'major', text: 'Touch does nothing' }], regressions: [] } });
    assert.equal(d.action, 'build'); assert.equal(d.patch.launchable, false);
    assert.ok(d.bugs.some((b) => /Touch does nothing/.test(b.text))); assert.ok(d.bugs.some((b) => /Done-rule failing/.test(b.text)));
    const brief = buildBrief({ type: 'game', title: 'T', depth: 3 }, d.pass, d);
    assert.match(brief, /Touch does nothing/); assert.match(brief, /^\[Maker\] build 1/);
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
    assert.equal(decide(job({ pass: 1, ...first.patch }), bad).action, 'ask');
    assert.equal(decide(job({ fails: 1 }), { step: 'build', ok: false }).action, 'ask');
    assert.equal(decide(job(), { step: 'build', ok: false }).action, 'build');
    assert.equal(decide(job({ fails: 1 }), { step: 'test', ok: false }).action, 'ask');
  });
  test('passes and tokens are capped', () => {
    assert.equal(decide(job({ pass: 3, launchable: true }), test0(browserOnly('game'))).action, 'ready');
    assert.equal(decide(job({ depth: 0 }), test0(browserOnly('game'))).action, 'ready');
    assert.equal(decide(job({ tokens: CFG.passes.maxJobTokens }), test0(browserOnly('game'))).action, 'ready');
    assert.equal(decide(job({ tokens: CFG.passes.maxJobTokens }), { step: 'test', ok: true, report: { verdict: 'fail', rules: {}, bugs: [], regressions: [] } }).action, 'ask');
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
    assert.equal(j.launchable, true); assert.equal(j.launched, false); assert.equal(j.pass, 1, 'stopped after one depth pass, not three');
    assert.ok(j.steps.some((x) => x.label === 'Depth pass 1' && x.state === 'done'));
    assert.equal(get(t.db, "SELECT COUNT(*) n FROM tasks WHERE floor_id=? AND status IN ('todo','doing','review')", fid()).n, 0);
    assert.ok(s.messages.some((m) => m.role === 'manager' && /passed the Tester/.test(m.text)));
    assert.equal(get(t.db, 'SELECT published_at p FROM projects WHERE floor_id=? AND slug=?', fid(), j.project).p, null, 'nothing is live before Launch');
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

describe('a job that keeps failing asks the boss, and the boss decides', () => {
  let t, c;
  before(async () => { t = await boot(); c = await claim(t, 'Broken Co'); });
  after(() => t.close());
  test('two failing passes, then a question with buttons instead of a loop', async () => {
    const r = await c.post(`/api/floors/${c.slug}/makers/start`, { type: 'website', name: 'Shop Front', pitch: 'A bike stand site [broken]' });
    assert.equal(r.status, 200);
    const s = await until(async () => { const st = await floorState(c); return st.makers?.job?.stage === 'asking' ? st : null; }, { what: 'asking', timeout: 20000 });
    assert.equal(s.makers.job.asking.canLaunch, false);
    assert.ok(s.messages.some((m) => /stuck/.test(m.text) && /Try again/.test(m.text)));
    const fid = get(t.db, 'SELECT id FROM floors WHERE slug=?', c.slug).id;
    assert.equal(get(t.db, "SELECT COUNT(*) n FROM tasks t JOIN agents a ON a.id=t.agent_id WHERE t.floor_id=? AND a.role='tester'", fid).n, 2, 'it stopped after two tries');
    const stop = await c.post(`/api/floors/${c.slug}/makers/decide`, { choice: 'stop' });
    assert.equal(stop.status, 200); assert.equal(stop.data.makers.job.stage, 'stopped');
    assert.equal((await c.post(`/api/floors/${c.slug}/makers/decide`, { choice: 'retry' })).status, 400);
  });
});
