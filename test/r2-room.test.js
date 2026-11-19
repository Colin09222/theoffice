// Round 2, lane A: the floor room (docs/redesign/OFFICE-ANSWERS-2.md). The room's rules are plain functions, run here with a fake clock and
// stand-ins for the people, and the room's data comes from the server's snapshot.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, claim, Client, waitDone } from './helpers.js';
import { FloorLife } from '../public/js/life.js';
import { PLANS, makeNav } from '../public/js/layouts.js';
import { IDLE, IdleRounds, floorIsIdle, frameLayout, FRAMES, poseFor, glancing, GLANCE, BeatGate, BEATS, whiteboardRows, pileSheets, queuedFor, trophiesFor, PILE_MAX, PHONE_LIMITS, shedPlan, skipFrame, phoneDpr, levelFor, QualityWatch, QUALITY, CameraFollow, driftYaw, CAMERA, replayTimeline, replayLabel, REPLAY } from '../public/js/room-rules.js';
import { weekOf } from '../server/weekplan.js';
import { get, all, run as sql } from '../server/db.js';
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

describe('r2-j39 state-true poses', () => {
  test('DONE MEANS (rules): a Builder on a running job types fast with the monitor glow, even between keystrokes', () => {
    for (const state of ['typing', 'thinking', 'browsing', 'queued']) {
      const p = poseFor({ role: 'builder', state, running: true });
      assert.deepEqual([p.anim, p.screen, p.glow, p.fast], ['type', 'code', true, true], state);
    }
    assert.equal(poseFor({ role: 'builder', state: 'idle', running: true }).anim, 'type', 'a running task with the state not caught up yet');
    const off = poseFor({ role: 'builder', state: 'idle', running: false });
    assert.deepEqual([off.anim, off.glow, off.fast], ['sit', false, false], 'no running job: no typing');
  });
  test('researching spreads papers, testing holds a clipboard, others keep their state; an Idle floor never types', () => {
    assert.equal(poseFor({ role: 'researcher', state: 'reading' }).prop, 'papers');
    assert.equal(poseFor({ role: 'researcher', state: 'reading' }).anim, 'think');
    assert.equal(poseFor({ role: 'tester', state: 'thinking', running: true }).prop, 'clipboard');
    assert.equal(poseFor({ role: 'tester', state: 'idle', running: false }).prop, null, 'a prop only while on a job');
    assert.equal(poseFor({ role: 'manager', state: 'talking' }).anim, 'talk');
    for (const role of ['builder', 'researcher', 'tester', 'manager']) {
      const p = poseFor({ role, state: 'idle', floorIdle: true });
      assert.deepEqual([p.anim, p.screen, p.glow, p.prop], ['sit', 'off', false, null], role);
    }
  });
  test('a waiting floor\'s beans glance at the boss door once every 15 s, each on its own beat; never on other floors', () => {
    for (const id of ['1', '2', 'nico', 'bea']) {
      const on = []; for (let t = 0; t < 60; t += 0.1) on.push(glancing(t, id, 'waiting'));
      const starts = on.filter((x, i) => x && !on[i - 1]).length;
      assert.ok(starts >= 4 && starts <= 5, `${id}: ${starts} glances in 60 s`);
      const share = on.filter(Boolean).length / on.length;
      assert.ok(Math.abs(share - GLANCE.HOLD / GLANCE.EVERY) < 0.02, `${id} glances ${share}`);
    }
    for (const st of ['working', 'idle', 'paused']) for (let t = 0; t < 30; t += 0.5) assert.equal(glancing(t, '1', st), false);
    const a = [], b = []; for (let t = 0; t < 15; t += 0.1) { a.push(glancing(t, '1', 'waiting')); b.push(glancing(t, '2', 'waiting')); }
    assert.notDeepEqual(a, b, 'not in step');
  });
});

