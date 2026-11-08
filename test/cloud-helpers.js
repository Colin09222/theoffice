// Shared by the Office Cloud tests: requests with a chosen Host (the way the reverse proxy sends them), publishing, and a small WebSocket client.
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { writeFile, publishSnapshot } from '../server/workspace.js';
import { appLabel } from '../server/apps.js';
import { Reader, frame, closeFrame } from '../server/cloud/ws.js';
import { sleep } from './helpers.js';

export const BASE = 'apps.test.example';
export const P1 = 'p'.repeat(40), P2 = 'q'.repeat(40), P3 = 'r'.repeat(40);

export function hit(t, host, path, { method = 'GET', headers = {}, body, type, raw } = {}) {
  return new Promise((resolve, reject) => {
    const data = raw ?? (body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
    const h = { host, ...headers };
    if (data) { if (!('content-type' in h)) h['content-type'] = type ?? 'application/json'; h['content-length'] = data.length; }
    const q = http.request({ host: '127.0.0.1', port: t.port, method, path, headers: h }, (r) => {
      const chunks = []; r.on('data', (c) => chunks.push(c));
      r.on('end', () => {
        const buf = Buffer.concat(chunks); const text = buf.toString();
        let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: r.statusCode, headers: r.headers, text, json, buf });
      });
    });
    q.on('error', reject);
    if (data) q.write(data);
    q.end();
  });
}

export function publish(t, floor, slug, files = {}, { priv = false } = {}) {
  for (const [p, c] of Object.entries({ 'index.html': `<h1>${slug}</h1>`, ...files })) writeFile(t.db, floor.id, `projects/${slug}/${p}`, c, null, 1e8);
  publishSnapshot(t.db, floor.id, slug, 1e8);
  t.app.engine.upsertProject(floor, slug, { title: slug, kind: 'game', published: true, makePrivate: priv });
  return `${appLabel(t.db, floor, slug)}.${BASE}`;
}

/** One call to a project's backend, as its own page would make it. */
export function cloud(t, host, method, path, { body, session, player = P1, origin = `https://${host}`, headers = {}, raw, type } = {}) {
  const h = { ...(origin ? { origin } : {}), ...(session ? { 'x-office-session': session } : {}), ...(player ? { 'x-office-player': player } : {}), ...headers };
  if (origin && !('sec-fetch-site' in h)) h['sec-fetch-site'] = origin === `https://${host}` ? 'same-origin' : 'cross-site';
  return hit(t, host, `/_office/cloud/${path}`, { method, body, headers: h, raw, type });
}

/** A WebSocket client that speaks through the real upgrade. Resolves to a connection, or to {refused: status}. */
export function wsConnect(t, host, room, { origin = `https://${host}`, cookie, path } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { host, connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': randomBytes(16).toString('base64') };
    if (origin) headers.origin = origin;
    if (cookie) headers.cookie = cookie;
    const req = http.request({ host: '127.0.0.1', port: t.port, path: path ?? `/_office/cloud/rooms/${encodeURIComponent(room)}`, headers });
    req.on('upgrade', (res, socket, head) => {
      const c = { socket, msgs: [], closed: null, accept: res.headers['sec-websocket-accept'] };
      const reader = new Reader({
        max: 1 << 20, masked: false,
        on: {
          text: (s) => c.msgs.push(JSON.parse(s)),
          ping: (b) => socket.write(frame(0xa, b, true)),
          pong: () => {},
          close: (code) => { c.closed = code; socket.end(); },
          fail: (code) => { c.closed = c.closed ?? -code; },
        },
      });
      socket.on('data', (d) => reader.push(d));
      socket.on('close', () => { if (c.closed === null) c.closed = 1006; });
      socket.on('error', () => {});
      if (head.length) reader.push(head);
      c.send = (obj) => socket.write(frame(0x1, Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)), true));
      c.raw = (buf) => socket.write(buf);
      c.next = async (pred = () => true, ms = 3000) => {
        const end = Date.now() + ms;
        for (;;) {
          const i = c.msgs.findIndex(pred);
          if (i >= 0) return c.msgs.splice(i, 1)[0];
          if (Date.now() > end) throw new Error(`no matching message; have ${JSON.stringify(c.msgs).slice(0, 300)} closed=${c.closed}`);
          await sleep(5);
        }
      };
      c.type = (type, ms) => c.next((m) => m.t === type, ms);
      c.closedWith = async (ms = 3000) => { const end = Date.now() + ms; while (c.closed === null && Date.now() < end) await sleep(5); return c.closed; };
      c.close = () => { try { socket.write(closeFrame(1000, '', true)); socket.end(); } catch { /* gone */ } };
      resolve(c);
    });
    req.on('response', (res) => { res.resume(); resolve({ refused: res.statusCode }); });
    req.on('error', reject);
    req.end();
  });
}

/** Connects and says hello. Resolves to the connection with its welcome message attached. */
export async function joinRoom(t, host, room, hello = {}, opts = {}) {
  const c = await wsConnect(t, host, room, opts);
  if (c.refused) return c;
  c.send({ t: 'hello', player: P1, ...hello });
  c.welcome = await c.next((m) => m.t === 'welcome' || m.t === 'error');
  return c;
}

/** A real PNG header followed by bytes, enough for the sniffer and big enough to cross chunk boundaries when asked. */
export function png(size = 64) {
  const b = Buffer.alloc(size);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  for (let i = 8; i < size; i++) b[i] = (i * 31) & 0xff;
  return b;
}
