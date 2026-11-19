// "Not allowed", logged (docs/redesign/OFFICE-ANSWERS-1.md, section 4 "Floor (boss)"; job 8). Every 403 or 423 a signed-in boss or the admin gets is kept
// with who they are, which floor, what they tried and when, so the next "not allowed" can be traced instead of guessed at. Cailyn on floor 7 hit one after
// a pause and the cause was never found. No secret is kept: the session's cookie and CSRF token never reach this table, only a short hash prefix.
import { get, all, run } from './db.js';

/** One refusal. `user` is 'boss of floor N (session abcd1234)' or 'admin'; `action` is the method and route, or a tool's name. */
export function logDenied(db, { user, floorId = null, action, status, code = '', at = Date.now() }) {
  run(db, 'INSERT INTO denied_requests (user,floor_id,action,status,code,created_at) VALUES (?,?,?,?,?,?)', String(user).slice(0, 120), floorId, String(action).slice(0, 200), status, String(code).slice(0, 40), at);
  // A runaway client can't fill the disk: the oldest go past 5,000 rows.
  run(db, 'DELETE FROM denied_requests WHERE id <= (SELECT MAX(id) FROM denied_requests) - 5000');
}

export function deniedListing(db, { since = 0, limit = 500 } = {}) {
  return all(db, 'SELECT d.*, f.number FROM denied_requests d LEFT JOIN floors f ON f.id=d.floor_id WHERE d.created_at>=? ORDER BY d.id DESC LIMIT ?', since, limit)
    .map((d) => ({ at: new Date(d.created_at).toISOString(), user: d.user, floorNumber: d.number ?? null, action: d.action, status: d.status, code: d.code }));
}
export function deniedListingText(rows) {
  if (!rows.length) return 'Nobody signed in was refused.';
  return rows.map((d) => `${d.at}  ${d.status} ${d.code || ''}  ${d.user}  floor ${d.floorNumber ?? '-'}  ${d.action}`).join('\n');
}