describe('r2-j40 result beats', () => {
  test('DONE MEANS (rules): a real launch gives one cheer; a failed check one slump; a passed check one high five', () => {
    const g = new BeatGate();
    const launch = g.plan({ kind: 'launch', record: { type: 'launch', id: 'shop@1700000000000' } });
    assert.deepEqual([launch.anim, launch.hold, launch.who], ['cheer', 2, 'all']);
    assert.equal(g.plan({ kind: 'launch', record: { type: 'launch', id: 'shop@1700000000000' } }), null, 'the same launch never cheers twice');
    const fail = g.plan({ kind: 'check', passed: false, agent: 7, record: { type: 'task', id: 41 } });
    assert.deepEqual([fail.anim, fail.hold, fail.who], ['slump', 1.5, 7]);
    assert.equal(g.plan({ kind: 'check', passed: false, agent: 7, record: { type: 'task', id: 41 } }), null, 'one slump per check');
    const pass = g.plan({ kind: 'check', passed: true, agent: 7, record: { type: 'task', id: 42 } });
    assert.deepEqual([pass.anim, pass.hold], ['five', 1.5]);
    assert.deepEqual(BEATS, { launch: { anim: 'cheer', hold: 2 }, pass: { anim: 'five', hold: 1.5 }, fail: { anim: 'slump', hold: 1.5 } });
  });
  test('the gate refuses anything without a record type and number, and anything that is not a launch or a check', () => {
    const g = new BeatGate();
    for (const ev of [{ kind: 'launch' }, { kind: 'launch', record: { id: 3 } }, { kind: 'launch', record: { type: 'launch' } }, { kind: 'launch', record: { type: 'launch', id: '' } }, { kind: 'check', passed: true, record: { type: 'task', id: 1 } }, { kind: 'party', record: { type: 'x', id: 1 } }, null]) assert.equal(g.plan(ev), null, JSON.stringify(ev));
    assert.equal(g.refused, 7);
  });

  let t, c;
  before(async () => { t = await boot(); c = await claim(t, 'Beat Box'); });
  after(async () => { await t.close(); });
  test('a Tester\'s finished check sends one beat event: passed or failed, the task as its record; RESULT_BEATS=0 sends none', async () => {
    const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
    const tid = Number(sql(t.db, "INSERT INTO agents (floor_id,role,title,name,look,created_at) VALUES (?,'tester','Tester','Tess','{}',1)", f.id).lastInsertRowid);
    const tester = get(t.db, 'SELECT * FROM agents WHERE id=?', tid);
    const task = (title) => Number(sql(t.db, "INSERT INTO tasks (floor_id,title,brief,agent_id,status,created_at,updated_at) VALUES (?,?,?,?, 'doing', ?, ?)", f.id, title, 'check it', tester.id, Date.now(), Date.now()).lastInsertRowid);
    const beats = () => all(t.db, "SELECT data FROM events WHERE floor_id=? AND type='beat' ORDER BY id", f.id).map((e) => JSON.parse(e.data));
    const a = task('Check the page'); t.app.engine.finishTask(f, tester, a, 'review', 'PASS: the page loads and the form sends.');
    const b = task('Check the form'); t.app.engine.finishTask(f, tester, b, 'review', 'FAIL: the form does not send.');
    assert.deepEqual(beats(), [{ kind: 'check', passed: true, agent: tester.id, task: a }, { kind: 'check', passed: false, agent: tester.id, task: b }]);
    const builder = get(t.db, "SELECT * FROM agents WHERE floor_id=? AND role='builder'", f.id);
    const d = Number(sql(t.db, "INSERT INTO tasks (floor_id,title,brief,agent_id,status,created_at,updated_at) VALUES (?,?,?,?, 'doing', ?, ?)", f.id, 'Build', 'b', builder.id, Date.now(), Date.now()).lastInsertRowid);
    t.app.engine.finishTask(f, builder, d, 'review', 'Built it.');
    assert.equal(beats().length, 2, 'only a Tester\'s check is a check');
    t.cfg.resultBeats = false;
    const e = task('Check again'); t.app.engine.finishTask(f, tester, e, 'review', 'PASS');
    assert.equal(beats().length, 2);
    t.cfg.resultBeats = true;
  });
});

