// Happening now (docs/redesign/OFFICE-ANSWERS-1.md, Q3 and section 4; job 30): five lines at most, real work only, newest first, one line per
// job from its job card (updated in place), never the same line twice, nothing older than a day; with nothing left, "Quiet right now" and
// when the last job really finished. The same day rule holds for Now on the floor's status card. Mock mode.
//
// The live case this was written for: after job 14 went live the strip showed "TheTireRx · Tess picked the next job to work on" five times,
// 14 to 24 hours old. Those lines are status pings from work mode, not work, and that old.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boot, claim, Client, floorState } from './helpers.js';
import { get, run } from '../server/db.js';
import { isRealWork } from '../server/building.js';

const HOUR = 3600e3;
const floorOf = (t, c) => get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
/** A feed line as the engine writes it, at a time of our choosing. */
function feedAt(t, f, { name = 'Tess', agent = 1, text, at, project = '' }) {
  run(t.db, "INSERT INTO events (floor_id,type,project,data,created_at) VALUES (?, 'feed', ?, ?, ?)", f.id, project, JSON.stringify({ agent, name, text, ts: at }), at);
}
/** A job of `titles` steps on the floor, its card made the way the engine makes it, then aged. */
function job(t, f, plan, steps, { project = '', ageH = 0, doneAgeH = null } = {}) {
  const now = Date.now(); const ids = [];
  for (const [title, status] of steps) {
    ids.push(Number(run(t.db, "INSERT INTO tasks (floor_id,title,plan,project,status,lane,created_at,updated_at) VALUES (?,?,?,?,?,'website',?,?)", f.id, title, plan, project, status, now, now).lastInsertRowid));
    t.app.engine.emitTask(ids.at(-1));
  }
  const card = get(t.db, 'SELECT * FROM job_cards WHERE floor_id=? ORDER BY id DESC LIMIT 1', f.id);
  if (ageH) run(t.db, 'UPDATE job_cards SET updated_at=?, done_at=CASE WHEN done_at IS NULL THEN NULL ELSE ? END WHERE id=?', now - ageH * HOUR, now - (doneAgeH ?? ageH) * HOUR, card.id);
  // Its tasks age with it: since job 32 "last job finished" reads finished tasks too.
  if (ageH) for (const id of ids) run(t.db, 'UPDATE tasks SET updated_at=? WHERE id=?', now - (doneAgeH ?? ageH) * HOUR, id);
  return { card: get(t.db, 'SELECT * FROM job_cards WHERE id=?', card.id), ids };
}
const strip = async (t) => (await new Client(t).get('/api/building/now')).data;

describe('the live case: TheTireRx and its five pings', () => {
  test('five identical "picked the next job to work on" lines, 14 to 24 hours old, make no line: the strip is quiet and says when the last job really finished', async () => {
    const t = await boot();
    try {
      const c = await claim(t, 'TheTireRx'); const f = floorOf(t, c);
      run(t.db, "UPDATE agents SET name='Tess' WHERE floor_id=? AND role='manager'", f.id);
      // The last real job finished 30 hours ago; since then work mode has only pinged.
      job(t, f, 'Fix the booking form', [['Fix the booking form', 'done']], { ageH: 30 });
      const finished = get(t.db, 'SELECT done_at FROM job_cards WHERE floor_id=?', f.id).done_at;
      for (const h of [14, 16.5, 19, 21.5, 24]) feedAt(t, f, { text: 'picked the next job to work on', at: Date.now() - h * HOUR });
      const d = await strip(t);
      assert.deepEqual(d.items, []);
      assert.equal(d.lastFinished, finished, 'the real "last job finished" time, not a ping\'s');
      // The page writes the quiet line from it.
      const src = readFileSync(new URL('../public/js/lobby-ui.js', import.meta.url), 'utf8');
      assert.ok(src.includes("`Quiet right now. Last job finished ${timeAgo(d.lastFinished)}.`"));
      assert.ok(src.includes("api('/building/now')"));
    } finally { await t.close(); }
  });
  test('the same pings an hour old still make no line: a ping is never work, however new', async () => {
    const t = await boot();
    try {
      const c = await claim(t, 'TheTireRx'); const f = floorOf(t, c);
      for (let i = 0; i < 5; i++) feedAt(t, f, { text: 'picked the next job to work on', at: Date.now() - (60 - i) * 60e3 });
      feedAt(t, f, { text: 'looked over the day\'s work', at: Date.now() - 30 * 60e3 });
      feedAt(t, f, { name: 'Office', agent: null, text: 'Floor paused. Out of hours.', at: Date.now() - 20 * 60e3 });
      const d = await strip(t);
      assert.deepEqual(d.items, []);
      assert.equal(d.lastFinished, null, 'nothing has ever finished here');
    } finally { await t.close(); }
  });
});

