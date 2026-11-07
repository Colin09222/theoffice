// Standing orders (floors-plus): schedule maths, the owner's routes, the manager's tools, and the runner against the real mock engine with an injectable clock.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, claim, Client, floorState, until, sleep, sse, adminClient } from './helpers.js';
import { nextRunAt, parseSchedule, describeSchedule, idleReason } from '../server/orders.js';
import { openDb, get, all, run } from '../server/db.js';
import { loadConfig, loadModels } from '../server/config.js';
import { createApp } from '../server/app.js';
import { issueCode } from '../server/auth.js';

const DAY = 86400000, HOUR = 3600000;
const MON_8 = Date.UTC(2026, 0, 5, 8, 0, 0);  // a Monday, 08:00 UTC
const at9 = (dayOffset) => MON_8 + dayOffset * DAY + HOUR + 1000;  // 09:00:01 UTC on that day
const DAILY = { every: 'day', at: '09:00' };

async function mk(over = {}) {
  const clock = { t: MON_8 };
  const t = await boot({ ordersTickMs: 20, mockDelayMs: 2, ...over }, { now: () => clock.t });
  return Object.assign(t, { clock });
}
const orders = async (c) => (await c.get(`/api/floors/${c.slug}/orders`)).data.orders;
const runsOf = (t, id) => all(t.db, 'SELECT * FROM standing_runs WHERE order_id=? ORDER BY id', id);
const waitRun = (t, id, status, n = 1) => until(() => { const rows = runsOf(t, id).filter((r) => r.status === status); return rows.length >= n ? rows[n - 1] : null; }, { what: `run ${n} ${status}`, timeout: 30000 });
const create = async (c, text, schedule = DAILY) => { const r = await c.post(`/api/floors/${c.slug}/orders`, { text, schedule }); assert.equal(r.status, 201, JSON.stringify(r.data)); return r.data.order; };
const remove = async (c, id) => assert.equal((await c.post(`/api/floors/${c.slug}/orders/${id}/delete`, {})).status, 200);

describe('schedule maths', () => {
  test('next run is the first slot strictly after now, in UTC', () => {
    assert.equal(nextRunAt({ every: 'day', at: '09:00', tz: 'UTC' }, MON_8), MON_8 + HOUR);
    assert.equal(nextRunAt({ every: 'day', at: '07:00', tz: 'UTC' }, MON_8), MON_8 + DAY - HOUR);
    assert.equal(nextRunAt({ every: 'day', at: '08:00', tz: 'UTC' }, MON_8), MON_8 + DAY, 'a slot equal to now is the next one');
    assert.equal(nextRunAt({ every: 'week', weekday: 1, at: '09:00', tz: 'UTC' }, MON_8), MON_8 + HOUR);
    assert.equal(nextRunAt({ every: 'week', weekday: 1, at: '08:00', tz: 'UTC' }, MON_8), MON_8 + 7 * DAY);
    assert.equal(nextRunAt({ every: 'week', weekday: 0, at: '00:00', tz: 'UTC' }, MON_8), Date.UTC(2026, 0, 11));
  });
  test('an IANA zone is honoured, across summer time', () => {
    const summer = Date.UTC(2026, 6, 1, 8, 30);
    assert.equal(nextRunAt({ every: 'day', at: '09:00', tz: 'Europe/London' }, summer), Date.UTC(2026, 6, 2, 8, 0));
    assert.equal(nextRunAt({ every: 'day', at: '09:00', tz: 'America/New_York' }, summer), Date.UTC(2026, 6, 1, 13, 0));
    assert.equal(nextRunAt({ every: 'day', at: '09:00', tz: 'Europe/London' }, Date.UTC(2026, 0, 1, 8, 30)), Date.UTC(2026, 0, 1, 9, 0));
    assert.equal(nextRunAt({ every: 'day', at: '09:00', tz: 'Asia/Kolkata' }, Date.UTC(2026, 0, 1, 0, 0)), Date.UTC(2026, 0, 1, 3, 30));
  });
  test('shapes are validated with friendly messages, and the minimum interval holds', () => {
    assert.deepEqual(parseSchedule({ every: 'day', at: '09:00' }).schedule, { every: 'day', at: '09:00', tz: 'UTC' });
    assert.deepEqual(parseSchedule({ every: 'week', at: '08:00', weekday: 1, tz: 'Europe/Paris' }).schedule, { every: 'week', at: '08:00', tz: 'Europe/Paris', weekday: 1 });
    for (const bad of [null, {}, { every: 'hour', at: '09:00' }, { every: 'day', at: '9:00' }, { every: 'day', at: '24:00' }, { every: 'week', at: '09:00' }, { every: 'week', at: '09:00', weekday: 7 }, { every: 'day', at: '09:00', tz: 'Mars/Olympus' }, { every: 'day', at: '09:00', tz: '../etc' }]) {
      assert.ok(parseSchedule(bad).error, JSON.stringify(bad));
    }
    assert.match(parseSchedule({ every: 'day', at: '09:00' }, { ordersMinHours: 48 }).error, /every 48 hours/);
    assert.ok(parseSchedule({ every: 'week', at: '09:00', weekday: 2 }, { ordersMinHours: 48 }).schedule);
    assert.equal(describeSchedule({ every: 'day', at: '09:00', tz: 'UTC' }), 'Every day at 09:00 UTC');
    assert.equal(describeSchedule({ every: 'week', weekday: 1, at: '08:00', tz: 'UTC' }), 'Every Monday at 08:00 UTC');
  });
});

