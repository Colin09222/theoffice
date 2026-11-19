// Share cards (docs/redesign/OFFICE-ANSWERS-2.md, Q8 b; job r2-j60): the picture a chat app shows when someone pastes a floor's link. 1,200 by 630,
// under 200 KB, remade on each launch and once a week. The card is a small page the server writes from public facts only (the floor's name and
// number, its launches and real visits, its best launch photo), photographed by the shots browser (server/shooter.js). With no browser to hand, a
// plain card in the floor's colours is drawn here instead, so a link always has a picture. No model, no money, nothing private, never a demo floor.
// SHARE_CARDS=0 stops making them; the floor link then keeps the plain page title.
import { deflateSync } from 'node:zlib';
import { get, run } from './db.js';
import { makeShooter } from './shooter.js';
import { launches } from './shots.js';
import { roomMilestones } from './room.js';

export const CARD = { width: 1200, height: 630, maxBytes: 200 * 1024, everyMs: 7 * 86400000 };
const BASE = '/theoffice';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const color = (c, d) => (/^#[0-9a-f]{6}$/i.test(String(c)) ? c : d);
const shown = (f) => f && f.status === 'active' && !f.hidden && !f.filler;

/** The card as a page: the facts a visitor could already read on the floor, laid out at 1,200 by 630. */
export function cardHtml(db, f, origin = '') {
  const colors = (() => { try { return JSON.parse(f.colors); } catch { return {}; } })();
  const primary = color(colors.primary, '#2b2d42'), accent = color(colors.accent, '#f2b632');
  const list = launches(db, { floorId: f.id }).filter((l) => !l.wip);
  const best = [...list].sort((a, b) => b.visits - a.visits || b.published_at - a.published_at).find((l) => l.shot_at);
  const m = roomMilestones(db, f);
  const photo = best ? `${origin}${BASE}/api/building/shot/${f.slug}/${best.slug}?v=${best.shot_at}` : '';
  const facts = m.launches ? `${m.launches} launched · ${m.visits.toLocaleString('en-US')} real visits` : 'Just moved in';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:${CARD.width}px;height:${CARD.height}px;overflow:hidden;font-family:Inter,Helvetica,Arial,sans-serif}
.card{position:relative;width:100%;height:100%;background:linear-gradient(135deg,${primary},#14161f);color:#fff8e8;display:flex}
.text{flex:1;padding:64px 56px;display:flex;flex-direction:column;justify-content:space-between}
.floor{font-size:28px;letter-spacing:.08em;text-transform:uppercase;color:${accent};font-weight:700}
h1{font:600 72px/1.05 Georgia,serif;margin:18px 0 0;max-width:620px;word-wrap:break-word}
.facts{font-size:30px;opacity:.92}.brand{font-size:24px;opacity:.75}
.shot{width:520px;margin:56px 56px 56px 0;border-radius:18px;overflow:hidden;box-shadow:0 18px 50px rgba(0,0,0,.45);background:${accent}}
.shot img{width:100%;height:100%;object-fit:cover;display:block}
</style></head><body><div class="card"><div class="text"><div><div class="floor">Floor ${Number(f.number)}</div><h1>${esc(f.name || `Floor ${f.number}`)}</h1></div>
<div><div class="facts">${esc(facts)}</div><div class="brand">The Office · small AI teams, one floor each</div></div></div>
${photo ? `<div class="shot"><img src="${esc(photo)}" alt=""></div>` : ''}</div></body></html>`;
}

// A plain PNG card for when no browser is reachable: the floor's colours, a band of its accent and a little tower. No text (there is no font here).
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
export function plainCard(f) {
  const colors = (() => { try { return JSON.parse(f.colors); } catch { return {}; } })();
  const A = rgb(color(colors.primary, '#2b2d42')), B = rgb(color(colors.accent, '#f2b632')), D = [20, 22, 31];
  const { width: w, height: h } = CARD;
  const raw = Buffer.alloc(h * (1 + w * 3));
  const tower = (x, y) => x > 820 && x < 1000 && y > 150 && y < 560 && (y - 150) % 46 < 30 && (x - 820) % 45 < 30;  // lit windows
  for (let y = 0; y < h; y++) {
    const t = y / h;
    for (let x = 0; x < w; x++) {
      let c = [0, 1, 2].map((i) => Math.round(A[i] * (1 - t) + D[i] * t));
      if (y > 520 && y < 540 && x > 64 && x < 560) c = B;
      if (x >= 800 && x <= 1020 && y >= 120 && y <= 580) c = [0, 1, 2].map((i) => Math.round(D[i] * 0.7 + A[i] * 0.3));
      if (tower(x, y)) c = B;
      raw[y * (1 + w * 3) + 1 + x * 3] = c[0]; raw[y * (1 + w * 3) + 2 + x * 3] = c[1]; raw[y * (1 + w * 3) + 3 + x * 3] = c[2];
    }
  }
  const chunk = (type, data) => { const td = Buffer.concat([Buffer.from(type, 'latin1'), data]); const out = Buffer.alloc(td.length + 8); out.writeUInt32BE(data.length, 0); td.copy(out, 4); out.writeUInt32BE(crc32(td), td.length + 4); return out; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
/** Width and height of a JPEG or PNG, read from its own header. */
export function imageSize(b) {
  if (b?.[0] === 0x89 && b[1] === 0x50) return { type: 'image/png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b?.[0] !== 0xff || b[1] !== 0xd8) return null;
  for (let i = 2; i < b.length - 9;) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1], len = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { type: 'image/jpeg', height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

export function installShareCards(ext) {
  const { db, cfg, engine, now, log, GET, send, floorBySlug, HttpError } = ext;
  const origin = () => (cfg.shotsOrigin || cfg.publicOrigin || `http://127.0.0.1:${cfg.port}`).replace(/\/+$/, '');
  /** Photograph the card page at 1,200 by 630, a little lower in quality until it is under 200 KB. A test passes cfg.shareCardShoot. */
  async function shoot(url) {
    const shooter = cfg.shareCardShoot ? { shoot: cfg.shareCardShoot, close() {} } : await makeShooter({ cdpUrl: cfg.shotsCdpUrl || '', settleMs: 900 });
    if (!shooter) return null;
    try {
      for (const quality of [82, 70, 58, 45]) {
        const jpg = await shooter.shoot(url, { width: CARD.width, height: CARD.height, scale: 1, quality });
        if (jpg && jpg.length <= CARD.maxBytes) return jpg;
      }
      return null;
    } finally { shooter.close(); }
  }
  /** Makes the floor's card now. `why`: 'launch', 'weekly' or 'first'. */
  async function make(f, why = 'weekly') {
    if (cfg.shareCards === false || !shown(f)) return null;
    let image = null;
    try { image = await shoot(`${origin()}${BASE}/api/floors/${f.slug}/sharecard.html`); } catch (e) { log?.('warn', 'share card', { err: String(e?.message || e).slice(0, 160) }); }
    const kind = image ? 'image/jpeg' : 'image/png';
    if (!image) image = plainCard(f);
    run(db, 'INSERT INTO share_cards (floor_id, image, type, bytes, made_at, why) VALUES (?,?,?,?,?,?) ON CONFLICT(floor_id) DO UPDATE SET image=excluded.image, type=excluded.type, bytes=excluded.bytes, made_at=excluded.made_at, why=excluded.why', f.id, image, kind, image.length, now(), why);
    return get(db, 'SELECT * FROM share_cards WHERE floor_id=?', f.id);
  }
  ext.shareCard = make;
  // Remade on each launch: a project going public is the moment the card's facts change.
  const emitProject = engine.emitProject.bind(engine);
  engine.emitProject = (floorId, slug) => {
    emitProject(floorId, slug);
    const f = get(db, 'SELECT * FROM floors WHERE id=?', floorId);
    const p = get(db, 'SELECT published_at, private FROM projects WHERE floor_id=? AND slug=?', floorId, slug);
    if (f && p?.published_at && !p.private && now() - p.published_at < 120000) setImmediate(() => { make(f, 'launch').catch(() => {}); });
  };
  // The card page and the card. Public, but only for a floor on show; anything else answers like a page that isn't there.
  GET('/api/floors/:slug/sharecard.html', async ({ res, p }) => {
    const f = floorBySlug(p.slug);
    if (!shown(f)) throw new HttpError(404, 'not_found');
    // Its own tight policy: the card's inline style and the building's own pictures, nothing else, no script at all.
    send(res, 200, cardHtml(db, f, origin()), { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" });
  });
  GET('/api/floors/:slug/sharecard', async ({ res, p }) => {
    const f = floorBySlug(p.slug);
    if (!shown(f) || cfg.shareCards === false) throw new HttpError(404, 'not_found');
    const row = get(db, 'SELECT image, type FROM share_cards WHERE floor_id=?', f.id);
    if (row) return send(res, 200, Buffer.from(row.image), { 'content-type': row.type, 'cache-control': 'public, max-age=3600' });
    send(res, 200, plainCard(f), { 'content-type': 'image/png', 'cache-control': 'public, max-age=600' });
  });
  /** The floor link's preview: its name, a line of real facts and the card. Null for a floor not on show. */
  ext.floorShareMeta = (slug, req) => {
    const f = get(db, 'SELECT * FROM floors WHERE slug=?', slug);
    if (!shown(f) || cfg.shareCards === false) return null;
    const o = (cfg.publicOrigin || `http://${String(req.headers.host || 'localhost').replace(/[^a-zA-Z0-9.:[\]-]/g, '')}`).replace(/\/+$/, '');
    const row = get(db, 'SELECT made_at FROM share_cards WHERE floor_id=?', f.id);
    const m = roomMilestones(db, f);
    const title = `${f.name || `Floor ${f.number}`}: floor ${f.number} of The Office`;
    const line = m.launches ? `${m.launches} launched, ${m.visits.toLocaleString('en-US')} real visits. Watch its AI team at work.` : `Floor ${f.number} of The Office. Watch its AI team at work.`;
    const image = `${o}${BASE}/api/floors/${f.slug}/sharecard?v=${row?.made_at || 0}`;
    const tag = (k, v, attr = 'property') => `<meta ${attr}="${k}" content="${esc(v)}">`;
    return { title, tags: [tag('og:type', 'website'), tag('og:title', title), tag('og:description', line), tag('og:url', `${o}${BASE}/floor/${f.slug}`), tag('og:site_name', 'The Office'),
      tag('og:image', image), tag('og:image:width', String(CARD.width)), tag('og:image:height', String(CARD.height)), tag('twitter:card', 'summary_large_image', 'name'), tag('twitter:image', image, 'name'), tag('twitter:title', title, 'name'), tag('description', line, 'name')].join('\n') };
  };
  // Once a week, and the first time for a floor that has none: checked hourly, one floor at a time.
  let timer = null, busy = false;
  async function tick() {
    if (busy || cfg.shareCards === false) return;
    busy = true;
    try {
      for (const f of db.prepare("SELECT f.* FROM floors f LEFT JOIN share_cards s ON s.floor_id=f.id WHERE f.status='active' AND f.hidden=0 AND f.filler=0 AND (s.made_at IS NULL OR s.made_at < ?) ORDER BY f.number").all(now() - CARD.everyMs)) {
        const had = get(db, 'SELECT 1 x FROM share_cards WHERE floor_id=?', f.id);
        await make(f, had ? 'weekly' : 'first');
      }
    } finally { busy = false; }
  }
  ext.shareCardTick = tick;
  return { tick, start() { if (cfg.shareCards === false) return; timer = setInterval(() => { tick(); }, 3600000); timer.unref?.(); }, stop() { clearInterval(timer); timer = null; } };
}
