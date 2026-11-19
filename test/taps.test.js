// Tapped calls (docs/redesign/ROUND1-REST.md, job 33): a tap on a tel: link on a published page is counted once; the floor's boss's own tap, the
// admin's and a bot's are not; nothing personal is kept; the boss's Numbers tab and the owner's digest show the count, and Colon's ranked view
// counts it as real use. A first-party beacon is added only to pages with a tel: link and leaves the page's own scripts alone. Mock mode.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boot, claim, adminClient, floorState, hostFetch } from './helpers.js';
import { get, all, run } from '../server/db.js';
import { digestFacts, digestText } from '../server/owneralerts.js';
import { newFence } from '../server/help.js';
import { TAP_JS, injectTaps, cleanNumber } from '../server/taps.js';

const APPS = 'apps.localhost';
const VISITOR = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Mobile Safari/604.1';
const BOSS = 'Mozilla/5.0 (Macintosh) Chrome/131 boss-laptop';
const ADMIN = 'Mozilla/5.0 (Windows) Firefox/133 colin-desk';
const PAGE = '<!doctype html><html><head><title>Tires</title></head><body><h1>Tire Rx</h1><p><a href="tel:+1 (555) 010-2000">Call us</a></p><script>window.mine = 1;</script></body></html>';
const open = [];
after(async () => { for (const t of open) await t.close(); });

async function start(over = {}) {
  const t = await boot({ appsBaseDomain: APPS, appsScheme: 'http', publicOrigin: '', ...over });
  open.push(t);
  t.app.engine.runManager = async () => {};
  const c = await claim(t, 'TheTireRx');
  const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
  const publish = (slug, html, priv = 0) => {
    run(t.db, "INSERT INTO projects (floor_id,slug,title,kind,private,published_at,created_at) VALUES (?,?,?,'site',?,?,?)", f.id, slug, slug, priv, Date.now(), Date.now());
    run(t.db, 'INSERT INTO published_files (floor_id,project,path,content,size) VALUES (?,?,?,?,?)', f.id, slug, 'index.html', html, html.length);
  };
  const label = async (slug) => { await floorState(c); return get(t.db, 'SELECT label FROM app_labels WHERE floor_id=? AND project=?', f.id, slug).label; };
  const page = async (slug, path = '/') => hostFetch(t.port, path, { headers: { host: `${await label(slug)}.${APPS}`, 'user-agent': VISITOR } });
  const tap = async (slug, { ua = VISITOR, origin, number = '+1 (555) 010-2000', path = '/' } = {}) => {
    const host = `${await label(slug)}.${APPS}`;
    const body = JSON.stringify({ path, number });
    return hostFetch(t.port, '/_office/tap', { method: 'POST', body, headers: { host, 'user-agent': ua, origin: origin ?? `http://${host}`, 'sec-fetch-site': 'same-origin', 'content-type': 'text/plain' } });
  };
  const count = () => get(t.db, 'SELECT COUNT(*) n FROM tel_taps WHERE floor_id=?', f.id).n;
  return { t, c, f, publish, page, tap, count };
}

