// A boss's own spend behind a tap (docs/redesign/ROUND1-REST.md, job 34): their floor's dollars only, this week, last week and since it
// opened, split Claude / OpenRouter, and the latest jobs with what each cost. No gauge, no budget, nothing "left", no limits, no building
// totals, no model names. Another floor's boss and a visitor get nothing. The floor snapshot still carries no money. Mock mode.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boot, claim, Client, floorState } from './helpers.js';
import { get, run } from '../server/db.js';
import { weekStart } from '../server/spendcheck.js';
import { ownSpend } from '../server/ownspend.js';

const DAY = 864e5;
const floorOf = (t, c) => get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
const ledger = (t, f, { usd, at, provider = 'anthropic', taskId = null, model = 'claude-haiku-secret-model' }) => run(t.db,
  "INSERT INTO ledger (floor_id,day,agent_id,model,prompt_tokens,completion_tokens,cost_usd,created_at,kind,provider,task_id,computer) VALUES (?,?,NULL,?,10,10,?,?,'model',?,?,0)",
  f.id, new Date(at).toISOString().slice(0, 10), model, usd, at, provider, taskId);
/** A job with one task, its card made as the engine makes it; returns the task id. */
function job(t, f, title) {
  const now = Date.now();
  const id = Number(run(t.db, "INSERT INTO tasks (floor_id,title,plan,project,status,lane,created_at,updated_at) VALUES (?,?,?,'','done','website',?,?)", f.id, title, title, now, now).lastInsertRowid);
  t.app.engine.emitTask(id);
  return id;
}

describe('the boss\'s own figures', () => {
  test('this week, last week and since opened, split Claude and OpenRouter, and the latest jobs with their cost', async () => {
    const t = await boot();
    try {
      const c = await claim(t, 'Own Co'); const f = floorOf(t, c);
      const other = await claim(t, 'Other Co'); const g = floorOf(t, other);
      const wk = weekStart(Date.now());
      const into = (Date.now() - wk) / 4;  // two moments this week, already past even early on a Monday
      const a = job(t, f, 'Build the menu page'), b = job(t, f, 'Write the about page');
      ledger(t, f, { usd: 1.25, at: wk + into, taskId: a });
      ledger(t, f, { usd: 0.5, at: wk + 2 * into, provider: 'openrouter', taskId: b });
      ledger(t, f, { usd: 2, at: wk - 2 * DAY });                // last week
      ledger(t, f, { usd: 4, at: wk - 30 * DAY });               // a month back
      ledger(t, g, { usd: 99, at: wk + into });                // another floor: never counted here
      const r = await c.get(`/api/floors/${c.slug}/spend`);
      assert.equal(r.status, 200);
      const d = r.data;
      assert.deepEqual(d.thisWeek, { totalUsd: 1.75, claudeUsd: 1.25, openrouterUsd: 0.5 });
      assert.deepEqual(d.lastWeek, { totalUsd: 2, claudeUsd: 2, openrouterUsd: 0 });
      assert.deepEqual(d.sinceOpened, { totalUsd: 7.75, claudeUsd: 7.25, openrouterUsd: 0.5 });
      assert.deepEqual(d.jobs.map((j) => [j.title, j.costUsd]).sort(), [['Build the menu page', 1.25], ['Write the about page', 0.5]]);
      // Only informs: no limit, budget, gauge, "left", building total or model name anywhere in it.
      const text = JSON.stringify(d);
      assert.doesNotMatch(text, /budget|limit|cap|left|gauge|remaining|99|claude-haiku|model/i);
      assert.equal(ownSpend(t.db, f.id).thisWeek.totalUsd, 1.75, 'the same figures from the function');
    } finally { await t.close(); }
  });
  test('another floor\'s boss and a visitor can\'t fetch them; OWN_SPEND=0 takes the route away', async () => {
    const t = await boot();
    try {
      const c = await claim(t, 'Private Figures'); const f = floorOf(t, c);
      ledger(t, f, { usd: 3, at: Date.now() });
      const other = await claim(t, 'Nosy Neighbour');
      assert.equal((await other.get(`/api/floors/${c.slug}/spend`)).status, 403);
      assert.equal((await new Client(t).get(`/api/floors/${c.slug}/spend`)).status, 401);
      t.cfg.ownSpend = false;
      assert.equal((await c.get(`/api/floors/${c.slug}/spend`)).status, 404);
    } finally { await t.close(); }
  });
});

describe('the tap on the status card', () => {
  test('the boss\'s card offers the link; a visitor\'s never does, and the snapshot carries no figures either way', async () => {
    const t = await boot();
    try {
      const c = await claim(t, 'Tap Co'); const f = floorOf(t, c);
      ledger(t, f, { usd: 3.5, at: Date.now() });
      const boss = await floorState(c);
      assert.equal(boss.status.figuresTap, true);
      const v = await floorState(new Client(t), c.slug);
      assert.equal(v.status.figuresTap, undefined);
      for (const s of [boss, v]) assert.doesNotMatch(JSON.stringify(s), /3\.5/);
      t.cfg.ownSpend = false;
      assert.equal((await floorState(c)).status.figuresTap, undefined);
      const src = readFileSync(new URL('../public/js/status-card.js', import.meta.url), 'utf8');
      assert.match(src, /page\.owner && st\.figuresTap \? h\('button\.link\.stc-spend'/);
      assert.match(src, /api\(`\/floors\/\$\{page\.slug\}\/spend`\)/);
      for (const label of ["'This week'", "'Last week'", "'Since you opened'", "'Claude'", "'OpenRouter'", "'Latest jobs'"]) assert.ok(src.includes(label), label);
      assert.doesNotMatch(src.slice(src.indexOf('async function openSpend')), /budget|left|limit|gauge/i);
    } finally { await t.close(); }
  });
});
