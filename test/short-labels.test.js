// Clean share links: neon-hive.middistance.com when the name is free, the long form otherwise, old links forever; and a floor opened
// without a name loses its floor-N slug once it is named, if nothing has been published under it.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { boot, claim, floorState, until, hostFetch } from './helpers.js';
import { get } from '../server/db.js';
import { appLabel, claimShortLabel, lookupLabel, shortLabelFor, RESERVED_LABELS } from '../server/apps.js';
import { writeFile, publishSnapshot } from '../server/workspace.js';

const freePort = () => new Promise((r) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => r(port)); }); });

describe('which projects can have a short label', () => {
  test('the name alone, unless reserved, too short, or carrying --', () => {
    assert.equal(shortLabelFor('neon-hive'), 'neon-hive');
    for (const bad of ['www', 'api', 'mail', 'admin', 'status', 'ab', 'a--b', 'api--x', 'xn--abc', 'ns1', 'autodiscover']) assert.equal(shortLabelFor(bad), null, bad);
    assert.ok(RESERVED_LABELS.has('www'));
  });
});

describe('on a project origin', () => {
  let t, c, port, floor;
  before(async () => {
    port = await freePort();
    t = await boot({ appsBaseDomain: `apps.localhost:${port}`, appsScheme: 'http', liveCheckDelayMs: 5, liveCheckFn: async () => ({ ok: true, checked: ['page'] }) });
    await new Promise((r) => t.app.server.close(r));
    await new Promise((r) => t.app.server.listen(port, '127.0.0.1', r));
    t.base = `http://localhost:${port}/theoffice`; t.host = `localhost:${port}`; t.cfg.publicOrigin = `http://localhost:${port}`;
    c = await claim(t, 'Short Co');
    floor = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
  });
  after(() => t.close());
  const publish = (fl, slug) => {
    t.db.prepare('INSERT OR IGNORE INTO projects (floor_id,slug,title,created_at) VALUES (?,?,?,?)').run(fl.id, slug, slug, Date.now());
    writeFile(t.db, fl.id, `projects/${slug}/index.html`, '<!doctype html><html lang="en"><title>x</title><meta name="description" content="d"><p>hello short</p></html>', null, t.cfg.quotaBytes);
    publishSnapshot(t.db, fl.id, slug, t.cfg.quotaBytes);
    t.db.prepare('UPDATE projects SET published_at=? WHERE floor_id=? AND slug=?').run(Date.now(), fl.id, slug);
  };
  test('a claimed short label serves the site, and the long one still does', async () => {
    publish(floor, 'neon-hive');
    const long = appLabel(t.db, floor, 'neon-hive');
    assert.ok(long.includes('--'), long);
    assert.equal(claimShortLabel(t.db, floor, 'neon-hive'), 'neon-hive');
    assert.equal(appLabel(t.db, floor, 'neon-hive'), 'neon-hive', 'the short form is the address now');
    assert.equal(claimShortLabel(t.db, floor, 'neon-hive'), 'neon-hive', 'asking again is fine');
    assert.deepEqual({ ...lookupLabel(t.db, 'neon-hive') }, { floor_id: floor.id, project: 'neon-hive' });
    assert.deepEqual({ ...lookupLabel(t.db, long) }, { floor_id: floor.id, project: 'neon-hive' });
    for (const label of ['neon-hive', long]) {
      const r = await hostFetch(port, '/', { headers: { host: `${label}.apps.localhost:${port}` } });
      assert.equal(r.status, 200, label); assert.match(await r.text(), /hello short/);
    }
  });
  test('TLS is on-demand for both forms, only when live', async () => {
    const q = (d) => hostFetch(port, `/theoffice/api/apps/tls-check?domain=${d}`, { headers: { host: '127.0.0.1' } }).then((r) => r.status);
    assert.equal(await q(`neon-hive.apps.localhost:${port}`), 200);
    assert.equal(await q(`${get(t.db, "SELECT label FROM app_labels WHERE floor_id=? AND project='neon-hive'", floor.id).label}.apps.localhost:${port}`), 200);
    assert.equal(await q(`www.apps.localhost:${port}`), 404, 'a reserved name never gets a certificate');
    assert.equal(await q(`not-a-project.apps.localhost:${port}`), 404);
  });
  test('Office Cloud accepts the page\'s own origin on either address, and neither one\'s data can be reached from the other', async () => {
    const write = (host, origin) => hostFetch(port, '/_office/cloud/saves/k', { method: 'PUT', headers: { host, origin, 'content-type': 'application/json', 'x-office-player': 'p'.repeat(40) }, body: JSON.stringify({ value: 1 }) });
    const long = get(t.db, "SELECT label FROM app_labels WHERE floor_id=? AND project='neon-hive'", floor.id).label;
    assert.equal((await write(`neon-hive.apps.localhost:${port}`, `http://neon-hive.apps.localhost:${port}`)).status, 200);
    assert.equal((await write(`${long}.apps.localhost:${port}`, `http://${long}.apps.localhost:${port}`)).status, 200);
    assert.equal((await write(`neon-hive.apps.localhost:${port}`, `http://${long}.apps.localhost:${port}`)).status, 403, 'another origin is refused');
  });
  test('a taken name falls back to the long form', async () => {
    const co2 = await claim(t, 'Second Co');
    const fl2 = get(t.db, 'SELECT * FROM floors WHERE slug=?', co2.slug);
    assert.equal(claimShortLabel(t.db, fl2, 'neon-hive'), null);
    assert.ok(appLabel(t.db, fl2, 'neon-hive').includes('--'));
    publish(fl2, 'www');
    assert.equal(claimShortLabel(t.db, fl2, 'www'), null, 'reserved');
  });
  test('Launch gives the short link and it is on the card', async () => {
    const co3 = await claim(t, 'Launch Co');
    assert.equal((await co3.post(`/api/floors/${co3.slug}/makers/start`, { type: 'website', name: 'Clean Links', pitch: 'A good site [full]' })).status, 200);
    await until(async () => { const s = await floorState(co3); return s.makers?.job?.stage === 'ready' ? s : null; }, { what: 'ready', timeout: 25000 });
    const r = await co3.post(`/api/floors/${co3.slug}/makers/launch`, {});
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.url, `http://clean-links.apps.localhost:${port}/`);
    assert.equal(r.data.makers.job.url, r.data.url);
    const page = await hostFetch(port, '/', { headers: { host: `clean-links.apps.localhost:${port}` } });
    assert.equal(page.status, 200);
  });
});

