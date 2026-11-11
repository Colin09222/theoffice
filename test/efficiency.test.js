// What keeps the floors cheap without making the work worse (docs/EFFICIENCY.md): a work-mode round that hands out nothing waits longer before the
// next one and calls no model meanwhile; a run on a cached model is cut rarely instead of every few steps; the manager reads a repeated round note once;
// a long file listing comes back as folder totals; a fix round on a computer that has grown huge starts on a fresh one; and the prompts ask for one
// brief per job and a check the size of the change. Each has a switch, and each switch is tried here.
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, claim, until, sleep } from './helpers.js';
import { get, all, run } from '../server/db.js';
import { loadConfig } from '../server/config.js';
import { trimSteps } from '../server/engine.js';
import { createMockSessions } from '../server/mock-sessions.js';
import { writeFile } from '../server/workspace.js';
import { managerPrompt, computerPrompt, taskGuide, laneBrief } from '../server/prompts.js';

const MIN = 60000;
const MON_NY_10 = Date.UTC(2026, 0, 5, 15, 0);
const open = [];
after(async () => { for (const t of open) await t.close(); });

// A frozen clock the test moves by hand, as in modes.test.js.
async function mk(over = {}, deps = {}) {
  const clock = { t: MON_NY_10 };
  const t = await boot({ modesTickMs: 15, ordersTickMs: 60000, mockDelayMs: 1, peopleTalk: false, ...over }, { now: () => clock.t, ...deps });
  open.push(t);
  return Object.assign(t, { clock });
}
const floorOf = (t, c) => get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
const managerOf = (t, f) => get(t.db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", f.id);
const runsOf = (t, f) => all(t.db, 'SELECT * FROM mode_runs WHERE floor_id=? ORDER BY id', f.id);
const modeRow = (t, f) => get(t.db, 'SELECT * FROM work_modes WHERE floor_id=?', f.id);
const managerCalls = (t, f) => get(t.db, "SELECT COUNT(*) n FROM ledger WHERE floor_id=? AND agent_id=? AND kind='model'", f.id, managerOf(t, f).id).n;
const setMode = async (c, body) => { const r = await c.post(`/api/floors/${c.slug}/work-mode`, body); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.workMode; };
const waitRuns = (t, f, n) => until(() => { const rows = runsOf(t, f).filter((r) => r.status !== 'running'); return rows.length >= n && !t.app.engine.runs.size ? rows : null; }, { what: `${n} finished jobs`, timeout: 20000 });

describe('a work-mode round that hands out nothing', () => {
  test('makes the next one wait three times as long, calls no model meanwhile, and anything new on the floor ends the wait', async () => {
    const t = await mk({ autopilotGapMin: 5 });
    const c = await claim(t); const f = floorOf(t, c);
    await setMode(c, { mode: 'nonstop', goal: '[idle] Wait for the contractor' });
    const [first] = await waitRuns(t, f, 1);
    assert.equal(first.status, 'done'); assert.equal(first.tasks_done, 0);
    assert.equal(get(t.db, 'SELECT COUNT(*) n FROM tasks WHERE floor_id=?', f.id).n, 0, 'the round handed out nothing');
    let row = modeRow(t, f);
    assert.equal(row.idle_streak, 1);
    assert.equal(row.next_at, first.finished_at + 15 * MIN, 'three gaps, not one');
    // The usual gap passes, and well past it: nobody is asked anything.
    const calls = managerCalls(t, f);
    assert.ok(calls >= 1, 'the first round did ask the manager');
    t.clock.t = first.finished_at + 14 * MIN;
    await sleep(250);
    assert.equal(runsOf(t, f).length, 1, 'no second round yet');
    assert.equal(managerCalls(t, f), calls, 'and no model call while it waits');
    // Its turn comes round. Still nothing to do, so the wait triples again.
    t.clock.t = first.finished_at + 15 * MIN;
    const [, second] = await waitRuns(t, f, 2);
    row = modeRow(t, f);
    assert.equal(row.idle_streak, 2);
    assert.equal(row.next_at, second.finished_at + 45 * MIN);
    // Something new on the floor: a request the boss has to look at. The wait is over at once, with the clock where it was.
    run(t.db, 'INSERT INTO purchases (floor_id,agent_id,item,price,why,link,created_at) VALUES (?,?,?,?,?,?,?)', f.id, null, 'A domain name', 12, 'For the launch', 'https://example.com/', t.clock.t);
    const [, , third] = await waitRuns(t, f, 3);
    assert.equal(third.started_at, second.finished_at, 'it did not wait for the 45 minutes');
    assert.equal(modeRow(t, f).idle_streak, 1, 'and the count started again from there');
    // The boss still hears about each round that did run, and never a figure.
    const notices = all(t.db, "SELECT text FROM messages WHERE floor_id=? AND role='office' AND text LIKE '**On our own:**%'", f.id).map((m) => m.text);
    assert.equal(notices.length, 3);
    for (const m of notices) assert.ok(!/\$\d|budget/i.test(m), m);
  });

  test('a round that does hand out work keeps the usual gap', async () => {
    const t = await mk({ autopilotGapMin: 5 });
    const c = await claim(t); const f = floorOf(t, c);
    await setMode(c, { mode: 'nonstop', goal: 'Write things' });
    const [first] = await waitRuns(t, f, 1);
    assert.ok(get(t.db, 'SELECT COUNT(*) n FROM tasks WHERE floor_id=?', f.id).n >= 1);
    const row = modeRow(t, f);
    assert.equal(row.idle_streak, 0); assert.equal(row.idle_mark, '');
    assert.equal(row.next_at, first.finished_at + 5 * MIN);
  });

  test('the wait has a ceiling, and setting the mode afresh starts the count again', async () => {
    const t = await mk({ autopilotGapMin: 5, autopilotIdleMaxMin: 20 });
    const c = await claim(t); const f = floorOf(t, c);
    await setMode(c, { mode: 'nonstop', goal: '[idle] Wait' });
    const [first] = await waitRuns(t, f, 1);
    t.clock.t = first.finished_at + 15 * MIN;
    const [, second] = await waitRuns(t, f, 2);
    assert.equal(modeRow(t, f).next_at, second.finished_at + 20 * MIN, 'never more than the ceiling');
    await setMode(c, { mode: 'hours', days: 'weekdays', start: '09:00', end: '17:00', tz: 'America/New_York' });
    assert.equal(modeRow(t, f).idle_streak, 0);
  });

  test('AUTOPILOT_IDLE_BACKOFF=0 goes back to a look every gap', async () => {
    assert.equal(loadConfig({}).autopilotIdleBackoff, true);
    assert.equal(loadConfig({}).autopilotIdleMaxMin, 360);
    assert.equal(loadConfig({ AUTOPILOT_IDLE_BACKOFF: '0' }).autopilotIdleBackoff, false);
    const t = await mk({ autopilotGapMin: 5, autopilotIdleBackoff: false });
    const c = await claim(t); const f = floorOf(t, c);
    await setMode(c, { mode: 'nonstop', goal: '[idle] Wait' });
    const [first] = await waitRuns(t, f, 1);
    assert.equal(modeRow(t, f).idle_streak, 0);
    assert.equal(modeRow(t, f).next_at, first.finished_at + 5 * MIN);
    t.clock.t = first.finished_at + 5 * MIN;
    await waitRuns(t, f, 2);
  });
});

describe('how long a run grows before its oldest steps are dropped', () => {
  const step = (i, chars) => [
    { role: 'assistant', content: null, tool_calls: [{ id: `c${i}`, type: 'function', function: { name: 'fetch_url', arguments: '{"url":"https://example.com"}' } }] },
    { role: 'tool', tool_call_id: `c${i}`, content: 'x'.repeat(chars) },
  ];
  const convo = (steps, chars) => { const m = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'brief' }]; for (let i = 0; i < steps; i++) m.push(...step(i, chars)); return m; };
  const size = (m) => m.slice(2).reduce((n, x) => n + JSON.stringify(x).length, 0);

  test('the wider window leaves a run alone where the old one cut it, and when it does cut it cuts deep', () => {
    const old = convo(30, 10000);  // about 300,000 characters of steps
    assert.ok(trimSteps(old, 2).length > 0, 'the old window cuts at 240,000');
    assert.ok(size(old) <= 160000 + 12000);
    const wide = convo(30, 10000);
    assert.deepEqual(trimSteps(wide, 2, { keep: 400000, cutTo: 150000 }), [], 'the wide one does not');
    assert.equal(wide.length, 62);
    const big = convo(45, 10000);  // past 400,000
    const dropped = trimSteps(big, 2, { keep: 400000, cutTo: 150000 });
    assert.ok(dropped.length >= 50, `one large cut, not a nibble: dropped ${dropped.length} messages`);
    assert.ok(size(big) <= 150000 + 12000, `kept ${size(big)}`);
    assert.equal(big[0].role, 'system'); assert.equal(big[1].content, 'brief', 'the prompt and the brief always stay');
    assert.equal(big[3].role, 'assistant', 'and what is left starts on a whole step');
    assert.deepEqual(trimSteps(big, 2, { keep: 400000, cutTo: 150000 }), [], 'then nothing more until it has grown all the way again');
  });

  test('a model with a prompt cache gets the wide window, one without keeps the old one, and the setting moves it', async () => {
    const t = await mk();
    const c = await claim(t); const f = floorOf(t, c);
    const e = t.app.engine;
    assert.deepEqual(e.trimWindow({ role: 'researcher' }, f.id), { keep: 400000, cutTo: 150000 }, 'Claude reads its cache at a fraction of the price');
    assert.deepEqual(e.trimWindow({ role: 'manager' }, f.id), { keep: 400000, cutTo: 150000 });
    assert.deepEqual(e.trimWindow({ role: 'tester' }, f.id), {}, 'the Tester\'s own model has no cache price, so every character is paid in full on every step');
    // A floor moved onto Claude through OpenRouter is still a cached model.
    e.budget.setFloorOverride(f.id, { providerOverride: { provider: 'openrouter', model: 'anthropic/claude-sonnet-5.5', effort: 'high' } });
    assert.deepEqual(e.trimWindow({ role: 'researcher' }, f.id), { keep: 400000, cutTo: 150000 });
    assert.equal(loadConfig({}).stepsKeepChars, 400000); assert.equal(loadConfig({}).stepsCutToChars, 150000);
    const was = loadConfig({ STEPS_KEEP_CHARS: '240000' });
    assert.equal(was.stepsKeepChars, 240000, 'STEPS_KEEP_CHARS=240000 is the old window');
    const t2 = await mk({ stepsKeepChars: 100000 });
    const c2 = await claim(t2);
    assert.deepEqual(t2.app.engine.trimWindow({ role: 'writer' }, floorOf(t2, c2).id), { keep: 100000, cutTo: 75000 }, 'what is kept is never more than three quarters of the trigger');
  });
});

