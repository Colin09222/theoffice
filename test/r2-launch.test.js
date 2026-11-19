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

/** A real maker job (mock mode) built and passed by the Tester, ready for the Launch tap. */
async function readyJob(t, c) {
  const ideas = await c.get(`/api/floors/${c.slug}/makers/ideas?type=game`);
  const card = ideas.data.cards.find((x) => x.starter === 'game-2d') || ideas.data.cards[0];
  await c.post(`/api/floors/${c.slug}/makers/start`, { type: 'game', idea: card.id, name: card.name, pitch: card.pitch, goal: card.goal, plan: card.plan, starter: 'game-2d' });
  await until(async () => ((await floorState(c)).makers?.job?.stage === 'ready' ? true : null), { what: 'job ready', timeout: 30000 });
  return get(t.db, 'SELECT * FROM maker_jobs WHERE floor_id=(SELECT id FROM floors WHERE slug=?) ORDER BY id DESC LIMIT 1', c.slug);
}
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 9), Buffer.from([0xff, 0xd9])]);

describe('r2-j59 fresh eyes', () => {
  let t, calls, reply;
  before(async () => {
    t = await boot({ maxRevisions: 2, checklistFetch: async () => ({ ok: true }), mediaMock: true, freshEyesShots: async () => ({ desktop: JPEG, phone: JPEG }) });
    calls = [];
    const media = t.app.engine.media;
    const real = media.freshEyes.bind(media);
    media.freshEyes = async (a) => { calls.push({ desktop: !!a.desktop, phone: !!a.phone, lines: a.lines }); const r = await real(a); return reply ? { ...r, text: reply } : r; };
  });
  after(() => t.close());
  test('DONE MEANS: a launch gets exactly one score, on the review model, with desktop and phone pictures and the done-means lines; boss only', async () => {
    const c = await claim(t, 'Fresh One');
    const j = await readyJob(t, c);
    assert.equal((await c.post(`/api/floors/${c.slug}/makers/launch`, {})).status, 200);
    const row = await until(() => get(t.db, 'SELECT * FROM fresh_eyes WHERE project=? AND score IS NOT NULL', j.project) || null, { what: 'the score', timeout: 10000 });
    assert.equal(row.score, 4);
    assert.equal(calls.length, 1);
    assert.deepEqual([calls[0].desktop, calls[0].phone], [true, true]);
    assert.ok(Array.isArray(calls[0].lines));
    assert.equal(row.model, t.app.engine.media.review?.model || 'mock-review', 'the review model');
    assert.ok(!/fable/i.test(row.model), 'never Fable');
    assert.equal(get(t.db, 'SELECT COUNT(*) n FROM tasks WHERE title LIKE ?', 'Fix what a fresh look found%').n, 0, 'a 4 makes no fix job');
    const boss = (await c.get(`/api/floors/${c.slug}`)).data;
    assert.equal(boss.freshEyes[0].score, 4);
    const { Client } = await import('./helpers.js');
    const visitor = await new Client(t, { origin: null }).get(`/api/floors/${c.slug}`);
    assert.equal(visitor.data.freshEyes, undefined, 'a visitor never sees it');
    assert.ok(!JSON.stringify(visitor.data).includes('fresh look'));
    // The Launch tapped again on the same launch: still one score, no second call.
    await c.post(`/api/floors/${c.slug}/makers/launch`, {});
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(calls.length, 1, 'never a second score');
    assert.equal(get(t.db, 'SELECT COUNT(*) n FROM fresh_eyes WHERE project=?', j.project).n, 1);
    assert.ok(get(t.db, "SELECT 1 x FROM ledger WHERE kind='review' AND floor_id=(SELECT id FROM floors WHERE slug=?)", c.slug), 'its cost is on the ledger');
  });
  test('a score under 3 makes exactly one fix job; asking again for the same launch makes neither a call nor a job', async () => {
    reply = 'SCORE: 2\n1. The start button is hidden under the title on a phone. Move it.';
    const c = await claim(t, 'Fresh Two');
    const j = await readyJob(t, c);
    const before = calls.length;
    assert.equal((await c.post(`/api/floors/${c.slug}/makers/launch`, {})).status, 200);
    const row = await until(() => get(t.db, 'SELECT * FROM fresh_eyes WHERE project=? AND score IS NOT NULL', j.project) || null, { what: 'the score', timeout: 10000 });
    assert.equal(row.score, 2);
    const fixes = all(t.db, 'SELECT * FROM tasks WHERE floor_id=(SELECT id FROM floors WHERE slug=?) AND title LIKE ?', c.slug, 'Fix what a fresh look found%');
    assert.equal(fixes.length, 1, t.logs.filter((l) => l.includes('fresh eyes')).join(' ')); assert.equal(row.fix_task_id, fixes[0].id); assert.match(fixes[0].brief, /start button is hidden/);
    const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
    assert.equal(await t.app.ext.freshEyes(f, j.project, `launch:${get(t.db, 'SELECT launched_at FROM maker_jobs WHERE id=?', j.id).launched_at}`), null);
    assert.equal(calls.length, before + 1, 'one call for this launch, ever');
    assert.equal(all(t.db, 'SELECT * FROM tasks WHERE floor_id=? AND title LIKE ?', f.id, 'Fix what a fresh look found%').length, 1);
    reply = null;
  });
  test('the score is read from the first line; FRESH_EYES=0 makes no call', async () => {
    const { readScore } = await import('../server/fresheyes.js');
    assert.deepEqual(['SCORE: 4\nfine', 'score = 1', 'It is 3/5 overall', 'no score here', 'SCORE: 9'].map(readScore), [4, 1, 3, null, null]);
    t.cfg.freshEyes = false;
    const f = get(t.db, "SELECT * FROM floors WHERE slug=(SELECT slug FROM floors ORDER BY id LIMIT 1)");
    assert.equal(await t.app.ext.freshEyes(f, 'anything', 'launch:1'), null);
    t.cfg.freshEyes = true;
  });
});

