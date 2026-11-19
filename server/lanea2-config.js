// The settings for the redesign's round 2, lane A (docs/redesign/ROUND2.md): the floor room, launch quality and the library. A tiny module of its
// own, like laneb-config.js, so config.js reads them in one line. Each behaviour change that could hurt a live floor has a switch here; the
// default is the new behaviour, except where ROUND2.md says a thing ships switched off.

const on = (v) => !/^\s*(0|false|no|off)\s*$/i.test(String(v ?? ''));

/** The settings, from the environment through config.js. Tests override any of them. */
export function laneA2Settings(env = process.env) {
  return {
    // r2-j31: an Idle floor's beans leave their desks for four idle moves and its screens go dark (IDLE_LIFE=0: the old breaks and errands).
    idleLife: on(env.IDLE_LIFE),
    // r2-j32: one frame per real launch on the room's wall, with its launch photo (ROOM_FRAMES=0: the old art only).
    roomFrames: on(env.ROOM_FRAMES),
    // r2-j40: a Tester's finished check sends the room a 'beat' event (high five or slump) (RESULT_BEATS=0: none sent).
    resultBeats: on(env.RESULT_BEATS),
    // r2-j41: the meeting room's whiteboard lists the current plan's jobs, up to 5, ticked as each is done (ROOM_WHITEBOARD=0: the old board).
    roomWhiteboard: on(env.ROOM_WHITEBOARD),
    // r2-j42: paper piles (one sheet per queued job, max 5) and the trophy shelf (first launch, 100, 1,000, 10,000 real visits) (ROOM_PROPS=0: none).
    roomProps: on(env.ROOM_PROPS),
    // r2-j44: a phone room keeps under 60,000 triangles by shedding the city around it, then the shore, then small props (PHONE_LIMITS=0: no shedding;
    // the 30 fps cap and 1.5 pixel ratio live in the browser and lift with ?limits=0).
    phoneLimits: on(env.PHONE_LIMITS),
    // r2-j46: the desktop camera follows real handoffs (with a "Follow the work" switch) and an idle phone drifts (ROOM_CAMERA=0: neither).
    roomCamera: on(env.ROOM_CAMERA),
    // r2-j47: every job keeps its events with their times (server/eventlog.js) for JOB_EVENTS_DAYS (35, never under 30) (JOB_EVENTS=0: not recorded).
    jobEvents: on(env.JOB_EVENTS),
    jobEventsDays: Math.max(30, Number(env.JOB_EVENTS_DAYS) || 35),
    // r2-j48: an Idle floor offers "Watch how this was made", a 30 to 60 s replay of its last real job (REPLAY=0: no offer, no route data).
    replay: on(env.REPLAY),
    // r2-j57: the launch checklist, 8 checks by code; no HTTPS, a broken form or a broken link on the main page holds the boss's Launch tap
    // (LAUNCH_CHECKLIST=0: the checks still run and show, nothing is held).
    launchChecklist: on(env.LAUNCH_CHECKLIST),
    // r2-j59: after a Launch, one fresh-eyes look on the review model (desktop and phone pictures, done-means lines), score 1 to 5 for the boss only,
    // under 3 makes one fix job (FRESH_EYES=0: no look).
    freshEyes: on(env.FRESH_EYES),
    // r2-j60: share cards, 1,200 by 630 under 200 KB, remade on each launch and weekly, the floor link's preview picture (SHARE_CARDS=0: none).
    shareCards: on(env.SHARE_CARDS),
  };
}
