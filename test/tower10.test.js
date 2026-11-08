// The ten-floor building: the default, growing it, the demo floors, the code that holds a floor, and the hidden floors moved out above the
// building, where every place that uses a floor number has to cope with them.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boot, Client, claim, adminClient } from './helpers.js';
import { loadConfig } from '../server/config.js';
import { openDb, get, all, run } from '../server/db.js';
import { issueCode, sha256, normalizeCode } from '../server/auth.js';
import { parkHiddenFloors, moveFloor, holdFloorForCode, RenumberError } from '../server/renumber.js';
import { seedFillers, removeFiller, COMPANIES } from '../server/filler.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const floorsOf = (t) => all(t.db, 'SELECT id, number, slug, hidden FROM floors ORDER BY number');
// What the building is made of: who is where, under which address, with which staff and codes. Not the staff's moods, which keep changing.
const dump = (db) => JSON.stringify([all(db, 'SELECT id,slug,number,name,hidden,filler,status FROM floors ORDER BY id'), all(db, 'SELECT hash,floor_number,claimed_at,floor_id FROM codes ORDER BY hash'), all(db, 'SELECT id,floor_id,role,name FROM agents ORDER BY id')]);

describe('how tall the building is', () => {
  test('the default building is ten floors', () => { assert.equal(loadConfig({}).towerFloors, 10); });
  test('10 to 14 floors: raise the setting and restart, with no data change', async () => {
    const t = await boot({ towerFloors: 10 });
    try {
      for (const n of [1, 2, 3]) await claim(t, `Co ${n}`, { floor: n });
      await claim(t, 'Top Co', { floor: 10 });
      const before = dump(t.db);
      const small = (await new Client(t).get('/api/floors')).data;
      assert.equal(small.towerFloors, 10);
      assert.deepEqual(small.toLet, [4, 5, 6, 7, 8, 9]);
      // A restart with the bigger number: the same database under a new setting.
      t.cfg.towerFloors = 14;
      assert.equal(dump(t.db), before, 'nothing in the data changed');
      const big = (await new Client(t).get('/api/floors')).data;
      assert.equal(big.towerFloors, 14);
      assert.deepEqual(big.toLet, [4, 5, 6, 7, 8, 9, 11, 12, 13, 14]);
      assert.deepEqual(big.floors.map((f) => f.number).sort((a, b) => a - b), [1, 2, 3, 10]);
      // A new floor can land on the extra height, and a code can hold one of the new numbers.
      const twelve = await claim(t, 'Twelfth', { floor: 12 });
      assert.equal(twelve.number, 12);
      const a = await adminClient(t);
      assert.equal((await a.post('/api/admin/codes', { floor: 14 })).status, 201);
      assert.equal((await a.post('/api/admin/codes', { floor: 15 })).status, 400);
    } finally { await t.close(); }
  });
});

describe('the demo companies keep to the bottom two floors', () => {
  test('they never go above floor 2, however tall the building or however often they are seeded', async () => {
    for (const towerFloors of [10, 40]) {
      const t = await boot({ towerFloors, fillerCompanies: true, fillerTickMs: 100000 });
      try {
        assert.deepEqual(floorsOf(t).map((f) => f.number), [1, 2]);
        const r = seedFillers(t.db, { cfg: t.cfg, models: t.app.engine.models, engine: t.app.engine, revive: true });
        assert.equal(r.seeded.length, 0);
        assert.deepEqual(floorsOf(t).map((f) => f.number), [1, 2]);
        assert.ok(COMPANIES.length > 2, 'more companies than places, which is what this is proving');
      } finally { await t.close(); }
    }
  });
  test('a floor in the middle of the building stays free even if a demo company is removed and revived', async () => {
    const t = await boot({ towerFloors: 10, fillerCompanies: true, fillerTickMs: 100000 });
    try {
      removeFiller(t.db, { number: 2 });
      seedFillers(t.db, { cfg: t.cfg, models: t.app.engine.models, engine: t.app.engine });
      assert.deepEqual(floorsOf(t).map((f) => f.number), [1], 'a removed one leaves its place free');
      const r = seedFillers(t.db, { cfg: t.cfg, models: t.app.engine.models, engine: t.app.engine, revive: true });
      assert.equal(r.seeded.length, 1);
      assert.deepEqual(floorsOf(t).map((f) => f.number), [1, 2]);
    } finally { await t.close(); }
  });
});

