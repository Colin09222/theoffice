// Round 2, lane A: launch quality (docs/redesign/OFFICE-ANSWERS-2.md, Q11, Q23, Q8, Q10). The checklist is plain code, run here on made-up sites
// and on a real maker job in mock mode.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, claim, floorState, until } from './helpers.js';
import { get, all, run } from '../server/db.js';
import { runChecklist, CHECKS } from '../server/checklist.js';

const GOOD = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tyres</title><meta property="og:title" content="Tyres"><meta name="description" content="Tyres fitted today"><meta property="og:image" content="https://x.io/card.png">
<link rel="icon" href="favicon.svg"><link rel="stylesheet" href="style.css"></head>
<body><a href="about.html">About</a> <a href="https://example.org/">Partner</a> <img src="logo.png" alt="">
<form id="f"><input name="email"><button>Join</button></form><script src="app.js"></script></body></html>`;
const files = (over = {}) => Object.entries({ 'index.html': GOOD, 'about.html': '<p>About</p>', 'style.css': 'body{max-width:100%}', 'logo.png': 'x', 'favicon.svg': '<svg/>', 'app.js': "fetch('_data/v1/form/waitlist', { method: 'POST' })", '404.html': 'Not here', ...over }).filter(([, v]) => v !== null).map(([path, data]) => ({ path, data }));
const ok = async () => ({ ok: true, status: 200 });
const by = (r) => Object.fromEntries(r.checks.map((c) => [c.id, c.ok]));

describe('r2-j57 launch checklist', () => {
  test('eight checks by code; a good site passes all eight', async () => {
    assert.deepEqual(CHECKS.map((c) => c[0]), ['speed', 'fits', 'links', 'form', 'preview', 'icon', 'notfound', 'https']);
    assert.deepEqual(CHECKS.filter((c) => c[2]).map((c) => c[0]), ['links', 'form', 'https'], 'exactly three block');
    const r = await runChecklist({ files: files(), liveUrl: 'https://tyres.example/', fetchUrl: ok, formTest: async () => true });
    assert.equal(r.passed, 8, JSON.stringify(r.checks.filter((c) => !c.ok)));
    assert.deepEqual(r.blocked, []); assert.deepEqual(r.warnings, []);
  });
  test('the three that block: no HTTPS, a broken form, a broken link on the main page', async () => {
    const http = await runChecklist({ files: files(), liveUrl: 'http://tyres.example/', fetchUrl: ok, formTest: async () => true });
    assert.deepEqual(http.blocked, ['https']);
    const local = await runChecklist({ files: files(), liveUrl: 'http://localhost:8080/theoffice/f/a/b/', fetchUrl: ok, formTest: async () => true });
    assert.deepEqual(local.blocked, [], 'a building on localhost is not held for HTTPS');
    const formNowhere = await runChecklist({ files: files({ 'app.js': '// nothing' }), liveUrl: 'https://t.example/', fetchUrl: ok, formTest: async () => true });
    assert.deepEqual(formNowhere.blocked, ['form']);
    const formLost = await runChecklist({ files: files(), liveUrl: 'https://t.example/', fetchUrl: ok, formTest: async () => false });
    assert.deepEqual(formLost.blocked, ['form'], 'the test entry did not arrive');
    const ownLink = await runChecklist({ files: files({ 'about.html': null }), liveUrl: 'https://t.example/', fetchUrl: ok, formTest: async () => true });
    assert.deepEqual(ownLink.blocked, ['links']); assert.match(ownLink.checks.find((c) => c.id === 'links').note, /about\.html/);
    const away = await runChecklist({ files: files(), liveUrl: 'https://t.example/', fetchUrl: async (u) => ({ ok: !u.includes('example.org') }), formTest: async () => true });
    assert.deepEqual(away.blocked, ['links'], 'a dead link to another site');
    const building = await runChecklist({ files: files({ 'index.html': GOOD.replace('</body>', '<script src="_office/phaser.min.js"></script><a href="_office/pay">Pay</a></body>') }), liveUrl: 'https://t.example/', fetchUrl: ok, formTest: async () => true });
    assert.deepEqual(building.blocked, [], 'what the building serves itself is not broken');
  });
  test('the five warnings: slow on a phone, does not fit, no preview tags, no icon, no 404 page', async () => {
    const heavy = 'x'.repeat(900 * 1024);
    const r = await runChecklist({ files: files({ 'app.js': `fetch('_data/v1/form/waitlist');/*${heavy}*/`, 'style.css': '.page{width:1200px}', 'favicon.svg': null, '404.html': null, 'index.html': GOOD.replace(/<meta property="og:[^>]+>/g, '').replace('<link rel="icon" href="favicon.svg">', '').replace(/<meta name="viewport"[^>]+>/, '') }), liveUrl: 'https://t.example/', fetchUrl: ok, formTest: async () => true });
    assert.deepEqual(r.blocked, []);
    assert.deepEqual(r.warnings.sort(), ['fits', 'icon', 'notfound', 'preview', 'speed']);
    assert.match(r.checks.find((c) => c.id === 'speed').note, /s on a slow phone connection/);
  });
  test('no form at all is fine', async () => {
    const r = await runChecklist({ files: files({ 'index.html': GOOD.replace(/<form[\s\S]*?<\/form>/, '') }), liveUrl: 'https://t.example/', fetchUrl: ok, formTest: async () => false });
    assert.equal(by(r).form, true);
  });

  let t, c;
  before(async () => { t = await boot({ maxRevisions: 2, checklistFetch: ok }); c = await claim(t, 'Tyre Launch'); });
  after(() => t.close());
  const fid = () => get(t.db, 'SELECT id FROM floors WHERE slug=?', c.slug).id;
  const job = () => get(t.db, 'SELECT * FROM maker_jobs WHERE floor_id=? ORDER BY id DESC LIMIT 1', fid());
  const page = () => `projects/${job().project}/index.html`;
  test('DONE MEANS: Launch is blocked on a test site with a broken form and allowed once it is fixed; work in progress still publishes', async () => {
    const ideas = await c.get(`/api/floors/${c.slug}/makers/ideas?type=game`);
    const card = ideas.data.cards.find((x) => x.starter === 'game-2d') || ideas.data.cards[0];
    assert.equal((await c.post(`/api/floors/${c.slug}/makers/start`, { type: 'game', idea: card.id, name: card.name, pitch: card.pitch, goal: card.goal, plan: card.plan, starter: 'game-2d' })).status, 200);
    await until(async () => ((await floorState(c)).makers?.job?.stage === 'ready' ? true : null), { what: 'job ready', timeout: 30000 });
    // A sign-up form that sends nowhere: the kind of fault the checklist is for.
    const html = get(t.db, 'SELECT content FROM files WHERE floor_id=? AND path=?', fid(), page()).content;
    const broken = html.replace('</body>', '<form id="join"><input name="email" placeholder="Email"><button>Join</button></form></body>');
    run(t.db, 'UPDATE files SET content=? WHERE floor_id=? AND path=?', broken, fid(), page());
    const held = await c.post(`/api/floors/${c.slug}/makers/launch`, {});
    assert.equal(held.status, 400);
    assert.match(held.data.message, /Not launched yet\. Fix this first.*Form test arrives: The form sends nowhere/);
    assert.equal(job().launched_at, null, 'nothing launched');
    const list = (await c.get(`/api/floors/${c.slug}/launch-checklist/${job().project}`)).data.checklist;
    assert.deepEqual(list.blocked, ['form']);
    // Fixed: the form sends to the building's form handler. The test entry arrives, and is taken away again.
    const fixed = broken.replace('</body>', "<script>document.getElementById('join').onsubmit = (e) => { e.preventDefault(); fetch('_data/v1/form/join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fields: { email: e.target.email.value } }) }); };</script></body>");
    run(t.db, 'UPDATE files SET content=? WHERE floor_id=? AND path=?', fixed, fid(), page());
    const go = await c.post(`/api/floors/${c.slug}/makers/launch`, {});
    assert.equal(go.status, 200, JSON.stringify(go.data));
    assert.ok(job().launched_at, 'launched');
    assert.equal(get(t.db, 'SELECT COUNT(*) n FROM app_forms WHERE floor_id=?', fid()).n, 0, 'the test entry left nothing in the boss\'s list');
    const saved = JSON.parse(get(t.db, 'SELECT result FROM launch_checklists WHERE floor_id=? AND project=?', fid(), job().project).result);
    assert.equal(saved.checks.find((x) => x.id === 'form').ok, true);
  });
  test('the checklist gates Launch only: a staff publish of work in progress with a broken form still goes up', async () => {
    const f = get(t.db, 'SELECT * FROM floors WHERE id=?', fid());
    run(t.db, "INSERT INTO files (floor_id, path, content, size, updated_at) VALUES (?, 'projects/wip/index.html', '<form><input></form>', 20, ?)", fid(), Date.now());
    t.app.engine.upsertProject(f, 'wip', { title: 'WIP', description: '', kind: 'site', sources: [], published: true });
    assert.ok(get(t.db, "SELECT published_at FROM projects WHERE floor_id=? AND slug='wip'", fid()).published_at, 'published as work in progress');
  });
  test('LAUNCH_CHECKLIST=0: the checks still run and are kept, nothing is held', async () => {
    const check = t.app.ext?.launchChecklist;
    assert.ok(get(t.db, 'SELECT checked_at FROM launch_checklists WHERE floor_id=?', fid()), 'the result is kept for the boss and the mark');
    t.cfg.launchChecklist = false;
    run(t.db, 'UPDATE maker_jobs SET launched_at=NULL WHERE id=?', job().id);
    run(t.db, "UPDATE files SET content=replace(content, '_data/v1/form/join', 'nowhere') WHERE floor_id=? AND path=?", fid(), page());
    const go = await c.post(`/api/floors/${c.slug}/makers/launch`, {});
    assert.equal(go.status, 200, JSON.stringify(go.data));
    assert.deepEqual(JSON.parse(get(t.db, 'SELECT result FROM launch_checklists WHERE floor_id=? AND project=?', fid(), job().project).result).blocked, ['form']);
    t.cfg.launchChecklist = true;
    void check;
  });
});

describe('r2-j58 CHECKED mark', () => {
  let t, c, visitor;
  before(async () => { t = await boot(); c = await claim(t, 'Checked Floor'); const { Client } = await import('./helpers.js'); visitor = new Client(t, { origin: null }); });
  after(() => t.close());
  const pass8 = { checks: CHECKS.map(([id, label, blocks]) => ({ id, label, blocks, ok: true })), passed: 8, blocked: [], warnings: [] };
  test('DONE MEANS: a launch that passes shows "CHECKED 8 of 8" on its card and its plaque; 7 of 8 shows nothing', async () => {
    const { checkedMark } = await import('../server/checklist.js');
    assert.deepEqual(checkedMark(pass8), { passed: 8, of: 8 });
    assert.equal(checkedMark({ ...pass8, passed: 7 }), null);
    assert.equal(checkedMark(null), null); assert.equal(checkedMark('not json'), null);
    const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
    const at = Date.now();
    for (const [slug, r] of [['passed', pass8], ['warned', { ...pass8, passed: 7, warnings: ['icon'] }]]) {
      run(t.db, 'INSERT INTO projects (floor_id,slug,title,kind,private,published_at,created_at) VALUES (?,?,?,?,0,?,?)', f.id, slug, slug, 'site', at, at - 1000);
      run(t.db, 'INSERT INTO launch_checklists (floor_id, project, result, checked_at) VALUES (?,?,?,?)', f.id, slug, JSON.stringify(r), at);
    }
    run(t.db, 'INSERT INTO projects (floor_id,slug,title,kind,private,published_at,created_at) VALUES (?,?,?,?,0,?,?)', f.id, 'never', 'never', 'site', at, at - 1000);
    const wall = (await visitor.get(`/api/building/launched?floor=${c.slug}`)).data;
    const cards = Object.fromEntries(wall.projects.map((x) => [x.slug, x]));
    assert.deepEqual(cards.passed.checked, { passed: 8, of: 8 }, 'on the card');
    assert.equal(cards.warned.checked, undefined); assert.equal(cards.never.checked, undefined);
    const frames = (await visitor.get(`/api/floors/${c.slug}`)).data.room.frames.list;
    assert.deepEqual(frames.find((x) => x.slug === 'passed').checked, { passed: 8, of: 8 }, 'on the plaque under its frame');
    assert.equal(frames.find((x) => x.slug === 'warned').checked, undefined);
    assert.ok(!JSON.stringify(wall).toLowerCase().includes('buddehbot'), 'no buddehbot stamp on a launch');
  });
});
