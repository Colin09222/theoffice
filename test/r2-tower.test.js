// Round 2, r2-j36 (docs/redesign/OFFICE-ANSWERS-2.md, Q1; section 6: "Starting a test job on a hidden floor brightens that floor's windows within
// 10 s"). The live tower's signals: room light = work (brighter while a job runs, one 0.8 s flash on a launch), the visit sign light = real visits
// in the last 24 hours in 4 levels, and a small public activity feed with no money and no private work. Fake records, mock mode.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boot, claim, Client } from './helpers.js';
import { get, run } from '../server/db.js';
import { visitLevel } from '../server/live.js';

const src = (p) => readFileSync(new URL(`../public/js/${p}`, import.meta.url), 'utf8');
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const floorOf = (t, c) => get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
const live = async (t) => (await new Client(t).get('/api/building/live')).data;

describe('the live address', () => {
  test('a job started on a hidden floor lights its windows at the next reading; the row has its number and the light only', async () => {
    const t = await boot();
    try {
      const c = await claim(t, 'Secret Lab'); const f = floorOf(t, c);
      run(t.db, 'UPDATE floors SET hidden=1 WHERE id=?', f.id);
      run(t.db, "INSERT INTO projects (floor_id,slug,title,kind,private,published_at,created_at) VALUES (?,'p','P','site',0,1,1)", f.id);
      run(t.db, "INSERT INTO app_visits (floor_id,project,day,path,views,uniques) VALUES (?,'p',?,'/',999,999)", f.id, dayOf(Date.now()));
      let row = (await live(t)).floors.find((x) => x.number === f.number);
      assert.deepEqual(row, { number: f.number, work: 0, launchAt: null, visits: 0 });
      run(t.db, "INSERT INTO tasks (floor_id,title,status,created_at,updated_at) VALUES (?,'A test job','doing',?,?)", f.id, Date.now(), Date.now());
      const body = await live(t);
      row = body.floors.find((x) => x.number === f.number);
      assert.equal(row.work, 1, 'its windows brighten');
      assert.deepEqual(Object.keys(row).sort(), ['launchAt', 'number', 'visits', 'work']);
      assert.ok(!JSON.stringify(body).includes('Secret Lab') && !JSON.stringify(body).includes('A test job'), 'no name and no job title for a hidden floor');
    } finally { await t.close(); }
  });
  test('visit sign light: 0, 1 to 50, 51 to 200, over 200 real visits in the last 24 hours; older visits and private work do not count', async () => {
    assert.deepEqual([0, 1, 50, 51, 200, 201, 5000].map(visitLevel), [0, 1, 1, 2, 2, 3, 3]);
    const t = await boot();
    try {
      const f = floorOf(t, await claim(t, 'TheTireRx'));
      run(t.db, "INSERT INTO projects (floor_id,slug,title,kind,private,published_at,created_at) VALUES (?,'tires','Tires','site',0,?,1)", f.id, 1700000000000);
      run(t.db, "INSERT INTO projects (floor_id,slug,title,kind,private,published_at,created_at) VALUES (?,'secret','S','site',1,1,1)", f.id);
      const v = (p, day, n) => run(t.db, "INSERT INTO app_visits (floor_id,project,day,path,views,uniques) VALUES (?,?,?,'/',?,?)", f.id, p, day, n, n);
      v('tires', dayOf(Date.now() - 5 * 86400000), 900);
      v('secret', dayOf(Date.now()), 900);
      v('tires', dayOf(Date.now()), 120);
      const row = (await live(t)).floors.find((x) => x.number === f.number);
      assert.equal(row.visits, 2, '120 real visits: level 2');
      assert.equal(row.launchAt, 1700000000000, 'the last public launch');
      assert.equal(row.work, 0);
    } finally { await t.close(); }
  });
  test('demo floors light nothing; the feed is Happening now\'s public lines with no money; LIVE_TOWER=0 takes the address away', async () => {
    const t = await boot({ fillerCompanies: true, fillerTickMs: 1e6 });
    try {
      const demo = get(t.db, 'SELECT * FROM floors WHERE filler=1 LIMIT 1');
      run(t.db, "INSERT INTO tasks (floor_id,title,status,created_at,updated_at) VALUES (?,'fake','doing',?,?)", demo.id, Date.now(), Date.now());
      const body = await live(t);
      assert.ok(!body.floors.some((x) => x.number === demo.number));
      assert.ok(Array.isArray(body.feed));
      assert.doesNotMatch(JSON.stringify(body), /\$|usd|cost|price/i);
    } finally { await t.close(); }
    const t2 = await boot({ liveTower: false });
    try { assert.equal((await new Client(t2).get('/api/building/live')).status, 404); } finally { await t2.close(); }
  });
});

describe('the page', () => {
  test('reads the live address every 5 s (well inside 10 s) while the tab is in view, and hands it to the tower', () => {
    const s = src('lobby-ui.js');
    assert.match(s, /const LIVE_MS = 5000;/);
    assert.match(s, /livePoll = setInterval\(\(\) => \{ if \(!document\.hidden\) \{? ?readLive\(\);[^\n]*\}, LIVE_MS\);/);
    assert.match(s, /tower\?\.setLive\?\.\(live\.floors\)/);
  });
  test('the tower: a working floor is brighter and flickers; a newer launch flashes once for 0.8 s; the sign light has 4 levels and stays on at night', () => {
    const s = src('lobby-scene.js');
    assert.match(s, /float busy = min\(vState\.y, 1\.0\) \* \(0\.75 \+ 0\.25 \* sin\(uTime \* 7\.0/);
    assert.match(s, /\+ busy \* 0\.6 \+ flash \* 1\.6/);
    assert.match(s, /this\.flashes\.set\(f\.number, 0\.8\)/);
    assert.match(s, /if \(this\.liveRead && f\.launchAt && \(!seen \|\| f\.launchAt > seen\)\)/, 'the first reading never flashes an old launch');
    assert.match(s, /export const VISIT_COLORS = \['#2a2c33', '#7a6a3a', '#e0a83a', '#ffe9a6'\]/);
    // The sign light is an unlit material with no tie to the room-lights switch.
    assert.match(s, /new THREE\.MeshBasicMaterial\(\{ color: '#ffffff', toneMapped: false \}\)/);
    assert.match(s, /if \(!this\.floorData\.has\(f\.number\)\) st\[i \* 3\] = f\.work \? 1 : 0;/, 'a hidden floor lights while it works');
  });
  test('phone and no tower: the floor list dot pulses for a floor at work', () => {
    const css = readFileSync(new URL('../public/css/r2b.css', import.meta.url), 'utf8');
    assert.match(css, /@media \(max-width: 760px\) \{ \.dir-row\[data-live="work"\] \.dir-num::after \{ display: block; animation: r2-pulse/);
    assert.match(src('lobby-ui.js'), /'data-live': liveWork\(card\.number\) \? 'work' : null/);
  });
});
