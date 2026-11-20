// Round 2, r2-j66 (docs/redesign/OFFICE-ANSWERS-2.md, Q12 a; section 6: "The Monday page builds from real records and shows a quiet-week line when
// nothing shipped"). Built Mondays 08:10 New York for the week just ended; launches, changes shipped with before and after screenshots, visits;
// 12 weeks kept; no model. Fake clock, fake records.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boot, claim, Client } from './helpers.js';
import { get, run } from '../server/db.js';
import { quietLine, KEEP_WEEKS } from '../server/thisweek.js';

const DAY = 86400000;
// Monday 23 November 2026 08:09 / 08:10 New York (EST). The week just ended: 16 to 22 November.
const MON_0809 = Date.UTC(2026, 10, 23, 13, 9), MON_0810 = Date.UTC(2026, 10, 23, 13, 10), IN_WEEK = Date.UTC(2026, 10, 18, 17, 0);
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7), Buffer.from([0xff, 0xd9])]);

test('a week with a launch and a change: built at 08:10 Monday from the records, with before and after screenshots and the visits', async () => {
  let clock = MON_0809;
  const t = await boot({ fillerCompanies: true, fillerTickMs: 1e6 }, { now: () => clock });
  try {
    t.app.engine.runManager = async () => {};
    const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', (await claim(t, 'TheTireRx')).slug);
    const demo = get(t.db, 'SELECT * FROM floors WHERE filler=1 LIMIT 1');
    run(t.db, "INSERT INTO projects (floor_id,slug,title,kind,private,published_at,created_at) VALUES (?,'finder','Tire finder','site',0,?,1)", f.id, IN_WEEK);
    run(t.db, "INSERT INTO projects (floor_id,slug,title,kind,private,published_at,created_at) VALUES (?,'secret','Secret','site',1,?,1)", f.id, IN_WEEK);
    run(t.db, "INSERT INTO projects (floor_id,slug,title,kind,private,published_at,created_at) VALUES (?,'fake','Fake','site',0,?,1)", demo.id, IN_WEEK);
    const card = Number(run(t.db, "INSERT INTO job_cards (floor_id,key,project,title,state,created_at,updated_at,done_at) VALUES (?,'k','finder','Bigger search box','done',?,?,?)", f.id, IN_WEEK, IN_WEEK + DAY, IN_WEEK + DAY).lastInsertRowid);
    for (const [i, step] of ['a', 'b', 'c'].entries()) run(t.db, 'INSERT INTO job_shots (floor_id,card_id,step,project,image,bytes,created_at,taken_at) VALUES (?,?,?,?,?,300,?,?)', f.id, card, step, 'finder', jpeg(), 1, IN_WEEK + i);
    run(t.db, "INSERT INTO app_visits (floor_id,project,day,path,views,uniques) VALUES (?,'finder',?,'/',300,241)", f.id, dayOf(IN_WEEK));
    run(t.db, "INSERT INTO app_visits (floor_id,project,day,path,views,uniques) VALUES (?,'secret',?,'/',300,999)", f.id, dayOf(IN_WEEK));
    const w = t.app.engine.r2b.thisweek;
    assert.equal(w.tick(), null, 'not before 08:10');
    clock = MON_0810;
    assert.equal(w.tick(), '2026-11-16');
    assert.equal(w.tick(), null, 'built once');
    const d = (await new Client(t).get('/api/building/thisweek')).data;
    assert.equal(d.week, '2026-11-16');
    assert.deepEqual(d.page.launches.map((l) => l.title), ['Tire finder']);
    assert.equal(d.page.changes.length, 1);
    assert.match(d.page.changes[0].before, /jobshot\/1$/); assert.match(d.page.changes[0].after, /jobshot\/3$/);
    assert.equal(d.page.visits, 241);
    assert.equal(d.page.quiet, false);
    assert.equal(d.page.line, '1 launch, 1 change shipped, 241 real visits.');
    assert.doesNotMatch(JSON.stringify(d), /Secret|Fake|999|\$/);
  } finally { await t.close(); }
});

test('a quiet week says so; 12 weeks are kept; the page is a deep link of its own', async () => {
  let clock = MON_0809;  // (the server also looks once when it starts: the records go in first)
  const t = await boot({}, { now: () => clock });
  try {
    const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', (await claim(t, 'Old Work')).slug);
    run(t.db, "INSERT INTO projects (floor_id,slug,title,kind,private,published_at,created_at) VALUES (?,'old','Old','site',0,?,1)", f.id, IN_WEEK - 60 * DAY);
    for (const [i, n] of [[1, 1200], [3, 1041]]) run(t.db, "INSERT INTO app_visits (floor_id,project,day,path,views,uniques) VALUES (?,'old',?,'/',?,?)", f.id, dayOf(IN_WEEK + (i - 2) * DAY), n, n);
    clock = MON_0810; t.app.engine.r2b.thisweek.tick();
    const d = (await new Client(t).get('/api/building/thisweek')).data;
    assert.equal(d.page.quiet, true);
    assert.equal(d.page.line, 'Quiet week. Nothing shipped. 2,241 visits to things made earlier.');
    assert.equal(quietLine(2241), d.page.line);
    for (let k = 1; k <= 14; k++) { clock = MON_0810 + k * 7 * DAY; t.app.engine.r2b.thisweek.tick(); }
    const all = (await new Client(t).get('/api/building/thisweek')).data.weeks;
    assert.equal(all.length, KEEP_WEEKS); assert.equal(KEEP_WEEKS, 12);
    const old = (await new Client(t).get(`/api/building/thisweek?week=${all.at(-1)}`)).data;
    assert.equal(old.week, all.at(-1));
    const page = await new Client(t).raw('GET', '/thisweek');
    assert.equal(page.status, 200);
    assert.equal((await new Client(t).raw('GET', '/mailroom')).status, 200);
  } finally { await t.close(); }
});

test('the page and the home link; no model anywhere in it', () => {
  const ui = readFileSync(new URL('../public/js/thisweek-ui.js', import.meta.url), 'utf8');
  assert.match(ui, /api\(`\/building\/thisweek/);
  assert.match(readFileSync(new URL('../public/js/lobby-ui.js', import.meta.url), 'utf8'), /'data-this-week': ''/);
  assert.doesNotMatch(readFileSync(new URL('../server/thisweek.js', import.meta.url), 'utf8'), /callLLM/);
});
