// The mailroom's rules (round 2, r2-j50 to r2-j56; docs/redesign/OFFICE-ANSWERS-2.md, section 3 and Q18). No DOM and no three.js, so the server
// and a node test use exactly the same rules as the page.

/** The robot's states, in priority order (section 3): asleep (the night freeze), away (no heartbeat for 15 minutes), busy (an item picked up and
 *  not closed), inbox waiting (open items, none picked up), free (no open items). */
export const STATES = ['asleep', 'away', 'busy', 'waiting', 'free'];
export const isOpen = (i) => i.state === 'open' || i.state === 'picked';
export function robotState({ freeze = false, heartbeatFresh = true, items = [] } = {}) {
  if (freeze) return 'asleep';
  if (!heartbeatFresh) return 'away';
  if (items.some((i) => i.state === 'picked')) return 'busy';
  if (items.some((i) => i.state === 'open')) return 'waiting';
  return 'free';
}
/** The sign on its desk: a sign, not a speech bubble (section 3, voice lines). */
export const SIGN = { asleep: 'Back at 08:00', away: 'Away' };
export const signFor = (state) => SIGN[state] || '';
/** The tray: one folder per open item up to 8, then "+N" (Q18). An empty tray means an empty tray. */
export const TRAY_MAX = 8;
export function trayView(items) {
  const n = items.filter(isOpen).length;
  return { folders: Math.min(TRAY_MAX, n), more: Math.max(0, n - TRAY_MAX), label: n > TRAY_MAX ? `+${n - TRAY_MAX}` : '' };
}
/** The visitor's one line of kind with floor number (Q20). Never the item, the price or the question. */
export const KIND_LINE = { help: (f) => `Help question from floor ${f}`, purchase: (f) => `Purchase request from floor ${f}`, contractor: (f) => `Build job from floor ${f}` };
export const kindLine = (i) => (KIND_LINE[i.kind] ? KIND_LINE[i.kind](i.floor) : '');
/** The pigeonholes: one slot per open floor, numbered, lowest first. */
export const pigeonholes = (floorNumbers) => [...new Set(floorNumbers)].filter((n) => Number.isInteger(n) && n > 0).sort((a, b) => a - b);

/** The robot's colours (Q21: Ink body, Slate panels, Tower Red stamp) and its eye light for a state (section 3, "Look"): Amber = busy, Teal = awake
 *  and free (an inbox waiting is awake too), off = asleep or away. */
export const COLORS = { ink: '#1F2430', slate: '#5B6270', red: '#C93A24', amber: '#F2A33A', teal: '#17766F', off: '#2a2d36', brass: '#c9a86a' };
export const eyeFor = (state) => (state === 'busy' ? COLORS.amber : state === 'free' || state === 'waiting' ? COLORS.teal : COLORS.off);
