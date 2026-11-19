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
  };
}
