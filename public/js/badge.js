// The status badge (docs/redesign/OFFICE-ANSWERS-1.md, section 3): one of four states, the same pill on the lobby and the floor.
// A visitor never reads "Closed", "gone home" or a floor's hours: a quiet floor is Idle, with when it last did something.
import { h, timeAgo } from './dom.js';

export const STATE_WORDS = { working: 'Working', waiting: 'Waiting on boss', idle: 'Idle', paused: 'Paused' };
export const stateOf = (card) => (STATE_WORDS[card?.state] ? card.state : 'idle');
/** "last active 2h ago" for an idle floor, or nothing. */
export const idleNote = (card) => (stateOf(card) === 'idle' && card?.lastActive ? `last active ${timeAgo(card.lastActive)}` : '');
/** The pill itself. */
export function stateBadge(card) {
  const s = stateOf(card);
  return h('span.badge', { 'data-state': s, 'data-badge': s }, STATE_WORDS[s]);
}
