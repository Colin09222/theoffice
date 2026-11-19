// The building as a whole: the lobby ticker and the launched wall, public information only. See docs/DEPLOY-PLUS.md.
// Everything here is what a visitor with no cookie may see: it goes through the same viewEvent rules as a floor's
// visitor stream, and private projects are checked again against the projects table at the moment of each reply.
import { get, all } from './db.js';
import { esc } from '../public/js/markdown.js';
import { mimeOf } from './workspace.js';
import { launches, heroLaunches, heroShots } from './shots.js';
import { publicCard, floorHistory, NOW_HORIZON_MS } from './jobcards.js';

const TICKER_TTL_MS = 5000;
const TICKER_SCAN = 150;
const MAX_TICKER = 60;
const MAX_WALL = 120;
const PINNED_LAUNCHES = 3;
const NOW_LINES = 5;
// Happening now (docs/redesign/OFFICE-ANSWERS-1.md, Q3 and section 4; job 30). An old feed line counts only when it says a piece of work moved:
// something started, finished, handed over, checked or put live. Everything else is a status ping ("picked the next job to work on",
// "looked over the day's work", a round report, a retry, the floor pausing) and never fills the strip.
const REAL_WORK = [
  /^started "/, /^finished "/, /^could not finish "/, /^published \S/, /^gave .+ a task: "/, /^approved "/, /^sent ".+" back to /,
  /^changed the brief for "/, /^handed ".+" to the building's outside contractor$/, /^drafted the legal pages for /, /^put up the approved legal pages for /,
  /^flagged .+ for a real lawyer$/, /^Bought \S+\.$/, /^\S+ now points at \S+\.$/,
];
/** Whether a feed line (without the person's name in front) says that real work happened. */
export const isRealWork = (text) => REAL_WORK.some((re) => re.test(String(text || '').trim()));
const GLYPH = { site: '◆', app: '▣', game: '▲', simulation: '◎', doc: '≡', research: '☍' };
const KIND_WORD = { site: 'Site', app: 'App', game: 'Game', simulation: 'Simulation', doc: 'Doc', research: 'Research' };

