// Round 2, r2-j49 (docs/redesign/OFFICE-ANSWERS-2.md, section 3 "Data it reads"; section 6: "One read-only address returns open items as number,
// kind, floor, state and times, with no text or prices"). Fake records, mock mode.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, claim, Client } from './helpers.js';
import { get, run } from '../server/db.js';
import { decidePurchase } from '../server/purchases.js';
import { RECENT_MS } from '../server/mailroom.js';

const floorOf = (t, c) => get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
const feed = async (t) => (await new Client(t).get('/api/mailroom')).data;
/** The three kinds of record, each with words, prices and names a visitor must never see. */
function seed(t, f, at = Date.now()) {
  const help = Number(run(t.db, "INSERT INTO help_requests (floor_id,question,tried,created_at,expires_at) VALUES (?,'SECRET QUESTION about tyres','tried things',?,?)", f.id, at, at + 3600e3).lastInsertRowid);
  const buy = Number(run(t.db, "INSERT INTO purchases (floor_id,item,price,why,link,created_at) VALUES (?,'SECRET ITEM stock photos',29.5,'SECRET REASON','https://x.example',?)", f.id, at + 1).lastInsertRowid);
  const task = Number(run(t.db, "INSERT INTO tasks (floor_id,title,status,sent_out_at,created_at,updated_at) VALUES (?,'SECRET TASK','blocked',?,?,?)", f.id, at + 2, at, at).lastInsertRowid);
  const job = Number(run(t.db, "INSERT INTO contractor_jobs (floor_id,task_id,title,brief,created_at) VALUES (?,?,'SECRET JOB','SECRET BRIEF',?)", f.id, task, at + 3).lastInsertRowid);
  return { help, buy, task, job };
}

test('one read-only address: open items as number, kind, floor, state and times; no text, no prices, no names', async () => {
  const t = await boot();
  try {
    const f = floorOf(t, await claim(t, 'TheTireRx'));
    const ids = seed(t, f, 1700000000000);
    const body = await feed(t);
    assert.deepEqual(body.items.map((i) => [i.kind, i.number, i.floor, i.state]), [['help', ids.help, f.number, 'open'], ['purchase', ids.buy, f.number, 'open'], ['contractor', ids.job, f.number, 'open']]);
    for (const i of body.items) {
      assert.deepEqual(Object.keys(i).sort(), ['floor', 'kind', 'number', 'state', 'times', 'type']);
      assert.ok(i.type && Number.isInteger(i.number), 'a record type and number on every item');
    }
    assert.equal(body.items[2].times.sentOut, 1700000000002, 'the Send out time is there for a contractor job');
    assert.deepEqual(body.counts, { help: 1, purchase: 1, contractor: 1 });
    const text = JSON.stringify(body);
    assert.doesNotMatch(text, /SECRET|tyres|29\.5|photos|TheTireRx|x\.example/i);
    // Read-only: nothing but GET answers there.
    assert.ok([404, 405].includes((await new Client(t).post('/api/mailroom', {})).status));
  } finally { await t.close(); }
});

test('a closed item stays 15 minutes with its outcome (bought, answered, done), then leaves; hidden and demo floors never show', async () => {
  const t = await boot({ fillerCompanies: true, fillerTickMs: 1e6 });
  try {
    const f = floorOf(t, await claim(t, 'Shown'));
    const h = floorOf(t, await claim(t, 'Hidden'));
    run(t.db, 'UPDATE floors SET hidden=1 WHERE id=?', h.id);
    const demo = get(t.db, 'SELECT * FROM floors WHERE filler=1 LIMIT 1');
    const ids = seed(t, f); seed(t, h); seed(t, demo);
    decidePurchase(t.db, ids.buy, 'bought', '', Date.now());
    run(t.db, "UPDATE help_requests SET status='answered', answer='A', decided_at=? WHERE id=?", Date.now(), ids.help);
    run(t.db, "UPDATE contractor_jobs SET status='done', done_at=? WHERE id=?", Date.now(), ids.job);
    let body = await feed(t);
    assert.deepEqual(body.items.map((i) => [i.kind, i.state]), [['help', 'answered'], ['purchase', 'bought'], ['contractor', 'done']]);
    assert.ok(body.items.every((i) => i.floor === f.number));
    assert.deepEqual(body.counts, { help: 0, purchase: 0, contractor: 0 });
    // 15 minutes on, they are gone: an empty tray.
    run(t.db, 'UPDATE help_requests SET decided_at=decided_at-? WHERE id=?', RECENT_MS + 1000, ids.help);
    run(t.db, 'UPDATE purchases SET decided_at=decided_at-? WHERE id=?', RECENT_MS + 1000, ids.buy);
    run(t.db, 'UPDATE contractor_jobs SET done_at=done_at-? WHERE id=?', RECENT_MS + 1000, ids.job);
    body = await feed(t);
    assert.deepEqual(body.items, []);
  } finally { await t.close(); }
});

test('MAILROOM=0 takes the address away', async () => {
  const t = await boot({ mailroom: false });
  try { assert.equal((await new Client(t).get('/api/mailroom')).status, 404); } finally { await t.close(); }
});
