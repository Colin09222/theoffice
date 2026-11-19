// Round 2, lane A: the floor room (docs/redesign/OFFICE-ANSWERS-2.md). The room's rules are plain functions, run here with a fake clock and
// stand-ins for the people, and the room's data comes from the server's snapshot.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, claim, Client } from './helpers.js';
import { FloorLife } from '../public/js/life.js';
import { PLANS, makeNav } from '../public/js/layouts.js';
import { IDLE, IdleRounds, floorIsIdle, frameLayout, FRAMES } from '../public/js/room-rules.js';
import { get } from '../server/db.js';
import { REAL_JPEG, publish } from './r2-fixtures.js';
import { storeShot } from '../server/shots.js';
import { roomFrames } from '../server/room.js';

/** A room with stand-ins for its people, enough for life.js to run. Every step they're given is kept, and walks finish at once. */
export function fakeRoom(ids, { floorState = 'idle', coffee = true } = {}) {
  const view = { time: 0, floorState, plan: PLANS.open, decor: { coffee, arcade: false }, plantSpots: [], nav: makeNav(), claims: new Map(), actors: new Map(), visitSpot: (seat) => ({ at: [seat.at[0] + 1, seat.at[1] + 1], face: 0 }) };
  for (const id of ids) {
    view.actors.set(id, {
      id, info: { name: id }, state: 'idle', seated: true, seat: { at: [0, 0] }, path: [], group: { position: { x: 0, z: 0 } }, performed: [], scene: false, action: null, poses: 0,
      isBoss: id === 'boss',
      perform(steps, o) { this.performed.push(steps); this.scene = !!o?.scene; this.action = steps.at(-1); this.seated = !steps.some((s) => s.walk) && this.seated; },
      applyStatePose() { this.poses++; },
    });
  }
  view.life = new FloorLife(view);
  return view;
}
const run = (v, secs, dt = 0.25) => { for (let t = 0; t < secs; t += dt) { v.time += dt; v.life.update(); } };
const steps = (v) => [...v.actors.values()].flatMap((a) => a.performed.flat());

