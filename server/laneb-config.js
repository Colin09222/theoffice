// The settings for the redesign's lane B (docs/redesign/LANE-B.md): the worker loop, costs and alerts. A tiny module of its own, like mail-config.js,
// so config.js reads them in one line. Each behaviour change that could hurt a live floor has a switch here; the default is the new behaviour.

const on = (v) => !/^\s*(0|false|no|off)\s*$/i.test(String(v ?? ''));

/** The settings, from the environment through config.js. Tests override any of them. */
export function laneBSettings(env = process.env) {
  return {
    // j04, re-hold rules. The contractor routing check runs once, when a task is created, never on a status change (CONTRACTOR_ROUTE_ONCE=0 checks
    // again each time a task is picked up, as before). A Tester failure on work the contractor handed back makes one fix task on the floor, and the
    // original is closed as shipped (HANDBACK_FIX=0 leaves it to the manager, as before). Refusing to hold handed-back work again has no switch.
    contractorRouteOnce: on(env.CONTRACTOR_ROUTE_ONCE),
    handbackFix: on(env.HANDBACK_FIX),
    // j05, the budget check inside the server (server/spendcheck.js): a spend record every SPEND_CHECK_EVERY_MIN minutes (default 120). SPEND_CHECK=0 stops it.
    spendCheck: on(env.SPEND_CHECK),
    spendCheckEveryMs: Math.max(1, Number(env.SPEND_CHECK_EVERY_MIN) || 120) * 60000,
    // j06, alerts to the owner (server/owneralerts.js): only the five immediate alerts (OWNER_ALERTS=0 stops them) and one digest a day at DIGEST_AT
    // New York time (OWNER_DIGEST=0 stops it). Both go through the OpenClaw hook (OPENCLAW_HOOK_URL, OPENCLAW_HOOK_TOKEN), delivered to the owner.
    ownerAlerts: on(env.OWNER_ALERTS),
    ownerDigest: on(env.OWNER_DIGEST),
    digestAt: /^\d{2}:\d{2}$/.test(env.DIGEST_AT || '') ? env.DIGEST_AT : '08:05',
    // The night freeze: no new floor work starts from NIGHT_FREEZE_FROM to NIGHT_FREEZE_TO in NIGHT_FREEZE_TZ. NIGHT_FREEZE=0 turns it off;
    // admin.mjs freeze on|off|auto overrides it from the database without a restart. A mock building (AI_MODE=mock) spends nothing, so there it is off
    // unless NIGHT_FREEZE says otherwise: a test or a local run at night would otherwise sit still.
    nightFreeze: env.NIGHT_FREEZE === undefined || env.NIGHT_FREEZE === '' ? env.AI_MODE !== 'mock' : on(env.NIGHT_FREEZE),
    nightFreezeFrom: /^\d{2}:\d{2}$/.test(env.NIGHT_FREEZE_FROM || '') ? env.NIGHT_FREEZE_FROM : '23:00',
    nightFreezeTo: /^\d{2}:\d{2}$/.test(env.NIGHT_FREEZE_TO || '') ? env.NIGHT_FREEZE_TO : '08:00',
    nightFreezeTz: env.NIGHT_FREEZE_TZ || 'America/New_York',
    // j07, the hard cap (TASK_MAX_USD, default 5, in config.js): a task that reaches it is ended and ships or closes. HARD_CAP_ENDS=0 goes back to the old stop.
    hardCapEnds: on(env.HARD_CAP_ENDS),
  };
}