describe('a code that holds a floor', () => {
  test('claiming a code made to hold a floor lands on the floor it holds, not the next free one', async () => {
    const t = await boot({ towerFloors: 10 });
    try {
      const code = t.code();                     // an ordinary code, issued with nothing held, like the one in the chat
      const issuedAt = get(t.db, 'SELECT created_at c FROM codes WHERE hash=?', sha256(normalizeCode(code))).c;
      assert.deepEqual(holdFloorForCode(t.db, t.cfg, { issuedAt, floor: 3 }), { floor: 3, changed: true });
      assert.deepEqual(holdFloorForCode(t.db, t.cfg, { issuedAt, floor: 3 }), { floor: 3, changed: false }, 'safe to run twice');
      const lobby = (await new Client(t).get('/api/floors')).data;
      assert.ok(!lobby.toLet.includes(3), 'the held floor is not to let');
      assert.equal((await new Client(t).post('/api/claim/check', { code })).data.floor, 3);
      // A new code doesn't take the held floor while it is held.
      const other = await claim(t, 'Next Door');
      assert.equal(other.number, 1);
      const c = new Client(t);
      const r = await c.post('/api/claim', { code, name: 'Labs Co', bossName: 'Boss', tagline: 'x', colors: { primary: '#aa3300', accent: '#ffcc00' } });
      assert.equal(r.status, 201); assert.equal(r.data.number, 3);
      assert.equal(get(t.db, 'SELECT COUNT(*) n FROM codes WHERE hash=? AND claimed_at IS NULL', sha256(normalizeCode(code))).n, 0);
    } finally { await t.close(); }
  });
  test('it refuses a claimed code, an unknown moment, an occupied floor, or one outside the building', async () => {
    const t = await boot({ towerFloors: 10 });
    try {
      const bad = (fn) => assert.throws(fn, RenumberError);
      const taken = await claim(t, 'First', { floor: 4 });
      const used = get(t.db, 'SELECT created_at c FROM codes WHERE hash=?', sha256(normalizeCode(taken.code))).c;
      bad(() => holdFloorForCode(t.db, t.cfg, { issuedAt: used, floor: 5 }));
      bad(() => holdFloorForCode(t.db, t.cfg, { issuedAt: 12345, floor: 5 }));
      issueCode(t.db, null, 777000);
      bad(() => holdFloorForCode(t.db, t.cfg, { issuedAt: 777000, floor: 4 }));
      bad(() => holdFloorForCode(t.db, t.cfg, { issuedAt: 777000, floor: 11 }));
      assert.equal(get(t.db, 'SELECT floor_number n FROM codes WHERE created_at=777000').n, null, 'nothing changed');
    } finally { await t.close(); }
  });
  test('a code holding a floor beyond the building takes the next free floor instead of opening one up there', async () => {
    const t = await boot({ towerFloors: 10 });
    try {
      const code = issueCode(t.db, 34);
      assert.equal((await new Client(t).post('/api/claim/check', { code })).data.floor, 1);
      const r = await new Client(t).post('/api/claim', { code, name: 'High Hopes', bossName: 'Boss', tagline: 'x', colors: { primary: '#aa3300', accent: '#ffcc00' } });
      assert.equal(r.status, 201); assert.equal(r.data.number, 1);
    } finally { await t.close(); }
  });
});

