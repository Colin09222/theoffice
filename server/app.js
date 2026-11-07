// HTTP layer: routing, security headers, CSRF, rate limits, static files, published sites and the JSON API. Everything lives under /theoffice.
import http from 'node:http';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { gzipSync } from 'node:zlib';
import { get, all, run, tx } from './db.js';
import { ROOT } from './config.js';
import * as A from './auth.js';
import { Bus } from './bus.js';
import { Engine, agentView, taskView, PRIVATE_TEXT, redactChat } from './engine.js';
import { slugify, slugPattern, cleanPath, TEXT_EXT, listFiles, readFile, floorBytes, WorkspaceError } from './workspace.js';
import { publicUrl } from './tools.js';
import { embeddedV4, expandV6 } from './safefetch.js';
import { isIP } from 'node:net';
import { renderMarkdown, esc } from '../public/js/markdown.js';
import { LOOK_FIELDS, DEFAULT_LOOK, DEFAULT_DECOR, DEFAULT_COLORS, FLOOR_STYLES, PETS } from '../public/js/looks.js';
import { createOpenRouterClient, scrub } from './llm.js';
import { createAnthropicClient, createRouter } from './anthropic.js';
import { createMockClient } from './mock.js';

const BASE = '/theoffice';
// Exact policy from the security brief. Published content runs on an opaque origin, with no access to any iscolinfree.com cookie, page or API.
export const SANDBOX_CSP = 'sandbox allow-scripts allow-forms allow-popups';
const APP_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const BASE_HEADERS = {
  'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex, nofollow, noarchive',
  'referrer-policy': 'same-origin', 'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};
const LIMITS = { code: [8, 60000], login: [6, 60000], admin: [5, 60000], adminAll: [60, 60000], chat: [20, 60000], mutate: [90, 60000], read: [900, 60000], publicSite: [600, 60000], sse: [40, 60000] };
const MAX_CHAT = 4000;
const RESERVED = new Set(['api', 'admin', 'f', 'floor', 'js', 'css', 'vendor', 'robots', 'www', 'static', 'assets']);

class HttpError extends Error { constructor(status, code, message) { super(message || code); this.status = status; this.code = code; } }
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').trim().slice(0, max);
const hex = (v, d) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : d);

export function validLook(input, base = DEFAULT_LOOK) {
  const out = { ...base };
  if (input && typeof input === 'object') for (const [k, opts] of Object.entries(LOOK_FIELDS)) if (opts.includes(input[k])) out[k] = input[k];
  return out;
}
function validDecor(input, base = DEFAULT_DECOR) {
  const out = { ...base }; const i = input && typeof input === 'object' ? input : {};
  if (FLOOR_STYLES.includes(i.floor)) out.floor = i.floor;
  if (PETS.includes(i.pet)) out.pet = i.pet;
  out.wall = hex(i.wall, out.wall);
  if (Number.isInteger(i.plants) && i.plants >= 0 && i.plants <= 8) out.plants = i.plants;
  for (const k of ['rug', 'art', 'coffee', 'arcade', 'neon']) if (typeof i[k] === 'boolean') out[k] = i[k];
  return out;
}
const validColors = (i, base = DEFAULT_COLORS) => ({ primary: hex(i?.primary, base.primary), accent: hex(i?.accent, base.accent) });

function buildStatic() {
  const pub = join(ROOT, 'public'); const map = new Map();
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml' };
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      const ext = extname(n); if (!TYPES[ext]) continue;
      const body = readFileSync(p); const compressible = ext !== '.woff2';
      map.set('/' + relative(pub, p).split('\\').join('/'), { body, gz: compressible ? gzipSync(body, { level: 9 }) : null, type: TYPES[ext] });
    }
  };
  walk(pub);
  return map;
}

