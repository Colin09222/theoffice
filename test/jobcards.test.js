// Status from code (docs/redesign, job 12): one timeline card per job, updated in place, every word put together by code from the task rows,
// and no model call for a status line. Mock mode.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { boot, claim, Client, floorState, waitDone, sse, until } from './helpers.js';
import { get, all, run } from '../server/db.js';
import { cardFor, jobKey, refreshCard, PRIVATE_JOB } from '../server/jobcards.js';
import { createMockClient } from '../server/mock.js';

const names = { 1: 'Arlo', 2: 'Mina', 3: 'Margot' };
const nameOf = (id) => names[id] || '';
const T = (id, status, agent, title) => ({ id, status, agent_id: agent, title, plan: 'Build the booking site', project: 'site' });

describe('what a card says', () => {
  test('step N of M, who and what, from the task rows alone', () => {
    let c = cardFor([T(1, 'todo', 1, 'Research rivals'), T(2, 'todo', 2, 'Write the copy'), T(3, 'todo', 3, 'Build the page')], nameOf);
    assert.deepEqual([c.state, c.step, c.steps, c.line], ['todo', 1, 3, 'Step 1 of 3: up next for Arlo, Research rivals']);
    c = cardFor([T(1, 'done', 1, 'Research rivals'), T(2, 'doing', 2, 'Write the copy'), T(3, 'todo', 3, 'Build the page')], nameOf);
    assert.deepEqual([c.state, c.step, c.who, c.line], ['working', 2, 'Mina', 'Step 2 of 3: Mina is on Write the copy']);
    c = cardFor([T(1, 'done', 1, 'Research rivals'), T(2, 'review', 2, 'Write the copy'), T(3, 'todo', 3, 'Build the page')], nameOf);
    assert.equal(c.line, 'Step 2 of 3: Mina handed in Write the copy'); assert.equal(c.state, 'review');
    c = cardFor([T(1, 'done', 1, 'Research rivals'), T(2, 'done', 2, 'Write the copy'), T(3, 'cancelled', 3, 'Build the page')], nameOf);
    assert.deepEqual([c.state, c.step, c.steps, c.line], ['done', 2, 2, 'Done, all 2 steps. Mina finished Write the copy'], 'a step called off no longer counts');
    c = cardFor([T(1, 'done', 1, 'Research rivals'), T(2, 'failed', 2, 'Write the copy')], nameOf);
    assert.deepEqual([c.state, c.line], ['failed', 'Step 2 of 2: Mina could not finish Write the copy']);
    c = cardFor([T(1, 'blocked', 1, 'Pick a name')], nameOf);
    assert.deepEqual([c.state, c.line], ['waiting', 'Step 1 of 1: Arlo is waiting on Pick a name']);
    assert.equal(cardFor([T(1, 'cancelled', 1, 'x')], nameOf).state, 'cancelled');
    assert.equal(jobKey({ id: 9, plan: '', project: '' }), 't:9', 'a lone task is a job of one step');
    assert.equal(jobKey({ id: 1, plan: 'A', project: 'p' }), jobKey({ id: 2, plan: 'A', project: 'p' }));
  });
});

