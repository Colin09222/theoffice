// Round 2, r2-j55 (docs/redesign/OFFICE-ANSWERS-2.md, Q17, Q19, Q22, section 3 animations 3 and 7; section 6: "A handed-back job triggers one lift
// ride; COLON APPROVED appears only on items with an approval record"). The contractor stays manual: only Colon's Send out fills the queue, and
// tapping the robot never contacts buddehbot. Fake clock, fake records, mock mode.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../public/vendor/three/three.module.min.js';
import { boot, claim, Client } from './helpers.js';
import { get, run } from '../server/db.js';
import { diffFeed, approvedStampFor, lineFor, LIFT_S } from '../public/js/mailroom-events.js';
import { mailroomFloor, POLL_MS } from '../public/js/mailroom-floor.js';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('a handed-back contractor job makes exactly one lift ride of 8 s on its floor, to the Builder\'s desk and back', async () => {
  const t = await boot();
  try {
    const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', (await claim(t, 'TheTireRx')).slug);
    const c = new Client(t);
    const task = Number(run(t.db, "INSERT INTO tasks (floor_id,title,status,contractor,sent_out_at,created_at,updated_at) VALUES (?,'Build it','blocked',1,?,1,1)", f.id, Date.now()).lastInsertRowid);
    const job = Number(run(t.db, "INSERT INTO contractor_jobs (floor_id,task_id,title,created_at) VALUES (?,?,'Build it',?)", f.id, task, Date.now()).lastInsertRowid);
    const bean = (id, role, at) => ({ id, info: { role }, isBoss: false, extra: false, seat: { at }, perform() {} });
    const view = { root: new THREE.Group(), actors: new Map([[1, bean(1, 'manager', [2, 2])], [2, bean(2, 'builder', [-3, 1])]]) };
    view.root.name = `floor-${f.number}`;
    let clock = 0;
    const hook = mailroomFloor(view, { read: async () => (await c.get('/api/mailroom')).data, now: () => clock });
    const step = async (ms) => { clock += ms; hook.tick(); await new Promise((r) => setTimeout(r, 120)); };
    await step(0);
    run(t.db, "UPDATE contractor_jobs SET status='done', done_at=? WHERE id=?", Date.now(), job);
    await step(POLL_MS);
    for (let i = 0; i < 4; i++) await step(POLL_MS);  // more readings: still one ride
    const rides = hook.played.filter((e) => e.event === 'handback');
    assert.equal(rides.length, 1);
    assert.deepEqual([rides[0].type, rides[0].number, rides[0].who, rides[0].ride], ['contractor_jobs', job, 2, LIFT_S]);
    assert.equal(LIFT_S, 8);
    assert.equal(hook.riding, false, 'the ride is over after 8 s');
    assert.ok(view.root.children.some((o) => o.isMesh && o.geometry?.parameters?.width === 0.34), 'the box is left at the desk');
  } finally { await t.close(); }
});

test('COLON APPROVED only where an approval record exists: a job Colon sent out has one; nothing else ever does', async () => {
  const t = await boot();
  try {
    const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', (await claim(t, 'Approvals')).slug);
    const c = new Client(t);
    const before = (await c.get('/api/mailroom')).data;
    const sent = Number(run(t.db, "INSERT INTO tasks (floor_id,title,status,contractor,sent_out_at,created_at,updated_at) VALUES (?,'a','blocked',1,?,1,1)", f.id, Date.now()).lastInsertRowid);
    const plain = Number(run(t.db, "INSERT INTO tasks (floor_id,title,status,contractor,created_at,updated_at) VALUES (?,'b','blocked',1,1,1)", f.id).lastInsertRowid);
    run(t.db, "INSERT INTO contractor_jobs (floor_id,task_id,title,created_at) VALUES (?,?,'a',?)", f.id, sent, Date.now());
    run(t.db, "INSERT INTO contractor_jobs (floor_id,task_id,title,created_at) VALUES (?,?,'b',?)", f.id, plain, Date.now());
    run(t.db, "INSERT INTO purchases (floor_id,item,price,why,link,created_at) VALUES (?,'x',1,'x','',?)", f.id, Date.now());
    run(t.db, "INSERT INTO help_requests (floor_id,question,created_at,expires_at) VALUES (?,'q',?,?)", f.id, Date.now(), Date.now() + 3600e3);
    const evs = diffFeed(before, (await c.get('/api/mailroom')).data);
    const stamped = evs.filter((e) => approvedStampFor(e));
    assert.equal(evs.length, 4);
    assert.deepEqual(stamped.map((e) => [e.type, e.number]), [['contractor_jobs', get(t.db, 'SELECT id FROM contractor_jobs WHERE task_id=?', sent).id]]);
    assert.equal(lineFor(stamped[0]), 'Approved.');
    assert.equal(approvedStampFor({ event: 'arrive', kind: 'purchase', approved: undefined }), '');
  } finally { await t.close(); }
});

test('the contractor stays manual, and the mailroom adds no path to buddehbot', () => {
  // Only the admin's Send out fills the queue (sendout.js, job 19); the mailroom code never writes a record or calls anything but the feed and that route.
  for (const f of ['server/mailroom.js', 'server/macbeat.js']) assert.doesNotMatch(src(f), /\b(run|tx)\(db,|INSERT|UPDATE |DELETE |fetch\(|contractorPing|request\(/, f);
  for (const f of ['public/js/mailroom-ui.js', 'public/js/mailroom-floor.js', 'public/js/mailroom-scene.js', 'public/js/mailroom-events.js']) {
    const calls = [...src(f).matchAll(/api\(`?'?([^`',)]+)/g)].map((m) => m[1]);
    assert.ok(calls.every((c) => ['/mailroom', '/admin/tasks/${id}/send-out', '/building/friday'].includes(c)), `${f}: ${calls}`);  // all reads, but Colon's own Send out
    assert.doesNotMatch(src(f), /buddehbot-mac|openclaw|contractorping|ask_buddehbot/i, f);
  }
});
