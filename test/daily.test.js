// The daily run: it stays off until the boss turns it on, runs at their hour, once a day, inside every guard, tells the truth, and never leaks.
// Against the real mock engine with a clock the test moves by hand.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boot, claim, floorState, until, Client, sleep } from './helpers.js';
import { get, all, run, openDb } from '../server/db.js';
import { loadConfig } from '../server/config.js';
import { nextRunAt, stripFigures, figuresIn, composeReport, dailyStatus, requestDailyRun, setDailyPaused, ensureDailySchema } from '../server/daily.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOUR = 3600000, DAY = 86400000;
// Monday 5 January 2026, 10:00 in New York (UTC-5).
const MON_NY_10 = Date.UTC(2026, 0, 5, 15, 0);

async function setup(over = {}) {
  const clock = { t: MON_NY_10 };
  const t = await boot({ dailyTickMs: 15, modesTickMs: 15, ordersTickMs: 60000, businessTickMs: 60000, mockDelayMs: 1, peopleTalk: false, ...over }, { now: () => clock.t });
  return Object.assign(t, { clock });
}
const floorOf = (t, c) => get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
const company = async (t, name, goal = 'Get our first ten customers') => {
  const c = await claim(t, name);
  if (goal) await c.post(`/api/floors/${c.slug}/work-mode`, { mode: 'ask', goal });
  return c;
};
const turnOn = (c, at = '11:00', tz = 'America/New_York') => c.post(`/api/floors/${c.slug}/daily`, { on: true, at, tz });
const dailyOf = async (c) => (await c.get(`/api/floors/${c.slug}/daily`)).data.daily;
const runs = (t, c) => all(t.db, 'SELECT * FROM daily_runs WHERE floor_id=? ORDER BY id', floorOf(t, c).id);
const lastRun = (t, c) => runs(t, c).at(-1);
const settled = (t, c, what = 'the run to end') => until(() => { const r = lastRun(t, c); return r && r.status !== 'running' ? r : null; }, { what });
const quiet = async () => sleep(120);
const dueNext = (t, c) => { t.clock.t = get(t.db, 'SELECT next_at n FROM daily_settings WHERE floor_id=?', floorOf(t, c).id).n; };

describe('the pure parts', () => {
  test('the next run is the next time the clock reads that hour, in the boss\'s zone', () => {
    assert.equal(nextRunAt('11:00', 'America/New_York', MON_NY_10), MON_NY_10 + HOUR, 'later today');
    assert.equal(nextRunAt('09:00', 'America/New_York', MON_NY_10), MON_NY_10 + 23 * HOUR, 'already gone today, so tomorrow');
    assert.equal(nextRunAt('09:00', 'UTC', MON_NY_10), Date.UTC(2026, 0, 6, 9, 0));
    const july = Date.UTC(2026, 6, 6, 13, 30);
    assert.equal(nextRunAt('10:00', 'America/New_York', july), Date.UTC(2026, 6, 6, 14, 0), 'summer time moves with the clock');
  });
  test('private figures come out of public words, and ordinary numbers stay', () => {
    const facts = { last7: { visitors: 312, views: 1400, signups: 2, accounts: 0, orders: 3, grossCents: 4500 }, prev7: { visitors: 0, views: 0, signups: 0, accounts: 0, orders: 0, grossCents: 0 }, today: { visitors: 40, views: 50, signups: 0, accounts: 0, orders: 0, grossCents: 0 }, sales: { currency: 'usd' }, accountsTotal: 0, ads: { spentCents: 1234, earnedCents: 4500, currency: 'usd' } };
    const figures = figuresIn(facts);
    for (const [input, want] of [
      ['We had 312 visitors last week', /\[private\] last week/],
      ['2 sign-ups so far', /\[private\] so far/],
      ['Revenue was $45.00 this week', /\[private\]/],
      ['$45.00 in sales', /\[private\]/],
      ['only 312 came by', /only \[private\] came/],
      ['we spent $12.34 on ads', /\[private\]/],
    ]) { const out = stripFigures(input, figures); assert.match(out, want, input); assert.doesNotMatch(out, /312|45\.00|12\.34/, input); }
    assert.equal(stripFigures('Add 3 levels and a $5 starter plan to task #312', figures), 'Add 3 levels and a $5 starter plan to task #312', 'a task number and a real price are not private');
    assert.equal(stripFigures('width: 100%; port 8080', figures), 'width: 100%; port 8080');
  });
  test('the report says plainly what happened, and has no AI cost or budget in it', () => {
    const facts = { hasData: false };
    const r = composeReport({ when: 'Mon 5 Jan', facts, outcome: 'nothing', why: '', tasks: [], published: [], summary: '', next: '' });
    assert.match(r, /Not enough data yet/);
    assert.match(r, /nothing was worth changing/i);
    assert.match(r, /look again/i);
    assert.doesNotMatch(r, /budget|\$\d/i);
    const s = composeReport({ when: 'x', facts, outcome: 'stopped', why: 'budget', tasks: [], published: [], summary: '', next: '' });
    assert.match(s, /stopped/); assert.doesNotMatch(s, /budget|\$\d/i);
  });
});

