// buddehbot's heartbeat (round 2, r2-j53; docs/redesign/OFFICE-ANSWERS-2.md, Q19 and section 3 "States"). This reuses the Mac heartbeat that
// already exists: a LaunchAgent on the Mac pushes one line every 5 minutes to the server's /var/lib/macbeat/last, like
//   recv_ts=<unix s> v=1 mac_ts=<unix s> gw=ok disk_gb=48 pc=ok
// docker-compose.yml mounts that directory read-only at /run/macbeat; MACBEAT_FILE (default /run/macbeat/last) names the file. Only recv_ts is
// read: the other fields are never parsed, stored or shown. Fresh = recv_ts within the last 15 minutes. A missing or unreadable file, or a line
// without recv_ts, is not fresh (Away), and never an error. No Mac script is added and nothing here calls a model or sends anything anywhere.
import { readFileSync } from 'node:fs';

export const FRESH_MS = 15 * 60000;
export const DEFAULT_FILE = '/run/macbeat/last';
/** The time the server received the Mac's last heartbeat, in ms, or null. */
export function readBeat(file = DEFAULT_FILE) {
  try {
    const m = readFileSync(file, 'utf8').slice(0, 512).match(/(?:^|\s)recv_ts=(\d{9,11})(?=\s|$)/);
    return m ? Number(m[1]) * 1000 : null;
  } catch { return null; }
}
/** Fresh: received in the last 15 minutes (and not from the future by more than a minute's clock drift). */
export const beatFresh = (ts, now = Date.now()) => ts !== null && ts !== undefined && now - ts <= FRESH_MS && ts - now <= 60000;
/** A reader that looks at the file at most every 10 s. */
export function beatReader(file = DEFAULT_FILE, { every = 10000 } = {}) {
  let at = -Infinity, ts = null;
  return (now = Date.now()) => { if (now - at >= every) { at = now; ts = readBeat(file); } return beatFresh(ts, now); };
}
