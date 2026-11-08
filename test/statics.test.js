// The static app: stamped URLs, one URL per module, long caching only for the exact version, and compression that never lies.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { boot } from './helpers.js';
import { buildStatics, pickEncoding, wantBrotli } from '../server/statics.js';
import { ROOT } from '../server/config.js';
import { layoutLabels } from '../public/js/labels.js';
import { frameCrew, onScreen, aimAt } from '../public/js/framing.js';
import { slugFrom } from '../public/js/looks.js';
import { slugify } from '../server/workspace.js';

const PUB = join(ROOT, 'public');
const statics = buildStatics(PUB, '/theoffice');
const IMPORTS = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"](\.{1,2}\/[^'"]+)['"]/g;

describe('stamping', () => {
  test('every relative import in every module carries its target\'s current version', () => {
    let seen = 0;
    for (const [path, file] of statics) {
      if (!path.endsWith('.js') || path === '/vendor/three/three.module.min.js') continue;
      for (const m of file.body.toString('utf8').matchAll(IMPORTS)) {
        const [spec, v] = m[1].split('?v=');
        assert.ok(v, `${path} imports ${m[1]} with no version`);
        const parts = path.split('/').slice(0, -1);
        for (const seg of spec.split('/')) { if (seg === '..') parts.pop(); else if (seg !== '.') parts.push(seg); }
        const target = statics.get(parts.join('/'));
        assert.ok(target, `${path} imports ${spec}, which does not exist`);
        assert.equal(v, target.version, `${path} -> ${spec}`);
        seen++;
      }
    }
    assert.ok(seen > 30, `only ${seen} imports checked`);
  });
  test('three is one module: the app and the addons bundle name exactly the same URL for it', () => {
    const three = statics.get('/vendor/three/three.module.min.js');
    const addons = statics.get('/vendor/three/addons.module.min.js').body.toString('utf8');
    const stage = statics.get('/js/stage.js').body.toString('utf8');
    assert.match(addons, new RegExp(`"\\./three\\.module\\.min\\.js\\?v=${three.version}"`));
    assert.match(stage, new RegExp(`'\\.\\./vendor/three/three\\.module\\.min\\.js\\?v=${three.version}'`));
    assert.doesNotMatch(addons, /three\.module\.min\.js["']/);
  });
  test('the page, the stylesheets and the models folder are stamped; the files on disk are not touched', () => {
    const page = statics.get('/index.html').body.toString('utf8');
    for (const m of page.matchAll(/(?:src|href)="(\/theoffice\/[^"]+)"/g)) assert.match(m[1], /\?v=[0-9a-f]{12}$/, m[1]);
    const css = statics.get('/css/app.css').body.toString('utf8');
    assert.match(css, /url\(\/theoffice\/assets\/fonts\/lilita-one-400\.woff2\?v=[0-9a-f]{12}\)/);
    const models = statics.get('/js/models.js').body.toString('utf8');
    assert.doesNotMatch(models, /__MODELS_V__/);
    assert.match(readFileSync(join(PUB, 'js/models.js'), 'utf8'), /__MODELS_V__/);
    assert.match(models, new RegExp(`MODELS_V = '${statics.get('/models/characters/character-male-a.glb').version}'`));
  });
  test('published sites still get three byte for byte', () => {
    assert.deepEqual(statics.get('/vendor/three/three.module.min.js').body, readFileSync(join(PUB, 'vendor/three/three.module.min.js')));
  });
});

describe('compression', () => {
  test('brotli, once it has landed, gzip until then, plain when nothing is accepted', async () => {
    const file = statics.get('/css/app.css');
    assert.equal(pickEncoding(file, 'identity').encoding, null);
    assert.equal(pickEncoding(file, 'gzip, deflate').encoding, 'gzip');
    assert.deepEqual(gunzipSync(pickEncoding(file, 'gzip').body), file.body);
    await wantBrotli(file);
    const br = pickEncoding(file, 'gzip, deflate, br');
    assert.equal(br.encoding, 'br');
    assert.ok(br.body.length < file.gz.length);
    assert.deepEqual(brotliDecompressSync(br.body), file.body);
  });
  test('fonts and images are never compressed again', () => {
    assert.equal(pickEncoding(statics.get('/assets/fonts/lilita-one-400.woff2'), 'br, gzip').encoding, null);
    assert.equal(pickEncoding(statics.get('/models/characters/Textures/colormap.png'), 'br, gzip').encoding, null);
  });
});

describe('over HTTP', () => {
  let t, port, page, stamped;
  const get = (path, headers = {}) => fetch(`http://127.0.0.1:${port}/theoffice${path}`, { headers: { 'accept-encoding': 'gzip', ...headers } });
  before(async () => {
    t = await boot(); port = t.port;
    page = await (await get('/')).text();
    stamped = page.match(/\/theoffice(\/js\/main\.js\?v=[0-9a-f]{12})/)[1];
  });
  after(() => t.close());
  test('a stamped URL is cached for good, with the security headers intact', async () => {
    const r = await get(stamped);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
    assert.doesNotMatch(r.headers.get('content-security-policy'), /unsafe-inline|https?:/);
  });
  test('a wrong or missing stamp is never pinned', async () => {
    const stale = await get('/js/main.js?v=000000000000');
    assert.equal(stale.status, 200);
    assert.equal(stale.headers.get('cache-control'), 'no-cache');
    const plain = await get('/js/main.js');
    assert.equal(plain.headers.get('cache-control'), 'public, max-age=3600');
  });
  test('the page revalidates, and an unchanged one costs a 304 with no body', async () => {
    const first = await get('/');
    assert.equal(first.headers.get('cache-control'), 'no-cache');
    const etag = first.headers.get('etag');
    assert.ok(etag);
    const again = await get('/', { 'if-none-match': etag });
    assert.equal(again.status, 304);
    assert.equal((await again.text()).length, 0);
    assert.match(again.headers.get('content-security-policy'), /script-src 'self'/);
  });
  test('path tricks still find nothing, with or without a stamp', async () => {
    for (const p of ['/../server/app.js?v=1', '/js/../../package.json?v=1', '/.env?v=1']) assert.equal((await get(p)).status, 404, p);
  });
});

describe('labels in a huddle', () => {
  const person = (id, x, y, z, bubble = 0, priority = 1) => ({ id, x, y, z, nameW: 40, nameH: 14, bubbleW: bubble, bubbleH: bubble ? 20 : 0, side: 'right', priority });
  const boxes = (items, solved) => {
    const out = [];
    for (const it of items) {
      const o = solved.get(it.id);
      out.push({ who: `${it.id} name`, x0: it.x - 20, x1: it.x + 20, y0: it.y - it.nameH - o.lift, y1: it.y - o.lift });
      if (o.bubble) {
        const left = it.x - 20, y1 = it.y - o.lift - it.nameH - 5 - o.by;
        out.push(o.side === 'right' ? { who: `${it.id} bubble`, x0: left + 40 * 0.58 + o.bx, x1: left + 40 * 0.58 + o.bx + it.bubbleW, y0: y1 - it.bubbleH, y1 } : { who: `${it.id} bubble`, x0: left + 40 * 0.42 + o.bx - it.bubbleW, x1: left + 40 * 0.42 + o.bx, y0: y1 - it.bubbleH, y1 });
      }
    }
    return out;
  };
  const clashes = (list) => { const c = []; for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) { const a = list[i], b = list[j]; if (a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0) c.push(`${a.who} x ${b.who}`); } return c; };
  test('five people at one table: no two labels touch, and the nearest name stays put', () => {
    const items = [person('a', 200, 300, 5), person('b', 208, 302, 4, 100, 3), person('c', 195, 298, 3, 90, 2), person('d', 212, 305, 2, 90, 1), person('e', 202, 296, 1, 80, 1)];
    const solved = layoutLabels(items, { width: 390 });
    assert.deepEqual(clashes(boxes(items, solved)), []);
    assert.equal(solved.get('a').lift, 0);
    assert.ok(solved.get('b').bubble, 'the one talking keeps a bubble');
  });
  test('people apart keep their places and their bubbles', () => {
    const items = [person('a', 60, 300, 2, 90), person('b', 300, 300, 1, 90)];
    const solved = layoutLabels(items, { width: 1000 });
    for (const id of ['a', 'b']) { assert.equal(solved.get(id).lift, 0); assert.equal(solved.get(id).bubble, true); }
  });
  test('a bubble that would run off the edge flips to the side with room', () => {
    const items = [{ ...person('a', 370, 300, 1, 110), side: 'right' }];
    assert.equal(layoutLabels(items, { width: 390 }).get('a').side, 'left');
  });
  test('a phone shows only as many bubbles as it is told to, whoever is talking first', () => {
    const items = [person('a', 60, 300, 1, 90, 1), person('b', 200, 300, 2, 90, 9), person('c', 320, 300, 3, 90, 9), person('d', 200, 500, 4, 90, 2)];
    const solved = layoutLabels(items, { width: 390, calm: true, maxBubbles: 2 });
    assert.deepEqual([...solved].filter(([, o]) => o.bubble).map(([id]) => id).sort(), ['b', 'c']);
  });
  test('nothing touches the header or the lift, and on a phone a name with no room of its own steps aside', () => {
    const header = { x0: 0, y0: 0, x1: 300, y1: 80 }, lift = { x0: 320, y0: 0, x1: 390, y1: 130 };
    const items = [{ ...person('a', 150, 150, 2, 120, 9), full: true }, person('b', 350, 100, 1), person('c', 150, 148, 1)];
    const solved = layoutLabels(items, { width: 390, calm: true, top: 4, blocks: [header, lift] });
    const o = solved.get('a'), left = 150 - 20, y1 = 150 - o.lift - 14 - 5 - o.by;
    const bubble = o.side === 'right' ? { x0: left + 40 * 0.58 + o.bx, x1: left + 40 * 0.58 + o.bx + 120, y0: y1 - 20, y1 } : { x0: left + 40 * 0.42 + o.bx - 120, x1: left + 40 * 0.42 + o.bx, y0: y1 - 20, y1 };
    assert.equal(o.bubble, true);
    for (const b of [header, lift]) assert.ok(bubble.x1 <= b.x0 || bubble.x0 >= b.x1 || bubble.y1 <= b.y0 || bubble.y0 >= b.y1, JSON.stringify({ bubble, b }));
    assert.equal(solved.get('b').name, false, 'its name would be under the lift');
    assert.equal(solved.get('c').name, false, 'its name would be on top of the person talking');
  });
  test('a bubble with no room anywhere waits rather than covering someone', () => {
    const items = [person('a', 50, 96, 1, 400)];
    const solved = layoutLabels(items, { width: 100 });
    assert.equal(solved.get('a').bubble, false);
  });
});

describe('where the camera starts', () => {
  const opts = { yaw: 1.02, pitch: 0.68, visW: 390, visH: 563, tall: 2.5, top: 96, pad: 52, ppuMax: 34, ppuMin: 28 };
  test('a small team fills the frame as close as it can', () => {
    const f = frameCrew([[0, 0], [2.5, 1]], opts);
    assert.equal(f.ppu, 34); assert.equal(f.framed, 2);
  });
  test('a floor too spread out for one picture frames the biggest group, close up, not everyone tiny', () => {
    const f = frameCrew([[-13, -7], [-9, -7], [-4, -7], [0, -7], [4, -7], [12, -7]], opts);
    assert.ok(f.framed >= 3 && f.framed < 6, `framed ${f.framed}`);
    assert.ok(f.ppu >= 28, `ppu ${f.ppu}`);
  });
  test('what it aims at lands the group where it says', () => {
    const f = frameCrew([[3, 2], [5, 3]], opts);
    const aim = aimAt(f.u, f.s, opts.yaw, opts.pitch);
    const back = onScreen(aim, opts.yaw, opts.pitch);
    assert.ok(Math.abs(back.u - f.u) < 1e-6);
  });
});

describe('signing in by name', () => {
  test('a company name typed the way people remember it reaches the same floor as the server\'s slug', () => {
    for (const name of ['Night Bakery', 'night bakery ', 'Cafés & Co.', 'Tiny   Teacups!', 'A very long company name that goes well past the forty character limit', 'Ünïcode Ünlimited']) {
      assert.equal(slugFrom(name), slugify(name), name);
    }
  });
  test('the whole link works, and so does the bare slug', () => {
    assert.equal(slugFrom('https://iscolinfree.com/theoffice/floor/night-bakery'), 'night-bakery');
    assert.equal(slugFrom('https://iscolinfree.com/theoffice/floor/night-bakery/?x=1'), 'night-bakery');
    assert.equal(slugFrom('night-bakery'), 'night-bakery');
  });
});
