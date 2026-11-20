// Round 2, r2-j56 (docs/redesign/OFFICE-ANSWERS-2.md, Q22 and section 7 "Animations tied to a real record: 100%"; section 6: "An automated test fails
// if any played animation has no record number"). Three layers:
//   1. by code: every place in the mailroom and the floor's tube hook that starts an animation, a stamp or a voice line is reached only through
//      a player that checks the record first;
//   2. by fuzzing: events with a missing or bad record type or number never play, in the mailroom player or the floor's hook;
//   3. end to end: with the real server feed, every animation that played names a record type and a number that really exists in that table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../public/vendor/three/three.module.min.js';
import { boot, claim, Client } from './helpers.js';
import { get, run } from '../server/db.js';
import { decidePurchase } from '../server/purchases.js';
import { diffFeed, EventPlayer, playable } from '../public/js/mailroom-events.js';
import { mailroomFloor, POLL_MS } from '../public/js/mailroom-floor.js';

const src = (p) => readFileSync(new URL(`../public/js/${p}`, import.meta.url), 'utf8');
const TABLES = new Set(['help_requests', 'purchases', 'contractor_jobs']);
/** Fails the test for any played thing without a record type (one of the three tables) and a whole record number above 0. */
function assertAllTied(played, where) {
  for (const e of played) {
    assert.ok(TABLES.has(e.type), `${where}: an animation with no record type: ${JSON.stringify(e)}`);
    assert.ok(Number.isSafeInteger(e.number) && e.number > 0, `${where}: an animation with no record number: ${JSON.stringify(e)}`);
  }
}

