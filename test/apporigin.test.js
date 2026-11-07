// App-grade publishing and the project data API. Each project is its own origin. The adversary is a published page, or anyone on the web with its URL.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { get, all, run } from '../server/db.js';
import { writeFile, publishSnapshot } from '../server/workspace.js';
import { appLabel, appHostLabel, appCsp } from '../server/apps.js';
import { DATA_LIMITS } from '../server/appdata.js';
import { loadConfig } from '../server/config.js';
import { boot, claim, adminClient, Client, sleep } from './helpers.js';

const BASE = 'apps.test.example';
const TOKEN_A = 'a'.repeat(40), TOKEN_B = 'b'.repeat(40);

// node's fetch won't send a custom Host, so this speaks to the server the way a reverse proxy does.
function hit(t, host, path, { method = 'GET', headers = {}, body, type } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const h = { host, ...headers };
    if (data) { h['content-type'] = type ?? 'application/json'; h['content-length'] = data.length; }
    const q = http.request({ host: '127.0.0.1', port: t.port, method, path, headers: h }, (r) => {
      const chunks = []; r.on('data', (c) => chunks.push(c));
      r.on('end', () => { const text = Buffer.concat(chunks).toString(); let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ } resolve({ status: r.statusCode, headers: r.headers, text, json }); });
    });
    q.on('error', reject);
    if (data) q.write(data);
    q.end();
  });
}

function publish(t, floor, slug, files = {}, { title = slug, priv = false } = {}) {
  for (const [p, c] of Object.entries({ 'index.html': `<h1>${slug}</h1>`, ...files })) writeFile(t.db, floor.id, `projects/${slug}/${p}`, c, null, 1e8);
  publishSnapshot(t.db, floor.id, slug, 1e8);
  t.app.engine.upsertProject(floor, slug, { title, kind: 'site', published: true, makePrivate: priv });
  return `${appLabel(t.db, floor, slug)}.${BASE}`;
}
const own = (host, extra = {}) => ({ origin: `https://${host}`, 'sec-fetch-site': 'same-origin', ...extra });