describe('lines from job cards', () => {
  test('one line per job, newest first, and a job that moves on changes its own line rather than adding one', async () => {
    const t = await boot();
    try {
      const c = await claim(t, 'Card Works'); const f = floorOf(t, c);
      const a = job(t, f, 'Menu page', [['Write the menu', 'done'], ['Lay out the page', 'doing'], ['Check it on a phone', 'todo']], { ageH: 2 });
      const b = job(t, f, 'Booking form', [['Build the form', 'doing']]);
      let d = await strip(t);
      assert.deepEqual(d.items.map((i) => i.id), [`job:${b.card.id}`, `job:${a.card.id}`]);
      assert.match(d.items[1].text, /^Step 2 of 3: /);
      assert.ok(d.items.every((i) => i.kind === 'job' && i.floor.slug === c.slug));
      // The menu job moves on: the same line, new words, now the newest.
      run(t.db, "UPDATE tasks SET status='done' WHERE id=?", a.ids[1]); run(t.db, "UPDATE tasks SET status='doing' WHERE id=?", a.ids[2]);
      t.app.engine.emitTask(a.ids[1]); t.app.engine.emitTask(a.ids[2]);
      d = await strip(t);
      assert.equal(d.items.length, 2);
      assert.equal(d.items[0].id, `job:${a.card.id}`);
      assert.match(d.items[0].text, /^Step 3 of 3: /);
    } finally { await t.close(); }
  });
  test('five lines at most, and a job last touched more than a day ago does not count', async () => {
    const t = await boot();
    try {
      const c = await claim(t, 'Busy Co'); const f = floorOf(t, c);
      const old = job(t, f, 'Old job', [['Something from yesterday', 'doing']], { ageH: 25 });
      for (let i = 0; i < 7; i++) job(t, f, `Job ${i}`, [[`Task ${i}`, 'doing']], { ageH: 7 - i });
      const d = await strip(t);
      assert.equal(d.items.length, 5);
      assert.ok(!d.items.some((i) => i.id === `job:${old.card.id}`));
      const ts = d.items.map((i) => i.ts);
      assert.deepEqual(ts, [...ts].sort((x, y) => y - x), 'newest first');
    } finally { await t.close(); }
  });
  test('private work, a private floor and the demo floors stay out', async () => {
    const t = await boot({ fillerCompanies: true, fillerTickMs: 1e6, towerFloors: 30 });
    try {
      const c = await claim(t, 'Quiet Co'); const f = floorOf(t, c);
      run(t.db, "INSERT INTO projects (floor_id,slug,title,kind,private,created_at) VALUES (?,'secret','Secret plan','site',1,?)", f.id, Date.now());
      job(t, f, 'Secret plan', [['Build the secret plan', 'doing']], { project: 'secret' });
      const shown = job(t, f, 'Public page', [['Build the public page', 'doing']]);
      const demo = get(t.db, 'SELECT * FROM floors WHERE filler=1 LIMIT 1');
      job(t, demo, 'Demo job', [['Pretend work', 'doing']]);
      const d = await strip(t);
      assert.deepEqual(d.items.map((i) => i.id), [`job:${shown.card.id}`]);
      assert.doesNotMatch(JSON.stringify(d), /secret/i);
      run(t.db, 'UPDATE floors SET default_private=1 WHERE id=?', f.id);
      assert.deepEqual((await strip(t)).items, []);
    } finally { await t.close(); }
  });
});