describe('r2-j31 lived-in idle floors', () => {
  test('an Idle floor is Idle or Paused with nobody at work; Working and Waiting on boss are not', () => {
    assert.equal(floorIsIdle('idle', [{ state: 'idle' }, { state: 'idle' }]), true);
    assert.equal(floorIsIdle('paused', [{ state: 'idle' }]), true);
    assert.equal(floorIsIdle('idle', [{ state: 'idle' }, { state: 'typing' }]), false, 'someone at a desk right now');
    assert.equal(floorIsIdle('working', [{ state: 'idle' }]), false);
    assert.equal(floorIsIdle('waiting', [{ state: 'idle' }]), false);
  });

  test('the rounds: one bean every 10 to 20 s, a move of 4 to 8 s, one of the four moves, never the same twice running', () => {
    const r = new IdleRounds();
    const people = [{ id: 'a', seated: true }, { id: 'b', seated: true }];
    let last = 0; const gaps = []; const moves = new Set(); const by = new Map();
    r.tick(0, true, people);
    for (let t = 0.1; t < 2000; t += 0.1) {
      const turn = r.tick(t, true, people);
      if (!turn) continue;
      if (last) gaps.push(t - last);
      last = t; moves.add(turn.move);
      assert.ok(IDLE.MOVES.includes(turn.move));
      assert.ok(turn.hold >= 4 && turn.hold <= 8, `hold ${turn.hold}`);
      assert.notEqual(by.get(turn.who.id), turn.move, 'a different move from last time');
      by.set(turn.who.id, turn.move);
    }
    assert.ok(gaps.length > 50);
    assert.ok(Math.min(...gaps) >= 10 - 0.11 && Math.max(...gaps) <= 20 + 0.11, `gaps ${Math.min(...gaps)}..${Math.max(...gaps)}`);
    assert.deepEqual([...moves].sort(), [...IDLE.MOVES].sort(), 'all four moves get played');
  });

  test('no kettle without a kitchen, and no stretch for someone already out of their chair', () => {
    const r = new IdleRounds();
    r.tick(0, true, []);
    for (let t = 1; t < 3000; t += 1) {
      const turn = r.tick(t, true, [{ id: 'up', seated: false }], { kitchen: false });
      if (turn) assert.ok(turn.move === 'lounge' || turn.move === 'read', turn.move);
    }
  });

  test('DONE MEANS: on an Idle floor no bean types and at least one idle move plays within 20 s', () => {
    for (let trial = 0; trial < 20; trial++) {
      const v = fakeRoom(['m', 'a', 'b', 'boss']);
      run(v, 20);
      const all = steps(v);
      assert.ok(all.some((s) => s.idleMove), 'an idle move within 20 s');
      assert.ok(!all.some((s) => s.anim === 'type'), 'nobody types');
      assert.ok(!all.some((s) => s.say), 'an idle move says nothing');
      assert.equal(v.actors.get('boss').performed.length, 0, 'the boss stays in their office');
    }
  });

  test('the team drifts off: after a move a bean stays where it went, resting, until it is picked again or work arrives', () => {
    const v = fakeRoom(['a']);
    run(v, 20);
    const a = v.actors.get('a');
    const moved = a.performed.at(-1);
    if (moved.some((s) => s.walk)) {
      assert.ok(moved.at(-1).idleRest, 'ends resting where it went');
      assert.equal(moved.at(-1).until(), false, 'while the floor stays Idle');
      v.floorState = 'working';
      assert.equal(moved.at(-1).until(), true, 'work brings them back to their desk');
    } else assert.equal(moved[0].anim, 'stretch', 'a stretch is done at the desk');
  });

  test('a Working or Waiting floor gets no idle rounds, and someone at work stops them at once', () => {
    for (const floorState of ['working', 'waiting']) {
      const v = fakeRoom(['a', 'b'], { floorState });
      run(v, 60);
      assert.ok(!steps(v).some((s) => s.idleMove), floorState);
    }
    const v = fakeRoom(['a', 'b']);
    v.actors.get('a').state = 'typing';
    run(v, 60);
    assert.ok(!steps(v).some((s) => s.idleMove));
  });

  test('going Idle re-poses everyone, so the screens go dark; IDLE_LIFE off leaves the old breaks', () => {
    const v = fakeRoom(['a']);
    v.life.update();
    assert.equal(v.life.wasIdle, true);
    assert.ok(v.actors.get('a').poses >= 1);
    const off = fakeRoom(['a']); off.idleLife = false;
    run(off, 60);
    assert.equal(off.life.wasIdle, false);
    assert.ok(!steps(off).some((s) => s.idleMove));
  });
});

describe('the room in the snapshot', () => {
  let t, boss, visitor;
  before(async () => { t = await boot(); boss = await claim(t, 'Room Two'); visitor = new Client(t, { origin: null }); });
  after(async () => { await t.close(); });
  test('the snapshot carries the room switches; IDLE_LIFE=0 turns the idle rounds off', async () => {
    const s = (await visitor.get(`/api/floors/${boss.slug}`)).data;
    assert.equal(s.room.idleLife, true);
    assert.equal(s.floor.state, 'idle');
    t.cfg.idleLife = false;
    assert.equal((await visitor.get(`/api/floors/${boss.slug}`)).data.room.idleLife, false);
    t.cfg.idleLife = true;
  });
});

