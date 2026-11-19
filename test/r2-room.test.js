// Round 2, lane A: the floor room (docs/redesign/OFFICE-ANSWERS-2.md). The room's rules are plain functions, run here with a fake clock and
// stand-ins for the people, and the room's data comes from the server's snapshot.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, claim, Client } from './helpers.js';
import { FloorLife } from '../public/js/life.js';
import { PLANS, makeNav } from '../public/js/layouts.js';
import { IDLE, IdleRounds, floorIsIdle, frameLayout, FRAMES, poseFor, glancing, GLANCE, BeatGate, BEATS, whiteboardRows, pileSheets, queuedFor, trophiesFor, PILE_MAX } from '../public/js/room-rules.js';
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
