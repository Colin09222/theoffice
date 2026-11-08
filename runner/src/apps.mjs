// Pure rules about apps: names, uploaded files, the office.json manifest, capacity and secrets.
import crypto from 'node:crypto';
import path from 'node:path';
import { parseCron } from './cron.mjs';
import { HttpError } from './util.mjs';

// Office project labels look like <project>--<floor>, so double hyphens are fine; the whole host
// label api--<label> has to stay within DNS's 63 characters.
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$/;
export const TIERS = ['standard', 'browser'];

export function validLabel(label) {
  return typeof label === 'string' && LABEL_RE.test(label);
}

export function assertLabel(label) {
  if (!validLabel(label)) throw new HttpError(400, 'bad_label', 'App names are 1-58 characters: a-z, 0-9 and hyphens, not at the ends.');
}

// api--<label>.middistance.com (any port, any case) -> label, else null.
export function hostLabel(host, cfg) {
  if (typeof host !== 'string') return null;
  const h = host.toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  if (!h.startsWith(cfg.HOST_PREFIX) || !h.endsWith(cfg.HOST_SUFFIX)) return null;
  const label = h.slice(cfg.HOST_PREFIX.length, h.length - cfg.HOST_SUFFIX.length);
  return validLabel(label) ? label : null;
}

export function appHost(label, cfg) {
  return `${cfg.HOST_PREFIX}${label}${cfg.HOST_SUFFIX}`;
}

const SEGMENT_RE = /^[A-Za-z0-9_@+.-][A-Za-z0-9_@+. -]{0,99}$/;

// Turns the deploy request's files into checked { path, data, mode } entries.
export function checkFiles(files, cfg) {
  if (!Array.isArray(files) || files.length === 0) throw new HttpError(400, 'no_files', 'Send the server folder as files: [{ path, data }].');
  if (files.length > cfg.MAX_FILES) throw new HttpError(413, 'too_many_files', `At most ${cfg.MAX_FILES} files.`);
  const seen = new Set();
  let total = 0;
  const out = [];
  for (const f of files) {
    const p = typeof f?.path === 'string' ? f.path : '';
    const segs = p.split('/');
    if (p.length === 0 || p.length > 200 || segs.some((s) => !SEGMENT_RE.test(s) || s === '.' || s === '..')) {
      throw new HttpError(400, 'bad_path', `Bad file path: ${JSON.stringify(p.slice(0, 80))}`);
    }
    if (seen.has(p)) throw new HttpError(400, 'duplicate_path', `Listed twice: ${p.slice(0, 80)}`);
    seen.add(p);
    const enc = f.encoding ?? 'base64';
    if (enc !== 'base64' && enc !== 'utf8') throw new HttpError(400, 'bad_encoding', 'encoding is base64 or utf8.');
    if (typeof f.data !== 'string') throw new HttpError(400, 'bad_data', `No data for ${p.slice(0, 80)}`);
    const data = Buffer.from(f.data, enc);
    total += data.length;
    if (total > cfg.MAX_UPLOAD_MB * 1024 * 1024) throw new HttpError(413, 'too_large', `The files add up to more than ${cfg.MAX_UPLOAD_MB} MB.`);
    out.push({ path: p, data, mode: f.executable ? 0o755 : 0o644 });
  }
  for (const f of out) {
    for (let d = path.posix.dirname(f.path); d !== '.'; d = path.posix.dirname(d)) {
      if (seen.has(d)) throw new HttpError(400, 'bad_path', `${d} is both a file and a folder.`);
    }
  }
  return out;
}

function jsonFile(files, name) {
  const f = files.find((x) => x.path === name);
  if (!f) return null;
  try {
    const v = JSON.parse(f.data.toString('utf8'));
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  } catch {}
  throw new HttpError(400, 'bad_manifest', `${name} is not a JSON object.`);
}

function command(v, what) {
  if (typeof v !== 'string' || v.trim() === '' || v.length > 500 || /[\r\n\0]/.test(v)) {
    throw new HttpError(400, 'bad_manifest', `${what} must be a one-line command.`);
  }
  return v.trim();
}

