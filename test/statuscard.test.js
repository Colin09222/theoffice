// The floor's status card (docs/redesign, job 15): state, goal, now, last shipped and next for anyone, from task data with no model call; the
// boss's extras stay the boss's; a new floor says it has just moved in. Mock mode.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boot, claim, Client, floorState, waitDone } from './helpers.js';
import { get, run } from '../server/db.js';
import { PRIVATE_JOB } from '../server/jobcards.js';

const DAY = 864e5;
describe('what the card says', () => {
  test('a visitor gets state, goal, now, last shipped and next on an open floor; never a question, money or hours', async () => {
    const t = await boot();
    try {
      const c = await claim(t, 'Card Co');
      const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
      const now = Date.now();
      run(t.db, "INSERT INTO projects (floor_id,slug,title,kind,private,published_at,created_at) VALUES (?,'loopling','Loopling','game',0,?,?)", f.id, now - 3 * DAY, now - 9 * DAY);
      const ids = [];
      for (const [title, status] of [['Look at what players liked', 'done'], ['Make the second level', 'doing'], ['Check it on a phone', 'todo']]) {
        ids.push(Number(run(t.db, "INSERT INTO tasks (floor_id,title,plan,project,status,lane,created_at,updated_at) VALUES (?,?,'Loopling 2','loopling',?,'game',?,?)", f.id, title, status, now, now).lastInsertRowid));
        t.app.engine.emitTask(ids.at(-1));
      }
      run(t.db, "INSERT INTO questions (floor_id,text,created_at) VALUES (?,'Blue or green?',?)", f.id, now);
      const v = await floorState(new Client(t), c.slug);
      assert.ok(['working', 'waiting', 'idle', 'paused'].includes(v.floor.state));
      assert.equal(v.status.lane, 'Game');
      assert.equal(v.status.goal, 'Loopling 2', 'no work-mode goal: the current job is the goal');
      assert.match(v.status.now.line, /^Step 2 of 3: /);
      assert.equal(v.status.next, 'Check it on a phone');
      assert.equal(v.status.lastShipped.title, 'Loopling'); assert.ok(v.status.lastShipped.thumb); assert.ok(v.status.lastShipped.publishedAt);
      assert.equal(v.questions, undefined, 'no questions for a visitor');
      assert.doesNotMatch(JSON.stringify(v.status), /\$|usd|cost|hours|Open 9/i);
      // The boss sees the same card, and the question that waits on them.
      const b = await floorState(c);
      assert.equal(b.status.now.line, v.status.now.line);
      assert.equal(b.questions[0].text, 'Blue or green?');
      // A work-mode goal wins over the job's name.
      run(t.db, "INSERT OR REPLACE INTO work_modes (floor_id, goal) VALUES (?, '1,000 plays')", f.id);
      assert.equal((await floorState(new Client(t), c.slug)).status.goal, '1,000 plays');
    } finally { await t.close(); }
  });
  test('private work stays private on the card', async () => {
    const t = await boot();
    try {
      const c = await claim(t, 'Quiet Co');
      await c.post(`/api/floors/${c.slug}/chat`, { text: 'go build secret plan [private]' });
      await waitDone(c);
      const f = get(t.db, 'SELECT id FROM floors WHERE slug=?', c.slug);
      run(t.db, "UPDATE tasks SET status='doing' WHERE id=(SELECT MAX(id) FROM tasks WHERE floor_id=?)", f.id);
      t.app.engine.emitTask(get(t.db, 'SELECT MAX(id) n FROM tasks WHERE floor_id=?', f.id).n);
      const v = await floorState(new Client(t), c.slug);
      assert.ok(!v.status.now || v.status.now.line === PRIVATE_JOB, JSON.stringify(v.status));
      assert.equal(v.status.lastShipped, null, 'a private project never shows as shipped');
      assert.doesNotMatch(JSON.stringify(v.status), /secret/i);
    } finally { await t.close(); }
  });
  test('a new floor has nothing yet: the card says it has just moved in', async () => {
    const t = await boot();
    try {
      const c = await claim(t, 'New Co');
      const v = await floorState(new Client(t), c.slug);
      assert.deepEqual([v.status.now, v.status.lastShipped, v.status.goal, v.status.next], [null, null, '', '']);
    } finally { await t.close(); }
  });
});

describe('the card on the page', () => {
  const src = readFileSync(new URL('../public/js/status-card.js', import.meta.url), 'utf8');
  test('the visitor\'s fields, the boss\'s extras, the empty state, and marked places for the gauge and Approve plan', () => {
    for (const label of ['Goal', 'Now', 'Last shipped', 'Next', 'Visit website', 'Share', 'Run by ']) assert.ok(src.includes(`'${label}'`), label);
    assert.match(src, /nothingYet \? h\('p\.stc-empty', \{\}, emptyLine\(st\)\)/);  // just moved in, or the floor's last job (job 32)
    assert.match(src, /page\.owner \? bossBits\(page\) : null/);
    assert.match(src, /data-slot': 'fuel-gauge'/); assert.match(src, /data-slot': 'approve-plan'/);
    assert.match(src, /const QUICK = \['Yes', 'No', 'You decide'\]/);
  });
});
