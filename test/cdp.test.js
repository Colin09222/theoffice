// The building's shared headless browser (server/cdp.js; redesign job 28). The smoke check speaks the DevTools protocol to the `shots` service when
// SHOTS_CDP_URL is set: the page loads, console errors count, a screenshot is saved to the job; with the browser down it falls back to the HTTP check.
// A mock DevTools endpoint stands in for Chromium here (an HTTP server with a hand-rolled WebSocket), and a real headless shell is used too when this
// machine has one.
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boot, claim, until, sleep } from './helpers.js';
import { get, run } from '../server/db.js';
import { readFile } from '../server/workspace.js';
import { cdpPage, cdpBase } from '../server/cdp.js';
import { smokeCheck } from '../server/smoke.js';
import { loadConfig } from '../server/config.js';

const open = [];
after(async () => { for (const t of open) await t.close(); });
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);

/** A WebSocket frame from the server: unmasked text. */
function frame(text) {
  const body = Buffer.from(text);
  const head = body.length < 126 ? Buffer.from([0x81, body.length]) : body.length < 65536 ? Buffer.from([0x81, 126, body.length >> 8, body.length & 255]) : (() => { const b = Buffer.alloc(10); b[0] = 0x81; b[1] = 127; b.writeBigUInt64BE(BigInt(body.length), 2); return b; })();
  return Buffer.concat([head, body]);
}
/** Client frames, masked, as text. */
function* frames(buf) {
  let i = 0;
  while (i + 2 <= buf.length) {
    let len = buf[i + 1] & 127, off = i + 2;
    if (len === 126) { len = buf.readUInt16BE(off); off += 2; } else if (len === 127) { len = Number(buf.readBigUInt64BE(off)); off += 8; }
    const mask = buf.subarray(off, off + 4); off += 4;
    if (off + len > buf.length) return;
    const data = Buffer.from(buf.subarray(off, off + len)).map((b, k) => b ^ mask[k % 4]);
    yield { op: buf[i] & 15, text: data.toString('utf8') };
    i = off + len;
  }
}
/**
 * A DevTools endpoint that answers the calls server/cdp.js makes. `page(url)` says what the "page" does: { status, console: [...], exception, fail }.
 * Like Chrome, it refuses a Host header that is a name rather than an address.
 */
async function mockCdp(page) {
  const seen = { navigated: [], contexts: 0, disposed: 0, hosts: [] };
  const srv = createServer((req, res) => {
    seen.hosts.push(req.headers.host);
    if (!/^(\d+\.\d+\.\d+\.\d+|localhost)(:\d+)?$/.test(req.headers.host || '')) { res.writeHead(500).end('Host header is specified and is not an IP address or localhost.'); return; }
    if (req.url !== '/json/version') { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ Browser: 'HeadlessChrome/mock', webSocketDebuggerUrl: `ws://${req.headers.host}/devtools/browser/abc` }));
  });
  srv.on('upgrade', (req, socket) => {
    const accept = createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const send = (o) => socket.write(frame(JSON.stringify(o)));
    let buf = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      let used = 0;
      for (const f of frames(buf)) {
        used += 0;  // frames() only yields whole frames; the buffer is reset below once read
        if (f.op === 8) { socket.end(); return; }
        const m = JSON.parse(f.text);
        const reply = (result) => send({ id: m.id, result, ...(m.sessionId ? { sessionId: m.sessionId } : {}) });
        const ev = (method, params) => send({ method, params, sessionId: 'S1' });
        if (m.method === 'Target.createBrowserContext') { seen.contexts++; reply({ browserContextId: 'C1' }); }
        else if (m.method === 'Target.createTarget') reply({ targetId: 'T1' });
        else if (m.method === 'Target.attachToTarget') reply({ sessionId: 'S1' });
        else if (m.method === 'Target.disposeBrowserContext') { seen.disposed++; reply({}); }
        else if (m.method === 'Page.navigate') {
          seen.navigated.push(m.params.url);
          const p = page(m.params.url);
          if (p.fail) { reply({ frameId: 'F', errorText: p.fail }); continue; }
          reply({ frameId: 'F', loaderId: 'L' });
          ev('Network.responseReceived', { type: 'Document', response: { status: p.status ?? 200 } });
          for (const c of p.console || []) ev('Runtime.consoleAPICalled', { type: 'error', args: [{ type: 'string', value: c }] });
          if (p.exception) ev('Runtime.exceptionThrown', { exceptionDetails: { text: 'Uncaught', exception: { description: p.exception } } });
          ev('Page.loadEventFired', { timestamp: 1 });
        } else if (m.method === 'Page.captureScreenshot') reply({ data: JPEG.toString('base64') });
        else reply({});
      }
      buf = Buffer.alloc(0);
    });
    socket.on('error', () => {});
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  open.push({ close: () => new Promise((r) => { srv.closeAllConnections?.(); srv.close(() => r()); }) });
  return { seen, port: srv.address().port };
}
const byName = (port) => ({ cdpUrl: `http://shots:${port}`, resolve: async (h) => { assert.equal(h, 'shots'); return { address: '127.0.0.1', family: 4 }; } });

