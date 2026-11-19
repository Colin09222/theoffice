// The home page draws before any 3D code loads (docs/redesign, job 14), and a phone gets none at all (job 16): proved from the source.
// The page's entry and everything it imports up front (not the dynamic import() calls, which load later) must not reach three.js or a scene.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, normalize } from 'node:path';
import { ROOT } from '../server/config.js';

const PUB = join(ROOT, 'public');
const STATIC_IMPORT = /^\s*import\s+(?:[^'"]*?\sfrom\s+)?['"](\.{1,2}\/[^'"]+)['"]/gm;
const THREE_D = /vendor\/three|\/stage\.js$|lobby-scene\.js$|office-scene\.js$|addons\.js$|portrait\.js$|character\.js$|models\.js$|toon\.js$|tower-nav\.js$|stage-start\.js$/;

/** Every module a page pulls in before it runs, starting from one file. */
function staticClosure(start) {
  const seen = new Set(); const todo = [start];
  while (todo.length) {
    const f = todo.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(STATIC_IMPORT)) todo.push(normalize(join(dirname(f), m[1])));
  }
  return [...seen].map((f) => f.slice(PUB.length));
}

test('the home page, the Launched page and a phone\'s floor reach no 3D module before they draw', () => {
  for (const entry of ['js/main.js', 'js/lobby-ui.js', 'js/launched-ui.js', 'js/launch-card.js', 'js/badge.js', 'js/floor-lite.js', 'js/status-card.js', 'js/timeline-ui.js']) {
    const reach = staticClosure(join(PUB, entry));
    const bad = reach.filter((f) => THREE_D.test(f));
    assert.deepEqual(bad, [], `${entry} pulls in ${bad.join(', ')}`);
  }
});

test('the page asks for no 3D module ahead of time', () => {
  const page = readFileSync(join(PUB, 'index.html'), 'utf8');
  const preloads = [...page.matchAll(/rel="modulepreload" href="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(preloads.length > 0);
  for (const p of preloads) assert.doesNotMatch(p, THREE_D, p);
});

test('the tower is fetched only after the content, and never on a phone', () => {
  const src = readFileSync(join(PUB, 'js/lobby-ui.js'), 'utf8');
  assert.match(src, /const contentIn = Promise\.race\(\[Promise\.allSettled\(\[hero\.ready, now\.ready\]\)/);
  assert.match(src, /if \(!isPhone\(\)\) \{\s+contentIn\.then\(\(\) => requestAnimationFrame\(\(\) => setTimeout\(async \(\) => \{\s+try \{\s+const m = await import\('\.\/tower-nav\.js'\);/);
  const main = readFileSync(join(PUB, 'js/main.js'), 'utf8');
  assert.match(main, /&& !isPhone\(\)\) \{/, 'no background fetch of the floor code on a phone');
});

test('a phone opens a floor without its room until Watch the room is tapped', () => {
  const main = readFileSync(join(PUB, 'js/main.js'), 'utf8');
  assert.match(main, /if \(lite\.liteFloor\(floorMatch\[1\]\)\) \{ current = lite\.hideFloorLite; if \(await lite\.showFloorLite\(ui, floorMatch\[1\], \{ onRoom: \(\) => route\(\) \}\) !== 'room'\) return;/);
  assert.match(main, /if \(fromRoom\) lite\.roomWanted\.add\(floorMatch\[1\]\);/, 'the lift from inside a room keeps the room');
  assert.match(readFileSync(join(PUB, 'js/floor-lite.js'), 'utf8'), /if \(state\.viewer\?\.owner && state\.floor\?\.setup\) \{ roomWanted\.add\(slug\); return 'room'; \}/, 'a boss still setting up goes to the full page');
  assert.match(main, /location\.pathname\.includes\('\/floor\/'\) && !window\.matchMedia\('\(max-width: 760px\)'\)\.matches/, 'no preload of the floor\'s 3D modules on a phone');
  const lite = readFileSync(join(PUB, 'js/floor-lite.js'), 'utf8');
  assert.match(lite, /export const liteFloor = \(slug\) => isPhone\(\) && !roomWanted\.has\(slug\);/);
  assert.match(lite, /'Watch the room'/);
});
