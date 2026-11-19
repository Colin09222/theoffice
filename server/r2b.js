// Round 2, lane B (docs/redesign/ROUND2.md): everything lane B adds to the server, installed from one line in app.js so the two lanes merge
// cleanly. Each piece is its own module.
import { installLive } from './live.js';
import { installMailroom } from './mailroom.js';

export function installR2B(ext) {
  return [installLive(ext), installMailroom(ext)].filter(Boolean);
}