test('by code: animations, stamps and lines start only from a player that checked the record', () => {
  const scene = src('mailroom-scene.js'), ui = src('mailroom-ui.js'), floor = src('mailroom-floor.js'), events = src('mailroom-events.js');
  // The player refuses before anything plays.
  assert.match(events, /push\(ev\) \{\n\s*if \(!playable\(ev\)\) \{ this\.refused\+\+; return false; \}/);
  // The 3D room plays only through its player: playEvent has exactly one caller, the player.
  assert.equal(scene.match(/this\.playEvent\(/g).length, 1);
  assert.match(scene, /this\.player = new EventPlayer\(\(ev\) => this\.playEvent\(ev\)\);/);
  // Stamps and lines are only called from inside a player's play function (3D) or the phone's own player.
  const sceneCalls = scene.match(/this\.on(Stamp|Say)\?\.\(/g) || [];
  assert.ok(sceneCalls.length > 0);
  const playBody = scene.slice(scene.indexOf('  playEvent(ev) {'), scene.indexOf('\n  }\n', scene.indexOf('  playEvent(ev) {')));
  assert.equal((playBody.match(/this\.on(Stamp|Say)\?\.\(/g) || []).length, sceneCalls.length, 'every stamp and line in the 3D room is inside playEvent');
  const domBody = ui.slice(ui.indexOf('domPlayer = new EventPlayer('), ui.indexOf('window.__mailroomDomPlayer'));
  assert.equal((ui.match(/\bon(Stamp|Say)\(/g) || []).length, (domBody.match(/\bon(Stamp|Say)\(/g) || []).length, 'every stamp and line on a phone comes from its player');
  // Every event the page plays goes through push (which checks), never straight to playEvent.
  assert.match(ui, /\(view \? view\.player : domPlayer\)\.push\(ev\);/);
  // The floor's hook: walks and the lift ride start only in carry(), which checks the record first.
  const carryBody = floor.slice(floor.indexOf('  function carry(ev) {'));
  assert.match(carryBody, /^  function carry\(ev\) \{\n\s*if \(!playable\(ev\) \|\| ev\.floor !== number\) return false;/);
  assert.equal((floor.match(/\.perform\(/g) || []).length, (carryBody.match(/\.perform\(/g) || []).length, 'every walk starts inside carry()');
  assert.equal((floor.match(/deliver\(ev\)/g) || []).length, 2, 'the lift ride is defined once and started only from carry()');
});

test('by fuzzing: no record type or number, no animation', () => {
  const bad = [null, {}, { event: 'arrive' }, { event: 'arrive', type: 'purchases' }, { event: 'arrive', number: 3 }, { event: 'arrive', type: '', number: 3 },
    { event: 'close', type: 'purchases', number: 0 }, { event: 'close', type: 'purchases', number: -2 }, { event: 'close', type: 'purchases', number: 1.5 }, { event: 'close', type: 'purchases', number: '7' }];
  const played = [];
  const p = new EventPlayer((e) => { played.push(e); return 0; });
  for (const e of bad) assert.equal(p.push(e), false);
  for (let i = 0; i < 20; i++) p.update(0.1);
  assert.deepEqual(played, []); assert.equal(p.refused, bad.length);
  const performed = [];
  const view = { root: new THREE.Group(), actors: new Map([[1, { id: 1, info: { role: 'manager' }, seat: { at: [0, 0] }, perform: () => performed.push(1) }]]) };
  view.root.name = 'floor-6';
  const hook = mailroomFloor(view, { read: async () => ({ items: [] }), now: () => 0 });
  for (const e of bad) assert.equal(hook.carry(e ? { ...e, floor: 6, kind: 'purchase' } : e), false);
  assert.deepEqual(performed, []); assert.deepEqual(hook.played, []);
  assert.equal(playable({ type: 'purchases', number: 9 }), true);
});

test('end to end: every animation that played names a real record of its type (100%)', async () => {
  const t = await boot();
  try {
    const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', (await claim(t, 'TheTireRx')).slug);
    const c = new Client(t);
    const read = async () => (await c.get('/api/mailroom')).data;
    const performed = [];
    const bean = (id, role) => ({ id, info: { role }, isBoss: false, extra: false, seat: { at: [1, 1] }, perform: () => performed.push(id) });
    const view = { root: new THREE.Group(), actors: new Map([[1, bean(1, 'manager')], [2, bean(2, 'builder')]]) };
    view.root.name = `floor-${f.number}`;
    let clock = 0;
    const hook = mailroomFloor(view, { read, now: () => clock });
    const roomPlayed = [];
    const player = new EventPlayer((e) => { roomPlayed.push(e); return 0; });
    let prev = null;
    const reading = async () => { const d = await read(); for (const e of diffFeed(prev, d)) player.push(e); prev = d; clock += POLL_MS; hook.tick(); await new Promise((r) => setTimeout(r, 120)); for (let i = 0; i < 5; i++) player.update(0.1); };
    await reading();
    // Every kind of thing that can happen: arrivals of all three kinds, Send out, closes of every outcome, a hand-back.
    const at = Date.now();
    const h1 = Number(run(t.db, "INSERT INTO help_requests (floor_id,question,created_at,expires_at) VALUES (?,'q',?,?)", f.id, at, at + 3600e3).lastInsertRowid);
    const h2 = Number(run(t.db, "INSERT INTO help_requests (floor_id,question,created_at,expires_at) VALUES (?,'q2',?,?)", f.id, at, at + 3600e3).lastInsertRowid);
    const b1 = Number(run(t.db, "INSERT INTO purchases (floor_id,item,price,why,link,created_at) VALUES (?,'x',1,'x','',?)", f.id, at).lastInsertRowid);
    const b2 = Number(run(t.db, "INSERT INTO purchases (floor_id,item,price,why,link,created_at) VALUES (?,'y',1,'y','',?)", f.id, at).lastInsertRowid);
    const task = Number(run(t.db, "INSERT INTO tasks (floor_id,title,status,contractor,sent_out_at,created_at,updated_at) VALUES (?,'t','blocked',1,?,1,1)", f.id, at).lastInsertRowid);
    const j1 = Number(run(t.db, "INSERT INTO contractor_jobs (floor_id,task_id,title,created_at) VALUES (?,?,'t',?)", f.id, task, at).lastInsertRowid);
    await reading();
    run(t.db, "UPDATE help_requests SET status='answered', answer='a', decided_at=? WHERE id=?", Date.now(), h1);
    run(t.db, "UPDATE help_requests SET status='expired', decided_at=? WHERE id=?", Date.now(), h2);
    decidePurchase(t.db, b1, 'bought', '', Date.now());
    decidePurchase(t.db, b2, 'rejected', '', Date.now());
    run(t.db, "UPDATE contractor_jobs SET status='done', done_at=? WHERE id=?", Date.now(), j1);
    await reading(); await reading();
    for (let i = 0; i < 100; i++) player.update(0.1);
    assert.ok(roomPlayed.length >= 11, `the mailroom played ${roomPlayed.length}`);
    assert.ok(hook.played.length >= 4, `the floor played ${hook.played.length}`);
    assertAllTied(roomPlayed, 'mailroom'); assertAllTied(hook.played, 'floor');
    for (const e of [...roomPlayed, ...hook.played]) assert.ok(get(t.db, `SELECT 1 x FROM ${e.type} WHERE id=? AND floor_id=?`, e.number, f.id), `${e.type} #${e.number} is a real record`);
    assert.equal(performed.length, hook.played.filter((e) => e.event !== 'handback').length, 'every walk on the floor is one of the tied events');
  } finally { await t.close(); }
});

test('the check itself fails on an untied animation', () => {
  assert.throws(() => assertAllTied([{ event: 'arrive', type: 'purchases' }], 'x'), /no record number/);
  assert.throws(() => assertAllTied([{ event: 'arrive', number: 4 }], 'x'), /no record type/);
});
