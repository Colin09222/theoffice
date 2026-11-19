// Real launch cards (docs/redesign, job 3): a screenshot of every launch's live page, kept small with the project and taken again every 7 days;
// the Launched wall shows it on every card and the home hero shows the 3 best. No model anywhere. Mock mode.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { boot, claim, Client, adminClient, until } from './helpers.js';
import { get, run } from '../server/db.js';
import { launches, heroLaunches, dueShots, storeShot, takeDue, REFRESH_MS } from '../server/shots.js';
import { findChrome, makeShooter } from '../server/shooter.js';

const DAY = 86400000;
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const floorOf = (t, c) => get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
const page = (title, bg) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="margin:0;background:${bg};color:#fff;font:700 60px sans-serif;display:grid;place-items:center;height:100vh">${title}</body></html>`;
function publish(t, floorId, slug, { title = slug, kind = 'site', at = Date.now(), made = at - 3 * DAY, priv = 0, bg = '#17766F' } = {}) {
  run(t.db, 'INSERT INTO projects (floor_id,slug,title,description,kind,private,published_at,created_at) VALUES (?,?,?,?,?,?,?,?)', floorId, slug, title, `${title} in one line`, kind, priv, at, made);
  const html = page(title, bg);
  run(t.db, "INSERT INTO published_files (floor_id,project,path,content,size) VALUES (?,?,'index.html',?,?)", floorId, slug, html, html.length);
}
const visits = (t, floorId, slug, n, at = Date.now()) => run(t.db, "INSERT INTO app_visits (floor_id,project,day,path,views,uniques) VALUES (?,?,?,'/',?,?)", floorId, slug, dayOf(at), n, n);
// A fake camera: a tiny but real-looking JPEG, and a count of what it was pointed at.
const fakeShooter = (fail = new Set()) => { const seen = []; return { seen, async shoot(url) { seen.push(url); if ([...fail].some((f) => url.includes(f))) throw new Error('could not load'); return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(600, 7), Buffer.from([0xff, 0xd9])]); }, close() {} }; };

describe('which launches, and the best three', () => {
  test('the wall: public launches on real floors; work in progress marked; demo floors, private work and drafts left out', async () => {
    const t = await boot({ fillerCompanies: true, fillerTickMs: 1e6, towerFloors: 30 });
    try {
      const a = floorOf(t, await claim(t, 'Arcade'));
      const demo = get(t.db, 'SELECT id FROM floors WHERE filler=1');
      publish(t, a.id, 'loopling', { kind: 'game' });
      publish(t, a.id, 'secret', { priv: 1 });
      publish(t, demo.id, 'fake-launch');
      run(t.db, "INSERT INTO projects (floor_id,slug,title,kind,private,created_at) VALUES (?,'draft','Draft','site',0,?)", a.id, Date.now());
      publish(t, a.id, 'half-done');
      t.app.engine.makers; // the maker_jobs table is made when the app starts
      run(t.db, "INSERT INTO maker_jobs (floor_id,project,type,title,stage,started_at,updated_at) VALUES (?,'half-done','site','Half done','build',?,?)", a.id, Date.now(), Date.now());
      const l = launches(t.db);
      assert.deepEqual(l.map((x) => x.slug).sort(), ['half-done', 'loopling']);
      assert.equal(l.find((x) => x.slug === 'half-done').wip, true);
      assert.equal(l.find((x) => x.slug === 'loopling').madeDays, 3);
      const wall = (await new Client(t).get('/api/building/launched')).data.projects;
      assert.deepEqual(wall.map((x) => x.slug).sort(), ['half-done', 'loopling']);
      const hero = (await new Client(t).get('/api/building/hero')).data.projects;
      assert.deepEqual(hero.map((x) => x.slug), ['loopling'], 'work in progress never reaches the hero');
      // Nothing about money or sign-ups on a public card.
      assert.doesNotMatch(JSON.stringify(wall), /signups|sales|usd|cost|price/i);
    } finally { await t.close(); }
  });
  test('the hero: most real visits or plays in the last 7 days, ties to the newest, three at most', async () => {
    const t = await boot();
    try {
      const f = floorOf(t, await claim(t, 'Many Launches'));
      const now = Date.now();
      publish(t, f.id, 'a', { at: now - 5 * DAY }); visits(t, f.id, 'a', 40);
      publish(t, f.id, 'b', { at: now - 4 * DAY }); visits(t, f.id, 'b', 10);
      publish(t, f.id, 'c', { at: now - 3 * DAY }); visits(t, f.id, 'c', 10);
      publish(t, f.id, 'd', { at: now - 2 * DAY }); visits(t, f.id, 'd', 2);
      publish(t, f.id, 'e', { at: now - 30 * DAY }); visits(t, f.id, 'e', 500, now - 20 * DAY);  // popular, but not this week
      publish(t, f.id, 'f', { at: now - 1 * DAY });
      assert.deepEqual(heroLaunches(t.db, { now }).map((x) => x.slug), ['a', 'c', 'b'], 'c and b tie on 10; c is newer');
      assert.equal(launches(t.db, { now }).find((x) => x.slug === 'e').visits, 0, 'only the last 7 days count');
    } finally { await t.close(); }
  });
});

describe('the photos', () => {
  test('due when missing or 7 days old; a failure waits; stored small with the project; served only while the launch is public', async () => {
    const t = await boot();
    try {
      const c = await claim(t, 'Photo Co'); const f = floorOf(t, c);
      publish(t, f.id, 'one'); publish(t, f.id, 'two');
      const shooter = fakeShooter(new Set(['/two/']));
      let r = await takeDue(t.db, t.cfg, { shooter, origin: 'http://example.test' });
      assert.equal(r.taken.length, 1); assert.equal(r.failed.length, 1);
      assert.ok(shooter.seen.every((u) => u.startsWith('http://example.test/theoffice/f/')), shooter.seen.join());
      assert.deepEqual(dueShots(t.db).map((x) => x.slug), [], 'the failed one waits before another try, the good one is fresh');
      assert.deepEqual(dueShots(t.db, { now: Date.now() + 7 * 3600e3 }).map((x) => x.slug), ['two']);
      assert.deepEqual(dueShots(t.db, { now: Date.now() + REFRESH_MS + 1000 }).map((x) => x.slug).sort(), ['one', 'two'], 'every 7 days');
      // The wall and the photo itself.
      const wall = (await new Client(t).get('/api/building/launched')).data.projects;
      const one = wall.find((x) => x.slug === 'one'), two = wall.find((x) => x.slug === 'two');
      assert.equal(one.shot, true); assert.match(one.thumb, new RegExp(`/api/building/shot/${c.slug}/one\\?v=\\d+$`));
      assert.equal(two.shot, false); assert.match(two.thumb, /\/api\/building\/thumb\//, 'no photo yet: the coloured initial card');
      const img = await new Client(t).raw('GET', `/api/building/shot/${c.slug}/one`);
      assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/jpeg');
      assert.ok(Buffer.from(await img.arrayBuffer()).length < 400 * 1024);
      run(t.db, "UPDATE projects SET private=1 WHERE floor_id=? AND slug='one'", f.id);
      assert.equal((await new Client(t).raw('GET', `/api/building/shot/${c.slug}/one`)).status, 404, 'private now: no photo');
      assert.throws(() => storeShot(t.db, { floorId: f.id, project: 'two', image: Buffer.from('not a jpeg at all'.repeat(20)), url: 'x' }));
    } finally { await t.close(); }
  });
  test('a real Chromium photographs all six launches, the wall shows six photos and the hero three', { skip: !findChrome() && 'no Chromium on this machine' }, async () => {
    const t = await boot();
    try {
      const names = [['TireRx directory', '#C93A24'], ['Photography', '#1F2430'], ['LabStackr', '#17766F'], ['Third Party Rising', '#5B6270'], ['Loopling', '#F2A33A'], ['Lanternfall', '#17766F']];
      const floors = [];
      for (const [i, [title, bg]] of names.entries()) {
        const f = floorOf(t, await claim(t, `Floor ${i + 3}`, { floor: i + 3 }));
        publish(t, f.id, title.toLowerCase().replace(/[^a-z]+/g, '-'), { title, bg, kind: i >= 4 ? 'game' : 'site', at: Date.now() - (i + 1) * 3600e3 });
        floors.push(f);
      }
      const shooter = await makeShooter({});
      assert.ok(shooter, 'a browser to drive');
      try {
        const r = await takeDue(t.db, t.cfg, { shooter, origin: `http://127.0.0.1:${t.port}` });
        assert.equal(r.taken.length, 6, JSON.stringify(r.failed));
        for (const x of r.taken) assert.ok(x.bytes > 1500 && x.bytes < 120 * 1024, `${x.project}: ${x.bytes} bytes`);
      } finally { shooter.close(); }
      const wall = (await new Client(t).get('/api/building/launched')).data.projects;
      assert.equal(wall.length, 6); assert.ok(wall.every((x) => x.shot), 'all six show a real screenshot');
      const hero = (await new Client(t).get('/api/building/hero')).data.projects;
      assert.equal(hero.length, 3); assert.ok(hero.every((x) => x.shot));
      // The photo is a 640x400 JPEG (16:10, card sized).
      const img = Buffer.from(await (await new Client(t).raw('GET', `/api/building/shot/${wall[0].floor.slug}/${wall[0].slug}`)).arrayBuffer());
      let i = 2; let size = null;
      while (i < img.length) { const m = img[i + 1]; const len = img.readUInt16BE(i + 2); if (m >= 0xc0 && m <= 0xc2) { size = [img.readUInt16BE(i + 7), img.readUInt16BE(i + 5)]; break; } i += 2 + len; }
      assert.deepEqual(size, [640, 400]);
      // The photographer is a headless browser: it never counts as a visit.
      assert.equal(get(t.db, 'SELECT COALESCE(SUM(views),0) n FROM app_visits').n, 0);
    } finally { await t.close(); }
  });
  test('the server timer takes what is due by itself when it has a browser', { skip: !findChrome() && 'no Chromium on this machine' }, async () => {
    const t = await boot({ shotsEveryMs: 40 });
    try {
      const f = floorOf(t, await claim(t, 'Timer Co'));
      publish(t, f.id, 'timed');
      await until(() => get(t.db, "SELECT 1 x FROM launch_shots WHERE project='timed' AND image IS NOT NULL"), { what: 'the timer to take a photo', timeout: 30000 });
    } finally { await t.close(); }
  });
});

describe('visits that count', () => {
  test('bots, the floor\'s own boss and the building manager are not visitors; anyone else is', async () => {
    const t = await boot();
    try {
      const c = await claim(t, 'Count Co'); const f = floorOf(t, c);
      publish(t, f.id, 'site');
      const path = `/f/${c.slug}/site/`;
      const ua = { 'user-agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/130 Safari/537.36' };
      await c.raw('GET', path, { headers: ua });
      const admin = await adminClient(t);
      await admin.raw('GET', path, { headers: ua });
      await new Client(t).raw('GET', path, { headers: { 'user-agent': 'Googlebot/2.1' } });
      await new Client(t).raw('GET', path, { headers: { 'user-agent': 'Mozilla/5.0 HeadlessChrome/130' } });
      assert.equal(get(t.db, 'SELECT COALESCE(SUM(views),0) n FROM app_visits WHERE floor_id=?', f.id).n, 0);
      await new Client(t).raw('GET', path, { headers: ua });
      assert.equal(get(t.db, 'SELECT COALESCE(SUM(views),0) n FROM app_visits WHERE floor_id=?', f.id).n, 1);
    } finally { await t.close(); }
  });
});
