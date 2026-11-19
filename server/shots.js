// Real launch cards (docs/redesign/OFFICE-ANSWERS-1.md, Q3, Q6, section 3 "Launch card", section 4 "Launched"). Tier 0: a script, never a model.
// Each launched project's live page is photographed at 16:10 (server/shooter.js), kept with the project as a small JPEG, and taken again every
// 7 days by a server timer. The Launched wall shows the photo on every card; the home hero shows the 3 best: the most real visits or plays in
// the last 7 days, ties to the newest, never work in progress, never a demo floor. A launch with no photo yet keeps the coloured initial card.
//
// Where it runs: a server timer (SHOTS_EVERY_MS, default hourly, a no-op unless a page is due) when the server can reach a running Chromium with
// remote debugging on at SHOTS_CDP_URL (the server never starts a process itself). Without one, the same work is done by
// `node scripts/launch-shots.mjs`, run where a browser is (the office-runner/browser image): see the command in the script's header.
// SHOTS=0 turns the timer off.
import { get, all, run } from './db.js';
import { appOrigin, appLabel } from './apps.js';
import { publicUrl } from './tools.js';
import { makeShooter } from './shooter.js';

export const REFRESH_MS = 7 * 86400000;
const RETRY_MS = 6 * 3600000;       // a page that failed is tried again after this
const MAX_BYTES = 400 * 1024;       // a card photo is well under this; anything bigger is refused
const HERO = 3;
const DAY = 86400000;
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/** The public live address of a project, the way engine.liveUrl gives it: its own domain, its own origin, or the office path. */
export function liveUrlOf(db, cfg, floor, slug) {
  const domain = get(db, "SELECT domain FROM domain_orders WHERE floor_id=? AND project=? AND status='live' ORDER BY id DESC LIMIT 1", floor.id, slug)?.domain;
  if (domain) return `https://${domain}/`;
  if (cfg.appsBaseDomain) return `${appOrigin(cfg, appLabel(db, floor, slug))}/`;
  return publicUrl(floor.slug, slug);
}

/**
 * Every public launch in the building, newest first: published, not private, on an active, listed floor that is not a demo.
 * `wip` marks one still being worked on and not launched by the boss (a maker job or a business journey for it, not yet launched).
 * `visits` is the Numbers tab's own count (unique visitors a day, bots left out), summed over the last 7 days.
 */
export function launches(db, { now = Date.now(), floorId = null } = {}) {
  const from = dayOf(now - 6 * DAY);
  const rows = all(db, `SELECT p.floor_id, p.slug, p.title, p.description, p.kind, p.published_at, p.created_at,
      f.id fid, f.number, f.slug fslug, f.name fname, f.colors,
      COALESCE((SELECT SUM(v.uniques) FROM app_visits v WHERE v.floor_id = p.floor_id AND v.project = p.slug AND v.day >= ?), 0) visits,
      s.taken_at shot_at, s.bytes shot_bytes
    FROM projects p JOIN floors f ON f.id = p.floor_id LEFT JOIN launch_shots s ON s.floor_id = p.floor_id AND s.project = p.slug AND s.image IS NOT NULL
    WHERE p.published_at IS NOT NULL AND p.private = 0 AND f.status = 'active' AND f.filler = 0 AND f.hidden = 0 ${floorId ? 'AND f.id = ?' : ''}
    ORDER BY p.published_at DESC, p.slug`, from, ...(floorId ? [floorId] : []));
  const wip = wipSet(db);
  return rows.map((r) => ({ ...r, wip: wip.has(`${r.floor_id}/${r.slug}`), madeDays: Math.max(1, Math.round((r.published_at - r.created_at) / DAY)) }));
}
/** Projects still being worked on: a maker job not launched and not stopped, or a business journey under way and not launched. */
function wipSet(db) {
  const out = new Set();
  const has = (t) => !!get(db, "SELECT 1 x FROM sqlite_master WHERE type='table' AND name=?", t);
  if (has('maker_jobs')) for (const r of all(db, "SELECT floor_id, project FROM maker_jobs WHERE launched_at IS NULL AND stage != 'stopped'")) out.add(`${r.floor_id}/${r.project}`);
  if (has('business_journeys')) for (const r of all(db, "SELECT floor_id, project FROM business_journeys WHERE status = 'active' AND launched_at IS NULL AND project != ''")) out.add(`${r.floor_id}/${r.project}`);
  return out;
}
/** The home hero: the 3 best launches, most real visits or plays in 7 days, ties to the newest. Never work in progress, never a demo floor. */
export function heroLaunches(db, opts = {}) {
  return launches(db, opts).filter((l) => !l.wip).sort((a, b) => b.visits - a.visits || b.published_at - a.published_at || a.slug.localeCompare(b.slug)).slice(0, HERO);
}

