// Round 2, r2-j51 (docs/redesign/OFFICE-ANSWERS-2.md, Q18; section 6: "A test purchase request makes a folder appear in a bean's hand within 10 s
// and the tray rise by one"). Folders, tube and tray, from the r2-j49 feed; a late visitor sees the current state, nothing replayed. Fake clock,
// fake records, mock mode: the server's real feed is read by the floor's hook with a fake room.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../public/vendor/three/three.module.min.js';
import { boot, claim, Client } from './helpers.js';
import { get, run } from '../server/db.js';
import { diffFeed, playable, EventPlayer, WALK_S, TUBE_S, STAMP_S } from '../public/js/mailroom-events.js';
import { mailroomFloor, POLL_MS } from '../public/js/mailroom-floor.js';

const src = (p) => readFileSync(new URL(`../public/js/${p}`, import.meta.url), 'utf8');
const item = (number, state, kind = 'purchase', floor = 6) => ({ kind, type: { purchase: 'purchases', help: 'help_requests', contractor: 'contractor_jobs' }[kind], number, floor, state, times: {} });

test('the chain\'s numbers: walk 4 s, tube 1.5 s, stamp 0.6 s', () => {
  assert.deepEqual([WALK_S, TUBE_S, STAMP_S], [4, 1.5, 0.6]);
});
test('events from two readings: the first reading makes none; a new open item arrives; an item that closes is closed; a handed-back job rides', () => {
  const a = { items: [item(1, 'open'), item(2, 'open', 'help')] };
  assert.deepEqual(diffFeed(null, a), [], 'a late visitor sees the current state only');
  const b = { items: [item(1, 'bought'), item(2, 'open', 'help'), item(3, 'open'), item(9, 'done', 'contractor')] };
  const ev = diffFeed(a, b);
  assert.deepEqual(ev.map((e) => [e.event, e.type, e.number, e.state]), [['close', 'purchases', 1, 'bought'], ['arrive', 'purchases', 3, 'open']]);
  const c = { items: [item(9, 'open', 'contractor')] }, d = { items: [item(9, 'done', 'contractor')] };
  assert.deepEqual(diffFeed(c, d).map((e) => e.event), ['close', 'handback']);
  assert.deepEqual(diffFeed(b, b), [], 'nothing changed, nothing plays');
});
test('the player refuses an event with no record type or number, and plays the rest one at a time', () => {
  const seen = [];
  const p = new EventPlayer((e) => { seen.push(e.number); return 1; });
  assert.equal(p.push({ event: 'arrive', number: 4 }), false);
  assert.equal(p.push({ event: 'arrive', type: 'purchases' }), false);
  assert.equal(p.push({ event: 'arrive', type: 'purchases', number: 0 }), false);
  assert.equal(p.push({ event: 'arrive', type: 'purchases', number: 5 }), true);
  assert.equal(p.push({ event: 'arrive', type: 'purchases', number: 6 }), true);
  p.update(0.1); assert.deepEqual(seen, [5]); p.update(0.5); assert.deepEqual(seen, [5], 'the first is still playing');
  p.update(0.6); p.update(0.1); assert.deepEqual(seen, [5, 6]);
  assert.equal(p.refused, 3);
  assert.equal(playable({ type: 'purchases', number: 7 }), true);
});

test('a test purchase request puts a folder in a bean\'s hand within 10 s, and the tray rises by one', async () => {
  const t = await boot();
  try {
    const c = await claim(t, 'TheTireRx'); const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
    const client = new Client(t);
    // A fake room: its root, one manager and one staff bean that record what they are asked to do.
    const performed = [];
    const bean = (id, role) => ({ id, info: { role }, isBoss: false, extra: false, seat: { at: [1, 1] }, perform(steps) { performed.push({ id, steps }); } });
    const view = { root: new THREE.Group(), actors: new Map([[1, bean(1, 'manager')], [2, bean(2, 'designer')]]) };
    view.root.name = `floor-${f.number}`;
    let clock = 0;
    const hook = mailroomFloor(view, { read: async () => (await client.get('/api/mailroom')).data, now: () => clock });
    assert.ok(view.root.getObjectByName('tube-point'), 'the floor has its tube point');
    const tick = async () => { hook.tick(); await new Promise((r) => setTimeout(r, 150)); };
    await tick();  // the first reading: the current state only
    const trayBefore = (await client.get('/api/mailroom')).data.robot.tray.folders;
    const at = clock;
    const id = Number(run(t.db, "INSERT INTO purchases (floor_id,item,price,why,link,created_at) VALUES (?,'Test item',5,'test','',?)", f.id, Date.now()).lastInsertRowid);
    for (let n = 0; n < 3 && !performed.length; n++) { clock += POLL_MS; await tick(); }
    assert.ok(clock - at <= 10000, `within 10 s (${clock - at} ms)`);
    assert.equal(performed.length, 1);
    assert.equal(performed[0].id, 2, 'a bean (not the boss) carries it');
    assert.equal(performed[0].steps[0].paper, true, 'the folder is in their hand from the first step');
    assert.deepEqual(hook.played.map((e) => [e.event, e.type, e.number]), [['arrive', 'purchases', id]]);
    assert.equal((await client.get('/api/mailroom')).data.robot.tray.folders, trayBefore + 1, 'the tray rises by one');
    // Another floor's item never walks on this floor.
    const other = get(t.db, 'SELECT * FROM floors WHERE slug=?', (await claim(t, 'Elsewhere')).slug);
    run(t.db, "INSERT INTO purchases (floor_id,item,price,why,link,created_at) VALUES (?,'x',1,'x','',?)", other.id, Date.now());
    clock += POLL_MS; await tick();
    assert.equal(performed.length, 1);
  } finally { await t.close(); }
});
test('the mailroom page plays arrivals down the tube on a desktop, and a phone just shows the tray (no tube animation)', () => {
  const ui = src('mailroom-ui.js'), scene = src('mailroom-scene.js');
  assert.match(ui, /const events = diffFeed\(prev, last\); prev = last;/);
  assert.match(ui, /view\?\.player\.push\(ev\);/);
  assert.match(scene, /if \(ev\.event === 'arrive'\) \{ this\.drop = \{ t: 0, ev \}; this\.inFlight\.visible = true; return TUBE_S; \}/);
  assert.match(src('office-scene.js'), /if \(!this\.host\) \(this\.mailFolders \|\|= mailroomFloor\(this\)\)\.tick\(\);/);
});
