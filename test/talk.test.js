// The dialogue on a floor: real words from the engine, cut down and never invented, under the same privacy rules as the feed.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, claim, Client, sse, floorState, waitDone, until, sleep } from './helpers.js';
import { get, run } from '../server/db.js';
import { talkLine, PRIVATE_TALK, BOSS_ONLY_TALK } from '../server/talk.js';
import { FloorLife, SMALL_TALK, planProgress, readingTime } from '../public/js/life.js';
import { PLANS, makeNav } from '../public/js/layouts.js';

const talkOf = (s, kind) => s.talk.filter((l) => !kind || l.kind === kind);
const live = (st) => st.events.filter((e) => e.type === 'talk').map((e) => e.data);
const floorRow = (t, slug) => get(t.db, 'SELECT * FROM floors WHERE slug=?', slug);

describe('a line is cut from the real thing', () => {
  test('shortened at a sentence or a word, with markup and code taken out', () => {
    assert.equal(talkLine('# Plan\n\n**Do** the `thing` now.'), 'Plan Do the thing now.');
    assert.equal(talkLine('Look:\n```js\nsecret();\n```\nDone.'), 'Look: Done.');
    const long = talkLine(`${'First sentence that runs a fair way along the line. '.repeat(2)}${'More words here '.repeat(30)}`);
    assert.ok(long.length <= 171, long); assert.ok(long.endsWith('.'), long);
    const words = talkLine('word '.repeat(90)); assert.ok(words.endsWith('…')); assert.ok(!words.includes('  '));
  });
  test('no dollar figure gets through, in any spelling', () => {
    for (const s of ['It cost $4.50 today', 'budget of $1,200', 'about 20 USD', 'USD 20 left', 'pay 15 dollars', 'US$9', '$3k a year', 'worth 40 bucks']) {
      const out = talkLine(s);
      assert.ok(!/\$\s?\d|\d\s?(usd|dollars?|bucks)|usd\s?\d/i.test(out), `${s} became ${out}`);
    }
  });
  test('a signed link loses its secret part, and invisible characters go', () => {
    assert.equal(talkLine('See https://x.io/p/a?sig=abc123&exp=9#top now'), 'See https://x.io/p/a now');
    assert.equal(talkLine('Hi[slow] there'), 'Hi there');
    const hidden = [0x202e, 0x200b, 0x2028].map((c) => String.fromCodePoint(c));
    const clean = talkLine(`a${hidden[0]}b${hidden[1]}c${hidden[2]}d`);
    for (const c of hidden) assert.ok(!clean.includes(c));
  });
  test('empty text says nothing at all', () => { assert.equal(talkLine('   '), ''); assert.equal(talkLine(null), ''); });
});

