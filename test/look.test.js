// The redesign's look for visitors (docs/redesign/OFFICE-ANSWERS-1.md): demo floors out of public lists, small talk from a fixed list as room
// bubbles only (no model call), and four states, never "Closed" or the hours. All in mock mode.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { boot, claim, Client, adminClient, floorState, sse, until, sleep } from './helpers.js';
import { get, run } from '../server/db.js';
import { BANTER_LINES, pickLines } from '../server/banter.js';
import { floorStateOf } from '../server/look.js';
import { fitToSay } from '../server/gossip.js';

const row = (t, slug) => get(t.db, 'SELECT * FROM floors WHERE slug=?', slug);
const fillers = (t) => t.db.prepare('SELECT * FROM floors WHERE filler=1').all();

describe('demo floors are out of every public list', () => {
  test('directory, lift, ticker, stack and launched wall leave them out; the admin and their own link still have them', async () => {
    const t = await boot({ fillerCompanies: true, fillerTickMs: 20, towerFloors: 30 });
    try {
      const real = await claim(t, 'Real Co');
      const demos = fillers(t);
      assert.equal(demos.length, 2);
      // A demo floor posts lines and a launch of its own; none of it may reach a visitor's list.
      for (const d of demos) {
        run(t.db, "INSERT INTO projects (floor_id,slug,title,kind,private,published_at,created_at) VALUES (?,'fake-launch','Fake launch','site',0,?,?)", d.id, Date.now(), Date.now());
        run(t.db, "INSERT INTO events (floor_id,type,project,data,created_at) VALUES (?,'project','fake-launch',?,?)", d.id, JSON.stringify({ slug: 'fake-launch' }), Date.now());
      }
      await sleep(200);
      const v = new Client(t);
      const lobby = (await v.get('/api/floors')).data;
      assert.deepEqual(lobby.floors.map((f) => f.slug), [real.slug]);
      assert.ok(!lobby.toLet.includes(demos[0].number), 'their numbers are still taken, not offered');
      const ticker = (await v.get('/api/building/ticker?limit=60')).data.items;
      assert.ok(!ticker.some((i) => demos.some((d) => d.slug === i.floor.slug)), JSON.stringify(ticker.slice(0, 3)));
      const staff = (await v.get('/api/building/staff')).data.floors;
      for (const d of demos) assert.equal(staff[d.number], undefined);
      const wall = (await v.get('/api/building/launched')).data.projects;
      assert.ok(!wall.some((p) => p.slug === 'fake-launch'));
      // Still there for the admin, and still reachable by their own link.
      const admin = await adminClient(t);
      const over = (await admin.get('/api/admin/overview')).data;
      for (const d of demos) assert.ok(over.floors.some((f) => f.slug === d.slug), 'the admin still lists it');
      assert.equal((await v.get(`/api/floors/${demos[0].slug}`)).status, 200);
    } finally { await t.close(); }
  });
  test('DEMO_FLOORS_PUBLIC=1 shows them again', async () => {
    const t = await boot({ fillerCompanies: true, fillerTickMs: 20, towerFloors: 30, demoFloorsPublic: true });
    try {
      await until(async () => (await new Client(t).get('/api/building/ticker?limit=60')).data.items.some((i) => i.filler), { what: 'a demo line on the ticker' });
      const lobby = (await new Client(t).get('/api/floors')).data;
      assert.equal(lobby.floors.filter((f) => f.filler).length, 2);
    } finally { await t.close(); }
  });
});