export function createApp({ db, cfg, models, log = () => {}, now = Date.now, llm, fetcher, httpFetch }) {
  const bus = new Bus();
  const client = llm || (cfg.aiMode === 'mock' ? createMockClient(cfg) : createRouter({ anthropic: createAnthropicClient(cfg), openrouter: createOpenRouterClient(cfg) }));
  const engine = new Engine({ db, cfg, models, llm: client, bus, log, now, fetcher, httpFetch });
  const rates = new A.RateLimiter(cfg.rateScale, now);
  const statics = buildStatic();
  const secret = A.serverSecret(db);
  const adminHash = cfg.adminPassword ? A.hashSecret(cfg.adminPassword) : '';

  // ---- request helpers ----
  const ipOf = (req) => {
    // Only the configured gate may speak for the client. The rightmost XFF hop is the one our own proxy appended.
    let ip = req.socket.remoteAddress || 'unknown';
    if (cfg.trustProxy) {
      const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (xff.length) ip = xff[xff.length - 1].slice(0, 64);
    }
    // One IPv6 customer usually holds a whole /64, so that's the unit a limit has to count.
    if (isIP(ip) === 6) return embeddedV4(ip) || `${expandV6(ip).slice(0, 4).map((w) => w.toString(16)).join(':')}::/64`;
    return ip;
  };
  const limit = (bucket, key) => {
    const [n, w] = LIMITS[bucket];
    if (!rates.allow(`${bucket}:${key}`, n, w)) throw new HttpError(429, 'rate_limited', 'Too many requests. Slow down a little.');
  };
  const send = (res, status, body, headers = {}) => {
    if (res.headersSent) return;
    res.writeHead(status, { ...BASE_HEADERS, 'content-security-policy': APP_CSP, 'x-frame-options': 'DENY', 'cross-origin-resource-policy': 'same-origin', 'cache-control': 'no-store', ...headers });
    res.end(body);
  };
  const json = (res, status, obj, headers = {}) => send(res, status, JSON.stringify(obj), { 'content-type': 'application/json; charset=utf-8', ...headers });
  async function readJson(req, maxBytes = 32 * 1024) {
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') throw new HttpError(415, 'json_required');
    const chunks = []; let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > maxBytes) { throw new HttpError(413, 'too_large', 'That is too long.'); }
      chunks.push(c);
    }
    try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); if (!v || typeof v !== 'object' || Array.isArray(v)) throw 0; return v; } catch { throw new HttpError(400, 'bad_json'); }
  }
  function checkOrigin(req) {
    const origin = req.headers.origin;
    if (!origin || origin === 'null') throw new HttpError(403, 'bad_origin', 'Cross-site request refused.');
    if (cfg.publicOrigin) { if (origin !== cfg.publicOrigin) throw new HttpError(403, 'bad_origin', 'Cross-site request refused.'); } else {
      let host = ''; try { host = new URL(origin).host; } catch { /* refused below */ }
      if (host !== req.headers.host) throw new HttpError(403, 'bad_origin', 'Cross-site request refused.');
    }
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin') throw new HttpError(403, 'bad_origin', 'Cross-site request refused.');
  }
  const sessionOf = (req) => A.loadSession(db, A.parseCookies(req.headers.cookie)[A.COOKIE], 'owner', now());
  const adminOf = (req) => A.loadSession(db, A.parseCookies(req.headers.cookie)[A.ADMIN_COOKIE], 'admin', now());
  const floorBySlug = (slug) => {
    if (typeof slug !== 'string' || !slugPattern.test(slug)) throw new HttpError(404, 'not_found');
    const f = get(db, 'SELECT * FROM floors WHERE slug=?', slug);
    if (!f) throw new HttpError(404, 'not_found');
    return f;
  };
  function requireOwner(req, slug) {
    const f = floorBySlug(slug); const s = sessionOf(req);
    if (!s) throw new HttpError(401, 'login_required');
    if (s.floor_id !== f.id) throw new HttpError(403, 'not_your_floor');
    if (req.method !== 'GET' && req.headers['x-office-csrf'] !== s.csrf) throw new HttpError(403, 'bad_csrf');
    if (req.method !== 'GET' && f.status !== 'active') throw new HttpError(423, 'suspended', 'This floor is closed by the building manager.');
    return f;
  }
  function requireAdmin(req) {
    const s = adminOf(req);
    if (!s) throw new HttpError(401, 'admin_required');
    if (req.method !== 'GET' && req.headers['x-office-csrf'] !== s.csrf) throw new HttpError(403, 'bad_csrf');
    return s;
  }
  const viewerFor = (req, floor) => {
    const s = sessionOf(req);
    return { owner: !!s && s.floor_id === floor.id, sessionHash: s?.hash, publicChat: !!floor.public_chat, defaultPrivate: !!floor.default_private };
  };

  // ---- views ----
  const floorCard = (f) => {
    const busy = get(db, "SELECT COUNT(*) n FROM tasks WHERE floor_id=? AND status='doing'", f.id).n;
    return { number: f.number, slug: f.slug, name: f.name, tagline: f.tagline, colors: JSON.parse(f.colors), status: f.status, busy };
  };
  const projectView = (f, p) => ({ slug: p.slug, title: p.title, description: p.description, kind: p.kind, private: !!p.private, publishedAt: p.published_at, sources: JSON.parse(p.sources), url: publicUrl(f.slug, p.slug) });
  const privateSet = (f) => new Set(all(db, 'SELECT slug FROM projects WHERE floor_id=? AND private=1', f.id).map((p) => p.slug));
  function snapshot(f, viewer) {
    const hidden = viewer.owner ? new Set() : privateSet(f);
    if (!viewer.owner && viewer.defaultPrivate) hidden.add(''); // nothing untagged is public on a default-private floor
    const agents = all(db, 'SELECT * FROM agents WHERE floor_id=? ORDER BY id', f.id).map((a) => {
      const v = agentView(a);
      if (hidden.has(a.project)) { v.activity = PRIVATE_TEXT; v.taskId = null; }
      return v;
    });
    const tasks = all(db, 'SELECT * FROM tasks WHERE floor_id=? ORDER BY id DESC LIMIT 80', f.id).reverse().map((t) => {
      const v = taskView(t);
      if (viewer.owner) return v;
      const { brief: _b, result: _r, costUsd: _c, ...pub } = v;
      return hidden.has(t.project) ? { ...pub, title: 'Private task', plan: '', project: '' } : pub;
    });
    const projects = all(db, 'SELECT * FROM projects WHERE floor_id=? AND published_at IS NOT NULL ORDER BY published_at DESC', f.id).filter((p) => viewer.owner || !p.private).map((p) => projectView(f, p));
    const feedRows = all(db, "SELECT * FROM events WHERE floor_id=? AND type='feed' ORDER BY id DESC LIMIT 120", f.id).reverse();
    const feed = feedRows.map((e) => {
      const d = JSON.parse(e.data);
      return { id: e.id, ...d, text: hidden.has(e.project) && d.agent !== null ? PRIVATE_TEXT.toLowerCase() : d.text };
    });
    const out = {
      viewer: { owner: viewer.owner }, floor: { number: f.number, slug: f.slug, name: f.name, tagline: f.tagline, colors: JSON.parse(f.colors), boss: JSON.parse(f.boss), decor: JSON.parse(f.decor), publicChat: !!f.public_chat, defaultPrivate: !!f.default_private, ...engine.floorState(f.id) },
      agents, tasks, projects, feed, spend: { today: engine.spentToday(f.id), cap: cfg.floorDailyUsd }, lastEventId: get(db, 'SELECT COALESCE(MAX(id),0) n FROM events WHERE floor_id=?', f.id).n,
    };
    if (viewer.owner || viewer.publicChat) out.messages = all(db, "SELECT id,role,agent_id agentId,text,created_at createdAt FROM messages WHERE floor_id=? AND role!='note' ORDER BY id DESC LIMIT 120", f.id).reverse().map((m) => (viewer.owner ? m : { ...m, text: redactChat(db, f.id, m.text) }));
    if (viewer.owner) {
      out.questions = all(db, 'SELECT q.id,q.text,a.name agentName FROM questions q LEFT JOIN agents a ON a.id=q.agent_id WHERE q.floor_id=? AND q.answer IS NULL ORDER BY q.id', f.id);
      out.purchases = all(db, 'SELECT p.id,p.item,p.price,p.why,p.link,p.status,p.created_at createdAt,a.name agentName FROM purchases p LEFT JOIN agents a ON a.id=p.agent_id WHERE p.floor_id=? ORDER BY p.id DESC LIMIT 50', f.id);
      out.storage = { used: floorBytes(db, f.id), quota: cfg.quotaBytes };
      out.files = listFiles(db, f.id).map((x) => ({ path: x.path, size: x.size, updatedAt: x.updated_at }));
    }
    return out;
  }

  // ---- routes ----
  const routes = [];
  const route = (method, pattern, handler) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, handler, pattern });
  };
  const POST = (p, h) => route('POST', p, h); const GET = (p, h) => route('GET', p, h);

  GET('/api/me', async ({ req, res }) => {
    const s = sessionOf(req); const a = adminOf(req);
    const floor = s ? get(db, 'SELECT slug,name,number FROM floors WHERE id=?', s.floor_id) : null;
    json(res, 200, { floor, csrf: s?.csrf || null, admin: !!a, adminCsrf: a?.csrf || null, aiMode: cfg.aiMode });
  });
  GET('/api/floors', async ({ res }) => {
    const floors = all(db, "SELECT * FROM floors WHERE status!='killed' ORDER BY number DESC").map(floorCard);
    const taken = new Set(floors.map((f) => f.number));
    const reserved = new Set(all(db, 'SELECT floor_number n FROM codes WHERE claimed_at IS NULL AND floor_number IS NOT NULL').map((c) => c.n));
    let vacant = null;
    for (let n = 1; n <= cfg.towerFloors; n++) if (!taken.has(n) && !reserved.has(n)) { vacant = n; break; }
    json(res, 200, { floors, towerFloors: cfg.towerFloors, vacant, globalPause: engine.globalPaused() });
  });
  POST('/api/claim/check', async ({ req, res, ip }) => {
    limit('code', ip);
    const b = await readJson(req, 2048);
    const row = get(db, 'SELECT floor_number,claimed_at FROM codes WHERE hash=?', A.sha256(A.normalizeCode(b.code)));
    if (!row || row.claimed_at) throw new HttpError(404, 'bad_code', 'That code isn\'t valid, or it has already opened an office.');
    json(res, 200, { ok: true, floor: row.floor_number ?? nextFreeFloor() });
  });
  function nextFreeFloor(wanted) {
    const taken = new Set(all(db, 'SELECT number FROM floors').map((f) => f.number));
    const reserved = new Set(all(db, 'SELECT floor_number n FROM codes WHERE claimed_at IS NULL AND floor_number IS NOT NULL').map((c) => c.n));
    if (wanted) return taken.has(wanted) ? null : wanted;
    for (let n = 1; n <= cfg.towerFloors; n++) if (!taken.has(n) && !reserved.has(n)) return n;
    return null;
  }
  POST('/api/claim', async ({ req, res, ip }) => {
    limit('code', ip);
    const b = await readJson(req, 8192);
    const code = A.normalizeCode(b.code); const hash = A.sha256(code);
    const name = clean(b.name, 60); const tagline = clean(b.tagline, 120); const bossName = clean(b.bossName, 30);
    if (name.length < 2) throw new HttpError(400, 'bad_name', 'Give your company a name.');
    if (!bossName) throw new HttpError(400, 'bad_boss', 'What should the staff call you?');
    const colors = validColors(b.colors); const look = validLook(b.look); const decor = validDecor({});
    const base = slugify(name, 'floor');
    const recovery = A.newRecoveryCode(); const recoveryHash = A.hashSecret(recovery);
    const floorId = tx(db, () => {
      const row = get(db, 'SELECT * FROM codes WHERE hash=?', hash);
      if (!row || row.claimed_at) throw new HttpError(404, 'bad_code', 'That code isn\'t valid, or it has already opened an office.');
      const number = nextFreeFloor(row.floor_number);
      if (!number) throw new HttpError(409, 'no_floors', 'The building is full, or that floor is taken.');
      let slug = RESERVED.has(base) || !slugPattern.test(base) ? `${base}-co`.replace(/^-+/, '') : base;
      for (let i = 2; get(db, 'SELECT 1 x FROM floors WHERE slug=?', slug); i++) slug = `${base.slice(0, 34)}-${i}`;
      const r = run(db, 'INSERT INTO floors (slug,number,name,tagline,colors,boss,decor,recovery_hash,created_at) VALUES (?,?,?,?,?,?,?,?,?)', slug, number, name, tagline, JSON.stringify(colors), JSON.stringify({ name: bossName, look }), JSON.stringify(decor), recoveryHash, now());
      const id = Number(r.lastInsertRowid);
      run(db, 'UPDATE codes SET claimed_at=?, floor_id=? WHERE hash=? AND claimed_at IS NULL', now(), id, hash);
      engine.seedStaff(id);
      return id;
    });
    const f = get(db, 'SELECT * FROM floors WHERE id=?', floorId);
    const s = A.createSession(db, 'owner', floorId, A.OWNER_MAX_AGE, now());
    engine.managerSays(floorId, `Welcome to the building, ${bossName}. I'm your office manager and everyone's at their desks. Tell me what ${name} should make first, or just think out loud with me.`);
    log('info', 'floor claimed', { floor: f.number });
    json(res, 201, { slug: f.slug, number: f.number, recoveryCode: recovery, csrf: s.csrf }, { 'set-cookie': A.cookieHeader(A.COOKIE, s.token, A.OWNER_MAX_AGE) });
  });
  POST('/api/login', async ({ req, res, ip }) => {
    limit('login', ip);
    const b = await readJson(req, 2048);
    const slug = String(b.slug ?? '').trim().toLowerCase();
    const f = slugPattern.test(slug) ? get(db, 'SELECT * FROM floors WHERE slug=?', slug) : null;
    const code = A.normalizeCode(b.recoveryCode);
    // scrypt runs whether or not the floor exists, so timing doesn't reveal which slugs are real.
    const ok = A.verifySecret(code, f ? f.recovery_hash : DUMMY_HASH) && !!f;
    if (!ok) throw new HttpError(401, 'bad_login', 'That floor and recovery code don\'t match.');
    const fresh = A.newRecoveryCode();
    run(db, 'UPDATE floors SET recovery_hash=? WHERE id=?', A.hashSecret(fresh), f.id);
    run(db, "DELETE FROM sessions WHERE floor_id=? AND kind='owner'", f.id);
    const s = A.createSession(db, 'owner', f.id, A.OWNER_MAX_AGE, now());
    json(res, 200, { slug: f.slug, csrf: s.csrf, recoveryCode: fresh }, { 'set-cookie': A.cookieHeader(A.COOKIE, s.token, A.OWNER_MAX_AGE) });
  });
  const DUMMY_HASH = A.hashSecret('dummy');
  POST('/api/logout', async ({ req, res }) => {
    const s = sessionOf(req);
    if (s) { if (req.headers['x-office-csrf'] !== s.csrf) throw new HttpError(403, 'bad_csrf'); run(db, 'DELETE FROM sessions WHERE hash=?', s.hash); }
    json(res, 200, { ok: true }, { 'set-cookie': A.cookieHeader(A.COOKIE, '', 0) });
  });

  GET('/api/floors/:slug', async ({ req, res, p }) => {
    const f = floorBySlug(p.slug);
    json(res, 200, snapshot(f, viewerFor(req, f)));
  });
  GET('/api/floors/:slug/stream', async ({ req, res, p, ip, url }) => {
    const f = floorBySlug(p.slug);
    limit('sse', ip);
    if (bus.countIp(ip) >= 10 * cfg.rateScale || bus.total >= 400) throw new HttpError(429, 'too_many_streams', 'Too many open views.');
    const viewer = viewerFor(req, f);
    res.writeHead(200, { ...BASE_HEADERS, 'content-security-policy': APP_CSP, 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.socket?.setNoDelay?.(true);
    const write = (ev) => {
      // A revoked or expired session stops being the owner at once. The browser reconnects as a visitor.
      if (viewer.owner) {
        const live = get(db, 'SELECT expires_at e FROM sessions WHERE hash=?', viewer.sessionHash);
        if (!live || live.e < now()) { res.end(); return; }
      }
      const fl = get(db, 'SELECT public_chat c, default_private d FROM floors WHERE id=?', f.id);
      const v = engine.publicView(ev, { owner: viewer.owner, publicChat: !!fl?.c, defaultPrivate: !!fl?.d });
      if (!v) return;
      res.write(`${v.id ? `id: ${v.id}\n` : ''}event: ${v.type}\ndata: ${JSON.stringify({ ...v.data, _ts: v.ts, _id: v.id || undefined })}\n\n`);
    };
    const sub = { ip, send: write, close: () => res.end() };
    // Catch-up: everything persisted since the client last saw, with the same redaction as live events.
    const lastRaw = req.headers['last-event-id'] ?? url.searchParams.get('since');
    const last = Number(lastRaw);
    if (Number.isInteger(last) && last > 0) {
      for (const e of all(db, 'SELECT * FROM events WHERE floor_id=? AND id>? ORDER BY id LIMIT 300', f.id, last)) {
        write({ floorId: f.id, type: e.type, project: e.project, data: JSON.parse(e.data), id: e.id, ts: e.created_at });
      }
    }
    res.write(': connected\n\n');
    const off = bus.subscribe(f.id, sub);
    const beat = setInterval(() => res.write(': beat\n\n'), 20000); beat.unref?.();
    req.on('close', () => { clearInterval(beat); off(); });
    return 'stream';
  });
  POST('/api/floors/:slug/chat', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug);
    limit('chat', `floor:${f.id}`); limit('chat', ip);
    const b = await readJson(req, 16 * 1024);
    const text = clean2(b.text);
    if (!text) throw new HttpError(400, 'empty');
    if (text.length > MAX_CHAT) throw new HttpError(413, 'too_large', `Keep it under ${MAX_CHAT} characters.`);
    engine.bossMessage(f, text);
    json(res, 202, { ok: true });
  });
  const clean2 = (v) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, '').trim();
  POST('/api/floors/:slug/control', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug);
    limit('mutate', ip);
    const b = await readJson(req, 16 * 1024);
    if (b.action === 'pause') engine.pauseFloor(f.id);
    else if (b.action === 'resume') engine.resumeFloor(f.id);
    else if (b.action === 'stop') engine.stopFloor(f.id);
    else if (b.action === 'redirect') {
      const text = clean2(b.text);
      if (!text || text.length > MAX_CHAT) throw new HttpError(400, 'bad_text', 'Say where the team should go instead.');
      engine.redirectFloor(f, text);
    } else throw new HttpError(400, 'bad_action');
    json(res, 200, { ok: true, ...engine.floorState(f.id) });
  });
  POST('/api/floors/:slug/settings', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug);
    limit('mutate', ip);
    const b = await readJson(req);
    const boss = JSON.parse(f.boss);
    if (b.boss) { boss.name = clean(b.boss.name, 30) || boss.name; boss.look = validLook(b.boss.look, boss.look); }
    const name = clean(b.name, 60); const hasTag = typeof b.tagline === 'string';
    run(db, 'UPDATE floors SET name=?, tagline=?, colors=?, boss=?, decor=?, public_chat=?, default_private=? WHERE id=?',
      name.length >= 2 ? name : f.name, hasTag ? clean(b.tagline, 120) : f.tagline, JSON.stringify(validColors(b.colors, JSON.parse(f.colors))), JSON.stringify(boss), JSON.stringify(validDecor(b.decor, JSON.parse(f.decor))),
      typeof b.publicChat === 'boolean' ? Number(b.publicChat) : f.public_chat, typeof b.defaultPrivate === 'boolean' ? Number(b.defaultPrivate) : f.default_private, f.id);
    engine.emit(f.id, 'reload', {}, { persist: false });
    json(res, 200, { ok: true });
  });
  POST('/api/floors/:slug/staff/:id', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug);
    limit('mutate', ip);
    const b = await readJson(req);
    const a = get(db, 'SELECT * FROM agents WHERE id=? AND floor_id=?', Number(p.id), f.id);
    if (!a) throw new HttpError(404, 'not_found');
    run(db, 'UPDATE agents SET name=?, look=? WHERE id=?', clean(b.name, 24) || a.name, JSON.stringify(validLook(b.look, JSON.parse(a.look))), a.id);
    engine.emit(f.id, 'reload', {}, { persist: false });
    json(res, 200, { ok: true });
  });
  POST('/api/floors/:slug/projects/:project', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug);
    limit('mutate', ip);
    const b = await readJson(req, 1024);
    const pr = get(db, 'SELECT * FROM projects WHERE floor_id=? AND slug=?', f.id, p.project);
    if (!pr) throw new HttpError(404, 'not_found');
    if (typeof b.private !== 'boolean') throw new HttpError(400, 'bad_private');
    run(db, 'UPDATE projects SET private=? WHERE floor_id=? AND slug=?', Number(b.private), f.id, pr.slug);
    engine.emit(f.id, 'reload', {}, { persist: false });
    json(res, 200, { ok: true, private: b.private });
  });
  GET('/api/floors/:slug/projects/:project/preview', async ({ req, res, p }) => {
    // Owner-only signed link for viewing a private project; public projects just use their normal URL.
    const f = requireOwner(req, p.slug);
    const pr = get(db, 'SELECT * FROM projects WHERE floor_id=? AND slug=? AND published_at IS NOT NULL', f.id, p.project);
    if (!pr) throw new HttpError(404, 'not_found');
    json(res, 200, { url: previewUrl(f, pr.slug) });
  });
  const previewUrl = (f, slug) => {
    const exp = Math.floor(now() / 1000) + 3600;
    return `${BASE}/f/${f.slug}/${slug}/~p${exp}.${A.signPreview(secret, f.id, slug, exp)}/`;
  };
  GET('/api/floors/:slug/files/:encoded', async ({ req, res, p }) => {
    const f = requireOwner(req, p.slug);
    let path; try { path = cleanPath(Buffer.from(p.encoded, 'base64url').toString('utf8')); } catch { throw new HttpError(400, 'bad_path'); }
    const file = readFile(db, f.id, path);
    if (!file) throw new HttpError(404, 'not_found');
    // Never served as a page: the app shows this as text, or as sanitised markdown.
    json(res, 200, { path: file.path, size: file.size, text: file.content, html: /\.md$/i.test(file.path) ? renderMarkdown(file.content) : null });
  });
  POST('/api/floors/:slug/questions/:id/answer', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug);
    limit('chat', ip);
    const b = await readJson(req, 16 * 1024);
    const text = clean2(b.text);
    if (!text || text.length > MAX_CHAT) throw new HttpError(400, 'bad_text', 'Write an answer first.');
    if (!engine.answerQuestion(f, Number(p.id), text)) throw new HttpError(404, 'not_found');
    json(res, 200, { ok: true });
  });
  POST('/api/floors/:slug/purchases/:id', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug);
    limit('mutate', ip);
    const b = await readJson(req, 1024);
    // These labels are only notes for the staff. There is no payment path anywhere in this build.
    if (!['pending', 'declined', 'bought-myself'].includes(b.status)) throw new HttpError(400, 'bad_status');
    const r = run(db, 'UPDATE purchases SET status=? WHERE id=? AND floor_id=?', b.status, Number(p.id), f.id);
    if (!r.changes) throw new HttpError(404, 'not_found');
    engine.emit(f.id, 'reload', {}, { persist: false });
    json(res, 200, { ok: true });
  });

  // ---- admin ----
  POST('/api/admin/login', async ({ req, res, ip }) => {
    limit('admin', ip);
    limit('adminAll', 'all'); // high enough that one attacker's IP can't lock the real admin out
    const b = await readJson(req, 2048);
    if (!adminHash || !A.verifySecret(String(b.password ?? '').slice(0, 300), adminHash)) throw new HttpError(401, 'bad_login', 'Wrong password.');
    const s = A.createSession(db, 'admin', null, A.ADMIN_MAX_AGE, now());
    json(res, 200, { csrf: s.csrf }, { 'set-cookie': A.cookieHeader(A.ADMIN_COOKIE, s.token, A.ADMIN_MAX_AGE) });
  });
  POST('/api/admin/logout', async ({ req, res }) => {
    const s = requireAdmin(req);
    run(db, 'DELETE FROM sessions WHERE hash=?', s.hash);
    json(res, 200, { ok: true }, { 'set-cookie': A.cookieHeader(A.ADMIN_COOKIE, '', 0) });
  });
  GET('/api/admin/overview', async ({ req, res }) => {
    requireAdmin(req);
    const floors = all(db, 'SELECT * FROM floors ORDER BY number').map((f) => ({
      id: f.id, number: f.number, slug: f.slug, name: f.name, status: f.status, paused: !!f.paused, createdAt: f.created_at,
      spendToday: engine.spentToday(f.id), spendTotal: get(db, 'SELECT COALESCE(SUM(cost_usd),0) n FROM ledger WHERE floor_id=?', f.id).n,
      running: get(db, "SELECT COUNT(*) n FROM tasks WHERE floor_id=? AND status='doing'", f.id).n, bytes: floorBytes(db, f.id),
      projects: get(db, 'SELECT COUNT(*) n FROM projects WHERE floor_id=? AND published_at IS NOT NULL', f.id).n,
    }));
    const purchases = all(db, "SELECT p.id,p.item,p.price,p.why,p.link,p.status,f.name floor FROM purchases p JOIN floors f ON f.id=p.floor_id WHERE p.status='pending' ORDER BY p.id DESC LIMIT 100");
    const codes = get(db, 'SELECT COUNT(*) n FROM codes WHERE claimed_at IS NULL').n;
    json(res, 200, { floors, purchases, unclaimedCodes: codes, globalPause: engine.globalPaused(), spendToday: engine.spentGlobal(), globalCap: cfg.globalDailyUsd, floorCap: cfg.floorDailyUsd, aiMode: cfg.aiMode, liveLLM: engine.limiter.active, queuedLLM: engine.limiter.queue.length });
  });
  POST('/api/admin/codes', async ({ req, res, ip }) => {
    requireAdmin(req); limit('mutate', ip);
    const b = await readJson(req, 1024);
    let floor = null;
    if (b.floor !== undefined && b.floor !== null && b.floor !== '') {
      floor = Number(b.floor);
      if (!Number.isInteger(floor) || floor < 1 || floor > cfg.towerFloors) throw new HttpError(400, 'bad_floor', `Floor must be 1 to ${cfg.towerFloors}.`);
      if (get(db, 'SELECT 1 x FROM floors WHERE number=?', floor)) throw new HttpError(409, 'floor_taken', 'That floor is already taken.');
    }
    json(res, 201, { code: A.issueCode(db, floor, now()), floor });
  });
  POST('/api/admin/pause', async ({ req, res, ip }) => {
    requireAdmin(req); limit('mutate', ip);
    const b = await readJson(req, 256);
    if (typeof b.on !== 'boolean') throw new HttpError(400, 'bad_on');
    engine.setGlobalPause(b.on);
    json(res, 200, { ok: true, globalPause: b.on });
  });
  POST('/api/admin/floors/:id/:action', async ({ req, res, p, ip }) => {
    requireAdmin(req); limit('mutate', ip);
    const f = get(db, 'SELECT * FROM floors WHERE id=?', Number(p.id));
    if (!f) throw new HttpError(404, 'not_found');
    if (p.action === 'suspend') engine.setSuspended(f.id, true);
    else if (p.action === 'unsuspend') engine.setSuspended(f.id, false);
    else if (p.action === 'reset') engine.resetFloor(f.id);
    else if (p.action === 'kill') engine.killFloor(f.id);
    else throw new HttpError(400, 'bad_action');
    json(res, 200, { ok: true });
  });

  // ---- published sites ----
  const docCache = new Map();
  function renderDoc(f, pr, md) {
    const colors = JSON.parse(f.colors);
    const sources = JSON.parse(pr.sources);
    const src = sources.length ? `<section class="sources"><h2>Sources</h2><ol>${sources.map((s) => `<li><a href="${esc(s.url)}" rel="noopener noreferrer nofollow" target="_blank">${esc(s.title || s.url)}</a></li>`).join('')}</ol></section>` : '';
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(pr.title)}</title><style>
:root{--a:${colors.primary}}body{margin:0;background:#fbf8f1;color:#1f2430;font:18px/1.65 "Iowan Old Style",Palatino,Georgia,serif}main{max-width:40em;margin:0 auto;padding:7vh 22px}
h1,h2,h3{line-height:1.15}h1{font-size:2.4rem}a{color:var(--a)}pre{background:#f0ebdd;padding:14px;overflow:auto;border-radius:8px}code{font-size:.88em}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd5c3;padding:6px 9px;text-align:left}blockquote{margin-left:0;padding-left:16px;border-left:3px solid var(--a);color:#555}.by{font:12px ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase;color:#7b7464}
.sources{margin-top:3em;border-top:1px solid #ddd5c3;font-size:.9em}</style></head><body><main><p class="by">${esc(f.name)} · Floor ${f.number}</p>${renderMarkdown(md)}${src}</main></body></html>`;
  }
  function serveSite(req, res, rawSegs) {
    const SITE = { ...BASE_HEADERS, 'content-security-policy': SANDBOX_CSP, 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' };
    const miss = () => { res.writeHead(404, { ...SITE, 'content-type': 'text/plain; charset=utf-8' }); res.end('Not found'); };
    let segs;
    try { segs = rawSegs.map((s) => decodeURIComponent(s)); } catch { return miss(); }
    const [fslug, pslug, ...rest] = segs;
    if (!slugPattern.test(fslug || '') || !slugPattern.test(pslug || '')) return miss();
    const f = get(db, 'SELECT * FROM floors WHERE slug=?', fslug);
    if (!f || f.status !== 'active') return miss();
    const pr = get(db, 'SELECT * FROM projects WHERE floor_id=? AND slug=? AND published_at IS NOT NULL', f.id, pslug);
    if (!pr) return miss();
    // Private projects answer exactly like missing ones, unless a valid owner session or signed link is present.
    let tail = rest;
    let signed = false;
    if (rest[0]?.startsWith('~p')) {
      const m = rest[0].match(/^~p(\d{1,12})\.([A-Za-z0-9_-]{20,64})$/);
      if (!m) return miss();
      const exp = Number(m[1]);
      if (exp * 1000 < now() || !A.safeEqual(m[2], A.signPreview(secret, f.id, pr.slug, exp))) return miss();
      signed = true; tail = rest.slice(1);
    }
    if (pr.private && !signed) {
      const s = sessionOf(req);
      if (!s || s.floor_id !== f.id) return miss();
      // The owner's cookie authorises this navigation; a signed path lets the page's own assets load too.
      res.writeHead(302, { ...SITE, location: previewUrl(f, pr.slug) + rest.map(encodeURIComponent).join('/') });
      return res.end();
    }
    if (rawSegs.length === 2 && !req.url.split('?')[0].endsWith('/')) {
      res.writeHead(301, { ...SITE, location: `${BASE}/f/${f.slug}/${pr.slug}/` });
      return res.end();
    }
    let path = tail.filter((s, i) => !(s === '' && i === tail.length - 1)).join('/');
    if (path === '' || req.url.split('?')[0].endsWith('/')) path = path ? `${path}/index.html` : 'index.html';
    let safe;
    try { safe = cleanPath(path); } catch { return miss(); }
    let row = get(db, 'SELECT content FROM published_files WHERE floor_id=? AND project=? AND path=?', f.id, pr.slug, safe);
    let body, type;
    if (row) {
      const ext = safe.split('.').pop().toLowerCase();
      type = TEXT_EXT[ext]; body = row.content;
    } else if (safe === 'index.html' || safe.endsWith('/index.html')) {
      row = get(db, 'SELECT content FROM published_files WHERE floor_id=? AND project=? AND path=?', f.id, pr.slug, safe.replace(/index\.html$/, 'index.md'));
      if (!row) return miss();
      type = 'text/html; charset=utf-8';
      const key = `${f.id}|${pr.slug}|${pr.published_at}|${safe}|${f.name}|${f.number}|${f.colors}|${pr.title}|${pr.sources}`;
      body = docCache.get(key);
      if (body === undefined) {
        body = renderDoc(f, pr, row.content);
        if (docCache.size >= 40) docCache.delete(docCache.keys().next().value);
        docCache.set(key, body);
      }
    } else return miss();
    res.writeHead(200, { ...SITE, 'content-type': type });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  // ---- static app ----
  const INDEX = '/index.html';
  function serveStatic(req, res, path) {
    const file = statics.get(path);
    if (!file) return send(res, 404, 'Not found', { 'content-type': 'text/plain; charset=utf-8' });
    const headers = { 'content-type': file.type, 'cache-control': path === INDEX ? 'no-cache' : 'public, max-age=3600' };
    const gz = file.gz && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
    if (gz) { headers['content-encoding'] = 'gzip'; headers.vary = 'accept-encoding'; }
    send(res, 200, req.method === 'HEAD' ? undefined : gz ? file.gz : file.body, headers);
  }

  // ---- dispatcher ----
  async function handle(req, res) {
    const started = Date.now();
    const ip = ipOf(req);
    let url;
    try { url = new URL(req.url, 'http://x'); } catch { return send(res, 400, 'Bad request'); }
    const pathname = url.pathname;
    try {
      if (pathname === BASE) { limit('read', ip); return serveStatic(req, res, INDEX); }
      if (!pathname.startsWith(`${BASE}/`)) return send(res, 404, 'Not found', { 'content-type': 'text/plain; charset=utf-8' });
      const rest = pathname.slice(BASE.length);
      if (rest === '/robots.txt') return send(res, 200, 'User-agent: *\nDisallow: /\n', { 'content-type': 'text/plain; charset=utf-8' });
      if (rest.startsWith('/f/')) {
        limit('publicSite', ip);
        if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { ...BASE_HEADERS, 'content-security-policy': SANDBOX_CSP, allow: 'GET, HEAD' }); return res.end(); }
        return serveSite(req, res, rawSegments(req.url));
      }
      if (rest.startsWith('/api/')) {
        const method = req.method;
        if (method !== 'GET') { checkOrigin(req); limit('mutate', `all:${ip}`); } else limit('read', ip);
        const sub = rest;
        let matched = false;
        for (const r of routes) {
          const m = sub.match(r.re);
          if (!m) continue;
          matched = true;
          if (r.method !== method) continue;
          const p = {};
          r.keys.forEach((k, i) => { try { p[k] = decodeURIComponent(m[i + 1]); } catch { throw new HttpError(400, 'bad_path'); } });
          const out = await r.handler({ req, res, p, ip, url });
          if (out !== 'stream') log('info', 'api', { m: method, r: r.pattern, s: res.statusCode, ms: Date.now() - started });
          return undefined;
        }
        throw new HttpError(matched ? 405 : 404, matched ? 'method_not_allowed' : 'not_found');
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', { allow: 'GET, HEAD' });
      limit('read', ip);
      // App pages are all the one shell. Anything else must be an exact known asset.
      if (rest === '/' || /^\/admin\/?$/.test(rest) || /^\/floor\/[a-z0-9-]+\/?$/.test(rest)) return serveStatic(req, res, INDEX);
      return serveStatic(req, res, rest);
    } catch (e) {
      if (e instanceof HttpError) { if (e.status >= 500) log('error', 'http', { code: e.code }); return json(res, e.status, { error: e.code, message: e.message }, e.status === 429 ? { 'retry-after': '30' } : {}); }
      if (e instanceof WorkspaceError) return json(res, 400, { error: 'bad_request', message: e.message });
      if (e?.code === 'ERR_STREAM_PREMATURE_CLOSE') return undefined;
      log('error', 'unhandled', { err: scrub(e?.message, cfg) });
      return json(res, 500, { error: 'server_error', message: 'Something broke in the building.' });
    }
  }
  // Path segments from the raw URL. Decoded by serveSite itself, one segment at a time, so %2f can never add a level.
  const rawSegments = (u) => u.split('?')[0].slice(`${BASE}/f/`.length).split('/');

  const server = http.createServer((req, res) => { handle(req, res).catch(() => { try { res.destroy(); } catch { /* gone */ } }); });
  server.requestTimeout = 30000; server.headersTimeout = 15000; server.keepAliveTimeout = 5000; server.maxConnections = 1200;
  return {
    server, engine, bus, rates,
    async close() {
      rates.close();
      await engine.stop();
      bus.closeAll();
      await new Promise((r) => { server.close(() => r()); server.closeAllConnections?.(); });
    },
  };
}