describe('hidden floors moved out above the building', () => {
  // Six hidden companies on floors 1 to 6, a visible one on 7 and a code holding 8.
  const build = async () => {
    const t = await boot({ towerFloors: 10 });
    const cos = [];
    for (const n of [1, 2, 3, 4, 5, 6]) { const c = await claim(t, `Test Co ${n}`, { floor: n }); cos.push(c); run(t.db, 'UPDATE floors SET hidden=1 WHERE slug=?', c.slug); }
    const seven = await claim(t, 'Seven', { floor: 7 });
    return { t, cos, seven };
  };
  test('park moves them to 101 to 106 in order, once, and nothing about them changes but the number', async () => {
    const { t, cos, seven } = await build();
    try {
      run(t.db, "INSERT INTO app_labels (label,floor_id,project,created_at) SELECT 'neon--floor-5', id, 'neon', 1 FROM floors WHERE number=5");
      const ids = floorsOf(t).filter((f) => f.hidden).map((f) => f.id);
      const moved = parkHiddenFloors(t.db, t.cfg, { from: 1, to: 6, at: 101 });
      assert.deepEqual(moved.map((m) => [m.from, m.to]), [[1, 101], [2, 102], [3, 103], [4, 104], [5, 105], [6, 106]]);
      assert.deepEqual(floorsOf(t).filter((f) => f.hidden).map((f) => [f.id, f.number]), ids.map((id, i) => [id, 101 + i]), 'same floors, same order');
      assert.equal(get(t.db, 'SELECT number FROM floors WHERE slug=?', seven.slug).number, 7, 'a floor that is not hidden stays put');
      const before = dump(t.db);
      assert.deepEqual(parkHiddenFloors(t.db, t.cfg, { from: 1, to: 6, at: 101 }), [], 'running it again moves nothing');
      assert.equal(dump(t.db), before);
      assert.equal(get(t.db, 'SELECT label FROM app_labels WHERE floor_id=?', ids[4]).label, 'neon--floor-5', 'the published address stays');
      // Its own link still answers, its owner is still its owner.
      const r = await new Client(t).get(`/api/floors/${cos[4].slug}`);
      assert.equal(r.status, 200); assert.equal(r.data.floor.number, 105);
      assert.equal((await cos[4].get('/api/me')).data.floor.number, 105);
      // The lobby: only the building, the numbers free for use, and the counts right.
      const lobby = (await new Client(t).get('/api/floors')).data;
      assert.deepEqual(lobby.floors.map((f) => f.number), [7]);
      assert.deepEqual(lobby.toLet, [1, 2, 3, 4, 5, 6, 8, 9, 10]);
      assert.equal(lobby.vacant, 1);
      // And a new company can now have one of those numbers.
      const fresh = await claim(t, 'Newcomer');
      assert.equal(fresh.number, 1);
    } finally { await t.close(); }
  });
  test('a clash means nothing moves at all, and it never goes back inside the building', async () => {
    const { t, seven } = await build();
    try {
      await claim(t, 'In The Way', { floor: 9 });  // so 104 can be made to clash
      run(t.db, 'UPDATE floors SET number=104 WHERE slug=(SELECT slug FROM floors WHERE number=9)');
      const before = floorsOf(t);
      assert.throws(() => parkHiddenFloors(t.db, t.cfg, { from: 1, to: 6, at: 101 }), RenumberError);
      assert.deepEqual(floorsOf(t), before, 'all or nothing');
      assert.throws(() => parkHiddenFloors(t.db, t.cfg, { from: 1, to: 6, at: 5 }), RenumberError);
      assert.deepEqual(floorsOf(t), before);
      void seven;
    } finally { await t.close(); }
  });
  test('a new floor opened on a number whose old floor-N slug moved away still takes its name in the address', async () => {
    const { t } = await build();
    try {
      run(t.db, "UPDATE floors SET slug='floor-5' WHERE number=5");  // like Neon Hive
      parkHiddenFloors(t.db, t.cfg, { from: 5, to: 5, at: 105 });
      run(t.db, 'UPDATE floors SET hidden=0 WHERE number=7');
      // Floors 1 to 4 and 6 are hidden and full, so a code with no name lands on 5, whose plain slug is held.
      const c = new Client(t); const code = t.code();
      const claimed = await c.post('/api/claim', { code, colors: { primary: '#aa3300', accent: '#ffcc00' } });
      assert.equal(claimed.status, 201); assert.equal(claimed.data.number, 5); assert.equal(claimed.data.slug, 'floor-5-2');
      c.csrf = claimed.data.csrf;
      const r = await c.post(`/api/floors/${claimed.data.slug}/settings`, { name: 'Harbour Lights', tagline: 'x', boss: { name: 'Boss' } });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      assert.equal(get(t.db, 'SELECT slug FROM floors WHERE number=5').slug, 'harbour-lights');
    } finally { await t.close(); }
  });
  test('moveFloor puts a company on an empty floor, says so if it is already there, and refuses a taken or held floor', async () => {
    const { t, seven } = await build();
    try {
      assert.deepEqual(moveFloor(t.db, t.cfg, { slug: seven.slug, to: 9 }), { from: 7, to: 9, moved: true });
      assert.deepEqual(moveFloor(t.db, t.cfg, { slug: seven.slug, to: 9 }), { from: 9, to: 9, moved: false }, 'safe to run twice');
      assert.equal(get(t.db, 'SELECT number FROM floors WHERE slug=?', seven.slug).number, 9);
      assert.throws(() => moveFloor(t.db, t.cfg, { slug: seven.slug, to: 3 }), RenumberError);  // a hidden floor is on it
      assert.throws(() => moveFloor(t.db, t.cfg, { slug: seven.slug, to: 11 }), RenumberError);  // not inside the building
      issueCode(t.db, 8);
      assert.throws(() => moveFloor(t.db, t.cfg, { slug: seven.slug, to: 8 }), RenumberError);  // a code is holding it
      assert.throws(() => moveFloor(t.db, t.cfg, { slug: 'no-such-floor', to: 8 }), RenumberError);
    } finally { await t.close(); }
  });
});

