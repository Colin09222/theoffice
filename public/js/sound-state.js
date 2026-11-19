// The sound rules (round 2, r2-j34; docs/redesign/OFFICE-ANSWERS-2.md, Q7 and section 5 "Sound: off by default"). No DOM here, so a node test
// can read them. sfx.js keeps the one switch; this says what it starts as and when a sound may play.

/** Where the choice is kept in the browser. '0' = sound on (not muted), '1' = off. The same key as before, so a choice made earlier still holds. */
export const SOUND_KEY = 'office.muted';
/** Off until someone turns it on: only a stored "on" ('0') starts with sound. Nothing stored, anything else, or no storage at all: off. */
export const mutedAtStart = (stored) => stored !== '0';
/** A sound plays only with sound on and the tab in view. */
export const mayPlay = ({ muted, hidden }) => !muted && !hidden;
