// Fresh eyes (docs/redesign/OFFICE-ANSWERS-2.md, Q11 b; job r2-j59): after a Launch, one look from a different model, the review model the team
// already uses for design reviews (media.review.model, not the floor's own model and never Fable). It gets a desktop and a phone picture of the live
// page and the job's done-means lines, and gives one score, 1 to 5. The boss sees it; nobody else does. Under 3 makes exactly one fix job. There is
// never a second score for the same launch: the row is claimed before the call, so even two Launch taps at once make one call.
// FRESH_EYES=0 stops it. No budget rule: the call's cost goes on the ledger like any other.
import { get, all, run } from './db.js';
import { readChecks } from './brain.js';
import { makeShooter, PHONE_SHOT } from './shooter.js';

const short = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
/** The score on the reply's first line ("SCORE: 4"), or a lone 1 to 5 out of 5 anywhere; null when there is none. */
export function readScore(text) {
  const t = String(text || '');
  const m = t.match(/^\s*SCORE\s*[:=]\s*([1-5])\b/im) || t.match(/\b([1-5])\s*(?:\/|out of)\s*5\b/i);
  return m ? Number(m[1]) : null;
}
/** The done-means lines of the job that made this project: every check its tasks carried, once each, at most 12. */
export function doneMeansFor(db, floorId, project) {
  const out = [];
  for (const t of all(db, "SELECT checks FROM tasks WHERE floor_id=? AND project=? AND checks!='' ORDER BY id", floorId, project)) for (const l of readChecks(t)) if (!out.includes(l)) out.push(l);
  return out.slice(0, 12);
}
/** What the boss sees: the score and the notes for each launch, newest first. */
export const freshEyesView = (db, floorId) => all(db, 'SELECT project, launch_key launchKey, score, notes, model, created_at at, fix_task_id fixTask FROM fresh_eyes WHERE floor_id=? AND score IS NOT NULL ORDER BY id DESC LIMIT 10', floorId);

export function installFreshEyes(ext) {
  const { db, cfg, engine, now, log, hooks } = ext;
  /** The two pictures, desktop then phone, from the shots browser. A test passes its own `cfg.freshEyesShots`. */
  async function pictures(url) {
    if (cfg.freshEyesShots) return cfg.freshEyesShots(url);
    const shooter = await makeShooter({ cdpUrl: cfg.shotsCdpUrl || '' });
    if (!shooter) return null;
    try { return { desktop: await shooter.shoot(url), phone: await shooter.shoot(url, PHONE_SHOT) }; } finally { shooter.close(); }
  }
  /**
   * One review of one launch. `key` names the launch (the project and when it went live). Returns the row, or null when there was nothing to do.
   */
  async function review(floor, project, key) {
    if (cfg.freshEyes === false || !engine.media?.freshEyes) return null;
    // Claimed first: one launch, one row, one call, ever.
    if (!run(db, 'INSERT OR IGNORE INTO fresh_eyes (floor_id, project, launch_key, created_at) VALUES (?,?,?,?)', floor.id, project, key, now()).changes) return null;
    const row = () => get(db, 'SELECT * FROM fresh_eyes WHERE floor_id=? AND project=? AND launch_key=?', floor.id, project, key);
    const url = engine.liveUrl(floor, project);
    const abs = /^https?:/.test(url) ? url : `${cfg.shotsOrigin || cfg.publicOrigin || `http://127.0.0.1:${cfg.port}`}${url}`;
    let shots = null;
    try { shots = await pictures(abs); } catch (e) { log?.('warn', 'fresh eyes pictures', { err: short(e?.message, 160) }); }
    if (!shots?.desktop) { run(db, "UPDATE fresh_eyes SET notes='No pictures could be taken, so there was no review.' WHERE id=?", row().id); return row(); }
    const lines = doneMeansFor(db, floor.id, project);
    const mgr = get(db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", floor.id);
    let r;
    try { r = await engine.media.freshEyes({ desktop: shots.desktop, phone: shots.phone || null, lines }); } catch (e) {
      run(db, 'UPDATE fresh_eyes SET notes=? WHERE id=?', `The review did not come back: ${short(e?.message, 120)}`, row().id); return row();
    }
    const model = r.model || engine.media.review?.model || '';
    if (mgr) engine.charge(floor.id, mgr, model, r.usage?.prompt || 0, r.usage?.completion || 0, r.usage?.cost || 0, { kind: 'review', provider: 'openrouter' });
    const score = readScore(r.text);
    const notes = short(String(r.text).replace(/^\s*SCORE\s*[:=]\s*\d\s*/i, ''), 1500);
    run(db, 'UPDATE fresh_eyes SET score=?, notes=?, model=? WHERE id=?', score, notes, model, row().id);
    // Under 3: one fix job, for the Builder, with the review as its brief. Only ever one, because only ever one score.
    if (score !== null && score < 3 && mgr) {
      try {
        const t = engine.assignTask(floor, mgr, { to: 'builder', plan: '', dependsOn: [], title: `Fix what a fresh look found on ${project}`.slice(0, 120), brief: `A reviewer who had never seen ${project} looked at it just after launch and scored it ${score} of 5. Fix what it found, then publish:\n${notes}`, project, checks: lines.slice(0, 5) });
        run(db, 'UPDATE fresh_eyes SET fix_task_id=? WHERE id=?', t.id, row().id);
        engine.kick?.();
      } catch (e) { log?.('warn', 'fresh eyes fix job', { err: short(e?.message, 160) }); }
    }
    engine.emit(floor.id, 'fresh_eyes', { project, score }, { persist: false, ownerOnly: true });
    return row();
  }
  ext.freshEyes = review;
  // After a Launch that went through (the Launch tap, makers.launch), in the background: the boss is never kept waiting on it.
  if (engine.makers?.launch) {
    const launch = engine.makers.launch;
    engine.makers.launch = async (floor, opts) => {
      const out = await launch(floor, opts);
      const j = get(db, 'SELECT project, launched_at FROM maker_jobs WHERE floor_id=? ORDER BY id DESC LIMIT 1', floor.id);
      if (j?.launched_at) setImmediate(() => { review(floor, j.project, `launch:${j.launched_at}`).catch((e) => log?.('warn', 'fresh eyes', { err: short(e?.message, 160) })); });
      return out;
    };
  }
  // The boss only (spec Q23): the score and notes ride on the boss's own snapshot.
  hooks.snapshot.push((f, viewer, out) => { if (viewer.owner && cfg.freshEyes !== false) out.freshEyes = freshEyesView(db, f.id); });
  return null;
}