describe('the beacon on the page', () => {
  test('a page with a tel: link gets one first-party script, its own script untouched; a page without one gets nothing', async () => {
    const h = await start();
    h.publish('shop', PAGE); h.publish('plain', '<!doctype html><html><body><p>No phone here.</p></body></html>');
    const shop = await (await h.page('shop')).text();
    assert.equal(shop.match(/_office\/taps\.js/g).length, 1);
    assert.ok(shop.includes('<script>window.mine = 1;</script>'), 'the page\'s own script is as it was');
    assert.match(shop, /<script src="\/_office\/taps\.js" defer><\/script><\/body><\/html>$/);
    assert.doesNotMatch(shop, /https?:\/\/(?!localhost)[^"']*\.js/, 'no third-party script');
    assert.doesNotMatch(await (await h.page('plain')).text(), /taps\.js/);
    const js = await h.page('shop', '/_office/taps.js');
    assert.equal(js.status, 200); assert.match(js.headers.get('content-type'), /javascript/);
    // It listens and sends; it never stops a tap, never throws, and offline the beacon just fails.
    assert.doesNotMatch(TAP_JS, /preventDefault|stopPropagation|window\.\w+\s*=/);
    assert.match(TAP_JS, /try\{/); assert.match(TAP_JS, /sendBeacon/); assert.match(TAP_JS, /\.catch\(function\(\)\{\}\)/);
    assert.equal(injectTaps(injectTaps(PAGE)).match(/taps\.js/g).length, 1, 'added once');
  });
});

describe('counting', () => {
  test('a visitor\'s tap counts once; a repeat, a bot, another site, the boss and the admin don\'t; only floor, project, path, number and time are kept', async () => {
    const h = await start();
    h.publish('shop', PAGE);
    assert.equal((await h.tap('shop')).status, 204);
    assert.equal(h.count(), 1);
    await h.tap('shop');                                   // the same tap again, at once
    assert.equal(h.count(), 1, 'counted once');
    await h.tap('shop', { ua: 'Googlebot/2.1 (+http://www.google.com/bot.html)' });
    await h.tap('shop', { origin: 'https://evil.example' });
    assert.equal(h.count(), 1);
    // The boss uses the Office from their laptop; their own tap on their own site is not a customer.
    await h.c.raw('GET', `/api/floors/${h.c.slug}`, { headers: { 'user-agent': BOSS } });
    await h.tap('shop', { ua: BOSS });
    // Nor is Colon's.
    const admin = await adminClient(h.t);
    await admin.raw('GET', '/api/admin/overview', { headers: { 'user-agent': ADMIN } });
    await h.tap('shop', { ua: ADMIN });
    assert.equal(h.count(), 1);
    // Another visitor, another page and number: counted.
    await h.tap('shop', { ua: 'Mozilla/5.0 (Android 15) Chrome/131', path: '/contact', number: 'tel:555 010 9999' });
    assert.equal(h.count(), 2);
    const rows = all(h.t.db, 'SELECT * FROM tel_taps ORDER BY id');
    assert.deepEqual(Object.keys(rows[0]).sort(), ['created_at', 'floor_id', 'id', 'number', 'path', 'project']);
    assert.deepEqual(rows.map((r) => [r.project, r.path, r.number]), [['shop', '/', '+15550102000'], ['shop', '/contact', '5550109999']]);
    assert.doesNotMatch(JSON.stringify(rows), /127\.0\.0\.1|Mozilla|iPhone/);
  });
  test('a private project is never counted, and TAP_COUNT=0 adds no script and counts nothing', async () => {
    const h = await start();
    h.publish('hidden', PAGE, 1);
    await h.tap('hidden');
    assert.equal(h.count(), 0);
    h.publish('shop', PAGE);
    h.t.cfg.tapCount = false;
    assert.doesNotMatch(await (await h.page('shop')).text(), /taps\.js/);
    await h.tap('shop');
    assert.equal(h.count(), 0);
  });
  test('numbers keep their digits and a leading +', () => {
    assert.equal(cleanNumber('+1 (555) 010-2000'), '+15550102000');
    assert.equal(cleanNumber('555.010.2000;ext=9'), '55501020009');
    assert.equal(cleanNumber('call me'), '');
  });
});

describe('where the count shows', () => {
  test('the boss\'s Numbers tab, the owner\'s digest line for a business floor, and Colon\'s ranked view', async () => {
    const h = await start();
    h.publish('shop', PAGE);
    run(h.t.db, "INSERT INTO tasks (floor_id,title,plan,project,status,lane,created_at,updated_at) VALUES (?,'Answer the phone','','shop','done','business',?,?)", h.f.id, Date.now(), Date.now());
    await h.tap('shop'); await h.tap('shop', { ua: 'Mozilla/5.0 (Android 15) Chrome/131' });
    const nums = (await h.c.get(`/api/floors/${h.c.slug}/numbers`)).data;
    assert.deepEqual(nums.calls, { week: 2, ever: 2, show: true });
    const ui = readFileSync(new URL('../public/js/numbers-ui.js', import.meta.url), 'utf8');
    assert.ok(ui.includes('`Calls tapped: ${count(v.calls.week)} this week`'));
    const text = digestText(digestFacts(h.t.db, h.t.cfg, Date.now() + 1000), newFence());
    assert.match(text, new RegExp(`Calls tapped this week: floor ${h.f.number} .*TheTireRx.* 2\\.`));
    const admin = await adminClient(h.t);
    const row = (await admin.get('/api/admin/ranked')).data.floors.find((x) => x.id === h.f.id);
    assert.equal(row.windows[7].parts.taps, 2);
  });
});
