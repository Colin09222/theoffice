// Round 2, r2-j68 (docs/redesign/OFFICE-ANSWERS-2.md, Q16; section 6: "On a Friday with a shipped change the top floor gets the lit crown; with none,
// nothing changes"). Fridays 16:00 to 23:00 New York, only if something shipped that week; praise only, one floor, no ranked list. Fake clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boot, claim, Client } from './helpers.js';
import { get, run } from '../server/db.js';

const DAY = 86400000;
// Friday 20 November 2026, 15:59 / 16:00 / 22:59 / 23:00 New York (EST). The week began Monday 16 November.
const FRI = (h, m) => Date.UTC(2026, 10, 20, h + 5, m);
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const src = (p) => readFileSync(new URL(`../public/js/${p}`, import.meta.url), 'utf8');

async function building(shipThisWeek) {
  let clock = FRI(16, 0);
  const t = await boot({}, { now: () => clock });
  const a = get(t.db, 'SELECT * FROM floors WHERE slug=?', (await claim(t, 'Small Visits')).slug);
  const b = get(t.db, 'SELECT * FROM floors WHERE slug=?', (await claim(t, 'TheTireRx')).slug);
  const pub = shipThisWeek ? FRI(10, 0) : FRI(10, 0) - 10 * DAY;
  run(t.db, "INSERT INTO projects (floor_id,slug,title,kind,private,published_at,created_at) VALUES (?,'a','A','site',0,?,1)", a.id, FRI(10, 0) - 30 * DAY);
  run(t.db, "INSERT INTO projects (floor_id,slug,title,kind,private,published_at,created_at) VALUES (?,'finder','Tire finder','site',0,?,1)", b.id, pub);
  run(t.db, "INSERT INTO launch_shots (floor_id,project,image,type,bytes,url,taken_at) VALUES (?,'finder',?,'image/jpeg',300,'x',5)", b.id, Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(300), Buffer.from([0xff, 0xd9])]));
  run(t.db, "INSERT INTO app_visits (floor_id,project,day,path,views,uniques) VALUES (?,'a',?,'/',30,30)", a.id, dayOf(FRI(9, 0)));
  run(t.db, "INSERT INTO app_visits (floor_id,project,day,path,views,uniques) VALUES (?,'finder',?,'/',700,649)", b.id, dayOf(FRI(9, 0) - DAY));
  return { t, a, b, set: (ms) => { clock = ms; }, friday: async () => (await new Client(t).get('/api/building/friday')).data };
}

test('a Friday evening with something shipped: the floor with the most real visits this week is featured; praise only, no list', async () => {
  const s = await building(true);
  try {
    const d = await s.friday();
    assert.equal(d.on, true);
    assert.deepEqual(d.floor, { number: s.b.number, slug: s.b.slug, name: 'TheTireRx' });
    assert.equal(d.launches.length, 1);
    assert.match(d.line, /busiest floor: TheTireRx\. Well done\./);
    assert.doesNotMatch(JSON.stringify(d), /649|30\b|Small Visits|rank/i, 'no numbers, no other floor, no list');
    s.set(FRI(15, 59)); assert.equal((await s.friday()).on, false, 'not before 16:00');
    s.set(FRI(22, 59)); assert.equal((await s.friday()).on, true);
    s.set(FRI(23, 0)); assert.equal((await s.friday()).on, false, 'over at 23:00');
    s.set(FRI(16, 0) - DAY); assert.equal((await s.friday()).on, false, 'Thursday: nothing');
  } finally { await s.t.close(); }
});
test('a Friday where nothing shipped: no party, and the billboard runs as normal', async () => {
  const s = await building(false);
  try { assert.deepEqual(Object.keys(await s.friday()).sort(), ['on', 'ts']); assert.equal((await s.friday()).on, false); } finally { await s.t.close(); }
});
test('the page: the lit crown and the featured floor\'s launches on the billboard only when on; one cheer when its room opens', () => {
  const ui = src('lobby-ui.js'), scene = src('lobby-scene.js'), floor = src('mailroom-floor.js');
  assert.match(ui, /const boardImages = \(\) => billboardImages\(friday\?\.on && friday\.launches\?\.length \? friday\.launches : heroList\);/);
  assert.match(ui, /tower\?\.setFriday\?\.\(friday\?\.on \? friday\.floor : null\)/);
  assert.match(scene, /setFriday\(f\) \{ this\.friday = f \|\| null; if \(this\.tower\.crownGlow\) this\.tower\.crownGlow\.visible = !!f; \}/);
  assert.match(scene, /const crownGlow = new THREE\.Group\(\); crownGlow\.visible = false;/);
  assert.match(floor, /if \(d\?\.on && d\.floor\?\.number === number && !view\.disposed\) \{ view\.cheer\?\.\(\);/);
});
