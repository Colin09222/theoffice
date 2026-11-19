// The settings for round 2's lane B (docs/redesign/ROUND2.md): the building, home, the mailroom, alerts and reports. A small module of its own,
// like laneb-config.js, so config.js reads them in one line. Every switch defaults to the new behaviour, except the ones ROUND2.md says must ship
// switched OFF because they reach people outside the building (BOSS_ALERTS, WEEKLY_REPORT_EMAIL): those are on only when set to 1.

const on = (v) => !/^\s*(0|false|no|off)\s*$/i.test(String(v ?? ''));
const onlyIf = (v) => /^\s*(1|true|yes|on)\s*$/i.test(String(v ?? ''));

/** The settings, from the environment through config.js. Tests override any of them. */
export function r2bSettings(env = process.env) {
  return {
    // r2-j33: hero cards fade between up to 3 real screenshots. HERO_FADE=0 sends none, and each card keeps its one photo.
    heroFade: on(env.HERO_FADE),
    // r2-j36: the live tower's address (/api/building/live: work light, launch flash, visit sign light, activity feed). LIVE_TOWER=0 takes it away.
    liveTower: on(env.LIVE_TOWER),
    // r2-j49: buddehbot's mailroom feed (/api/mailroom), read-only. MAILROOM=0 takes it (and the mailroom display) away.
    mailroom: on(env.MAILROOM),
    // r2-j53: the Mac's heartbeat file, mounted read-only from /var/lib/macbeat (docker-compose.yml). Only its recv_ts is read.
    macbeatFile: env.MACBEAT_FILE || '/run/macbeat/last',
    // r2-j61: boss alert emails. Ships OFF: only BOSS_ALERTS=1 turns them on (ROUND2.md: they reach people outside the building).
    bossAlerts: onlyIf(env.BOSS_ALERTS),
    // r2-j62: the weekly floor report email, Mondays 09:00 New York. Ships OFF: only WEEKLY_REPORT_EMAIL=1 turns it on.
    weeklyReportEmail: onlyIf(env.WEEKLY_REPORT_EMAIL),
    // r2-j64: one proposal per active floor, Mondays 08:30 New York (one short model call per floor per week). PROPOSALS=0 turns it off.
    proposals: on(env.PROPOSALS),
    // r2-j65: "Did it work?": a before-and-after line on a shipped job's timeline card 7 days later. DID_IT_WORK=0 turns it off.
    didItWork: on(env.DID_IT_WORK),
    // r2-j66: the "This week" page (/theoffice/thisweek). THIS_WEEK=0 turns it (and its link on the home page) off.
    thisWeek: on(env.THIS_WEEK),
    // r2-j68: the Friday feature (Fridays 16:00 to 23:00 New York, only if something shipped that week). FRIDAY=0 turns it off.
    friday: on(env.FRIDAY),
  };
}
