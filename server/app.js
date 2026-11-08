// HTTP layer: routing, security headers, CSRF, rate limits, static files, published sites and the JSON API. Everything lives under /theoffice.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildStatics, pickEncoding, warmBrotli } from './statics.js';
import { get, all, run, tx } from './db.js';
import { ROOT } from './config.js';
import * as A from './auth.js';
import { Bus } from './bus.js';
import { Engine, agentView, taskView, PRIVATE_TEXT, redactChat, redactor, viewEvent } from './engine.js';
import { slugify, slugPattern, cleanPath, mimeOf, listFiles, readFile, floorBytes, WorkspaceError, saveUpload, attachmentsOf, isImageType, MAX_UPLOAD_BYTES } from './workspace.js';
import { publicUrl } from './tools.js';
import { embeddedV4, expandV6 } from './safefetch.js';
import { isIP } from 'node:net';
import { renderMarkdown, esc } from '../public/js/markdown.js';
import { LOOK_FIELDS, DEFAULT_LOOK, DEFAULT_DECOR, DEFAULT_COLORS, FLOOR_STYLES, PETS, LAYOUTS, WALL_MATS, ART_STYLES } from '../public/js/looks.js';
import { createOpenRouterClient, scrub } from './llm.js';
import { createAnthropicClient, createRouter } from './anthropic.js';
import { createMockClient } from './mock.js';
import { createManagedClient } from './sessions.js';
import { createMockSessions } from './mock-sessions.js';
import { appLabel, appOrigin, appHostLabel, lookupLabel, appHeaders, previewCookie, previewCookieName } from './apps.js';
import { handleData, DataError, DATA_LIMITS, clearProjectData } from './appdata.js';
import { installCloud, SDK_JS, API_PREFIX } from './cloud/index.js';
import { recordVisit, projectStats, formEntries, formsCsv, formCount } from './launch.js';
import { DomainRefused } from './domains.js';
import { installOrders } from './orders.js';
import { installFiller } from './filler.js';
import { installBuilding } from './building.js';
import { installLife } from './life.js';
import { installHelp } from './help.js';
import { installPurchases } from './purchases.js';
import { budgetReport } from './budget.js';
import { installCustomise } from './customise.js';
import { installModes } from './modes.js';
import { installBusiness } from './business.js';
import { installMail } from './mail.js';
import { absoluteMeta } from './metaabs.js';

const BASE = '/theoffice';
// Exact policy from the security brief. Published content runs on an opaque origin, with no access to any iscolinfree.com cookie, page or API.
export const SANDBOX_CSP = 'sandbox allow-scripts allow-forms allow-popups';
const APP_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const BASE_HEADERS = {
  'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex, nofollow, noarchive',
  'referrer-policy': 'same-origin', 'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};
const LIMITS = { form: [8, 60000], buy: [10, 60000], dataRead: [600, 60000], dataWrite: [90, 60000], dataIp: [300, 60000], dataProject: [1500, 60000], code: [8, 60000], login: [6, 60000], admin: [5, 60000], adminAll: [60, 60000], chat: [20, 60000], upload: [30, 60000], mutate: [90, 60000], read: [900, 60000], publicSite: [600, 60000], sse: [40, 60000] };
const MAX_CHAT = 4000;
// Unsent bytes one live view may build up. A long job never goes quiet, and a phone that fell asleep shouldn't be able to pile that up here. It reconnects and catches up from its last event.
const STREAM_BACKLOG = 256 * 1024;
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
  if (LAYOUTS.includes(i.layout)) out.layout = i.layout;
  if (WALL_MATS.includes(i.wallMat)) out.wallMat = i.wallMat;
  if (ART_STYLES.includes(i.artStyle)) out.artStyle = i.artStyle;
  out.wall = hex(i.wall, out.wall);
  if (Number.isInteger(i.plants) && i.plants >= 0 && i.plants <= 8) out.plants = i.plants;
  for (const k of ['rug', 'art', 'coffee', 'arcade', 'neon']) if (typeof i[k] === 'boolean') out[k] = i[k];
  return out;
}
const validColors = (i, base = DEFAULT_COLORS) => ({ primary: hex(i?.primary, base.primary), accent: hex(i?.accent, base.accent) });

