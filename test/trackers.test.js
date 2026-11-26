// Sales and website traffic trackers (server/trackers.js, docs/TRACKERS.md): sales totals by New York day, undo, hand-entered traffic, the
// removable test offset, who sees the cards, the admin-only route and the admin CLI. Mock mode.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boot, claim, adminClient, floorState, Client } from './helpers.js';
import { openDb, get, run } from '../server/db.js';
import { ensureTrackerSchema, setReferrals, addReferrals, referralsView, listReferrals, addSale, undoSale, salesView, trafficView, setTrafficDay, setTrafficOffset, offsetFor, etDay, addDays, floorFor, TrackerError } from '../server/trackers.js';

// 2026-11-25 14:00 UTC = 09:00 in New York.
const NOW = Date.parse('2026-11-25T14:00:00Z');
const H = 3600e3;
function scratch() {
  const db = openDb(':memory:'); ensureTrackerSchema(db);
  const id = (n, slug) => Number(run(db, "INSERT INTO floors (number, slug, name, tagline, colors, boss, decor, status, recovery_hash, created_at) VALUES (?,?,?,'','{}','{}','{}','active','x',?)", n, slug, slug, NOW).lastInsertRowid);
  return { db, f: id(3, 'labstackr'), g: id(4, 'other') };
}
const visits = (db, floorId, day, uniques, views, project = 'site') => run(db, 'INSERT INTO app_visits (floor_id,project,day,path,views,uniques) VALUES (?,?,?,?,?,?)', floorId, project, day, '/', views, uniques);
const publish = (db, floorId, slug = 'site') => run(db, "INSERT INTO projects (floor_id, slug, title, description, kind, private, published_at, sources, created_at) VALUES (?,?,?,'','site',0,?,'[]',?)", floorId, slug, slug, NOW, NOW);

describe('sales totals', () => {
  test('today, 7 days, this month and all time, by New York day, with qty as the count', () => {
    const { db, f, g } = scratch();
    addSale(db, f, { amountUsd: 10, now: NOW });                                         // today 09:00 ET
    addSale(db, f, { amountUsd: '25.50', qty: 3, note: 'three kits', now: NOW });
    addSale(db, f, { amountUsd: 5, date: '2026-11-20', now: NOW });                     // 5 days back: week + month
    addSale(db, f, { amountUsd: 7, date: '2026-11-18', now: NOW });                     // 7 days back: month only
    addSale(db, f, { amountUsd: 100, date: '2026-10-31', now: NOW });                   // last month: all time only
    addSale(db, g, { amountUsd: 999, now: NOW });                                       // another floor: never counted here
    const s = salesView(db, f, NOW);
    assert.deepEqual([s.today.count, s.today.cents], [4, 3550]);
    assert.deepEqual([s.week.count, s.week.cents], [5, 4050]);
    assert.deepEqual([s.month.count, s.month.cents], [6, 4750]);
    assert.deepEqual([s.all.count, s.all.cents, s.all.entries], [7, 14750, 5]);
    assert.equal(s.recent[0].note, 'three kits');
    assert.equal(s.recent[0].source, 'manual');
    assert.equal(s.recent.find((r) => r.day === '2026-11-20').timed, false);
  });

  test('late evening in New York is still that day, though UTC has moved on', () => {
    const { db, f } = scratch();
    const lateEt = Date.parse('2026-11-26T03:30:00Z');  // 22:30 on the 25th in New York
    assert.equal(etDay(lateEt), '2026-11-25');
    addSale(db, f, { amountUsd: 12, now: lateEt });
    assert.equal(salesView(db, f, lateEt).today.cents, 1200);
    assert.equal(salesView(db, f, lateEt + 2 * H).today.cents, 0);  // 00:30 on the 26th
  });

  test('undo takes a sale out of every total, keeps the row, and cannot run twice', () => {
    const { db, f, g } = scratch();
    const a = addSale(db, f, { amountUsd: 40, now: NOW });
    addSale(db, f, { amountUsd: 2, now: NOW });
    assert.equal(salesView(db, f, NOW).all.cents, 4200);
    assert.throws(() => undoSale(db, a.id, { floorId: g, now: NOW }), TrackerError);   // wrong floor
    const u = undoSale(db, a.id, { now: NOW + 1000 });
    assert.equal(u.undoneAt, NOW + 1000);
    const s = salesView(db, f, NOW);
    assert.deepEqual([s.today.cents, s.week.cents, s.month.cents, s.all.cents, s.all.count], [200, 200, 200, 200, 1]);
    assert.ok(!s.recent.some((r) => r.id === a.id));
    assert.ok(get(db, 'SELECT undone_at FROM floor_sales WHERE id=?', a.id).undone_at);
    assert.throws(() => undoSale(db, a.id, { now: NOW }), /already undone/);
  });

  test('bad input is refused', () => {
    const { db, f } = scratch();
    for (const bad of [{ amountUsd: 0 }, { amountUsd: -5 }, { amountUsd: 'abc' }, { amountUsd: 5, qty: 0 }, { amountUsd: 5, qty: 1.5 }, { amountUsd: 5, date: '2026-13-01' }, { amountUsd: 5, date: '2026-11-26' }]) {
      assert.throws(() => addSale(db, f, { ...bad, now: NOW }), TrackerError, JSON.stringify(bad));
    }
  });
});