describe('admin CLI with hidden floors above the building', () => {
  const dirs = [];
  after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
  const seeded = () => {
    const dir = mkdtempSync(join(tmpdir(), 'office-tower-')); dirs.push(dir);
    const db = openDb(dir);
    const floor = (number, slug, hidden, filler = 0) => { run(db, "INSERT INTO floors (slug,number,name,colors,boss,decor,recovery_hash,created_at,hidden,filler) VALUES (?,?,?,?,?,?,'x',1,?,?)", slug, number, slug, JSON.stringify({ primary: '#111111', accent: '#222222' }), JSON.stringify({ name: 'B', look: {} }), JSON.stringify({}), hidden, filler); };
    for (let n = 1; n <= 6; n++) floor(n, `test-co-${n}`, 1);
    floor(34, 'pigeon-logistics', 0, 1); floor(37, 'mildly-haunted-candles', 0, 1);
    issueCode(db, null, 1794154206423);
    db.close();
    return dir;
  };
  const cli = (dir, ...args) => {
    const r = spawnSync(process.execPath, ['--no-warnings', join(ROOT, 'scripts/admin.mjs'), ...args], { env: { ...process.env, DATA_DIR: dir, AI_MODE: 'mock', TOWER_FLOORS: '10' }, encoding: 'utf8', timeout: 30000 });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  test('the whole move, in order, works and can be run again', () => {
    const dir = seeded();
    for (const args of [['floors', 'park', '--from', '1', '--to', '6', '--at', '101'], ['floors', 'move', '--slug', 'pigeon-logistics', '--to', '1'], ['floors', 'move', '--slug', 'mildly-haunted-candles', '--to', '2'], ['code', 'hold', '--issued-at', '1794154206423', '--floor', '3']]) {
      let r = cli(dir, ...args); assert.equal(r.code, 0, r.out);
      r = cli(dir, ...args); assert.equal(r.code, 0, `twice: ${r.out}`);
    }
    const db = openDb(dir);
    assert.deepEqual(all(db, 'SELECT number FROM floors ORDER BY number').map((f) => f.number), [1, 2, 101, 102, 103, 104, 105, 106]);
    assert.equal(get(db, 'SELECT slug FROM floors WHERE number=1').slug, 'pigeon-logistics');
    assert.equal(get(db, 'SELECT slug FROM floors WHERE number=106').slug, 'test-co-6');
    assert.equal(get(db, 'SELECT floor_number n FROM codes WHERE created_at=1794154206423').n, 3);
    db.close();
    const listing = cli(dir, 'floors');
    assert.equal(listing.code, 0);
    assert.match(listing.out, /101\s+active.*\[hidden\]/);
  });
  test('login, hide, show and daily name a floor above the building; code --floor keeps to the building', () => {
    const dir = seeded();
    cli(dir, 'floors', 'park', '--from', '1', '--to', '6', '--at', '101');
    const login = cli(dir, 'login', '--floor', '105', '--minutes', '5');
    assert.equal(login.code, 0, login.out); assert.ok(login.out.trim().length > 20, 'a session token');
    assert.equal(cli(dir, 'floors', 'show', '--floor', '101').code, 0);
    assert.equal(cli(dir, 'floors', 'hide', '--floor', '101').code, 0);
    const daily = cli(dir, 'daily', 'run', '105');
    assert.equal(daily.code, 0, daily.out);
    const code = cli(dir, 'code', '--floor', '105');
    assert.notEqual(code.code, 0); assert.match(code.out, /--floor must be 1 to 10/);
    const db = openDb(dir);
    assert.equal(get(db, 'SELECT COUNT(*) n FROM codes WHERE floor_number=105').n, 0);
    db.close();
  });
});