/** Launches whose photo is missing or older than 7 days (a failure waits 6 hours before another try). `force` takes every one. */
export function dueShots(db, { now = Date.now(), force = false } = {}) {
  return launches(db, { now }).filter((l) => {
    if (force) return true;
    const s = get(db, 'SELECT taken_at, failed_at FROM launch_shots WHERE floor_id=? AND project=?', l.floor_id, l.slug);
    if (s?.failed_at && now - s.failed_at < RETRY_MS) return false;
    return !s?.taken_at || now - s.taken_at >= REFRESH_MS;
  });
}
export function storeShot(db, { floorId, project, image, url, now = Date.now() }) {
  if (!Buffer.isBuffer(image) || image.length < 200 || image.length > MAX_BYTES || image[0] !== 0xff || image[1] !== 0xd8) throw new Error('not a card-sized JPEG');
  run(db, `INSERT INTO launch_shots (floor_id, project, image, type, bytes, url, taken_at, failed_at, error) VALUES (?,?,?,'image/jpeg',?,?,?,NULL,'')
    ON CONFLICT(floor_id, project) DO UPDATE SET image=excluded.image, type=excluded.type, bytes=excluded.bytes, url=excluded.url, taken_at=excluded.taken_at, failed_at=NULL, error=''`, floorId, project, image, image.length, url, now);
}
function failShot(db, { floorId, project, url, error, now }) {
  run(db, `INSERT INTO launch_shots (floor_id, project, image, type, bytes, url, taken_at, failed_at, error) VALUES (?,?,NULL,'image/jpeg',0,?,NULL,?,?)
    ON CONFLICT(floor_id, project) DO UPDATE SET failed_at=excluded.failed_at, error=excluded.error, url=excluded.url`, floorId, project, url, now, String(error).slice(0, 200));
}
export const shotOf = (db, floorId, project) => get(db, 'SELECT image, type, taken_at FROM launch_shots WHERE floor_id=? AND project=? AND image IS NOT NULL', floorId, project);

/**
 * Photograph what is due. `origin` turns an office path (/theoffice/f/...) into a full address. Returns { taken, failed, skipped }.
 * One page at a time, so a 2-vCPU box never runs two browsers' worth of pages at once.
 */
export async function takeDue(db, cfg, { shooter, origin = '', now = () => Date.now(), force = false, limit = 30, log = () => {} } = {}) {
  const out = { taken: [], failed: [], skipped: 0 };
  const due = dueShots(db, { now: now(), force });
  for (const l of due.slice(0, limit)) {
    const floor = { id: l.floor_id, slug: l.fslug };
    let url = liveUrlOf(db, cfg, floor, l.slug);
    if (url.startsWith('/')) url = `${origin}${url}`;
    try {
      const image = await shooter.shoot(url);
      storeShot(db, { floorId: l.floor_id, project: l.slug, image, url, now: now() });
      out.taken.push({ floor: l.number, project: l.slug, bytes: image.length });
    } catch (e) {
      failShot(db, { floorId: l.floor_id, project: l.slug, url, error: e?.message || e, now: now() });
      out.failed.push({ floor: l.number, project: l.slug, error: String(e?.message || e).slice(0, 120) });
      log('warn', 'launch shot failed', { floor: l.number, project: l.slug });
    }
  }
  out.skipped = Math.max(0, due.length - limit);
  return out;
}

