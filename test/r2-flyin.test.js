// Round 2, r2-j38 (docs/redesign/OFFICE-ANSWERS-2.md, Q1, Q3, Q9; section 6: "The fly-in plays once on desktop, never a second time, and never
// under reduce motion"). 2.5 s, first visit only, desktop only, starting when the tower is ready; any input skips it; it never delays content.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shouldFlyIn, flyPose, FLYIN_MS, FLYIN_KEY, SKIP_EVENTS } from '../public/js/flyin.js';

const src = (p) => readFileSync(new URL(`../public/js/${p}`, import.meta.url), 'utf8');

test('once, on the desktop, never under reduce motion, never on a phone', () => {
  assert.equal(shouldFlyIn({ phone: false, reduce: false, seen: false }), true);
  assert.equal(shouldFlyIn({ phone: false, reduce: false, seen: true }), false, 'never a second time');
  assert.equal(shouldFlyIn({ phone: false, reduce: true, seen: false }), false, 'never under reduce motion');
  assert.equal(shouldFlyIn({ phone: true, reduce: false, seen: false }), false, 'never on a phone');
  const ui = src('lobby-ui.js');
  // The mark is set as it starts, and no storage means no fly-in (it could not be kept to once).
  assert.match(ui, /try \{ localStorage\.setItem\(FLYIN_KEY, '1'\); \} catch \{ return; \}\n  tower\.flyIn\(\);/);
  assert.match(ui, /catch \{ seen = true;/);
  assert.equal(FLYIN_KEY, 'office.flyin');
});
test('2.5 s from high, far and turned away to the normal view, and it ends exactly there', () => {
  assert.equal(FLYIN_MS, 2500);
  const a = flyPose(0), z = flyPose(1);
  assert.ok(a.dist > 2 && a.lift > 3 && a.turn < -1);
  assert.deepEqual({ turn: z.turn + 0, dist: z.dist, lift: z.lift, done: z.done }, { turn: 0, dist: 1, lift: 1, done: true });
  let last = Infinity; for (let t = 0; t <= 1; t += 0.05) { const p = flyPose(t); assert.ok(p.dist <= last + 1e-9); last = p.dist; }
  assert.match(src('lobby-scene.js'), /const p = flyPose\(\(performance\.now\(\) - this\.flyin\.start\) \/ FLYIN_MS\);/);
});
test('any input skips it; it starts only once the tower is ready, which is after the page content', () => {
  assert.deepEqual(SKIP_EVENTS, ['pointerdown', 'wheel', 'keydown', 'touchstart']);
  const ui = src('lobby-ui.js');
  assert.match(ui, /for \(const e of SKIP_EVENTS\) window\.addEventListener\(e, skip, \{ capture: true, passive: true \}\);/);
  // Called where the tower has just arrived; the tower itself waits for the hero and Happening now (job 14).
  assert.match(ui, /tower\.setBillboard\(billboardImages\(heroList\)\); flyInOnce\(\); \}/);
  assert.match(ui, /const contentIn = Promise\.race\(\[Promise\.allSettled\(\[hero\.ready, now\.ready\]\)/);
  assert.match(src('lobby-scene.js'), /skipFlyIn\(\) \{ if \(this\.flyin\) \{ this\.flyin = null; this\.flyinSkipped = true; \} \}/);
});
