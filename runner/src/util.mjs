import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// One line per event to stdout (journald). Only ever pass labels, ids, states and counts here: never
// env values, tokens, file contents or request headers.
let sink = (line) => process.stdout.write(line);
export function setLogSink(fn) {
  sink = fn;
}
export function log(event, fields = {}) {
  const parts = [event];
  for (const [k, v] of Object.entries(fields)) parts.push(`${k}=${String(v).replace(/\s+/g, '_').slice(0, 200)}`);
  sink(parts.join(' ') + '\n');
}

export function sendJson(res, status, body, headers = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(data), ...headers });
  res.end(data);
}

export function sendText(res, status, text, headers = {}) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-length': Buffer.byteLength(text), ...headers });
  res.end(text);
}

export function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > maxBytes) return reject(new HttpError(413, 'too_large', `Body over ${maxBytes} bytes.`));
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) {
        reject(new HttpError(413, 'too_large', `Body over ${maxBytes} bytes.`));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readJson(req, maxBytes) {
  const buf = await readBody(req, maxBytes);
  if (buf.length === 0) return {};
  try {
    const v = JSON.parse(buf.toString('utf8'));
    if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
    return v;
  } catch {
    throw new HttpError(400, 'bad_json', 'Body must be a JSON object.');
  }
}

// Compares hashes so neither the length nor the content of the token leaks through timing.
export function tokenMatches(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string' || expected.length < 32) return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export function bearer(req) {
  const h = req.headers.authorization ?? '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

export function readSecretFile(file) {
  return fs.readFileSync(file, 'utf8').trim();
}

// Writes a file so readers only ever see the old or the new version, never half of one.
export function writeFileAtomic(file, data, mode = 0o600) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  const fd = fs.openSync(tmp, 'w', mode);
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.chmodSync(tmp, mode);
  fs.renameSync(tmp, file);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Serialises async work per key (one lifecycle change per app at a time).
export function keyedLock() {
  const tails = new Map();
  return async function withLock(key, fn) {
    const prev = tails.get(key) ?? Promise.resolve();
    let release;
    const mine = new Promise((r) => (release = r));
    const tail = prev.then(() => mine);
    tails.set(key, tail);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (tails.get(key) === tail) tails.delete(key);
    }
  };
}

// Keeps the end of a text, cut at a line start, at most max bytes.
export function tail(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(text.length - max);
  const nl = cut.indexOf('\n');
  return nl >= 0 && nl < 200 ? cut.slice(nl + 1) : cut;
}