describe('the settings', () => {
  test('the building-wide limit defaults to 5 floors a day, and both limits can be set', () => {
    assert.equal(loadConfig({}).dailyMaxFloors, 5);
    assert.equal(loadConfig({ DAILY_MAX_FLOORS: '2' }).dailyMaxFloors, 2);
    assert.equal(loadConfig({ DAILY_TOKEN_CAP: '1000' }).dailyTokenCap, 1000);
  });
});

describe('off by default, one a day, and the goal first', () => {
  test('a floor that never turned it on never runs, however long it waits', async () => {
    const t = await setup();
    try {
      const c = await company(t, 'Quiet Co');
      assert.equal((await dailyOf(c)).on, false);
      t.clock.t += 3 * DAY;
      await quiet();
      assert.equal(runs(t, c).length, 0);
    } finally { await t.close(); }
  });
  test('turning it on doesn\'t start a run straight away; the run comes at the boss\'s hour, once, as a boss-only report', async () => {
    const t = await setup();
    try {
      const c = await company(t, 'Morning Co');
      const r = await turnOn(c, '11:00');
      assert.equal(r.status, 200);
      assert.equal(r.data.daily.on, true); assert.equal(r.data.daily.nextAt, MON_NY_10 + HOUR);
      await quiet();
      assert.equal(runs(t, c).length, 0, 'not yet');
      dueNext(t, c);
      const done = await settled(t, c);
      assert.equal(done.outcome, 'shipped');
      assert.ok(done.tokens >= 0);
      const tasks = all(t.db, 'SELECT auto, status FROM tasks WHERE floor_id=? ORDER BY id', floorOf(t, c).id);
      assert.ok(tasks.length >= 2, 'builder and tester');
      assert.ok(tasks.every((x) => x.auto === 1), 'on the autonomous models');
      const state = await floorState(c);
      const report = state.messages.find((m) => m.role === 'report' && /Daily report/.test(m.text));
      assert.ok(report, 'the report is in the boss\'s chat');
      assert.match(report.text, /Not enough data yet/);
      assert.match(report.text, /Live now:/);
      assert.match(report.text, /What's next/);
      // A second tick later the same day doesn't run again.
      t.clock.t += HOUR;
      await quiet();
      assert.equal(runs(t, c).length, 1, 'one a day');
      // The next day does.
      dueNext(t, c);
      await until(() => runs(t, c).length === 2 && lastRun(t, c).status !== 'running', { what: 'the second day\'s run' });
      assert.equal(runs(t, c).length, 2);
    } finally { await t.close(); }
  });
  test('no goal: the manager asks once and nothing starts; once there is a goal the next run goes ahead', async () => {
    const t = await setup();
    try {
      const c = await company(t, 'Goalless Inc', '');
      await turnOn(c, '11:00');
      dueNext(t, c);
      const f = floorOf(t, c);
      const asked = await until(() => get(t.db, "SELECT COUNT(*) n FROM messages WHERE floor_id=? AND role='note' AND text LIKE 'Goal needed:%'", f.id).n > 0, { what: 'the manager to ask' });
      assert.ok(asked);
      await quiet();
      assert.equal(runs(t, c).length, 0, 'nothing started');
      assert.equal(get(t.db, "SELECT COUNT(*) n FROM messages WHERE floor_id=? AND role='note' AND text LIKE 'Goal needed:%'", f.id).n, 1, 'asked once');
      assert.equal((await dailyOf(c)).needsGoal, true);
      await c.post(`/api/floors/${c.slug}/work-mode`, { mode: 'ask', goal: 'Sell the first ten mugs' });
      await settled(t, c, 'a run once a goal exists');
      assert.equal(runs(t, c).length, 1);
    } finally { await t.close(); }
  });
});

describe('the guards', () => {
  test('only so many floors can run in one day across the building', async () => {
    const t = await setup({ dailyMaxFloors: 1 });
    try {
      const a = await company(t, 'First Floor Co'), b = await company(t, 'Second Floor Co');
      await turnOn(a, '11:00'); await turnOn(b, '11:00');
      dueNext(t, a);
      await until(() => runs(t, a).length + runs(t, b).length >= 1, { what: 'a first run' });
      await quiet(); await quiet();
      assert.equal(runs(t, a).length + runs(t, b).length, 1, 'the limit held');
      assert.equal(get(t.db, 'SELECT COUNT(DISTINCT floor_id) n FROM daily_runs').n, 1);
    } finally { await t.close(); }
  });
  test('the token cap stops the run: open work is cancelled and the boss is told plainly', async () => {
    const t = await setup({ dailyTokenCap: 1, mockDelayMs: 15 });
    try {
      const c = await company(t, 'Hungry Co');
      await turnOn(c, '11:00');
      dueNext(t, c);
      const done = await settled(t, c);
      assert.equal(done.status, 'stopped'); assert.equal(done.why, 'tokens');
      assert.equal(done.outcome, 'stopped');
      assert.match(done.report, /stopped today's run early/);
      assert.equal(get(t.db, "SELECT COUNT(*) n FROM tasks WHERE floor_id=? AND status IN ('todo','doing')", floorOf(t, c).id).n, 0, 'nothing left running');
      assert.doesNotMatch(done.report, /budget/i);
    } finally { await t.close(); }
  });
  test('it stops cleanly when the building\'s budget runs out, and doesn\'t start when it already has', async () => {
    const t = await setup({ mockDelayMs: 150, globalDailyUsd: 5 });
    try {
      const c = await company(t, 'Thrifty Co');
      await turnOn(c, '11:00');
      dueNext(t, c);
      const f = floorOf(t, c);
      await until(() => runs(t, c).length === 1, { what: 'the run to start' });
      run(t.db, 'INSERT INTO ledger (floor_id,agent_id,model,prompt_tokens,completion_tokens,cost_usd,kind,day,created_at) VALUES (?,?,?,?,?,?,?,?,?)', f.id, 0, 'x', 0, 0, 9999, 'llm', new Date(t.clock.t).toISOString().slice(0, 10), t.clock.t);
      const done = await settled(t, c);
      assert.equal(done.why, 'budget'); assert.equal(done.status, 'stopped');
      assert.doesNotMatch(done.report, /budget/i, 'no budget talk on a floor');
      // On a day the building has already reached its cap, nothing starts at all.
      const other = await company(t, 'Later Co');
      await turnOn(other, '11:00');
      dueNext(t, other);
      run(t.db, 'INSERT INTO ledger (floor_id,agent_id,model,prompt_tokens,completion_tokens,cost_usd,kind,day,created_at) VALUES (?,?,?,?,?,?,?,?,?)', f.id, 0, 'x', 0, 0, 9999, 'llm', new Date(t.clock.t).toISOString().slice(0, 10), t.clock.t);
      await quiet();
      assert.equal(runs(t, other).length, 0);
    } finally { await t.close(); }
  });
  test('the Launch hold: a build the Tester fails never goes live', async () => {
    const t = await setup();
    try {
      const c = await company(t, 'Shaky Co', 'Get ten customers [flunk]');
      await turnOn(c, '11:00');
      dueNext(t, c);
      const done = await settled(t, c);
      assert.equal(done.outcome, 'held');
      assert.match(done.report, /did not go live/);
      assert.match(done.report, /blank on a phone/);
      const f = floorOf(t, c);
      assert.equal(get(t.db, 'SELECT COUNT(*) n FROM projects WHERE floor_id=? AND published_at IS NOT NULL', f.id).n, 0, 'nothing live');
    } finally { await t.close(); }
  });
  test('a serious bug on a passing verdict holds it too', async () => {
    const t = await setup();
    try {
      const c = await company(t, 'Maybe Co', 'Get ten customers [major]');
      await turnOn(c, '11:00');
      dueNext(t, c);
      const done = await settled(t, c);
      assert.equal(done.outcome, 'held');
      assert.equal(get(t.db, 'SELECT COUNT(*) n FROM projects WHERE floor_id=? AND published_at IS NOT NULL', floorOf(t, c).id).n, 0);
    } finally { await t.close(); }
  });
  test('publishing is refused during a run until the Tester passed exactly this version', async () => {
    const t = await setup();
    try {
      const c = await company(t, 'Strict Co');
      const f = floorOf(t, c);
      run(t.db, "INSERT INTO daily_runs (floor_id,day,building_day,started_at,facts,prompt) VALUES (?,?,?,?,?,?)", f.id, '2026-01-05', '2026-01-05', t.clock.t, '{}', '');
      assert.match(t.app.engine.daily.publishHold(f.id, 'shop'), /tested yet/);
      assert.match(t.app.engine.daily.publishHold(f.id, 'shop', 'We hit $45.00 in sales') || '', /tested yet|private numbers/);
      assert.equal(t.app.engine.daily.publishHold(999999, 'shop'), null, 'no run, no hold');
    } finally { await t.close(); }
  });
  test('doing nothing is a fine answer, and it says so', async () => {
    const t = await setup();
    try {
      const c = await company(t, 'Calm Co', 'Stay calm [nothing]');
      await turnOn(c, '11:00');
      dueNext(t, c);
      const done = await settled(t, c);
      assert.equal(done.outcome, 'nothing');
      assert.equal(get(t.db, 'SELECT COUNT(*) n FROM tasks WHERE floor_id=?', floorOf(t, c).id).n, 0, 'no tasks');
      assert.match(done.report, /Nothing was worth changing today, so the team did nothing/);
      assert.match(done.report, /Everything looks fine/, 'the manager\'s own reason');
      assert.match(done.report, /Look again tomorrow/);
    } finally { await t.close(); }
  });
  test('admin pause holds new runs; resume lets them go', async () => {
    const t = await setup();
    try {
      const c = await company(t, 'Paused Co');
      await turnOn(c, '11:00');
      setDailyPaused(t.db, true);
      dueNext(t, c);
      await quiet();
      assert.equal(runs(t, c).length, 0, 'paused');
      setDailyPaused(t.db, false);
      await settled(t, c);
      assert.equal(runs(t, c).length, 1);
    } finally { await t.close(); }
  });
  test('a forced run goes without the opt-in or the hour, but only once, and the goal still comes first', async () => {
    const t = await setup();
    try {
      const c = await company(t, 'Forced Co');
      const f = floorOf(t, c);
      requestDailyRun(t.db, f.id, t.clock.t);
      const done = await settled(t, c);
      assert.equal(done.forced, 1);
      await quiet();
      assert.equal(runs(t, c).length, 1, 'the request is used up');
      assert.equal((await dailyOf(c)).on, false, 'forcing one doesn\'t turn it on');
      const g = await company(t, 'No Goal Co', '');
      requestDailyRun(t.db, floorOf(t, g).id, t.clock.t);
      await quiet();
      assert.equal(runs(t, g).length, 0, 'goal first, even when forced');
    } finally { await t.close(); }
  });
  test('the daily status and the CLI work on the database alone', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'office-daily-'));
    try {
      const cli = (...args) => spawnSync(process.execPath, ['--no-warnings', join(ROOT, 'scripts/admin.mjs'), ...args], { env: { PATH: process.env.PATH, DATA_DIR: dir, AI_MODE: 'mock', ADMIN_PASSWORD: 'x' }, encoding: 'utf8' });
      const db = openDb(dir);
      ensureDailySchema(db);
      run(db, "INSERT INTO floors (number,slug,name,status,boss,colors,decor,recovery_hash,created_at) VALUES (?,?,?,?,?,?,?,?,?)", 7, 'seven', 'Seven', 'active', '{}', '{}', '{}', 'x', Date.now());
      db.close();
      let r = cli('daily', 'status');
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /Daily runs: on\. 0 of 5 floors/);
      assert.match(r.stdout, /No floor has it turned on/);
      r = cli('daily', 'pause');
      assert.equal(r.status, 0, r.stderr);
      r = cli('daily', 'status');
      assert.match(r.stdout, /PAUSED/);
      r = cli('daily', 'resume');
      assert.equal(r.status, 0, r.stderr);
      r = cli('daily', 'run', '7');
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /Asked for a run on floor 7/);
      r = cli('daily', 'status');
      assert.match(r.stdout, /floor 7: off.*run requested/);
      r = cli('daily', 'run', '8');
      assert.notEqual(r.status, 0);
      const check = openDb(dir);
      assert.ok(dailyStatus(check, { dailyMaxFloors: 5, dailyTokenCap: 5 }).floors[0].runRequested);
      check.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('it stays private', () => {
  test('a visitor gets no route, no report and no words from the run, even on a floor with its chat open', async () => {
    const t = await setup({
      salesSummaryFn: () => ({ currency: 'usd', grossCents: 4500, refundsCents: 0, orders: 3, activeSubs: 2, byDay: [{ day: new Date(MON_NY_10).toISOString().slice(0, 10), grossCents: 4500, orders: 3 }] }),
    });
    try {
      const c = await company(t, 'Open Books');
      const visitor = new Client(t);
      await c.post(`/api/floors/${c.slug}/customise`, { publicChat: true });
      run(t.db, 'UPDATE floors SET public_chat=1 WHERE slug=?', c.slug);
      for (const path of ['numbers', 'daily']) {
        const r = await visitor.get(`/api/floors/${c.slug}/${path}`);
        assert.ok(r.status === 401 || r.status === 403, `${path}: ${r.status}`);
      }
      await turnOn(c, '11:00');
      dueNext(t, c);
      const done = await settled(t, c);
      assert.match(done.report, /3 orders worth \$45\.00/, 'the boss\'s report has the real sales');
      const seen = await floorState(visitor, c.slug);
      const text = JSON.stringify(seen);
      assert.equal(seen.daily, undefined);
      assert.doesNotMatch(text, /45\.00|Daily report|worth \$|orders worth/);
      assert.ok(!(seen.messages || []).some((m) => m.role === 'report'), 'no reports for visitors');
      assert.ok(all(t.db, "SELECT text FROM messages WHERE floor_id=? AND role='note'", floorOf(t, c).id).every((m) => !/45\.00|4500/.test(m.text)), 'the figures aren\'t stored in the chat at all');
    } finally { await t.close(); }
  });
  test('the private figures reach the manager\'s prompt during a run, and not after it', async () => {
    const t = await setup({ salesSummaryFn: () => ({ currency: 'usd', grossCents: 4500, refundsCents: 0, orders: 3, activeSubs: 0, byDay: [{ day: new Date(MON_NY_10).toISOString().slice(0, 10), grossCents: 4500, orders: 3 }] }) });
    try {
      const c = await company(t, 'Prompted Co');
      const f = floorOf(t, c);
      await turnOn(c, '11:00');
      const seen = [];
      const realCtx = t.app.engine.managerContext.bind(t.app.engine);
      t.app.engine.managerContext = (floor, mgr) => { const r = realCtx(floor, mgr); seen.push(r.messages.map((m) => m.content).join('\n')); return r; };
      dueNext(t, c);
      await settled(t, c);
      assert.ok(seen.some((m) => /3 orders worth \$45\.00/.test(m)), 'it had the numbers');
      assert.equal(t.app.engine.daily.privateLines(f.id).length, 0, 'gone once the run is over');
    } finally { await t.close(); }
  });
  test('the report goes by email only if company email is on and the boss has an address, to that address only', async () => {
    const t = await setup();
    try {
      const c = await company(t, 'Mailing Co');
      const sent = [];
      t.app.engine.mail.ready = () => true;
      t.app.engine.mail.toolSend = async (ctx, to, subject, body) => { sent.push({ to, subject, body }); return { status: 'queued' }; };
      const f = floorOf(t, c);
      run(t.db, 'INSERT OR REPLACE INTO mail_floor (floor_id,boss_email) VALUES (?,?)', f.id, 'boss@example.com');
      await turnOn(c, '11:00');
      dueNext(t, c);
      await settled(t, c);
      await until(() => sent.length === 1, { what: 'the email' });
      assert.equal(sent[0].to, 'boss@example.com');
      assert.match(sent[0].subject, /Mailing Co: daily report/);
      assert.match(sent[0].body, /The numbers:/);
      assert.doesNotMatch(sent[0].body, /\*\*/);
    } finally { await t.close(); }
  });
  test('with email off, nothing is sent and nothing breaks', async () => {
    const t = await setup();
    try {
      const c = await company(t, 'No Mail Co');
      t.app.engine.mail.ready = () => false;
      let calls = 0;
      t.app.engine.mail.toolSend = async () => { calls++; return {}; };
      await turnOn(c, '11:00');
      dueNext(t, c);
      const done = await settled(t, c);
      assert.ok(done.report);
      assert.equal(calls, 0);
    } finally { await t.close(); }
  });
});
