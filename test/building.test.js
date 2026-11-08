// The building-wide ticker and launched wall: public information only, however the floors are configured.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { boot, claim, Client, waitDone, floorState } from './helpers.js';
import { run, get } from '../server/db.js';
import { PRIVATE_TEXT } from '../server/engine.js';

const SECRET = ['secret-plan', 'Secret plan', 'hush-thing', 'Private task', PRIVATE_TEXT, PRIVATE_TEXT.toLowerCase()];
const leaks = (text) => SECRET.filter((s) => text.includes(s));

describe('building: ticker and launched wall', () => {
  let t, visitor, pub, priv, quiet;
  before(async () => {
    t = await boot();
    visitor = new Client(t, { origin: null });
    pub = await claim(t, 'Night Bakery', { body: { tagline: 'Warm ideas, baked overnight' } });
    priv = await claim(t, 'Vault Co', { body: { tagline: 'Hush' } });
    quiet = await claim(t, 'Closed Doors', { body: { tagline: 'Default private' } });
    assert.equal((await quiet.post(`/api/floors/${quiet.slug}/settings`, { defaultPrivate: true })).status, 200);
    await pub.post(`/api/floors/${pub.slug}/chat`, { text: 'go build midnight rolls' });
    await priv.post(`/api/floors/${priv.slug}/chat`, { text: 'go build secret plan [private]' });
    await quiet.post(`/api/floors/${quiet.slug}/chat`, { text: 'go build hush thing' });
    await waitDone(pub); await waitDone(priv); await waitDone(quiet);
  });
  after(async () => { await t.close(); });

  const ticker = async (qs = '') => (await visitor.get(`/api/building/ticker${qs}`)).data;
  const wall = async (qs = '') => (await visitor.get(`/api/building/launched${qs}`)).data;
  const bust = () => t.app.engine.feed(get(t.db, 'SELECT id FROM floors WHERE slug=?', pub.slug).id, null, 'Lights flicker in the lobby.', '');

  test('the ticker lists the public floor\'s happenings, newest first, with floor chips and a working launch url', async () => {
    const r = await visitor.get('/api/building/ticker');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/json; charset=utf-8');
    const { items } = r.data;
    assert.ok(items.length >= 5, `only ${items.length} items`);
    for (let i = 1; i < items.length; i++) assert.ok(items[i - 1].id > items[i].id, 'newest first');
    for (const it of items) {
      assert.deepEqual(Object.keys(it.floor).sort(), ['colors', 'name', 'number', 'slug']);
      assert.ok(['feed', 'published'].includes(it.kind));
      assert.equal(typeof it.text, 'string'); assert.equal(typeof it.ts, 'number'); assert.equal(it.filler, false);
      assert.equal(it.floor.slug, pub.slug, `item from ${it.floor.slug}: ${it.text}`);
    }
    const launched = items.filter((i) => i.kind === 'published');
    assert.ok(launched.length >= 3, 'three launches');
    const site = launched.find((i) => i.url.endsWith('/midnight-rolls/'));
    assert.ok(site, 'site launch has its public url');
    assert.match(site.text, /launched "midnight-rolls"/);
    assert.ok(items.some((i) => /published midnight-rolls$/.test(i.text) && i.kind === 'feed'), 'the feed line for the publish is there');
    assert.ok(items.some((i) => /Find out who this is for/.test(i.text)), 'public task titles are fine');
    assert.ok(items.every((i) => i.kind !== 'published' || i.url.startsWith('/theoffice/f/')), 'urls are plain public ones, never signed');
    const page = await fetch(`http://${t.host}${site.url}`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /^sandbox/);
  });

  test('nothing from the private project or the default-private floor reaches the ticker, in any field', async () => {
    const text = JSON.stringify(await ticker('?limit=60'));
    assert.deepEqual(leaks(text), []);
    assert.ok(!text.includes(priv.slug) && !text.includes(quiet.slug), 'private floors are not even named');
    assert.ok(!/Build the mini-site.*vault|vault.*Build the mini-site/i.test(text));
    const s = await floorState(priv);
    for (const p of s.projects) assert.ok(!text.includes(p.slug), `leaked ${p.slug}`);
  });

  test('no chat, tokens, questions, purchases or owner-only data: only feed and published lines', async () => {
    await pub.post(`/api/floors/${pub.slug}/chat`, { text: 'go build glass teacups [buy]' });
    await waitDone(pub);
    bust();
    const data = await ticker('?limit=60');
    const text = JSON.stringify(data);
    assert.ok(!/glass teacups \[buy\]/.test(text), 'boss message is not in the ticker');
    assert.ok(!/A domain name/.test(text), 'purchase requests are not in the ticker');
    assert.ok(!/Three angles|All done, boss|Right away/.test(text), 'manager chat is not in the ticker');
    assert.ok(!/price|"why"|"question"|csrf|hash|recovery/i.test(text));
    for (const it of data.items) assert.deepEqual(Object.keys(it).sort(), it.kind === 'published' ? ['filler', 'floor', 'id', 'kind', 'text', 'ts', 'url'] : ['filler', 'floor', 'id', 'kind', 'text', 'ts']);
  });

  test('limit and since narrow the list', async () => {
    const all = (await ticker('?limit=60')).items;
    assert.ok(all.length > 6);
    assert.equal((await ticker('?limit=3')).items.length, 3);
    assert.equal((await ticker('?limit=0')).items.length, 1, 'limit is clamped to at least one');
    const mark = all[4].id;
    const newer = (await ticker(`?since=${mark}&limit=60`)).items;
    assert.equal(newer.length, 4);
    assert.ok(newer.every((i) => i.id > mark));
    assert.equal((await ticker(`?since=${all[0].id}`)).items.length, 0);
    assert.equal((await ticker('?since=abc&limit=zz')).items.length, Math.min(40, all.length), 'garbage parameters fall back to defaults');
  });

  test('the newest launches stay in the strip when task chatter would bury them, still newest first', async () => {
    const fid = get(t.db, 'SELECT id FROM floors WHERE slug=?', pub.slug).id;
    for (let i = 0; i < 30; i++) t.app.engine.feed(fid, null, `Notice ${i}: the kettle is on.`, '');
    await new Promise((res) => setTimeout(res, 5100));
    const items = (await ticker('?limit=20')).items;
    assert.equal(items.length, 20);
    const pinned = items.filter((i) => i.kind === 'published');
    assert.equal(pinned.length, 3, 'three launches pinned');
    assert.ok(pinned.every((i) => i.floor.slug === pub.slug));
    for (let i = 1; i < items.length; i++) assert.ok(items[i - 1].id > items[i].id, 'newest first');
    assert.equal((await ticker('?limit=20&since=' + items[0].id)).items.length, 0, 'pins never come back as new');
  });

  test('the launched wall lists the public floor\'s published projects with thumbs, and nothing private', async () => {
    const r = await visitor.get('/api/building/launched');
    assert.equal(r.status, 200);
    const { projects } = r.data;
    assert.ok(projects.length >= 3);
    for (const p of projects) {
      assert.deepEqual(Object.keys(p).sort(), ['description', 'floor', 'kind', 'publishedAt', 'slug', 'thumb', 'title', 'url']);
      assert.equal(p.floor.slug, pub.slug);
      assert.equal(p.url, `/theoffice/f/${pub.slug}/${p.slug}/`);
      assert.equal(p.thumb, `/theoffice/api/building/thumb/${pub.slug}/${p.slug}`);
      assert.equal((await fetch(`http://${t.host}${p.url}`)).status, 200);
    }
    for (let i = 1; i < projects.length; i++) assert.ok(projects[i - 1].publishedAt >= projects[i].publishedAt, 'newest first');
    assert.deepEqual(leaks(JSON.stringify(r.data)), []);
    assert.ok(projects.some((p) => p.slug === 'midnight-rolls' && p.kind === 'site'));
  });

  test('the thumbnail is an SVG card with the title escaped, and 404 for private, missing or made-up projects', async () => {
    const fid = get(t.db, 'SELECT id FROM floors WHERE slug=?', pub.slug).id;
    run(t.db, "UPDATE projects SET title=? WHERE floor_id=? AND slug='midnight-rolls'", 'Rolls <script>alert("x")</script> & "co"', fid);
    const r = await visitor.raw('GET', `/api/building/thumb/${pub.slug}/midnight-rolls`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'image/svg+xml; charset=utf-8');
    assert.equal(r.headers.get('cache-control'), 'public, max-age=300');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
    const svg = await r.text();
    assert.ok(svg.startsWith('<svg '));
    assert.ok(!svg.includes('<script'), 'raw script tag in the SVG');
    assert.ok(svg.includes('&lt;script&gt;'), 'title escaped');
    assert.ok(svg.includes('NIGHT BAKERY') && svg.includes('#aa3300') && svg.includes('SITE'));
    run(t.db, "UPDATE projects SET title='midnight-rolls' WHERE floor_id=? AND slug='midnight-rolls'", fid);
    const privSlug = (await floorState(priv)).projects.find((p) => p.kind === 'site').slug;
    assert.equal((await visitor.raw('GET', `/api/building/thumb/${priv.slug}/${privSlug}`)).status, 404);
    assert.equal((await visitor.raw('GET', `/api/building/thumb/${quiet.slug}/hush-thing`)).status, 404);
    assert.equal((await visitor.raw('GET', `/api/building/thumb/${pub.slug}/nope`)).status, 404);
    assert.equal((await visitor.raw('GET', `/api/building/thumb/no-such-floor/midnight-rolls`)).status, 404);
    assert.equal((await visitor.raw('GET', `/api/building/thumb/${pub.slug}/..%2F..%2Fetc`)).status, 404);
  });

  test('an og:image pointing at the project\'s own image file becomes the thumb; external or missing ones do not', async () => {
    const fid = get(t.db, 'SELECT id FROM floors WHERE slug=?', pub.slug).id;
    const html = (path) => `<!doctype html><html><head><meta property="og:image" content="${path}"></head><body>hi</body></html>`;
    const setIndex = (slug, body) => run(t.db, "UPDATE published_files SET content=? WHERE floor_id=? AND project=? AND path='index.html'", body, fid, slug);
    const original = get(t.db, "SELECT content FROM published_files WHERE floor_id=? AND project='midnight-rolls' AND path='index.html'", fid).content;
    const thumbOf = async () => (await wall()).projects.find((p) => p.slug === 'midnight-rolls').thumb;
    const republish = () => run(t.db, "UPDATE projects SET published_at=published_at+1 WHERE floor_id=? AND slug='midnight-rolls'", fid);
    setIndex('midnight-rolls', html('https://evil.example/x.png')); republish();
    assert.equal(await thumbOf(), `/theoffice/api/building/thumb/${pub.slug}/midnight-rolls`, 'external url ignored');
    setIndex('midnight-rolls', html('../../other/secret.png')); republish();
    assert.equal(await thumbOf(), `/theoffice/api/building/thumb/${pub.slug}/midnight-rolls`, 'traversal ignored');
    setIndex('midnight-rolls', html('img/cover.png')); republish();
    assert.equal(await thumbOf(), `/theoffice/api/building/thumb/${pub.slug}/midnight-rolls`, 'missing file ignored');
    run(t.db, 'INSERT INTO published_files (floor_id,project,path,content,size) VALUES (?,?,?,?,?)', fid, 'midnight-rolls', 'img/cover.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]), 4); republish();
    assert.equal(await thumbOf(), `/theoffice/f/${pub.slug}/midnight-rolls/img/cover.png`, 'own image used');
    setIndex('midnight-rolls', html('index.html')); republish();
    assert.equal(await thumbOf(), `/theoffice/api/building/thumb/${pub.slug}/midnight-rolls`, 'only image files count');
    setIndex('midnight-rolls', original); republish();
  });

  test('making a project private removes it from the ticker and wall at once, cache or no cache', async () => {
    bust();
    const before = await ticker('?limit=60');
    const taskLines = (items) => items.filter((i) => /Find out who this is for|Build the mini-site|Pick the look|Write the launch brief/.test(i.text)).length;
    assert.ok(before.items.some((i) => i.url?.endsWith('/glass-teacups/')));
    assert.ok(taskLines(before.items) > 0);
    assert.ok((await wall()).projects.some((p) => p.slug === 'glass-teacups'));
    assert.equal((await pub.post(`/api/floors/${pub.slug}/projects/glass-teacups`, { private: true })).status, 200);
    const after = await ticker('?limit=60');
    assert.ok(!after.items.some((i) => i.url?.endsWith('/glass-teacups/')), 'launch line gone');
    assert.ok(!after.items.some((i) => /published glass-teacups$/.test(i.text)), 'its publish line gone');
    // Every project in mock mode uses the same task titles, so the ones under this project are the ones that went.
    assert.ok(taskLines(after.items) < taskLines(before.items), 'its task lines gone');
    assert.ok(after.items.some((i) => i.url?.endsWith('/glass-teacups-research/')), 'the still-public sibling stays');
    assert.ok(!(await wall()).projects.some((p) => p.slug === 'glass-teacups'));
    assert.equal((await visitor.raw('GET', `/api/building/thumb/${pub.slug}/glass-teacups`)).status, 404);
    assert.equal((await pub.post(`/api/floors/${pub.slug}/projects/glass-teacups`, { private: false })).status, 200);
    assert.ok((await ticker('?limit=60')).items.some((i) => i.url?.endsWith('/glass-teacups/')), 'and back again');
  });

  test('a suspended floor vanishes from both, and returns when reopened', async () => {
    const fid = get(t.db, 'SELECT id FROM floors WHERE slug=?', pub.slug).id;
    bust();
    assert.ok((await ticker()).items.length > 0);
    t.app.engine.setSuspended(fid, true);
    assert.equal((await ticker('?limit=60')).items.length, 0);
    assert.equal((await wall()).projects.length, 0);
    assert.equal((await visitor.raw('GET', `/api/building/thumb/${pub.slug}/midnight-rolls`)).status, 404);
    t.app.engine.setSuspended(fid, false);
    assert.ok((await ticker()).items.length > 0);
    assert.ok((await wall()).projects.length > 0);
  });

  test('filler floors are chatter in the ticker but never on the wall', async () => {
    const fid = get(t.db, 'SELECT id FROM floors WHERE slug=?', pub.slug).id;
    run(t.db, 'UPDATE floors SET filler=1 WHERE id=?', fid);
    const items = (await ticker('?limit=60')).items;
    assert.ok(items.length > 0);
    assert.ok(items.every((i) => i.filler === true));
    assert.equal((await wall()).projects.length, 0);
    assert.equal((await visitor.raw('GET', `/api/building/thumb/${pub.slug}/midnight-rolls`)).status, 404);
    run(t.db, 'UPDATE floors SET filler=0 WHERE id=?', fid);
    assert.ok((await ticker('?limit=60')).items.every((i) => i.filler === false));
    assert.ok((await wall()).projects.length > 0);
  });

  test('public endpoints: no cookie, no origin; other methods are 405; the cache is short', async () => {
    const r = await fetch(`${t.base}/api/building/ticker`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    for (const path of ['/api/building/ticker', '/api/building/launched', `/api/building/thumb/${pub.slug}/midnight-rolls`]) {
      for (const method of ['POST', 'PUT', 'DELETE']) {
        const x = await visitor.raw(method, path, { headers: { origin: `http://${t.host}` } });
        assert.equal(x.status, 405, `${method} ${path}`);
      }
    }
    const fid = get(t.db, 'SELECT id FROM floors WHERE slug=?', pub.slug).id;
    const n = (await ticker('?limit=60')).items.length;
    t.app.engine.feed(fid, null, 'The lift is back in service.', '');
    const soon = await ticker('?limit=60');
    assert.ok(soon.items.length === n || soon.items[0].text === 'The lift is back in service.', 'within the cache window the new line may wait');
    await new Promise((res) => setTimeout(res, 5100));
    const later = await ticker('?limit=60');
    assert.equal(later.items[0].text, 'The lift is back in service.');
    assert.equal(later.items[0].kind, 'feed');
  });
});

describe('building: the staff the strips show', () => {
  let t, visitor;
  before(async () => {
    t = await boot();
    visitor = new Client(t, { origin: null });
    await claim(t, 'Stair Co', { floor: 4 });
    const shut = await claim(t, 'Shut Co', { floor: 6 });
    const hidden = await claim(t, 'Ghost Co', { floor: 8 });
    run(t.db, 'UPDATE floors SET hidden=1 WHERE slug=?', hidden.slug);
    run(t.db, "UPDATE floors SET status='suspended' WHERE slug=?", shut.slug);
  });
  after(async () => { await t.close(); });

  test('an open floor\'s staff are listed', async () => {
    const r = await visitor.get('/api/building/staff');
    assert.equal(r.status, 200);
    assert.ok(r.data.floors[4].length >= 2, 'the staff are still there, as before');
    assert.equal(r.data.rooms, undefined, 'the rooms went with the 3D stack');
  });
  test('a hidden floor and one closed by the building manager are left out', async () => {
    const r = await visitor.get('/api/building/staff');
    for (const n of [6, 8]) assert.equal(r.data.floors[n], undefined, `staff ${n}`);
  });
});