describe('the manager reads a repeated round note once', () => {
  const note = (n) => `Work mode: the boss has set the team to work on its own (Open 24/7), and the floor is quiet. Pick the next most useful piece of work toward the goal and get it done now, through your staff as usual. Goal: Publish three pages. Round ${n}.`;
  const seed = (t, f) => {
    const e = t.app.engine;
    e.addMessage(f.id, 'boss', null, 'work nonstop please');
    for (let n = 1; n <= 3; n++) { e.addMessage(f.id, 'note', null, note(n)); e.managerSays(f.id, `Nothing new in round ${n}.`); }
    e.addMessage(f.id, 'note', null, 'The boss answered your question ("Which colour?"): blue');
    e.addMessage(f.id, 'note', null, note(4));
  };
  test('only the newest "Work mode:" note is whole; earlier ones are a line each, and every other note is untouched', async () => {
    const t = await mk();
    const c = await claim(t); const f = floorOf(t, c);
    seed(t, f);
    const { messages, meta } = t.app.engine.managerContext(f, managerOf(t, f));
    const texts = messages.map((m) => String(m.content));
    assert.equal(texts.filter((x) => x.includes('Pick the next most useful piece of work')).length, 1, 'the standing instructions are read once');
    assert.ok(texts.some((x) => x.includes('Round 4.')), 'in the newest note');
    assert.equal(texts.filter((x) => /Work mode: an earlier round, since dealt with/.test(x)).length, 3);
    assert.ok(texts.some((x) => x.includes('The boss answered your question ("Which colour?"): blue')), 'a note that says something of its own stays whole');
    assert.equal(texts.filter((x) => /^Nothing new in round \d\.$/.test(x)).length, 3, 'and so does what the manager said');
    assert.ok(meta.autopilot, 'the turn still knows it is a work-mode round');
  });
  test('MANAGER_DEDUPE_NOTES=0 sends every copy in full', async () => {
    assert.equal(loadConfig({}).managerDedupeNotes, true);
    assert.equal(loadConfig({ MANAGER_DEDUPE_NOTES: '0' }).managerDedupeNotes, false);
    const t = await mk({ managerDedupeNotes: false });
    const c = await claim(t); const f = floorOf(t, c);
    seed(t, f);
    const texts = t.app.engine.managerContext(f, managerOf(t, f)).messages.map((m) => String(m.content));
    assert.equal(texts.filter((x) => x.includes('Pick the next most useful piece of work')).length, 4);
  });
});

