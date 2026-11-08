// App-grade publishing. Each project gets its own origin, so it has real localStorage, service workers and PWA install,
// while the browser's own origin rules keep it out of everything else. Labels are allocated once and never reused:
// a service worker or saved data left behind by an old tenant must never meet a new tenant's site on the same origin.
import { createHash } from 'node:crypto';
import { get, run, all } from './db.js';

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const trim = (s) => s.replace(/-+$/, '');

// Two-letter-then-hyphens labels are reserved in DNS: browsers treat xn-- as an encoded name, and certificate authorities refuse the rest.
// api--* names belong to the runner's edge: Caddy sends them to a project's server, never to its site.
export const RESERVED_PREFIXES = ['api--'];
const reservedPrefix = (l) => RESERVED_PREFIXES.some((x) => l.startsWith(x));
const usable = (l) => l.length <= 63 && LABEL.test(l) && l.slice(2, 4) !== '--' && !reservedPrefix(l);

// The short address a launched project gets when it's free: just the project's name. Never a name a service on the domain could need.
export const RESERVED_LABELS = new Set(('www www1 www2 api api2 mail email smtp imap pop pop3 ftp sftp ssh webmail mx mx1 mx2 send rsend ns ns1 ns2 ns3 ns4 dns vpn cpanel whm root admin administrator app apps cdn static assets media img images files upload uploads download downloads status health monitor metrics '
  + 'blog docs doc help support contact about privacy terms legal security abuse postmaster hostmaster webmaster autoconfig autodiscover dkim dmarc spf test staging dev demo preview beta sandbox console dashboard '
  + 'login signin signup account accounts auth oauth sso billing pay payment payments shop store '
  + 'office theoffice middistance iscolinfree fakebusiness localhost example').split(' '));
export const shortLabelFor = (project) => {
  const l = String(project);
  return l.length >= 3 && l.length <= 58 && !l.includes('--') && usable(l) && !RESERVED_LABELS.has(l) ? l : null;
};

function candidate(floor, project, salt = '') {
  const plain = `${project}--${floor.slug}`;
  if (!salt && usable(plain)) return plain;
  const tag = createHash('sha256').update(`${floor.id}:${project}:${salt}`).digest('hex').slice(0, 8);
  const made = `${trim(project.slice(0, 22))}-x--${trim(floor.slug.slice(0, 22))}-${tag}`;
  return usable(made) ? made : `p-${made}`;
}

/** The label for a project, allocated the first time it is asked for. A project with a short address uses it; the long one keeps working. */
export function appLabel(db, floor, project) {
  const short = get(db, 'SELECT label FROM app_short_labels WHERE floor_id=? AND project=?', floor.id, project);
  if (short) return short.label;
  const have = get(db, 'SELECT label FROM app_labels WHERE floor_id=? AND project=?', floor.id, project);
  if (have) return have.label;
  for (let i = 0; i < 6; i++) {
    const label = candidate(floor, project, i ? String(i) : '');
    if (!usable(label) || get(db, 'SELECT 1 x FROM app_labels WHERE label=?', label)) continue;
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

/**
 * The short address for a project being launched, or null if it can't have one and stays on the long form. Like every label it is allocated
 * once and never reused: a service worker or saved data from one project must never meet another on the same origin.
 */
export function claimShortLabel(db, floor, project) {
  const have = get(db, 'SELECT label FROM app_short_labels WHERE floor_id=? AND project=?', floor.id, project);
  if (have) return have.label;
  const label = shortLabelFor(project);
  if (!label || get(db, 'SELECT 1 x FROM app_labels WHERE label=?', label) || get(db, 'SELECT 1 x FROM app_short_labels WHERE label=?', label)) return null;
  return run(db, 'INSERT OR IGNORE INTO app_short_labels (label,floor_id,project,created_at) VALUES (?,?,?,?)', label, floor.id, project, Date.now()).changes ? label : null;
}

export const lookupLabel = (db, label) => get(db, 'SELECT floor_id,project FROM app_short_labels WHERE label=?', label) || get(db, 'SELECT floor_id,project FROM app_labels WHERE label=?', label);
export const allLabels = (db) => [...all(db, 'SELECT label FROM app_labels'), ...all(db, 'SELECT label FROM app_short_labels')];

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