export function createApp({ db, cfg, models, log = () => {}, now = Date.now, llm, fetcher, httpFetch, sessions, namecheap, media, search }) {
  const bus = new Bus();
  const sessionClient = !cfg.computerEnabled ? null : sessions || (cfg.aiMode === 'mock' ? createMockSessions(cfg) : createManagedClient(cfg));
  const client = llm || (cfg.aiMode === 'mock' ? createMockClient(cfg) : createRouter({ anthropic: createAnthropicClient(cfg), openrouter: createOpenRouterClient(cfg) }));
  const engine = new Engine({ db, cfg, models, llm: client, bus, log, now, fetcher, httpFetch, sessions: sessionClient, namecheap, media, search });
  const rates = new A.RateLimiter(cfg.rateScale, now);
  const statics = buildStatics(join(ROOT, 'public'), BASE);
  // Same-origin copies every project can load, so nothing published needs a CDN or a shared host.
  const clientLib = readFileSync(join(ROOT, 'server/app-client/office.js'));
  const threeLib = statics.get('/vendor/three/three.module.min.js');
  const mainCsp = cfg.appsBaseDomain ? APP_CSP.replace("frame-src 'self'", `frame-src 'self' ${cfg.appsScheme}://*.${cfg.appsBaseDomain}`) : APP_CSP;
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
    res.writeHead(status, { ...BASE_HEADERS, 'content-security-policy': mainCsp, 'x-frame-options': 'DENY', 'cross-origin-resource-policy': 'same-origin', 'cache-control': 'no-store', ...headers });
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
  // A published site on a sibling subdomain can plant a cookie for the parent domain. Two of ours at once means one is planted, so neither is believed.
  const sessionOf = (req) => (A.cookieCount(req.headers.cookie, A.COOKIE) > 1 ? null : A.loadSession(db, A.parseCookies(req.headers.cookie)[A.COOKIE], 'owner', now()));
  const adminOf = (req) => (A.cookieCount(req.headers.cookie, A.ADMIN_COOKIE) > 1 ? null : A.loadSession(db, A.parseCookies(req.headers.cookie)[A.ADMIN_COOKIE], 'admin', now()));
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

  // ---- extension hooks (floors-plus) ----
  // Feature modules add rows to these. Each is called with the row being built and may add public fields to it.
  const hooks = { floorCard: [], snapshot: [], adminFloor: [] };
  const applyHooks = (list, ...args) => { for (const h of list) h(...args); };

  // ---- views ----
  const floorCard = (f) => {
    const busy = get(db, "SELECT COUNT(*) n FROM tasks WHERE floor_id=? AND status='doing'", f.id).n;
    const card = { number: f.number, slug: f.slug, name: f.name, tagline: f.tagline, colors: JSON.parse(f.colors), status: f.status, busy, ...(f.name ? {} : { setup: true }) };
    applyHooks(hooks.floorCard, f, card);
    return card;
  };
  const projectView = (f, p) => {
    const domain = engine.domains.liveFor(f.id, p.slug);
    return { slug: p.slug, title: p.title, description: p.description, kind: p.kind, private: !!p.private, publishedAt: p.published_at, sources: JSON.parse(p.sources), url: publicUrl(f.slug, p.slug), appUrl: cfg.appsBaseDomain ? `${appOrigin(cfg, appLabel(db, f, p.slug))}/` : null, domain };
  };
  // What only the boss sees on a project card.
  const projectOwnerView = (f, p) => ({ ...projectView(f, p), hasPayment: !!p.payment_link, indexable: !!p.indexable, signups: formCount(db, f.id, p.slug), launchCheck: p.launch_check ? JSON.parse(p.launch_check) : null, designReview: p.design_review ? JSON.parse(p.design_review) : null, launchReport: p.launch_report });
  const privateSet = (f) => new Set(all(db, 'SELECT slug FROM projects WHERE floor_id=? AND private=1', f.id).map((p) => p.slug));
  function snapshot(f, viewer) {
    const hidden = viewer.owner ? new Set() : privateSet(f);
    if (!viewer.owner && viewer.defaultPrivate) hidden.add(''); // nothing untagged is public on a default-private floor
    const hide = viewer.owner ? (s) => s : redactor(db, f.id);
    const agents = all(db, 'SELECT * FROM agents WHERE floor_id=? ORDER BY id', f.id).map((a) => {
      const v = agentView(a);
      if (hidden.has(a.project)) { v.activity = PRIVATE_TEXT; v.taskId = null; } else v.activity = hide(v.activity);
      return v;
    });
    // Named columns: a view has no business loading transcripts, however large a task's have grown.
    // The latest, and whatever is running now: the queue runs oldest first, so with a long queue that can be far behind the latest.
    const tasks = all(db, "SELECT id,plan,title,brief,agent_id,project,status,result,updated_at,depends_on FROM tasks WHERE floor_id=? AND (status IN ('doing','blocked') OR id>=(SELECT COALESCE(MIN(id),0) FROM (SELECT id FROM tasks WHERE floor_id=? ORDER BY id DESC LIMIT 80))) ORDER BY id", f.id, f.id).map((t) => {
      const v = taskView(t);
      if (viewer.owner) return v;
      const { brief: _b, result: _r, ...pub } = v;
      return hidden.has(t.project) ? { ...pub, title: 'Private task', plan: '', project: '' } : { ...pub, title: hide(pub.title), plan: hide(pub.plan) };
    });
    const projects = all(db, 'SELECT * FROM projects WHERE floor_id=? AND published_at IS NOT NULL ORDER BY published_at DESC', f.id).filter((p) => viewer.owner || !p.private).map((p) => (viewer.owner ? projectOwnerView(f, p) : projectView(f, p)));
    const feedRows = all(db, "SELECT * FROM events WHERE floor_id=? AND type='feed' ORDER BY id DESC LIMIT 120", f.id).reverse();
    const feed = feedRows.map((e) => {
      const d = JSON.parse(e.data);
      return { id: e.id, ...d, text: hidden.has(e.project) && (d.agent !== null || e.project) ? PRIVATE_TEXT.toLowerCase() : hide(d.text) };
    });
    // The same rules as the stream, so reloading the page can never show more than watching it live did.
    const talk = all(db, "SELECT * FROM events WHERE floor_id=? AND type='talk' ORDER BY id DESC LIMIT 80", f.id).reverse()
      .map((e) => engine.publicView({ floorId: f.id, type: 'talk', project: e.project, data: JSON.parse(e.data), id: e.id, ts: e.created_at }, viewer)).filter(Boolean)
      .map((v) => ({ id: v.id, ...v.data }));
    const out = {
      viewer: { owner: viewer.owner }, floor: { number: f.number, slug: f.slug, name: f.name, setup: !f.name, tagline: f.tagline, colors: JSON.parse(f.colors), boss: JSON.parse(f.boss), decor: JSON.parse(f.decor), publicChat: !!f.public_chat, defaultPrivate: !!f.default_private, ...engine.floorState(f.id) },
      agents, tasks, projects, feed, talk, lastEventId: get(db, 'SELECT COALESCE(MAX(id),0) n FROM events WHERE floor_id=?', f.id).n,
    };
    // Whether the money has run out is between the boss and the owner.
    if (!viewer.owner) { delete out.floor.budgetStopped; delete out.floor.outOfBudget; }
    if (viewer.owner || viewer.publicChat) out.messages = all(db, "SELECT id,role,agent_id agentId,text,files,created_at createdAt FROM messages WHERE floor_id=? AND role!='note' ORDER BY id DESC LIMIT 120", f.id).reverse().filter((m) => viewer.owner || !['report', 'help', 'budget'].includes(m.role)).map(({ files, ...m }) => (viewer.owner ? { ...m, ...(files ? { attachments: attachmentsOf(db, f.id, JSON.parse(files)).map(({ path: _p, ...x }) => x) } : {}) } : { ...m, text: redactChat(db, f.id, m.text) }));
    if (viewer.owner) {
      out.questions = all(db, 'SELECT q.id,q.text,a.name agentName FROM questions q LEFT JOIN agents a ON a.id=q.agent_id WHERE q.floor_id=? AND q.answer IS NULL ORDER BY q.id', f.id);
      out.purchases = all(db, 'SELECT p.id,p.item,p.price,p.why,p.link,p.status,p.admin_note adminNote,p.created_at createdAt,a.name agentName FROM purchases p LEFT JOIN agents a ON a.id=p.agent_id WHERE p.floor_id=? ORDER BY p.id DESC LIMIT 50', f.id);
      out.domains = engine.domains.forFloor(f.id);
      out.domainsOn = engine.domains.enabled;
      out.ios = engine.ios.forFloor(f.id);
      out.storage = { used: floorBytes(db, f.id), quota: cfg.quotaBytes };
      out.files = listFiles(db, f.id).map((x) => ({ path: x.path, size: x.size, updatedAt: x.updated_at }));
    }
    applyHooks(hooks.snapshot, f, viewer, out);
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
    const rows = all(db, "SELECT * FROM floors WHERE status!='killed' ORDER BY number DESC");
    // A hidden floor is left out of the directory and the lift, but its number is still taken.
    const floors = rows.filter((f) => !f.hidden).map(floorCard);
    const taken = new Set(rows.map((f) => f.number));
    const reserved = new Set(all(db, 'SELECT floor_number n FROM codes WHERE claimed_at IS NULL AND floor_number IS NOT NULL').map((c) => c.n));
    // The floors that really are to let: a hidden floor's number and one a code is holding are neither listed nor offered.
    const toLet = [];
    for (let n = 1; n <= cfg.towerFloors; n++) if (!taken.has(n) && !reserved.has(n)) toLet.push(n);
    json(res, 200, { floors, towerFloors: cfg.towerFloors, vacant: toLet[0] ?? null, toLet, globalPause: engine.globalPaused() });
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
    // A name is optional now: without one the manager works out the company with the boss in the chat. One letter is still a typo.
    if (name.length === 1) throw new HttpError(400, 'bad_name', 'Give your company a name.');
    // The old form names both. A code on its own opens a floor that is set up in the chat, boss's name and all.
    if (name && !bossName) throw new HttpError(400, 'bad_boss', 'What should the staff call you?');
    const colors = validColors(b.colors); const look = validLook(b.look); const decor = validDecor({});
    const given = slugify(name, 'floor');
    const recovery = A.newRecoveryCode(); const recoveryHash = A.hashSecret(recovery);
    const floorId = tx(db, () => {
      const row = get(db, 'SELECT * FROM codes WHERE hash=?', hash);
      if (!row || row.claimed_at) throw new HttpError(404, 'bad_code', 'That code isn\'t valid, or it has already opened an office.');
      const number = nextFreeFloor(row.floor_number);
      if (!number) throw new HttpError(409, 'no_floors', 'The building is full, or that floor is taken.');
      const base = name ? given : `floor-${number}`;
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
    const mgrName = get(db, "SELECT name FROM agents WHERE floor_id=? AND role='manager'", floorId)?.name || 'your office manager';
    engine.managerSays(floorId, name
      ? `Welcome to the building, ${bossName}. I'm your office manager and everyone's at their desks. What should ${name} start on? Tap one below, or just tell me what's on your mind.`
      : `${bossName ? `${bossName}, hi` : 'Hi'}. I'm ${mgrName}, your office manager. The staff are at their desks and nobody knows what company this is yet, so that's our first job. ${bossName ? '' : 'What should we call you, and what'}${bossName ? 'What' : ''} should it do? A rough idea is plenty, or say "you pick" and I'll pitch you one.`);
    engine.people.castFloor(floorId);
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
    res.writeHead(200, { ...BASE_HEADERS, 'content-security-policy': mainCsp, 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
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
    // Counted from what the catch-up below leaves unsent. That goes out in one burst, and dropping a viewer for it would only make them reconnect and ask for the same burst.
    let mostUnsent = Infinity;
    const sub = { ip, send: (ev) => { if (res.writableLength > mostUnsent) res.destroy(); else write(ev); }, close: () => res.end() };
    // Catch-up: everything persisted since the client last saw, with the same redaction as live events.
    const lastRaw = req.headers['last-event-id'] ?? url.searchParams.get('since');
    const last = Number(lastRaw);
    if (Number.isInteger(last) && last > 0) {
      for (const e of all(db, 'SELECT * FROM events WHERE floor_id=? AND id>? ORDER BY id LIMIT 300', f.id, last)) {
        write({ floorId: f.id, type: e.type, project: e.project, data: JSON.parse(e.data), id: e.id, ts: e.created_at });
      }
    }
    res.write(': connected\n\n');
    mostUnsent = res.writableLength + STREAM_BACKLOG;
    const off = bus.subscribe(f.id, sub);
    const beat = setInterval(() => res.write(': beat\n\n'), 20000); beat.unref?.();
    req.on('close', () => { clearInterval(beat); off(); });
    return 'stream';
  });
  POST('/api/floors/:slug/chat', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug);
    limit('chat', `floor:${f.id}`); limit('chat', ip);
    const b = await readJson(req, 16 * 1024);
    let text = clean2(b.text);
    if (b.attachments !== undefined && (!Array.isArray(b.attachments) || b.attachments.length > MAX_ATTACH)) throw new HttpError(400, 'bad_attachments', `Attach up to ${MAX_ATTACH} files.`);
    // Only this floor's own uploads. An id from anywhere else is as good as none.
    const files = attachmentsOf(db, f.id, b.attachments);
    if (files.length !== new Set(b.attachments || []).size) throw new HttpError(404, 'attachment_not_found', 'One of those files is gone. Attach it again.');
    if (!text && files.length) text = files.length === 1 ? 'I attached a file.' : 'I attached some files.';
    if (!text) throw new HttpError(400, 'empty');
    if (text.length > MAX_CHAT) throw new HttpError(413, 'too_large', `Keep it under ${MAX_CHAT} characters.`);
    engine.bossChat(f, text, files);
    json(res, 202, { ok: true });
  });
  // ---- the boss's files: in through a raw body, out only to the boss, as a download ----
  const MAX_ATTACH = 10;
  async function readRaw(req, maxBytes) {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) throw new HttpError(413, 'too_large', `Files can be up to ${maxBytes / 1048576} MB.`);
    const chunks = []; let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > maxBytes) { req.resume(); throw new HttpError(413, 'too_large', `Files can be up to ${maxBytes / 1048576} MB.`); }
      chunks.push(c);
    }
    return Buffer.concat(chunks);
  }
  POST('/api/floors/:slug/attachments', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug);
    limit('upload', ip); limit('upload', `floor:${f.id}`);
    const name = String(req.headers['x-filename'] ?? '').slice(0, 600);
    if (!name.trim()) throw new HttpError(400, 'bad_filename', 'Say what the file is called.');
    const bytes = await readRaw(req, MAX_UPLOAD_BYTES);
    let r;
    try { r = saveUpload(db, f.id, name, bytes, cfg.quotaBytes, now()); } catch (e) {
      if (!(e instanceof WorkspaceError)) throw e;
      throw new HttpError(/quota|too many/i.test(e.message) ? 507 : /over \d+ MB/.test(e.message) ? 413 : 415, /quota|too many/i.test(e.message) ? 'quota' : /over \d+ MB/.test(e.message) ? 'too_large' : 'bad_type', e.message);
    }
    json(res, 201, { id: r.id, name: r.name, type: r.type, size: r.size });
  });
  GET('/api/floors/:slug/attachments', async ({ req, res, p }) => {
    const f = requireOwner(req, p.slug);
    json(res, 200, { attachments: all(db, 'SELECT id,name,type,size,created_at createdAt FROM attachments WHERE floor_id=? ORDER BY created_at DESC LIMIT 200', f.id) });
  });
  GET('/api/floors/:slug/attachments/:id', async ({ req, res, p }) => {
    const f = requireOwner(req, p.slug);
    const a = attachmentsOf(db, f.id, [p.id])[0];
    const file = a && readFile(db, f.id, a.path);
    if (!file) throw new HttpError(404, 'not_found');
    const body = typeof file.content === 'string' ? Buffer.from(file.content) : Buffer.from(file.content);
    const ascii = a.name.replace(/[^A-Za-z0-9._ -]/g, '_');
    // A download, never a page: nothing in it runs here, whatever it holds. Pictures keep their type so the boss's own page can show a preview.
    send(res, 200, body, { 'content-type': isImageType(a.type) ? a.type : 'application/octet-stream', 'content-disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(a.name)}`, 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox", 'content-length': String(body.length) });
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
    saveSettings(f, b);
    engine.emit(f.id, 'reload', {}, { persist: false });
    json(res, 200, { ok: true });
  });
  const saveSettings = (f, b) => {
    const boss = JSON.parse(f.boss);
    if (b.boss) { boss.name = clean(b.boss.name, 30) || boss.name; boss.look = validLook(b.boss.look, boss.look); }
    const name = clean(b.name, 60); const hasTag = typeof b.tagline === 'string';
    run(db, 'UPDATE floors SET name=?, tagline=?, colors=?, boss=?, decor=?, public_chat=?, default_private=? WHERE id=?',
      name.length >= 2 ? name : f.name, hasTag ? clean(b.tagline, 120) : f.tagline, JSON.stringify(validColors(b.colors, JSON.parse(f.colors))), JSON.stringify(boss), JSON.stringify(validDecor(b.decor, JSON.parse(f.decor))),
      typeof b.publicChat === 'boolean' ? Number(b.publicChat) : f.public_chat, typeof b.defaultPrivate === 'boolean' ? Number(b.defaultPrivate) : f.default_private, f.id);
  };
  POST('/api/floors/:slug/staff/:id', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug);
    limit('mutate', ip);
    const b = await readJson(req);
    const a = get(db, 'SELECT * FROM agents WHERE id=? AND floor_id=?', Number(p.id), f.id);
    if (!a) throw new HttpError(404, 'not_found');
    if (Object.hasOwn(models.all, clean(b.name, 24).toLowerCase())) throw new HttpError(400, 'name_is_a_job', 'That is a job here, so the manager would mix them up. Pick another name.');
    run(db, 'UPDATE agents SET name=?, look=? WHERE id=?', clean(b.name, 24) || a.name, JSON.stringify(validLook(b.look, JSON.parse(a.look))), a.id);
    ext.refreshCrew?.(f.id);
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
  GET('/api/floors/:slug/projects/:project/stats', async ({ req, res, p }) => {
    const f = requireOwner(req, p.slug);
    if (!get(db, 'SELECT 1 x FROM projects WHERE floor_id=? AND slug=?', f.id, p.project)) throw new HttpError(404, 'not_found');
    json(res, 200, projectStats(db, f.id, p.project, now()));
  });
  // Visitors' words, for the boss's eyes. Never given to a model, and only ever shown as text.
  GET('/api/floors/:slug/projects/:project/forms', async ({ req, res, p, url }) => {
    const f = requireOwner(req, p.slug);
    if (!get(db, 'SELECT 1 x FROM projects WHERE floor_id=? AND slug=?', f.id, p.project)) throw new HttpError(404, 'not_found');
    const entries = formEntries(db, f.id, p.project);
    if (url.searchParams.get('format') === 'csv') return send(res, 200, formsCsv(entries), { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${p.project}-signups.csv"` });
    json(res, 200, { entries });
  });
  POST('/api/floors/:slug/projects/:project/payment', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug);
    limit('mutate', ip);
    const b = await readJson(req, 2048);
    if (!get(db, 'SELECT 1 x FROM projects WHERE floor_id=? AND slug=?', f.id, p.project)) throw new HttpError(404, 'not_found');
    const link = String(b.link ?? '').trim();
    // A Payment Link only: it holds no keys and no card, and Stripe takes the money on Stripe's own page.
    if (link && !/^https:\/\/(buy|donate)\.stripe\.com\/[A-Za-z0-9_/-]{4,200}$/.test(link)) throw new HttpError(400, 'bad_link', 'Paste a Stripe Payment Link, starting https://buy.stripe.com/');
    run(db, 'UPDATE projects SET payment_link=? WHERE floor_id=? AND slug=?', link, f.id, p.project);
    engine.addMessage(f.id, 'note', null, link ? `The boss set a Stripe Payment Link on "${p.project}". Pages take money with a plain link to _office/pay. Do not ask for the address and never link to any other payment page.` : `The boss removed the payment link from "${p.project}". Take down anything that links to _office/pay.`);
    engine.emit(f.id, 'reload', {}, { persist: false });
    json(res, 200, { ok: true, hasPayment: !!link });
  });
  POST('/api/floors/:slug/projects/:project/indexable', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug);
    limit('mutate', ip);
    const b = await readJson(req, 256);
    if (typeof b.on !== 'boolean') throw new HttpError(400, 'bad_on');
    const r = run(db, 'UPDATE projects SET indexable=? WHERE floor_id=? AND slug=?', Number(b.on), f.id, p.project);
    if (!r.changes) throw new HttpError(404, 'not_found');
    json(res, 200, { ok: true });
  });
  // ---- spending, boss only: requireOwner means this floor's session and its CSRF token. No tool, and nothing a published page can send, reaches these. ----
  const domainError = (e) => { if (e instanceof DomainRefused) throw new HttpError(409, 'refused', e.message); throw e; };
  POST('/api/floors/:slug/domains/:id/buy', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug);
    limit('buy', ip); limit('buy', `floor:${f.id}`);
    const b = await readJson(req, 512);
    let o; try { o = engine.domains.approve(f, Number(p.id), b.priceUsd); } catch (e) { domainError(e); }
    json(res, 202, { ok: true, domain: engine.domains.view(o) });
  });
  POST('/api/floors/:slug/domains/:id/decline', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug);
    limit('mutate', ip);
    await readJson(req, 64);
    if (!engine.domains.decline(f, Number(p.id))) throw new HttpError(404, 'not_found');
    json(res, 200, { ok: true });
  });
  POST('/api/floors/:slug/domains/:id/attach', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug);
    limit('mutate', ip);
    const b = await readJson(req, 256);
    let o; try { o = engine.domains.attach(f, Number(p.id), String(b.project ?? '')); } catch (e) { domainError(e); }
    engine.emit(f.id, 'reload', {}, { persist: false });
    json(res, 200, { ok: true, domain: engine.domains.view(o) });
  });
  POST('/api/floors/:slug/ios/:id/:answer', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug);
    limit('buy', ip);
    await readJson(req, 64);
    if (!cfg.iosEnabled) throw new HttpError(404, 'not_found');
    if (p.answer === 'approve') { engine.ios.approve(f, Number(p.id)); return json(res, 200, { ok: true }); }
    if (p.answer === 'decline') { if (!engine.ios.decline(f, Number(p.id))) throw new HttpError(404, 'not_found'); return json(res, 200, { ok: true }); }
    throw new HttpError(400, 'bad_answer');
  });
  POST('/api/floors/:slug/projects/:project/clear-data', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug);
    limit('mutate', ip);
    json(res, 200, { ok: true, removed: clearProjectData(db, f.id, p.project) });
  });
  GET('/api/floors/:slug/projects/:project/preview', async ({ req, res, p }) => {
    // Owner-only signed link for viewing a private project; public projects just use their normal URL.
    const f = requireOwner(req, p.slug);
    const pr = get(db, 'SELECT * FROM projects WHERE floor_id=? AND slug=? AND published_at IS NOT NULL', f.id, p.project);
    if (!pr) throw new HttpError(404, 'not_found');
    json(res, 200, { url: previewUrl(f, pr.slug) });
  });
  // The boss's live look at a project while it is being built: its working files, not the published ones. Signed for this floor and project only.
  const workspacePreviewUrl = (f, slug) => {
    const exp = Math.floor(now() / 1000) + 3600;
    return `${BASE}/f/${f.slug}/${slug}/~w${exp}.${A.signPreview(secret, f.id, `w:${slug}`, exp)}/`;
  };
  const previewUrl = (f, slug) => {
    const exp = Math.floor(now() / 1000) + 3600;
    const token = `~p${exp}.${A.signPreview(secret, f.id, slug, exp)}`;
    if (cfg.appsBaseDomain) return `${appOrigin(cfg, appLabel(db, f, slug))}/${token}/`;
    return `${BASE}/f/${f.slug}/${slug}/${token}/`;
  };
  GET('/api/floors/:slug/files/:encoded', async ({ req, res, p }) => {
    const f = requireOwner(req, p.slug);
    let path; try { path = cleanPath(Buffer.from(p.encoded, 'base64url').toString('utf8')); } catch { throw new HttpError(400, 'bad_path'); }
    const file = readFile(db, f.id, path);
    if (!file) throw new HttpError(404, 'not_found');
    // Never served as a page: the app shows this as text, or as sanitised markdown.
    if (typeof file.content !== 'string') return json(res, 200, { path: file.path, size: file.size, text: `(a binary file, ${file.size} bytes)`, html: null });
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
    // Once the building manager has answered, that answer stands.
    const r = run(db, "UPDATE purchases SET status=? WHERE id=? AND floor_id=? AND status IN ('pending','declined','bought-myself')", b.status, Number(p.id), f.id);
    if (!r.changes) throw new HttpError(404, 'not_found');
    engine.emit(f.id, 'reload', {}, { persist: false });
    json(res, 200, { ok: true });
  });

  // Caddy's on-demand TLS asks here before it requests a certificate, so only live project origins can ever get one.
  // Everything from the public internet arrives through a proxy that adds X-Forwarded-For. Caddy's direct call doesn't, so this can't be used to probe for private project names.
  function tlsCheck(req, res, url) {
    if (req.headers['x-forwarded-for'] !== undefined) return send(res, 404, 'Not found', { 'content-type': 'text/plain; charset=utf-8' });
    const asked = url.searchParams.get('domain');
    const label = appHostLabel(cfg, asked);
    const bought = label === null ? engine.domains.lookup(asked) : null;
    const entry = bought ? { floor_id: bought.floor_id, project: bought.project } : label ? lookupLabel(db, label) : null;
    const live = entry && get(db, "SELECT 1 x FROM projects p JOIN floors f ON f.id=p.floor_id WHERE p.floor_id=? AND p.slug=? AND p.published_at IS NOT NULL AND f.status='active'", entry.floor_id, entry.project);
    if (!live) return send(res, 404, 'Not found', { 'content-type': 'text/plain; charset=utf-8' });
    return json(res, 200, { ok: true });
  }

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
    const floors = all(db, 'SELECT * FROM floors ORDER BY number').map((f) => {
      const row = {
        id: f.id, number: f.number, slug: f.slug, name: f.name, status: f.status, paused: !!f.paused, createdAt: f.created_at,
        spendToday: engine.spentToday(f.id), spendTotal: get(db, 'SELECT COALESCE(SUM(cost_usd),0) n FROM ledger WHERE floor_id=?', f.id).n,
        running: get(db, "SELECT COUNT(*) n FROM tasks WHERE floor_id=? AND status='doing'", f.id).n, bytes: floorBytes(db, f.id),
        projects: get(db, 'SELECT COUNT(*) n FROM projects WHERE floor_id=? AND published_at IS NOT NULL', f.id).n,
      };
      applyHooks(hooks.adminFloor, f, row);
      return row;
    });
    const domainsSpent = get(db, "SELECT COALESCE(SUM(cost_usd),0) n FROM ledger WHERE kind='domain'").n;
    const domainOrders = engine.domains.adminList().slice(0, 40);
    const purchases = all(db, "SELECT p.id,p.item,p.price,p.why,p.link,p.status,f.name floor FROM purchases p JOIN floors f ON f.id=p.floor_id WHERE p.status='pending' ORDER BY p.id DESC LIMIT 100");
    const codes = get(db, 'SELECT COUNT(*) n FROM codes WHERE claimed_at IS NULL').n;
    json(res, 200, { budget: budgetReport(db, cfg, { fenced: false, now }), floors, purchases, domainsSpent, domainOrders, domainsOn: engine.domains.enabled, unclaimedCodes: codes, globalPause: engine.globalPaused(), spendToday: engine.spentGlobal(), globalCap: cfg.globalDailyUsd, floorCap: cfg.floorDailyUsd, aiMode: cfg.aiMode, liveLLM: engine.limiter.active, queuedLLM: engine.limiter.queue.length });
  });
  // The building's limits and what has gone towards them, for the building manager alone. Floor names are fenced, because the reader may be the owner's assistant.
  GET('/api/admin/budget', async ({ req, res }) => {
    requireAdmin(req);
    json(res, 200, budgetReport(db, cfg, { now }));
  });
  POST('/api/admin/domains/:id/resolve', async ({ req, res, p, ip }) => {
    requireAdmin(req); limit('mutate', ip);
    const b = await readJson(req, 512);
    let o; try { o = engine.domains.resolve(Number(p.id), b.outcome, b.chargedUsd); } catch (e) { domainError(e); }
    json(res, 200, { ok: true, domain: engine.domains.view(o) });
  });
  GET('/api/admin/domains', async ({ req, res }) => {
    requireAdmin(req);
    const orders = engine.domains.adminList();
    json(res, 200, { enabled: engine.domains.enabled, maxUsd: cfg.domainMaxUsd, perFloorDay: cfg.domainsPerFloorDay, spentUsd: get(db, "SELECT COALESCE(SUM(cost_usd),0) n FROM ledger WHERE kind='domain'").n, orders });
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

  // ---- extensions (floors-plus) ----
  // Each module owns its own tables, routes and timers. Routes are matched in order, so these can add paths but never shadow the ones above.
  const ext = { db, cfg, engine, bus, log, now, hooks, GET, POST, route, json, send, readJson, limit, requireOwner, requireAdmin, floorBySlug, viewerFor, snapshot, projectView, floorCard, HttpError, clean, clean2, BASE, PRIVATE_TEXT, viewEvent, publicUrl, models, validLook, saveSettings, workspacePreviewUrl };
  const extensions = [installOrders(ext), installFiller(ext), installBuilding(ext), installHelp(ext), installPurchases(ext), installCustomise(ext), installModes(ext), installLife(ext), installBusiness(ext)].filter(Boolean);
  // Email: every company's own address. See docs/MAIL.md.
  const mail = installMail(ext);
  extensions.push(mail);
  // Their timers run with the engine's: started by whoever starts the engine, stopped on close.
  const engineStart = engine.start.bind(engine);
  engine.start = () => { engineStart(); for (const x of extensions) x.start?.(); };
  // Office Cloud: the backend each published project gets on its own origin. See docs/OFFICE-CLOUD.md.
  const cloud = installCloud({ ...ext, ipOf, secret });
  extensions.push(cloud);

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
  // The bytes of one published path. Shared by sandbox mode and app-origin mode; only the headers around it differ.
  function publishedFile(f, pr, segs, trailingSlash) {
    let path = segs.filter((s, i) => !(s === '' && i === segs.length - 1)).join('/');
    if (path === '' || trailingSlash) path = path ? `${path}/index.html` : 'index.html';
    let safe;
    try { safe = cleanPath(path, { binary: true }); } catch { return null; }
    const row = get(db, 'SELECT content FROM published_files WHERE floor_id=? AND project=? AND path=?', f.id, pr.slug, safe);
    if (row) return { type: mimeOf(safe), body: row.content };
    if (safe !== 'index.html' && !safe.endsWith('/index.html')) return null;
    const md = get(db, 'SELECT content FROM published_files WHERE floor_id=? AND project=? AND path=?', f.id, pr.slug, safe.replace(/index\.html$/, 'index.md'));
    if (!md) return null;
    const key = `${f.id}|${pr.slug}|${pr.published_at}|${safe}|${f.name}|${f.number}|${f.colors}|${pr.title}|${pr.sources}`;
    let body = docCache.get(key);
    if (body === undefined) {
      body = renderDoc(f, pr, md.content);
      if (docCache.size >= 40) docCache.delete(docCache.keys().next().value);
      docCache.set(key, body);
    }
    return { type: 'text/html; charset=utf-8', body };
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
    if (rest[0]?.startsWith('~w')) return serveWorking(req, res, f, pslug, rest, SITE, miss);
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
      const target = previewUrl(f, pr.slug);
      res.writeHead(302, { ...SITE, location: target + rest.map(encodeURIComponent).join('/') });
      return res.end();
    }
    // With app origins configured, this friendly link just points at the project's own address. Everything above has already decided whether the viewer may have it.
    if (cfg.appsBaseDomain) {
      const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      const target = `${appOrigin(cfg, appLabel(db, f, pr.slug))}/${signed ? `${rest[0]}/` : tail.map(encodeURIComponent).join('/')}${signed ? '' : q}`;
      res.writeHead(302, { ...SITE, location: target });
      return res.end();
    }
    if (rawSegs.length === 2 && !req.url.split('?')[0].endsWith('/')) {
      res.writeHead(301, { ...SITE, location: `${BASE}/f/${f.slug}/${pr.slug}/` });
      return res.end();
    }
    if (tail[0] === '_office' && tail[1] === 'pay' && tail.length === 2) return servePay(res, pr, SITE);
    const lib = sharedAsset(tail);
    if (lib) { res.writeHead(200, { ...SITE, 'content-type': lib.type, 'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin' }); return res.end(req.method === 'HEAD' ? undefined : lib.body); }
    const hit = publishedFile(f, pr, tail, req.url.split('?')[0].endsWith('/'));
    if (!hit) return miss();
    if (/^text\/html/.test(hit.type) && req.method === 'GET' && !pr.private) visit(req, f, pr, tail.join('/'));
    // A sandboxed page has the origin "null", so its own module scripts, fonts and data files load through CORS. Only public files and signed links reach this point, and no credentials are honoured.
    const cors = /^text\/html/.test(hit.type) ? {} : { 'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin' };
    res.writeHead(200, { ...SITE, ...cors, 'content-type': hit.type });
    res.end(req.method === 'HEAD' ? undefined : hit.body);
  }
  // Work in progress, for the boss's live preview: the drive's copy of a project, under the same sandbox as any published page, never counted as a visit.
  function serveWorking(req, res, f, slug, rest, SITE, miss) {
    const m = rest[0].match(/^~w(\d{1,12})\.([A-Za-z0-9_-]{20,64})$/);
    if (!m) return miss();
    const exp = Number(m[1]);
    if (exp * 1000 < now() || !A.safeEqual(m[2], A.signPreview(secret, f.id, `w:${slug}`, exp))) return miss();
    const tail = rest.slice(1);
    const lib = sharedAsset(tail);
    if (lib) { res.writeHead(200, { ...SITE, 'content-type': lib.type, 'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin' }); return res.end(req.method === 'HEAD' ? undefined : lib.body); }
    let path = tail.filter((s, i) => !(s === '' && i === tail.length - 1)).join('/');
    if (path === '' || req.url.split('?')[0].endsWith('/')) path = path ? `${path}/index.html` : 'index.html';
    let safe; try { safe = cleanPath(`projects/${slug}/${path}`, { binary: true }); } catch { return miss(); }
    const file = readFile(db, f.id, safe);
    if (!file) return miss();
    const type = mimeOf(safe);
    const cors = /^text\/html/.test(type) ? {} : { 'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin' };
    res.writeHead(200, { ...SITE, ...cors, 'content-type': type });
    res.end(req.method === 'HEAD' ? undefined : file.content);
  }
  // The boss's Stripe link lives on the server, so a hijacked bot can't swap the money for its own: pages can only link here.
  function servePay(res, pr, head) {
    if (!pr.payment_link) { res.writeHead(404, { ...head, 'content-type': 'text/plain; charset=utf-8' }); return res.end('Payments are not set up yet.'); }
    res.writeHead(302, { ...head, location: pr.payment_link, 'cache-control': 'no-store' });
    return res.end();
  }
  const visit = (req, f, pr, path) => { try { recordVisit(db, { floorId: f.id, project: pr.slug, path: `/${path}`, referer: req.headers.referer, ownHost: req.headers.host, ua: req.headers['user-agent'], ip: ipOf(req), secret, now: now() }); } catch (e) { log('warn', 'visit', { err: scrub(e?.message, cfg) }); } };
  // Paths the server answers itself on every project: the client library and the vendored Three.js. They win over any published file of that name.
  function sharedAsset(segs) {
    // At any depth, so a page in a folder can use a relative path too.
    const [dir, name] = segs.slice(-2);
    if (dir !== '_office' || segs.length < 2) return null;
    if (name === 'client.js') return { type: 'text/javascript; charset=utf-8', body: clientLib };
    if (name === 'office.js') return { type: 'text/javascript; charset=utf-8', body: SDK_JS };
    if (name === 'three.module.min.js') return { type: 'text/javascript; charset=utf-8', body: threeLib?.body };
    return null;
  }

  // ---- a project on its own origin ----
  // Nothing here reads The Office's cookies or knows who is logged in. The one credential is a pass for a private project, scoped to this exact origin.
  function serveApp(req, res, label, rawUrl) {
    const HEAD = { ...appHeaders(cfg), 'cache-control': 'no-cache' };
    const ownHost = String(req.headers.host || '').toLowerCase().split(':')[0];
    // Office Cloud rooms connect back to this same host. 'self' covers that in current browsers; older Safari needs it spelled out.
    const hostHeader = String(req.headers.host || '').toLowerCase();
    if (/^[a-z0-9.-]{1,253}(:\d{1,5})?$/.test(hostHeader)) HEAD['content-security-policy'] = HEAD['content-security-policy'].replace("connect-src 'self'", `connect-src 'self' ${cfg.appsScheme === 'https' ? 'wss' : 'ws'}://${hostHeader}`);
    const miss = () => { res.writeHead(404, { ...HEAD, 'content-type': 'text/plain; charset=utf-8' }); res.end('Not found'); };
    delete req.headers.authorization;
    const pass = A.parseCookies(req.headers.cookie)[previewCookieName(cfg)];
    delete req.headers.cookie;
    const entry = label ? lookupLabel(db, label) : null;
    if (!entry) return miss();
    const f = get(db, 'SELECT * FROM floors WHERE id=?', entry.floor_id);
    if (!f || f.status !== 'active') return miss();
    const pr = get(db, 'SELECT * FROM projects WHERE floor_id=? AND slug=? AND published_at IS NOT NULL', f.id, entry.project);
    if (!pr) return miss();
    const raw = rawUrl.split('?')[0];
    const rawSegs = raw.split('/').slice(1);
    let segs;
    try { segs = rawSegs.map((s) => decodeURIComponent(s)); } catch { return miss(); }
    const validPass = (v) => {
      const m = String(v || '').match(/^(\d{1,12})\.([A-Za-z0-9_-]{20,64})$/);
      return !!m && Number(m[1]) * 1000 >= now() && A.safeEqual(m[2], A.signPreview(secret, f.id, pr.slug, Number(m[1])));
    };
    if (segs[0]?.startsWith('~p')) {
      const v = segs[0].slice(2);
      if (!validPass(v)) return miss();
      // Trade the signed path for a cookie that only this origin holds, so absolute asset paths and service workers still work.
      res.writeHead(302, { ...HEAD, 'set-cookie': previewCookie(cfg, v, Math.max(1, Number(v.split('.')[0]) - Math.floor(now() / 1000))), location: '/' });
      return res.end();
    }
    if (pr.private && !validPass(pass)) return miss();
    // Search engines are only invited to a public project on its own domain, or one the boss switched on.
    const liveDomain = engine.domains.liveFor(f.id, pr.slug);
    const onOwnDomain = liveDomain && ownHost === liveDomain;
    const welcome = !pr.private && (onOwnDomain || !!pr.indexable);
    if (welcome) delete HEAD['x-robots-tag'];
    if (segs[0] === '_data') return serveData(req, res, f, pr, label, rawUrl, HEAD);
    if (segs[0] === '_office' && segs[1] === 'cloud') return cloud.serve(req, res, { f, pr, label, segs: segs.slice(2), rawUrl, HEAD });
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { ...HEAD, allow: 'GET, HEAD' }); return res.end(); }
    limit('publicSite', ipOf(req));
    if (segs[0] === '_office' && segs[1] === 'pay' && segs.length === 2) return servePay(res, pr, HEAD);
    const lib = sharedAsset(segs);
    if (lib) { res.writeHead(200, { ...HEAD, 'content-type': lib.type }); return res.end(req.method === 'HEAD' ? undefined : lib.body); }
    let hit = publishedFile(f, pr, segs, raw.endsWith('/')), base = raw;
    // A path with no extension is a client-side route: hand it to the app's own page.
    if (!hit && !segs.at(-1).includes('.')) { hit = publishedFile(f, pr, [''], true); base = '/'; }
    // A site that wrote its own wins. These are only here so that a launch doesn't need them hand-made.
    if (!publishedFile(f, pr, segs, false) && raw === '/robots.txt') { res.writeHead(200, { ...HEAD, 'content-type': 'text/plain; charset=utf-8' }); return res.end(req.method === 'HEAD' ? undefined : welcome ? `User-agent: *\nAllow: /\nSitemap: ${cfg.appsScheme}://${ownHost}/sitemap.xml\n` : 'User-agent: *\nDisallow: /\n'); }
    if (!publishedFile(f, pr, segs, false) && raw === '/sitemap.xml' && welcome) {
      const pages = all(db, 'SELECT path FROM published_files WHERE floor_id=? AND project=? ORDER BY path LIMIT 500', f.id, pr.slug).map((x) => x.path).filter((x) => /\.html?$/i.test(x)).map((x) => x.replace(/(^|\/)index\.html?$/i, '$1'));
      res.writeHead(200, { ...HEAD, 'content-type': 'application/xml; charset=utf-8' });
      return res.end(req.method === 'HEAD' ? undefined : `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map((x) => `<url><loc>${cfg.appsScheme}://${ownHost}/${esc(x)}</loc></url>`).join('\n')}\n</urlset>\n`);
    }
    if (!hit) return miss();
    if (/^text\/html/.test(hit.type) && req.method === 'GET' && !pr.private) visit(req, f, pr, segs.join('/'));
    const etag = `W/"${pr.published_at}"`;
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ...HEAD, etag }); return res.end(); }
    res.writeHead(200, { ...HEAD, etag, 'content-type': hit.type });
    res.end(req.method === 'HEAD' ? undefined : /^text\/html/.test(hit.type) ? absoluteMeta(hit.body, `${cfg.appsScheme}://${ownHost}${base}`) : hit.body);
  }
  async function serveData(req, res, f, pr, label, rawUrl, HEAD) {
    const reply = (status, obj) => { res.writeHead(status, { ...HEAD, 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8', ...(status === 429 ? { 'retry-after': '30' } : {}) }); res.end(JSON.stringify(obj)); };
    try {
      const ip = ipOf(req);
      const read = req.method === 'GET' || req.method === 'HEAD';
      // Only the project's own pages may use this. There is deliberately no CORS, and a browser can't forge Origin or Sec-Fetch-Site.
      const own = `${cfg.appsScheme}://${String(req.headers.host).toLowerCase().replace(/\.$/, '')}`;
      const origin = req.headers.origin; const site = req.headers['sec-fetch-site'];
      if (origin !== undefined && origin !== own) return reply(403, { error: 'bad_origin', message: 'Only this project\'s own pages can use its data.' });
      if (site && site !== 'same-origin' && site !== 'none') return reply(403, { error: 'bad_origin', message: 'Only this project\'s own pages can use its data.' });
      if (!read && origin === undefined) return reply(403, { error: 'bad_origin', message: 'Only this project\'s own pages can use its data.' });
      limit(read ? 'dataRead' : 'dataWrite', `${label}:${ip}`);
      // Per project, and per visitor across every project, so one address can't work through the whole building.
      if (!read) { limit('dataProject', label); limit('dataIp', ip); }
      const url = new URL(rawUrl, 'http://x');
      const m = url.pathname.match(/^\/_data\/v1\/(.*)$/);
      if (!m) return reply(404, { error: 'not_found' });
      // Decoded one segment at a time, so %2f can never add a level.
      let segments;
      try { segments = m[1].split('/').filter(Boolean).map((s) => decodeURIComponent(s)); } catch { return reply(400, { error: 'bad_path' }); }
      // Counted once the path is really parsed, so no spelling of it slips past.
      if (segments[0] === 'form') limit('form', `${label}:${ip}`);
      let sent = null;
      const [status, out] = await handleData({ db, req, floorId: f.id, project: pr.slug, segments, query: url.searchParams, body: () => readJson(req, DATA_LIMITS.bodyBytes).then((b) => (sent = b)), now });
      reply(status, out);
      // A contact form on the company's own site also lands in its inbox.
      if (segments[0] === 'form' && status === 200 && sent?.fields) { try { mail.formToInbox(f, pr.slug, segments[1], sent.fields); } catch (e) { log('error', 'mail_form', { err: scrub(e?.message, cfg) }); } }
    } catch (e) {
      if (e instanceof DataError || e instanceof HttpError) return reply(e.status, { error: e.code, message: e.message });
      log('error', 'data', { err: scrub(e?.message, cfg) });
      reply(500, { error: 'server_error' });
    }
  }

  // ---- static app ----
  const INDEX = '/index.html';
  function serveStatic(req, res, path, stamp) {
    const file = statics.get(path);
    if (!file) return send(res, 404, 'Not found', { 'content-type': 'text/plain; charset=utf-8' });
    // A URL stamped with this very file's version never changes meaning, so it can stay in a cache for good. The page shell always revalidates, cheaply.
    const pinned = stamp && stamp === file.version;
    const etag = `W/"${file.version}"`;
    const headers = { 'content-type': file.type, etag, 'cache-control': path === INDEX ? 'no-cache' : pinned ? 'public, max-age=31536000, immutable' : stamp ? 'no-cache' : 'public, max-age=3600' };
    if (file.gz) headers.vary = 'accept-encoding';
    if (req.headers['if-none-match'] === etag) return send(res, 304, undefined, headers);
    const { encoding, body } = pickEncoding(file, req.headers['accept-encoding']);
    if (encoding) headers['content-encoding'] = encoding;
    send(res, 200, req.method === 'HEAD' ? undefined : body, headers);
  }

  function refuseSiblings(req) {
    if (req.headers['sec-fetch-site'] === 'same-site') throw new HttpError(403, 'bad_origin', 'Cross-site request refused.');
    if (!cfg.appsBaseDomain) return;
    for (const h of [req.headers.origin, req.headers.referer]) {
      if (!h) continue;
      let host = ''; try { host = new URL(h).host; } catch { continue; }
      if (appHostLabel(cfg, host) !== null) throw new HttpError(403, 'bad_origin', 'Cross-site request refused.');
    }
  }

  // ---- dispatcher ----
  async function handle(req, res) {
    const started = Date.now();
    // Anything addressed to the apps domain is a project origin and nothing else. It can never reach the main app, the API or the admin.
    let appLabelHere = appHostLabel(cfg, req.headers.host);
    // A domain the floor bought gets exactly the same treatment as its app origin. Nothing on it can reach the main app, the API or the admin either.
    if (appLabelHere === null && cfg.appsBaseDomain) {
      const bought = engine.domains.lookup(req.headers.host);
      if (bought) {
        const floor = get(db, "SELECT * FROM floors WHERE id=? AND status='active'", bought.floor_id);
        if (!floor) { res.writeHead(404, { ...appHeaders(cfg), 'content-type': 'text/plain; charset=utf-8' }); return res.end('Not found'); }
        if (bought.www) { res.writeHead(301, { ...appHeaders(cfg), location: `${cfg.appsScheme}://${bought.domain}${/^\/[^/\\]/.test(req.url) || req.url === '/' ? req.url : '/'}` }); return res.end(); }
        appLabelHere = appLabel(db, floor, bought.project);
      }
    }
    if (appLabelHere !== null) {
      try { return await serveApp(req, res, appLabelHere, req.url); } catch (e) {
        if (res.headersSent) return undefined;
        const status = e instanceof HttpError ? e.status : 500;
        if (status === 500) log('error', 'app origin', { err: scrub(e?.message, cfg) });
        res.writeHead(status, { ...appHeaders(cfg), 'content-type': 'text/plain; charset=utf-8', ...(status === 429 ? { 'retry-after': '30' } : {}) });
        return res.end(status === 429 ? 'Too many requests.' : 'Not found');
      }
    }
    const ip = ipOf(req);
    let url;
    try { url = new URL(req.url, 'http://x'); } catch { return send(res, 400, 'Bad request'); }
    const pathname = url.pathname;
    try {
      if (pathname === `${BASE}/api/apps/tls-check` && req.method === 'GET') return tlsCheck(req, res, url);
      if (pathname === BASE) { limit('read', ip); return serveStatic(req, res, INDEX); }
      if (!pathname.startsWith(`${BASE}/`)) return send(res, 404, 'Not found', { 'content-type': 'text/plain; charset=utf-8' });
      const rest = pathname.slice(BASE.length);
      if (rest === '/robots.txt') return send(res, 200, 'User-agent: *\nDisallow: /\n', { 'content-type': 'text/plain; charset=utf-8' });
      if (rest === '/sdk/office.js' && (req.method === 'GET' || req.method === 'HEAD')) { limit('read', ip); return send(res, 200, req.method === 'HEAD' ? undefined : SDK_JS, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache' }); }
      if (rest.startsWith('/f/')) {
        limit('publicSite', ip);
        if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { ...BASE_HEADERS, 'content-security-policy': SANDBOX_CSP, allow: 'GET, HEAD' }); return res.end(); }
        return serveSite(req, res, rawSegments(req.url));
      }
      // Resend's signed webhook carries no Origin, so it is answered before the same-site checks every other call gets. See server/mail.js.
      if (rest === '/api/mail/inbound' && req.method === 'POST') return mail.webhook(req, res, ip);
      if (rest.startsWith('/api/')) {
        const method = req.method;
        // A sibling subdomain counts as "same site", so SameSite=Lax alone would let a published page send the owner's cookie here.
        refuseSiblings(req);
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
      return serveStatic(req, res, rest, url.searchParams.get('v'));
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

  // Node's requestTimeout is one number for the whole server, so it is set to the upload's and every other request is
  // held to the shorter limit here, the way Node does it: a 408 if nothing has been written yet, then the line is cut.
  const UPLOAD_URL = new RegExp(`^${BASE}/api/floors/[^/]+/attachments$`);
  const isUpload = (req) => req.method === 'POST' && (UPLOAD_URL.test(req.url.split('?')[0]) || req.url.split('?')[0] === `${API_PREFIX}files`);
  const holdTo = (req, ms) => {
    const timer = setTimeout(() => {
      if (req.complete) return;
      const s = req.socket;
      if (s.writable && s.bytesWritten === 0) s.write('HTTP/1.1 408 Request Timeout\r\nConnection: close\r\n\r\n');
      s.destroy();
    }, ms);
    timer.unref();
    req.once('end', () => clearTimeout(timer));
  };
  const server = http.createServer((req, res) => {
    if (!isUpload(req)) holdTo(req, cfg.requestTimeoutMs);
    handle(req, res).catch(() => { try { res.destroy(); } catch { /* gone */ } });
  });
  // Multiplayer rooms: WebSockets on a project's own origin. Everything else that asks to upgrade is refused there.
  server.on('upgrade', (req, socket, head) => cloud.upgrade(req, socket, head));
  server.requestTimeout = Math.max(cfg.requestTimeoutMs, cfg.uploadTimeoutMs); server.headersTimeout = 15000; server.keepAliveTimeout = 5000; server.maxConnections = 1200;
  return {
    server, engine, bus, rates, cloud,
    /** Brotli every asset ahead of the first visitor. Called by the real entry point only, so tests don't pay for it. */
    warmStatics: () => warmBrotli(statics),
    async close() {
      rates.close();
      for (const x of extensions) { try { await x.stop?.(); } catch (e) { log('error', 'extension stop', { err: scrub(e?.message, cfg) }); } }
      await engine.stop();
      bus.closeAll();
      await new Promise((r) => { server.close(() => r()); server.closeAllConnections?.(); });
    },
  };
}