describe('r2-j60 share cards', () => {
  /** A JPEG header of the given size: enough for imageSize, and for a chat app's preview sniff. */
  const jpegOf = (w, h, pad = 5000) => { const sof = Buffer.from([0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]); return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.alloc(pad, 0x55), Buffer.from([0xff, 0xd9])]); };
  let t, c, shots;
  before(async () => {
    shots = [];
    t = await boot({ shareCardShoot: async (url, size) => { shots.push({ url, size }); return jpegOf(size.width, size.height, size.quality > 70 ? 260 * 1024 : 9000); } });
    c = await claim(t, 'Share Floor', { floor: 6 });
  });
  after(() => t.close());
  test('DONE MEANS: a floor link carries a 1,200 by 630 picture of that floor as its preview', async () => {
    const page = await (await fetch(`${t.base}/floor/${c.slug}`)).text();
    const image = page.match(/<meta property="og:image" content="([^"]+)">/)?.[1];
    assert.ok(image, 'the floor link has an og:image');
    assert.match(page, /<meta property="og:image:width" content="1200">/); assert.match(page, /<meta property="og:image:height" content="630">/);
    assert.match(page, /<meta property="og:title" content="Share Floor: floor 6 of The Office">/);
    assert.match(page, /twitter:card" content="summary_large_image"/);
    const { imageSize, CARD } = await import('../server/sharecards.js');
    // Before the first card is taken, a plain one in the floor's colours stands in.
    const plain = await fetch(image.replace(/^https?:\/\/[^/]+/, `http://${t.host}`));
    const pb = Buffer.from(await plain.arrayBuffer());
    assert.equal(plain.headers.get('content-type'), 'image/png');
    assert.deepEqual(imageSize(pb), { type: 'image/png', width: 1200, height: 630 }); assert.ok(pb.length < CARD.maxBytes, `${pb.length} bytes`);
    // A launch makes the real card: the card page photographed at 1,200 by 630, a little lower in quality until under 200 KB.
    const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
    run(t.db, 'INSERT INTO projects (floor_id,slug,title,kind,private,published_at,created_at) VALUES (?,?,?,?,0,?,?)', f.id, 'tyres', 'Tyres', 'site', Date.now(), Date.now() - 1000);
    t.app.engine.emitProject(f.id, 'tyres');
    const row = await until(() => get(t.db, "SELECT * FROM share_cards WHERE floor_id=? AND why='launch'", f.id) || null, { what: 'the card', timeout: 5000 });
    assert.ok(shots.every((s) => s.url.endsWith(`/api/floors/${c.slug}/sharecard.html`) && s.size.width === 1200 && s.size.height === 630));
    assert.equal(shots.length, 2, 'the first try was over 200 KB, the second fit');
    const card = await fetch(`${t.base}/api/floors/${c.slug}/sharecard`);
    const cb = Buffer.from(await card.arrayBuffer());
    assert.equal(card.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(imageSize(cb), { type: 'image/jpeg', width: 1200, height: 630 }); assert.ok(cb.length < 200 * 1024 && row.bytes === cb.length);
    const again = await (await fetch(`${t.base}/floor/${c.slug}`)).text();
    assert.ok(again.includes(`sharecard?v=${row.made_at}`), 'the link points at the new card');
  });
  test('the card page holds public facts only; remade weekly; a demo or hidden floor has none; SHARE_CARDS=0', async () => {
    const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
    const html = await (await fetch(`${t.base}/api/floors/${c.slug}/sharecard.html`)).text();
    assert.match(html, /Share Floor/); assert.match(html, /Floor 6/); assert.match(html, /1 launched · 0 real visits/);
    assert.ok(!/\$\d|usd|cost/i.test(html), 'no money');
    run(t.db, 'UPDATE share_cards SET made_at=? WHERE floor_id=?', Date.now() - 8 * 86400000, f.id);
    await t.app.ext.shareCardTick();
    assert.equal(get(t.db, 'SELECT why FROM share_cards WHERE floor_id=?', f.id).why, 'weekly');
    run(t.db, 'UPDATE floors SET hidden=1 WHERE id=?', f.id);
    assert.equal((await fetch(`${t.base}/api/floors/${c.slug}/sharecard`)).status, 404);
    assert.ok(!(await (await fetch(`${t.base}/floor/${c.slug}`)).text()).includes('og:image'), 'a hidden floor gets no preview');
    run(t.db, 'UPDATE floors SET hidden=0 WHERE id=?', f.id);
    t.cfg.shareCards = false;
    assert.ok(!(await (await fetch(`${t.base}/floor/${c.slug}`)).text()).includes('og:image'));
    t.cfg.shareCards = true;
  });
});