describe('referrals', () => {
  test('set, add and take back, by New York year, kept as a ledger; never under 0', () => {
    const { db, f, g } = scratch();
    assert.equal(referralsView(db, f, NOW).ytd, 0);
    assert.equal(setReferrals(db, f, { count: 74, note: 'start', now: NOW }).ytd, 74);
    assert.equal(addReferrals(db, f, { now: NOW + H }).ytd, 75);
    assert.equal(addReferrals(db, f, { n: -2, now: NOW + 2 * H }).ytd, 73);
    assert.equal(setReferrals(db, f, { count: 74, now: NOW + 3 * H }).delta, 1);
    assert.deepEqual(referralsView(db, f, NOW + 4 * H), { year: 2026, ytd: 74 });
    assert.equal(listReferrals(db, f).length, 4);
    assert.equal(referralsView(db, g, NOW).ytd, 0);
    // 2027-01-01 00:30 in New York is 05:30 UTC: a new year starts at 0; 04:30 UTC is still 2026 there.
    assert.equal(referralsView(db, f, Date.parse('2027-01-01T04:30:00Z')).ytd, 74);
    assert.equal(referralsView(db, f, Date.parse('2027-01-01T05:30:00Z')).ytd, 0);
    assert.throws(() => addReferrals(db, f, { n: -75, now: NOW }), TrackerError);
    assert.throws(() => setReferrals(db, f, { count: -1, now: NOW }), TrackerError);
    assert.throws(() => setReferrals(db, f, { count: 'x', now: NOW }), TrackerError);
    assert.throws(() => addReferrals(db, f, { n: 0, now: NOW }), TrackerError);
  });
});

