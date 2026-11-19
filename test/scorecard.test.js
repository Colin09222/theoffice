// The idea scorecard (server/scorecard.js; docs/redesign/ROUND1-REST.md, job 25). Every new Business idea card carries four scores, 0 to 3, filled in by
// the Researcher in the propose_ideas call it already makes. Below 8 of 12, or with nobody clear who pays, the boss sees a plain warning and can still
// pick the idea. The scores are the boss's only, and what the Researcher reads names no dollar figure.
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, claim, Client, floorState, until } from './helpers.js';
import { get, all } from '../server/db.js';
import { checkIdeas } from '../server/business.js';
import { readScores, warningFor, scoreView, SCORES_SCHEMA, SCORES_BRIEF, BAR } from '../server/scorecard.js';
import { toolDefs, toolsForRole } from '../server/tools.js';

const open = [];
after(async () => { for (const t of open) await t.close(); });
const card = (scores) => ({ name: 'Doorstep Dog Groom', who_pays: 'Busy dog owners', problem: 'Salons are booked up for weeks', what_you_sell: 'Home grooming visits', why_now: 'More people work from home',
  evidence: [{ url: 'https://example.com/a', title: 'A', shows: 'Owners wait weeks' }, { url: 'https://example.org/b', title: 'B', shows: 'People want visits at home' }], ...(scores ? { scores } : {}) });
const input = (ideas) => ({ ideas, markets_checked: ['Pets'], compared: [{ idea: 'A', verdict: 'Kept' }, { idea: 'B', verdict: 'Dropped' }] });
const S = (w, d, b, r) => ({ who_pays: w, days_to_first_dollar: d, cost_to_build: b, cost_to_run: r });

