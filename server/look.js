// The look of the building for a visitor (docs/redesign/OFFICE-ANSWERS-1.md): what a floor is doing in one of four words, and what stays
// out of public view. Every value here comes from rows the server already keeps; nothing calls a model.
//
// Switches (default is the redesign):
//   DEMO_FLOORS_PUBLIC=1  the demo floors show in the directory, the lift, the ticker and the stack again
//   PUBLIC_HOURS=1        visitors see the floor's hours sign and "closed" again (the boss always sees their own)
import { get } from './db.js';

/** The four states a visitor sees. Never "Closed". */
export const STATE_WORDS = { working: 'Working', waiting: 'Waiting on boss', idle: 'Idle', paused: 'Paused' };

/**
 * One floor's state, from its rows. Paused wins (the floor's own pause, a suspension or its money stop: no reason is given), then a question
 * the boss hasn't answered, then anyone at work. Otherwise Idle, with the last time anything happened. The building's night freeze is not
 * the floor's doing, so it reads Idle, not Paused.
 */
export function floorStateOf(db, engine, f) {
  const st = engine.floorState(f.id);
  const lastActive = lastActiveAt(db, f.id);
  if (f.status !== 'active' || st.paused || st.budgetStopped || st.outOfBudget) return { state: 'paused', lastActive };
  if (get(db, 'SELECT 1 x FROM questions WHERE floor_id=? AND answer IS NULL LIMIT 1', f.id)) return { state: 'waiting', lastActive };
  if (get(db, "SELECT 1 x FROM agents WHERE floor_id=? AND state!='idle' LIMIT 1", f.id) || get(db, "SELECT 1 x FROM tasks WHERE floor_id=? AND status='doing' LIMIT 1", f.id)) return { state: 'working', lastActive };
  return { state: 'idle', lastActive };
}
/** The last time the team did anything: a task moved, or a line went in the floor's log. */
export function lastActiveAt(db, floorId) {
  const t = get(db, 'SELECT MAX(updated_at) n FROM tasks WHERE floor_id=?', floorId)?.n || 0;
  const e = get(db, "SELECT MAX(created_at) n FROM events WHERE floor_id=? AND type IN ('feed','task')", floorId)?.n || 0;
  return Math.max(t, e) || null;
}

/** Whether demo floors (the scripted filler companies) are shown in public lists. Off unless DEMO_FLOORS_PUBLIC=1. */
export const demoPublic = (cfg) => !!cfg.demoFloorsPublic;

export function installLook(ext) {
  const { db, cfg, engine, hooks } = ext;
  // Every floor card and every floor page carries its state.
  hooks.floorCard.push((f, card) => {
    Object.assign(card, floorStateOf(db, engine, f));
    // A visitor never sees the hours, so a floor outside them looks like any quiet floor.
    if (!cfg.publicHours) delete card.workMode;
  });
  hooks.snapshot.push((f, viewer, out) => {
    Object.assign(out.floor, floorStateOf(db, engine, f));
    // A paused floor says Paused and nothing else to a visitor (section 4, "Floor (visitor)").
    if (!viewer.owner) delete out.floor.pauseReason;
    if (!viewer.owner && !cfg.publicHours && out.floor.workMode) {
      const { mode, label } = out.floor.workMode;
      // The room still needs to know whether the team works on its own; it never learns the hours or that the floor is shut.
      out.floor.workMode = { mode: mode === 'hours' ? 'ask' : mode, label: mode === 'hours' ? 'On call' : label, closed: false, opensAt: null, paused: false };
    }
    // Small talk is for the room's speech bubbles only, never the Talk list, and old lines from before the change stay out too.
    if (cfg.banterLines !== false && Array.isArray(out.talk)) out.talk = out.talk.filter((l) => l.kind !== 'banter' && l.kind !== 'small');
  });
  return null;
}
