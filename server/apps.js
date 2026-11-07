// App-grade publishing. Each project gets its own origin, so it has real localStorage, service workers and PWA install,
// while the browser's own origin rules keep it out of everything else. Labels are allocated once and never reused:
// a service worker or saved data left behind by an old tenant must never meet a new tenant's site on the same origin.
import { createHash } from 'node:crypto';
import { get, run, all } from './db.js';

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const trim = (s) => s.replace(/-+$/, '');

// Two-letter-then-hyphens labels are reserved in DNS: browsers treat xn-- as an encoded name, and certificate authorities refuse the rest.
const usable = (l) => l.length <= 63 && LABEL.test(l) && l.slice(2, 4) !== '--';

function candidate(floor, project, salt = '') {
  const plain = `${project}--${floor.slug}`;
  if (!salt && usable(plain)) return plain;
  const tag = createHash('sha256').update(`${floor.id}:${project}:${salt}`).digest('hex').slice(0, 8);
  return `${trim(project.slice(0, 22))}-x--${trim(floor.slug.slice(0, 22))}-${tag}`;
}

/** The label for a project, allocated the first time it is asked for. */
export function appLabel(db, floor, project) {
  const have = get(db, 'SELECT label FROM app_labels WHERE floor_id=? AND project=?', floor.id, project);
  if (have) return have.label;
  for (let i = 0; i < 6; i++) {
    const label = candidate(floor, project, i ? String(i) : '');
    if (get(db, 'SELECT 1 x FROM app_labels WHERE label=?', label)) continue;
    run(db, 'INSERT INTO app_labels (label,floor_id,project,created_at) VALUES (?,?,?,?)', label, floor.id, project, Date.now());
    return label;
  }
  throw new Error('could not allocate an app label');
}

export const appOrigin = (cfg, label) => `${cfg.appsScheme}://${label}.${cfg.appsBaseDomain}`;

/** Is this Host header anywhere under the apps domain? Anything that is must never reach the main app, even if the label is nonsense. */
export function appHostLabel(cfg, rawHost) {
  if (!cfg.appsBaseDomain) return null;
  const host = String(rawHost || '').toLowerCase().replace(/\.$/, '');
  const base = cfg.appsBaseDomain;
  const hostname = host.split(':')[0]; const baseName = base.split(':')[0];
  if (hostname !== baseName && !hostname.endsWith(`.${baseName}`)) return null;
  const label = hostname === baseName ? '' : hostname.slice(0, -baseName.length - 1);
  return LABEL.test(label) ? label : '';
}

export const lookupLabel = (db, label) => get(db, 'SELECT floor_id,project FROM app_labels WHERE label=?', label);
export const allLabels = (db) => all(db, 'SELECT label FROM app_labels');

/** Everything a published page may do. It stays inside its own origin: no fetch, form or embed can reach the main site through this page. */
export function appCsp(cfg) {
  const parent = cfg.publicOrigin ? ` ${cfg.publicOrigin}` : '';
  return "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' data: blob:; worker-src 'self' blob:; manifest-src 'self'; frame-src 'self' blob: data:; object-src 'none'; base-uri 'self'; form-action 'self'; "
    + `frame-ancestors 'self'${parent}`;
}

export const appHeaders = (cfg) => ({
  'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex, nofollow, noarchive', 'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'content-security-policy': appCsp(cfg), 'cross-origin-opener-policy': 'same-origin', 'cross-origin-resource-policy': 'same-origin',
});

// The one cookie an app origin ever sees: a one-hour pass for a private project, valid on that origin alone.
export const previewCookieName = (cfg) => (cfg.appsScheme === 'https' ? '__Host-office_preview' : 'office_preview');
export function previewCookie(cfg, value, maxAge) {
  // SameSite=None so the preview frame still works when the apps domain is a separate registrable domain. It opens one project's pages and nothing else.
  return `${previewCookieName(cfg)}=${value}; Path=/; HttpOnly; Max-Age=${maxAge}${cfg.appsScheme === 'https' ? '; Secure; SameSite=None' : '; SameSite=Lax'}`;
}
