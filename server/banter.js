// Small talk without a model (docs/redesign/OFFICE-ANSWERS-1.md Q5): 200 fixed lines in config/banter-lines.json, picked at random and said
// as speech bubbles in the 3D room only. A bubble is sent live and never stored, so it never reaches Talk, the timeline or the ticker.
// BANTER_LINES=0 brings the old model-written banter back (server/people.js).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.js';

export const BANTER_LINES = Object.freeze(JSON.parse(readFileSync(join(ROOT, 'config/banter-lines.json'), 'utf8')).lines);
const RECENT = 40;  // a floor doesn't hear the same line again until this many others have gone by

/** `n` lines at random, none of them among the floor's `recent` ones (a list it keeps), and no two the same. */
export function pickLines(n, recent = [], random = Math.random) {
  const out = [];
  for (let tries = 0; out.length < n && tries < n * 20; tries++) {
    const i = Math.floor(random() * BANTER_LINES.length);
    if (recent.includes(i) || out.includes(i)) continue;
    out.push(i);
  }
  for (const i of out) { recent.push(i); if (recent.length > RECENT) recent.shift(); }
  return out.map((i) => BANTER_LINES[i]);
}