// ---- a photo per job step (job 13): the timeline's thumbnails ----
// One photo per step at most, four per job, of the project's public page once it is up. The same camera, the same timer, no model.
export const MAX_JOB_SHOTS = 4;
/** Ask for a photo of a job's step. Only a public project that is published has a page to photograph. Returns true when one was queued. */
export function queueJobShot(db, { floorId, cardId, step, project, now = Date.now() }) {
  if (!project || !cardId) return false;
  const pr = get(db, 'SELECT private, published_at FROM projects WHERE floor_id=? AND slug=?', floorId, project);
  if (!pr || pr.private || !pr.published_at) return false;
  if (get(db, 'SELECT COUNT(*) n FROM job_shots WHERE card_id=?', cardId).n >= MAX_JOB_SHOTS) return false;
  return run(db, 'INSERT OR IGNORE INTO job_shots (floor_id, card_id, step, project, created_at) VALUES (?,?,?,?,?)', floorId, cardId, String(step), project, now).changes > 0;
}
const pendingJobShots = (db, now) => all(db, 'SELECT * FROM job_shots WHERE taken_at IS NULL AND tries < 2 AND (failed_at IS NULL OR ? - failed_at > 600000) ORDER BY id LIMIT 20', now);
/** Take the queued step photos. Each one taken becomes its job card's thumbnail. Returns the cards that changed. */
export async function takeJobShots(db, cfg, { shooter, origin = '', now = () => Date.now(), log = () => {} } = {}) {
  const changed = [];
  for (const j of pendingJobShots(db, now())) {
    const floor = get(db, 'SELECT id, slug FROM floors WHERE id=?', j.floor_id);
    if (!floor) continue;
    let url = liveUrlOf(db, cfg, floor, j.project);
    if (url.startsWith('/')) url = `${origin}${url}`;
    try {
      const image = await shooter.shoot(url);
      if (!Buffer.isBuffer(image) || image.length > MAX_BYTES || image[0] !== 0xff || image[1] !== 0xd8) throw new Error('not a card-sized JPEG');
      run(db, 'UPDATE job_shots SET image=?, bytes=?, url=?, taken_at=?, failed_at=NULL, tries=tries+1 WHERE id=?', image, image.length, url, now(), j.id);
      run(db, 'UPDATE job_cards SET thumb=? WHERE id=?', String(j.id), j.card_id);
      changed.push(j.card_id);
    } catch (e) {
      run(db, 'UPDATE job_shots SET failed_at=?, tries=tries+1 WHERE id=?', now(), j.id);
      log('warn', 'job step shot failed', { floorId: j.floor_id, project: j.project });
    }
  }
  return changed;
}

export function installShots(ext) {
  const { db, cfg, log, now, GET, send, floorBySlug, HttpError } = ext;
  // The photo itself: public, but only for a project that is on the wall right now. Anything else answers like a page that isn't there.
  GET('/api/building/shot/:floor/:project', async ({ res, p }) => {
    const f = floorBySlug(p.floor);
    if (f.status !== 'active' || f.filler || f.hidden) throw new HttpError(404, 'not_found');
    const pr = /^[a-z0-9][a-z0-9-]{0,59}$/.test(p.project) ? get(db, 'SELECT slug, private, published_at FROM projects WHERE floor_id=? AND slug=?', f.id, p.project) : null;
    const shot = pr && !pr.private && pr.published_at ? shotOf(db, f.id, pr.slug) : null;
    if (!shot) throw new HttpError(404, 'not_found');
    send(res, 200, Buffer.from(shot.image), { 'content-type': shot.type, 'cache-control': 'public, max-age=86400' });
  });

  let timer = null, busy = false, noBrowser = false;
  async function tick() {
    if (busy || cfg.shots === false) return;
    if (!dueShots(db, { now: now() }).length && !pendingJobShots(db, now()).length) return;
    busy = true;
    let shooter = null;
    try {
      shooter = await makeShooter({ cdpUrl: cfg.shotsCdpUrl || '' });
      if (!shooter) { if (!noBrowser) log('info', 'launch shots: no browser reachable (SHOTS_CDP_URL); run scripts/launch-shots.mjs where there is one'); noBrowser = true; return; }
      noBrowser = false;
      const origin = cfg.shotsOrigin || `http://127.0.0.1:${cfg.port}`;
      // Step photos first: they are what someone watching the floor is waiting for.
      for (const cardId of await takeJobShots(db, cfg, { shooter, origin, now, log })) ext.cardChanged?.(cardId);
      const r = await takeDue(db, cfg, { shooter, origin, now, log });
      if (r.taken.length || r.failed.length) log('info', 'launch shots', { taken: r.taken.length, failed: r.failed.length });
    } catch (e) { log('warn', 'launch shots', { err: String(e?.message || e).slice(0, 160) }); } finally { shooter?.close(); busy = false; }
  }
  // A step photo was asked for: take it in a few seconds rather than at the next hourly look.
  let nudgeTimer = null;
  ext.shotsNudge = () => { if (cfg.shots === false) return; clearTimeout(nudgeTimer); nudgeTimer = setTimeout(() => { tick(); }, cfg.shotsNudgeMs ?? 3000); nudgeTimer.unref?.(); };
  return {
    tick,
    start() { if (cfg.shots === false) return; timer = setInterval(() => { tick(); }, cfg.shotsEveryMs || 3600000); timer.unref?.(); },
    stop() { clearInterval(timer); clearTimeout(nudgeTimer); },
  };
}
