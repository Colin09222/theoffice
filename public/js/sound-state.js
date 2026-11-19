// The sound rules (round 2, r2-j34; docs/redesign/OFFICE-ANSWERS-2.md, Q7 and section 5 "Sound: off by default"). No DOM here, so a node test
// can read them. sfx.js keeps the one switch; this says what it starts as and when a sound may play.

/** Where the choice is kept in the browser. '0' = sound on (not muted), '1' = off. The same key as before, so a choice made earlier still holds. */
export const SOUND_KEY = 'office.muted';
/** Off until someone turns it on: only a stored "on" ('0') starts with sound. Nothing stored, anything else, or no storage at all: off. */
export const mutedAtStart = (stored) => stored !== '0';
/** A sound plays only with sound on and the tab in view. */
export const mayPlay = ({ muted, hidden }) => !muted && !hidden;

// Round 2, r2-j43 (Q7): event sounds. Room tone at 15% volume, event sounds at 40%, at most one event sound every 2 s.
export const ROOM_TONE_VOLUME = 0.15, EVENT_VOLUME = 0.4, EVENT_GAP_MS = 2000;
/** The four event sounds, each made from the building's own small sound set: [sound, playback rate]. */
export const EVENT_SOUNDS = { launch: ['ring', 0.62], paper: ['tab', 0.55], stamp: ['stamp', 1], lift: ['ding', 0.82] };
/** One gate for all event sounds: a sound is let through only if the last one was 2 s ago or more. `now` is passed in for a fake clock. */
export function makeGate(gap = EVENT_GAP_MS) {
  let last = -Infinity;
  return (now) => { if (now - last < gap) return false; last = now; return true; };
}