describe('on a floor', () => {
  test('one card per job, made with the job and updated in place; zero model calls for status; the boss and a visitor both get it', async () => {
    const calls = [];
    const inner = createMockClient({ mockDelayMs: 1 });
    const llm = { chat(x) { calls.push(x.meta?.purpose || x.meta?.kind || 'work'); return inner.chat(x); } };
    const t = await boot({ peopleTalk: true }, { llm });
    try {
      const c = await claim(t, 'Card Co');
      const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
      const watch = sse(new Client(t), c.slug);
      await c.post(`/api/floors/${c.slug}/chat`, { text: 'go build a small thing' });
      await waitDone(c); await t.app.engine.people.settled();
      const tasks = all(t.db, "SELECT * FROM tasks WHERE floor_id=? AND status!='cancelled'", f.id);
      const jobs = new Set(tasks.map(jobKey));
      const cards = all(t.db, 'SELECT * FROM job_cards WHERE floor_id=?', f.id);
      assert.equal(cards.length, jobs.size, 'one card per job, however many times its tasks changed');
      assert.ok(cards.every((x) => x.state === 'done' && x.step === x.steps), JSON.stringify(cards.map((x) => [x.state, x.line])));
      assert.ok(cards.some((x) => x.steps > 1), 'the build is a job of several steps');
      // Updated in place: the stream carried several versions of the same card.
      await until(() => watch.events.filter((e) => e.type === 'jobcard_public').length >= 3, { what: 'card updates on the stream' });
      const versions = watch.events.filter((e) => e.type === 'jobcard_public');
      assert.ok(new Set(versions.map((e) => e.data.id)).size <= jobs.size);
      assert.ok(versions.some((e) => /^Step \d of \d: /.test(e.data.line)), JSON.stringify(versions.map((e) => e.data.line)));
      assert.ok(!watch.events.some((e) => e.type === 'jobcard'), 'the boss\'s own version never reaches a visitor');
      // No model call wrote a status line: no planning huddle, no round report.
      assert.equal(calls.filter((p) => p === 'meeting').length, 0, JSON.stringify(calls));
      // Readable by the status card and the timeline.
      const boss = await floorState(c);
      assert.equal(boss.jobs.length, cards.length);
      assert.ok(boss.jobs[0].line && boss.jobs[0].title && boss.jobs[0].updatedAt);
      const visitor = await floorState(new Client(t), c.slug);
      assert.equal(visitor.jobs.length, cards.length);
      await watch.close();
    } finally { await t.close(); }
  });
  test('private work: a visitor reads only that it is private', async () => {
    const t = await boot();
    try {
      const c = await claim(t, 'Secret Co');
      await c.post(`/api/floors/${c.slug}/chat`, { text: 'go build secret plan [private]' });
      await waitDone(c);
      const v = await floorState(new Client(t), c.slug);
      assert.ok(v.jobs.length > 0);
      assert.ok(v.jobs.every((j) => j.title === PRIVATE_JOB && j.line === PRIVATE_JOB && j.project === ''), JSON.stringify(v.jobs));
      const b = await floorState(c);
      assert.ok(b.jobs.some((j) => j.title !== PRIVATE_JOB));
    } finally { await t.close(); }
  });
  test('refreshing a card with nothing changed writes nothing', async () => {
    const t = await boot();
    try {
      const c = await claim(t, 'Still Co');
      const f = get(t.db, 'SELECT id FROM floors WHERE slug=?', c.slug);
      const now = Date.now();
      const r = run(t.db, "INSERT INTO tasks (floor_id,title,status,created_at,updated_at) VALUES (?,'One thing','todo',?,?)", f.id, now, now);
      const id = Number(r.lastInsertRowid);
      assert.ok(refreshCard(t.db, id, now));
      assert.equal(refreshCard(t.db, id, now + 5), null);
      run(t.db, "UPDATE tasks SET status='doing' WHERE id=?", id);
      assert.equal(refreshCard(t.db, id, now + 9).state, 'working');
      assert.equal(get(t.db, 'SELECT COUNT(*) n FROM job_cards WHERE floor_id=?', f.id).n, 1);
    } finally { await t.close(); }
  });
  for (const old of [false, true]) {
    test(old ? 'STATUS_FROM_CODE=0: the round report is in the chat again' : 'a round the team runs on its own reports by its job card: the manager\'s words stay in its memory, not the chat', async () => {
      const clock = { t: Date.UTC(2026, 10, 16, 15, 0) };
      const t = await boot({ modesTickMs: 15, ordersTickMs: 60000, mockDelayMs: 1, peopleTalk: false, autopilotGapMin: 0, statusFromCode: !old }, { now: () => clock.t });
      try {
        const c = await claim(t, 'Own Steam Co');
        const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
        await c.post(`/api/floors/${c.slug}/work-mode`, { mode: 'nonstop', goal: 'Write things' });
        await until(() => get(t.db, "SELECT 1 x FROM messages WHERE floor_id=? AND role='manager' AND text LIKE 'Picked the next job%'", f.id), { what: 'a round report written', timeout: 20000 });
        const shown = (await floorState(c)).messages.some((m) => /^Picked the next job/.test(m.text));
        assert.equal(shown, old);
        if (!old) {
          assert.ok(get(t.db, 'SELECT COUNT(*) n FROM quiet_messages WHERE floor_id=?', f.id).n > 0);
          await until(() => get(t.db, 'SELECT 1 x FROM job_cards WHERE floor_id=?', f.id), { what: 'the job card' });
        }
      } finally { await t.close(); }
    });
  }
});