describe('r2-j41 whiteboard plan', () => {
  let t, c, f, visitor;
  const task = (title, plan, status, project = '') => Number(sql(t.db, 'INSERT INTO tasks (floor_id,title,brief,plan,status,project,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)', f.id, title, title, plan, status, project, Date.now(), Date.now()).lastInsertRowid);
  before(async () => { t = await boot(); c = await claim(t, 'Board Room'); f = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug); visitor = new Client(t, { origin: null }); });
  after(async () => { await t.close(); });

  test('DONE MEANS: the whiteboard lists the current plan\'s jobs and ticks one when it is done', async () => {
    const ids = ['Sketch the page', 'Build the page', 'Write the words', 'Test the form', 'Launch it', 'A sixth job'].map((x, i) => task(x, 'This week: A tyre shop page', i === 0 ? 'doing' : 'todo'));
    sql(t.db, "INSERT INTO weekly_plans (floor_id,week,status,goal,jobs,created_at,started_at,task_ids) VALUES (?,?,'started','A tyre shop page','[]',?,?,?)", f.id, weekOf(Date.now()), Date.now(), Date.now(), JSON.stringify(ids));
    const wb = (await visitor.get(`/api/floors/${c.slug}`)).data.room.whiteboard;
    assert.equal(wb.source, 'week'); assert.equal(wb.goal, 'A tyre shop page');
    assert.deepEqual(wb.jobs.map((j) => j.title), ['Sketch the page', 'Build the page', 'Write the words', 'Test the form', 'Launch it'], 'up to 5');
    let rows = whiteboardRows(wb, []);
    assert.equal(rows.done, 0); assert.equal(rows.total, 5); assert.equal(rows.rows[0].now, true);
    sql(t.db, "UPDATE tasks SET status='done' WHERE id=?", ids[0]);
    const after = (await visitor.get(`/api/floors/${c.slug}`)).data.room.whiteboard;
    rows = whiteboardRows(after, []);
    assert.deepEqual(rows.rows.map((r) => r.tick), [true, false, false, false, false], 'one tick for the one job done');
    assert.equal(rows.done, 1);
    // Live: the page's own task list ticks the next one before any reload.
    rows = whiteboardRows(after, [{ id: ids[1], status: 'done' }]);
    assert.equal(rows.done, 2); assert.equal(rows.rows[1].tick, true);
    assert.equal(whiteboardRows(after, [{ id: ids[1], status: 'review' }]).rows[1].tick, false, 'a job waiting for review is not done yet');
  });
  test('with no started week plan: the newest open plan; a visitor never sees a private job; nothing to show is null; ROOM_WHITEBOARD=0', async () => {
    sql(t.db, "UPDATE weekly_plans SET status='draft' WHERE floor_id=?", f.id);
    sql(t.db, "INSERT INTO projects (floor_id,slug,title,private,created_at) VALUES (?,'hush','Hush',1,?)", f.id, Date.now());
    task('Plan the menu', 'Open the cafe', 'done'); task('Hush hush', 'Open the cafe', 'doing', 'hush'); task('Print the menu', 'Open the cafe', 'todo');
    const wb = (await visitor.get(`/api/floors/${c.slug}`)).data.room.whiteboard;
    assert.equal(wb.source, 'plan'); assert.equal(wb.goal, 'Open the cafe');
    assert.deepEqual(wb.jobs.map((j) => [j.title, j.done]), [['Plan the menu', true], ['Private task', false], ['Print the menu', false]]);
    assert.ok(!JSON.stringify(wb).includes('Hush'));
    assert.equal((await c.get(`/api/floors/${c.slug}`)).data.room.whiteboard.jobs[1].title, 'Hush hush', 'the boss sees their own');
    assert.equal(whiteboardRows(null), null); assert.equal(whiteboardRows({ goal: 'x', jobs: [] }), null);
    t.cfg.roomWhiteboard = false;
    assert.equal((await visitor.get(`/api/floors/${c.slug}`)).data.room.whiteboard, null);
    t.cfg.roomWhiteboard = true;
    const fresh = await claim(t, 'Empty Board');
    assert.equal((await visitor.get(`/api/floors/${fresh.slug}`)).data.room.whiteboard, null, 'a floor with no plan has none');
  });
});

/** Real visits, the way the visit counter keeps them: unique visitors a day, per path. */
const visit = (db, floorId, project, day, uniques, path = '/') => sql(db, 'INSERT INTO app_visits (floor_id,project,day,path,views,uniques) VALUES (?,?,?,?,?,?)', floorId, project, day, path, uniques, uniques);