// Reads office.json (optional) and package.json to decide tier, start command and scheduled jobs.
export function readManifest(files, requestedTier, cfg) {
  const office = jsonFile(files, 'office.json') ?? {};
  const pkg = jsonFile(files, 'package.json');
  const tier = requestedTier ?? office.tier ?? 'standard';
  if (!TIERS.includes(tier)) throw new HttpError(400, 'bad_tier', 'tier is standard or browser.');
  let start = null;
  if (office.start !== undefined) start = command(office.start, 'office.json start');
  else if (typeof pkg?.scripts?.start === 'string') start = 'npm start';
  else {
    const has = (p) => files.some((f) => f.path === p);
    const main = typeof pkg?.main === 'string' ? path.posix.normalize(pkg.main) : null;
    const pick = [main, 'server.js', 'index.js', 'app.js', 'main.js', 'server.mjs', 'index.mjs'].find((p) => p && !p.startsWith('..') && has(p));
    if (pick) start = `node ${pick}`;
  }
  if (!start) throw new HttpError(400, 'no_start', 'No way to start the app: add "start" to office.json, a start script to package.json, or a server.js.');
  const cron = [];
  const list = office.cron ?? [];
  if (!Array.isArray(list) || list.length > 5) throw new HttpError(400, 'bad_cron', 'cron is a list of at most 5 jobs.');
  for (const j of list) {
    const name = typeof j?.name === 'string' && /^[a-z0-9][a-z0-9-]{0,30}$/.test(j.name) ? j.name : null;
    if (!name) throw new HttpError(400, 'bad_cron', 'Each job needs a name: a-z, 0-9 and hyphens.');
    if (cron.some((c) => c.name === name)) throw new HttpError(400, 'bad_cron', `Two jobs are called ${name}.`);
    try {
      parseCron(j.schedule);
    } catch (e) {
      throw new HttpError(400, 'bad_cron', `Job ${name}: ${e.message}`);
    }
    const timeoutMinutes = Math.min(60, Math.max(1, Number(j.timeoutMinutes ?? cfg.JOB_TIMEOUT_MIN) || cfg.JOB_TIMEOUT_MIN));
    cron.push({ name, schedule: String(j.schedule).trim(), run: command(j.run, `Job ${name} run`), timeoutMinutes });
  }
  return { tier, start, cron, hasPackage: Boolean(pkg), hasLock: files.some((f) => f.path === 'package-lock.json') };
}

export function checkCapacity(apps, label, tier, cfg) {
  const others = Object.values(apps).filter((a) => a.label !== label);
  if (!apps[label] && others.length >= cfg.MAX_APPS) {
    throw new HttpError(409, 'capacity', `The runner is full: ${others.length} of ${cfg.MAX_APPS} apps are deployed. Delete one before deploying another.`);
  }
  if (tier === 'browser' && others.filter((a) => a.tier === 'browser').length >= cfg.MAX_BROWSER_APPS) {
    throw new HttpError(409, 'browser_capacity', `Only ${cfg.MAX_BROWSER_APPS} apps may use the browser tier, and that many already do.`);
  }
}

export function allocateIp(apps, cfg) {
  const used = new Set(Object.values(apps).map((a) => a.ip));
  for (let n = 10; n <= 250; n++) if (!used.has(cfg.APPS_IP_PREFIX + n)) return cfg.APPS_IP_PREFIX + n;
  throw new HttpError(409, 'capacity', 'No free addresses left on the apps network.');
}

export const RESERVED_ENV = new Set(['PORT', 'HOME', 'PATH', 'TMPDIR', 'HOSTNAME', 'NODE_ENV', 'OFFICE_APP', 'OFFICE_DATA_DIR', 'OFFICE_HOST', 'PLAYWRIGHT_BROWSERS_PATH']);

// Secrets are app env vars. Values are never logged or returned; forbidden holds sha256 hex of the
// building's own keys so one can never be handed to an app by mistake.
export function checkSecrets(env, forbidden = new Set()) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) throw new HttpError(400, 'bad_secrets', 'env must be an object of NAME: value.');
  const names = Object.keys(env);
  if (names.length > 32) throw new HttpError(400, 'bad_secrets', 'At most 32 secrets per app.');
  for (const k of names) {
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(k)) throw new HttpError(400, 'bad_secrets', `Secret names are UPPER_SNAKE_CASE: ${k.slice(0, 64)}`);
    if (RESERVED_ENV.has(k)) throw new HttpError(400, 'bad_secrets', `${k} is set by the runner.`);
    const v = env[k];
    if (typeof v !== 'string' || Buffer.byteLength(v) > 4096 || v.includes('\0')) throw new HttpError(400, 'bad_secrets', `${k} must be a string up to 4 KB.`);
    if (forbidden.has(crypto.createHash('sha256').update(v).digest('hex'))) {
      throw new HttpError(400, 'forbidden_secret', `${k} holds one of the building's own keys. Apps never get those; Phase 2 gives them an AI proxy token instead.`);
    }
  }
  return env;
}
