// Round 2, r2-j54 (docs/redesign/OFFICE-ANSWERS-2.md, Q20 and section 3 "Who sees what"; section 6: "A visitor sees kind lines only; a boss sees
// their own items in full; Colon sees the whole queue"). API tests for each audience, fake records, mock mode.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boot, claim, Client, adminClient } from './helpers.js';
import { get, run } from '../server/db.js';
import { kindLine } from '../public/js/mailroom-state.js';

const floorOf = (t, c) => get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
function seed(t, f, tag) {
  run(t.db, 'INSERT INTO help_requests (floor_id,question,created_at,expires_at) VALUES (?,?,?,?)', f.id, `${tag} QUESTION`, Date.now(), Date.now() + 3600e3);
  run(t.db, 'INSERT INTO purchases (floor_id,item,price,why,link,created_at) VALUES (?,?,?,?,?,?)', f.id, `${tag} ITEM`, 41.25, `${tag} WHY`, '', Date.now());
  const task = Number(run(t.db, "INSERT INTO tasks (floor_id,title,status,created_at,updated_at) VALUES (?,'t','blocked',1,1)", f.id).lastInsertRowid);
  run(t.db, 'INSERT INTO contractor_jobs (floor_id,task_id,title,created_at) VALUES (?,?,?,?)', f.id, task, `${tag} JOB`, Date.now());
}

test('a visitor: kind lines only. A boss: their own floor in full and nobody else\'s. Colon: the whole queue, hidden floors too, and the stuck jobs', async () => {
  const t = await boot();
  try {
    const mine = await claim(t, 'TheTireRx'), other = await claim(t, 'Other Co'), secret = await claim(t, 'Hidden Co');
    const fm = floorOf(t, mine), fo = floorOf(t, other), fh = floorOf(t, secret);
    run(t.db, 'UPDATE floors SET hidden=1 WHERE id=?', fh.id);
    seed(t, fm, 'MINE'); seed(t, fo, 'OTHER'); seed(t, fh, 'HIDDEN');

    const visitor = (await new Client(t).get('/api/mailroom')).data;
    assert.equal(visitor.audience, 'visitor');
    assert.doesNotMatch(JSON.stringify(visitor), /QUESTION|ITEM|WHY|JOB|41\.25|TheTireRx|Other Co/);
    assert.deepEqual(visitor.items.map(kindLine).sort(), [`Build job from floor ${fm.number}`, `Build job from floor ${fo.number}`, `Help question from floor ${fm.number}`, `Help question from floor ${fo.number}`, `Purchase request from floor ${fm.number}`, `Purchase request from floor ${fo.number}`].sort());
    assert.ok(!visitor.queue && !visitor.mine && !visitor.stuck);

    const boss = (await mine.get('/api/mailroom')).data;
    assert.equal(boss.audience, 'boss');
    assert.deepEqual(boss.mine.map((i) => i.kind).sort(), ['contractor', 'help', 'purchase']);
    const buy = boss.mine.find((i) => i.kind === 'purchase');
    assert.equal(buy.item, 'MINE ITEM'); assert.equal(buy.priceUsd, 41.25); assert.equal(buy.why, 'MINE WHY');
    assert.equal(boss.mine.find((i) => i.kind === 'help').question, 'MINE QUESTION');
    assert.equal(boss.mine.find((i) => i.kind === 'contractor').contractorStatus, 'held');
    assert.doesNotMatch(JSON.stringify(boss), /OTHER|HIDDEN/, 'never another floor\'s words');

    // The hidden floor's own boss sees their items in full too (they are theirs), though visitors never see them.
    assert.equal((await secret.get('/api/mailroom')).data.mine.length, 3);

    const admin = (await (await adminClient(t)).get('/api/mailroom')).data;
    assert.equal(admin.audience, 'admin');
    assert.equal(admin.queue.length, 9, 'every floor, hidden ones too');
    assert.ok(admin.queue.some((i) => i.item === 'HIDDEN ITEM') && admin.queue.some((i) => i.question === 'OTHER QUESTION'));
    assert.ok(Array.isArray(admin.stuck.jobs));
  } finally { await t.close(); }
});
test('the page: a boss reads their own items, Colon gets the queue and Send out through the admin page\'s own route; tapping the robot calls nothing new', () => {
  const ui = readFileSync(new URL('../public/js/mailroom-ui.js', import.meta.url), 'utf8');
  assert.match(ui, /if \(d\.audience === 'boss'\)/);
  assert.match(ui, /if \(d\.audience === 'admin'\)/);
  assert.match(ui, /api\(`\/admin\/tasks\/\$\{id\}\/send-out`, \{ method: 'POST', body: \{\}, admin: true \}\)/);
  // The robot button only opens a card: its handler toggles and re-renders, no request.
  assert.match(ui, /onclick: \(\) => \{ robotOpen = !robotOpen; render\(last\); \}/);
  const apis = [...ui.matchAll(/api\(`?'?([^`',)]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(apis)].sort(), ['/admin/tasks/${id}/send-out', '/mailroom']);
});
