// Codes, sessions, recovery, CSRF and rate limits. Only hashes are stored; plaintext codes and tokens are returned once and never logged.
import { randomBytes, createHash, createHmac, scryptSync, timingSafeEqual } from 'node:crypto';
import { get, run } from './db.js';

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function randomGroups(groups, len) {
  const out = [];
  for (let g = 0; g < groups; g++) {
    let s = ''; const bytes = randomBytes(len * 2);
    for (let i = 0; s.length < len && i < bytes.length; i++) if (bytes[i] < 248) s += ALPHABET[bytes[i] % ALPHABET.length];
    out.push(s.padEnd(len, 'X'));
  }
  return out.join('-');
}
/** A code pasted out of a chat message can bring the rest of the message with it, so the OFFICE-XXXX-XXXX-XXXX-XXXX part is found wherever it is. */
const OFFICE_CODE = /OFFICE[\s_-]*([A-Z0-9]{4})[\s_-]*([A-Z0-9]{4})[\s_-]*([A-Z0-9]{4})[\s_-]*([A-Z0-9]{4})/;
export function normalizeCode(c) {
  const up = String(c ?? '').trim().toUpperCase(), m = up.match(OFFICE_CODE);
  if (m) return `OFFICE-${m[1]}-${m[2]}-${m[3]}-${m[4]}`;
  return up.replace(/[\s_]+/g, '-').slice(0, 64);
}

export function issueCode(db, floorNumber = null, now = Date.now()) {
  const code = `OFFICE-${randomGroups(4, 4)}`;
  run(db, 'INSERT INTO codes (hash,floor_number,created_at) VALUES (?,?,?)', sha256(code), floorNumber, now);
  return code;
}
export const newRecoveryCode = () => `RECOVER-${randomGroups(5, 5)}`;

export function hashSecret(secret) {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(String(secret), salt, 32, { N: 16384, r: 8, p: 1 }).toString('hex')}`;
}
export function verifySecret(secret, stored) {
  const [s, h] = String(stored).split(':');
  if (!s || !h) return false;
  const got = scryptSync(String(secret), Buffer.from(s, 'hex'), 32, { N: 16384, r: 8, p: 1 });
  const want = Buffer.from(h, 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
}
export function safeEqual(a, b) {
  const x = createHash('sha256').update(String(a)).digest(); const y = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(x, y);
}

export const COOKIE = 'office_s', ADMIN_COOKIE = 'office_a';
const YEAR = 365 * 86400;
export function cookieHeader(name, value, maxAge) {
  return `${name}=${value}; Path=/theoffice; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('='); if (i < 0) continue;
    const k = part.slice(0, i).trim(); if (k && !(k in out)) out[k] = part.slice(i + 1).trim();
  }
  return out;
}

export const cookieCount = (header, name) => String(header || '').split(';').filter((p) => p.split('=')[0].trim() === name).length;

export function createSession(db, kind, floorId, maxAgeSec, now = Date.now()) {
  const token = randomBytes(32).toString('base64url');
  const csrf = randomBytes(24).toString('base64url');
  run(db, 'INSERT INTO sessions (hash,kind,floor_id,csrf,created_at,expires_at) VALUES (?,?,?,?,?,?)', sha256(token), kind, floorId, csrf, now, now + maxAgeSec * 1000);
  return { token, csrf };
}
export function loadSession(db, token, kind, now = Date.now()) {
  if (!token || token.length > 200) return null;
  const s = get(db, 'SELECT * FROM sessions WHERE hash=? AND kind=?', sha256(token), kind);
  if (!s) return null;
  if (s.expires_at < now) { run(db, 'DELETE FROM sessions WHERE hash=?', s.hash); return null; }
  return s;
}
export const OWNER_MAX_AGE = YEAR, ADMIN_MAX_AGE = 12 * 3600;

// Capability links for private projects. A sandboxed page has an opaque origin, so its sub-resource requests carry no
// Lax cookie: the owner's own private site could not load its CSS. The owner gets a short-lived, project-bound signed path instead.
export function signPreview(secret, floorId, project, expires) {
  return createHmac('sha256', secret).update(`${floorId}:${project}:${expires}`).digest('base64url');
}
export function serverSecret(db) {
  let row = get(db, "SELECT value FROM settings WHERE key='hmac_secret'");
  if (!row) { run(db, "INSERT OR IGNORE INTO settings (key,value) VALUES ('hmac_secret',?)", randomBytes(32).toString('hex')); row = get(db, "SELECT value FROM settings WHERE key='hmac_secret'"); }
  return row.value;
}

/** Fixed-window limiter. The sweep keeps the map bounded under churn. */
export class RateLimiter {
  constructor(scale = 1, now = Date.now) { this.scale = scale; this.now = now; this.hits = new Map(); this.timer = setInterval(() => this.sweep(), 60000); this.timer.unref?.(); }
  allow(key, limit, windowMs) {
    const t = this.now(); const e = this.hits.get(key);
    if (!e || e.reset <= t) { this.hits.set(key, { n: 1, reset: t + windowMs }); return true; }
    e.n++;
    return e.n <= limit * this.scale;
  }
  sweep() { const t = this.now(); for (const [k, e] of this.hits) if (e.reset <= t) this.hits.delete(k); }
  close() { clearInterval(this.timer); }
}
