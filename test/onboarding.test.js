// Onboarding (server/onboarding.js, public/js/onboard-ui.js; docs/redesign/ROUND1-REST.md, job 23). A new code holder sees "This is your floor", three
// lane cards, a template with its price as information, three questions, and the manager's plan (goal, up to 5 jobs, done-means lines, "This will cost
// about $X") with one Start. Start starts: the status card reads "Step 1 of N" and the first timeline card appears. A bad code gets
// "That code didn't work. Check with Colon." The last test drives the real page in Chrome at desktop and phone widths, against the clock.
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { boot, Client, until, floorState, sse, sleep } from './helpers.js';
import { get, all, run } from '../server/db.js';
import { LANES, templatePlan } from '../server/onboarding.js';

const open = [];
after(async () => { for (const t of open) await t.close(); });
async function newFloor(overrides = {}, deps = {}) {
  const t = await boot({ peopleTalk: false, staffSelfCheck: false, ...overrides }, deps);
  open.push(t);
  const c = new Client(t);
  const r = await c.post('/api/claim', { code: t.code() });
  assert.equal(r.status, 201);
  c.csrf = r.data.csrf; c.slug = r.data.slug;
  const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', c.slug);
  return { t, c, f, db: t.db };
}
const ANSWERS = ['Dog owners on our street', 'Book a walk', 'Sunny Paws, yellow'];

