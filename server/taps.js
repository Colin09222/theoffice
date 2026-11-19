// Tapped calls (docs/redesign/ROUND1-REST.md, job 33; spec section 9, item 3: TheTireRx's "pause and measure"). Real taps on tel: links on every
// floor's published pages, counted the way real visits are: bots left out, and the floor's own boss and the building manager left out. No
// third-party script and no personal data: a row is floor, project, page path, the number tapped and the time.
//
// How: when the Office serves a published page that has a tel: link, it adds one tiny first-party script, /_office/taps.js (TAP_SCRIPT). On a
// tap it sends one beacon to the page's own origin, /_office/tap. Offline, the beacon simply fails; the call still happens. It listens without
// stopping or changing anything, so pages with their own scripts work as before.
//
// The boss and Colon: a project's origin never sees the Office's cookies. Instead, while a boss or the admin uses the Office, the server
// remembers that device (a salted hash of address and browser, in memory only, for a day). A tap from a remembered device on that boss's own
// floor, or from the admin's, is not counted. TAP_COUNT=0 stops adding the script and counting.
import { createHash, randomBytes } from 'node:crypto';
import { get, run } from './db.js';

const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|headless|lighthouse|curl|wget|python-requests|node-fetch|axios|go-http/i;
const DAY = 86400000;
const REPEAT_MS = 10000;   // one tap sends one beacon; the same tap seen again within this is the same tap
export const TAP_SCRIPT = '<script src="/_office/taps.js" defer></script>';
// Plain ES5, wrapped and guarded: no globals, nothing thrown, nothing prevented.
export const TAP_JS = `(function(){try{document.addEventListener('click',function(e){try{var a=e.target&&e.target.closest&&e.target.closest('a[href]');if(!a)return;var h=a.getAttribute('href')||'';if(!/^tel:/i.test(h))return;var b=JSON.stringify({path:location.pathname,number:h.slice(4)});if(!(navigator.sendBeacon&&navigator.sendBeacon('/_office/tap',new Blob([b],{type:'text/plain'}))))fetch('/_office/tap',{method:'POST',body:b,keepalive:true,headers:{'content-type':'text/plain'}}).catch(function(){});}catch(x){}},true);}catch(x){}})();`;

/** The page with the tap script added, when it has a tel: link and doesn't have the script already. */
export function injectTaps(body) {
  const text = Buffer.isBuffer(body) ? body.toString('utf8') : body;
  if (typeof text !== 'string' || !/href\s*=\s*["']?\s*tel:/i.test(text) || text.includes('_office/taps.js')) return body;
  const i = text.toLowerCase().lastIndexOf('</body');
  const out = i >= 0 ? `${text.slice(0, i)}${TAP_SCRIPT}${text.slice(i)}` : `${text}\n${TAP_SCRIPT}`;
  return Buffer.isBuffer(body) ? Buffer.from(out) : out;
}

/** A number as dialled: digits, and a + in front if there was one. Nothing else is kept. */
export const cleanNumber = (s) => { const t = String(s || '').trim(); const d = t.replace(/[^\d]/g, '').slice(0, 20); return d ? `${t.startsWith('+') ? '+' : ''}${d}` : ''; };

export function createTaps({ db, now = Date.now }) {
  const salt = randomBytes(16).toString('hex');   // new on every start: the remembered devices can't be matched to anything later
  const seenDevices = new Map();                  // device hash -> { floors: Set, admin: bool, at }
  const recent = new Map();                       // device|project|path|number -> time, for repeats
  const device = (ip, ua) => createHash('sha256').update(`${salt}|${ip}|${ua}`).digest('base64url').slice(0, 22);
  const sweep = (t) => {
    for (const [k, v] of seenDevices) if (t - v.at > DAY) seenDevices.delete(k);
    for (const [k, at] of recent) if (t - at > REPEAT_MS) recent.delete(k);
  };
  return {
    /** A boss (floorId) or the admin (floorId null, admin true) used the Office from this device. */
    noteOwnDevice(ip, ua, { floorId = null, admin = false }) {
      const t = now(); const k = device(ip, ua || '');
      const v = seenDevices.get(k) || { floors: new Set(), admin: false, at: t };
      if (floorId) v.floors.add(floorId);
      v.admin ||= admin; v.at = t;
      seenDevices.set(k, v);
      if (seenDevices.size > 5000) sweep(t);
    },
    /** One tap. Returns why it was or wasn't counted. */
    record({ floorId, project, path, number, ip, ua }) {
      const t = now();
      if (!ua || BOT.test(ua)) return 'bot';
      const num = cleanNumber(number);
      if (!num) return 'no_number';
      const k = device(ip, ua);
      const own = seenDevices.get(k);
      if (own && t - own.at <= DAY && (own.admin || own.floors.has(floorId))) return 'own';
      const p = String(path || '/').split('?')[0].slice(0, 120) || '/';
      const key = `${k}|${floorId}|${project}|${p}|${num}`;
      if (recent.has(key) && t - recent.get(key) < REPEAT_MS) return 'repeat';
      recent.set(key, t); if (recent.size > 5000) sweep(t);
      run(db, 'INSERT INTO tel_taps (floor_id, project, path, number, created_at) VALUES (?,?,?,?,?)', floorId, project, p, num, t);
      return 'counted';
    },
  };
}

/** Tapped calls on a floor since `from` (all projects). */
export const tapsSince = (db, floorId, from) => get(db, 'SELECT COUNT(*) n FROM tel_taps WHERE floor_id=? AND created_at>=?', floorId, from).n;