describe('a project on its own origin', () => {
  let t, a, floorA, b, floorB, hostA, hostB, ownerCookie, adminCookie;
  before(async () => {
    t = await boot({ appsBaseDomain: BASE, appsScheme: 'https', publicOrigin: 'https://main.test.example' });
    t.cfg.publicOrigin = '';  // the helper client talks to 127.0.0.1
    a = await claim(t, 'Alpha Co'); b = await claim(t, 'Beta Co');
    floorA = get(t.db, 'SELECT * FROM floors WHERE slug=?', a.slug); floorB = get(t.db, 'SELECT * FROM floors WHERE slug=?', b.slug);
    hostA = publish(t, floorA, 'game'); hostB = publish(t, floorB, 'game');
    ownerCookie = `office_s=${a.cookies.office_s}`;
    const ad = await adminClient(t); adminCookie = `office_a=${ad.cookies.office_a}`;
  });
  after(() => t.close());

  test('labels are project--floor, and the same slug on two floors gets two origins', () => {
    assert.equal(hostA, `game--alpha-co.${BASE}`);
    assert.equal(hostB, `game--beta-co.${BASE}`);
  });
  test('labels stay valid DNS: under 63 characters, never reserved, never xn--', async () => {
    const long = 'p'.repeat(40);
    const lf = { id: 99, slug: 'f'.repeat(40) };
    const l = appLabel(t.db, lf, long);
    assert.ok(l.length <= 63, l); assert.match(l, /^[a-z0-9-]+$/); assert.ok(!l.endsWith('-'));
    for (const short of ['xn', 'ab']) { const x = appLabel(t.db, { id: 98, slug: 'floor' }, short); assert.notEqual(x.slice(2, 4), '--', x); assert.ok(!x.startsWith('xn--')); }
    assert.equal(appLabel(t.db, lf, long), l, 'stable');
  });
  test('a label is never reused for a new tenant after a floor is killed', async () => {
    const c = await claim(t, 'Gone Soon');
    const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
    const first = publish(t, f, 'site');
    const ad = await adminClient(t);
    await ad.post(`/api/admin/floors/${f.id}/kill`, {});
    assert.equal((await hit(t, first, '/')).status, 404);
    const c2 = await claim(t, 'Gone Soon');
    assert.equal(c2.slug, 'gone-soon', 'the slug is free again');
    const f2 = get(t.db, 'SELECT * FROM floors WHERE slug=?', c2.slug);
    assert.notEqual(publish(t, f2, 'site'), first);
    assert.equal((await hit(t, first, '/')).status, 404, 'the old origin stays dead rather than showing the new tenant');
  });
  test('serves the project at the root, with a locked-down origin policy', async () => {
    const r = await hit(t, hostA, '/');
    assert.equal(r.status, 200); assert.match(r.text, /<h1>game/);
    const csp = r.headers['content-security-policy'];
    assert.ok(!/sandbox/.test(csp), 'not in sandbox mode');
    assert.match(csp, /connect-src 'self'/); assert.match(csp, /form-action 'self'/); assert.match(csp, /default-src 'self'/);
    assert.ok(!csp.includes('main.test.example') || /frame-ancestors[^;]*main\.test\.example/.test(csp), 'the main site appears only as an allowed parent');
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.match(r.headers['x-robots-tag'], /noindex/);
    assert.equal(r.headers['referrer-policy'], 'no-referrer');
    assert.equal(r.headers['set-cookie'], undefined);
    assert.equal(r.headers['access-control-allow-origin'], undefined);
  });
  test('The Office and the private site do not exist on an app origin, whatever the path', async () => {
    for (const p of ['/theoffice', '/theoffice/', '/theoffice/api/me', '/theoffice/admin', '/theoffice/api/floors', '/theoffice/f/alpha-co/game/', '/live', '/admin', '/api/me', '/theoffice/../live', '/robots.txt']) {
      const r = await hit(t, hostA, p, { headers: { cookie: `${ownerCookie}; ${adminCookie}; bhq_auth=secret` } });
      assert.ok(r.status === 404 || (r.status === 200 && /<h1>game/.test(r.text)), `${p} -> ${r.status} ${r.text.slice(0, 40)}`);
      assert.ok(!/floors|csrf|adminCsrf/.test(r.text), p);
    }
    assert.equal((await hit(t, hostA, '/theoffice/api/claim', { method: 'POST', body: {} })).status, 405);
  });
  test('cookies that do reach an app origin mean nothing: no owner, no admin, no leak', async () => {
    const priv = publish(t, floorA, 'hidden', {}, { priv: true });
    for (const cookie of [ownerCookie, adminCookie, 'bhq_auth=secret', `${ownerCookie}; ${adminCookie}; bhq_auth=secret`]) {
      const r = await hit(t, priv, '/', { headers: { cookie } });
      assert.equal(r.status, 404, 'an owner cookie does not open a private project here');
      assert.equal(r.headers['set-cookie'], undefined);
    }
    const r = await hit(t, hostA, '/', { headers: { cookie: ownerCookie } });
    assert.ok(!r.text.includes(a.cookies.office_s));
  });
  test('The Office never sets a cookie with a Domain, so a browser cannot send it to any subdomain', async () => {
    const c = await claim(t, 'Cookie Check');
    const res = await c.raw('POST', '/api/logout', { body: {} });
    assert.equal(res.status, 200);
    const again = new Client(t);
    const r = await again.raw('POST', '/api/claim', { body: { code: t.code(), name: 'Cookie Check Two', bossName: 'B' } });
    const sc = r.headers.getSetCookie();
    assert.equal(sc.length, 1);
    assert.match(sc[0], /^office_s=/); assert.match(sc[0], /HttpOnly/); assert.match(sc[0], /Path=\/theoffice/);
    assert.ok(!/domain=/i.test(sc[0]), sc[0]);
    const ad = new Client(t);
    const ar = await ad.raw('POST', '/api/admin/login', { body: { password: 'correct horse battery' } });
    assert.ok(!/domain=/i.test(ar.headers.getSetCookie()[0]));
  });
  test('a planted second copy of the owner cookie is not believed', async () => {
    const r = await hit(t, '127.0.0.1', '/theoffice/api/me', { headers: { cookie: `office_s=planted; ${ownerCookie}` } });
    assert.equal(r.json.floor, null);
    const ok = await hit(t, '127.0.0.1', '/theoffice/api/me', { headers: { cookie: ownerCookie } });
    assert.equal(ok.json.floor.slug, a.slug);
  });
  test('The Office API refuses a published page, even with the owner\'s cookie attached', async () => {
    const chat = `/theoffice/api/floors/${a.slug}/chat`;
    const body = { text: 'spend all the money' };
    const before = all(t.db, 'SELECT id FROM messages WHERE floor_id=?', floorA.id).length;
    for (const headers of [{ origin: `https://${hostA}` }, { origin: `https://${hostA}`, 'sec-fetch-site': 'same-site' }, { 'sec-fetch-site': 'same-site' }, { referer: `https://${hostA}/` }, { origin: 'null' }]) {
      const r = await hit(t, '127.0.0.1', chat, { method: 'POST', body, headers: { cookie: ownerCookie, 'x-office-csrf': a.csrf, ...headers } });
      assert.equal(r.status, 403, JSON.stringify(headers));
    }
    for (const headers of [{ 'sec-fetch-site': 'same-site' }, { origin: `https://${hostA}` }, { referer: `https://${hostA}/` }]) {
      const r = await hit(t, '127.0.0.1', '/theoffice/api/me', { headers: { cookie: ownerCookie, ...headers } });
      assert.equal(r.status, 403);
      assert.equal(r.headers['access-control-allow-origin'], undefined);
    }
    assert.equal(all(t.db, 'SELECT id FROM messages WHERE floor_id=?', floorA.id).length, before);
  });
  test('anything else under the apps domain is a dead end, never the main app', async () => {
    for (const h of [BASE, `x.y.${BASE}`, `nope--nothing.${BASE}`, `-bad.${BASE}`, `a_b.${BASE}`, `${'x'.repeat(70)}.${BASE}`]) {
      const r = await hit(t, h, '/theoffice/api/me');
      assert.equal(r.status, 404, h);
      assert.ok(!r.json);
    }
    assert.equal((await hit(t, hostA.toUpperCase(), '/')).status, 200, 'hostnames are case-insensitive');
    assert.equal((await hit(t, `${hostA}.`, '/')).status, 200, 'a trailing dot is the same host');
    assert.ok(!(await hit(t, `${hostA}.`, '/theoffice/api/me')).json);
  });
  test('the friendly link redirects to the project origin and keeps the deep path', async () => {
    const r = await hit(t, '127.0.0.1', `/theoffice/f/${a.slug}/game/`);
    assert.equal(r.status, 302); assert.equal(r.headers.location, `https://${hostA}/`);
    assert.equal(r.headers['set-cookie'], undefined);
    const deep = await hit(t, '127.0.0.1', `/theoffice/f/${a.slug}/game/levels/one.html?x=1`);
    assert.equal(deep.headers.location, `https://${hostA}/levels/one.html?x=1`);
    assert.equal((await hit(t, '127.0.0.1', `/theoffice/f/${a.slug}/none/`)).status, 404);
  });
  test('a private project: hidden from visitors, and the owner gets a one-origin pass', async () => {
    const host = publish(t, floorA, 'secret', { 'app.js': 'ok' }, { priv: true });
    assert.equal((await hit(t, '127.0.0.1', `/theoffice/f/${a.slug}/secret/`)).status, 404);
    assert.equal((await hit(t, host, '/')).status, 404);
    assert.equal((await hit(t, host, '/_data/v1/shared/x')).status, 404);
    const sent = await hit(t, '127.0.0.1', `/theoffice/f/${a.slug}/secret/`, { headers: { cookie: ownerCookie } });
    assert.equal(sent.status, 302);
    const u = new URL(sent.headers.location);
    assert.equal(u.host, host); assert.match(u.pathname, /^\/~p\d+\./);
    const pass = await hit(t, host, u.pathname);
    assert.equal(pass.status, 302); assert.equal(pass.headers.location, '/');
    const sc = pass.headers['set-cookie'][0];
    assert.match(sc, /^__Host-office_preview=/); assert.match(sc, /HttpOnly/); assert.match(sc, /Secure/); assert.match(sc, /Path=\//); assert.ok(!/domain=/i.test(sc));
    const cookie = sc.split(';')[0];
    assert.equal((await hit(t, host, '/', { headers: { cookie } })).status, 200);
    assert.equal((await hit(t, host, '/app.js', { headers: { cookie } })).text, 'ok');
    assert.equal((await hit(t, hostA, '/_data/v1/shared/none', { headers: { cookie } })).status, 404, 'no effect elsewhere');
    const otherPriv = publish(t, floorA, 'secret2', {}, { priv: true });
    assert.equal((await hit(t, otherPriv, '/', { headers: { cookie } })).status, 404, 'a pass opens exactly one project');
    assert.equal((await hit(t, otherPriv, u.pathname)).status, 404, 'a link signed for one project is refused on another');
    assert.equal((await hit(t, host, '/', { headers: { cookie: 'office_preview=1.aaaaaaaaaaaaaaaaaaaaaaaaaaaa' } })).status, 404);
    assert.equal((await hit(t, host, '/', { headers: { cookie: `__Host-office_preview=1.${'a'.repeat(43)}` } })).status, 404);
  });
  test('an expired pass stops working', async () => {
    const host = publish(t, floorA, 'expiring', {}, { priv: true });
    const { signPreview, serverSecret } = await import('../server/auth.js');
    const exp = Math.floor(Date.now() / 1000) - 5;
    const sig = signPreview(serverSecret(t.db), floorA.id, 'expiring', exp);
    assert.equal((await hit(t, host, `/~p${exp}.${sig}/`)).status, 404);
    assert.equal((await hit(t, host, '/', { headers: { cookie: `__Host-office_preview=${exp}.${sig}` } })).status, 404);
  });
  test('a suspended floor\'s projects go dark, on both addresses', async () => {
    const c = await claim(t, 'Suspended Co');
    const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
    const host = publish(t, f, 'site');
    assert.equal((await hit(t, host, '/')).status, 200);
    t.app.engine.setSuspended(f.id, true);
    assert.equal((await hit(t, host, '/')).status, 404);
    assert.equal((await hit(t, '127.0.0.1', `/theoffice/f/${c.slug}/site/`)).status, 404);
  });
  test('no traversal on an app origin', async () => {
    for (const p of ['/../../etc/passwd', '/..%2f..%2fetc%2fpasswd', '/%2e%2e/%2e%2e/etc/passwd', '/a/../../b', '/%00', '/%ff', '/.git/config', '/.env', '/projects/game/index.html']) {
      const r = await hit(t, hostA, p);
      assert.ok(r.status === 404 || (r.status === 200 && /<h1>game/.test(r.text)), `${p}: ${r.status}`);
      assert.ok(!r.text.includes('root:'));
    }
  });
  test('a bad percent-escape cannot throw or crash the server', async () => {
    const r = await hit(t, hostA, '/_data/v1/shared/%zz');
    assert.ok(r.status === 400 || r.status === 404);
    assert.equal((await hit(t, hostA, '/')).status, 200);
  });
  test('a client-side route gets the app page, and a missing asset does not', async () => {
    assert.match((await hit(t, hostA, '/levels/three')).text, /<h1>game/);
    assert.equal((await hit(t, hostA, '/missing.js')).status, 404);
  });
  test('only GET and HEAD on project files, and no CORS preflight for anyone', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) assert.equal((await hit(t, hostA, '/index.html', { method })).status, 405);
    const r = await hit(t, hostA, '/_data/v1/shared/x', { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'PUT' } });
    assert.notEqual(r.status, 204); assert.equal(r.headers['access-control-allow-origin'], undefined);
  });
  test('the client library and Three.js come from the project\'s own origin, and win over a published file of that name', async () => {
    const host = publish(t, floorA, 'shadow', { '_office/client.js': 'stealCookies()' });
    const lib = await hit(t, host, '/_office/client.js');
    assert.equal(lib.status, 200); assert.match(lib.headers['content-type'], /javascript/);
    assert.match(lib.text, /window\.Office/); assert.ok(!lib.text.includes('stealCookies'));
    const three = await hit(t, host, '/_office/three.module.min.js');
    assert.equal(three.status, 200); assert.ok(three.text.length > 100000);
  });
  test('ETags let a browser revalidate cheaply', async () => {
    const r = await hit(t, hostA, '/');
    assert.ok(r.headers.etag);
    assert.equal((await hit(t, hostA, '/', { headers: { 'if-none-match': r.headers.etag } })).status, 304);
  });
  test('the on-demand TLS check answers only for real project origins', async () => {
    assert.equal((await hit(t, '127.0.0.1', `/theoffice/api/apps/tls-check?domain=${hostA}`)).status, 200);
    for (const d of [`nope--nothing.${BASE}`, BASE, `x.y.${BASE}`, 'evil.example', 'main.test.example', '']) assert.equal((await hit(t, '127.0.0.1', `/theoffice/api/apps/tls-check?domain=${d}`)).status, 404, d);
  });
  test('fetch_url refuses the apps domain as well as the main one', async () => {
    const { createTools } = await import('../server/tools.js');
    let denied;
    const tools = createTools({ db: t.db, cfg: t.cfg, engine: t.app.engine, fetcher: async (u, o) => { denied = o.denyHosts; return { url: u, status: 200, text: 'x' }; } });
    await tools.exec({ allowed: ['fetch_url'], floor: floorA, agent: { id: 1 }, say() {} }, 'fetch_url', JSON.stringify({ url: 'https://example.com' }));
    assert.ok(denied.includes(BASE));
  });
  test('the project API view offers its origin', async () => {
    const s = await a.get(`/api/floors/${a.slug}`);
    const p = s.data.projects.find((x) => x.slug === 'game');
    assert.equal(p.appUrl, `https://${hostA}/`);
    assert.equal(p.url, `/theoffice/f/${a.slug}/game/`);
  });
  test('the app CSP lets the main app frame projects; nothing else may', async () => {
    const r = await hit(t, '127.0.0.1', '/theoffice/robots.txt');
    assert.match(r.headers['content-security-policy'], new RegExp(`frame-src 'self' https://\\*\\.${BASE.replace(/\./g, '\\.')}`));
    const off = appCsp({ publicOrigin: 'https://main.example' });
    assert.match(off, /frame-ancestors 'self' https:\/\/main\.example/);
  });
});

