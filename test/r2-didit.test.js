// Round 2, r2-j65 (docs/redesign/OFFICE-ANSWERS-2.md, Q24 idea 2; section 6: "Seven days after a change ships, a before-and-after line appears on
// the timeline"). Each shipped change records its target number; 7 days later code compares and puts one line on the job's timeline card. Code
// only. Fake clock, fake records.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boot, claim, Client } from './helpers.js';
import { get, run } from '../server/db.js';

const DAY = 86400000, SHIP = Date.UTC(2026, 10, 10, 17, 0);
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

test('a change that ships records its number; 7 days later its card says "visits 649 to 702", once; private work never gets a line', async () => {
  let clock = SHIP + 3600e3;
  const t = await boot({}, { now: () => clock });
  try {
    t.app.engine.runManager = async () => {};
    const c = await claim(t, 'TheTireRx'); const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
    run(t.db, "INSERT INTO projects (floor_id,slug,title,kind,private,published_at,created_at) VALUES (?,'site','Site','site',0,1,1)", f.id);
    run(t.db, "INSERT INTO projects (floor_id,slug,title,kind,private,published_at,created_at) VALUES (?,'secret','S','site',1,1,1)", f.id);
    const v = (p, ms, n) => run(t.db, "INSERT INTO app_visits (floor_id,project,day,path,views,uniques) VALUES (?,?,?,'/',?,?)", f.id, p, dayOf(ms), n, n);
    v('site', SHIP - 3 * DAY, 400); v('site', SHIP - 1 * DAY, 249); v('site', SHIP - 10 * DAY, 999);  // 649 in the 7 days before
    const card = Number(run(t.db, "INSERT INTO job_cards (floor_id,key,project,title,state,created_at,updated_at,done_at) VALUES (?,'k1','site','New gallery page','done',?,?,?)", f.id, SHIP - DAY, SHIP, SHIP).lastInsertRowid);
    const hidden = Number(run(t.db, "INSERT INTO job_cards (floor_id,key,project,title,state,created_at,updated_at,done_at) VALUES (?,'k2','secret','Secret thing','done',?,?,?)", f.id, SHIP - DAY, SHIP, SHIP).lastInsertRowid);
    const d = t.app.engine.r2b.didit;
    assert.deepEqual(d.tick(), { recorded: 1, posted: [] });
    assert.equal(get(t.db, 'SELECT before_n FROM change_checks WHERE card_id=?', card).before_n, 649);
    v('site', SHIP + 2 * DAY, 500); v('site', SHIP + 6 * DAY, 202); v('site', SHIP + 9 * DAY, 777);  // 702 in the 7 days after
    clock = SHIP + 6 * DAY; assert.deepEqual(d.tick().posted, [], 'not before 7 days');
    clock = SHIP + 7 * DAY + 60000;
    assert.deepEqual(d.tick().posted, [{ card, line: 'New gallery page: visits 649 to 702' }]);
    assert.deepEqual(d.tick().posted, [], 'once');
    const jobs = (await new Client(t).get(`/api/floors/${c.slug}`)).data.jobs;
    assert.equal(jobs.find((j) => j.id === card).didItWork, 'New gallery page: visits 649 to 702');
    assert.ok(!jobs.some((j) => j.id === hidden && j.didItWork));
    assert.equal(get(t.db, 'SELECT COUNT(*) n FROM change_checks WHERE card_id=?', hidden).n, 0);
  } finally { await t.close(); }
});
test('the timeline card shows the line; no model is called for it', () => {
  assert.match(readFileSync(new URL('../public/js/timeline-ui.js', import.meta.url), 'utf8'), /card\.didItWork \? h\('p\.tl-didit', \{ 'data-didit': '' \}, card\.didItWork\) : null/);
  assert.doesNotMatch(readFileSync(new URL('../server/didit.js', import.meta.url), 'utf8'), /callLLM|engine\.llm/);
});