describe('r2-j42 paper piles and trophies', () => {
  test('one sheet per queued job, at most 5; an empty queue is an empty tray; phone low is one flat sheet or none', () => {
    assert.deepEqual([0, 1, 3, 5, 9].map((n) => pileSheets(n)), [0, 1, 3, 5, PILE_MAX]);
    assert.deepEqual([0, 1, 3, 9].map((n) => pileSheets(n, { low: true })), [0, 1, 1, 1]);
    const tasks = [{ agentId: 4, status: 'todo' }, { agentId: 4, status: 'todo' }, { agent_id: 4, status: 'todo' }, { agentId: 4, status: 'doing' }, { agentId: 5, status: 'todo' }, { agentId: 4, status: 'done' }];
    assert.equal(queuedFor(tasks, 4), 3, 'only their own jobs waiting to start');
    assert.equal(pileSheets(queuedFor(tasks, 4)), 3, 'DONE MEANS (rules): a bean with 3 queued jobs has 3 sheets');
    assert.equal(queuedFor(tasks, 9), 0);
  });
  test('trophies: first launch, 100, 1,000, 10,000 real visits; never more than 4; none for nothing', () => {
    assert.deepEqual(trophiesFor({ launches: 0, visits: 0 }), []);
    assert.deepEqual(trophiesFor({ launches: 1, visits: 99 }).map((x) => x.id), ['first-launch']);
    assert.deepEqual(trophiesFor({ launches: 3, visits: 2241 }).map((x) => x.id), ['first-launch', 'visits-100', 'visits-1000']);
    assert.equal(trophiesFor({ launches: 9, visits: 99999 }).length, 4);
    assert.deepEqual(trophiesFor(null), []);
  });

  let t, six, visitor;
  before(async () => { t = await boot(); six = await claim(t, 'TheTireRx', { floor: 6 }); visitor = new Client(t, { origin: null }); });
  after(async () => { await t.close(); });
  test('DONE MEANS: floor 6 shows the 1,000-visit trophy, from the launch cards\' own visit counts', async () => {
    const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', six.slug);
    publish(t.db, f.id, 'thetirerx', 'TheTireRx', Date.now() - 30 * 86400000);
    publish(t.db, f.id, 'gallery', 'Gallery', Date.now() - 20 * 86400000);
    publish(t.db, f.id, 'secret', 'Secret', Date.now(), { priv: 1 });
    visit(t.db, f.id, 'thetirerx', '2026-10-01', 900); visit(t.db, f.id, 'thetirerx', '2026-11-01', 700, '/menu'); visit(t.db, f.id, 'gallery', '2026-11-10', 641);
    visit(t.db, f.id, 'secret', '2026-11-10', 50000);
    visit(t.db, f.id, 'never-launched', '2026-11-10', 50000);
    const m = (await visitor.get(`/api/floors/${six.slug}`)).data.room.milestones;
    assert.deepEqual(m, { launches: 2, visits: 2241 }, 'private work and unlaunched pages count for nothing');
    assert.ok(trophiesFor(m).some((x) => x.id === 'visits-1000'));
    assert.ok(!trophiesFor(m).some((x) => x.id === 'visits-10000'));
    t.cfg.roomProps = false;
    const off = (await visitor.get(`/api/floors/${six.slug}`)).data.room;
    assert.equal(off.milestones, null); assert.equal(off.props, false);
    t.cfg.roomProps = true;
  });
});

describe('r2-j44 phone hard limits', () => {
  test('the numbers are the spec\'s: 30 fps, pixel ratio 1.5, one shadow light, 60,000 triangles, 2 MB', () => {
    assert.deepEqual(PHONE_LIMITS, { fps: 30, dpr: 1.5, shadowLights: 1, triangles: 60000, bytes: 2 * 1024 * 1024 });
  });
  test('the frame cap holds a 60 Hz and a 120 Hz screen to 30 frames a second, and lets every frame through with no cap', () => {
    for (const hz of [60, 120]) {
      let last, drawn = 0;
      for (let now = 0; now < 10000; now += 1000 / hz) if (!skipFrame(now, last, 30)) { last = now; drawn++; }
      assert.ok(drawn >= 295 && drawn <= 301, `${hz} Hz drew ${drawn} frames in 10 s`);
    }
    let n = 0; for (let now = 0; now < 1000; now += 1000 / 60) if (!skipFrame(now, undefined, 0)) n++;
    assert.equal(n, 61);
    assert.deepEqual([phoneDpr(2), phoneDpr(1.5), phoneDpr(1), phoneDpr(2, false)], [1.5, 1.5, 1, 2]);
  });
  test('shedding goes in order and stops as soon as the room fits; nothing is shed when it already fits', () => {
    const steps = [['city', 48000], ['shore', 3000], ['detail', 2500]];
    assert.deepEqual(shedPlan(107800, steps), { shed: ['city'], left: 59800 });
    assert.deepEqual(shedPlan(112000, steps), { shed: ['city', 'shore', 'detail'], left: 58500 });
    assert.deepEqual(shedPlan(50000, steps), { shed: [], left: 50000 });
    assert.deepEqual(shedPlan(70000, [['city', 0], ['shore', 20000]]), { shed: ['shore'], left: 50000 }, 'a part that saves nothing is left alone');
  });
});

