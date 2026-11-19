// Round 2, r2-j34 (docs/redesign/OFFICE-ANSWERS-2.md, Q7; section 6: "A first-time visitor hears nothing until they turn sound on").
// Sound starts off, the choice is remembered, and a hidden tab is silent. The rules are pure (public/js/sound-state.js); the wiring in sfx.js
// is read from the page code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
const { readFileSync } = fs;
import { SOUND_KEY, mutedAtStart, mayPlay } from '../public/js/sound-state.js';

const sfx = readFileSync(new URL('../public/js/sfx.js', import.meta.url), 'utf8');

test('a first-time visitor starts with sound off: nothing stored, private mode or anything odd all mean off', () => {
  assert.equal(mutedAtStart(null), true);
  assert.equal(mutedAtStart(undefined), true);
  assert.equal(mutedAtStart(''), true);
  assert.equal(mutedAtStart('1'), true);
  assert.equal(mutedAtStart('yes'), true);
  // The page starts muted before it even reads the stored choice, and a storage error leaves it muted.
  assert.match(sfx, /let muted = true;\ntry \{ muted = mutedAtStart\(localStorage\.getItem\(KEY\)\); \} catch/);
});
test('the choice is remembered: turning sound on stores it, and the next visit starts on', () => {
  assert.equal(SOUND_KEY, 'office.muted');
  assert.match(sfx, /localStorage\.setItem\(KEY, muted \? '1' : '0'\)/);
  assert.equal(mutedAtStart('0'), false, 'a stored "on" starts with sound');
});
test('nothing plays while muted or while the tab is hidden, and a hidden tab suspends the sound system', () => {
  assert.equal(mayPlay({ muted: true, hidden: false }), false);
  assert.equal(mayPlay({ muted: false, hidden: true }), false);
  assert.equal(mayPlay({ muted: false, hidden: false }), true);
  assert.match(sfx, /if \(!mayPlay\(\{ muted, hidden: document\.hidden \}\) \|\| !ctx/);
  assert.match(sfx, /visibilitychange', \(\) => \{ if \(!ctx\) return; if \(document\.hidden\) ctx\.suspend\?\.\(\); else if \(!muted\) ctx\.resume\?\.\(\); \}/);
  // Every sound in the page goes through sfx(): no other file makes its own.
  const { readdirSync } = fs;
  for (const f of readdirSync(new URL('../public/js/', import.meta.url))) {
    if (!f.endsWith('.js') || f === 'sfx.js' || f === 'sfx-data.js') continue;
    const s = readFileSync(new URL(`../public/js/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(s, /new Audio\(|AudioContext/, `${f} makes a sound outside sfx.js`);
  }
});