describe('small talk: 200 fixed lines, room bubbles only, no model call', () => {
  test('the list: 200 different short lines, nothing a visitor shouldn\'t read', () => {
    assert.equal(BANTER_LINES.length, 200);
    assert.equal(new Set(BANTER_LINES).size, 200);
    for (const l of BANTER_LINES) {
      assert.ok(l.length > 8 && l.length <= 110, l);
      assert.ok(fitToSay(l), l);
      assert.doesNotMatch(l, /\$|£|€|\bboss\b|\bmoney\b|\bprice|\bpaid\b|\bcost|"/i, l);
    }
  });
  test('picked at random, and a floor doesn\'t hear a line again while it is recent', () => {
    const recent = [];
    const seen = new Set();
    for (let i = 0; i < 13; i++) for (const l of pickLines(3, recent)) { assert.ok(!seen.has(l), `${l} came back too soon`); seen.add(l); }
    assert.equal(seen.size, 39);
    assert.ok(recent.length <= 40);
  });
  test('a watched floor hears bubbles; no model is called, nothing is stored, and Talk never shows it', async () => {
    let calls = 0;
    const llm = { chat() { calls++; throw new Error('no model for small talk'); } };
    const t = await boot({ banterEveryMs: 5, banterBusyEveryMs: 5, banterTickMs: 5, talkGapMs: 1 }, { llm });
    try {
      const c = await claim(t, 'Kettle Co');
      const f = row(t, c.slug);
      calls = 0;
      const watch = sse(new Client(t), c.slug);
      await until(() => watch.events.filter((e) => e.type === 'talk' && e.data.kind === 'banter').length >= 2, { what: 'two bubbles', timeout: 8000 });
      const lines = watch.events.filter((e) => e.type === 'talk' && e.data.kind === 'banter');
      for (const l of lines) { assert.ok(BANTER_LINES.includes(l.data.text), l.data.text); assert.equal(l.data.bubble, true); }
      assert.equal(calls, 0, 'zero model calls');
      assert.equal(get(t.db, "SELECT COUNT(*) n FROM events WHERE floor_id=? AND type='talk' AND data LIKE '%\"banter\"%'", f.id).n, 0, 'never stored');
      assert.equal(get(t.db, "SELECT COUNT(*) n FROM ledger WHERE floor_id=? AND kind LIKE 'talk%'", f.id).n, 0, 'nothing paid');
      // An old model-written line from before the change stays out of Talk too.
      run(t.db, "INSERT INTO events (floor_id,type,project,data,created_at) VALUES (?,'talk','',?,?)", f.id, JSON.stringify({ from: 1, fromName: 'A', text: 'old kettle line', kind: 'banter', ts: Date.now() }), Date.now());
      assert.ok(!(await floorState(new Client(t), c.slug)).talk.some((l) => l.kind === 'banter'));
      assert.ok(!(await floorState(c)).talk.some((l) => l.kind === 'banter'), 'the boss\'s Talk has none either');
      await watch.close();
    } finally { await t.close(); }
  });
  test('BANTER=0 still stops it, and a paused floor is quiet', async () => {
    const t = await boot({ banter: false });
    try {
      const c = await claim(t, 'Quiet Co');
      assert.equal(await t.app.engine.people.banter(row(t, c.slug).id), false);
    } finally { await t.close(); }
    const t2 = await boot();
    try {
      const c = await claim(t2, 'Paused Co');
      run(t2.db, 'UPDATE floors SET paused=1 WHERE slug=?', c.slug);
      assert.equal(await t2.app.engine.people.banter(row(t2, c.slug).id), false);
    } finally { await t2.close(); }
  });
});

describe('four states, never "Closed" or the hours', () => {
  const MON_NY_10 = Date.UTC(2026, 10, 16, 15, 0);  // Monday 10:00 in New York
  test('Working, Waiting on boss, Idle with when, Paused with no reason', async () => {
    const t = await boot();
    try {
      const c = await claim(t, 'State Co');
      const f = row(t, c.slug);
      const e = t.app.engine;
      run(t.db, "UPDATE agents SET state='idle' WHERE floor_id=?", f.id);
      run(t.db, "UPDATE tasks SET status='done' WHERE floor_id=?", f.id);
      const at = Date.now() - 2 * 3600e3;
      run(t.db, "INSERT INTO tasks (floor_id,title,status,created_at,updated_at) VALUES (?,'An old job','done',?,?)", f.id, at, at);
      let s = floorStateOf(t.db, e, f);
      assert.equal(s.state, 'idle'); assert.ok(s.lastActive >= at);
      run(t.db, "UPDATE agents SET state='working' WHERE floor_id=? AND role='builder'", f.id);
      assert.equal(floorStateOf(t.db, e, f).state, 'working');
      run(t.db, "INSERT INTO questions (floor_id,text,created_at) VALUES (?,'Blue or green?',?)", f.id, Date.now());
      assert.equal(floorStateOf(t.db, e, f).state, 'waiting');
      run(t.db, "UPDATE floors SET paused=1, pause_reason='Out sick' WHERE id=?", f.id);
      const v = await floorState(new Client(t), c.slug);
      assert.equal(v.floor.state, 'paused');
      assert.ok(!JSON.stringify(v).includes('Out sick'), 'no reason is shown to a visitor');
      run(t.db, "UPDATE floors SET paused=0, status='suspended' WHERE id=?", f.id);
      assert.equal(floorStateOf(t.db, e, row(t, c.slug)).state, 'paused');
      const card = (await new Client(t).get('/api/floors')).data.floors.find((x) => x.slug === c.slug);
      assert.equal(card.state, 'paused');
    } finally { await t.close(); }
  });
  test('outside set hours a visitor sees a quiet floor, not a closed one; the boss still has the hours', async () => {
    const clock = { t: MON_NY_10 };
    const t = await boot({ modesTickMs: 15, peopleTalk: false }, { now: () => clock.t });
    try {
      const c = await claim(t, 'Hours Co');
      const r = await c.post(`/api/floors/${c.slug}/work-mode`, { mode: 'hours', days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '09:00', end: '17:00', tz: 'America/New_York', goal: 'Sell soup' });
      assert.equal(r.status, 200);
      clock.t = MON_NY_10 + 9 * 3600e3;  // 7pm
      const v = await floorState(new Client(t), c.slug);
      assert.equal(v.floor.workMode.closed, false);
      assert.equal(v.floor.workMode.opensAt, null);
      assert.doesNotMatch(JSON.stringify(v.floor), /Open 9|9–5|Mon–Fri|closed":true/);
      assert.ok(['idle', 'working', 'waiting', 'paused'].includes(v.floor.state));
      const card = (await new Client(t).get('/api/floors')).data.floors.find((x) => x.slug === c.slug);
      assert.equal(card.workMode, undefined, 'the lobby never carries the hours');
      const boss = await floorState(c);
      assert.equal(boss.floor.workMode.label, 'Open 9–5'); assert.equal(boss.floor.workMode.closed, true);
    } finally { await t.close(); }
  });
  test('no "Closed", "gone home" or hours sign in anything a visitor\'s page draws', async () => {
    const { readFileSync } = await import('node:fs');
    const lobby = readFileSync(new URL('../public/js/lobby-ui.js', import.meta.url), 'utf8');
    const stack = readFileSync(new URL('../public/js/stack.js', import.meta.url), 'utf8');
    const floor = readFileSync(new URL('../public/js/floor-ui.js', import.meta.url), 'utf8');
    for (const src of [lobby, stack]) assert.doesNotMatch(src, /gone home|Closed by|closed for now|Closed for now/i);
    // The floor page keeps one plain line for the boss about their own hours, and the banner is empty for a visitor.
    assert.doesNotMatch(floor, /everyone has gone home|label = 'Closed'/);
    assert.match(floor, /if \(!this\.owner\) text = '';/);
    assert.match(floor, /this\.hoursEl\.hidden = !this\.owner;/);
  });
});