describe('r2-j45 auto quality', () => {
  test('the 2 s frame test: 50 fps or more high, 30 to 49 medium, under 30 low', () => {
    assert.deepEqual([90, 50, 49.9, 30, 29.9, 4].map(levelFor), ['high', 'high', 'mid', 'mid', 'low', 'low']);
    assert.equal(QUALITY.TEST_MS, 2000);
  });
  const feed = (w, fps, secs, from = 0) => { const out = []; for (let t = from; t < from + secs; t += 1 / fps) { const r = w.frame(t); if (r) out.push(r); } return out; };
  test('one drop of one level, once, after 5 s averaging under 24 fps; never on a single slow frame; never twice', () => {
    const w = new QualityWatch('high');
    assert.deepEqual(feed(w, 40, 30), [], '40 fps is fine');
    const slow = feed(w, 20, 6, 30);
    assert.equal(slow.length, 1); assert.equal(slow[0].drop, 'mid');
    assert.deepEqual(feed(w, 20, 30, 36), [], 'never a second drop');
    const v = new QualityWatch('mid'); let t = 0;
    for (; t < 20; t += 1 / 40) v.frame(t);
    v.frame(t + 0.9);  // one long frame
    assert.deepEqual(feed(v, 40, 10, t + 1), [], 'one slow frame moves nothing');
  });
  test('on low, still under 15 fps for 5 s: a still picture, once; try again watches afresh', () => {
    const w = new QualityWatch('low');
    assert.deepEqual(feed(w, 20, 20), [], '20 fps on low stays moving');
    const r = feed(w, 8, 6, 20);
    assert.equal(r.length, 1); assert.equal(r[0].still, true);
    assert.deepEqual(feed(w, 8, 20, 26), [], 'once');
    w.reset();
    assert.equal(feed(w, 8, 6, 50).length, 1, 'after Try again, a phone still too slow gets the picture again');
    const m = new QualityWatch('mid');
    const steps = feed(m, 8, 12);
    assert.deepEqual(steps.map((x) => x.drop || (x.still && 'still')), ['low', 'still'], 'mid drops to low, then the still');
  });
});

describe('r2-j46 camera follow and drift', () => {
  const ev = (id, at = [3, 4]) => ({ record: { type: 'handoff', id }, at });
  test('DONE MEANS (rules): the camera eases to a real handoff in 1.2 s, holds 3 s, eases back in 1.2 s', () => {
    const f = new CameraFollow();
    assert.equal(f.ask(10, ev(1)), true);
    assert.equal(f.pose(10).k, 0);
    assert.ok(f.pose(10.6).k > 0.3 && f.pose(10.6).k < 0.7, 'half way in');
    assert.equal(f.pose(11.2).k, 1); assert.deepEqual(f.pose(13).at, [3, 4]); assert.equal(f.pose(14.19).k, 1);
    assert.ok(f.pose(14.8).k > 0.3 && f.pose(14.8).k < 0.7, 'half way back');
    assert.equal(f.pose(15.41).k, 0, 'home after 5.4 s');
    assert.deepEqual([CAMERA.IN, CAMERA.HOLD, CAMERA.OUT, CAMERA.EVERY], [1.2, 3, 1.2, 20]);
  });
  test('at most once every 20 s; never without a record; a drag turns it off until the switch turns it on', () => {
    const f = new CameraFollow();
    assert.equal(f.ask(0, ev(1)), true);
    assert.equal(f.ask(10, ev(2)), false, 'too soon');
    assert.equal(f.ask(20, ev(3)), true);
    assert.equal(f.ask(41, { at: [1, 1] }), false, 'no record, no follow');
    assert.equal(f.ask(41, { record: { type: 'handoff' }, at: [1, 1] }), false);
    f.drag();
    assert.equal(f.pose(21).k, 0, 'a drag stops it at once');
    assert.equal(f.ask(60, ev(4)), false, 'off after a drag');
    f.set(true);
    assert.equal(f.ask(61, ev(5)), true, 'the switch turns it back on');
    assert.equal(new CameraFollow({ allowed: false }).ask(100, ev(6)), false, 'never on a phone, under reduce motion, or with ROOM_CAMERA=0');
  });
  test('idle drift: nothing for 8 s, then 2 degrees a second, swinging 15 degrees each way', () => {
    const deg = (s) => (driftYaw(s) * 180) / Math.PI;
    assert.equal(driftYaw(0), 0); assert.equal(driftYaw(8), 0);
    assert.ok(Math.abs(deg(9) - 2) < 1e-9, '2 degrees a second');
    assert.ok(Math.abs(deg(15.5) - 15) < 1e-9, 'out to 15');
    assert.ok(Math.abs(deg(23) - 0) < 1e-9 && Math.abs(deg(30.5) + 15) < 1e-9, 'back through 0 to -15');
    let max = 0; for (let s = 8; s < 200; s += 0.05) max = Math.max(max, Math.abs(deg(s)));
    assert.ok(max <= 15 + 1e-9);
    assert.equal(driftYaw(100, { allowed: false }), 0);
  });
});

