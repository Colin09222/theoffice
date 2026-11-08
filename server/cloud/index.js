// Office Cloud: the backend every published project gets, with no server code of its own. See docs/OFFICE-CLOUD.md.
// It answers on the project's own origin under /_office/cloud/, so the page's own CSP (connect-src 'self') already allows it,
// and the project is whichever one the Host names. Nothing here reads The Office's cookies. A visitor's words reach a model only through office.ai, which has no tools and sees nothing of the building.
import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { get, all } from '../db.js';
import * as A from '../auth.js';
import { appHostLabel, appLabel, lookupLabel, appOrigin, previewCookieName } from '../apps.js';
import { createStore, CloudError, PLAYER, guestKey, userKey } from './store.js';
import { slugPattern } from '../workspace.js';
import { Rooms, roomNameOk } from './rooms.js';
import { upgradeKey, handshake } from './ws.js';
import { createPowers } from './powers.js';
import { createAppAi } from './ai.js';
import { createWebFetcher } from './web.js';
import { bearerToken, findByToken, CLOUD_PATH } from '../servers.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
/** The browser library. Served on every project origin at /_office/office.js, and at /theoffice/sdk/office.js for reference. */
export const SDK_JS = readFileSync(join(ROOT, 'server/app-client/sdk.js'));
export const API_PREFIX = '/_office/cloud/';

// [requests, window ms]. Counted per key in a fixed window, like the rest of the building.
export const CLOUD_RATES = {
  all: [30000, 60000], project: [3000, 60000], ip: [600, 60000], write: [240, 60000],
  signupIp: [10, 3600000], signupProject: [300, 3600000], loginIp: [30, 600000], loginAccount: [10, 900000], loginAccountAll: [100, 900000],
  score: [30, 60000], upload: [30, 3600000], uploadProject: [300, 3600000], join: [60, 60000],
  // Queries read through a whole collection, so they get their own, smaller allowance.
  query: [120, 60000], queryProject: [1200, 60000],
  // AI and the web, per visitor's address and per project. Small on purpose, because every one of these leaves the building.
  aiVisitor: [12, 60000], aiVisitorDay: [200, 86400000], aiProject: [240, 60000], webVisitor: [30, 60000], webVisitorDay: [600, 86400000], webProject: [240, 60000],
};
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const BODY = { json: 96 * 1024, small: 8 * 1024 };
const SERVER_WHO = { kind: 'server', key: 'srv:app', name: 'Server' };

/** At most `max` jobs at once and `queue` waiting; past that, refuse rather than pile up. Password hashing is the costly thing guarded. */
function gate(max, queue) {
  let active = 0; const waiting = [];
  const release = () => { const next = waiting.shift(); if (next) next(); else active--; };
  return async (fn) => {
    if (active >= max) {
      if (waiting.length >= queue) throw new CloudError(503, 'busy', 'The building is busy. Try again in a moment.');
      await new Promise((r) => waiting.push(r));
    } else active++;
    try { return await fn(); } finally { release(); }
  };
}
const drained = (res) => new Promise((r) => { const done = () => { res.off('drain', done); res.off('close', done); r(); }; res.on('drain', done); res.on('close', done); });
const scryptAsync = (pw, salt, o) => new Promise((res, rej) => scrypt(pw, salt, 32, o, (e, k) => (e ? rej(e) : res(k))));

