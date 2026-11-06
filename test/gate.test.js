// Runs the exact proxyOffice from docs/DEPLOY.md in front of the real app, the way hz will. No hz access involved.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../server/config.js';
import { boot, until, sleep } from './helpers.js';

const doc = readFileSync(join(ROOT, 'docs/DEPLOY.md'), 'utf8');
const src = doc.match(/function proxyOffice[\s\S]*?\n}\n/)[0].replace('port: 8083', 'port: UPSTREAM');
const routeLine = doc.match(/if \(p === '\/theoffice'.*$/m)[0];

describe('the gate patch from docs/DEPLOY.md', () => {
  let t, gate, origin, seen;
  before(async () => {
    t = await boot({ trustProxy: true, rateScale: 1 });
    const proxyOffice = new Function('http', 'UPSTREAM', `${src}; return proxyOffice;`)(http, t.port);
    const route = new Function('p', 'proxyOffice', 'req', 'res', `${routeLine} return false;`);
    gate = http.createServer((req, res) => {
      const p = new URL(req.url, 'http://x').pathname;
      if (route(p, proxyOffice, req, res) === false) { res.writeHead(200); res.end('private site'); }
    });
    await new Promise((r) => gate.listen(0, '127.0.0.1', r));
    origin = `http://127.0.0.1:${gate.address().port}`;
    t.cfg.publicOrigin = origin;
    seen = [];
    const inner = t.app.server.listeners('request')[0];
    t.app.server.removeAllListeners('request');
    t.app.server.on('request', (req, res) => { seen.push({ url: req.url, cookie: req.headers.cookie, xff: req.headers['x-forwarded-for'] }); inner(req, res); });
  });
  after(async () => { gate.closeAllConnections(); gate.close(); await t.close(); });
  const claim = async () => {
    const r = await fetch(`${origin}/theoffice/api/claim`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ code: t.code(), name: `Gate ${Math.random().toString(36).slice(2, 8)}`, bossName: 'G' }) });
    assert.equal(r.status, 201);
    const j = await r.json();
    return { ...j, cookie: r.headers.getSetCookie()[0].split(';')[0] };
  };

  test('only /theoffice is routed; the private site and /live are untouched', async () => {
    assert.equal(await (await fetch(`${origin}/`)).text(), 'private site');
    assert.equal(await (await fetch(`${origin}/live`)).text(), 'private site');
    assert.equal(await (await fetch(`${origin}/theofficeX`)).text(), 'private site');
    assert.equal((await fetch(`${origin}/theoffice/robots.txt`)).status, 200);
    assert.equal((await fetch(`${origin}/theoffice`)).status, 200);
  });
  test('a raw /theoffice/../live never reaches anything outside the app', async () => {
    const body = await new Promise((res, rej) => { const q = http.request({ host: '127.0.0.1', port: gate.address().port, path: '/theoffice/../live', method: 'GET' }, (r) => { let b = ''; r.on('data', (d) => { b += d; }); r.on('end', () => res({ s: r.statusCode, b })); }); q.on('error', rej); q.end(); });
    assert.notEqual(body.b, 'private site');
  });
  test('the site\'s password cookie is stripped, and The Office\'s own cookies pass', async () => {
    const f = await claim();
    seen.length = 0;
    const r = await fetch(`${origin}/theoffice/api/me`, { headers: { cookie: `bhq_auth=SITE-PASSWORD-COOKIE; ${f.cookie}; other=1` } });
    assert.equal((await r.json()).floor.slug, f.slug);
    assert.equal(seen[0].cookie, f.cookie);
    seen.length = 0;
    await fetch(`${origin}/theoffice/api/me`, { headers: { cookie: 'bhq_auth=SITE-PASSWORD-COOKIE' } });
    assert.equal(seen[0].cookie, undefined);
  });
  test('SSE comes through unbuffered, event by event', async () => {
    const f = await claim();
    const ctl = new AbortController();
    const res = await fetch(`${origin}/theoffice/api/floors/${f.slug}/stream`, { headers: { cookie: f.cookie }, signal: ctl.signal });
    assert.match(res.headers.get('content-type'), /text\/event-stream/); assert.equal(res.headers.get('x-accel-buffering'), 'no');
    const reader = res.body.getReader(); let text = ''; let chunks = 0;
    const pump = (async () => { try { for (;;) { const { value, done } = await reader.read(); if (done) return; chunks++; text += Buffer.from(value).toString(); } } catch { /* aborted */ } })();
    await sleep(40);
    const me = await (await fetch(`${origin}/theoffice/api/me`, { headers: { cookie: f.cookie } })).json();
    await fetch(`${origin}/theoffice/api/floors/${f.slug}/chat`, { method: 'POST', headers: { 'content-type': 'application/json', origin, cookie: f.cookie, 'x-office-csrf': me.csrf }, body: '{"text":"hello through the gate"}' });
    await until(() => /Three angles/.test(text), { what: 'reply through the gate' });
    assert.ok(chunks > 3, `arrived in ${chunks} chunks`);
    ctl.abort(); await pump;
    await until(() => t.app.bus.total === 0, { what: 'upstream closed when the browser left' });
  });
  test('PUBLIC_ORIGIN is enforced, and the rate limit keys on the real client', async () => {
    const f = await claim();
    const evil = await fetch(`${origin}/theoffice/api/logout`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.test', cookie: f.cookie }, body: '{}' });
    assert.equal(evil.status, 403);
    // Caddy appends the real client IP, so the rightmost hop is what counts, whatever a client claims to the left of it.
    const go = (xff) => fetch(`${origin}/theoffice/api/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin, 'x-forwarded-for': xff }, body: JSON.stringify({ slug: 'nobody', recoveryCode: 'x' }) });
    let last; for (let i = 0; i < 7; i++) last = await go(`8.8.8.${i}, 203.0.113.9`);
    assert.equal(last.status, 429);
    assert.equal((await go('203.0.113.10')).status, 401, 'a different real client is unaffected');
  });
});