describe('r2-j47 job event log', () => {
  let t, c;
  before(async () => { t = await boot(); c = await claim(t, 'Event Log'); });
  after(async () => { await t.close(); });
  test('DONE MEANS: every job stores its events with times: card, tasks, handoffs, talk beats and the launch', async () => {
    await c.post(`/api/floors/${c.slug}/chat`, { text: 'go build soup finder' });
    await waitDone(c);
    const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
    const cards = all(t.db, 'SELECT id, title FROM job_cards WHERE floor_id=?', f.id);
    assert.ok(cards.length >= 1);
    const evs = all(t.db, 'SELECT * FROM job_events WHERE floor_id=? ORDER BY id', f.id);
    const kinds = new Set(evs.map((e) => e.kind));
    for (const k of ['card', 'task', 'handoff', 'talk', 'launch']) assert.ok(kinds.has(k), `has ${k} events (${[...kinds].join(', ')})`);
    assert.ok(evs.every((e) => cards.some((x) => x.id === e.card_id)), 'every event belongs to a job');
    assert.ok(evs.every((e, i) => !i || e.created_at >= evs[i - 1].created_at), 'in time order, each with its time');
    assert.ok(evs.filter((e) => e.kind === 'task').every((e) => e.task_id), 'task events name their task');
    const statuses = evs.filter((e) => e.kind === 'task').map((e) => JSON.parse(e.data).status);
    assert.ok(statuses.includes('doing') && statuses.some((s) => s === 'done' || s === 'review'), statuses.join(','));
  });
  test('kept for at least 30 days: JOB_EVENTS_DAYS defaults to 35 and never goes under 30; older ones go', async () => {
    const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
    const day = 86400000, now = Date.now();
    for (const age of [29, 31, 34, 36, 60]) sql(t.db, "INSERT INTO job_events (floor_id, card_id, kind, data, created_at) VALUES (?, 999, 'task', '{}', ?)", f.id, now - age * day);
    const { installEventLog, keepDays } = await import('../server/eventlog.js');
    assert.equal(keepDays({}), 35); assert.equal(keepDays({ jobEventsDays: 10 }), 30); assert.equal(keepDays({ jobEventsDays: 90 }), 90);
    const ext = { db: t.db, cfg: { jobEventsDays: 35 }, engine: { emit() {} }, now: () => now, GET() {} };
    installEventLog(ext).prune();
    const left = all(t.db, 'SELECT created_at FROM job_events WHERE card_id=999').map((r) => Math.round((now - r.created_at) / day)).sort((a, b) => a - b);
    assert.deepEqual(left, [29, 31, 34], 'a month-old job is still there to replay');
  });
  test('JOB_EVENTS=0 records nothing', async () => {
    const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
    const n = () => get(t.db, 'SELECT COUNT(*) n FROM job_events WHERE floor_id=?', f.id).n;
    const before = n(); t.cfg.jobEvents = false;
    const task = get(t.db, 'SELECT id FROM tasks WHERE floor_id=? ORDER BY id LIMIT 1', f.id);
    t.app.engine.emitTask(task.id);
    assert.equal(n(), before);
    t.cfg.jobEvents = true;
    t.app.engine.emitTask(task.id);
    assert.ok(n() > before);
  });
});

