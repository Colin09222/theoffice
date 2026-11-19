// Round 2, lane A: small fixtures shared by the node tests and the browser checks.
import { readFileSync } from 'node:fs';
import { run } from '../server/db.js';

/** A real JPEG for a launch photo: a picture the browser check took of a room. */
export const REAL_JPEG = readFileSync(new URL('../docs/redesign/jobs/r2-j31/r2-j31-idle.jpg', import.meta.url));
/** A launched project, the way the launch flow leaves it. */
export function publish(db, floorId, slug, title, at, { priv = 0 } = {}) {
  run(db, 'INSERT INTO projects (floor_id,slug,title,kind,private,published_at,created_at) VALUES (?,?,?,?,?,?,?)', floorId, slug, title, 'site', priv, at, at - 86400000);
}
