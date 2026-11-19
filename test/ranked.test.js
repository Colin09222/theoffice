// Colon's ranked view (docs/redesign/ROUND1-REST.md, job 26): admin only, floors ranked by real use per $100 over the last 7 and 28 days, with
// spend, the real-use figure and the last launch. Double down, Pause and Kill, each behind a confirm and logged with who and when. Nothing sets
// a budget or a cap. Non-admins get 403. Mock mode.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boot, claim, Client, adminClient } from './helpers.js';
import { get, all, run } from '../server/db.js';
import { recordVisit } from '../server/launch.js';
import { digestFacts, digestText } from '../server/owneralerts.js';
import { newFence } from '../server/help.js';

const DAY = 864e5;
const day = (back) => new Date(Date.now() - back * DAY).toISOString().slice(0, 10);
const floorOf = (t, c) => get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
const spend = (t, f, usd, back = 1) => run(t.db, "INSERT INTO ledger (floor_id,day,agent_id,model,prompt_tokens,completion_tokens,cost_usd,created_at,kind,provider,task_id,computer) VALUES (?,?,NULL,'m',1,1,?,?,'model','anthropic',NULL,0)", f.id, day(back), usd, Date.now() - back * DAY);
const visits = (t, f, uniques, back = 1) => run(t.db, "INSERT INTO app_visits (floor_id,project,day,path,views,uniques) VALUES (?,'site',?,'/',?,?) ON CONFLICT(floor_id,project,day,path) DO UPDATE SET uniques=uniques+excluded.uniques, views=views+excluded.views", f.id, day(back), uniques, uniques);
const publish = (t, f, slug, back) => run(t.db, "INSERT INTO projects (floor_id,slug,title,kind,private,published_at,created_at) VALUES (?,?,?,'site',0,?,?)", f.id, slug, `${slug} title`, Date.now() - back * DAY, Date.now() - (back + 2) * DAY);

describe('the ranking', () => {
  test('floors ranked by real use per $100 over 7 and 28 days, with spend, real use and the last launch; bots don\'t count', async () => {
    const t = await boot({ fillerCompanies: true, fillerTickMs: 1e6, towerFloors: 30 });
    try {
      const a = floorOf(t, await claim(t, 'Cheap Hit')), b = floorOf(t, await claim(t, 'Pricey Flop')), c = floorOf(t, await claim(t, 'Quiet Floor'));
      spend(t, a, 2); visits(t, a, 40); run(t.db, "INSERT INTO app_forms (floor_id,project,form,data,size,hash,created_at) VALUES (?,'site','join','{}',2,'h1',?)", a.id, Date.now() - DAY);
      spend(t, b, 10); visits(t, b, 10); spend(t, b, 30, 20); visits(t, b, 5, 20);
      publish(t, a, 'hit-site', 3); publish(t, a, 'older', 9);
      // A bot's visit is never recorded, so it never counts; a person's is.
      recordVisit(t.db, { floorId: c.id, project: 'site', path: '/', ua: 'Googlebot/2.1', ip: '1.1.1.1', secret: 's', now: Date.now() });
      recordVisit(t.db, { floorId: c.id, project: 'site', path: '/', ua: 'Mozilla/5.0 (iPhone)', ip: '2.2.2.2', secret: 's', now: Date.now() });
      const admin = await adminClient(t);
      const r = await admin.get('/api/admin/ranked');
      assert.equal(r.status, 200);
      const rows = r.data.floors;
      assert.ok(!rows.some((x) => get(t.db, 'SELECT filler FROM floors WHERE id=?', x.id).filler), 'no demo floor');
      assert.deepEqual(rows.map((x) => x.name), ['Quiet Floor', 'Cheap Hit', 'Pricey Flop'], 'real use with nothing spent leads, then most use per $100');
      const ra = rows.find((x) => x.id === a.id), rb = rows.find((x) => x.id === b.id), rc = rows.find((x) => x.id === c.id);
      // A claimed floor's own setup spends a few mock cents too, so the ratios are checked to within a point.
      const near = (x, y) => assert.ok(Math.abs(x - y) < 1, `${x} is not about ${y}`);
      assert.deepEqual([ra.windows[7].spendUsd, ra.windows[7].realUse], [2, 41]); near(ra.windows[7].perHundred, 2050);
      assert.deepEqual([rb.windows[28].spendUsd, rb.windows[28].realUse], [40, 15]); near(rb.windows[7].perHundred, 100); near(rb.windows[28].perHundred, 37.5);
      assert.equal(rc.windows[7].realUse, 1, 'the person counted, the bot not');
      assert.equal(rc.windows[7].perHundred, null);
      assert.equal(ra.lastLaunch.slug, 'hit-site');
    } finally { await t.close(); }
  });
});

