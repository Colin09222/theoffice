// The pieces that find each other by soft import, on the merged code with nothing injected: the dashboard reads the real sales, the daily run reads the real customer questions, and the runner's addresses stay out of the Office's labels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, claim, until, Client } from './helpers.js';
import { get, run } from '../server/db.js';
import { requestDailyRun } from '../server/daily.js';
import { appLabel, RESERVED_PREFIXES } from '../server/apps.js';

const floorOf = (t, c) => get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);

test('the boss\'s dashboard shows sales recorded by payments, and nobody else gets them', async () => {
  const t = await boot({ peopleTalk: false });
  try {
    const c = await claim(t, 'Sales Co');
    const f = floorOf(t, c);
    run(t.db, "INSERT INTO pay_settings (k,v) VALUES ('mode','test') ON CONFLICT(k) DO UPDATE SET v=excluded.v");
    run(t.db, 'INSERT INTO pay_sales (order_id,floor_id,livemode,ref,amount_cents,currency,day,created_at) VALUES (1,?,0,?,4500,?,?,?)', f.id, 'wiring-1', 'usd', new Date().toISOString().slice(0, 10), Date.now());
    const r = await c.get(`/api/floors/${c.slug}/numbers`);
    assert.equal(r.status, 200);
    assert.equal(r.data.sales.state, 'ok', 'the real salesSummary was found');
    assert.equal(r.data.series.reduce((n, d) => n + (d.grossCents || 0), 0), 4500);
    assert.equal(r.data.series.reduce((n, d) => n + (d.orders || 0), 0), 1);
    const visitor = new Client(t);
    assert.ok([401, 403, 404].includes((await visitor.get(`/api/floors/${c.slug}/numbers`)).status), 'a visitor gets nothing');
  } finally { await t.close(); }
});

test('a daily run reads the questions waiting in the website chat', async () => {
  const t = await boot({ dailyTickMs: 15, modesTickMs: 15, ordersTickMs: 60000, businessTickMs: 60000, mockDelayMs: 1, peopleTalk: false });
  try {
    const c = await claim(t, 'Question Co');
    await c.post(`/api/floors/${c.slug}/work-mode`, { mode: 'ask', goal: 'Get our first ten customers' });
    const f = floorOf(t, c);
    run(t.db, 'INSERT INTO chat_questions (conversation_id,floor_id,project,question,created_at) VALUES (1,?,?,?,?)', f.id, 'shop', 'Do you ship to Wellington?', Date.now());
    requestDailyRun(t.db, f.id, Date.now());
    const row = await until(() => get(t.db, 'SELECT prompt FROM daily_runs WHERE floor_id=?', f.id), { what: 'the run to start' });
    assert.match(row.prompt, /Customer questions waiting/);
    assert.match(row.prompt, /Do you ship to Wellington\?/);
  } finally { await t.close(); }
});

test('no project can take an address the runner\'s edge owns', async () => {
  const t = await boot({ peopleTalk: false });
  try {
    assert.ok(RESERVED_PREFIXES.includes('api--'));
    const c = await claim(t, 'Label Co');
    const f = floorOf(t, c);
    for (const project of ['api--foo', 'api--', 'api']) assert.ok(!appLabel(t.db, f, project).startsWith('api--'), project);
  } finally { await t.close(); }
});