describe('owner routes', () => {
  let t, a, b;
  before(async () => { t = await mk(); a = await claim(t, 'Clockwork'); b = await claim(t, 'Neighbour'); });
  after(() => t.close());
  test('create, list, update, pause, resume and delete', async () => {
    const o = await create(a, 'Every morning write a short post about yesterday');
    assert.equal(o.nextRunAt, MON_8 + HOUR); assert.equal(o.scheduleText, 'Every day at 09:00 UTC'); assert.equal(o.status, 'active'); assert.equal(o.estUsd, undefined, 'a boss sees no estimate');
    const list = await orders(a);
    assert.equal(list.length, 1); assert.deepEqual(list[0].history, []); assert.equal(list[0].runs, 0);
    const snap = await floorState(a);
    assert.equal(snap.orders.length, 1); assert.equal(snap.orderLimits.perFloor, 3);
    const u = await a.post(`/api/floors/${a.slug}/orders/${o.id}`, { text: 'Every Monday, plan the week', schedule: { every: 'week', weekday: 1, at: '08:00' } });
    assert.equal(u.status, 200); assert.equal(u.data.order.text, 'Every Monday, plan the week'); assert.equal(u.data.order.scheduleText, 'Every Monday at 08:00 UTC'); assert.equal(u.data.order.nextRunAt, MON_8 + 7 * DAY);
    const p = await a.post(`/api/floors/${a.slug}/orders/${o.id}`, { status: 'paused' });
    assert.equal(p.data.order.status, 'paused'); assert.equal(p.data.order.pauseReason, 'Paused by you');
    run(t.db, 'UPDATE standing_orders SET fail_streak=2 WHERE id=?', o.id);
    const r = await a.post(`/api/floors/${a.slug}/orders/${o.id}`, { status: 'active' });
    assert.equal(r.data.order.status, 'active'); assert.equal(r.data.order.failStreak, 0, 'resuming resets the streak'); assert.equal(r.data.order.pauseReason, '');
    assert.equal((await a.post(`/api/floors/${a.slug}/orders/${o.id}`, { status: 'gone' })).status, 400);
    await remove(a, o.id);
    assert.equal((await orders(a)).length, 0);
    assert.equal((await a.post(`/api/floors/${a.slug}/orders/${o.id}/delete`, {})).status, 404);
    assert.equal((await a.post(`/api/floors/${a.slug}/orders/abc/delete`, {})).status, 404);
  });
  test('validation, and three per floor', async () => {
    const bad = async (body, status, re) => { const r = await a.post(`/api/floors/${a.slug}/orders`, body); assert.equal(r.status, status, JSON.stringify(r.data)); if (re) assert.match(r.data.message, re); };
    await bad({ text: 'no', schedule: DAILY }, 400, /few words/);
    await bad({ text: 'x'.repeat(2001), schedule: DAILY }, 413, /2000/);
    await bad({ text: 'fine enough', schedule: { every: 'hour', at: '09:00' } }, 400, /every day or every week/);
    await bad({ text: 'fine enough', schedule: { every: 'day', at: '25:00' } }, 400, /HH:MM/);
    await bad({ text: 'fine enough', schedule: { every: 'week', at: '09:00' } }, 400, /weekday/);
    await bad({ text: 'fine enough', schedule: { every: 'day', at: '09:00', tz: 'Nowhere/Land' } }, 400, /time zone/);
    await bad({ text: 'fine enough' }, 400);
    const ids = [];
    for (const n of [1, 2, 3]) ids.push((await create(a, `order number ${n}`)).id);
    assert.equal((await a.post(`/api/floors/${a.slug}/orders/${ids[0]}`, { status: 'paused' })).status, 200);
    await bad({ text: 'one too many', schedule: DAILY }, 409, /3 standing orders/);
    for (const id of ids) await remove(a, id);
    assert.equal((await orders(a)).length, 0);
  });
  test('visitors, other floors and a missing CSRF token are refused', async () => {
    const o = await create(a, 'something private to this floor');
    const v = new Client(t);
    assert.equal((await v.get(`/api/floors/${a.slug}/orders`)).status, 401);
    assert.equal((await v.post(`/api/floors/${a.slug}/orders`, { text: 'hijack', schedule: DAILY })).status, 401);
    assert.equal((await v.post(`/api/floors/${a.slug}/orders/${o.id}/delete`, {})).status, 401);
    assert.equal((await b.get(`/api/floors/${a.slug}/orders`)).status, 403);
    assert.equal((await b.post(`/api/floors/${a.slug}/orders`, { text: 'hijack', schedule: DAILY })).status, 403);
    assert.equal((await b.post(`/api/floors/${a.slug}/orders/${o.id}`, { status: 'paused' })).status, 403);
    assert.equal((await b.post(`/api/floors/${a.slug}/orders/${o.id}/delete`, {})).status, 403);
    assert.equal((await b.post(`/api/floors/${a.slug}/orders/${o.id}/run`, {})).status, 403);
    assert.equal((await a.post(`/api/floors/${a.slug}/orders`, { text: 'no token', schedule: DAILY }, { headers: { 'x-office-csrf': 'nope' } })).status, 403);
    assert.equal((await a.post(`/api/floors/${a.slug}/orders/${o.id}/delete`, {}, { headers: { 'x-office-csrf': 'nope' } })).status, 403);
    assert.equal((await a.post(`/api/floors/${a.slug}/orders`, { text: 'no origin', schedule: DAILY }, { headers: { origin: 'https://evil.example' } })).status, 403);
    const snap = await floorState(v, a.slug);
    assert.equal(snap.orders, undefined); assert.equal(snap.orderLimits, undefined);
    assert.equal((await orders(a)).length, 1, 'nothing got through');
    assert.equal((await orders(b)).length, 0);
    await remove(a, o.id);
  });
  test('run now goes through the engine at once, and refuses while the floor is busy', async () => {
    const o = await create(a, 'go build a quick thing');
    const o2 = await create(a, 'go build another thing');
    const r = await a.post(`/api/floors/${a.slug}/orders/${o.id}/run`, {});
    assert.equal(r.status, 202, JSON.stringify(r.data)); assert.equal(r.data.run.status, 'running');
    const again = await a.post(`/api/floors/${a.slug}/orders/${o.id}/run`, {});
    assert.equal(again.status, 409); assert.match(again.data.message, /running right now/);
    const other = await a.post(`/api/floors/${a.slug}/orders/${o2.id}/run`, {});
    assert.equal(other.status, 409); assert.match(other.data.message, /busy/);
    const done = await waitRun(t, o.id, 'done');
    assert.equal(done.tasks_done, 4); assert.ok(done.cost_usd >= 0); assert.ok(done.finished_at >= done.started_at);
    assert.equal(runsOf(t, o.id).length, 1);
    const fresh = (await orders(a)).find((x) => x.id === o.id);
    assert.equal(fresh.nextRunAt, o.nextRunAt, 'run now leaves the schedule alone');
    assert.equal(fresh.runs, 1); assert.equal(fresh.history.length, 1); assert.match(fresh.history[0].report, /Standing order #/);
    await remove(a, o.id); await remove(a, o2.id);
  });
});

describe('the runner', () => {
  let t, a;
  before(async () => { t = await mk(); a = await claim(t, 'Nightshift'); });
  after(() => t.close());
  test('a due order fires once, works through the real engine, reports to the boss alone, and advances by one period', async () => {
    assert.equal((await a.post(`/api/floors/${a.slug}/settings`, { publicChat: true })).status, 200);  // the hardest case: visitors may read chat
    await floorState(a);  // the boss opened the floor
    const o = await create(a, 'go build morning digest');
    assert.equal(o.nextRunAt, at9(0) - 1000);
    const v = new Client(t);
    const so = sse(a, a.slug), sv = sse(v, a.slug);
    await sleep(40);
    assert.equal(runsOf(t, o.id).length, 0);
    t.clock.t = at9(0);
    const running = await waitRun(t, o.id, 'running');
    assert.equal(running.est_usd, t.cfg.ordersEstimateUsd);
    const done = await waitRun(t, o.id, 'done');
    assert.equal(runsOf(t, o.id).length, 1, 'fired exactly once');
    assert.equal(done.tasks_done, 4); assert.equal(done.tasks_failed, 0);
    assert.ok(done.cost_usd > 0, 'the mock prices its calls'); assert.equal(typeof done.est_usd, 'number');
    const published = JSON.parse(done.published);
    assert.equal(published.length, 3); assert.ok(published.every((p) => p.url.startsWith(`/theoffice/f/${a.slug}/`)));
    assert.match(done.report, /\*\*Standing order #\d+\*\* ran/); assert.match(done.report, /Tasks: 4 done/); assert.match(done.report, /Published: \[/); assert.doesNotMatch(done.report, /Cost|\$/, 'a report says nothing about money');
    const fresh = (await orders(a))[0];
    assert.equal(fresh.runs, 1); assert.equal(fresh.lastRunAt, done.finished_at); assert.equal(fresh.failStreak, 0);
    assert.equal(fresh.nextRunAt, o.nextRunAt + DAY, 'advanced by exactly one period');
    assert.equal(fresh.estUsd, undefined); assert.ok(done.cost_usd > 0, 'the run\'s cost stays on the books for the admin');
    assert.equal(fresh.history.length, 1); assert.equal(fresh.history[0].status, 'done'); assert.equal(fresh.history[0].report, done.report);
    // The boss sees the fired instruction and the report; a visitor on a public-chat floor sees the chat but never the report.
    const own = await floorState(a);
    assert.ok(own.messages.some((m) => m.role === 'boss' && m.text === `Standing order #${o.id}: go build morning digest`));
    assert.ok(own.messages.some((m) => m.role === 'report' && m.text === done.report));
    assert.equal(own.projects.length, 3);
    const seen = await floorState(v, a.slug);
    assert.ok(seen.messages.length > 0, 'public chat is on'); assert.ok(!seen.messages.some((m) => m.role === 'report'));
    assert.equal(seen.orders, undefined);
    await sleep(60);
    assert.ok(so.events.some((e) => e.type === 'message' && e.data.role === 'report'), 'the owner stream carried the report');
    assert.ok(so.events.some((e) => e.type === 'orders'), 'the owner stream said orders changed');
    assert.ok(sv.events.some((e) => e.type === 'message'), 'the visitor stream carried chat');
    assert.ok(!sv.events.some((e) => e.type === 'message' && e.data.role === 'report'), 'but never the report');
    assert.ok(!sv.events.some((e) => e.type === 'orders'));
    await so.close(); await sv.close();
    // More ticks and more hours: still one run, because the slot moved on.
    await sleep(100);
    t.clock.t += 3 * HOUR;
    await sleep(100);
    assert.equal(runsOf(t, o.id).length, 1);
    await remove(a, o.id);
    assert.equal((await a.post(`/api/floors/${a.slug}/settings`, { publicChat: false })).status, 200);
  });
  test('the manager sets a standing order from chat and cancels it on request', async () => {
    assert.equal((await a.post(`/api/floors/${a.slug}/chat`, { text: '[standing] every morning write a haiku about the weather' })).status, 202);
    await until(async () => (await floorState(a)).messages.some((m) => m.role === 'manager' && /09:00/.test(m.text) && /Orders/.test(m.text)), { what: 'manager confirms the order' });
    const list = await orders(a);
    assert.equal(list.length, 1); assert.equal(list[0].text, 'every morning write a haiku about the weather'); assert.equal(list[0].scheduleText, 'Every day at 09:00 UTC'); assert.equal(list[0].status, 'active');
    assert.ok(list[0].nextRunAt > t.clock.t);
    assert.equal((await a.post(`/api/floors/${a.slug}/chat`, { text: '[cancelorder] drop that please' })).status, 202);
    await until(async () => (await orders(a)).length === 0, { what: 'order cancelled' });
    await until(async () => (await floorState(a)).messages.some((m) => m.role === 'manager' && /Cancelled/.test(m.text)), { what: 'manager confirms' });
    assert.equal(all(t.db, 'SELECT * FROM standing_orders').length, 0);
  });
  test('a busy floor defers rather than skipping, until the grace window passes', async () => {
    t.clock.t = MON_8 + 10 * HOUR;
    const o = await create(a, 'go build the daily thing');
    assert.equal(o.nextRunAt, at9(1) - 1000);
    assert.equal((await a.post(`/api/floors/${a.slug}/chat`, { text: 'go build long job [slow]' })).status, 202);
    await until(async () => (await floorState(a)).tasks.some((x) => x.status === 'doing'), { what: 'slow work to start' });
    t.clock.t = at9(1);
    await sleep(120);
    assert.equal(runsOf(t, o.id).length, 0, 'deferred while busy');
    assert.equal((await orders(a))[0].nextRunAt, o.nextRunAt, 'and the slot is kept');
    t.clock.t = at9(1) + 7 * HOUR;
    const skipped = await waitRun(t, o.id, 'failed');
    assert.match(skipped.report, /Skipped: the floor was busy/);
    assert.equal((await orders(a))[0].nextRunAt, o.nextRunAt + DAY);
    assert.equal((await orders(a))[0].failStreak, 0, 'a skipped slot is not a failure of the work');
    assert.equal((await a.post(`/api/floors/${a.slug}/control`, { action: 'stop' })).status, 200);
    await until(async () => (await floorState(a)).agents.every((x) => x.state === 'idle'), { what: 'idle' });
    await remove(a, o.id);
  });
  test('the building pause and a suspended floor defer', async () => {
    // Admin sessions last 12 hours of (fake) time, so the admin signs in again after each jump of the clock.
    const o = await create(a, 'go build the paused thing');
    assert.equal(o.nextRunAt, at9(2) - 1000);
    t.clock.t = at9(2) - 60000;
    let admin = await adminClient(t);
    assert.equal((await admin.post('/api/admin/pause', { on: true })).status, 200);
    t.clock.t = at9(2);
    await sleep(120);
    assert.equal(runsOf(t, o.id).length, 0, 'nothing runs in a paused building');
    assert.equal((await admin.post('/api/admin/pause', { on: false })).status, 200);
    await waitRun(t, o.id, 'done');
    const fid = get(t.db, 'SELECT id FROM floors WHERE slug=?', a.slug).id;
    assert.equal((await admin.post(`/api/admin/floors/${fid}/suspend`, {})).status, 200);
    t.clock.t = at9(3);
    await sleep(120);
    assert.equal(runsOf(t, o.id).length, 1, 'nothing runs on a closed floor');
    admin = await adminClient(t);
    assert.equal((await admin.post(`/api/admin/floors/${fid}/unsuspend`, {})).status, 200);
    await waitRun(t, o.id, 'done', 2);
    assert.equal(runsOf(t, o.id).length, 2);
    await remove(a, o.id);
  });
  test('a filler floor never runs an order', async () => {
    const c = await claim(t, 'Scripted Co');
    await floorState(c);
    const o = await create(c, 'go build something on the fake floor');
    run(t.db, 'UPDATE floors SET filler=1 WHERE slug=?', c.slug);
    t.clock.t += 2 * DAY;
    await sleep(120);
    assert.equal(runsOf(t, o.id).length, 0);
    const fresh = (await orders(c))[0];
    assert.equal(fresh.status, 'active'); assert.equal(fresh.nextRunAt, o.nextRunAt, 'not even written off');
    assert.equal(get(t.db, 'SELECT COUNT(*) n FROM tasks WHERE floor_id=(SELECT id FROM floors WHERE slug=?)', c.slug).n, 0);
  });
  test('a floor nobody opens for two weeks pauses its orders, and opening it brings them back', async () => {
    const d = await claim(t, 'Dormant Ltd');
    await floorState(d);
    const o = await create(d, 'go build the forgotten thing');
    t.clock.t += 15 * DAY;
    await until(async () => { const x = (await orders(d))[0]; return x.status === 'paused' ? x : null; }, { what: 'idle pause' });
    let fresh = (await orders(d))[0];
    assert.equal(fresh.pauseReason, idleReason(t.cfg.ordersIdleDays)); assert.equal(fresh.pauseReason, 'Paused: you have not opened the floor in 14 days');
    assert.equal(runsOf(t, o.id).length, 0);
    const snap = await floorState(d);  // this is the boss opening the floor, and the snapshot already reflects it
    assert.ok(snap.messages.some((m) => m.role === 'office' && /not opened the floor in 14 days/.test(m.text)), 'the boss was told');
    assert.equal(snap.orders[0].status, 'active'); assert.equal(snap.orders[0].pauseReason, '');
    assert.equal(snap.orders[0].nextRunAt, nextRunAt(snap.orders[0].schedule, t.clock.t), 'from the next slot, not the missed ones');
    await sleep(80);
    fresh = (await orders(d))[0];
    assert.equal(fresh.status, 'active'); assert.equal(runsOf(t, o.id).length, 0, 'nothing fires until that slot');
    // A pause by hand is not an idle pause, so opening the floor leaves it alone.
    assert.equal((await d.post(`/api/floors/${d.slug}/orders/${o.id}`, { status: 'paused' })).status, 200);
    await floorState(d);
    assert.equal((await orders(d))[0].status, 'paused');
  });
});

describe('failures', () => {
  test('three failed runs in a row pause the order with a reason and a notice to the boss', async () => {
    // Staff can spend nothing, so every task fails at its first step: a real engine failure, not a scripted one.
    const t = await mk({ taskMaxUsd: 0 });
    try {
      const a = await claim(t, 'Doomed Co');
      await floorState(a);
      const o = await create(a, 'go build the doomed thing');
      for (let i = 1; i <= 3; i++) {
        t.clock.t = at9(i - 1);
        const r = await waitRun(t, o.id, 'failed', i);
        assert.equal(r.tasks_failed, 4, `run ${i}`); assert.equal(r.tasks_done, 0);
        assert.match(r.report, /did not finish/); assert.match(r.report, /4 could not finish/);
        const fresh = (await orders(a))[0];
        assert.equal(fresh.failStreak, i); assert.equal(fresh.runs, i);
        if (i < 3) { assert.equal(fresh.status, 'active'); }
      }
      const paused = (await orders(a))[0];
      assert.equal(paused.status, 'paused'); assert.equal(paused.pauseReason, 'Paused: 3 runs in a row failed');
      assert.equal(paused.history.length, 3); assert.ok(paused.history.every((r) => r.status === 'failed'));
      const snap = await floorState(a);
      assert.ok(snap.messages.some((m) => m.role === 'office' && /failed 3 times in a row/.test(m.text)));
      assert.equal(snap.messages.filter((m) => m.role === 'report').length, 3);
      t.clock.t = at9(3);
      await sleep(100);
      assert.equal(runsOf(t, o.id).length, 3, 'a paused order does not fire');
      const back = await a.post(`/api/floors/${a.slug}/orders/${o.id}`, { status: 'active' });
      assert.equal(back.data.order.failStreak, 0); assert.equal(back.data.order.nextRunAt, at9(4) - 1000);
    } finally { await t.close(); }
  });
  test('a run that overruns is marked failed as timed out, and nothing is cancelled', async () => {
    const t = await mk({ ordersRunTimeoutMin: 0 });
    try {
      const a = await claim(t, 'Slowpoke');
      await floorState(a);
      const o = await create(a, 'go build the slow thing');
      t.clock.t = at9(0);
      const r = await waitRun(t, o.id, 'failed');
      assert.match(r.report, /Timed out after 0 minutes/);
      const s = await until(async () => { const x = await floorState(a); return x.tasks.length === 4 && x.tasks.every((k) => k.status === 'done') ? x : null; }, { what: 'the work still finishes' });
      assert.equal(s.projects.length, 3);
      assert.equal(runsOf(t, o.id).length, 1);
    } finally { await t.close(); }
  });
});

describe('restart safety', () => {
  async function bootShared(db, clock) {
    const cfg = loadConfig({ AI_MODE: 'mock', ADMIN_PASSWORD: 'x', MOCK_DELAY_MS: '2', RETRY_BASE_MS: '1' }, { rateScale: 1000, ordersTickMs: 20 });
    const app = createApp({ db, cfg, models: loadModels(), log: () => {}, now: () => clock.t });
    await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
    app.engine.start();
    const port = app.server.address().port; const host = `127.0.0.1:${port}`;
    return { db, cfg, app, host, port, base: `http://${host}/theoffice`, code: (f) => issueCode(db, f ?? null), close: () => app.close() };
  }
  test('a run in flight carries on after a restart, and the slot never fires twice', async () => {
    const db = openDb(':memory:'); const clock = { t: MON_8 };
    const t1 = await bootShared(db, clock);
    const a = await claim(t1, 'Phoenix');
    await floorState(a);
    const o = await create(a, 'go build the nightly thing');
    clock.t = at9(0);
    await until(() => runsOf({ db }, o.id).find((r) => r.status === 'running'), { what: 'run started' });
    await until(() => get(db, "SELECT 1 x FROM tasks WHERE status='doing'"), { what: 'staff mid-task' });
    await t1.close();  // the process dies with work in flight
    assert.equal(runsOf({ db }, o.id).length, 1); assert.equal(runsOf({ db }, o.id)[0].status, 'running');
    assert.equal(get(db, 'SELECT next_run_at n FROM standing_orders WHERE id=?', o.id).n, o.nextRunAt + DAY, 'the slot moved on before the crash');
    const t2 = await bootShared(db, clock);
    try {
      const a2 = new Client(t2); a2.cookies = a.cookies; a2.csrf = a.csrf; a2.slug = a.slug;
      const done = await waitRun({ db }, o.id, 'done');
      assert.equal(done.tasks_done, 4);
      assert.equal(runsOf({ db }, o.id).length, 1, 'the same run, finished, and no second one');
      const fresh = (await orders(a2))[0];
      assert.equal(fresh.runs, 1); assert.equal(fresh.nextRunAt, o.nextRunAt + DAY);
      await sleep(120);
      assert.equal(runsOf({ db }, o.id).length, 1);
      const s = await floorState(a2);
      assert.equal(s.projects.length, 3);
      assert.ok(s.messages.some((m) => m.role === 'report'));
    } finally { await t2.close(); db.close(); }
  });
});