describe('traffic', () => {
  test('counted visits by UTC day across the floor\'s projects; a hand-entered day replaces the counted one', () => {
    const { db, f } = scratch(); publish(db, f);
    visits(db, f, '2026-11-25', 30, 70); visits(db, f, '2026-11-25', 5, 6, 'blog');
    visits(db, f, '2026-11-20', 10, 20);
    visits(db, f, '2026-10-01', 999, 999);                       // older than 30 days
    setTrafficDay(db, f, { date: '2026-11-20', visits: 12, pageviews: 40, now: NOW });
    const t = trafficView(db, f, NOW);
    assert.equal(t.source, 'counted+manual');
    assert.deepEqual([t.today.visits, t.today.views], [35, 76]);
    assert.deepEqual([t.week.visits, t.week.views], [47, 116]);
    assert.deepEqual([t.month.visits, t.month.views], [47, 116]);
    assert.equal(t.series.length, 30);
    assert.equal(t.series.at(-1).day, '2026-11-25');
    assert.equal(t.test, undefined);
  });

  test('a floor with no site shows only what is entered by hand', () => {
    const { db, g } = scratch();
    assert.equal(trafficView(db, g, NOW).shown, false);
    setTrafficDay(db, g, { date: '2026-11-24', visits: 8, now: NOW });
    const t = trafficView(db, g, NOW);
    assert.equal(t.source, 'manual'); assert.equal(t.shown, true);
    assert.deepEqual([t.week.visits, t.week.views], [8, 8]);   // pageviews not given: the visits stand in
  });

  test('the test offset adds N to each day from its start, on top of the real figures, and --off brings the real ones back', () => {
    const { db, f } = scratch(); publish(db, f);
    visits(db, f, '2026-11-24', 20, 40);   // before the start: untouched
    visits(db, f, '2026-11-25', 7, 9);
    setTrafficOffset(db, f, { perDay: 500, from: '2026-11-25', now: NOW });
    let t = trafficView(db, f, NOW);
    assert.deepEqual(t.test, { perDay: 500, from: '2026-11-25' });
    assert.deepEqual([t.today.visits, t.today.views, t.today.real.visits, t.today.real.views], [507, 509, 7, 9]);
    assert.deepEqual([t.week.visits, t.week.real.visits], [527, 27]);
    // Three days on, each of the 3 days from the start has +500: the totals carry 1,500.
    const later = NOW + 2 * 24 * H;
    visits(db, f, '2026-11-27', 3, 3);
    t = trafficView(db, f, later);
    assert.equal(t.today.visits, 503);
    assert.equal(t.week.visits, 20 + 7 + 3 + 1500);
    assert.equal(t.week.real.visits, 30);
    // The offset is never written into the real rows.
    assert.equal(get(db, 'SELECT SUM(uniques) n FROM app_visits WHERE floor_id=?', f).n, 30);
    setTrafficOffset(db, f, { perDay: null });
    t = trafficView(db, f, later);
    assert.equal(t.test, undefined);
    assert.equal(t.week.visits, 30);
  });

  test('offsetFor: only days from the start up to today', () => {
    const o = { perDay: 500, from: '2026-11-25' };
    assert.equal(offsetFor(o, '2026-11-24', '2026-11-30'), 0);
    assert.equal(offsetFor(o, '2026-11-25', '2026-11-30'), 500);
    assert.equal(offsetFor(o, '2026-12-01', '2026-11-30'), 0);
    assert.equal(offsetFor(null, '2026-11-25', '2026-11-30'), 0);
    assert.equal(addDays('2026-03-09', -1), '2026-03-08');   // no daylight-saving gap
  });

  test('floorFor takes a number or a slug', () => {
    const { db } = scratch();
    assert.equal(floorFor(db, '3').slug, 'labstackr');
    assert.equal(floorFor(db, 'labstackr').number, 3);
    assert.equal(floorFor(db, '99'), undefined);
  });
});

describe('who sees the cards, and the admin-only route', () => {
  test('the boss and the admin get trackers in the snapshot; a visitor and another boss do not; TRACKERS=0 hides them', async () => {
    const t = await boot();
    try {
      const c = await claim(t, 'Sales Co'); const other = await claim(t, 'Other Co');
      const f = get(t.db, 'SELECT id FROM floors WHERE slug=?', c.slug);
      addSale(t.db, f.id, { amountUsd: 19.99, note: 'first sale' });
      const boss = await floorState(c);
      assert.equal(boss.trackers.sales.all.cents, 1999);
      assert.equal(boss.trackers.sales.recent[0].note, 'first sale');
      const visitor = await floorState(new Client(t), c.slug);
      assert.equal(visitor.trackers, undefined);
      assert.equal((await floorState(other, c.slug)).trackers, undefined);
      const admin = await adminClient(t);
      assert.equal((await floorState(admin, c.slug)).trackers.sales.all.cents, 1999);
      setReferrals(t.db, f.id, { count: 74 });
      assert.equal((await floorState(c)).trackers.referrals.ytd, 74);
      assert.equal((await floorState(new Client(t), c.slug)).trackers, undefined);
      t.cfg.trackers = false;
      assert.equal((await floorState(c)).trackers, undefined);
    } finally { await t.close(); }
  });

  test('admin route adds and undoes; a boss or a visitor cannot write', async () => {
    const t = await boot();
    try {
      const c = await claim(t, 'Route Co');
      const admin = await adminClient(t);
      const r = await admin.post(`/api/admin/trackers/${c.number}/sales`, { amount: 12.5, qty: 2, note: 'mugs' });
      assert.equal(r.status, 201); assert.equal(r.data.sale.amountCents, 1250);
      assert.equal((await admin.post(`/api/admin/trackers/${c.slug}/sales`, { amount: -1 })).status, 400);
      assert.equal((await c.post(`/api/admin/trackers/${c.number}/sales`, { amount: 5 })).status, 401);
      assert.equal((await new Client(t).post(`/api/admin/trackers/${c.number}/sales`, { amount: 5 })).status, 401);
      const g = await admin.get(`/api/admin/trackers/${c.number}`);
      assert.equal(g.status, 200); assert.equal(g.data.sales.all.cents, 1250);
      const u = await admin.post(`/api/admin/trackers/${c.number}/sales/${r.data.sale.id}/undo`, {});
      assert.equal(u.status, 200);
      assert.equal((await admin.get(`/api/admin/trackers/${c.number}`)).data.sales.all.cents, 0);
      assert.equal((await admin.post(`/api/admin/trackers/${c.number}/sales/${r.data.sale.id}/undo`, {})).status, 400);
      const rs = await admin.post(`/api/admin/trackers/${c.number}/referrals`, { count: 74 });
      assert.equal(rs.status, 201); assert.equal(rs.data.referrals.ytd, 74);
      assert.equal((await admin.post(`/api/admin/trackers/${c.slug}/referrals`, { add: 2 })).data.referrals.ytd, 76);
      assert.equal((await admin.post(`/api/admin/trackers/${c.number}/referrals`, { count: -3 })).status, 400);
      assert.equal((await c.post(`/api/admin/trackers/${c.number}/referrals`, { add: 1 })).status, 401);
      assert.equal((await new Client(t).post(`/api/admin/trackers/${c.number}/referrals`, { add: 1 })).status, 401);
      assert.equal((await admin.get(`/api/admin/trackers/${c.number}`)).data.referrals.entries.length, 2);
    } finally { await t.close(); }
  });
});