describe('a long file listing', () => {
  const fill = (t, f, agent) => {
    for (let i = 0; i < 300; i++) writeFile(t.db, f.id, `projects/shop/notes/research-findings-part-${String(i).padStart(3, '0')}.md`, 'x', agent.id, t.cfg.quotaBytes);
    for (let i = 0; i < 40; i++) writeFile(t.db, f.id, `projects/blog/post-${i}.md`, 'x', agent.id, t.cfg.quotaBytes);
  };
  const list = (t, f, agent, args = {}) => t.app.engine.tools.exec(t.app.engine.toolCtx(f, agent, null, ['list_files']), 'list_files', JSON.stringify(args));
  test('comes back as folder totals and how to see one folder, and a prefix still lists everything in it', async () => {
    const t = await mk();
    const c = await claim(t); const f = floorOf(t, c); const mgr = managerOf(t, f);
    fill(t, f, mgr);
    const all340 = await list(t, f, mgr);
    assert.ok(all340.length <= 12500, `short enough to read on every later step: ${all340.length}`);
    assert.match(all340, /^340 files, too many to list at once\. By folder: /);
    assert.match(all340, /projects\/blog\/ \(40\)/); assert.match(all340, /projects\/shop\/ \(300\)/);
    assert.match(all340, /Ask again with a prefix/);
    const blog = await list(t, f, mgr, { prefix: 'projects/blog/' });
    assert.equal(blog.split('\n').length, 40, 'one folder, in full');
    assert.doesNotMatch(blog, /too many/);
  });
  test('a short one is unchanged, and LIST_FILES_MAX_CHARS=off lists everything', async () => {
    assert.equal(loadConfig({}).listFilesMaxChars, 12000);
    assert.equal(loadConfig({ LIST_FILES_MAX_CHARS: 'off' }).listFilesMaxChars, Infinity);
    const t = await mk({ listFilesMaxChars: Infinity });
    const c = await claim(t); const f = floorOf(t, c); const mgr = managerOf(t, f);
    assert.equal(await list(t, f, mgr), 'The workspace is empty.');
    fill(t, f, mgr);
    assert.equal((await list(t, f, mgr)).split('\n').length, 340);
  });
});

