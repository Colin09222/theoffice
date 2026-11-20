// Round 2, r2-j72 (docs/redesign/OFFICE-ANSWERS-2.md, Q2 and Q9; section 6: "On 1 December the roof has snow and the lobby has a tree; on 1 January
// both are gone"). 1 to 31 December, New York time; phone "low" gets the roof colour only. Fake clock; the browser suite checks the tower itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isDecember } from '../public/js/nylight.js';

const ny = (y, mo, d, h, m) => Date.UTC(y, mo - 1, d, h + 5, m);  // EST

test('1 to 31 December, New York time, and not a minute either side', () => {
  assert.equal(isDecember(ny(2026, 11, 30, 23, 59)), false);
  assert.equal(isDecember(ny(2026, 12, 1, 0, 0)), true);
  assert.equal(isDecember(ny(2026, 12, 31, 23, 59)), true);
  assert.equal(isDecember(ny(2027, 1, 1, 0, 0)), false);
  assert.equal(isDecember(Date.UTC(2026, 11, 1, 3, 0)), false, '03:00 UTC on 1 December is still 30 November in New York');
});
test('the tower: snow on the roof and a tree in the lobby on the set; low keeps the roof colour only', () => {
  const s = readFileSync(new URL('../public/js/lobby-scene.js', import.meta.url), 'utf8');
  assert.match(s, /function makeDecember\(H, steps\)/);
  assert.match(s, /d\.group\.visible = dec; d\.tree\.visible = dec && !low; d\.fall\.visible = dec && !low;/);
  assert.match(s, /this\.setSeason\(isDecember\(window\.__officeNow\?\.\(\) \?\? Date\.now\(\)\)\);/);
});