describe('r2-j63 upkeep rounds', () => {
  const TUE = Date.UTC(2026, 10, 24, 14, 1);  // Tuesday 24 November 2026, 09:01 in New York
  let t, c, f, slug;
  before(async () => {
    t = await boot({ checklistFetch: async () => ({ ok: true }) });
    c = await claim(t, 'TheTireRx', { floor: 6 });
    await c.post(`/api/floors/${c.slug}/chat`, { text: 'go build tyre site' });
    const { waitDone } = await import('./helpers.js');
    await waitDone(c);
    f = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
    slug = get(t.db, "SELECT p.slug FROM projects p WHERE p.floor_id=? AND p.published_at IS NOT NULL AND p.kind='site' AND EXISTS (SELECT 1 FROM published_files x WHERE x.floor_id=p.floor_id AND x.project=p.slug AND x.path='index.html')", f.id).slug;
    const { setFloorPlans } = await import('../server/weekplan.js');
    setFloorPlans(t.db, f.id, false);  // like TheTireRx: out of weekly plans, on upkeep only
  });
  after(() => t.close());
  const testerWork = () => get(t.db, "SELECT COUNT(*) n FROM tasks t JOIN agents a ON a.id=t.agent_id WHERE t.floor_id=? AND a.role='tester'", f.id).n;
  const testerCalls = () => get(t.db, "SELECT COUNT(*) n FROM ledger l JOIN agents a ON a.id=l.agent_id WHERE l.floor_id=? AND a.role='tester'", f.id).n;

  test('DONE MEANS: a planted broken link on a test site is found and fixed on the Tuesday run with no Tester call', async () => {
    const { upkeepDue } = await import('../server/upkeep.js');
    assert.equal(upkeepDue(TUE), true); assert.equal(upkeepDue(TUE - 2 * 60000), false, '08:59 is too early'); assert.equal(upkeepDue(TUE - 86400000), false, 'Monday');
    const page = get(t.db, "SELECT content FROM published_files WHERE floor_id=? AND project=? AND path='index.html'", f.id, slug).content;
    run(t.db, "UPDATE published_files SET content=? WHERE floor_id=? AND project=? AND path='index.html'", page.replace('</body>', '<a href="old-prices.html">Prices</a></body>'), f.id, slug);
    const testers = [testerWork(), testerCalls()];
    assert.deepEqual(await t.app.ext.upkeepTick(TUE - 86400000), [], 'nothing on a Monday');
    const [round] = (await t.app.ext.upkeepTick(TUE)).filter((r) => r.floor === 6);
    const site = round.sites.find((s) => s.slug === slug);
    assert.equal(site.ok, false); assert.equal(site.failed[0].id, 'links'); assert.match(site.failed[0].note, /old-prices\.html/);
    const fix = get(t.db, 'SELECT t.*, a.role FROM tasks t JOIN agents a ON a.id=t.agent_id WHERE t.id=?', site.fix);
    assert.equal(fix.role, 'builder'); assert.equal(fix.size, 'small'); assert.match(fix.title, /^Upkeep: fix /); assert.match(fix.brief, /old-prices\.html/);
    const { waitDone } = await import('./helpers.js');
    await waitDone(c);
    await t.app.ext.upkeepTick(TUE + 3600000);
    const after = get(t.db, 'SELECT * FROM upkeep_fixes WHERE task_id=?', site.fix);
    assert.equal(after.fixed, 1, 'checked again after the fix: the link is gone');
    assert.ok(!get(t.db, "SELECT content FROM published_files WHERE floor_id=? AND project=? AND path='index.html'", f.id, slug).content.includes('old-prices.html'));
    assert.deepEqual([testerWork(), testerCalls()], testers, 'no Tester was given work or called');
    assert.deepEqual(await t.app.ext.upkeepTick(TUE + 7200000), [], 'once a week');
  });
  test('at most 3 fixes a site a week; a paused floor gets its report and no fix; a domain due within 30 days is told once', async () => {
    const { weekOf } = await import('../server/weekplan.js');
    const week = weekOf(TUE + 7 * 86400000);
    for (let i = 0; i < 3; i++) run(t.db, 'INSERT INTO upkeep_fixes (floor_id, project, week, task_id, created_at) VALUES (?,?,?,?,?)', f.id, slug, week, 900000 + i, TUE);
    run(t.db, "UPDATE published_files SET content=content || '<a href=\"gone.html\">x</a>' WHERE floor_id=? AND project=? AND path='index.html'", f.id, slug);
    run(t.db, "INSERT INTO domain_orders (floor_id, domain, project, status, quoted_usd, created_at, updated_at, bought_at) VALUES (?, 'thetirerx.com', ?, 'live', 12, ?, ?, ?)", f.id, slug, TUE - 400 * 86400000, TUE, TUE + 7 * 86400000 - 340 * 86400000);
    const [round] = (await t.app.ext.upkeepTick(TUE + 7 * 86400000)).filter((r) => r.floor === 6);
    assert.equal(round.sites.find((s) => s.slug === slug).fix, null, 'the week\'s 3 are used');
    assert.deepEqual(round.renewals, ['thetirerx.com']);
    assert.equal(all(t.db, "SELECT text FROM messages WHERE floor_id=? AND text LIKE 'thetirerx.com is due for renewal%'", f.id).length, 1);
    const p2 = await claim(t, 'Paused Floor');
    await p2.post(`/api/floors/${p2.slug}/chat`, { text: 'go build cake site' });
    const { waitDone } = await import('./helpers.js');
    await waitDone(p2);
    const f2 = get(t.db, 'SELECT * FROM floors WHERE slug=?', p2.slug);
    const s2 = get(t.db, "SELECT project FROM published_files WHERE floor_id=? AND path='index.html' LIMIT 1", f2.id).project;
    run(t.db, "UPDATE published_files SET content=content || '<a href=\"nope.html\">x</a>' WHERE floor_id=? AND project=? AND path='index.html'", f2.id, s2);
    run(t.db, 'UPDATE floors SET paused=1 WHERE id=?', f2.id);
    const [r2] = (await t.app.ext.upkeepTick(TUE + 14 * 86400000)).filter((r) => r.floor === f2.number);
    assert.equal(r2.paused, true); assert.equal(r2.sites.find((s) => s.slug === s2).ok, false); assert.equal(r2.sites.find((s) => s.slug === s2).fix, null);
    t.cfg.upkeep = false;
    assert.deepEqual(await t.app.ext.upkeepTick(TUE + 21 * 86400000), []);
    t.cfg.upkeep = true;
  });
});