describe('admin CLI', () => {
  test('sales add / list / undo and traffic set / offset on a database file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'trk-'));
    try {
      const db = openDb(dir);
      run(db, "INSERT INTO floors (number, slug, name, tagline, colors, boss, decor, status, recovery_hash, created_at) VALUES (3,'labstackr','Labstackr','','{}','{}','{}','active','x',?)", Date.now());
      db.close();
      const cli = (...args) => execFileSync(process.execPath, ['scripts/admin.mjs', ...args], { env: { ...process.env, DATA_DIR: dir }, encoding: 'utf8' });
      const added = JSON.parse(cli('sales', 'add', '--floor', 'labstackr', '--amount', '29.99', '--qty', '2', '--note', 'Starter kit', '--json'));
      assert.equal(added.sale.amountCents, 2999); assert.equal(added.today.count, 2);
      assert.match(cli('sales', 'add', '--floor', '3', '--amount', '10'), /Logged sale #2 on floor 3/);
      const listed = JSON.parse(cli('sales', 'list', '--floor', '3', '--json'));
      assert.equal(listed.all.cents, 3999);
      assert.match(cli('sales', 'undo', '--id', String(added.sale.id)), /Undid sale #1/);
      assert.equal(JSON.parse(cli('sales', 'list', '--floor', '3', '--json')).all.cents, 1000);
      cli('traffic', 'set', '--floor', '3', '--date', etDay(Date.now()), '--visits', '4', '--pageviews', '9');
      assert.match(cli('traffic', 'offset', '--floor', '3', '--per-day', '500', '--from', '2026-11-25'), /Test offset on for floor 3: \+500/);
      const shown = JSON.parse(cli('traffic', 'show', '--floor', '3', '--json')).traffic;
      assert.equal(shown.test.perDay, 500);
      assert.equal(shown.week.real.visits, 4);
      assert.match(cli('traffic', 'offset', '--floor', '3', '--off'), /off/);
      assert.equal(JSON.parse(cli('traffic', 'show', '--floor', '3', '--json')).traffic.test, undefined);
      assert.throws(() => cli('sales', 'add', '--floor', '3', '--amount', 'x'));
      assert.match(cli('referrals', 'set', '--floor', 'labstackr', '--count', '74', '--note', 'YTD from Colon'), /Referrals on floor 3 \(labstackr\): 74 YTD/);
      assert.match(cli('referrals', 'add', '--floor', '3'), /75 YTD/);
      assert.match(cli('referrals', 'add', '--floor', '3', '--n', '-1'), /74 YTD/);
      const ref = JSON.parse(cli('referrals', 'show', '--floor', '3', '--json'));
      assert.equal(ref.referrals.ytd, 74); assert.equal(ref.entries.length, 3);
      assert.throws(() => cli('referrals', 'set', '--floor', '3', '--count', 'x'));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
