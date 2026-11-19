// buddehbot's mailroom feed (round 2, r2-j49; docs/redesign/OFFICE-ANSWERS-2.md, section 3 "Data it reads" and Q22). One read-only address the
// mailroom display draws from. It READS records that already exist and changes nothing: no new path from a bot to buddehbot, nothing sent to the
// Mac, no tool, no prompt. Every item carries its record type and number; the page refuses to play anything without them (r2-j56).
//
// What exists today (checked in the code, r2-j49):
//   - Help requests: help_requests. id, floor, created_at; status pending -> answered | declined | expired; decided_at. No picked-up time.
//   - Purchase requests: purchases. id, floor, created_at; status pending -> bought | rejected (decided from the admin CLI, decided_at), or the
//     floor's boss withdraws it (declined, bought-myself). No "flagged to Colon" outcome and no Colon-approved time.
//   - Contractor jobs: contractor_jobs. id, floor, task_id, created_at (held), done_at (handed back), closed_at; status held -> done -> closed.
//     The task's sent_out_at is when Colon pressed Send out (job 19: the only way in). No picked-up time.
//   - Domain buying: the server's own broker (server/domains.js) buys after the boss's click; buddehbot takes no part, so it gets no folder.
// So no item is ever "picked up" today, and the robot can only be Busy once a record says so (none does): see DONE.md for r2-j49.
//
// The public feed carries only number, kind, floor, state and times. Item text, names and prices stay on the server (r2-j54 adds the boss's and
// Colon's fuller views). Hidden floors and demo floors are left out. MAILROOM=0 takes the address away.
import { all } from './db.js';
import { robotState, signFor, trayView } from '../public/js/mailroom-state.js';
import { beatReader } from './macbeat.js';

export const RECENT_MS = 15 * 60000;   // a closed item stays in the feed for 15 minutes, so the page can stamp it; then it is gone
export const KINDS = ['help', 'purchase', 'contractor'];
const TYPE = { help: 'help_requests', purchase: 'purchases', contractor: 'contractor_jobs' };

/** Every mailroom item that is open, or closed in the last 15 minutes, on a public floor. Oldest first. Only the office's own fields. */
export function mailroomItems(db, cfg = {}, { now = Date.now(), floorId = null, all: everyFloor = false } = {}) {
  const since = now - RECENT_MS;
  const floorOk = `f.status = 'active' AND (${everyFloor ? '1' : 'f.hidden = 0'}) AND (f.filler = 0 OR ${cfg.demoFloorsPublic ? 1 : 0}) ${floorId ? 'AND f.id = ' + Number(floorId) : ''}`;
  const out = [];
  for (const r of all(db, `SELECT r.id, r.floor_id, f.number, r.status, r.created_at, r.decided_at FROM help_requests r JOIN floors f ON f.id = r.floor_id
      WHERE ${floorOk} AND (r.status = 'pending' OR r.decided_at >= ?)`, since)) {
    out.push(item('help', r, { state: r.status === 'pending' ? 'open' : r.status, times: { created: r.created_at, pickedUp: null, closed: r.status === 'pending' ? null : r.decided_at } }));
  }
  for (const r of all(db, `SELECT r.id, r.floor_id, f.number, r.status, r.created_at, r.decided_at FROM purchases r JOIN floors f ON f.id = r.floor_id
      WHERE ${floorOk} AND (r.status = 'pending' OR (r.status IN ('bought', 'rejected') AND r.decided_at >= ?))`, since)) {
    out.push(item('purchase', r, { state: r.status === 'pending' ? 'open' : r.status === 'bought' ? 'bought' : 'declined', times: { created: r.created_at, pickedUp: null, closed: r.status === 'pending' ? null : r.decided_at } }));
  }
  for (const r of all(db, `SELECT j.id, j.floor_id, f.number, j.status, j.created_at, j.done_at, j.task_id, t.sent_out_at FROM contractor_jobs j JOIN floors f ON f.id = j.floor_id
      LEFT JOIN tasks t ON t.id = j.task_id WHERE ${floorOk} AND (j.status = 'held' OR (j.done_at IS NOT NULL AND j.done_at >= ?))`, since)) {
    out.push(item('contractor', r, { state: r.status === 'held' ? 'open' : 'done', task: r.task_id, times: { created: r.created_at, pickedUp: null, closed: r.status === 'held' ? null : r.done_at, sentOut: r.sent_out_at ?? null, handedBack: r.done_at ?? null } }));
  }
  return out.sort((a, b) => a.times.created - b.times.created || a.number - b.number);
}
function item(kind, r, extra) {
  return { kind, type: TYPE[kind], number: r.id, floor: r.number, _floorId: r.floor_id, ...extra };
}
/** What anyone may see of an item: the public fields only. */
export const publicItem = (i) => ({ kind: i.kind, type: i.type, number: i.number, floor: i.floor, state: i.state, times: { ...i.times } });

/** Counts by kind of the open items, for the robot's card. */
export function counts(items) {
  const c = { help: 0, purchase: 0, contractor: 0 };
  for (const i of items) if (i.state === 'open' || i.state === 'picked') c[i.kind]++;
  return c;
}

export function installMailroom(ext) {
  const { db, cfg, now, GET, json, HttpError } = ext;
  // The robot: its state (section 3's order), its sign and the tray. The freeze is the engine's own night freeze.
  // r2-j53: the heartbeat (only its time) decides Away; the night freeze decides Asleep, which comes first.
  const fresh = beatReader(cfg.macbeatFile);
  const robotOf = (items) => {
    const state = robotState({ freeze: ext.engine?.nightFrozen?.() ?? false, heartbeatFresh: fresh(now()), items });
    return { state, sign: signFor(state), tray: trayView(items) };
  };
  // One pigeonhole per open floor (public floors only).
  const openFloors = () => all(db, "SELECT number FROM floors WHERE status='active' AND hidden=0 AND (filler=0 OR ?) AND number <= ? ORDER BY number", cfg.demoFloorsPublic ? 1 : 0, cfg.towerFloors ?? 10).map((r) => r.number);
  GET('/api/mailroom', async ({ res }) => {
    if (cfg.mailroom === false) throw new HttpError(404, 'not_found');
    const items = mailroomItems(db, cfg, { now: now() });
    json(res, 200, { items: items.map(publicItem), counts: counts(items), robot: robotOf(items), floors: openFloors(), ts: now() });
  });
  return null;
}