describe('talk events from the engine', () => {
  let t; let c;
  before(async () => { t = await boot(); });
  after(async () => { await t.close(); });

  test('assignment, handoff and review each carry the real words, from and to the right people', async () => {
    c = await claim(t, 'Talk One');
    const s = sse(c, c.slug); await sleep(20);
    await c.post(`/api/floors/${c.slug}/chat`, { text: 'go build soup finder' });
    const f = await waitDone(c);
    await sleep(30);
    const mgr = f.agents.find((a) => a.role === 'manager');
    const assigns = talkOf(f, 'assign');
    assert.equal(assigns.length, 4);
    for (const l of assigns) {
      assert.equal(l.from, mgr.id); assert.equal(l.fromName, mgr.name);
      const task = f.tasks.find((x) => x.agentId === l.to);
      assert.ok(task, `no task for ${l.toName}`);
      assert.equal(l.text, talkLine(task.brief || task.title));
    }
    const handoffs = talkOf(f, 'handoff').filter((l) => l.to === mgr.id);
    assert.equal(handoffs.length, 4);
    for (const l of handoffs) { const task = f.tasks.find((x) => x.agentId === l.from); assert.equal(l.text, talkLine(task.result)); }
    const reviews = talkOf(f, 'review');
    assert.equal(reviews.length, 4);
    for (const l of reviews) { assert.equal(l.from, mgr.id); assert.equal(l.text, 'Looks good.'); assert.ok(f.tasks.some((x) => x.agentId === l.to)); }
    assert.equal(talkOf(f, 'plan')[0].text, f.tasks[0].plan);
    // The stream and the snapshot say the same thing.
    assert.deepEqual(live(s).map((l) => l.text).sort(), f.talk.map((l) => l.text).sort());
    await s.close();
  });
  test('the colleague a task builds on walks over and hands on their real report', async () => {
    const f = await floorState(c);
    const builder = f.agents.find((a) => a.role === 'builder'), designer = f.agents.find((a) => a.role === 'designer');
    const passed = f.talk.find((l) => l.kind === 'handoff' && l.to === builder.id);
    assert.ok(passed, 'no handoff to the builder');
    assert.equal(passed.from, designer.id);
    assert.equal(passed.text, talkLine(f.tasks.find((x) => x.agentId === designer.id).result));
  });
  test('a task sent back carries the manager\'s note, and the second round adds no second handover', async () => {
    const r = await claim(t, 'Talk Revise');
    await r.post(`/api/floors/${r.slug}/chat`, { text: 'go build a thing [revise]' });
    const f = await waitDone(r);
    const writer = f.agents.find((a) => a.role === 'writer');
    const toWriter = f.talk.filter((l) => l.kind === 'review' && l.to === writer.id);
    assert.ok(toWriter.length >= 2, `only ${toWriter.length} reviews`);
    assert.ok(toWriter.every((l) => l.text === 'Looks good.'));
    const builder = f.agents.find((a) => a.role === 'builder');
    assert.equal(f.talk.filter((l) => l.kind === 'handoff' && l.to === builder.id).length, 1);
  });
  test('a tester\'s report is marked as findings', async () => {
    const q = await claim(t, 'Talk Tester');
    const row = floorRow(t, q.slug);
    assert.equal((await q.post(`/api/floors/${q.slug}/hire`, { role: 'tester' })).status, 201);
    const mgr = get(t.db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", row.id);
    const tester = get(t.db, "SELECT * FROM agents WHERE floor_id=? AND role='tester'", row.id);
    const { id } = t.app.engine.assignTask(row, mgr, { to: 'tester', title: 'Try the buttons', brief: 'Press them all.', plan: '', project: '', private: false, dependsOn: [], afterPrevious: false });
    run(t.db, "UPDATE tasks SET status='doing' WHERE id=?", id);
    t.app.engine.finishTask(row, tester, id, 'review', 'The back button does nothing on the second page.');
    const f = await floorState(q);
    const line = f.talk.find((l) => l.kind === 'findings');
    assert.ok(line); assert.equal(line.text, 'The back button does nothing on the second page.'); assert.equal(line.to, mgr.id);
    run(t.db, "UPDATE tasks SET status='done' WHERE floor_id=?", row.id);
  });
  test('a question and its answer are the boss\'s to read; a visitor only learns one was asked', async () => {
    const q = await claim(t, 'Talk Question');
    const visitor = new Client(t);
    const vs = sse(visitor, q.slug); await sleep(20);
    await q.post(`/api/floors/${q.slug}/chat`, { text: 'go build a thing [ask]' });
    const asked = await until(async () => { const s = await floorState(q); return s.questions?.length ? s : null; }, { what: 'the question' });
    const line = asked.talk.find((l) => l.kind === 'question');
    assert.equal(line.text, asked.questions[0].text); assert.equal(line.to, 'boss');
    await q.post(`/api/floors/${q.slug}/questions/${asked.questions[0].id}/answer`, { text: 'Silly, with a hidden moose' });
    const done = await waitDone(q);
    const ans = done.talk.find((l) => l.kind === 'answer');
    assert.equal(ans.text, 'Silly, with a hidden moose'); assert.equal(ans.from, 'boss');
    const v = await floorState(visitor, q.slug);
    const body = JSON.stringify(v.talk) + JSON.stringify(live(vs));
    assert.ok(!body.includes(line.text), 'a visitor read the question'); assert.ok(!body.includes('hidden moose'), 'a visitor read the answer');
    assert.equal(v.talk.find((l) => l.kind === 'question').text, BOSS_ONLY_TALK.question);
    assert.equal(v.talk.find((l) => l.kind === 'answer').text, BOSS_ONLY_TALK.answer);
    await vs.close();
  });
  test('a private project is hidden from a visitor in the snapshot, the live stream and a replay; the boss still reads it', async () => {
    const p = await claim(t, 'Talk Private');
    const visitor = new Client(t);
    const vs = sse(visitor, p.slug); await sleep(20);
    await p.post(`/api/floors/${p.slug}/chat`, { text: 'go build hush thing [private]' });
    const f = await waitDone(p); await sleep(30);
    assert.ok(f.talk.some((l) => /hush/i.test(l.text)), 'the boss should read the real words');
    const v = await floorState(visitor, p.slug);
    const replay = sse(visitor, p.slug, { since: 1 }); await sleep(80);
    for (const [name, lines] of [['snapshot', v.talk], ['live', live(vs)], ['replay', live(replay)]]) {
      assert.ok(lines.length > 0, `${name} is empty`);
      for (const l of lines) { assert.equal(l.kind, 'private', `${name}: ${JSON.stringify(l)}`); assert.equal(l.text, PRIVATE_TALK); assert.equal(l.project, undefined); }
      assert.ok(!/hush|launch/i.test(JSON.stringify(lines)), `${name} leaked`);
    }
    await vs.close(); await replay.close();
  });
  test('making a project private later hides what was already said about it', async () => {
    const p = await claim(t, 'Talk Later');
    await p.post(`/api/floors/${p.slug}/chat`, { text: 'go build moon cheese' });
    await waitDone(p);
    const visitor = new Client(t);
    const before_ = await floorState(visitor, p.slug);
    assert.ok(before_.talk.some((l) => /moon/i.test(l.text)), 'should be public at first');
    const row = floorRow(t, p.slug);
    run(t.db, 'UPDATE projects SET private=1 WHERE floor_id=?', row.id);
    const after_ = await floorState(visitor, p.slug);
    assert.ok(!/moon/i.test(JSON.stringify(after_.talk)), 'still readable after going private');
    assert.ok(!/moon/i.test(JSON.stringify(after_.talk.map((l) => l.text))));
  });
  test('a default-private floor hides talk with no project, and a public line can\'t name a private project', async () => {
    const p = await claim(t, 'Talk Default');
    const row = floorRow(t, p.slug);
    const mgr = get(t.db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", row.id);
    run(t.db, 'UPDATE floors SET default_private=1 WHERE id=?', row.id);
    t.app.engine.talk(row.id, mgr, null, 'Nothing tagged here', { kind: 'plan' });
    const visitor = new Client(t);
    assert.ok(!/Nothing tagged/.test(JSON.stringify((await floorState(visitor, p.slug)).talk)));
    run(t.db, 'UPDATE floors SET default_private=0 WHERE id=?', row.id);
    run(t.db, "INSERT INTO projects (floor_id,slug,title,created_at,private) VALUES (?,'zeppelin-deal','Zeppelin deal',1,1)", row.id);
    run(t.db, "INSERT INTO projects (floor_id,slug,title,created_at,private) VALUES (?,'open-thing','Open thing',1,0)", row.id);
    t.app.engine.talk(row.id, mgr, null, 'This follows the Zeppelin deal closely', { kind: 'plan', project: 'open-thing' });
    const v = await floorState(visitor, p.slug);
    assert.ok(v.talk.some((l) => /follows the private closely/.test(l.text)), JSON.stringify(v.talk));
    assert.ok(!/Zeppelin/i.test(JSON.stringify(v.talk)));
  });
  test('a floor\'s words stay on that floor, and hostile text stays plain data', async () => {
    const a = await claim(t, 'Talk A'); const b = await claim(t, 'Talk B');
    const row = floorRow(t, a.slug);
    const mgr = get(t.db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", row.id);
    t.app.engine.talk(row.id, mgr, null, '<img src=x onerror=alert(1)> costs $90 only here', { kind: 'plan' });
    assert.ok(!JSON.stringify((await floorState(b)).talk).includes('onerror'));
    const line = (await floorState(a)).talk.at(-1);
    assert.equal(line.text, '<img src=x onerror=alert(1)> costs an amount only here');
  });
  test('talk costs nothing: no model call, no ledger row', async () => {
    const a = await claim(t, 'Talk Free');
    const row = floorRow(t, a.slug);
    const n = get(t.db, 'SELECT COUNT(*) n FROM ledger WHERE floor_id=?', row.id).n;
    const mgr = get(t.db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", row.id);
    t.app.engine.talk(row.id, mgr, null, 'Hello', { kind: 'plan' });
    assert.equal(get(t.db, 'SELECT COUNT(*) n FROM ledger WHERE floor_id=?', row.id).n, n);
  });
});

describe('filler floors read from a script', () => {
  test('lines flow through the same event, with no model, no spend and no money', async () => {
    const t = await boot({ fillerCompanies: true, fillerTickMs: 5 });
    try {
      const floors = t.db.prepare('SELECT * FROM floors WHERE filler=1').all();
      assert.ok(floors.length >= 1, 'no filler floors');
      const visitor = new Client(t);
      const talk = await until(async () => { const s = await floorState(visitor, floors[0].slug); return ['assign', 'handoff', 'review'].every((k) => s.talk.some((l) => l.kind === k)) ? s.talk : null; }, { what: 'scripted lines', timeout: 20000 });
      assert.ok(!/\$\s?\d/.test(JSON.stringify(talk)));
      assert.ok(talk.every((l) => l.fromName && l.text.length > 2));
      assert.equal(get(t.db, 'SELECT COUNT(*) n FROM ledger').n, 0);
      const tasks = t.db.prepare('SELECT DISTINCT plan FROM tasks WHERE floor_id=?').all(floors[0].id);
      assert.ok(tasks.every((x) => /^Batch of /.test(x.plan)), JSON.stringify(tasks));
    } finally { await t.close(); }
  });
});

describe('what people do with the words', () => {
  test('small talk stays small: no claim that any work happened', () => {
    const CLAIMS = /\b(finish|finished|done|shipped|published|built|deployed|launched|fixed|sent|reviewed|approved|tested|client|customer|task|project|report|deadline|\$)\b/i;
    for (const pair of SMALL_TALK) for (const l of pair) { assert.ok(!CLAIMS.test(l), l); assert.ok(l.length < 40, l); }
  });
  test('reading time grows with the line, within limits', () => {
    assert.equal(readingTime('hi'), 2.6); assert.equal(readingTime('x'.repeat(400)), 8); assert.ok(readingTime('x'.repeat(90)) > 5);
  });
  test('progress is counted from real tasks in this plan, never guessed', () => {
    const tasks = [{ id: 1, plan: 'Old', status: 'done' }, { id: 2, plan: 'P', status: 'done' }, { id: 3, plan: 'P', status: 'review' }, { id: 4, plan: 'P', status: 'doing' }, { id: 5, plan: 'P', status: 'cancelled' }, { id: 6, plan: 'P', status: 'todo' }];
    assert.deepEqual(planProgress(tasks, tasks[3]), { done: 2, total: 4 });
    assert.equal(planProgress([{ id: 9, plan: 'Solo', status: 'doing' }], { id: 9, plan: 'Solo' }), null, 'one task is not a count');
    assert.equal(planProgress(tasks, { id: 99, plan: 'P' }), null);
    assert.equal(planProgress([{ id: 1, plan: '', status: 'doing' }, { id: 2, plan: '', status: 'doing' }], { id: 1, plan: '' }), null);
  });
  const fakeView = (ids) => {
    const view = { time: 0, plan: PLANS.open, decor: { coffee: true, arcade: false }, plantSpots: [], nav: makeNav(), claims: new Map(), actors: new Map(), visitSpot: (seat) => ({ at: [seat.at[0] + 1, seat.at[1] + 1], face: 0 }) };
    for (const id of ids) view.actors.set(id, { id, info: { name: id }, state: 'idle', seated: true, seat: { at: [0, 0] }, path: [], group: { position: { x: 0, z: 0 } }, performed: [], scene: false, perform(steps, o) { this.performed.push(steps); this.scene = !!o?.scene; } });
    view.life = new FloorLife(view);
    return view;
  };
  test('a meeting claims the assignments that arrived with it, and reads the plan first', () => {
    const v = fakeView(['m', 'a', 'b']);
    v.life.line({ from: 'm', to: 'a', text: 'Do the first thing', kind: 'assign' });
    v.life.line({ from: 'm', to: 'b', text: 'Do the second thing', kind: 'assign' });
    v.life.line({ from: 'm', to: null, text: 'The big plan', kind: 'plan' });
    v.life.meeting('m', ['a', 'b']);
    const said = v.actors.get('m').performed[0].filter((s) => s.say).map((s) => s.say);
    assert.deepEqual(said, ['The big plan', 'Do the first thing', 'Do the second thing']);
    assert.equal(v.actors.get('a').performed.length, 1);
    v.time = 5; v.life.update();
    assert.equal(v.life.queues.size, 0, 'the lines were spoken at the meeting, so none are left over');
  });
  test('an assignment with no meeting walks over to the person, and a backlog is said from where they stand', () => {
    const v = fakeView(['m', 'a', 'b']);
    v.life.line({ from: 'm', to: 'a', text: 'One', kind: 'assign' });
    v.life.update(); assert.equal(v.actors.get('m').performed.length, 0, 'waits a beat for a meeting');
    v.time = 2; v.life.update();
    assert.ok(v.actors.get('m').performed[0].some((s) => s.walk), 'should walk over');
    v.actors.get('m').scene = false;
    for (const text of ['Two', 'Three', 'Four']) v.life.line({ from: 'm', to: 'b', text, kind: 'review' });
    v.life.update();
    assert.ok(!v.actors.get('m').performed[1].some((s) => s.walk), 'a backlog is said on the spot');
    assert.equal(v.actors.get('m').performed[1].find((s) => s.say).say, 'Two');
  });
  test('more lines than anyone can act out keeps the newest; a paper handoff after words does not play twice', () => {
    const v = fakeView(['m', 'a']);
    v.actors.get('a').scene = true;
    for (let i = 0; i < 6; i++) v.life.line({ from: 'a', to: 'm', text: `L${i}`, kind: 'handoff' });
    assert.deepEqual(v.life.queues.get('a').map((e) => e.text), ['L3', 'L4', 'L5']);
    v.actors.get('a').performed = [];
    v.life.handoff('a', 'm');
    assert.equal(v.actors.get('a').performed.length, 0);
    v.life.handoff('a', 'm');
    assert.equal(v.actors.get('a').performed.length, 1, 'a second one with no words behind it does play');
  });
});
