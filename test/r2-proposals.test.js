// Round 2, r2-j64 (docs/redesign/OFFICE-ANSWERS-2.md, Q10 c; section 6: "Each active floor gets one Monday proposal with a number and a Yes / No
// tap"). Mondays 08:30 New York; one change, one reason, the number; Yes / No; dropped after 7 days; floors with round 1's plan off, demo floors
// and paused floors skipped; one short call per floor per week. Fake clock, mock model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boot, claim, Client } from './helpers.js';
import { get, run, all } from '../server/db.js';
import { DROP_MS } from '../server/proposals.js';
import { setFloorPlans } from '../server/weekplan.js';

const MON_0829 = Date.UTC(2026, 10, 23, 13, 29), MON_0830 = Date.UTC(2026, 10, 23, 13, 30), DAY = 86400000;
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

test('each active floor gets one Monday proposal with a change, a reason and the number; skipped floors get none; one call each', async () => {
  let clock = MON_0829;
  const t = await boot({ fillerCompanies: true, fillerTickMs: 1e6 }, { now: () => clock });
  try {
    t.app.engine.runManager = async () => {};
    const a = await claim(t, 'TheTireRx'), b = await claim(t, 'Second Co'), off = await claim(t, 'Upkeep Only'), paused = await claim(t, 'Paused Co');
    const fa = get(t.db, 'SELECT * FROM floors WHERE slug=?', a.slug);
    run(t.db, "INSERT INTO projects (floor_id,slug,title,kind,private,published_at,created_at) VALUES (?,'finder','Tire finder','site',0,1,1)", fa.id);
    run(t.db, "INSERT INTO app_visits (floor_id,project,day,path,views,uniques) VALUES (?,'finder',?,'/',700,649)", fa.id, dayOf(MON_0830 - DAY));
    run(t.db, "INSERT INTO app_visits (floor_id,project,day,path,views,uniques) VALUES (?,'finder',?,'/',600,580)", fa.id, dayOf(MON_0830 - 9 * DAY));
    const fo = get(t.db, 'SELECT id FROM floors WHERE slug=?', off.slug);
    setFloorPlans(t.db, fo.id, false);  // admin.mjs plan --floor N off
    run(t.db, 'UPDATE floors SET paused=1 WHERE slug=?', paused.slug);
    const p = t.app.engine.r2b.proposals;
    assert.deepEqual(await p.tick(), [], 'not before 08:30');
    clock = MON_0830; const made = await p.tick(); await p.tick();
    clock = MON_0830 + 3600e3; await p.tick();
    const rows = all(t.db, "SELECT p.*, f.slug FROM floor_proposals p JOIN floors f ON f.id=p.floor_id WHERE p.status='open'");
    assert.deepEqual(rows.map((r) => r.slug).sort(), [a.slug, b.slug].sort(), 'plan-off, paused and demo floors skipped');
    assert.equal(made.length, 2, 'one proposal each, and so one call each');
    const ra = rows.find((r) => r.slug === a.slug);
    assert.ok(ra.change && ra.reason);
    assert.equal(ra.number, 'Tire finder: 649 real visits in the last 7 days (580 the week before).');
    assert.equal(rows.find((r) => r.slug === b.slug).number, 'Nothing launched yet: 0 real visits.');
    // The boss sees it on the status card, with its id for Yes / No; a visitor never does.
    const boss = (await a.get(`/api/floors/${a.slug}`)).data;
    assert.equal(boss.status.proposal.number, ra.number);
    assert.equal((await new Client(t).get(`/api/floors/${a.slug}`)).data.status.proposal, undefined);
    // Yes: one job for the team, once. Another floor's boss can't answer it.
    assert.equal((await b.post(`/api/floors/${a.slug}/proposal/${ra.id}`, { answer: 'yes' })).status, 403);
    const yes = await a.post(`/api/floors/${a.slug}/proposal/${ra.id}`, { answer: 'yes' });
    assert.equal(yes.status, 200);
    assert.ok(get(t.db, 'SELECT 1 x FROM tasks WHERE id=? AND floor_id=? AND title=?', yes.data.taskId, fa.id, ra.change));
    assert.equal((await a.post(`/api/floors/${a.slug}/proposal/${ra.id}`, { answer: 'no' })).status, 404, 'answered once');
    // No reply in 7 days drops the other.
    clock = MON_0830 + DROP_MS + 1; await p.tick();
    assert.equal(get(t.db, 'SELECT status FROM floor_proposals WHERE floor_id=(SELECT id FROM floors WHERE slug=?)', b.slug).status, 'dropped');
  } finally { await t.close(); }
});
test('the status card shows the change, the reason, the number and Yes / No, to the boss only', () => {
  const s = readFileSync(new URL('../public/js/status-card.js', import.meta.url), 'utf8');
  assert.match(s, /page\.owner && st\.proposal \? proposalBox\(page, st\.proposal\) : null/);
  for (const w of ["'Yes'", "'No'", "'Why: '", "'The number: '"]) assert.ok(s.includes(w), w);
});