describe('r2-j32 framed launches', () => {
  const L = (n) => Array.from({ length: n }, (_, i) => ({ slug: `p${i}`, title: `P${i}` }));
  test('one or two launches hang big, one a spot; three to eight hang in 2 by 2 clusters; past eight a +N tag', () => {
    assert.deepEqual(frameLayout([], {}).frames, []);
    const one = frameLayout(L(1));
    assert.equal(one.frames.length, 1); assert.deepEqual([one.frames[0].w, one.frames[0].h], FRAMES.BIG); assert.equal(one.more, 0);
    assert.deepEqual(frameLayout(L(2)).frames.map((f) => f.spot), [0, 1]);
    const five = frameLayout(L(5));
    assert.deepEqual(five.frames.map((f) => f.spot), [0, 0, 0, 0, 1]);
    assert.ok(five.frames.every((f) => f.w === FRAMES.SMALL[0]));
    assert.equal(new Set(five.frames.slice(0, 4).map((f) => `${f.dz},${f.dy}`)).size, 4, 'four places in a cluster');
    const many = frameLayout(L(12));
    assert.equal(many.frames.length, 8); assert.equal(many.more, 4);
    assert.deepEqual(many.frames.map((f) => f.launch.slug), L(8).map((l) => l.slug), 'newest first, as given');
  });
  test('phone low: at most 3, small; a wall with one spot holds 4', () => {
    const low = frameLayout(L(5), { low: true });
    assert.equal(low.frames.length, 3); assert.equal(low.more, 2);
    assert.ok(low.frames.every((f) => f.w === FRAMES.SMALL[0]));
    assert.equal(frameLayout(L(1), { low: true }).frames[0].w, FRAMES.SMALL[0]);
    assert.equal(frameLayout(L(9), { spots: 1 }).frames.length, 4);
  });

  let t, six, visitor;
  before(async () => {
    t = await boot();
    six = await claim(t, 'TheTireRx', { floor: 6 });
    visitor = new Client(t, { origin: null });
  });
  after(async () => { await t.close(); });

  test('DONE MEANS: floor 6\'s wall shows one frame with the real TheTireRx photo', async () => {
    const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', six.slug);
    publish(t.db, f.id, 'thetirerx', 'TheTireRx', Date.now() - 3600000);
    storeShot(t.db, { floorId: f.id, project: 'thetirerx', image: REAL_JPEG, url: 'https://thetirerx.com/' });
    const s = (await visitor.get(`/api/floors/${six.slug}`)).data;
    assert.equal(s.floor.number, 6);
    assert.equal(s.room.frames.total, 1);
    assert.equal(s.room.frames.list.length, 1);
    const [fr] = s.room.frames.list;
    assert.equal(fr.title, 'TheTireRx');
    assert.match(fr.shot, new RegExp(`^/theoffice/api/building/shot/${six.slug}/thetirerx\\?v=\\d+$`));
    const photo = await fetch(`http://${t.host}${fr.shot}`);
    assert.equal(photo.status, 200); assert.equal(photo.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(Buffer.from(await photo.arrayBuffer()), REAL_JPEG, 'the frame is the real photo');
    const lay = frameLayout(s.room.frames.list, { spots: 2 });
    assert.equal(lay.frames.length, 1, 'one frame on the wall');
  });
  test('newest first, private work and demo floors never hang, a launch with no photo hangs a card, ROOM_FRAMES=0 hangs none', async () => {
    const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', six.slug);
    publish(t.db, f.id, 'newer', 'Newer', Date.now());
    publish(t.db, f.id, 'secret', 'Secret', Date.now() + 5, { priv: 1 });
    const s = (await visitor.get(`/api/floors/${six.slug}`)).data;
    assert.deepEqual(s.room.frames.list.map((x) => x.slug), ['newer', 'thetirerx']);
    assert.equal(s.room.frames.list[0].shot, null, 'no photo yet: the room paints a card');
    assert.ok(!JSON.stringify(s.room).includes('Secret'));
    assert.deepEqual(roomFrames(t.db, { ...f, filler: 1 }), { list: [], total: 0 });
    for (let i = 0; i < 9; i++) publish(t.db, f.id, `more-${i}`, `More ${i}`, Date.now() - 7200000 - i);
    const many = (await visitor.get(`/api/floors/${six.slug}`)).data.room.frames;
    assert.equal(many.list.length, 8); assert.equal(many.total, 11);
    t.cfg.roomFrames = false;
    assert.equal((await visitor.get(`/api/floors/${six.slug}`)).data.room.frames, null);
    t.cfg.roomFrames = true;
  });
});