describe('old feed lines, launches and repeats', () => {
  test('a floor with no job cards falls back to its feed, real work only, and the same line shows once', async () => {
    const t = await boot();
    try {
      const c = await claim(t, 'Feed Co'); const f = floorOf(t, c);
      const at = Date.now();
      feedAt(t, f, { name: 'Mina', agent: 2, text: 'started "the price list"', at: at - 50 * 60e3 });
      feedAt(t, f, { name: 'Mina', agent: 2, text: 'started "the price list"', at: at - 40 * 60e3 });
      feedAt(t, f, { text: 'picked the next job to work on', at: at - 30 * 60e3 });
      feedAt(t, f, { name: 'Arlo', agent: 3, text: 'finished "the logo"', at: at - 20 * 60e3 });
      feedAt(t, f, { name: 'Arlo', agent: 3, text: 'hit a provider hiccup, retrying (1/3)', at: at - 10 * 60e3 });
      feedAt(t, f, { name: 'Bea', agent: 4, text: 'finished "the old flyer"', at: at - 30 * HOUR });
      const d = await strip(t);
      assert.deepEqual(d.items.map((i) => i.text), ['Arlo finished "the logo"', 'Mina started "the price list"']);
      assert.ok(d.items.every((i) => i.kind === 'feed'));
    } finally { await t.close(); }
  });
  test('a launch is a line of its own, beside the job that made it', async () => {
    const t = await boot();
    try {
      const c = await claim(t, 'Launch Co'); const f = floorOf(t, c);
      job(t, f, 'Site', [['Build the site', 'done']], { project: 'site' });
      run(t.db, "INSERT INTO projects (floor_id,slug,title,kind,private,published_at,created_at) VALUES (?,'site','The Site','site',0,?,?)", f.id, Date.now(), Date.now());
      t.app.engine.emit(f.id, 'project', { slug: 'site' }, { project: 'site' });
      const d = await strip(t);
      assert.deepEqual(d.items.map((i) => i.kind).sort(), ['job', 'published']);
      const launch = d.items.find((i) => i.kind === 'published');
      assert.equal(launch.text, 'launched "The Site"'); assert.ok(launch.url);
    } finally { await t.close(); }
  });
  test('what counts as real work', () => {
    for (const s of ['started "x"', 'finished "x"', 'could not finish "x"', 'published soup-site (4 files)', 'gave Mina a task: "x"', 'approved "x"', 'sent "x" back to Mina with notes', 'changed the brief for "x"', 'drafted the legal pages for x', 'Bought soup.com.']) assert.ok(isRealWork(s), s);
    for (const s of ['picked the next job to work on', 'looked over the day\'s work', 'is planning the next batch', 'Nothing new this round: what is left is waiting on someone else.', 'heard back from buddehbot', 'hit a provider hiccup, retrying (1/3)', 'Floor paused. Out of hours.', 'The staff have stopped for today. Back tomorrow.', 'Mina joined as Designer', 'asked the boss a question', '']) assert.ok(!isRealWork(s), s);
  });
});

describe('Now on the status card', () => {
  test('an open job nobody has touched for a day is not happening now; a fresh one is', async () => {
    const t = await boot();
    try {
      const c = await claim(t, 'Stale Co'); const f = floorOf(t, c);
      const stale = job(t, f, 'Stale job', [['Something left open', 'doing']], { ageH: 26 });
      let v = await floorState(new Client(t), c.slug);
      assert.equal(v.status.now, null);
      assert.equal((await floorState(c)).status.now, null, 'nor for the boss');
      run(t.db, 'UPDATE job_cards SET updated_at=? WHERE id=?', Date.now() - HOUR, stale.card.id);
      v = await floorState(new Client(t), c.slug);
      assert.match(v.status.now.line, /^Step 1 of 1: /);
      // The page's own live copy of the cards follows the same day.
      const src = readFileSync(new URL('../public/js/status-card.js', import.meta.url), 'utf8');
      assert.match(src, /OPEN\.has\(c\.state\) && \(c\.updatedAt \|\| 0\) >= Date\.now\(\) - NOW_HORIZON_MS/);
    } finally { await t.close(); }
  });
});
