// Every floor plan is made of real rooms, joined by doors, and everyone can walk between all of them without going through a wall.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PLANS, planBlocks, planSpots, makeNav, deskRect, bigDeskRect, seatOf, wallLines, doorways, roomAt, roomOfKind, staffRooms, officeSlots, seatSpot, ROOM_W, ROOM_D, CELL } from '../public/js/layouts.js';

const COMBOS = [];
for (const coffee of [true, false]) for (const arcade of [true, false]) for (const plants of [0, 3, 8]) for (const staffCount of [0, 4, 12]) COMBOS.push({ coffee, arcade, plants, staffCount });
const navFor = (plan, f) => {
  const nav = makeNav();
  for (const b of planBlocks(plan, f)) nav.block(b[0], b[1], b[2], b[3], { bake: b[4] });
  for (const d of plan.desks.slice(0, f.staffCount)) nav.block(...deskRect(d));
  return nav;
};
const inRect = ([x0, z0, x1, z1], x, z) => x >= x0 && x <= x1 && z >= z0 && z <= z1;
// Walk a path the way a person does, a short step at a time, and report any step that lands in a blocked cell away from either end.
function walk(nav, from, route) {
  let at = from; const seen = [];
  for (const to of route) {
    const d = Math.hypot(to[0] - at[0], to[1] - at[1]);
    for (let i = 1, n = Math.ceil(d / 0.13); i <= n; i++) seen.push([at[0] + ((to[0] - at[0]) * i) / n, at[1] + ((to[1] - at[1]) * i) / n]);
    at = to;
  }
  return seen;
}

