// Work modes: "When I ask", "Set hours" and "Nonstop". Schedule maths, setting a mode from the boss's form and by chat, the runner against the
// real mock engine with an injectable clock (the gap, three failures pausing it, a waiting Buy or question not holding the team up), and what
// visitors and the boss see. See server/modes.js.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, claim, Client, floorState, until, sleep } from './helpers.js';
import { isOpen, nextOpening, parseMode, signLabel, daysLabel, wallClock } from '../server/modes.js';
import { get, all, run } from '../server/db.js';
import { loadConfig } from '../server/config.js';

const HOUR = 3600000, DAY = 86400000;
// Monday 5 January 2026, in winter: New York is UTC-5.
const MON_NY_10 = Date.UTC(2026, 0, 5, 15, 0);
const ny = (h) => ({ mode: 'hours', days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', tz: 'America/New_York', ...h });

describe('schedule maths', () => {
  test('set hours are open on the right days and times, in the boss\'s time zone', () => {
    assert.equal(isOpen(ny(), MON_NY_10), true, 'Monday 10:00 in New York');
    assert.equal(isOpen(ny(), MON_NY_10 - 2 * HOUR), false, '08:00 is before opening');
    assert.equal(isOpen(ny(), MON_NY_10 + 7 * HOUR), false, '17:00 is closing time');
    assert.equal(isOpen(ny(), MON_NY_10 + 7 * HOUR - 60000), true, '16:59 is still open');
    assert.equal(isOpen(ny(), MON_NY_10 - 2 * DAY), false, 'Saturday');
    assert.equal(isOpen(ny({ tz: 'UTC' }), MON_NY_10), true, 'the same instant is 15:00 in UTC');
    assert.equal(isOpen(ny({ tz: 'Asia/Tokyo' }), MON_NY_10), false, 'and Tuesday 00:00 in Tokyo');
    assert.equal(isOpen({ mode: 'nonstop', days: [], start: '09:00', end: '17:00', tz: 'UTC' }, MON_NY_10 - 2 * DAY), true);
    assert.equal(isOpen({ mode: 'ask', days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59', tz: 'UTC' }, MON_NY_10), false);
  });
  test('summer time moves the hours with the clock', () => {
    const july = Date.UTC(2026, 6, 6, 13, 30);  // Monday 09:30 in New York, which is UTC-4 in July
    assert.equal(isOpen(ny(), july), true);
    assert.equal(isOpen(ny(), july - HOUR), false, '08:30 local');
    assert.equal(wallClock('America/New_York', july).minutes, 9 * 60 + 30);
  });
  test('overnight hours belong to the day they start on', () => {
    const night = ny({ start: '22:00', end: '06:00', days: [5] });  // Friday night into Saturday morning
    const fri = Date.UTC(2026, 0, 10, 3, 30);  // Friday 22:30 in New York
    assert.equal(isOpen(night, fri), true);
    assert.equal(isOpen(night, fri + 6 * HOUR), true, 'Saturday 04:30 is still Friday\'s shift');
    assert.equal(isOpen(night, fri + 8 * HOUR), false, 'Saturday 06:30 is over');
    assert.equal(isOpen(night, fri + DAY), false, 'Saturday 22:30 is not a working night');
    assert.equal(isOpen(night, fri - DAY + 6 * HOUR), false, 'Friday 04:30 belongs to Thursday, which is off');
  });
  test('the next opening skips days off, and comes after the moment asked about', () => {
    const fri18 = Date.UTC(2026, 0, 9, 23, 0);  // Friday 18:00 in New York
    assert.equal(nextOpening(ny(), fri18), Date.UTC(2026, 0, 12, 14, 0), 'Monday 09:00');
    assert.equal(nextOpening(ny(), MON_NY_10 - 2 * HOUR), MON_NY_10 - HOUR, 'later the same morning');
    assert.equal(nextOpening({ mode: 'nonstop' }, fri18), null);
  });
  test('modes from the form or the tool are checked, and the sign reads as people say it', () => {
    assert.deepEqual(parseMode({ mode: 'hours', days: 'weekdays', start: '9:00', end: '17:00', tz: 'Europe/London' }).hours, { mode: 'hours', tz: 'Europe/London', days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' });
    assert.deepEqual(parseMode({ mode: 'hours', days: ['Sat', 'sun'], start: '1000', end: '14:30' }).hours.days, [0, 6]);
    assert.match(parseMode({ mode: 'sometimes' }).error, /Choose a work mode/);
    assert.match(parseMode({ mode: 'hours', days: [], start: '09:00', end: '17:00' }).error, /Pick the days/);
    assert.match(parseMode({ mode: 'hours', days: [1], start: '25:00', end: '17:00' }).error, /HH:MM/);
    assert.match(parseMode({ mode: 'hours', days: [1], start: '09:00', end: '09:00' }).error, /nonstop/);
    assert.match(parseMode({ mode: 'nonstop', tz: 'Mars/Olympus' }).error, /time zone/);
    assert.equal(parseMode({ mode: '24/7' }).hours.mode, 'nonstop');
    assert.equal(signLabel(ny()), 'Open 9–5');
    assert.equal(signLabel(ny({ start: '08:30', end: '18:00' })), 'Open 8:30–6');
    assert.equal(signLabel({ mode: 'nonstop' }), 'Open 24/7');
    assert.equal(signLabel({ mode: 'ask' }), 'On call');
    assert.equal(daysLabel([1, 2, 3, 4, 5]), 'Mon–Fri'); assert.equal(daysLabel([0, 6]), 'Weekends'); assert.equal(daysLabel([1, 3, 5]), 'Mon, Wed, Fri'); assert.equal(daysLabel([0, 1, 2, 3, 4, 5, 6]), 'Every day');
  });
  test('the gap between jobs is about five minutes unless AUTOPILOT_GAP_MIN says otherwise', () => {
    assert.equal(loadConfig({}).autopilotGapMin, 5);
    assert.equal(loadConfig({ AUTOPILOT_GAP_MIN: '0.5' }).autopilotGapMin, 0.5);
    assert.equal(loadConfig({ AUTOPILOT_GAP_MIN: 'soon' }).autopilotGapMin, 5);
    assert.equal(loadConfig({}).autopilotMaxFails, 3);
  });
});

// A frozen clock the test moves by hand; the mock model still works in real time underneath.
async function mk(over = {}) {
  const clock = { t: MON_NY_10 };
  const t = await boot({ modesTickMs: 15, ordersTickMs: 60000, mockDelayMs: 1, peopleTalk: false, ...over }, { now: () => clock.t });
  return Object.assign(t, { clock });
}
const floorOf = (t, c) => get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
const runsOf = (t, f) => all(t.db, 'SELECT * FROM mode_runs WHERE floor_id=? ORDER BY id', f.id);
const messagesOf = (t, f, role) => all(t.db, 'SELECT text FROM messages WHERE floor_id=? AND role=? ORDER BY id', f.id, role).map((m) => m.text);
const setMode = async (c, body) => { const r = await c.post(`/api/floors/${c.slug}/work-mode`, body); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.workMode; };
const waitRuns = (t, f, n, status = null) => until(() => { const rows = runsOf(t, f).filter((r) => (status ? r.status === status : r.status !== 'running')); return rows.length >= n ? rows : null; }, { what: `${n} finished jobs`, timeout: 20000 });

describe('setting the mode', () => {
  test('from the boss\'s form: the sign changes for visitors, the boss sees the plan, and the chat gets a line', async () => {
    const t = await mk();
    try {
      const c = await claim(t);
      const f = floorOf(t, c);
      let s = await floorState(c);
      assert.equal(s.floor.workMode.label, 'On call', 'the default is when I ask');
      const v = await setMode(c, { mode: 'hours', days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '09:00', end: '17:00', tz: 'America/New_York', goal: 'Sell more soup' });
      assert.equal(v.label, 'Open 9–5'); assert.equal(v.days, 'Mon–Fri'); assert.equal(v.goal, 'Sell more soup'); assert.equal(v.closed, false);
      assert.ok(messagesOf(t, f, 'office').some((m) => /Now working 9am to 5pm, Mon–Fri \(America\/New_York\)/.test(m)), 'a line in the chat');
      const visitor = await floorState(new Client(t), c.slug);
      assert.deepEqual(pickSign(visitor.floor.workMode), { label: 'Open 9–5', days: 'Mon–Fri', closed: false });
      assert.equal(visitor.workPlan, undefined, 'the goal and the list are the boss\'s alone');
      s = await floorState(c);
      assert.equal(s.workPlan.goal, 'Sell more soup');
      // Outside the hours the floor shows closed, with when it opens.
      t.clock.t = MON_NY_10 + 9 * HOUR;
      s = await floorState(new Client(t), c.slug);
      assert.equal(s.floor.workMode.closed, true); assert.equal(s.floor.workMode.opensAt, MON_NY_10 + 23 * HOUR);
      // Bad input is turned away with a reason, and the lobby card carries the sign too.
      const bad = await c.post(`/api/floors/${c.slug}/work-mode`, { mode: 'hours', days: [], start: '09:00', end: '17:00' });
      assert.equal(bad.status, 400); assert.match(bad.data.message, /Pick the days/);
      assert.equal((await new Client(t).post(`/api/floors/${c.slug}/work-mode`, { mode: 'nonstop' })).status >= 400, true, 'only the boss');
      const lobby = (await new Client(t).get('/api/floors')).data;
      const card = lobby.floors.find((x) => x.slug === c.slug);
      assert.equal(card.workMode.label, 'Open 9–5'); assert.equal(card.workMode.closed, true);
    } finally { await t.close(); }
  });

  test('by chat: "work nonstop", "work 9 to 5 on weekdays" and "only when I ask" go through the manager\'s tool', async () => {
    const t = await mk({ autopilotGapMin: 600 });
    try {
      const c = await claim(t);
      const f = floorOf(t, c);
      // A job the team starts on its own may be running alongside, so this waits for the mode itself.
      const say = async (text, mode) => {
        assert.equal((await c.post(`/api/floors/${c.slug}/chat`, { text })).status, 202);
        // And for the manager to finish answering, as a boss would, before the next line.
        return until(async () => { const w = (await floorState(c)).workPlan; return w.mode === mode && !t.app.engine.runs.size && !get(t.db, 'SELECT manager_wake w FROM floors WHERE id=?', f.id).w ? w : null; }, { what: `${mode} after "${text}"` });
      };
      t.clock.t = MON_NY_10 - 2 * DAY;  // a Saturday, so set hours don't open while this runs
      let w = await say('Work 9 to 5 on weekdays from now on please', 'hours');
      assert.equal(w.start, '09:00'); assert.equal(w.end, '17:00'); assert.deepEqual(w.dayList, [1, 2, 3, 4, 5]); assert.equal(w.label, 'Open 9–5');
      w = await say('Only when I ask, thanks', 'ask');
      assert.equal(w.label, 'On call');
      w = await say('Actually, work nonstop', 'nonstop');
      assert.equal(w.label, 'Open 24/7');
      w = await say('No, only when I ask', 'ask');
      const lines = messagesOf(t, f, 'office');
      assert.ok(lines.some((m) => /^Now working nonstop/.test(m)) && lines.some((m) => /^Now working 9am to 5pm/.test(m)) && lines.some((m) => /^Back on call/.test(m)), lines.join(' | '));
      // Words in a page or a staff report can't switch it on: the tool only works on the boss's own turn.
      const out = await t.app.engine.tools.exec({ ...t.app.engine.toolCtx(f, get(t.db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", f.id), null, ['set_work_mode']), bossTurn: false }, 'set_work_mode', JSON.stringify({ mode: 'nonstop' }));
      assert.match(out, /only changes when the boss asks/);
      assert.equal((await floorState(c)).workPlan.mode, 'ask');
    } finally { await t.close(); }
  });
});

const pickSign = (w) => ({ label: w.label, days: w.days, closed: w.closed });

describe('working on its own', () => {
  test('nonstop: the manager picks the next job off the list, runs it through the staff on Sonnet, posts a digest, and waits the gap', async () => {
    const t = await mk({ autopilotGapMin: 5 });
    try {
      const c = await claim(t);
      const f = floorOf(t, c);
      await setMode(c, { mode: 'nonstop', goal: '[build] Get the company known' });
      const [first] = await waitRuns(t, f, 1);
      assert.equal(first.status, 'done', JSON.stringify(first));
      const tasks = all(t.db, 'SELECT t.*, a.role FROM tasks t JOIN agents a ON a.id=t.agent_id WHERE t.floor_id=?', f.id);
      assert.ok(tasks.length >= 1 && tasks.every((x) => x.auto === 1), 'the job\'s tasks are marked as the team\'s own');
      const builder = get(t.db, "SELECT id FROM agents WHERE floor_id=? AND role='builder'", f.id).id;
      const models = new Set(all(t.db, 'SELECT model FROM ledger WHERE floor_id=? AND agent_id=?', f.id, builder).map((r) => r.model));
      assert.deepEqual([...models], ['claude-sonnet-5-5'], 'the Builder works on Sonnet in an autonomous job');
      // The digest: a line or two from the manager, with what it did and what's next. The goal and the list are kept up to date.
      const digest = messagesOf(t, f, 'office').find((m) => m.startsWith('**On our own:**'));
      assert.ok(digest && /Finished/.test(digest) && /Next up:/.test(digest), digest);
      assert.ok(!/\$|budget/i.test(digest), 'no money talk');
      const plan = (await floorState(c)).workPlan;
      assert.ok(plan.nextUp.length >= 1 && plan.goal, JSON.stringify(plan));
      // The job shows in the activity like any other.
      const feed = (await floorState(c)).feed.map((x) => x.text).join(' | ');
      assert.match(feed, /picked the next job/); assert.match(feed, /gave .* a task/);
      // The gap: nothing new until five minutes after the last job finished, then the next one starts.
      const row = get(t.db, 'SELECT next_at FROM work_modes WHERE floor_id=?', f.id);
      assert.equal(row.next_at, first.finished_at + 5 * 60000);
      await setMode(c, { mode: 'nonstop', goal: '[build] Get the company known, and soon' });
      assert.equal(get(t.db, 'SELECT next_at FROM work_modes WHERE floor_id=?', f.id).next_at, row.next_at, 'a new goal on the same mode keeps the gap');
      await sleep(150);
      assert.equal(runsOf(t, f).length, 1, 'still in the gap');
      t.clock.t = first.finished_at + 5 * 60000 - 1000; await sleep(100);
      assert.equal(runsOf(t, f).length, 1, 'a second short of the gap');
      t.clock.t = first.finished_at + 5 * 60000;
      await until(() => runsOf(t, f).length === 2, { what: 'the second job' });
      // A boss's own request still runs on the role's own model.
      await waitRuns(t, f, 2);
      await setMode(c, { mode: 'ask' });
      assert.equal((await c.post(`/api/floors/${c.slug}/chat`, { text: 'Build a page about soup' })).status, 202);
      await until(() => get(t.db, 'SELECT COUNT(*) n FROM tasks WHERE floor_id=? AND auto=0 AND status IN (\'done\',\'review\')', f.id).n >= 4, { what: 'the boss\'s job' });
      const bossModels = new Set(all(t.db, 'SELECT l.model FROM ledger l JOIN tasks x ON x.agent_id=l.agent_id WHERE l.floor_id=? AND l.agent_id=? AND x.auto=0 AND l.created_at>=?', f.id, builder, t.clock.t).map((r) => r.model));
      assert.ok(bossModels.has('claude-opus-5-5'), [...bossModels].join());
    } finally { await t.close(); }
  });

  test('three failed jobs in a row pause the mode and tell the boss', async () => {
    const t = await mk({ autopilotGapMin: 0, taskMaxUsd: 1e-9 });
    try {
      const c = await claim(t);
      const f = floorOf(t, c);
      await setMode(c, { mode: 'nonstop', goal: 'Write things' });
      await until(() => get(t.db, 'SELECT paused_reason p FROM work_modes WHERE floor_id=?', f.id).p, { what: 'the pause', timeout: 30000 });
      await sleep(200);
      const runs = runsOf(t, f);
      assert.equal(runs.length, 3, 'no fourth job'); assert.ok(runs.every((r) => r.status === 'failed'));
      assert.ok(messagesOf(t, f, 'office').some((m) => /^3 jobs in a row didn't finish, so I've stopped/.test(m)));
      const s = await floorState(c);
      assert.equal(s.workPlan.paused, true); assert.equal(s.floor.workMode.label, 'On call');
      // Setting the mode again starts it afresh.
      const v = await setMode(c, { mode: 'nonstop' });
      assert.equal(v.paused, false); assert.equal(get(t.db, 'SELECT fail_streak n FROM work_modes WHERE floor_id=?', f.id).n, 0);
    } finally { await t.close(); }
  });

  test('a question or a Buy waiting on the boss doesn\'t hold the team up', async () => {
    const t = await mk({ autopilotGapMin: 0 });
    try {
      const c = await claim(t);
      const f = floorOf(t, c);
      // A request for the boss's Buy click, already waiting.
      run(t.db, 'INSERT INTO purchases (floor_id,agent_id,item,price,why,link,created_at) VALUES (?,?,?,?,?,?,?)', f.id, null, 'A domain name', 12, 'For the launch', 'https://example.com/', t.clock.t);
      await setMode(c, { mode: 'nonstop', goal: '[ask] Write things' });
      await until(() => get(t.db, "SELECT 1 x FROM tasks WHERE floor_id=? AND status='blocked'", f.id), { what: 'a task waiting on the boss' });
      await until(() => runsOf(t, f).length >= 2, { what: 'the next job, while the question waits' });
      assert.ok(get(t.db, 'SELECT 1 x FROM questions WHERE floor_id=? AND answer IS NULL', f.id), 'the question is still waiting');
      assert.ok(get(t.db, "SELECT 1 x FROM purchases WHERE floor_id=? AND status='pending'", f.id), 'and so is the Buy');
      const [first] = runsOf(t, f);
      assert.ok(first.waiting >= 1, 'the first job knows something waits on the boss');
      assert.ok(messagesOf(t, f, 'office').some((m) => /waits on you, and the team has moved on/.test(m)));
      assert.ok((await floorState(c)).questions.length >= 1, 'the question stays in the chat');
    } finally { await t.close(); }
  });

  test('set hours: nothing starts while closed, the closed floor sends staff home, and the day ends with a recap', async () => {
    const t = await mk({ autopilotGapMin: 600 });
    try {
      const c = await claim(t);
      const f = floorOf(t, c);
      t.clock.t = MON_NY_10 - 3 * HOUR;  // 07:00 in New York
      await setMode(c, { mode: 'hours', days: 'weekdays', start: '09:00', end: '17:00', tz: 'America/New_York', goal: 'Write things' });
      await sleep(150);
      assert.equal(runsOf(t, f).length, 0, 'closed: nobody starts anything');
      assert.equal(t.app.engine.modes.closed(f.id), true);
      t.clock.t = MON_NY_10;
      const [job] = await waitRuns(t, f, 1);
      assert.equal(job.status, 'done');
      assert.equal(t.app.engine.modes.closed(f.id), false);
      t.clock.t = MON_NY_10 + 8 * HOUR;  // 18:00: closing time has passed
      await until(() => messagesOf(t, f, 'report').some((m) => /^\*\*Recap for Mon 5:\*\* the team did 1 job on its own: 1 done/.test(m)), { what: 'the recap' });
      assert.equal(runsOf(t, f).length, 1);
      // A recap is the boss's alone, and says nothing about money.
      const visitor = await floorState(new Client(t), c.slug);
      assert.ok(!(visitor.messages || []).some((m) => /Recap/.test(m.text)));
      for (const m of [...messagesOf(t, f, 'report'), ...messagesOf(t, f, 'office')]) assert.ok(!/\$\d|budget/i.test(m), m);
    } finally { await t.close(); }
  });
});
