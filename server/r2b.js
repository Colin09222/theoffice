// Round 2, lane B (docs/redesign/ROUND2.md): everything lane B adds to the server, installed from one line in app.js so the two lanes merge
// cleanly. Each piece is its own module.
import { installLive } from './live.js';
import { installMailroom } from './mailroom.js';
import { bossAlerts } from './bossalerts.js';

export function installR2B(ext) {
  // Lane B's timers, reachable as engine.r2b for the tests and the admin script.
  const r2b = ext.engine.r2b = {};
  // r2-j61: boss alerts, OFF unless BOSS_ALERTS=1.
  const alerts = r2b.alerts = bossAlerts({ db: ext.db, cfg: ext.cfg, engine: ext.engine, now: ext.now, log: ext.log });
  return [installLive(ext), installMailroom(ext), alerts].filter(Boolean);
}