describe('work sent back to a computer that has grown huge', () => {
  const BIG = { input_tokens: 100, cache_read_input_tokens: 290000, cache_creation_input_tokens: 4000, output_tokens: 300 };
  async function start(script = {}, overrides = {}) {
    const sessions = createMockSessions({}, script);
    const t = await mk({ computerEnabled: true, outputLagMs: 0, ...overrides }, { sessions });
    t.app.engine.runManager = async () => {};
    const c = await claim(t);
    const floor = floorOf(t, c); const mgr = managerOf(t, floor);
    const assign = () => { const r = t.app.engine.assignTask(floor, mgr, { to: 'builder', title: 'Build the game', brief: 'Build it. Done means: it plays.', plan: '', project: 'game', private: false, dependsOn: [] }); t.app.engine.kick(); return r; };
    const taskRow = (id) => get(t.db, 'SELECT * FROM tasks WHERE id=?', id);
    const settle = (id) => until(() => { const r = taskRow(id); return ['review', 'failed'].includes(r.status) && !t.app.engine.runs.size ? r : null; }, { what: `task ${id} to settle`, timeout: 8000 });
    return { t, floor, mgr, sessions, assign, taskRow, settle };
  }
  const turn = (texts, usage) => ({ usage, async onTurn(api, text) { texts.push(text); await api.step(); api.save([{ path: 'index.html', data: Buffer.from(`round ${texts.length}`) }]); await api.message(`Finished round ${texts.length}: the ball bounces.`); } });

  test('starts its fix round on a fresh computer, with the saved files, the brief, its last report and the notes', async () => {
    const texts = [];
    const h = await start(turn(texts, BIG));
    const { id } = h.assign();
    await h.settle(id);
    assert.equal(h.taskRow(id).session_ctx, 294100, 'the size of its conversation is on record');
    const firstSession = h.taskRow(id).session_id;
    h.t.app.engine.reviewTask(h.floor, h.mgr, id, 'revise', 'Make the ball bigger');
    await until(() => texts.length === 2 && h.taskRow(id).status === 'review' && !h.t.app.engine.runs.size, { what: 'the fix round' });
    assert.equal(h.sessions.calls.sessions.length, 2, 'a second computer');
    const row = h.taskRow(id);
    assert.notEqual(row.session_id, firstSession);
    assert.equal(row.session_fresh, 0); assert.equal(row.revisions, 1);
    // What the fresh computer is told: the whole original briefing, that it is a fresh computer, what it reported, and the notes. All in its first message.
    assert.match(texts[1], /Task #\d+: Build the game/); assert.match(texts[1], /Done means: it plays\./);
    assert.match(texts[1], /this is a fresh one\. Everything you saved then is in \/workspace\/project/);
    assert.match(texts[1], /<untrusted_data source="your earlier report">\nFinished round 1: the ball bounces\./, 'its own report comes back as data');
    assert.match(texts[1], /The Office Manager sent this back with notes:\nMake the ball bigger/);
    assert.ok(texts[1].indexOf('fresh one') < texts[1].indexOf('Make the ball bigger'), 'the notes come last');
    // And what it finds on its disk is what the first round saved.
    const second = [...h.sessions.sessions.values()][1];
    assert.equal(second.bundle.find((x) => x.path === 'project/index.html')?.data.toString(), 'round 1');
    // The first computer was asked for nothing more.
    assert.equal(h.sessions.calls.sends.filter((s) => s.id === firstSession && s.ev.type === 'user.message').length, 1);
    assert.match(h.t.logs.join('\n'), /fix round on a fresh computer/);
    // The money for both rounds is on the one task.
    const total = get(h.t.db, 'SELECT SUM(cost_usd) n FROM ledger WHERE floor_id=?', h.floor.id).n;
    assert.ok(Math.abs(row.cost_usd - total) < 1e-9);
  });

  test('a small one goes back to the same computer, and so does anything that is not a send-back', async () => {
    const texts = [];
    const h = await start(turn(texts, BIG), { sessionFreshOverTokens: 300000 });
    const { id } = h.assign();
    await h.settle(id);
    h.t.app.engine.reviewTask(h.floor, h.mgr, id, 'revise', 'Make the ball bigger');
    await until(() => texts.length === 2 && h.taskRow(id).status === 'review' && !h.t.app.engine.runs.size, { what: 'the fix round' });
    assert.equal(h.sessions.calls.sessions.length, 1, 'under the size: the same computer');
    assert.equal(h.taskRow(id).session_fresh, 0, 'and the send-back is spent either way');
    // Past the size now, but picked up again without a send-back (a pause, an answer): its unsaved work is on that computer, so that is where it goes.
    run(h.t.db, 'UPDATE tasks SET session_ctx=999999 WHERE id=?', id);
    h.t.app.engine.computer.pushMessage(id, 'You were paused for a while. Carry on where you left off.');
    run(h.t.db, "UPDATE tasks SET status='todo' WHERE id=?", id);
    h.t.app.engine.kick();
    await until(() => texts.length === 3 && h.taskRow(id).status === 'review' && !h.t.app.engine.runs.size, { what: 'the resumed round' });
    assert.equal(h.sessions.calls.sessions.length, 1);
    assert.match(texts[2], /^You were paused for a while/);
  });

  test('SESSION_FRESH_OVER_TOKENS=off always goes back to the same computer', async () => {
    assert.equal(loadConfig({}).sessionFreshOverTokens, 250000);
    assert.equal(loadConfig({ SESSION_FRESH_OVER_TOKENS: 'off' }).sessionFreshOverTokens, Infinity);
    assert.equal(loadConfig({ SESSION_FRESH_OVER_TOKENS: '400000' }).sessionFreshOverTokens, 400000);
    const texts = [];
    const h = await start(turn(texts, BIG), { sessionFreshOverTokens: Infinity });
    const { id } = h.assign();
    await h.settle(id);
    h.t.app.engine.reviewTask(h.floor, h.mgr, id, 'revise', 'Make the ball bigger');
    await until(() => texts.length === 2 && h.taskRow(id).status === 'review' && !h.t.app.engine.runs.size, { what: 'the fix round' });
    assert.equal(h.sessions.calls.sessions.length, 1);
    assert.match(texts[1], /^The Office Manager sent this back with notes:\nMake the ball bigger$/);
  });
});

describe('the prompts ask for one brief and a check the size of the change', () => {
  const floor = { name: 'Tiny Teacups', number: 7, tagline: 'Small cups', identity: '{}' };
  const cfg = { computerEnabled: true, appsBaseDomain: 'apps.test', anthropicKey: 'k', openrouterKey: 'k' };
  test('the manager is told: one job, one brief, with everything in it, and a small change says so', () => {
    const p = managerPrompt(floor, { name: 'Sam' }, { manager: 'Margot', person: '' }, cfg);
    assert.match(p, /- One job, one brief\. Everything the person needs is in it: what to make or change, what to leave alone, which files to read or use and where they are/);
    assert.match(p, /Don't split one person's job across several tasks/);
    assert.match(p, /begin the brief with "Small change:" and name the page and the exact words, link or picture/);
    assert.match(p, /Every brief for something that gets made ends with a line starting "Done means:"/, 'the acceptance checks are still asked for');
    assert.match(p, /Add a Tester when the change is big or could break something, and never for a small one\./);
  });
  test('a change to something live is checked where it changed; a first build keeps its whole routine', () => {
    const change = taskGuide({ live: true, lane: 'website' }, 'builder', cfg);
    assert.match(change, /Match the checking to the size of the change\. For a small one \(a link, a few words, a number, a picture swapped, one style fix\), this replaces the full routine for a new build/);
    assert.match(change, /No outside design review and no second round of screenshots, unless the change alters how the page looks as a whole\./);
    assert.match(change, /goes in your reply as a suggestion, never into the page\./);
    assert.match(change, /Then publish it again with the same title and kind/);
    assert.doesNotMatch(taskGuide({ live: true, lane: 'website' }, 'designer', cfg), /Match the checking/, 'only whoever publishes the change');
    assert.doesNotMatch(taskGuide({ live: true, lane: 'website' }, 'builder', { ...cfg, computerEnabled: false }), /Match the checking/, 'with no browser there is no routine to shorten');
    const first = laneBrief('website', 'builder', cfg);
    assert.match(first, /call review_design with a desktop and a phone screenshot, fix what it marks \[broken\] or calls invented, and call it again on the result/);
    assert.doesNotMatch(first, /Match the checking/);
    assert.match(taskGuide({ live: true, lane: 'website' }, 'tester', cfg), /Check it like its first real visitor/, 'the Tester still tests the whole thing');
  });
  test('on a computer: a check kept as a file, each screenshot looked at once, a file read once', () => {
    const p = computerPrompt(cfg, 'builder', { computerBrief: 'You are the Builder.' });
    assert.match(p, /- Keep a check you will run again as a file \(such as \/workspace\/check\.cjs\)/);
    assert.match(p, /- Look at each screenshot once\./);
    assert.match(p, /- Read a file once\./);
    assert.match(p, /call review_design with file "review-1\.png"/, 'the review routine for a build is as it was');
  });
});
