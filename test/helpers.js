import { openDb } from '../server/db.js';
import { loadConfig, loadModels } from '../server/config.js';
import { createApp } from '../server/app.js';
import { issueCode } from '../server/auth.js';
import { request as httpRequest } from 'node:http';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function until(fn, { timeout = 15000, every = 15, what = 'condition' } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(every);
  }
}

export async function boot(overrides = {}, deps = {}) {
  const logs = [];
  const db = openDb(':memory:');
  // A tall building for most tests, so a test can claim as many floors as it likes without having to say so. The real default is proved in tower10.test.js.
  const cfg = loadConfig({ AI_MODE: 'mock', ADMIN_PASSWORD: 'correct horse battery', MOCK_DELAY_MS: '2', RETRY_BASE_MS: '1' }, { rateScale: 1000, towerFloors: 40, ...overrides });
  const log = (level, msg, extra) => logs.push(JSON.stringify({ level, msg, ...extra }));
  const app = createApp({ db, cfg, models: loadModels(), log, ...deps });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const port = app.server.address().port;
  app.engine.start();
  const host = `127.0.0.1:${port}`;
  const base = `http://${host}/theoffice`;
  return { db, cfg, app, base, host, port, logs, close: async () => { await app.close(); db.close(); }, code: (f) => issueCode(db, f ?? null) };
}

export class Client {
  constructor(t, { origin } = {}) { this.t = t; this.cookies = {}; this.origin = origin === undefined ? `http://${t.host}` : origin; this.csrf = null; }
  cookieHeader() { return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; '); }
  async raw(method, path, { body, headers = {}, redirect = 'manual', rawBody } = {}) {
    const h = { ...headers };
    if (this.cookieHeader()) h.cookie = this.cookieHeader();
    if (method !== 'GET' && method !== 'HEAD') {
      if (this.origin && !('origin' in h)) h.origin = this.origin;
      if (body !== undefined && !('content-type' in h)) h['content-type'] = 'application/json';
      if (this.csrf && !('x-office-csrf' in h)) h['x-office-csrf'] = this.csrf;
    }
    const res = await fetch(`${this.t.base}${path}`, { method, headers: h, redirect, body: rawBody ?? (body !== undefined ? JSON.stringify(body) : undefined) });
    for (const sc of res.headers.getSetCookie()) { const [kv] = sc.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i); const v = kv.slice(i + 1); if (v) this.cookies[k] = v; else delete this.cookies[k]; }
    return res;
  }
  async json(method, path, opts) {
    const r = await this.raw(method, path, opts);
    let data = null; const text = await r.text();
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data, headers: r.headers };
  }
  post(path, body, opts = {}) { return this.json('POST', path, { body, ...opts }); }
  get(path, opts) { return this.json('GET', path, opts); }
}

export async function claim(t, name = 'Acme Tiny', extra = {}) {
  const c = new Client(t);
  const code = t.code(extra.floor);
  const r = await c.post('/api/claim', { code, name, tagline: 'We make things', bossName: 'Boss', colors: { primary: '#aa3300', accent: '#ffcc00' }, look: { hair: 'bun' }, ...extra.body });
  if (r.status !== 201) throw new Error(`claim failed ${r.status} ${JSON.stringify(r.data)}`);
  c.csrf = r.data.csrf; c.slug = r.data.slug; c.number = r.data.number; c.recovery = r.data.recoveryCode; c.code = code;
  return c;
}
export async function adminClient(t) {
  const c = new Client(t);
  const r = await c.post('/api/admin/login', { password: 'correct horse battery' });
  if (r.status !== 200) throw new Error('admin login failed');
  c.csrf = r.data.csrf;
  return c;
}
// What a floor has spent today, as only the admin can see it. Nothing a boss or a visitor gets carries this any more.
export const spentToday = (t, c) => t.app.engine.spentToday(t.db.prepare('SELECT id FROM floors WHERE slug=?').get(c.slug).id);
export const floorState = async (c, slug) => (await c.get(`/api/floors/${slug ?? c.slug}`)).data;
export const allDone = (s) => s.tasks.length > 0 && s.tasks.every((t) => ['done', 'failed', 'cancelled'].includes(t.status)) && s.agents.every((a) => a.state === 'idle');
export const waitDone = (c, what = 'floor to finish') => until(async () => { const s = await floorState(c); return allDone(s) ? s : null; }, { what });

/** Open an SSE stream and collect events. */
export function sse(c, slug, { since } = {}) {
  const ctl = new AbortController(); const events = [];
  const headers = {}; if (c.cookieHeader()) headers.cookie = c.cookieHeader();
  if (since) headers['last-event-id'] = String(since);
  const done = fetch(`${c.t.base}/api/floors/${slug}/stream`, { headers, signal: ctl.signal }).then(async (res) => {
    let buf = '';
    for await (const chunk of res.body) {
      buf += Buffer.from(chunk).toString('utf8');
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = {}; for (const l of block.split('\n')) { if (l.startsWith('event: ')) ev.type = l.slice(7); if (l.startsWith('data: ')) ev.data = JSON.parse(l.slice(6)); if (l.startsWith('id: ')) ev.id = Number(l.slice(4)); }
        if (ev.type) events.push(ev);
      }
    }
  }).catch(() => {});
  return { events, close: () => { ctl.abort(); return done; } };
}

/** fetch() refuses to set Host, so requests to a project origin or a bought domain go through this. */
export function hostFetch(port, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method, headers: { ...(body ? { 'content-length': Buffer.byteLength(body) } : {}), ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: { get: (k) => { const v = res.headers[k.toLowerCase()]; return v === undefined ? null : Array.isArray(v) ? v.join(', ') : v; } }, text: async () => buf.toString(), arrayBuffer: async () => buf });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}