describe('sandbox mode when no apps domain is set', () => {
  let t, a, floor;
  before(async () => { t = await boot({}); a = await claim(t, 'Plain Co'); floor = get(t.db, 'SELECT * FROM floors WHERE slug=?', a.slug); });
  after(() => t.close());
  test('friendly links still serve the sandboxed site directly', async () => {
    writeFile(t.db, floor.id, 'projects/s/index.html', 'hello', null, 1e8);
    publishSnapshot(t.db, floor.id, 's', 1e8);
    t.app.engine.upsertProject(floor, 's', { title: 's', kind: 'site', published: true });
    const r = await hit(t, `127.0.0.1:${t.port}`, `/theoffice/f/${a.slug}/s/`);
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-security-policy'], 'sandbox allow-scripts allow-forms allow-popups');
    const s = await a.get(`/api/floors/${a.slug}`);
    assert.equal(s.data.projects[0].appUrl, null);
  });
  test('there is no data API on the main domain, so all sandboxed sites cannot share one opaque origin\'s store', async () => {
    const r = await hit(t, `127.0.0.1:${t.port}`, `/theoffice/f/${a.slug}/s/_data/v1/shared/x`, { method: 'GET' });
    assert.equal(r.status, 404); assert.ok(!r.json);
    const w = await hit(t, `127.0.0.1:${t.port}`, `/theoffice/f/${a.slug}/s/_data/v1/shared/x`, { method: 'PUT', body: { value: 1 } });
    assert.equal(w.status, 405);
    assert.equal(all(t.db, 'SELECT * FROM app_kv').length, 0);
  });
  test('the client library and Three.js are still there for sandboxed pages, readable from an opaque origin', async () => {
    const r = await hit(t, `127.0.0.1:${t.port}`, `/theoffice/f/${a.slug}/s/_office/client.js`);
    assert.equal(r.status, 200); assert.equal(r.headers['access-control-allow-origin'], '*');
    assert.equal(r.headers['content-security-policy'], 'sandbox allow-scripts allow-forms allow-popups');
  });
  test('hosts are matched exactly, and config refuses a domain that contains the main site', () => {
    assert.equal(appHostLabel({ appsBaseDomain: '' }, 'x.apps.example.com'), null);
    assert.equal(appHostLabel({ appsBaseDomain: 'apps.example.com' }, 'evilapps.example.com'), null);
    assert.equal(appHostLabel({ appsBaseDomain: 'apps.example.com' }, 'example.com'), null);
    assert.equal(appHostLabel({ appsBaseDomain: 'apps.example.com' }, 'foo.apps.example.com'), 'foo');
    assert.equal(appHostLabel({ appsBaseDomain: 'apps.localhost:8083' }, 'foo.apps.localhost:8083'), 'foo');
    const c = (d, o = 'https://iscolinfree.com') => loadConfig({ APPS_BASE_DOMAIN: d, PUBLIC_ORIGIN: o }).appsBaseDomain;
    assert.equal(c('apps.iscolinfree.com'), 'apps.iscolinfree.com');
    assert.equal(c('other-domain.dev'), 'other-domain.dev');
    assert.equal(c('iscolinfree.com'), '', 'would serve published code on the main site');
    assert.equal(c('com'), '');
    assert.equal(c('app.iscolinfree.com', 'https://x.app.iscolinfree.com'), '');
    assert.equal(c(''), '');
    assert.equal(c('a b.example.com'), '');
    assert.equal(loadConfig({ APPS_BASE_DOMAIN: 'apps.localhost:8083' }).appsBaseDomain, 'apps.localhost:8083');
  });
});

