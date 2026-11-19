// Round 2, r2-j37 (docs/redesign/OFFICE-ANSWERS-2.md, Q6; section 6: "The tower crown cycles the 3 hero screenshots every 6 s"). 3 launches, 6 s
// each, a 0.6 s fade, one 512 by 320 picture each, fed from the same list as the home hero. Not shown on "low" or a phone. Fake clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { billboardImages, billboardFrame, W, H, HOLD_MS, FADE_MS, MAX } from '../public/js/billboard.js';

const src = (p) => readFileSync(new URL(`../public/js/${p}`, import.meta.url), 'utf8');

test('the spec\'s numbers: 512 x 320, 6 s each, 0.6 s fade, 3 pictures', () => {
  assert.deepEqual([W, H, HOLD_MS, FADE_MS, MAX], [512, 320, 6000, 600, 3]);
});
test('the pictures are the hero list\'s, in its order, 3 at most', () => {
  const hero = [{ thumb: '/a.jpg' }, { thumb: '/b.jpg' }, { thumb: '/a.jpg' }, { thumb: '/c.jpg' }, { thumb: '/d.jpg' }];
  assert.deepEqual(billboardImages(hero), ['/a.jpg', '/b.jpg', '/c.jpg']);
  assert.deepEqual(billboardImages([]), []);
});
test('it cycles every 6 s: one picture held, then a 0.6 s fade into the next, and round again', () => {
  const at = (ms) => billboardFrame(ms, 3);
  assert.deepEqual(at(0), { index: 0, next: 1, mix: 0 });
  assert.equal(at(5400).mix, 0, 'held for 5.4 s');
  assert.equal(at(5700).mix, 0.5, 'halfway through the 0.6 s fade');
  assert.deepEqual(at(6000), { index: 1, next: 2, mix: 0 });
  assert.deepEqual(at(12000), { index: 2, next: 0, mix: 0 });
  assert.deepEqual(at(18000), { index: 0, next: 1, mix: 0 }, 'back to the first after 3 x 6 s');
  assert.deepEqual(billboardFrame(9999, 1), { index: 0, next: 0, mix: 0 }, 'one launch: it just stays');
  assert.equal(billboardFrame(0, 0).index, -1, 'none: nothing to show');
});
test('the page feeds it from the hero list; the tower hides it on low and draws only while a picture changes', () => {
  const ui = src('lobby-ui.js'), s = src('lobby-scene.js');
  // Since r2-j68 the list is boardImages(): the hero list, or on a Friday evening the featured floor's launches.
  assert.match(ui, /heroList = list; tower\?\.setBillboard\?\.\(boardImages\(\)\);/);
  assert.match(ui, /tower\.setBillboard\(boardImages\(\)\)/);
  assert.match(ui, /billboardImages\(friday\?\.on && friday\.launches\?\.length \? friday\.launches : heroList\)/);
  assert.match(s, /showBoard\(\) \{ const on = !!this\.board\?\.count && stage\.tier !== 'low';/);
  assert.match(s, /if \(this\.boardOn && this\.board\.draw\(performance\.now\(\)\)\) this\.boardTex\.needsUpdate = true;/);
  assert.match(s, /const bh = hh \* 0\.86, bw = bh \* \(BOARD_W \/ BOARD_H\);/, 'the board keeps the 512:320 shape');
});
