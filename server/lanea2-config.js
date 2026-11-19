// The settings for the redesign's round 2, lane A (docs/redesign/ROUND2.md): the floor room, launch quality and the library. A tiny module of its
// own, like laneb-config.js, so config.js reads them in one line. Each behaviour change that could hurt a live floor has a switch here; the
// default is the new behaviour, except where ROUND2.md says a thing ships switched off.

const on = (v) => !/^\s*(0|false|no|off)\s*$/i.test(String(v ?? ''));

/** The settings, from the environment through config.js. Tests override any of them. */
export function laneA2Settings(env = process.env) {
  return {
    // r2-j31: an Idle floor's beans leave their desks for four idle moves and its screens go dark (IDLE_LIFE=0: the old breaks and errands).
    idleLife: on(env.IDLE_LIFE),
  };
}