describe('onboarding', () => {
  test('a bad code, unknown or used, gets "That code didn\'t work. Check with Colon."', async () => {
    const t = await boot({ peopleTalk: false }); open.push(t);
    const c = new Client(t);
    for (const path of ['/api/claim/check', '/api/claim']) {
      const r = await c.post(path, { code: 'OFFICE-NOPE-NOPE-NOPE-NOPE' });
      assert.equal(r.status, 404);
      assert.match(JSON.stringify(r.data), /That code didn't work\. Check with Colon\./);
    }
    const code = t.code();
    assert.equal((await c.post('/api/claim', { code })).status, 201);
    const again = await new Client(t).post('/api/claim/check', { code });
    assert.equal(again.status, 404); assert.match(JSON.stringify(again.data), /That code didn't work\. Check with Colon\./);
  });

  test('the boss of a new floor is offered three lanes, Q7 templates with prices and three questions each; a visitor is offered nothing', async () => {
    const { t, c } = await newFloor();
    const boss = await floorState(c);
    assert.deepEqual(boss.onboarding, { on: true, plan: null });
    const r = (await c.get(`/api/floors/${c.slug}/onboarding`)).data;
    assert.deepEqual(r.lanes.map((l) => l.label), ['Game', 'Website', 'Business']);
    const tpl = r.lanes.flatMap((l) => l.templates);
    assert.deepEqual(tpl.map((x) => [x.label, x.price]), [['Arcade game', 'About $1 to $3'], ['One-page website', 'About $1'], ['Local service site with a booking form', 'About $2 to start'], ['Business or shop, first pass', 'About $2 to $4']]);
    assert.doesNotMatch(JSON.stringify(r), /directory|price-compare/i, 'no price-compare directory for friends');
    for (const l of r.lanes) assert.equal(l.questions.length, 3);
    assert.deepEqual(r.lanes.find((l) => l.id === 'website').questions, ['Who is it for?', 'What should a visitor do?', 'Any name or colours?']);
    const visitor = new Client(t);
    assert.equal((await floorState(visitor, c.slug)).onboarding, undefined);
    assert.ok([401, 403].includes((await visitor.get(`/api/floors/${c.slug}/onboarding`)).status));
    assert.ok([401, 403].includes((await visitor.post(`/api/floors/${c.slug}/onboarding/plan`, { lane: 'website', template: 'one-page', answers: ANSWERS })).status));
  });

  test('one manager call makes the plan: goal, up to 5 jobs, 3 to 5 done-means lines each, and the estimate; Start starts it and the status card reads Step 1 of 3', async () => {
    const { t, c, f, db } = await newFloor({ mockDelayMs: 400 });
    const calls = [];
    const chat = t.app.engine.llm.chat.bind(t.app.engine.llm);
    t.app.engine.llm.chat = (a) => { calls.push(a); return chat(a); };
    assert.equal((await c.post(`/api/floors/${c.slug}/onboarding/plan`, { lane: 'website', template: 'service', answers: ['', 'x', ''] })).status, 400, 'the first two questions need an answer');
    const r = await c.post(`/api/floors/${c.slug}/onboarding/plan`, { lane: 'website', template: 'service', answers: ANSWERS });
    assert.equal(r.status, 200);
    const plan = r.data.plan;
    const mine = calls.filter((x) => x.meta?.kind === 'onboarding');
    assert.equal(mine.length, 1, 'one manager call');
    const prompt = JSON.stringify(mine[0].messages);
    assert.match(prompt, /Dog owners on our street/); assert.doesNotMatch(prompt, /\$\d|cost about|budget/i, 'no money in what the manager reads');
    assert.ok(plan.goal);
    assert.ok(plan.jobs.length >= 1 && plan.jobs.length <= 5);
    for (const j of plan.jobs) assert.ok(j.checks.length >= 3 && j.checks.length <= 5, j.title);
    assert.deepEqual(plan.estimate, { usd: 2, line: 'This will cost about $2.' }, 'a service site with a booking form: the Q7 starting price');
    assert.equal((await floorState(c)).onboarding.plan.id, plan.id, 'a reload lands back on the plan');
    assert.equal(all(db, 'SELECT id FROM tasks WHERE floor_id=?', f.id).length, 0, 'nothing starts before Start');
    const live = sse(c, c.slug);
    const s = await c.post(`/api/floors/${c.slug}/onboarding/start`, { plan: plan.id });
    assert.equal(s.status, 200);
    const tasks = all(db, 'SELECT * FROM tasks WHERE floor_id=? ORDER BY id', f.id);
    assert.equal(tasks.length, plan.jobs.length);
    assert.deepEqual(tasks.map((x) => x.title), plan.jobs.map((j) => j.title));
    assert.ok(tasks.every((x) => x.plan === tasks[0].plan && x.project === 'site'), 'one plan, one project: one job on the timeline');
    assert.equal(tasks[0].job_est_usd, 2, 'the job keeps the estimate the boss was shown');
    assert.equal(get(db, 'SELECT name FROM floors WHERE id=?', f.id).name, 'Sunny Paws', 'the company takes the name from the answers');
    assert.equal((await c.post(`/api/floors/${c.slug}/onboarding/start`, { plan: plan.id })).status, 409, 'a second tap starts nothing more');
    const boss = await until(async () => { const x = await floorState(c); return /^Step 1 of 3/.test(x.status?.now?.line || '') ? x : null; }, { what: 'Step 1 of 3', timeout: 20000 });
    assert.equal(boss.jobs.length, 1, 'the first timeline card');
    assert.equal(boss.onboarding, undefined, 'onboarding is over');
    await until(() => live.events.some((e) => e.type === 'jobcard'), { what: 'the card, live' });
    live.close();
  });

  test('a manager answer that can\'t be read gives the template\'s own plan; Business and Game work the same way; ONBOARDING=0 turns it off', async () => {
    const bad = { chat: async (a) => ({ content: a.meta?.kind === 'onboarding' ? 'Sorry, no.' : 'Done.', toolCalls: [], finish: 'stop', usage: { prompt: 1, completion: 1, cost: 0, real: false } }) };
    const { c } = await newFloor({}, { llm: bad });
    const r = await c.post(`/api/floors/${c.slug}/onboarding/plan`, { lane: 'business', template: 'shop', answers: ['Candles, to people nearby', 'Order online', ''] });
    assert.equal(r.status, 200);
    const lane = LANES.find((l) => l.id === 'business');
    assert.deepEqual(r.data.plan.jobs.map((j) => j.title), templatePlan(lane, lane.templates[0], ['Candles, to people nearby', 'Order online', '']).jobs.map((j) => j.title));
    assert.equal(r.data.plan.estimate.line, 'This will cost about $3.');
    const g = await c.post(`/api/floors/${c.slug}/onboarding/plan`, { lane: 'game', template: 'arcade', answers: ['A frog crossing a road', 'Get across', ''] });
    assert.equal(g.data.plan.estimate.line, 'This will cost about $2.');
    const off = await newFloor({ onboarding: false });
    assert.equal((await floorState(off.c)).onboarding, undefined);
    assert.equal((await off.c.post(`/api/floors/${off.c.slug}/onboarding/plan`, { lane: 'website', template: 'one-page', answers: ANSWERS })).status, 404);
  });

  // DONE MEANS: a new code holder reaches a started plan in under 3 minutes, on desktop and phone widths, in mock mode.
  const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium';
  test('in a real browser, a new code holder reaches a started plan in under 3 minutes, at desktop and phone widths', { skip: !existsSync(CHROME) && 'no Chrome here', timeout: 400000 }, async () => {
    const { launch } = await import('./browser/cdp.mjs');
    const t = await boot({ peopleTalk: false, staffSelfCheck: false, mockDelayMs: 1500 }); open.push(t);
    const b = await launch({ noAngle: true });
    try {
      for (const [label, opts] of [['desktop', { width: 1280, height: 800 }], ['phone', { mobile: true }]]) {
        const p = await b.newPage(opts);
        const t0 = Date.now();
        // Minute 0: the code, through the home page's own dialog.
        await p.goto(`${t.base}/?q=low`);
        await p.until('!!document.querySelector(".open-office")', 'the Open an office button', 30000);
        await p.ev('document.querySelector(".open-office").click()');
        await p.until('!!document.querySelector(".code-input")', 'the code box');
        await p.type('.code-input', t.code());
        await p.ev('document.querySelector(".modal button[type=submit]").click()');
        await p.until('!!document.querySelector("[data-onboard]")', `${label}: onboarding`, 120000);
        // The keys come first (the recovery code), then the floor.
        await p.until('!!document.querySelector("[data-setup-saved], [data-lane]")', `${label}: the keys or the lanes`, 30000);
        if (await p.ev('!!document.querySelector("[data-setup-saved]")')) await p.ev('document.querySelector("[data-setup-saved]").click()');
        await p.until('document.querySelector("[data-onboard] .setup-q")?.textContent === "This is your floor" && document.querySelectorAll("[data-lane]").length === 3', 'This is your floor, three lanes');
        assert.deepEqual(await p.ev('[...document.querySelectorAll("[data-lane] b")].map((b) => b.textContent)'), ['Game', 'Website', 'Business']);
        assert.ok(await p.ev('!!document.querySelector("[data-something-else]")'), 'Something else is there');
        // Minute 1: a lane, then a template, its price shown.
        await p.ev('document.querySelector("[data-lane=website]").click()');
        await p.until('document.querySelectorAll("[data-template]").length === 2', 'the templates');
        assert.match(await p.ev('document.querySelector("[data-template=service] [data-price]").textContent'), /About \$2/);
        await p.ev('document.querySelector("[data-template=service]").click()');
        // Minute 2: three short questions.
        await p.until('document.querySelectorAll("[data-onboard] input[name^=answer]").length === 3', 'three questions');
        // Typed in as a person would, without the driver's per-field settling waits (they take longer than the typing).
        await p.ev(`(${JSON.stringify(ANSWERS)}).forEach((a, i) => { const el = document.querySelector('input[name=answer-' + i + ']'); el.value = a; el.dispatchEvent(new Event('input', { bubbles: true })); })`);
        await p.ev('document.querySelector("[data-ask-plan]").click()');
        // Minute 3: the plan, the price and one Start.
        await p.until('!!document.querySelector("[data-plan-goal]")', 'the plan', 30000);
        const shown = await p.ev('({ jobs: document.querySelectorAll("[data-plan-jobs] > li").length, lines: document.querySelectorAll("[data-plan-jobs] .ob-done li").length, est: document.querySelector("[data-plan-estimate]")?.textContent, buttons: [...document.querySelectorAll("[data-onboard] .setup-foot .setup-btn.primary")].map((b) => b.textContent.trim()), wide: document.querySelector(".setup-main").scrollWidth <= document.querySelector(".setup-main").clientWidth + 1 })');
        assert.equal(shown.jobs, 3); assert.ok(shown.lines >= 9); assert.equal(shown.est, 'This will cost about $2.');
        assert.deepEqual(shown.buttons, ['Start'], 'one button: Start'); assert.ok(shown.wide, `${label}: nothing wider than the screen`);
        await p.ev('document.querySelector("[data-start]").click()');
        await p.until('!document.querySelector("[data-onboard]") && (window.__office?.state?.jobs || []).length === 1', 'the plan started, its first card', 30000);
        await p.until('/^Step 1 of 3/.test(window.__office.state.status?.now?.line || "")', 'Step 1 of 3', 30000);
        if (label === 'phone') { await p.ev('window.__office.setTab("about")'); await sleep(300); }
        await p.until('/Step \\d of 3/.test(document.querySelector(".stc-now")?.textContent || "")', `${label}: the status card's Step N of 3`, 30000);
        if (label === 'phone') { await p.ev('window.__office.setTab("talk")'); await sleep(300); }
        await p.until('!!document.querySelector(".tl-job")', `${label}: the first timeline card`, 30000);
        const took = Date.now() - t0;
        console.log(`  ${label}: code to a started plan in ${(took / 1000).toFixed(1)}s`);
        assert.ok(took < 180000, `${label}: ${took}ms`);
        assert.deepEqual(p.errors.filter((e) => !/favicon|Office Cloud: no Office server/.test(e)), [], `${label}: no page errors`);
        await p.close?.();
      }
    } finally { b.close(); }
  });
});
