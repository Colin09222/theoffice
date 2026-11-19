// Round 2, r2-j43 (docs/redesign/OFFICE-ANSWERS-2.md, Q7; section 6: "With sound on, a launch rings one bell and no two sounds play within 2 s").
// Event sounds (launch bell, paper thunk, stamp, lift ding) at 40%, room tone at 15%, at most one event sound every 2 s. Fake clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeGate, EVENT_SOUNDS, EVENT_VOLUME, ROOM_TONE_VOLUME, EVENT_GAP_MS } from '../public/js/sound-state.js';

const src = (p) => readFileSync(new URL(`../public/js/${p}`, import.meta.url), 'utf8');

test('the four event sounds, at 40%; room tone at 15%', () => {
  assert.deepEqual(Object.keys(EVENT_SOUNDS), ['launch', 'paper', 'stamp', 'lift']);
  assert.equal(EVENT_VOLUME, 0.4); assert.equal(ROOM_TONE_VOLUME, 0.15);
  const s = src('sfx.js');
  assert.match(s, /g\.gain\.value = EVENT_VOLUME;/);
  assert.match(s, /g\.gain\.value = ROOM_TONE_VOLUME;/);
  // Each is made from a sound the building already ships.
  const data = src('sfx-data.js');
  for (const [name] of Object.values(EVENT_SOUNDS)) assert.ok(data.includes(`"${name}":`), name);
});
test('no two event sounds within 2 s: one gate for all of them', () => {
  assert.equal(EVENT_GAP_MS, 2000);
  const pass = makeGate();
  const played = [0, 500, 1999, 2000, 2100, 3999, 4000, 9000].filter((t) => pass(t));
  assert.deepEqual(played, [0, 2000, 4000, 9000]);
  const s = src('sfx.js');
  assert.match(s, /const gate = makeGate\(\);/);
  assert.match(s, /if \(!gate\(now\)\) return false;/);
  // The lift ding goes through the same gate now.
  assert.match(s, /eventSound\('lift'\); return;/);
  assert.doesNotMatch(s, /sfx\('ding', \{ volume: 0\.9, rate: 0\.82 \}\)/);
});
test('a launch rings one bell, once, and only for a launch newer than the page has seen; nothing while muted or hidden', () => {
  const ui = src('lobby-ui.js');
  assert.match(ui, /if \(liveRead && f\.launchAt > \(launchSeen\.get\(f\.number\) \|\| 0\) && !rang\) rang = eventSound\('launch'\) \|\| true;/);
  const s = src('sfx.js');
  assert.match(s, /if \(!e \|\| !mayPlay\(\{ muted, hidden: document\.hidden \}\) \|\| !ctx/);
  // Room tone only in a floor's room, with sound on and the tab in view.
  assert.match(s, /const syncTone = \(\) => roomTone\(document\.body\?\.dataset\.page === 'floor'\);/);
  assert.match(s, /want = want && mayPlay\(\{ muted, hidden: document\.hidden \}\) && !!ctx;/);
});