export function installCloud(ext) {
  const { db, cfg, engine, log, now, GET, POST, json, requireOwner, requireAdmin, floorBySlug, HttpError, ipOf, secret } = ext;
  const store = createStore(db, cfg.cloudLimits || {}, now);
  const RATES = { ...CLOUD_RATES, ...(cfg.cloudRates || {}) };
  const rates = new A.RateLimiter(cfg.cloudRateScale ?? cfg.rateScale, now);
  const hashing = gate(2, 64);
  const uploading = gate(4, 8);
  const inFlight = new Map();
  const limit = (bucket, key, message = 'Too many requests. Slow down a little.') => {
    const [n, w] = RATES[bucket];
    if (!rates.allow(`${bucket}:${key}`, n, w)) throw new CloudError(429, 'rate_limited', message);
  };
  /** At most `max` of these at once from one address, so a few slow ones can't hold every slot. */
  async function atOnce(key, max, fn, message = 'Wait for your other requests to finish.') {
    if ((inFlight.get(key) || 0) >= max) throw new CloudError(429, 'rate_limited', message);
    inFlight.set(key, (inFlight.get(key) || 0) + 1);
    try { return await fn(); } finally { const n = inFlight.get(key) - 1; if (n > 0) inFlight.set(key, n); else inFlight.delete(key); }
  }
  const powers = createPowers(db, cfg, now);
  const ai = createAppAi({ db, models: ext.models, engine, llm: ext.llm, log, powers, gate: gate(8, 16) });
  const web = createWebFetcher({ db, cfg, powers, gate: gate(8, 24), net: ext.cloudNet, now, log });
  const counts = new Map();
  const count = (pk) => { if (counts.size < 5000 || counts.has(pk)) counts.set(pk, (counts.get(pk) || 0) + 1); };
  function flush() {
    if (!counts.size) return;
    const batch = [...counts]; counts.clear();
    try { store.addRequests(batch, new Date(now()).toISOString().slice(0, 10)); } catch (e) { log('error', 'cloud counts', { err: String(e?.message).slice(0, 200) }); }
  }

  // ---- passwords ----
  async function hashPassword(pw) {
    return hashing(async () => {
      const salt = randomBytes(16);
      const key = await scryptAsync(pw, salt, SCRYPT);
      return `s1$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
    });
  }
  async function checkPassword(pw, stored) {
    const [v, N, r, p, salt, key] = String(stored).split('$');
    if (v !== 's1') return false;
    const want = Buffer.from(key, 'base64');
    const got = await hashing(() => scryptAsync(pw, Buffer.from(salt, 'base64'), { N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem }));
    return got.length === want.length && timingSafeEqual(got, want);
  }
  // An unknown name costs as much as a wrong password, so timing can't tell them apart.
  let dummy = null;
  const dummyHash = async () => (dummy ??= await hashPassword(randomBytes(12).toString('hex')));

  // ---- who and where ----
  /** Every origin this project answers on: its own address, and any domain the floor bought for it. Nothing else may use its data. */
  function originsOf(f, project, label) {
    const out = [appOrigin(cfg, label)];
    for (const d of all(db, "SELECT domain FROM domain_orders WHERE floor_id=? AND project=? AND status='live'", f.id, project)) out.push(`${cfg.appsScheme}://${d.domain}`);
    return out;
  }
  function identify(f, p, session, player) {
    if (session) {
      const u = store.users.bySession(f, p, String(session));
      if (!u) throw new CloudError(401, 'signed_out', 'You have been logged out. Log in again.');
      return { kind: 'user', key: userKey(u.uid), uid: u.uid, name: u.name, user: u };
    }
    if (player && PLAYER.test(String(player))) return { kind: 'guest', key: guestKey(String(player)), name: '' };
    return null;
  }
  const rooms = new Rooms({
    limits: cfg.cloudRoomLimits || {}, now, log,
    identify: (f, p, m) => identify(f, p, m.session, m.player) || { kind: 'guest', key: `a:${randomBytes(9).toString('base64url')}`, name: '' },
  });

  async function readBody(req, max) {
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') throw new CloudError(415, 'json_required', 'Send JSON.');
    const raw = await readRaw(req, max);
    try { const v = JSON.parse(raw.toString('utf8') || '{}'); if (!v || typeof v !== 'object' || Array.isArray(v)) throw 0; return v; } catch { throw new CloudError(400, 'bad_json', 'That is not a JSON object.'); }
  }
  async function readRaw(req, max) {
    if (Number(req.headers['content-length'] || 0) > max) throw new CloudError(413, 'too_large', 'That is too big.');
    const chunks = []; let size = 0;
    for await (const c of req) { size += c.length; if (size > max) throw new CloudError(413, 'too_large', 'That is too big.'); chunks.push(c); }
    return Buffer.concat(chunks);
  }

  // ---- HTTP, on the project's own origin ----
  /** Called by serveApp once it has checked the floor, the project and any private pass. segs is the path after /_office/cloud/. */
  async function serve(req, res, { f, pr, label, segs, rawUrl, HEAD, server = false }) {
    const p = pr.slug, F = f.id, pk = `${F}:${p}`, ip = server ? `srv:${pk}` : ipOf(req);
    const origin = req.headers.origin;
    const allowed = !server && origin !== undefined && originsOf(f, p, label).includes(origin);
    const H = { ...HEAD, 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', vary: 'Origin', ...(allowed ? { 'access-control-allow-origin': origin } : {}) };
    const reply = (status, obj, extra = {}) => { if (res.headersSent) return; res.writeHead(status, { ...H, 'content-type': 'application/json; charset=utf-8', ...extra }); res.end(JSON.stringify(obj)); };
    try {
      // Only this project's own pages. A browser can't forge Origin or Sec-Fetch-Site, and a sibling project counts as another site here.
      if (!server && origin !== undefined && !allowed) throw new CloudError(403, 'bad_origin', 'Only this project\'s own pages can use its data.');
      const site = req.headers['sec-fetch-site'];
      if (!server && site && site !== 'same-origin' && site !== 'none' && !allowed) throw new CloudError(403, 'bad_origin', 'Only this project\'s own pages can use its data.');
      limit('all', 'all'); limit('project', pk); limit('ip', ip);
      if (req.method === 'OPTIONS') {
        if (!allowed) throw new CloudError(403, 'bad_origin', 'Only this project\'s own pages can use its data.');
        res.writeHead(204, { ...H, 'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE', 'access-control-allow-headers': 'content-type, x-office-session, x-office-player', 'access-control-max-age': '600' });
        return res.end();
      }
      const read = req.method === 'GET' || req.method === 'HEAD';
      if (!read && origin === undefined && !server) throw new CloudError(403, 'bad_origin', 'Only this project\'s own pages can use its data.');
      if (!read) limit('write', `${pk}:${ip}`);
      count(pk);
      const url = new URL(rawUrl, 'http://x');
      const q = url.searchParams;
      // Server code acts as itself, or as a visitor when it passes on that visitor's own session.
      const who = () => (server && !req.headers['x-office-session'] ? SERVER_WHO : identify(F, p, req.headers['x-office-session'], req.headers['x-office-player']));
      const [a, b, c, extra] = segs;
      const m = req.method;
      if (extra !== undefined || segs.some((s) => s.length > 100)) throw new CloudError(404, 'not_found', 'No such thing here.');

      if (a === undefined || a === '' || a === 'ping') return reply(200, { ok: true, version: 1 });
      // Accounts are a visitor's business: server code can only ask who a session belongs to.
      if (server && a === 'auth' && !(b === 'me' && m === 'GET' && !c)) throw new CloudError(404, 'not_found', 'No such thing here.');
      if (a === 'server' && !b && m === 'GET') return reply(200, { url: engine.servers.originOf(F, p) });

      if (a === 'auth') {
        if (b === 'signup' && m === 'POST' && !c) {
          limit('signupIp', ip); limit('signupProject', pk);
          const body = await readBody(req, BODY.small);
          const fields = store.users.validate(body);
          // Checked before the costly hash, and again when the row goes in.
          const clash = store.users.taken(F, p, fields);
          if (clash) throw new CloudError(409, `${clash}_taken`, clash === 'username' ? 'That username is taken.' : 'That email address already has an account.');
          const hash = await hashPassword(body.password);
          const player = req.headers['x-office-player'];
          const user = store.users.create(F, p, fields, hash, player && PLAYER.test(String(player)) ? guestKey(String(player)) : null);
          return reply(201, { user: store.publicUser(user, true), session: store.users.startSession(user) });
        }
        if (b === 'login' && m === 'POST' && !c) {
          limit('loginIp', ip);
          const body = await readBody(req, BODY.small);
          const login = String(body.login ?? body.username ?? body.email ?? '').trim().toLowerCase().slice(0, 254);
          if (!login || typeof body.password !== 'string' || Buffer.byteLength(body.password) > 512) throw new CloudError(400, 'bad_login', 'Give your username or email and your password.');
          // Per address and per account: one person guessing is slowed down at once, and a crowd of addresses still hits a ceiling.
          limit('loginAccount', `${pk}:${login}:${ip}`); limit('loginAccountAll', `${pk}:${login}`);
          const user = store.users.find(F, p, login);
          const ok = await checkPassword(body.password, user ? user.hash : await dummyHash());
          if (!user || !ok) throw new CloudError(401, 'bad_login', 'That username or password is wrong.');
          return reply(200, { user: store.publicUser(user, true), session: store.users.startSession(user) });
        }
        if (b === 'logout' && m === 'POST' && !c) {
          const tok = req.headers['x-office-session'];
          if (tok) store.users.endSession(tok);
          return reply(200, { ok: true });
        }
        if (b === 'me' && !c) {
          const w = who();
          if (m === 'GET') return reply(200, { user: w?.kind === 'user' ? store.publicUser(w.user, true) : null });
          if (w?.kind !== 'user') throw new CloudError(401, 'signed_out', 'Log in first.');
          if (m === 'PATCH') { const body = await readBody(req, BODY.small); store.users.rename(w.user, body.name); return reply(200, { user: store.publicUser(store.users.bySession(F, p, req.headers['x-office-session']), true) }); }
        }
        if ((b === 'password' || b === 'delete') && m === 'POST' && !c) {
          const w = who();
          if (w?.kind !== 'user') throw new CloudError(401, 'signed_out', 'Log in first.');
          limit('loginAccount', `${pk}:uid:${w.uid}`);
          const body = await readBody(req, BODY.small);
          if (typeof body.password !== 'string' || !(await checkPassword(body.password, w.user.hash))) throw new CloudError(401, 'bad_login', 'That password is wrong.');
          if (b === 'delete') { store.users.remove(w.user); return reply(200, { ok: true }); }
          if (typeof body.newPassword !== 'string' || body.newPassword.length < 8 || Buffer.byteLength(body.newPassword) > 512) throw new CloudError(400, 'bad_password', 'A password is at least 8 characters.');
          store.users.setHash(w.user, await hashPassword(body.newPassword));
          // Anyone else holding this account's sessions is signed out; this device stays in.
          store.users.endOthers(w.user, req.headers['x-office-session']);
          return reply(200, { ok: true });
        }
        throw new CloudError(404, 'not_found', 'No such thing here.');
      }

      if (a === 'db' && b) {
        const w = who();
        if (!c) {
          if (m === 'GET') {
            limit('query', `${pk}:${ip}`); limit('queryProject', pk);
            if (q.get('count') === '1') return reply(200, { count: store.docs.count(F, p, w, b) });
            let where;
            if (q.has('where')) { try { where = JSON.parse(q.get('where')); } catch { throw new CloudError(400, 'bad_where', 'where is JSON.'); } }
            return reply(200, store.docs.find(F, p, w, b, { where, sort: q.get('sort'), order: q.get('order'), limit: q.get('limit'), offset: q.get('offset'), mine: q.get('mine') === '1' }));
          }
          if (m === 'POST') { const body = await readBody(req, BODY.json); return reply(201, store.docs.add(F, p, w, b, body.data, { id: body.id, private: body.private === true })); }
        } else {
          if (m === 'GET') return reply(200, store.docs.get(F, p, w, b, c));
          if (m === 'PUT') { const body = await readBody(req, BODY.json); return reply(200, store.docs.set(F, p, w, b, c, body.data, { private: body.private === undefined ? undefined : body.private === true, ifVersion: body.ifVersion })); }
          if (m === 'PATCH') { const body = await readBody(req, BODY.json); return reply(200, store.docs.update(F, p, w, b, c, body.data, { ifVersion: body.ifVersion })); }
          if (m === 'DELETE') return reply(200, { ok: store.docs.remove(F, p, w, b, c) });
        }
      }

      if (a === 'saves' && !c) {
        const w = who();
        if (!b && m === 'GET') return reply(200, { saves: store.saves.list(F, p, w) });
        if (b && m === 'GET') return reply(200, store.saves.get(F, p, w, b));
        if (b && m === 'PUT') { const body = await readBody(req, BODY.json); return reply(200, store.saves.put(F, p, w, b, body.value, body.ifVersion)); }
        if (b && m === 'DELETE') return reply(200, { ok: store.saves.remove(F, p, w, b) });
      }

      if (a === 'boards' && b && !c) {
        const w = who();
        if (m === 'GET') return reply(200, store.scores.top(F, p, w, b, { limit: q.get('limit'), lower: q.get('order') === 'asc' }));
        if (m === 'POST') {
          if (w) limit('score', `${pk}:${w.key}`);
          limit('score', `${pk}:ip:${ip}`);
          const body = await readBody(req, BODY.small);
          return reply(200, store.scores.submit(F, p, w, b, body.score, { name: body.name, lower: body.lower === true }));
        }
      }

      if (a === 'files') {
        if (!b && m === 'POST') {
          const w = who();
          if (!w) throw new CloudError(401, 'no_identity', 'This needs a player token or an account.');
          limit('upload', `${pk}:${ip}`); limit('uploadProject', pk);
          if (Number(req.headers['content-length'] || 0) > store.L.fileMax) throw new CloudError(413, 'too_large', `A file can be at most ${Math.floor(store.L.fileMax / 1048576)} MB.`);
          // Two at a time from one address, so a few slow uploads can't hold every slot.
          if ((inFlight.get(ip) || 0) >= 2) throw new CloudError(429, 'rate_limited', 'Wait for your other uploads to finish.');
          inFlight.set(ip, (inFlight.get(ip) || 0) + 1);
          try {
            return reply(201, await uploading(async () => store.files.put(F, p, w, { name: q.get('name'), body: await readRaw(req, store.L.fileMax) })));
          } finally { const n = inFlight.get(ip) - 1; if (n > 0) inFlight.set(ip, n); else inFlight.delete(ip); }
        }
        if (!b && m === 'GET') return reply(200, { files: store.files.list(F, p, who()) });
        if (b && !c && (m === 'GET' || m === 'HEAD')) return sendFile(req, res, F, p, b, H);
        if (b && !c && m === 'DELETE') return reply(200, { ok: store.files.remove(F, p, who(), b) });
      }

      if (a === 'rooms' && m === 'GET' && !c) {
        if (!b) return reply(200, { rooms: rooms.list(pk), max: rooms.L.members });
        if (!roomNameOk(b)) throw new CloudError(400, 'bad_room', 'A room name is 1 to 64 letters, digits or _ . : -');
        const r = rooms.list(pk, Infinity).find((x) => x.name === b);
        return reply(200, { name: b, players: r ? r.players : 0, max: rooms.L.members });
      }
      if (a === 'ai' && b === 'chat' && !c && m === 'POST') {
        const tooFast = 'You\'re asking very quickly. Give it a minute and try again.';
        limit('aiVisitor', `${pk}:${ip}`, tooFast); limit('aiVisitorDay', `${pk}:${ip}`, 'You\'ve used your AI requests here for today. Come back tomorrow.'); limit('aiProject', pk, tooFast);
        const body = await readBody(req, BODY.json);
        // Two at once from one address and four from one project, so one busy site can't hold every place in the building.
        return reply(200, await atOnce(`ai:${ip}`, 2, () => atOnce(`aiP:${pk}`, 4, () => ai.chat({ F, p, pk, body }), 'The AI is busy on this site right now. Try again in a moment.')));
      }
      if ((a === 'fetch' || a === 'scrape') && !b && m === 'POST') {
        limit('webVisitor', `${pk}:${ip}`); limit('webVisitorDay', `${pk}:${ip}`); limit('webProject', pk);
        const body = await readBody(req, BODY.small);
        return reply(200, await atOnce(`web:${ip}`, 3, () => atOnce(`webP:${pk}`, 6, () => web[a]({ F, p, pk, url: body.url }), 'This site is reading a lot of pages right now. Try again in a moment.')));
      }
      throw new CloudError(404, 'not_found', 'No such thing here.');
    } catch (e) {
      if (e instanceof CloudError || e instanceof HttpError) return reply(e.status, { error: e.code, message: e.message }, e.status === 429 ? { 'retry-after': '30' } : {});
      log('error', 'cloud', { err: String(e?.message).slice(0, 200) });
      return reply(500, { error: 'server_error', message: 'Something broke in the building.' });
    }
  }

  /** The door for a project's own server code: one bearer token, which is the project. No project is named in the address, so another project's data can't even be asked for. */
  async function serveServer(req, res, url) {
    const fail = (status, code, message) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify({ error: code, message })); };
    // A browser holding this token is a leak, not a client.
    if (req.headers.origin !== undefined) return fail(403, 'bad_origin', 'This address is for server code.');
    const token = bearerToken(req);
    const row = token && findByToken(db, token);
    if (!row) {
      try { limit('ip', ipOf(req)); } catch { return fail(429, 'rate_limited', 'Too many requests. Slow down a little.'); }
      return fail(401, 'bad_token', 'That token is not valid.');
    }
    let segs;
    try { segs = url.pathname.slice(`/theoffice${CLOUD_PATH}/`.length).split('/').map((s) => decodeURIComponent(s)); } catch { return fail(404, 'not_found', 'No such thing here.'); }
    return serve(req, res, { f: { id: row.floor_id }, pr: { slug: row.project }, label: '', segs, rawUrl: req.url, HEAD: { 'x-content-type-options': 'nosniff' }, server: true });
  }

  // A file goes out in its stored pieces, waiting for the reader between them. Its type was decided from its bytes at upload.
  async function sendFile(req, res, F, p, id, H) {
    const meta = store.files.meta(F, p, id);
    if (!meta) { res.writeHead(404, { ...H, 'content-type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'not_found', message: 'No such file.' })); }
    const etag = `"${meta.id}"`;
    const head = {
      ...H, 'content-type': meta.type, 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox", 'cache-control': 'public, max-age=31536000, immutable',
      'content-disposition': `inline; filename="${meta.name.replace(/[^\x20-\x7e]|["\\]/g, '_')}"`, 'accept-ranges': 'bytes', etag,
    };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, head); return res.end(); }
    let start = 0, end = meta.size - 1, status = 200;
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
    if (range && (range[1] || range[2])) {
      if (range[1]) { start = Number(range[1]); if (range[2]) end = Math.min(Number(range[2]), meta.size - 1); } else { start = Math.max(0, meta.size - Number(range[2])); }
      if (start > end || start >= meta.size) { res.writeHead(416, { ...head, 'content-range': `bytes */${meta.size}` }); return res.end(); }
      status = 206; head['content-range'] = `bytes ${start}-${end}/${meta.size}`;
    }
    head['content-length'] = String(end - start + 1);
    res.writeHead(status, head);
    if (req.method === 'HEAD') return res.end();
    const C = store.files.CHUNK;
    for (let n = Math.floor(start / C); n <= Math.floor(end / C) && !res.destroyed; n++) {
      const data = store.files.chunk(F, p, id, n);
      if (!data) break;
      const from = n * C;
      const piece = Buffer.from(data.buffer, data.byteOffset + Math.max(0, start - from), Math.min(data.length, end - from + 1) - Math.max(0, start - from));
      if (!res.write(piece)) await drained(res);
    }
    return res.end();
  }

  // ---- WebSocket rooms ----
  /** The project behind a Host header, checked the way serveApp checks it: a live floor, a published project, and a pass if it's private. */
  function projectFor(req) {
    let label = appHostLabel(cfg, req.headers.host);
    if (label === null && cfg.appsBaseDomain) {
      const bought = engine.domains.lookup(req.headers.host);
      if (bought && !bought.www) {
        const fl = get(db, "SELECT * FROM floors WHERE id=? AND status='active'", bought.floor_id);
        if (fl) label = appLabel(db, fl, bought.project);
      }
    }
    if (!label) return null;
    const entry = lookupLabel(db, label);
    const f = entry && get(db, "SELECT * FROM floors WHERE id=? AND status='active'", entry.floor_id);
    const pr = f && get(db, 'SELECT * FROM projects WHERE floor_id=? AND slug=? AND published_at IS NOT NULL', f.id, entry.project);
    if (!pr) return null;
    if (pr.private) {
      const m = String(A.parseCookies(req.headers.cookie)[previewCookieName(cfg)] || '').match(/^(\d{1,12})\.([A-Za-z0-9_-]{20,64})$/);
      if (!m || Number(m[1]) * 1000 < now() || !A.safeEqual(m[2], A.signPreview(secret, f.id, pr.slug, Number(m[1])))) return null;
    }
    return { f, pr, label };
  }
  function upgrade(req, socket, head) {
    const refuse = (status, text) => { try { socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); } catch { /* gone */ } };
    socket.on('error', () => socket.destroy());
    try {
      const path = String(req.url || '').split('?')[0];
      const mm = /^\/_office\/cloud\/rooms\/([^/]{1,200})$/.exec(path);
      const key = upgradeKey(req);
      if (!mm || !key) return refuse(400, 'Bad Request');
      let room; try { room = decodeURIComponent(mm[1]); } catch { return refuse(400, 'Bad Request'); }
      if (!roomNameOk(room)) return refuse(400, 'Bad Request');
      const target = projectFor(req);
      if (!target) return refuse(404, 'Not Found');
      const { f, pr, label } = target;
      // WebSockets skip CORS, so the Origin check here is the whole of it.
      if (!originsOf(f, pr.slug, label).includes(req.headers.origin)) return refuse(403, 'Forbidden');
      const ip = ipOf(req); const pk = `${f.id}:${pr.slug}`;
      try { limit('all', 'all'); limit('project', pk); limit('ip', ip); limit('join', ip); } catch { return refuse(429, 'Too Many Requests'); }
      const why = rooms.admit(pk, ip);
      if (why) return refuse(why === 'too_many' ? 429 : 503, why === 'too_many' ? 'Too Many Requests' : 'Service Unavailable');
      count(pk);
      socket.write(handshake(key));
      rooms.accept(socket, head, { projectKey: pk, f: f.id, p: pr.slug, room, ip });
    } catch (e) {
      log('error', 'cloud upgrade', { err: String(e?.message).slice(0, 200) });
      refuse(500, 'Internal Server Error');
    }
    return undefined;
  }

  // ---- the boss and the admin: counts only ----
  const projectsOf = (f) => all(db, 'SELECT slug, title FROM projects WHERE floor_id=? AND published_at IS NOT NULL ORDER BY slug', f.id);
  GET('/api/floors/:slug/cloud', async ({ req, res, p }) => {
    const f = requireOwner(req, p.slug);
    flush();
    json(res, 200, { projects: projectsOf(f).map((x) => ({ slug: x.slug, title: x.title, usage: store.summary(f.id, x.slug), live: rooms.live(`${f.id}:${x.slug}`), powers: powers.view(f.id, x.slug) })) });
  });
  // The boss's own on/off for a project's AI and web fetching. A pause set by the building manager stays in force whatever this says.
  POST('/api/floors/:slug/cloud/:project/powers', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug);
    ext.limit('mutate', ip);
    const b = await ext.readJson(req, 256);
    if (typeof b.ai !== 'boolean' && typeof b.fetch !== 'boolean') throw new HttpError(400, 'bad_switch');
    if (!projectsOf(f).some((x) => x.slug === p.project)) throw new HttpError(404, 'not_found');
    for (const kind of ['ai', 'fetch']) if (typeof b[kind] === 'boolean') powers.setOff(f.id, p.project, kind, !b[kind]);
    json(res, 200, { powers: powers.view(f.id, p.project) });
  });
  GET('/api/admin/cloud', async ({ req, res }) => {
    requireAdmin(req);
    flush();
    const rows = store.projects().map((x) => {
      const fl = get(db, 'SELECT number, slug FROM floors WHERE id=?', x.floor_id);
      return { floorId: x.floor_id, floor: fl?.slug || '(closed)', number: fl?.number ?? null, project: x.project, usage: store.summary(x.floor_id, x.project), live: rooms.live(`${x.floor_id}:${x.project}`), powers: powers.view(x.floor_id, x.project) };
    });
    json(res, 200, { projects: rows, live: { players: rooms.conns.size, rooms: rooms.rooms.size } });
  });
  POST('/api/admin/cloud/wipe', async ({ req, res }) => {
    requireAdmin(req);
    const body = await ext.readJson(req, 1024);
    const f = floorBySlug(String(body.floor || ''));
    if (typeof body.project !== 'string' || !slugPattern.test(body.project)) throw new HttpError(400, 'bad_project');
    rooms.closeProject(`${f.id}:${body.project}`);
    json(res, 200, { ok: true, removed: store.wipeProject(f.id, body.project) });
  });

  let flushTimer = null, sweepTimer = null;
  return {
    store, rooms, powers, serve, serveServer, upgrade,
    start() {
      flushTimer = setInterval(flush, 60000); flushTimer.unref?.();
      sweepTimer = setInterval(() => { try { store.sweep(); powers.sweep(); } catch { /* next time */ } }, 3600000); sweepTimer.unref?.();
    },
    stop() { clearInterval(flushTimer); clearInterval(sweepTimer); flush(); rooms.close(); rates.close(); },
    flush,
  };
}
