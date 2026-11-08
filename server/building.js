// The building as a whole: the lobby ticker and the launched wall, public information only. See docs/DEPLOY-PLUS.md.
// Everything here is what a visitor with no cookie may see: it goes through the same viewEvent rules as a floor's
// visitor stream, and private projects are checked again against the projects table at the moment of each reply.
import { get, all } from './db.js';
import { esc } from '../public/js/markdown.js';
import { mimeOf } from './workspace.js';

const TICKER_TTL_MS = 5000;
const TICKER_SCAN = 150;
const MAX_TICKER = 60;
const MAX_WALL = 120;
const PINNED_LAUNCHES = 3;
const LIFE_TTL_MS = 3000;
const LIFE_SCAN = 4000;              // how far back through the events table one look goes, newest first
const LIFE_TALK_MS = 3 * 60_000;     // a line older than this is old news in the lobby
const LIFE_MEETING_MS = 2 * 60_000;  // and a meeting is over by then
const LIFE_TALK_PER_FLOOR = 3;
const LIFE_TALK_CHARS = 160;
const GLYPH = { site: '◆', app: '▣', game: '▲', simulation: '◎', doc: '≡', research: '☍' };
const KIND_WORD = { site: 'Site', app: 'App', game: 'Game', simulation: 'Simulation', doc: 'Doc', research: 'Research' };