describe('the project data API', () => {
  let t, a, floorA, b, floorB, hostA, hostA2, hostB;
  const headers = (host, token = TOKEN_A, extra = {}) => ({ ...own(host), 'x-office-player': token, ...extra });
  before(async () => {
    t = await boot({ appsBaseDomain: BASE, appsScheme: 'https', rateScale: 1000 });
    a = await claim(t, 'Data A Co'); b = await claim(t, 'Data B Co');
    floorA = get(t.db, 'SELECT * FROM floors WHERE slug=?', a.slug); floorB = get(t.db, 'SELECT * FROM floors WHERE slug=?', b.slug);
    hostA = publish(t, floorA, 'game'); hostA2 = publish(t, floorA, 'other'); hostB = publish(t, floorB, 'game');
  });
  after(() => t.close());
  const put = (host, path, value, h = headers(host)) => hit(t, host, `/_data/v1/${path}`, { method: 'PUT', body: { value }, headers: h });
  const read = (host, path, h = headers(host)) => hit(t, host, `/_data/v1/${path}`, { headers: h });

  test('a player saves and loads, and it survives between requests', async () => {
    assert.equal((await put(hostA, 'save/high', { score: 42 })).status, 200);
    const r = await read(hostA, 'save/high');
    assert.deepEqual(r.json.value, { score: 42 }); assert.equal(r.json.version, 1);
    assert.deepEqual((await read(hostA, 'save')).json.keys, ['high']);
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.equal((await hit(t, hostA, '/_data/v1/save/high', { method: 'DELETE', headers: headers(hostA) })).status, 200);
    assert.equal((await read(hostA, 'save/high')).status, 404);
  });
  test('players cannot read or list each other\'s saves', async () => {
    await put(hostA, 'save/mine', 'private to A');
    const other = headers(hostA, TOKEN_B);
    assert.equal((await read(hostA, 'save/mine', other)).status, 404);
    assert.deepEqual((await read(hostA, 'save', other)).json.keys, []);
    assert.equal((await hit(t, hostA, '/_data/v1/save/mine', { method: 'DELETE', headers: other })).status, 200);
    assert.equal((await read(hostA, 'save/mine')).json.value, 'private to A');
  });
  test('a save with no valid player token is refused', async () => {
    for (const tok of [undefined, '', 'short', 'x'.repeat(65), '../../etc', 'a b'.padEnd(40, 'c')]) {
      const h = own(hostA); if (tok !== undefined) h['x-office-player'] = tok;
      assert.equal((await read(hostA, 'save/x', h)).status, 400, String(tok));
    }
  });
  test('the token is stored only as a hash', () => {
    const scopes = all(t.db, "SELECT scope FROM app_kv WHERE scope LIKE 'p:%'").map((r) => r.scope);
    assert.ok(scopes.length);
    for (const s of scopes) { assert.ok(!s.includes(TOKEN_A)); assert.match(s, /^p:[0-9a-f]{64}$/); }
  });
  test('strict isolation: another floor or project, same names, sees nothing', async () => {
    await put(hostA, 'shared/motd', 'A only');
    await put(hostA, 'save/s', 'A save');
    await hit(t, hostA, '/_data/v1/board/top', { method: 'POST', body: { name: 'Ann', score: 10 }, headers: headers(hostA) });
    for (const host of [hostB, hostA2]) {
      assert.equal((await read(host, 'shared/motd')).status, 404, host);
      assert.equal((await read(host, 'save/s')).status, 404, host);
      assert.deepEqual((await read(host, 'board/top')).json.entries, [], host);
    }
    await put(hostB, 'shared/motd', 'B only');
    assert.equal((await read(hostA, 'shared/motd')).json.value, 'A only');
    assert.equal((await read(hostB, 'shared/motd')).json.value, 'B only');
  });
  test('a page on another origin cannot read or write, and there is no CORS', async () => {
    const evil = { 'x-office-player': TOKEN_A };
    for (const origin of [`https://${hostB}`, `https://${hostA2}`, 'https://evil.example', 'null', `http://${hostA}`]) {
      const r = await hit(t, hostA, '/_data/v1/shared/motd', { headers: { ...evil, origin } });
      assert.equal(r.status, 403, origin); assert.equal(r.headers['access-control-allow-origin'], undefined);
      const w = await hit(t, hostA, '/_data/v1/shared/motd', { method: 'PUT', body: { value: 'pwned' }, headers: { ...evil, origin } });
      assert.equal(w.status, 403, origin);
    }
    for (const site of ['cross-site', 'same-site']) assert.equal((await hit(t, hostA, '/_data/v1/shared/motd', { headers: { 'sec-fetch-site': site } })).status, 403);
    assert.equal((await hit(t, hostA, '/_data/v1/shared/motd', { method: 'PUT', body: { value: 'noorigin' }, headers: evil })).status, 403, 'a write with no Origin is refused');
    assert.equal((await read(hostA, 'shared/motd')).json.value, 'A only');
  });
  test('a form post cannot write: JSON only', async () => {
    const r = await hit(t, hostA, '/_data/v1/shared/motd', { method: 'PUT', body: 'value=pwned', type: 'application/x-www-form-urlencoded', headers: headers(hostA) });
    assert.equal(r.status, 415);
    const r2 = await hit(t, hostA, '/_data/v1/shared/motd', { method: 'PUT', body: '{"value":"pwned"}', type: 'text/plain', headers: headers(hostA) });
    assert.equal(r2.status, 415);
    assert.equal((await hit(t, hostA, '/_data/v1/shared/motd', { method: 'PUT', body: '{not json', headers: headers(hostA) })).status, 400);
    assert.equal((await hit(t, hostA, '/_data/v1/shared/motd', { method: 'PUT', body: '[1,2]', headers: headers(hostA) })).status, 400);
    assert.equal((await hit(t, hostA, '/_data/v1/shared/motd', { method: 'PUT', body: {}, headers: headers(hostA) })).status, 400);
  });
  test('validates keys and sizes', async () => {
    for (const k of ['a%20b', '%2e%2e', 'x'.repeat(65), '<script>', 'a%2Fb', 'a%00b']) { const st = (await put(hostA, `shared/${k}`, 1)).status; assert.ok(st === 400 || st === 404, `${k}: ${st}`); }
    assert.equal((await put(hostA, 'shared/big', 'x'.repeat(DATA_LIMITS.valueBytes + 10))).status, 413);
    assert.equal((await put(hostA, 'shared/huge', 'x'.repeat(DATA_LIMITS.bodyBytes + 10))).status, 413);
    assert.equal((await put(hostA, "shared/__proto__", { polluted: true })).status, 200);
    assert.equal(({}).polluted, undefined);
    assert.equal((await read(hostA, 'shared/__proto__')).json.value.polluted, true);
    assert.equal((await put(hostA, "shared/x' OR 1=1;--", 1)).status, 400);
  });
  test('shared state has counters and compare-and-swap', async () => {
    const incr = (by, h = headers(hostA)) => hit(t, hostA, '/_data/v1/shared/hits/incr', { method: 'POST', body: by === undefined ? {} : { by }, headers: h });
    assert.equal((await incr()).json.value, 1);
    assert.equal((await incr(4)).json.value, 5);
    assert.equal((await incr(-2)).json.value, 3);
    for (const by of [1.5, 'x', 1e7, null]) assert.equal((await incr(by)).status, 400, String(by));
    await put(hostA, 'shared/word', 'hello');
    assert.equal((await hit(t, hostA, '/_data/v1/shared/word/incr', { method: 'POST', body: {}, headers: headers(hostA) })).status, 409);
    const w = await read(hostA, 'shared/word');
    assert.equal((await hit(t, hostA, '/_data/v1/shared/word', { method: 'PUT', body: { value: 'a', ifVersion: w.json.version }, headers: headers(hostA) })).status, 200);
    assert.equal((await hit(t, hostA, '/_data/v1/shared/word', { method: 'PUT', body: { value: 'b', ifVersion: w.json.version }, headers: headers(hostA) })).status, 409);
    assert.equal((await read(hostA, 'shared/word')).json.value, 'a');
  });
  test('leaderboards keep one best score per player, in order, and mark yours', async () => {
    const post = (name, score, tok, extra = {}) => hit(t, hostA, '/_data/v1/board/ranked', { method: 'POST', body: { name, score, ...extra }, headers: headers(hostA, tok) });
    assert.equal((await post('Ann', 10, TOKEN_A)).json.improved, true);
    assert.equal((await post('Bob', 30, TOKEN_B)).json.improved, true);
    assert.equal((await post('Ann', 5, TOKEN_A)).json.improved, false);
    assert.equal((await post('Ann', 50, TOKEN_A)).json.improved, true);
    const board = (await read(hostA, 'board/ranked')).json.entries;
    assert.deepEqual(board.map((e) => [e.rank, e.name, e.score, e.you]), [[1, 'Ann', 50, true], [2, 'Bob', 30, false]]);
    assert.ok(!JSON.stringify(board).includes('player'));
    assert.deepEqual((await read(hostA, 'board/ranked?limit=1')).json.entries.map((e) => e.name), ['Ann']);
    await hit(t, hostA, '/_data/v1/board/fastest', { method: 'POST', body: { name: 'A', score: 9, lower: true }, headers: headers(hostA, TOKEN_A) });
    await hit(t, hostA, '/_data/v1/board/fastest', { method: 'POST', body: { name: 'A', score: 7, lower: true }, headers: headers(hostA, TOKEN_A) });
    assert.equal((await read(hostA, 'board/fastest?order=asc')).json.entries[0].score, 7);
  });
  test('leaderboard input is validated and markup never reaches another player', async () => {
    const post = (b) => hit(t, hostA, '/_data/v1/board/bad', { method: 'POST', body: b, headers: headers(hostA) });
    for (const score of ['12', null, 1e16, -1e16, [], {}]) assert.equal((await post({ name: 'x', score })).status, 400, String(score));
    assert.equal((await hit(t, hostA, '/_data/v1/board/bad', { method: 'POST', body: '{"name":"x","score":1e999}', headers: headers(hostA) })).status, 400);
    await post({ name: '<img src=x onerror=alert(1)>"\'`&\u0000\u2028', score: 1 });
    const e = (await read(hostA, 'board/bad')).json.entries[0];
    assert.ok(!/[<>"'`&\u0000\u2028]/.test(e.name), e.name);
    await hit(t, hostA, '/_data/v1/board/bad', { method: 'POST', body: { name: 'x'.repeat(100), score: 2 }, headers: headers(hostA) });
    assert.ok((await read(hostA, 'board/bad')).json.entries[0].name.length <= 24);
    assert.equal(await hit(t, hostA, '/_data/v1/board/bad', { method: 'POST', body: { name: '', score: 3 }, headers: headers(hostA) }).then(async () => (await read(hostA, 'board/bad')).json.entries[0].name), 'Anonymous');
  });
  test('quotas hold: per player, per project, keys, boards and board size', async () => {
    const c = await claim(t, 'Quota Co');
    const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
    const host = publish(t, f, 'q');
    for (let i = 0; i < DATA_LIMITS.playerKeys; i++) run(t.db, 'INSERT INTO app_kv (floor_id,project,scope,key,value,size,version,updated_at) VALUES (?,?,?,?,?,?,1,0)', f.id, 'q', `p:${(await import('node:crypto')).createHash('sha256').update(TOKEN_A).digest('hex')}`, `k${i}`, '1', 1);
    assert.equal((await put(host, 'save/onemore', 1)).status, 507);
    assert.equal((await put(host, 'save/k1', 2)).status, 200, 'overwriting is fine');
    run(t.db, 'INSERT INTO app_kv (floor_id,project,scope,key,value,size,version,updated_at) VALUES (?,?,?,?,?,?,1,0)', f.id, 'q', 'shared', 'filler', '"x"', DATA_LIMITS.projectBytes, );
    assert.equal((await put(host, 'shared/more', 'y')).status, 507);
    assert.equal((await hit(t, host, '/_data/v1/shared/more/incr', { method: 'POST', body: {}, headers: headers(host) })).status, 507);
    assert.equal((await hit(t, host, '/_data/v1/board/b', { method: 'POST', body: { name: 'x', score: 1 }, headers: headers(host) })).status, 507);
    const c2 = await claim(t, 'Boards Co');
    const f2 = get(t.db, 'SELECT * FROM floors WHERE slug=?', c2.slug);
    const host2 = publish(t, f2, 'q');
    for (let i = 0; i < DATA_LIMITS.boards; i++) run(t.db, 'INSERT INTO app_scores (floor_id,project,board,player,name,score,updated_at) VALUES (?,?,?,?,?,?,0)', f2.id, 'q', `b${i}`, 'p', 'n', 1);
    assert.equal((await hit(t, host2, '/_data/v1/board/newone', { method: 'POST', body: { name: 'x', score: 1 }, headers: headers(host2) })).status, 507);
    for (let i = 0; i < DATA_LIMITS.boardEntries; i++) run(t.db, 'INSERT INTO app_scores (floor_id,project,board,player,name,score,updated_at) VALUES (?,?,?,?,?,?,0)', f2.id, 'q', 'b0', `p${i}`, 'n', 100 + i);
    const low = await hit(t, host2, '/_data/v1/board/b0', { method: 'POST', body: { name: 'x', score: 1 }, headers: headers(host2) });
    assert.equal(low.json.improved, false, 'too low for a full board');
    const high = await hit(t, host2, '/_data/v1/board/b0', { method: 'POST', body: { name: 'x', score: 1e6 }, headers: headers(host2) });
    assert.equal(high.json.improved, true);
    assert.ok(get(t.db, "SELECT COUNT(*) n FROM app_scores WHERE floor_id=? AND board='b0'", f2.id).n <= DATA_LIMITS.boardEntries + 1);
  });
  test('a floor-wide data cap stops many projects adding up', async () => {
    const c = await claim(t, 'Wide Co');
    const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
    const host = publish(t, f, 'one');
    run(t.db, 'INSERT INTO app_kv (floor_id,project,scope,key,value,size,version,updated_at) VALUES (?,?,?,?,?,?,1,0)', f.id, 'elsewhere', 'shared', 'filler', '"x"', DATA_LIMITS.floorBytes);
    assert.equal((await put(host, 'shared/x', 1)).status, 507);
  });
  test('rate limits apply per visitor and per project', async () => {
    const r = await boot({ appsBaseDomain: BASE, appsScheme: 'https', rateScale: 1 });
    try {
      const c = await claim(r, 'Rate Co');
      const f = get(r.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
      const host = publish(r, f, 'q');
      let limited = 0;
      for (let i = 0; i < 95; i++) { const x = await hit(r, host, '/_data/v1/shared/x', { method: 'PUT', body: { value: i }, headers: headers(host) }); if (x.status === 429) { limited++; assert.equal(x.headers['retry-after'], '30'); } }
      assert.ok(limited >= 4, `limited ${limited}`);
      let read429 = 0;
      for (let i = 0; i < 610; i++) if ((await hit(r, host, '/_data/v1/shared/x', { headers: headers(host) })).status === 429) read429++;
      assert.ok(read429 >= 5, `read limited ${read429}`);
    } finally { await r.close(); }
  });
  test('nothing a player sends spends money or wakes an agent', async () => {
    const before = all(t.db, 'SELECT id FROM ledger').length;
    const wake = get(t.db, 'SELECT manager_wake w FROM floors WHERE id=?', floorA.id).w;
    await put(hostA, 'shared/poke', 'build me a game');
    await sleep(30);
    assert.equal(all(t.db, 'SELECT id FROM ledger').length, before);
    assert.equal(get(t.db, 'SELECT manager_wake w FROM floors WHERE id=?', floorA.id).w, wake);
    assert.equal(all(t.db, "SELECT id FROM tasks WHERE floor_id=?", floorA.id).length, 0);
  });
  test('resetting or killing a floor removes its data, and only its data', async () => {
    const ad = await adminClient(t);
    await put(hostB, 'shared/keep', 'stay');
    assert.equal((await ad.post(`/api/admin/floors/${floorA.id}/reset`, {})).status, 200);
    assert.equal(all(t.db, 'SELECT 1 FROM app_kv WHERE floor_id=?', floorA.id).length, 0);
    assert.equal(all(t.db, 'SELECT 1 FROM app_scores WHERE floor_id=?', floorA.id).length, 0);
    assert.equal((await read(hostB, 'shared/keep')).json.value, 'stay');
    assert.equal((await hit(t, hostA, '/')).status, 404);
  });
  test('published code can\'t reach server-side anything: no route runs agent files', async () => {
    const c = await claim(t, 'Script Co');
    const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
    const host = publish(t, f, 'q', { 'api.js': 'process.exit(1)', 'server.mjs': 'process.exit(1)' });
    const r = await hit(t, host, '/api.js');
    assert.equal(r.text, 'process.exit(1)'); assert.match(r.headers['content-type'], /javascript/);
    assert.equal((await hit(t, host, '/api.js', { method: 'POST', body: {} })).status, 405);
    assert.equal((await hit(t, host, '/')).status, 200);
  });
  test('logs never hold a player token', () => { assert.ok(!t.logs.join('\n').includes(TOKEN_A)); });
});