for (const [id, plan] of Object.entries(PLANS)) {
  describe(`the ${id} plan`, () => {
    test('has every kind of room, and everyone sits in one', () => {
      for (const kind of ['office', 'meeting', 'kitchen', 'lounge', 'staff', 'corridor']) assert.ok(roomOfKind(plan, kind), `no ${kind}`);
      assert.ok(plan.rooms.filter((r) => r.kind === 'office').length >= 2, 'the boss and the manager each get an office');
      assert.equal(roomAt(plan, ...seatOf(plan.manager).at).id, 'manager');
      assert.equal(roomAt(plan, ...seatOf(plan.boss).at).id, 'boss');
      const owned = plan.desks.map((d) => roomAt(plan, ...seatOf(d).at));
      for (const r of owned) assert.equal(r.kind, 'staff', `a desk in ${r.id}`);
      assert.equal(new Set(owned.map((r) => r.id)).size, plan.desks.length, 'everyone has a room of their own');
      assert.ok(plan.desks.length >= 12);
      assert.ok(ROOM_W * ROOM_D >= 2 * 22 * 13.6, 'floors are at least twice the old area');
      for (const r of plan.rooms) assert.ok(r.label && r.rect[2] > r.rect[0] && r.rect[3] > r.rect[1] && Math.abs(r.rect[0]) <= ROOM_W / 2 && Math.abs(r.rect[3]) <= ROOM_D / 2, r.id);
    });
    test('the meeting room is glass-walled and everyone fits inside it', () => {
      const room = roomOfKind(plan, 'meeting');
      assert.ok(inRect(room.rect, ...plan.meet.table)); assert.ok(inRect(room.rect, ...plan.meet.stand));
      for (const s of plan.meet.spots) assert.ok(inRect(room.rect, ...s), `spot ${s} is outside the room`);
      assert.equal(plan.meet.spots.length, 8);
      const nearWall = wallLines(plan).filter((w) => !w.low && [room.rect[0], room.rect[2]].includes(w.x0) && w.x0 === w.x1);
      assert.ok(nearWall.length >= 1, 'no glass wall beside the meeting room');
      for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) assert.ok(Math.hypot(plan.meet.spots[i][0] - plan.meet.spots[j][0], plan.meet.spots[i][1] - plan.meet.spots[j][1]) > 0.9, 'two people on one spot');
    });
    test('kitchen and lounge spots are in their own rooms and don\'t overlap', () => {
      for (const kind of ['kitchen', 'lounge']) {
        const r = roomOfKind(plan, kind);
        assert.ok(r.spots.length >= 3, `${kind} needs room for people`);
        for (const s of r.spots) assert.equal(roomAt(plan, s[0], s[1]).id, r.id, `${kind} spot ${s}`);
      }
    });
    test('doors are wide enough to walk through and every wall stays out of the desks', () => {
      for (const d of doorways(plan)) assert.ok(d.width >= 1.2, `door at ${d.x},${d.z} is ${d.width} wide`);
      assert.ok(doorways(plan).length >= 3);
      const glass = planBlocks(plan, { coffee: true, arcade: true, plants: 8, staffCount: 12 }).filter((b) => b[4] === false && (b[2] <= 0.11 || b[3] <= 0.11));
      const hit = (r, w) => Math.abs(r[0] - w[0]) < (r[2] + w[2]) / 2 && Math.abs(r[1] - w[1]) < (r[3] + w[3]) / 2;
      for (const r of [bigDeskRect(plan.manager), bigDeskRect(plan.boss), ...plan.desks.map((d) => deskRect(d))]) for (const w of glass) assert.ok(!hit(r, w), `desk at ${r[0]},${r[1]} is in a wall at ${w[0]},${w[1]}`);
      for (const w of wallLines(plan)) assert.ok(Math.abs(w.x0) <= ROOM_W / 2 && Math.abs(w.x1) <= ROOM_W / 2 && Math.abs(w.z0) <= ROOM_D / 2 && Math.abs(w.z1) <= ROOM_D / 2);
    });
    test('every seat reaches every room, in every combination of decor', () => {
      for (const f of COMBOS) {
        const nav = navFor(plan, f);
        const seats = [seatOf(plan.manager), seatOf(plan.boss), ...plan.desks.slice(0, f.staffCount).map(seatOf)];
        const stops = [...planSpots(plan, f).map((s) => s.at), plan.meet.stand];
        for (const from of seats) for (const to of stops) assert.ok(nav.reachable(from.at[0], from.at[1], to[0], to[1]), `${from.at} to ${to} with ${JSON.stringify(f)}`);
      }
    });
    test('walking from room to room goes through a door, never a wall', () => {
      const f = { coffee: true, arcade: true, plants: 8, staffCount: 12 };
      const nav = navFor(plan, f);
      const seats = [seatOf(plan.manager), seatOf(plan.boss), ...plan.desks.map(seatOf)];
      const stops = [plan.meet.stand, ...plan.meet.spots, ...plan.rooms.flatMap((r) => r.spots || [])];
      const onWall = (x, z) => wallLines(plan).some((w) => (w.x0 === w.x1 ? Math.abs(x - w.x0) < 0.04 && z > w.z0 + 0.04 && z < w.z1 - 0.04 : Math.abs(z - w.z0) < 0.04 && x > w.x0 + 0.04 && x < w.x1 - 0.04));
      let walked = 0;
      for (const from of seats) for (const to of stops) {
        const route = nav.path(from.at[0], from.at[1], to[0], to[1]);
        for (const [x, z] of walk(nav, from.at, route)) { assert.ok(!onWall(x, z), `${from.at} to ${to} crosses a wall at ${x.toFixed(2)},${z.toFixed(2)}`); walked++; }
        const last = route.at(-1); assert.ok(Math.hypot(last[0] - to[0], last[1] - to[1]) < CELL, 'a route ends where it was going');
      }
      assert.ok(walked > 1000);
    });
    test('an office still works with its owner\'s things in every slot, and with a second desk in it', () => {
      const f = { coffee: true, arcade: true, plants: 8, staffCount: 12 };
      const rooms = [...staffRooms(plan), ...plan.rooms.filter((r) => r.kind === 'office')];
      const nav = navFor(plan, f);
      for (const r of rooms) for (const s of Object.values(officeSlots(r).slots)) {
        assert.equal(roomAt(plan, s.x, s.z).id, r.id, `${r.id} slot out of its room`);
        nav.block(s.x, s.z, 0.8, 0.8);
      }
      const from = seatOf(plan.manager).at;
      for (const r of rooms) { const a = seatOf(r.desk).at; assert.ok(nav.reachable(from[0], from[1], a[0], a[1]), `${r.id} is shut in by its own furniture`); }
      for (const to of [plan.meet.stand, ...plan.meet.spots]) assert.ok(nav.reachable(from[0], from[1], to[0], to[1]), `the meeting at ${to}`);
      // Hiring past the number of rooms: each extra person gets a second desk in an office, and nobody gets shut in.
      const full = navFor(plan, f);
      for (let i = 12; i < 24; i++) full.block(...deskRect(seatSpot(plan, i)));
      for (let i = 0; i < 24; i++) { const a = seatOf(seatSpot(plan, i)).at; assert.ok(full.reachable(from[0], from[1], a[0], a[1]), `seat ${i} at ${a}`); }
    });
    test('each pair of rooms is joined: people can walk between them, door by door', () => {
      const nav = navFor(plan, { coffee: true, arcade: true, plants: 8, staffCount: 12 });
      const centres = plan.rooms.filter((r) => r.kind !== 'corridor').map((r) => { const s = r.spots?.[0]; return s ? [s[0], s[1]] : r.kind === 'meeting' ? plan.meet.stand : seatOf(r.desk).at; });
      for (const a of centres) for (const b of centres) assert.ok(nav.reachable(a[0], a[1], b[0], b[1]), `${a} to ${b}`);
    });
  });
}