const num = (v, d, lo, hi) => { const n = Number.parseInt(String(v ?? ''), 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const floorInfo = (f) => ({ number: f.number, slug: f.slug, name: f.name, colors: JSON.parse(f.colors) });
const key = (floorId, slug) => `${floorId}/${slug}`;

export function installBuilding(ext) {
  const { db, cfg = {}, engine, now, GET, json, send, floorBySlug, HttpError, BASE, PRIVATE_TEXT, viewEvent } = ext;
  const privateLine = PRIVATE_TEXT.toLowerCase();

  // ---- the stack ----
  // Everyone in the building, floor by floor, for the stacked cutaway in the lobby: name, look and whether they're at it. All of it
  // is on each floor's own page already. Hidden floors and closed ones stay out.
  GET('/api/building/staff', async ({ res }) => {
    const rows = all(db, `SELECT f.number, a.name, a.role, a.look, a.state FROM agents a JOIN floors f ON f.id = a.floor_id
      WHERE f.status = 'active' AND f.hidden = 0 AND (f.filler = 0 OR ?) ORDER BY f.number DESC, a.id`, cfg.demoFloorsPublic ? 1 : 0);
    const floors = {};
    for (const r of rows) {
      let look = null; try { look = JSON.parse(r.look); } catch { /* a drawn face in the defaults */ }
      (floors[r.number] ||= []).push({ name: r.name, role: r.role, look, busy: r.state !== 'idle' });
    }
    json(res, 200, { floors, ts: now() });
  });

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
        out.push({ ...base, kind: 'feed', text: `${who}${text}`, _work: text, _agent: v.data.agent ?? null });
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
      // Real work only: a demo floor's scripted lines never reach the strip (DEMO_FLOORS_PUBLIC=1 lets them back).
      if (f.filler && !cfg.demoFloorsPublic) continue;
      if (it._project && priv.has(key(it._floorId, it._project))) continue;
      if (!it._project && f.default_private && it.kind === 'feed' && it._agent !== null) continue;
      const { _floorId, _project, _agent, _work, ...pub } = it;
      out.push({ ...pub, ...(it.kind === 'feed' ? { work: _work } : {}), filler: !!f.filler });
    }
    return out;
  }
  // Launch parties (server/life.js) are picked from the same checked lines.
  ext.tickerItems = tickerItems;
  GET('/api/building/ticker', async ({ res, url }) => {
    const limit = num(url.searchParams.get('limit'), 40, 1, MAX_TICKER);
    const since = num(url.searchParams.get('since'), 0, 0, Number.MAX_SAFE_INTEGER);
    const fresh = tickerItems().filter((i) => i.id > since).map(({ work, ...pub }) => pub);
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

  // ---- Happening now ----
  // What the home page's strip shows: the newest real work in the building, one line per job, newest first, five at most. A job's line is
  // its job card (job 12), so a job that moves on changes its line rather than adding one. A launch is a line of its own. Old feed lines fill
  // in only for a floor with no job card in the window, and only when they are real work (isRealWork). Nothing older than a day counts, and
  // the same words from the same floor never show twice. With nothing left, the strip says when the last job really finished.
  function happeningNow({ limit = NOW_LINES } = {}) {
    const t = now(), since = t - NOW_HORIZON_MS;
    const floors = all(db, "SELECT id, number, slug, name, colors, default_private, filler FROM floors WHERE status='active' AND hidden=0 AND (filler=0 OR ?)", cfg.demoFloorsPublic ? 1 : 0);
    const byId = new Map(floors.map((f) => [f.id, f]));
    const priv = new Set(all(db, 'SELECT floor_id, slug FROM projects WHERE private=1').map((p) => key(p.floor_id, p.slug)));
    const isPrivate = (f, project) => (project ? priv.has(key(f.id, project)) : !!f.default_private);
    const lines = [];
    const withCards = new Set();
    for (const r of all(db, "SELECT * FROM job_cards WHERE updated_at >= ? AND state != 'cancelled' ORDER BY updated_at DESC, id DESC LIMIT 200", since)) {
      const f = byId.get(r.floor_id);
      if (!f) continue;
      withCards.add(f.id);
      if (isPrivate(f, r.project)) continue;
      const c = publicCard(db, f, r, BASE);
      lines.push({ id: `job:${r.id}`, kind: 'job', state: c.state, text: c.line, ts: r.updated_at, floor: floorInfo(f) });
    }
    for (const it of tickerItems()) {
      if (it.ts < since) continue;
      const f = floors.find((x) => x.slug === it.floor.slug);
      if (!f) continue;
      if (it.kind === 'published') lines.push({ id: `launch:${it.id}`, kind: 'published', text: it.text, url: it.url, ts: it.ts, floor: it.floor });
      else if (!withCards.has(f.id) && isRealWork(it.work)) lines.push({ id: `feed:${it.id}`, kind: 'feed', text: it.text, ts: it.ts, floor: it.floor });
    }
    lines.sort((a, b) => b.ts - a.ts);
    const seen = new Set(); const items = [];
    for (const l of lines) {
      const k = `${l.floor.slug}|${l.text.trim().toLowerCase()}`;
      if (seen.has(k)) continue;
      seen.add(k); items.push(l);
      if (items.length >= limit) break;
    }
    // When the last job really finished, from the same rows as a floor's own empty states (jobcards.js floorHistory, job 32): a finished job
    // card or task, or a launch. Pings never move it.
    const lastFinished = floors.reduce((m, f) => Math.max(m, floorHistory(db, f).lastFinished || 0), 0) || null;
    return { items, lastFinished };
  }
  ext.happeningNow = happeningNow;
  GET('/api/building/now', async ({ res }) => {
    json(res, 200, { ...happeningNow(), ts: now() });
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
  // Each card: the real screenshot when there is one (server/shots.js), else the project's og:image, else the coloured initial card.
  // Public numbers are visits and plays only (Q6): unique visitors over the last 7 days, as the Numbers tab counts them.
  const launchCard = (r) => {
    const f = { id: r.fid, number: r.number, slug: r.fslug, name: r.fname, colors: r.colors };
    const liveUrl = engine.liveUrl(f, r.slug);
    const thumb = r.shot_at ? `${BASE}/api/building/shot/${f.slug}/${r.slug}?v=${r.shot_at}` : thumbFor(f, { slug: r.slug, published_at: r.published_at }, liveUrl);
    return { floor: floorInfo(f), slug: r.slug, title: r.title, description: r.description, kind: r.kind, publishedAt: r.published_at, url: liveUrl, thumb, shot: !!r.shot_at, visits: r.visits, wip: r.wip, madeDays: r.madeDays, lane: r.lane };
  };
  GET('/api/building/launched', async ({ res, url }) => {
    const limit = num(url.searchParams.get('limit'), 60, 1, MAX_WALL);
    // ?floor=<slug>: one floor's portfolio (docs/redesign, job 24). A floor that is not on show (hidden, suspended, a demo) has nothing to list.
    const slug = url.searchParams.get('floor');
    const f = slug && /^[a-z0-9-]{1,80}$/.test(slug) ? get(db, 'SELECT id FROM floors WHERE slug=?', slug) : null;
    if (slug && !f) return json(res, 200, { projects: [], ts: now() });
    const projects = launches(db, { now: now(), floorId: f?.id ?? null }).slice(0, limit).map(launchCard);
    json(res, 200, { projects, ts: now() });
  });
  // The link preview for the Launched page and a floor's portfolio: a title, a line, and the best launch's real screenshot (a JPEG; a drawn
  // card is SVG, which chat apps don't show, so then there is no image). Nothing private, no money, no demo floor.
  ext.shareMeta = (floorSlug, req) => {
    const origin = (ext.cfg?.publicOrigin || `http://${String(req.headers.host || 'localhost').replace(/[^a-zA-Z0-9.:[\]-]/g, '')}`).replace(/\/+$/, '');
    let title = 'Launched in The Office', line = 'Real things made by small AI teams, one floor each.', list, page = `${origin}${BASE}/launched`;
    if (floorSlug) {
      const f = get(db, 'SELECT id, slug, name, number, status, hidden, filler FROM floors WHERE slug=?', floorSlug);
      if (!f || f.status !== 'active' || f.hidden || (f.filler && !ext.cfg?.demoFloorsPublic)) return null;
      list = launches(db, { now: now(), floorId: f.id });
      title = `${f.name || `Floor ${f.number}`}: launched in The Office`;
      line = list.length ? `${list.filter((l) => !l.wip).length} launched on floor ${f.number}, made by its AI team.` : `Floor ${f.number} of The Office. Nothing launched yet.`;
      page = `${origin}${BASE}/launched/${f.slug}`;
    } else list = launches(db, { now: now() });
    const best = [...list].filter((l) => !l.wip).sort((a, b) => b.visits - a.visits || b.published_at - a.published_at).find((l) => l.shot_at);
    const image = best ? `${origin}${BASE}/api/building/shot/${best.fslug}/${best.slug}?v=${best.shot_at}` : '';
    const tag = (k, v, attr = 'property') => `<meta ${attr}="${k}" content="${esc(v)}">`;
    const tags = [tag('og:type', 'website'), tag('og:title', title), tag('og:description', line), tag('og:url', page), tag('og:site_name', 'The Office'),
      ...(image ? [tag('og:image', image), tag('og:image:width', '640'), tag('og:image:height', '400'), tag('twitter:card', 'summary_large_image', 'name'), tag('twitter:image', image, 'name')] : [tag('twitter:card', 'summary', 'name')]),
      tag('twitter:title', title, 'name'), tag('description', line, 'name')].join('\n');
    return { title, tags };
  };
  // The home hero: the 3 best launches (Q3). Never work in progress, never a demo floor.
  GET('/api/building/hero', async ({ res }) => {
    // Each hero card also carries up to 3 real screenshots to fade between (round 2, r2-j33). HERO_FADE=0 sends none, and the card stands still.
    json(res, 200, { projects: heroLaunches(db, { now: now() }).map((r) => ({ ...launchCard(r), shots: cfg.heroFade === false ? [] : heroShots(db, r, BASE) })), ts: now() });
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