describe('the idea scorecard', () => {
  test('four scores, 0 to 3; the bar is 8 of 12 with Who pays above 0; the warning is plain', () => {
    assert.deepEqual(readScores(S(3, 2, 1, 0)), { whoPays: 3, daysToFirstDollar: 2, costToBuild: 1, costToRun: 0 });
    for (const bad of [null, {}, S(4, 1, 1, 1), S(-1, 1, 1, 1), S(1.5, 1, 1, 1), { who_pays: 1, days_to_first_dollar: 1, cost_to_build: 1 }]) assert.equal(readScores(bad), null, JSON.stringify(bad));
    assert.equal(BAR, 8);
    assert.equal(warningFor(readScores(S(2, 2, 2, 2))), '', '8 of 12 is at the bar');
    assert.equal(warningFor(readScores(S(0, 2, 2, 2))), 'This idea scores 6 of 12: nobody clear pays for it yet.', 'the spec\'s own example');
    assert.equal(warningFor(readScores(S(0, 3, 3, 3))), 'This idea scores 9 of 12: nobody clear pays for it yet.', 'nobody pays is below the bar whatever the total');
    assert.equal(warningFor(readScores(S(2, 0, 2, 3))), 'This idea scores 7 of 12: the first dollar is a long way off.');
    const v = scoreView(readScores(S(1, 2, 2, 2)));
    assert.equal(v.total, 7); assert.equal(v.below, true);
    assert.deepEqual(v.rows.map((r) => r.label), ['Who pays', 'Days to first dollar', 'Cost to build', 'Cost to run per week']);
    assert.equal(v.rows.find((r) => r.key === 'costToBuild').legend, '3 = under $3, 2 = $3 to $10, 1 = $10 to $30, 0 = over $30');
  });

  test('a card without its four scores is sent back to the Researcher; with them it keeps them; IDEA_SCORECARD off asks for none', () => {
    const unseen = () => new Set();
    const missing = checkIdeas(input([card(), card(S(3, 3, 3, 3))]), { unseen, scored: true });
    assert.equal(missing.ok, false); assert.match(missing.problems.join(), /idea 1: give its four scores/);
    const ok = checkIdeas(input([card(S(3, 3, 3, 2)), card(S(0, 2, 2, 2))]), { unseen, scored: true });
    assert.equal(ok.ok, true, ok.problems.join('; '));
    assert.deepEqual(ok.ideas[1].scores, { whoPays: 0, daysToFirstDollar: 2, costToBuild: 2, costToRun: 2 });
    assert.equal(checkIdeas(input([card(), card()]), { unseen }).ok, true, 'unscored, as before');
  });

  test('what the Researcher reads names no dollar figure; the scores are required in the tool', () => {
    for (const text of [JSON.stringify(SCORES_SCHEMA), SCORES_BRIEF, JSON.stringify(toolDefs(toolsForRole('researcher'), {}, 'researcher'))]) assert.doesNotMatch(text, /\$\s?\d|\bcents?\b|budget/i);
    const def = toolDefs(['propose_ideas'], {}, 'researcher').find((d) => (d.function?.name || d.name) === 'propose_ideas');
    assert.doesNotMatch(JSON.stringify(def), /\$\s?\d|\bcents?\b|budget/i);
    const items = (def.function?.parameters || def.parameters || def.input_schema).properties.ideas.items;
    assert.ok(items.required.includes('scores')); assert.deepEqual(items.properties.scores.required, ['who_pays', 'days_to_first_dollar', 'cost_to_build', 'cost_to_run']);
  });

  test('every new idea card shows its four scores to the boss; one under 8 shows the warning and can still be picked; a visitor sees no score', async () => {
    const t = await boot({ mediaMock: true, searchMock: true, businessTickMs: 40, modesTickMs: 60000 }); open.push(t);
    const c = await claim(t);
    const calls = [];
    const chat = t.app.engine.llm.chat.bind(t.app.engine.llm);
    t.app.engine.llm.chat = (a) => { calls.push(a); return chat(a); };
    assert.equal((await c.post(`/api/floors/${c.slug}/business/start`, {})).status, 200);
    const b = await until(async () => { const x = (await floorState(c)).business; return x?.phase === 'pick' ? x : null; }, { what: 'idea cards', timeout: 30000 });
    assert.equal(b.ideas.length, 3);
    for (const i of b.ideas) {
      assert.equal(i.score.rows.length, 4, i.name);
      assert.ok(i.score.rows.every((r) => Number.isInteger(r.value) && r.value >= 0 && r.value <= 3));
    }
    const low = b.ideas.find((i) => i.score.below);
    assert.equal(low.name, 'Night Desk Notes');
    assert.equal(low.score.warning, 'This idea scores 6 of 12: nobody clear pays for it yet.');
    assert.ok(b.ideas.filter((i) => !i.score.below).every((i) => i.score.warning === ''));
    // The scores came in the Researcher's own propose_ideas call: no call of any other kind was made for them.
    assert.deepEqual([...new Set(calls.map((x) => x.meta?.kind))].filter((k) => /score/i.test(k || '')), []);
    const researcher = calls.filter((x) => x.meta?.kind === 'staff' && JSON.stringify(x.messages).includes('Find business ideas'));
    assert.ok(researcher.length >= 1);
    for (const x of researcher) assert.doesNotMatch(JSON.stringify(x.messages), /\$\s?\d/, 'no dollar figure in what the Researcher reads');
    const visitor = (await floorState(new Client(t), c.slug)).business;
    assert.doesNotMatch(JSON.stringify(visitor), /"score"|scores|of 12/);
    // A warning, not a block: the boss picks the low one and the build starts.
    const p = await c.post(`/api/floors/${c.slug}/business/pick`, { idea: low.id });
    assert.equal(p.status, 200, JSON.stringify(p.data));
    const f = get(t.db, 'SELECT id FROM floors WHERE slug=?', c.slug);
    assert.ok(all(t.db, "SELECT id FROM tasks WHERE floor_id=? AND plan LIKE 'Business mode: build%'", f.id).length > 0, 'the build started');
  });
});
