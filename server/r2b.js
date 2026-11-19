// Round 2, lane B (docs/redesign/ROUND2.md): everything lane B adds to the server, installed from one line in app.js so the two lanes merge
// cleanly. Each piece is its own module.
import { installLive } from './live.js';
import { installMailroom } from './mailroom.js';
import { bossAlerts } from './bossalerts.js';
import { weeklyReports } from './weeklyreport.js';
import { installProposals } from './proposals.js';
import { installDidIt } from './didit.js';

export function installR2B(ext) {
  // Lane B's timers, reachable as engine.r2b for the tests and the admin script.
  const r2b = ext.engine.r2b = {};
  // r2-j61: boss alerts, OFF unless BOSS_ALERTS=1.
  const alerts = r2b.alerts = bossAlerts({ db: ext.db, cfg: ext.cfg, engine: ext.engine, now: ext.now, log: ext.log });
  // r2-j62: the weekly floor report email, OFF unless WEEKLY_REPORT_EMAIL=1.
  const reports = r2b.reports = weeklyReports({ db: ext.db, cfg: ext.cfg, engine: ext.engine, now: ext.now, log: ext.log });
  // r2-j64: numbers to actions, one proposal per active floor on Mondays.
  const proposals = installProposals(ext);
  // r2-j65: "Did it work?" lines on the timeline, 7 days after a change ships.
  const didit = installDidIt(ext);
  return [installLive(ext), installMailroom(ext), alerts, reports, proposals, didit].filter(Boolean);
}