const num = (v, d, lo, hi) => { const n = Number.parseInt(String(v ?? ''), 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const floorInfo = (f) => ({ number: f.number, slug: f.slug, name: f.name, colors: JSON.parse(f.colors) });
const key = (floorId, slug) => `${floorId}/${slug}`;

export function installBuilding(ext) {
  const { db, engine, now, GET, json, send, floorBySlug, HttpError, BASE, PRIVATE_TEXT, viewEvent } = ext;
  const privateLine = PRIVATE_TEXT.toLowerCase();

  // ---- the stack ----
  // Everyone in the building, floor by floor, for the stacked cutaway in the lobby: name, look and whether they're at it. All of it
  // is on each floor's own page already. Hidden floors and closed ones stay out.
  GET('/api/building/staff', async ({ res }) => {
    const rows = all(db, `SELECT f.number, a.id, a.name, a.role, a.title, a.look, a.state FROM agents a JOIN floors f ON f.id = a.floor_id
      WHERE f.status = 'active' AND f.hidden = 0 ORDER BY f.number DESC, a.id`);
    const floors = {};
    for (const r of rows) {
      let look = null; try { look = JSON.parse(r.look); } catch { /* a drawn face in the defaults */ }
      (floors[r.number] ||= []).push({ id: r.id, name: r.name, role: r.role, title: r.title || '', look, busy: r.state !== 'idle' });
    }
    json(res, 200, { floors, ts: now() });
  });

  // What the little people in the stack's cutaways are up to: who is at it, the last few things said out loud, and whether a meeting
  // is on. Small enough to ask for every few seconds, and judged by the same rules as each floor's own visitor stream (viewEvent), so
  // the lobby never shows more than walking in would. Floors with nothing going on are left out.
  let lifeCache = { at: 0, body: null };
  function life() {
    const t = now();
    if (lifeCache.body && t - lifeCache.at < LIFE_TTL_MS && t >= lifeCache.at) return lifeCache.body;
    const floors = new Map(all(db, "SELECT id, number, public_chat, default_private FROM floors WHERE status = 'active' AND hidden = 0").map((f) => [f.id, f]));
    const out = {};
    const slot = (f) => (out[f.number] ||= { busy: [], talk: [], meeting: null });
    for (const a of all(db, "SELECT floor_id, id FROM agents WHERE state != 'idle' ORDER BY id")) { const f = floors.get(a.floor_id); if (f) slot(f).busy.push(a.id); }
    const top = get(db, 'SELECT COALESCE(MAX(id), 0) n FROM events').n;
    const rows = all(db, `SELECT id, floor_id, type, project, data, created_at FROM events WHERE id > ? AND type IN ('talk', 'meeting') AND created_at >= ?
      ORDER BY id DESC`, top - LIFE_SCAN, t - LIFE_TALK_MS);
    for (const r of rows) {
      const f = floors.get(r.floor_id);
      if (!f) continue;
      let data; try { data = JSON.parse(r.data); } catch { continue; }
      if (r.type === 'meeting') {
        if (r.created_at < t - LIFE_MEETING_MS || out[f.number]?.meeting) continue;
        const ids = [data.manager, ...(Array.isArray(data.staff) ? data.staff : [])].filter(Number.isInteger);
        slot(f).meeting = { at: r.created_at, ids: [...new Set(ids)] };
        continue;
      }
      if ((out[f.number]?.talk.length || 0) >= LIFE_TALK_PER_FLOOR) continue;
      const v = viewEvent(db, { floorId: r.floor_id, type: 'talk', project: r.project, data, id: r.id, ts: r.created_at }, { owner: false, publicChat: !!f.public_chat, defaultPrivate: !!f.default_private });
      const said = v?.data;
      if (!said || said.kind === 'private' || !Number.isInteger(said.from) || !String(said.text || '').trim()) continue;
      slot(f).talk.push({ id: r.id, from: said.from, to: Number.isInteger(said.to) ? said.to : null, kind: said.kind || '', text: String(said.text).trim().slice(0, LIFE_TALK_CHARS), ts: r.created_at });
    }
    for (const s of Object.values(out)) s.talk.reverse();  // oldest first, the order they were said in
    lifeCache = { at: t, body: { floors: out, ts: t } };
    return lifeCache.body;
  }
  GET('/api/building/life', async ({ res }) => { json(res, 200, life()); });

  // ---- the ticker ----
  // One scan of the newest events is cached briefly. Each cached line keeps the facts needed to re-check it later,
  // so a project made private a moment ago is never served, whatever the clock says.
  let cache = { at: 0, items: [] };
  function scan() {
    const rows = all(db, `SELECT e.id, e.floor_id, e.type, e.project, e.data, e.created_at, f.number, f.slug, f.name, f.colors, f.default_private, f.filler
      FROM events e JOIN floors f ON f.id = e.floor_id
      WHERE e.type IN ('feed', 'project') AND f.status = 'active' AND f.hidden = 0 ORDER BY e.id DESC LIMIT ?`, TICKER_SCAN);
    const out = [];
    for (const r of rows) {
      let data; try { data = JSON.parse(r.data); } catch { continue; }
      const viewer = { owner: false, publicChat: false, defaultPrivate: !!r.default_private };
      const v = viewEvent(db, { floorId: r.floor_id, type: r.type, project: r.project, data, id: r.id, ts: r.created_at, chat: false, ownerOnly: false }, viewer);
      if (!v) continue;
      const floor = { number: r.number, slug: r.slug, name: r.name, colors: JSON.parse(r.colors) };
      const base = { id: r.id, ts: r.created_at, floor, filler: !!r.filler, _floorId: r.floor_id, _project: r.project || '' };
      if (r.type === 'feed') {
        const text = String(v.data?.text ?? '');
        if (!text || text.toLowerCase().includes(privateLine) || /private task/i.test(text)) continue;
        const who = v.data.agent === null || !v.data.name || v.data.name === 'Office' ? '' : `${v.data.name} `;
        out.push({ ...base, kind: 'feed', text: `${who}${text}`, _agent: v.data.agent ?? null });
      } else {
        const slug = String(v.data?.slug || r.project || '');
        if (!slug) continue;
        const pr = get(db, 'SELECT title, private, published_at FROM projects WHERE floor_id=? AND slug=?', r.floor_id, slug);
        if (!pr || pr.private || !pr.published_at) continue;
        out.push({ ...base, kind: 'published', text: `launched "${pr.title}"`, url: engine.liveUrl({ id: r.floor_id, slug: r.slug }, slug), _project: slug, _agent: null });
      }
    }
    return out;
  }
  function tickerItems() {
    const t = now();
    if (t - cache.at > TICKER_TTL_MS || t < cache.at) cache = { at: t, items: scan() };
    // Re-checked on every reply: a floor suspended or a project made private since the scan drops out at once.
    const floors = new Map(all(db, 'SELECT id, status, default_private, filler, hidden FROM floors').map((f) => [f.id, f]));
    const priv = new Set(all(db, 'SELECT floor_id, slug FROM projects WHERE private=1').map((p) => key(p.floor_id, p.slug)));
    const out = [];
    for (const it of cache.items) {
      const f = floors.get(it._floorId);
      if (!f || f.status !== 'active' || f.hidden) continue;
      if (it._project && priv.has(key(it._floorId, it._project))) continue;
      if (!it._project && f.default_private && it.kind === 'feed' && it._agent !== null) continue;
      const { _floorId, _project, _agent, ...pub } = it;
      out.push({ ...pub, filler: !!f.filler });
    }
    return out;
  }
  // Launch parties (server/life.js) are picked from the same checked lines.
  ext.tickerItems = tickerItems;
  GET('/api/building/ticker', async ({ res, url }) => {
    const limit = num(url.searchParams.get('limit'), 40, 1, MAX_TICKER);
    const since = num(url.searchParams.get('since'), 0, 0, Number.MAX_SAFE_INTEGER);
    const fresh = tickerItems().filter((i) => i.id > since);
    const items = fresh.slice(0, limit);
    // A launch is the headline of the building. The newest few stay in the strip even when task chatter would bury them.
    for (const pin of fresh.filter((i) => i.kind === 'published').slice(0, PINNED_LAUNCHES)) {
      if (items.includes(pin)) continue;
      const drop = items.findLastIndex((i) => i.kind !== 'published');
      if (drop < 0) break;
      items.splice(drop, 1); items.push(pin);
    }
    items.sort((a, b) => b.id - a.id);
    json(res, 200, { items, latest: items[0]?.id ?? since, ts: now() });
  });

  // ---- the launched wall ----
  // A thumbnail is the project's own og:image when it points at one of its own published image files, else the drawn card.
  const thumbCache = new Map();
  function thumbFor(f, pr, url) {
    const k = `${f.id}|${pr.slug}|${pr.published_at}`;
    if (thumbCache.has(k)) return thumbCache.get(k)(url);
    let rel = null;
    const html = get(db, "SELECT content FROM published_files WHERE floor_id=? AND project=? AND path='index.html'", f.id, pr.slug)?.content;
    if (html) {
      const head = String(html).slice(0, 64 * 1024);
      const m = head.match(/<meta\s+[^>]*?(?:property|name)\s*=\s*["']og:image["'][^>]*?content\s*=\s*["']([^"']+)["']/i) || head.match(/<meta\s+[^>]*?content\s*=\s*["']([^"']+)["'][^>]*?(?:property|name)\s*=\s*["']og:image["']/i);
      const raw = m ? m[1].trim().replace(/^\.\//, '') : '';
      // Only a plain relative path inside this project, and only if it really is one of its image files.
      if (raw && /^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/.test(raw) && /^image\//.test(mimeOf(raw)) && get(db, 'SELECT 1 x FROM published_files WHERE floor_id=? AND project=? AND path=?', f.id, pr.slug, raw)) rel = raw;
    }
    const make = rel ? (u) => `${u}${rel.split('/').map(encodeURIComponent).join('/')}` : () => `${BASE}/api/building/thumb/${f.slug}/${pr.slug}`;
    if (thumbCache.size >= 400) thumbCache.delete(thumbCache.keys().next().value);
    thumbCache.set(k, make);
    return make(url);
  }
  const wallRows = (limit) => all(db, `SELECT p.slug, p.title, p.description, p.kind, p.published_at, p.floor_id, f.id fid, f.number, f.slug fslug, f.name fname, f.colors
    FROM projects p JOIN floors f ON f.id = p.floor_id
    WHERE p.published_at IS NOT NULL AND p.private = 0 AND f.status = 'active' AND f.filler = 0 AND f.hidden = 0 ORDER BY p.published_at DESC, p.slug LIMIT ?`, limit);
  GET('/api/building/launched', async ({ res, url }) => {
    const limit = num(url.searchParams.get('limit'), 60, 1, MAX_WALL);
    const projects = wallRows(limit).map((r) => {
      const f = { id: r.fid, number: r.number, slug: r.fslug, name: r.fname, colors: r.colors };
      const liveUrl = engine.liveUrl(f, r.slug);
      return { floor: floorInfo(f), slug: r.slug, title: r.title, description: r.description, kind: r.kind, publishedAt: r.published_at, url: liveUrl, thumb: thumbFor(f, { slug: r.slug, published_at: r.published_at }, liveUrl) };
    });
    json(res, 200, { projects, ts: now() });
  });

  // A little card drawn from the floor's colours. Every piece of text goes through esc, and a private, missing,
  // filler or suspended project answers exactly like a page that does not exist.
  GET('/api/building/thumb/:floor/:project', async ({ res, p }) => {
    const f = floorBySlug(p.floor);
    if (f.status !== 'active' || f.filler) throw new HttpError(404, 'not_found');
    const pr = /^[a-z0-9][a-z0-9-]{0,59}$/.test(p.project) ? get(db, 'SELECT slug, title, kind, private, published_at FROM projects WHERE floor_id=? AND slug=?', f.id, p.project) : null;
    if (!pr || pr.private || !pr.published_at) throw new HttpError(404, 'not_found');
    const colors = JSON.parse(f.colors);
    const initial = (String(pr.title).trim()[0] || '?').toUpperCase();
    const title = String(pr.title).length > 34 ? `${String(pr.title).slice(0, 33)}…` : String(pr.title);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300" viewBox="0 0 480 300" role="img" aria-label="${esc(pr.title)}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${esc(colors.primary)}"/><stop offset="1" stop-color="${esc(colors.accent)}"/></linearGradient></defs>
<rect width="480" height="300" fill="#1a2230"/>
<rect width="480" height="168" fill="url(#g)"/>
<circle cx="404" cy="84" r="52" fill="rgba(255,255,255,.16)"/>
<text x="404" y="106" text-anchor="middle" font-family="Georgia,'Iowan Old Style',serif" font-size="64" fill="#fff" fill-opacity=".92">${esc(initial)}</text>
<text x="34" y="62" font-family="ui-monospace,Menlo,monospace" font-size="13" letter-spacing="2" fill="rgba(255,255,255,.78)">${esc(`FLOOR ${f.number} · ${f.name.toUpperCase()}`)}</text>
<text x="34" y="226" font-family="Georgia,'Iowan Old Style',serif" font-size="28" fill="#f7f1e7">${esc(title)}</text>
<text x="34" y="262" font-family="ui-monospace,Menlo,monospace" font-size="13" letter-spacing="2" fill="rgba(247,241,231,.55)">${esc(`${GLYPH[pr.kind] || '◆'}  ${(KIND_WORD[pr.kind] || pr.kind).toUpperCase()}`)}</text>
</svg>`;
    send(res, 200, svg, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'public, max-age=300' });
  });

  return null;
}