describe('r2-j48 replay', () => {
  test('a replay lasts 30 to 60 s whatever the job took, in the real order, long waits squeezed', () => {
    const mk = (gaps) => { let t = 1.7e12; return gaps.map((g, i) => ({ id: i, t: (t += g) })); };
    for (const gaps of [[0, 1000, 2000], [0, ...Array(10).fill(60000)], [0, ...Array(80).fill(5000)], [0, 3600000 * 5, 1000, 1000]]) {
      const r = replayTimeline(mk(gaps));
      assert.ok(r.length >= REPLAY.MIN && r.length <= REPLAY.MAX, `length ${r.length}`);
      assert.ok(r.steps.every((x, i) => !i || x.at >= r.steps[i - 1].at), 'real order');
      assert.ok(r.steps.at(-1).at < r.length && r.steps[0].at >= 0);
    }
    const r = replayTimeline(mk([0, 1000, 3600000 * 5, 1000]));
    assert.ok(r.steps[2].at - r.steps[1].at < r.length / 2, 'five hours of waiting is a pause, not most of the replay');
    assert.deepEqual(replayTimeline([]), { steps: [], length: 0 });
  });
  test('the label: "Replay · <weekday> <HH:MM>", New York time', () => {
    assert.equal(replayLabel(Date.UTC(2026, 10, 17, 19, 10)), 'Replay · Tuesday 14:10');
    assert.equal(replayLabel(Date.UTC(2026, 10, 20, 4, 5)), 'Replay · Thursday 23:05');
  });

  let t, c, visitor;
  before(async () => { t = await boot(); c = await claim(t, 'Replay Floor'); visitor = new Client(t, { origin: null }); });
  after(async () => { await t.close(); });
  test('DONE MEANS (server): an idle floor with a finished job offers its replay; the replay is that job\'s real events, in order', async () => {
    await c.post(`/api/floors/${c.slug}/chat`, { text: 'go build tyre finder' });
    await waitDone(c);
    const s = (await visitor.get(`/api/floors/${c.slug}`)).data;
    assert.equal(s.floor.state, 'idle');
    assert.ok(s.room.replay && s.room.replay.steps >= 3, 'offered');
    const r = (await visitor.get(`/api/floors/${c.slug}/replay`)).data.replay;
    assert.equal(r.card.id, s.room.replay.card);
    const kinds = new Set(r.items.map((x) => x.kind));
    for (const k of ['card', 'task', 'talk']) assert.ok(kinds.has(k), k);
    assert.ok(r.items.every((x, i) => !i || x.t >= r.items[i - 1].t));
    assert.ok(r.items.every((x) => x.id != null), 'every step is a real record');
    assert.ok(replayTimeline(r.items).length <= 60);
  });
  test('a visitor never replays private work or a hushed line; the boss can; REPLAY=0 offers nothing', async () => {
    const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
    const r0 = (await visitor.get(`/api/floors/${c.slug}/replay`)).data.replay;
    sql(t.db, "INSERT INTO job_events (floor_id, card_id, kind, data, created_at) VALUES (?,?,'talk',?,?)", f.id, r0.card.id, JSON.stringify({ beat: 'review', from: 1, text: 'secret words', hush: true }), Date.now());
    const again = (await visitor.get(`/api/floors/${c.slug}/replay`)).data.replay;
    assert.ok(!JSON.stringify(again).includes('secret words'), 'hushed for a visitor');
    assert.ok(JSON.stringify((await c.get(`/api/floors/${c.slug}/replay`)).data.replay).includes('secret words'), 'the boss hears their own floor');
    if (r0.card.project) {
      sql(t.db, 'UPDATE projects SET private=1 WHERE floor_id=? AND slug=?', f.id, r0.card.project);
      const priv = (await visitor.get(`/api/floors/${c.slug}/replay`)).data.replay;
      assert.ok(!priv || priv.card.id !== r0.card.id, 'a private job is never replayed to a visitor');
      assert.equal((await c.get(`/api/floors/${c.slug}/replay`)).data.replay.card.id, r0.card.id);
      sql(t.db, 'UPDATE projects SET private=0 WHERE floor_id=? AND slug=?', f.id, r0.card.project);
    }
    t.cfg.replay = false;
    assert.equal((await visitor.get(`/api/floors/${c.slug}`)).data.room.replay, undefined);
    assert.equal((await visitor.get(`/api/floors/${c.slug}/replay`)).data.replay, null);
    t.cfg.replay = true;
  });
});