describe('the three buttons', () => {
  test('each asks first, does its one thing, is logged with who and when, and none of them touches a cap', async () => {
    const t = await boot();
    try {
      const boss = await claim(t, 'Button Co'); const f = floorOf(t, boss);
      const admin = await adminClient(t);
      const caps = JSON.stringify([t.cfg.floorDailyUsd, t.cfg.globalDailyUsd, t.cfg.budgetAnthropicUsd, t.cfg.budgetOpenrouterUsd, t.cfg.taskMaxUsd, all(t.db, 'SELECT * FROM settings')]);
      const press = (action, body = { confirm: true }) => admin.post(`/api/admin/ranked/${f.id}/${action}`, body);
      assert.equal((await press('double-down', {})).status, 400, 'no press without the confirm');
      // Double down: a mark in the list and in the digest, nothing else.
      assert.equal((await press('double-down')).status, 200);
      assert.equal((await admin.get('/api/admin/ranked')).data.floors.find((x) => x.id === f.id).priority, true);
      const text = digestText(digestFacts(t.db, t.cfg, Date.now()), newFence());
      assert.match(text, /Priority floors \(double down\): floor \d+ /);
      // Pause: the existing floor pause.
      assert.equal((await press('pause')).status, 200);
      assert.equal(floorOf(t, boss).paused, 1);
      assert.equal((await press('resume')).status, 200);
      assert.equal(floorOf(t, boss).paused, 0);
      // Kill: the team paused and the floor off the public lists; Bring back puts both back as they were.
      assert.ok((await new Client(t).get('/api/floors')).data.floors.some((x) => x.slug === f.slug));
      assert.equal((await press('kill')).status, 200);
      assert.deepEqual([floorOf(t, boss).hidden, floorOf(t, boss).paused], [1, 1]);
      assert.ok(!(await new Client(t).get('/api/floors')).data.floors.some((x) => x.slug === f.slug), 'off the directory');
      assert.equal((await new Client(t).get(`/api/building/launched?floor=${f.slug}`)).data.projects.length, 0);
      assert.equal((await press('unkill')).status, 200);
      assert.deepEqual([floorOf(t, boss).hidden, floorOf(t, boss).paused], [0, 0]);
      assert.ok((await new Client(t).get('/api/floors')).data.floors.some((x) => x.slug === f.slug), 'back on the directory');
      // Every press is logged, with who and when.
      const log = (await admin.get('/api/admin/ranked')).data.log;
      assert.deepEqual(log.map((l) => l.action).reverse(), ['double-down', 'pause', 'resume', 'kill', 'unkill']);
      assert.ok(log.every((l) => /^admin [0-9a-f]{8}$/.test(l.who) && l.at > Date.now() - 60e3));
      assert.equal(JSON.stringify([t.cfg.floorDailyUsd, t.cfg.globalDailyUsd, t.cfg.budgetAnthropicUsd, t.cfg.budgetOpenrouterUsd, t.cfg.taskMaxUsd, all(t.db, 'SELECT * FROM settings')]), caps, 'no cap or setting changed');
      assert.equal((await press('explode')).status, 400);
    } finally { await t.close(); }
  });
  test('a boss killed while already paused stays paused when brought back', async () => {
    const t = await boot();
    try {
      const boss = await claim(t, 'Already Paused'); const f = floorOf(t, boss);
      t.app.engine.pauseFloor(f.id);
      const admin = await adminClient(t);
      await admin.post(`/api/admin/ranked/${f.id}/kill`, { confirm: true });
      await admin.post(`/api/admin/ranked/${f.id}/unkill`, { confirm: true });
      assert.deepEqual([floorOf(t, boss).hidden, floorOf(t, boss).paused], [0, 1]);
    } finally { await t.close(); }
  });
});

describe('who may see it', () => {
  test('non-admins get 403: a visitor and a floor\'s boss alike, for the list and the buttons', async () => {
    const t = await boot();
    try {
      const boss = await claim(t, 'Curious Boss'); const f = floorOf(t, boss);
      for (const c of [new Client(t), boss]) {
        assert.equal((await c.get('/api/admin/ranked')).status, 403);
        assert.equal((await c.post(`/api/admin/ranked/${f.id}/kill`, { confirm: true })).status, 403);
      }
      assert.equal(floorOf(t, boss).hidden, 0);
      const ui = readFileSync(new URL('../public/js/admin-ui.js', import.meta.url), 'utf8');
      assert.match(ui, /api\('\/admin\/ranked'\)/);
      for (const label of ["'Double down'", "'Pause'", "'Kill'", "'Bring back'", 'It changes no cap.']) assert.ok(ui.includes(label), label);
      assert.match(ui, /post\(`\/admin\/ranked\/\$\{f\.id\}\/\$\{action\}`, \{ confirm: true \}\)/);
      // A direct load of the admin page has no 3D stage: it must not throw on it (found while checking this view; the page was blank).
      assert.match(ui, /if \(stage\.ok\) \{ stage\.setView\(null\);/);
    } finally { await t.close(); }
  });
});
