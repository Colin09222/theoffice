// A bit of building life: hidden floors, launch parties, the leaderboard. Public information only, like the ticker.
// A hidden floor is set from the admin CLI. Only its own boss is told, and it drops out of everything here.
import { all } from './db.js';

// A party is the lobby's moment for one launch, so they are kept rare: one at a time in the building,
// one per floor every ten minutes, and one per project every six hours. A party is only news for two minutes.
export const PARTY = { GAP_MS: 60_000, FLOOR_MS: 10 * 60_000, PROJECT_MS: 6 * 3600_000, FRESH_MS: 120_000 };
const BOARD = 5;
const BOARD_TTL_MS = 30_000;
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Which launches get a party, oldest first, given the public launch lines. Pure, so it can be tested on its own. */
export function pickParties(launches, rules = PARTY) {
  const out = []; let last = -Infinity;
  const floorAt = new Map(), projectAt = new Map();
  for (const l of [...launches].sort((a, b) => a.id - b.id)) {
    const pk = `${l.floor.slug}/${l.url}`;
    if (l.ts - last < rules.GAP_MS) continue;
    if (l.ts - (floorAt.get(l.floor.slug) ?? -Infinity) < rules.FLOOR_MS) continue;
    if (l.ts - (projectAt.get(pk) ?? -Infinity) < rules.PROJECT_MS) continue;
    last = l.ts; floorAt.set(l.floor.slug, l.ts); projectAt.set(pk, l.ts);
    out.push(l);
  }
  return out;
}

export function installLife(ext) {
  const { db, hooks, GET, json, now, engine } = ext;
  // Whether a floor is hidden is between the building manager and that floor's boss.
  hooks.snapshot.push((f, viewer, out) => { if (viewer.owner && f.hidden) out.floor.hidden = true; });
  hooks.adminFloor.push((f, row) => { if (f.hidden) row.hidden = true; });

  // ---- launch parties ----
  // Picked from the ticker's own launch lines, which have already been checked for private projects, hidden and suspended floors.
  GET('/api/building/party', async ({ res }) => {
    const launches = (ext.tickerItems?.() || []).filter((i) => i.kind === 'published' && !i.filler && i.url);
    const party = pickParties(launches).at(-1);
    const t = now();
    const live = party && t - party.ts < PARTY.FRESH_MS && party.ts <= t + 5000;
    json(res, 200, { party: live ? { id: party.id, ts: party.ts, floor: party.floor, text: party.text, url: party.url } : null, ts: t });
  });

  // ---- the leaderboard ----
  // Counted from the first-party visitor stats every published project already keeps. Public projects on open floors only.
  let board = { at: -Infinity, data: null };
  const boardData = () => {
    const from = dayOf(now() - 29 * 86400000);
    const rows = all(db, `SELECT p.slug, p.title, p.kind, p.published_at, f.id fid, f.number, f.slug fslug, f.name fname, f.colors,
        COALESCE((SELECT SUM(v.views) FROM app_visits v WHERE v.floor_id = p.floor_id AND v.project = p.slug AND v.day >= ?), 0) views,
        COALESCE((SELECT SUM(v.uniques) FROM app_visits v WHERE v.floor_id = p.floor_id AND v.project = p.slug AND v.day >= ?), 0) uniques
      FROM projects p JOIN floors f ON f.id = p.floor_id
      WHERE p.published_at IS NOT NULL AND p.private = 0 AND f.status = 'active' AND f.filler = 0 AND f.hidden = 0`, from, from);
    const card = (r, count) => ({ _key: `${r.fid}/${r.slug}`, floor: { number: r.number, slug: r.fslug, name: r.fname, colors: JSON.parse(r.colors) }, slug: r.slug, title: r.title, kind: r.kind, url: engine.liveUrl({ id: r.fid, slug: r.fslug }, r.slug), count, publishedAt: r.published_at });
    const top = (list, by) => list.filter((r) => r[by] > 0).sort((a, b) => b[by] - a[by] || b.published_at - a.published_at).slice(0, BOARD).map((r) => card(r, r[by]));
    return {
      games: top(rows.filter((r) => r.kind === 'game'), 'views'),
      sites: top(rows.filter((r) => r.kind === 'site' || r.kind === 'app'), 'uniques'),
      newest: [...rows].sort((a, b) => b.published_at - a.published_at || a.slug.localeCompare(b.slug)).slice(0, BOARD).map((r) => card(r, null)),
    };
  };
  GET('/api/building/leaderboard', async ({ res }) => {
    const t = now();
    if (!board.data || t - board.at > BOARD_TTL_MS || t < board.at) board = { at: t, data: boardData() };
    // Re-checked on every reply, like the ticker: a project made private or a floor hidden since the count drops out at once.
    const open = new Set(all(db, `SELECT p.floor_id || '/' || p.slug k FROM projects p JOIN floors f ON f.id = p.floor_id
      WHERE p.published_at IS NOT NULL AND p.private = 0 AND f.status = 'active' AND f.filler = 0 AND f.hidden = 0`).map((r) => r.k));
    const keep = (list) => list.filter((c) => open.has(c._key)).map(({ _key, ...c }) => c);
    json(res, 200, { games: keep(board.data.games), sites: keep(board.data.sites), newest: keep(board.data.newest), ts: t });
  });
  return null;
}