describe('the shared browser over the DevTools protocol', () => {
  test('a page in a fresh context: its status, console errors and page errors, and a JPEG; the context is thrown away after', async () => {
    const m = await mockCdp((url) => (/bad/.test(url) ? { console: ['boom'], exception: "TypeError: Cannot read properties of undefined (reading 'go')" } : {}));
    const { cdpUrl, resolve } = byName(m.port);
    const good = await cdpPage(cdpUrl, 'http://theoffice:8083/theoffice/f/acme/site/', { resolve, settleMs: 0 });
    assert.equal(good.ok, true); assert.equal(good.status, 200); assert.deepEqual(good.errors, []); assert.deepEqual(good.shot, JPEG);
    const bad = await cdpPage(cdpUrl, 'http://theoffice:8083/theoffice/f/acme/bad/', { resolve, settleMs: 0 });
    assert.equal(bad.ok, false); assert.deepEqual(bad.errors, ['console: boom', "error: TypeError: Cannot read properties of undefined (reading 'go')"]);
    assert.equal(m.seen.contexts, 2); assert.equal(m.seen.disposed, 2, 'each check\'s context is closed');
    assert.ok(m.seen.hosts.every((h) => h.startsWith('127.0.0.1:')), 'the name is resolved first: Chrome refuses a Host that is a name');
  });

  test('a page that won\'t load or answers 404 fails; a name for the browser becomes its address', async () => {
    const m = await mockCdp((url) => (/gone/.test(url) ? { status: 404 } : { fail: 'net::ERR_NAME_NOT_RESOLVED' }));
    const { cdpUrl, resolve } = byName(m.port);
    const gone = await cdpPage(cdpUrl, 'https://example.test/gone', { resolve, settleMs: 0 });
    assert.equal(gone.ok, false); assert.match(gone.errors[0], /the page answered 404/);
    const dns = await cdpPage(cdpUrl, 'https://nowhere.test/', { resolve, settleMs: 0 });
    assert.equal(dns.ok, false); assert.equal(dns.shot, null); assert.match(dns.errors[0], /didn't load: net::ERR_NAME_NOT_RESOLVED/);
    assert.equal(await cdpBase(`http://shots:${m.port}`, { resolve }), `http://127.0.0.1:${m.port}`);
    assert.equal(await cdpBase('http://10.1.2.3:9222'), 'http://10.1.2.3:9222', 'an address stays as it is');
  });

  test('smokeCheck uses the shared browser when SHOTS_CDP_URL is set, and falls back to the HTTP check when it is down', async () => {
    const m = await mockCdp(() => ({}));
    const { cdpUrl, resolve } = byName(m.port);
    const page = async () => new Response('<!doctype html><html><body><h1>hi</h1></body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    const viaCdp = await smokeCheck('http://127.0.0.1:1/x/', { cdpUrl, browserUrl: 'http://theoffice:8083/x/', cdpResolve: resolve, httpFetch: page, playwright: null });
    assert.equal(viaCdp.how, 'cdp'); assert.equal(viaCdp.ok, true); assert.deepEqual(viaCdp.shot, JPEG);
    assert.equal(m.seen.navigated.at(-1), 'http://theoffice:8083/x/', 'the browser opens the Office\'s own page at SHOTS_ORIGIN');
    const down = await smokeCheck('http://127.0.0.1:1/x/', { cdpUrl: 'http://127.0.0.1:9', httpFetch: page, playwright: null });
    assert.equal(down.how, 'http'); assert.equal(down.ok, true); assert.equal(down.shot, null);
    const off = await smokeCheck('http://127.0.0.1:1/x/', { useBrowser: false, cdpUrl, cdpResolve: resolve, httpFetch: page });
    assert.equal(off.how, 'http', 'SMOKE_BROWSER=0 skips every browser');
    assert.deepEqual([loadConfig({ SHOTS_CDP_URL: 'http://shots:9222/', SHOTS_ORIGIN: 'http://theoffice:8083/' }).shotsCdpUrl, loadConfig({ SHOTS_ORIGIN: 'http://theoffice:8083/' }).shotsOrigin, loadConfig({}).shotsCdpUrl], ['http://shots:9222', 'http://theoffice:8083', '']);
  });

  test('after a publish the smoke check runs in the shared browser at SHOTS_ORIGIN and saves its screenshot to the job', async () => {
    const m = await mockCdp(() => ({ console: ['Failed to load resource: the server responded with a status of 404 ()'] }));
    const calls = [];
    const llm = { chat: async (a) => {
      calls.push(a);
      if (a.meta.kind === 'staff' && a.meta.step === 0) return { content: '', toolCalls: [{ id: 'w', name: 'write_file', args: JSON.stringify({ path: 'projects/site/index.html', content: '<!doctype html><html><body><h1>Open Tuesday to Sunday</h1></body></html>' }) }, { id: 'p', name: 'publish_project', args: JSON.stringify({ project: 'site', title: 'Lens' }) }], finish: 'stop', usage: { prompt: 1, completion: 1, cost: 0.001, real: true } };
      a.onToken?.('Done.'); return { content: 'Done.', toolCalls: [], finish: 'stop', usage: { prompt: 1, completion: 1, cost: 0.001, real: true } };
    } };
    const t = await boot({ peopleTalk: false, staffSelfCheck: false, shipCheck: false, smokeBrowser: true, shotsCdpUrl: `http://shots:${m.port}`, shotsOrigin: 'http://theoffice:8083' }, { llm });
    open.push(t);
    t.app.engine.cdpResolve = async () => ({ address: '127.0.0.1', family: 4 });
    t.app.engine.smokePlaywright = null;
    const c = await claim(t, 'Shots Co');
    const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
    const mgr = get(t.db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", f.id);
    t.app.engine.runManager = async () => {};
    const job = t.app.engine.assignTask(f, mgr, { to: 'builder', title: 'Change the days', brief: 'b', plan: '', project: 'site', dependsOn: [], afterPrevious: false, size: 'small' });
    await until(() => get(t.db, 'SELECT 1 x FROM smoke_checks WHERE task_id=?', job.id), { what: 'the smoke check' });
    const s = get(t.db, 'SELECT * FROM smoke_checks WHERE task_id=?', job.id);
    assert.equal(s.how, 'cdp'); assert.equal(s.ok, 0); assert.match(JSON.parse(s.errors)[0], /404/);
    assert.equal(m.seen.navigated[0], `http://theoffice:8083/theoffice/f/${c.slug}/site/`);
    assert.match(s.url, /^http:\/\/127\.0\.0\.1:\d+\/theoffice\/f\//, 'what is kept is the address the Office itself checked from');
    assert.equal(s.shot_path, `projects/site/notes/shots/smoke-${job.id}.jpg`);
    assert.ok(readFile(t.db, f.id, s.shot_path), 'the screenshot is on the floor\'s drive');
  });

  test('against a real headless Chromium, when this machine has one', async (t) => {
    const roots = ['/opt/pw-browsers', '/ms-playwright', join(process.env.HOME || '/root', '.cache/ms-playwright')].filter(existsSync);
    const bin = roots.flatMap((r) => readdirSync(r).filter((d) => d.startsWith('chromium_headless_shell-')).map((d) => join(r, d, 'chrome-headless-shell-linux64', 'chrome-headless-shell'))).find(existsSync);
    if (!bin) { t.skip('no headless shell here'); return; }
    const profile = mkdtempSync(join(tmpdir(), 'cdp-'));
    const port = 9400 + Math.floor(Math.random() * 400);
    const chrome = spawn(bin, ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
    const page = createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(q.url === '/bad' ? '<h1>x</h1><script>window.nope.go()</script>' : '<h1>Fine</h1>'); });
    await new Promise((r) => page.listen(0, '127.0.0.1', r));
    try {
      await until(async () => { try { return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok; } catch { return false; } }, { what: 'Chromium', timeout: 15000 });
      const p = page.address().port;
      const ok = await cdpPage(`http://localhost:${port}`, `http://127.0.0.1:${p}/ok`);
      assert.equal(ok.ok, true); assert.equal(ok.status, 200); assert.ok(ok.shot?.length > 1000); assert.equal(ok.shot[0], 0xff, 'a JPEG');
      const bad = await cdpPage(`http://localhost:${port}`, `http://127.0.0.1:${p}/bad`);
      assert.equal(bad.ok, false); assert.match(bad.errors.join(' '), /reading 'go'/);
    } finally { chrome.kill(); page.close(); await sleep(200); rmSync(profile, { recursive: true, force: true }); }
  });
});