describe('a floor opened without a name', () => {
  let t;
  before(async () => { t = await boot({ liveCheckDelayMs: 5 }); });
  after(() => t.close());
  test('takes a slug from the company name once named, and the old slug keeps working', async () => {
    const c = await claim(t, ''); // no name: floor-N
    assert.match(c.slug, /^floor-\d+$/);
    const old = c.slug;
    const start = await c.post(`/api/floors/${old}/makers/start`, { type: 'website', name: 'Sunny Paws', pitch: 'A pet shop site [full]' });
    assert.equal(start.status, 200, JSON.stringify(start.data));
    const f = get(t.db, 'SELECT * FROM floors WHERE id=(SELECT floor_id FROM floor_old_slugs WHERE slug=?)', old);
    assert.equal(f.slug, 'sunny-paws');
    assert.equal(get(t.db, 'SELECT name FROM floors WHERE id=?', f.id).name, 'Sunny Paws');
    const viaOld = await c.get(`/api/floors/${old}`);
    assert.equal(viaOld.status, 200, 'the old slug still works');
    c.slug = 'sunny-paws';
    assert.equal((await c.get('/api/floors/sunny-paws')).status, 200);
    // A new floor can't take the old slug.
    assert.equal(get(t.db, 'SELECT COUNT(*) n FROM floors WHERE slug=?', old).n, 0);
  });
  test('stays floor-N if something was already published', async () => {
    const c = await claim(t, '');
    const fid = get(t.db, 'SELECT id FROM floors WHERE slug=?', c.slug).id;
    t.db.prepare('INSERT INTO projects (floor_id,slug,title,created_at,published_at) VALUES (?,?,?,?,?)').run(fid, 'live-one', 'Live', Date.now(), Date.now());
    await c.post(`/api/floors/${c.slug}/makers/start`, { type: 'website', name: 'Late Name', pitch: 'x [full]' });
    assert.match(get(t.db, 'SELECT slug FROM floors WHERE id=?', fid).slug, /^floor-\d+$/);
  });
});
