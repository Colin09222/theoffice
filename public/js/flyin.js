// The first-visit fly-in (round 2, r2-j38; docs/redesign/OFFICE-ANSWERS-2.md, Q1, Q3, Q9): 2.5 s, the first visit only, desktop only, starting
// when the tower is ready (which is after the page content, so it never delays it). Any input skips it. Never under reduce motion, never on a
// phone. The rules and the camera's path are pure, so a node test reads them.

export const FLYIN_MS = 2500;
export const FLYIN_KEY = 'office.flyin';
/** Whether this visit gets the fly-in. `seen` is the stored mark from an earlier visit. */
export const shouldFlyIn = ({ phone, reduce, seen }) => !phone && !reduce && !seen;
/**
 * Where the camera is `t` (0 to 1) of the way through: it starts high, far and turned away, and settles on the normal view with an ease-out.
 * Returned as offsets from the normal view: a turn (radians), a distance factor and a height factor; all are 0, 1 and 1 at the end.
 */
export function flyPose(t) {
  const k = Math.min(1, Math.max(0, t)), e = 1 - Math.pow(1 - k, 3);
  return { turn: -1.1 * (1 - e), dist: 1 + 1.4 * (1 - e), lift: 1 + 2.2 * (1 - e), done: k >= 1 };
}
/** The inputs that skip it. */
export const SKIP_EVENTS = ['pointerdown', 'wheel', 'keydown', 'touchstart'];
