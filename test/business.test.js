// Business mode: the guided Idea, Build, Customers, Launch journey. The honesty rules on idea cards, the ad spend limits and the boss's own click,
// the $0 path, the live preview, what visitors see, and a whole journey in mock mode through the real engine. See server/business.js.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, claim, Client, adminClient, floorState, until } from './helpers.js';
import { checkIdeas, checkAdSpend, figuresIn, unbacked, moneyOk, urlKey, loadBusinessConfig } from '../server/business.js';
import { purchaseListing, decidePurchase } from '../server/purchases.js';
import { get, all, run } from '../server/db.js';
import { pauseAll } from '../server/ads-guard.js';
import { resumeAds } from '../server/business.js';
import { campaignId } from '../server/googleads.js';

const SEEN = ['https://example.com/a', 'https://example.org/b', 'https://example.net/c'];
const seenOnly = (urls) => new Set(urls.map(urlKey).filter((k) => !SEEN.map(urlKey).includes(k)));
const card = (over = {}) => ({
  name: 'Doorstep Dog Groom', who_pays: 'Busy dog owners', problem: 'Salons are booked up for weeks', what_you_sell: 'Home grooming visits', why_now: 'More people work from home',
  evidence: [{ url: SEEN[0], title: 'A', shows: 'Owners wait weeks for a salon' }, { url: SEEN[1], title: 'B', shows: 'Mobile groomers charge $60 a visit' }], ...over,
});
const input = (ideas, extra = {}) => ({ ideas, markets_checked: ['Pet services'], compared: [{ idea: 'Doorstep Dog Groom', verdict: 'Kept' }, { idea: 'Dog cafe', verdict: 'Dropped: premises' }], ...extra });

describe('idea cards: shape and honesty', () => {
  test('two or three cards with who pays, problem, what you sell, why now and 2 to 4 links pass', () => {
    const r = checkIdeas(input([card(), card({ name: 'Shift Supper' })]), { unseen: seenOnly });
    assert.equal(r.ok, true, r.problems.join('; '));
    assert.deepEqual(Object.keys(r.ideas[0]).sort(), ['evidence', 'name', 'problem', 'revenue', 'sell', 'whoPays', 'whyNow']);
    assert.equal(r.ideas[0].evidence.length, 2);
    assert.deepEqual(r.research.markets, ['Pet services']);
  });
  test('one card, four cards, a missing field, one link or five links are all refused', () => {
    assert.match(checkIdeas(input([card()]), { unseen: seenOnly }).problems.join(), /2 or 3 ideas/);
    assert.match(checkIdeas(input([card(), card(), card(), card()]), { unseen: seenOnly }).problems.join(), /not 4/);
    assert.match(checkIdeas(input([card({ why_now: '' }), card()]), { unseen: seenOnly }).problems.join(), /why_now is missing/);
    assert.match(checkIdeas(input([card({ evidence: [card().evidence[0]] }), card()]), { unseen: seenOnly }).problems.join(), /2 to 4 different evidence links/);
    const five = [...SEEN, 'https://example.com/d', 'https://example.com/e'].map((url) => ({ url, shows: 'something' }));
    assert.match(checkIdeas(input([card({ evidence: five }), card()]), { unseen: () => new Set() }).problems.join(), /2 to 4 different/);
    assert.match(checkIdeas(input([card({ evidence: [{ url: SEEN[0], shows: 'x y z' }, { url: SEEN[0] + '?again', shows: 'x y z' }] }), card()]), { unseen: seenOnly }).problems.join(), /different evidence links/, 'the same page twice is one link');
  });
  test('a link nobody on the floor opened or found is refused, by name', () => {
    const r = checkIdeas(input([card({ evidence: [card().evidence[0], { url: 'https://made-up.example/report', shows: 'A big report' }] }), card()]), { unseen: seenOnly });
    assert.equal(r.ok, false);
    assert.match(r.problems.join(), /nobody here opened or found "https:\/\/made-up\.example\/report"/);
  });
  test('a figure on a card has to be quoted in what one of its links shows', () => {
    assert.deepEqual(figuresIn('a $2 billion market, up 40% since 2019, about 1,200 shops').map((f) => f.digits), ['2', '40', '2019', '1200']);
    assert.deepEqual(unbacked('Groomers charge $60 a visit', 'Mobile groomers charge $60 a visit'), []);
    const bad = checkIdeas(input([card({ what_you_sell: 'Home grooming in a $2 billion market' }), card()]), { unseen: seenOnly });
    assert.equal(bad.ok, false);
    assert.match(bad.problems.join(), /"\$2 billion" is not backed by a source/);
    const quoted = checkIdeas(input([card({ what_you_sell: 'Home visits, where rivals charge $60' }), card()]), { unseen: seenOnly });
    assert.equal(quoted.ok, true, quoted.problems.join('; '));
    assert.match(checkIdeas(input([card({ why_now: 'Up 40% since 2019' }), card()]), { unseen: seenOnly }).problems.join(), /"40%" is not backed/);
  });
  test('a revenue range only with stated assumptions, each with a source the floor has seen', () => {
    const rev = (r) => checkIdeas(input([card({ revenue: r }), card()]), { unseen: seenOnly });
    assert.match(rev({ low: 1000, high: 4000 }).problems.join(), /needs its assumptions stated/);
    assert.match(rev({ low: 1000, high: 4000, assumptions: [{ text: 'twenty visits a month' }] }).problems.join(), /needs its words and a source link/);
    assert.match(rev({ low: 4000, high: 1000, assumptions: [{ text: 'twenty visits', source_url: SEEN[1] }] }).problems.join(), /low first/);
    assert.match(rev({ low: 1000, high: 4000, assumptions: [{ text: 'twenty visits', source_url: 'https://nowhere.example/x' }] }).problems.join(), /nobody here opened/);
    const ok = rev({ low: 1000, high: 4000, per: 'month', assumptions: [{ text: 'Twenty to sixty visits a month at the rival price', source_url: SEEN[1] }] });
    assert.equal(ok.ok, true, ok.problems.join('; '));
    assert.deepEqual(ok.ideas[0].revenue, { low: 1000, high: 4000, per: 'month', assumptions: [{ text: 'Twenty to sixty visits a month at the rival price', source: SEEN[1] }] });
  });
  test('the research has to show its work: markets checked and how the ideas compared', () => {
    const r = checkIdeas({ ideas: [card(), card()] }, { unseen: seenOnly });
    assert.match(r.problems.join(), /markets you checked/);
    assert.match(r.problems.join(), /how the ideas compared/);
  });
});

describe('ad spend: limits and amounts', () => {
  const cfg = loadBusinessConfig();
  test('the choices are $0, $5, $10 and $25, and nothing above $25 is ever a choice', () => {
    assert.deepEqual(cfg.adMoney, [0, 5, 10, 25]);
    assert.equal(cfg.adMaxUsd, 25);
    for (const a of [0, 5, 10, 25]) assert.equal(moneyOk(a), true);
    for (const a of [1, 26, 50, 100, -5, 2.5, NaN]) assert.equal(moneyOk(a), false, String(a));
    assert.equal(moneyOk(50, { ...cfg, adMoney: [0, 50] }), false, 'a config typo cannot lift the cap');
  });
  test('a request is exactly the boss\'s choice, never above $25, and one live campaign per floor', () => {
    assert.equal(checkAdSpend({ amount: 10, chosen: 10 }), null);
    assert.match(checkAdSpend({ amount: 0, chosen: 0 }), /for free/);
    assert.match(checkAdSpend({ amount: 25, chosen: 10 }), /exactly what the boss chose/);
    assert.match(checkAdSpend({ amount: 30, chosen: 30, cfg: { ...cfg, adMoney: [0, 30] } }), /exactly what the boss chose/, 'over the cap even if configured');
    assert.match(checkAdSpend({ amount: 7, chosen: 7 }), /exactly/);
    assert.match(checkAdSpend({ amount: 5, chosen: 5, live: true }), /One at a time/);
    for (const amount of [0, 5, 10, 25, 30, 7]) assert.doesNotMatch(String(checkAdSpend({ amount, chosen: 5 })), /\$|25/, 'a refusal never names a limit to the bot');
  });
});

const mediaOn = { mediaMock: true, searchMock: true, businessTickMs: 40, modesTickMs: 60000 };
// Paid ads switched on, against the mocked Google Ads API (server/googleads-mock.js). Nothing in these tests reaches Google.
const paidAds = { adsPaidEnabled: true, adsMock: true };
// The ad points at the live site's full https address, so these tests give the building one. Clients then send that origin.
const ORIGIN = 'https://office.example';
const onHttps = (t, ...clients) => { t.cfg.publicOrigin = ORIGIN; for (const c of clients) c.origin = ORIGIN; };
const adsOf = (t) => t.app.engine.business.ads;
const biz = async (c) => (await floorState(c)).business;
async function untilStep(c, pred, what) { return until(async () => { const b = await biz(c); return pred(b) ? b : null; }, { what, timeout: 30000 }); }
async function toIdeas(t, c, wish) {
  const r = await c.post(`/api/floors/${c.slug}/business/start`, wish ? { wish } : {});
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return untilStep(c, (b) => b.phase === 'pick', 'idea cards');
}
async function toBudget(t, c) {
  await toIdeas(t, c);
  const p = await c.post(`/api/floors/${c.slug}/business/pick`, { idea: 0 });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  return untilStep(c, (b) => b.phase === 'money', 'the ads');
}

describe('the journey in mock mode', () => {
  test('the whole journey with ad money: ideas, build tracks, ads, an AD SPEND request, the boss\'s approval, a Google search campaign that ends on schedule', async () => {
    const t = await boot({ ...mediaOn, ...paidAds });
    try {
      const c = await claim(t);
      const visitor = new Client(t);
      assert.equal((await biz(c)).active, false);
      const ideas = await toIdeas(t, c);
      assert.deepEqual(ideas.steps.map((s) => [s.id, s.state]), [['idea', 'now'], ['build', 'next'], ['customers', 'next'], ['launch', 'next']]);
      assert.equal(ideas.ideas.length, 3);
      assert.ok(ideas.ideas.every((i) => i.evidence.length >= 2 && i.whoPays && i.problem && i.sell && i.whyNow));
      assert.equal(ideas.research.searches.length, 2, 'the searches are shown as the work');
      assert.ok(ideas.research.markets.length && ideas.research.compared.length >= 2);
      assert.ok(ideas.chips.length >= 2 && ideas.chips.length <= 4 && ideas.chips.includes('Show me other ideas'));
      assert.ok(ideas.ideas[0].revenue.assumptions[0].source.startsWith('https://'));
      const seenByVisitor = (await floorState(visitor, c.slug)).business;
      assert.equal(seenByVisitor.ideas, undefined, 'idea cards are the boss\'s');
      assert.equal(seenByVisitor.chips, undefined);
      const pick = await c.post(`/api/floors/${c.slug}/business/pick`, { idea: 0 });
      assert.equal(pick.status, 200);
      assert.equal(pick.data.business.step, 'build');
      assert.deepEqual(pick.data.business.tracks.map((x) => x.label), ['Website', 'Product', 'Payments', 'Analytics']);
      assert.match(pick.data.business.tracks.find((x) => x.id === 'payments').note, /no Stripe/);
      const s1 = await floorState(c);
      assert.ok(s1.messages.some((m) => m.role === 'boss' && /Let's go with Doorstep Dog Groom/.test(m.text)));
      // The live preview, while it builds.
      const pv = await until(async () => { const r = await c.get(`/api/floors/${c.slug}/business/preview`); return r.data.ready ? r.data : null; }, { what: 'a page to preview', timeout: 30000 });
      const page = await fetch(`http://${t.host}${pv.url}`);
      assert.equal(page.status, 200);
      assert.match(page.headers.get('content-security-policy'), /^sandbox/);
      assert.match(await page.text(), /<html/i);
      assert.equal((await fetch(`http://${t.host}${pv.url.replace(/~w(\d+)\.[^/]+/, '~w$1.AAAAAAAAAAAAAAAAAAAAAAAAAAA')}`)).status, 404, 'a forged preview link finds nothing');
      assert.equal((await visitor.get(`/api/floors/${c.slug}/business/preview`)).status, 401);
      const budget = await untilStep(c, (b) => b.phase === 'money', 'the ads');
      assert.ok(budget.tracks.every((x) => x.lamp === 'done' && x.done === x.total), JSON.stringify(budget.tracks));
      assert.equal(budget.step, 'customers');
      assert.equal(budget.ads.pictures.length, 2);
      assert.match(budget.ads.pictures[0].src, /^\/theoffice\/api\/floors\/[a-z0-9-]+\/business\/file\/ad-1\.png$/, 'a path the floor page can load');
      assert.equal(budget.ads.videos.length, 2);
      assert.ok(budget.ads.videos.every((v) => v.captions), 'every video has its captions');
      assert.deepEqual(budget.ads.plan.where, ['Google Search']);
      assert.ok(budget.ads.plan.test.a && budget.ads.plan.test.b);
      const words = budget.ads.plan.search;
      assert.deepEqual(words.keywords, ['mobile dog grooming', 'dog grooming at home', 'dog groomer near me', 'in home dog grooming'], 'the marketer\'s keywords');
      assert.ok(words.headlines.length >= 3 && words.headlines.every((x) => x.length <= 30) && words.descriptions.every((x) => x.length <= 90));
      assert.deepEqual(budget.adMoney, { options: [0, 5, 10, 25], chosen: 0, set: false, ready: true, paid: true });
      assert.deepEqual(budget.channels.map((x) => [x.id, x.on, !!x.soon]), [['google', true, false], ['meta', false, true]], 'Google on, Facebook and Instagram coming soon');
      const told = t.app.engine.business.stateLine(t.db.prepare('SELECT id FROM floors WHERE slug=?').get(c.slug).id);
      assert.match(told, /Paid ads run only as a Google search ad for now; Facebook and Instagram ads are coming soon/, 'the manager knows where paid ads run');
      assert.match(told, /picture and video ads are for sharing/);
      assert.ok(budget.chips.includes('Skip ads for now') && budget.chips.includes('Change the ads'));
      const vtt = await c.raw('GET', `/api/floors/${c.slug}/business/file/video-1.vtt`);
      assert.match(await vtt.text(), /^WEBVTT[\s\S]*Grooming that comes to you/);
      const range = await c.raw('GET', `/api/floors/${c.slug}/business/file/video-1.mp4`, { headers: { range: 'bytes=0-3' } });
      assert.equal(range.status, 206);
      assert.equal(range.headers.get('content-range').startsWith('bytes 0-3/'), true);
      assert.equal((await visitor.raw('GET', `/api/floors/${c.slug}/business/file/ad-1.png`)).status, 404, 'not before launch');
      // The ledger has the videos as video.
      const fid = get(t.db, 'SELECT id FROM floors WHERE slug=?', c.slug).id;
      assert.equal(get(t.db, "SELECT COUNT(*) n FROM ledger WHERE floor_id=? AND kind='video'", fid).n, 2);
      // More than $25, or an amount that isn't a choice, is refused.
      onHttps(t, c, visitor);
      assert.equal((await c.post(`/api/floors/${c.slug}/business/launch`, { amount: 50 })).status, 400);
      assert.equal((await c.post(`/api/floors/${c.slug}/business/launch`, { amount: 7 })).status, 400);
      assert.equal((await visitor.post(`/api/floors/${c.slug}/business/launch`, { amount: 10 })).status, 401);
      const go = await c.post(`/api/floors/${c.slug}/business/launch`, { amount: 10 });
      assert.equal(go.status, 200, JSON.stringify(go.data));
      const asked = await untilStep(c, (b) => b.adSpend?.status === 'awaiting_boss', 'the AD SPEND request');
      assert.equal(asked.adSpend.amount, 10);
      assert.match(asked.adSpend.audience, /Dog owners/);
      assert.equal(get(t.db, "SELECT COUNT(*) n FROM purchases WHERE floor_id=?", fid).n, 0, 'nothing reaches the building manager before the boss\'s click');
      // The boss approves with one click. The approval is on record first; then the campaign is made on Google, PAUSED, and only then switched on.
      assert.equal((await visitor.post(`/api/floors/${c.slug}/business/ad-spend/${asked.adSpend.id}`, { answer: 'approve' })).status, 401);
      const mock = adsOf(t).mock;
      assert.equal(mock.calls.length, 0, 'Google hears nothing before the boss\'s click');
      const ok = await c.post(`/api/floors/${c.slug}/business/ad-spend/${asked.adSpend.id}`, { answer: 'approve' });
      assert.equal(ok.status, 200, JSON.stringify(ok.data));
      assert.ok(['approved', 'running'].includes(ok.data.business.adSpend.status), ok.data.business.adSpend.status);
      assert.equal((await c.post(`/api/floors/${c.slug}/business/ad-spend/${asked.adSpend.id}`, { answer: 'approve' })).status, 409, 'one click, once');
      const ran = await untilStep(c, (b) => b.adSpend?.status === 'running', 'the campaign on Google');
      assert.equal(ran.adSpend.label, 'Running on Google Search');
      assert.match(ran.adSpend.endsOn, /^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}$/);
      assert.equal(mock.campaigns.size, 1, 'one campaign');
      const made = mock.calls.find((x) => x.path === 'googleAds:mutate').body;
      assert.equal(made.validateOnly, false);
      const campOp = made.mutateOperations.find((o) => o.campaignOperation).campaignOperation.create;
      const budgetOp = made.mutateOperations.find((o) => o.campaignBudgetOperation).campaignBudgetOperation.create;
      assert.equal(campOp.status, 'PAUSED', 'made paused');
      assert.deepEqual([budgetOp.period, budgetOp.totalAmountMicros], ['CUSTOM_PERIOD', '10000000'], 'a total budget of exactly the approved amount');
      assert.deepEqual(campOp.networkSettings, { targetGoogleSearch: true, targetSearchNetwork: false, targetContentNetwork: false });
      assert.ok(Number(campOp.targetSpend.cpcBidCeilingMicros) > 0);
      const steps = mock.calls.map((x) => (x.path === 'campaigns:mutate' ? x.body.operations[0].update.status : x.path));
      assert.ok(steps.indexOf('googleAds:mutate') < steps.indexOf('ENABLED'), steps.join(' > '));
      const camp = [...mock.campaigns.values()][0];
      assert.equal(camp.status, 'ENABLED');
      assert.deepEqual(mock.keywords.map((k) => k.keyword.text), words.keywords);
      assert.deepEqual(mock.ads[0].ad.finalUrls, [`${ORIGIN}/theoffice/f/${c.slug}/${budget.project}/`], 'the ad points at the floor\'s live site');
      const row = get(t.db, 'SELECT * FROM ad_spend WHERE id=?', asked.adSpend.id);
      assert.ok(row.decided_at && row.ends_at - row.decided_at <= 7 * 86400000, 'ends within 7 days of the approval');
      assert.equal(get(t.db, "SELECT COUNT(*) n FROM purchases WHERE floor_id=?", fid).n, 0, 'Google, not the by-hand purchases path');
      // A second campaign while this one is live is refused, server-side.
      const mgr = get(t.db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", fid);
      const floor = get(t.db, 'SELECT * FROM floors WHERE id=?', fid);
      const ctx = t.app.engine.toolCtx(floor, mgr, null, ['request_ad_spend']);
      assert.match(await t.app.engine.tools.exec(ctx, 'request_ad_spend', JSON.stringify({ amount: 10, audience: 'Anyone' })), /^Error: .*One at a time/);
      assert.match(await t.app.engine.tools.exec(ctx, 'request_ad_spend', JSON.stringify({ amount: 25, audience: 'Anyone' })), /^Error: .*exactly what the boss chose/);
      // Views and clicks reach the boss's slip; what it cost doesn't.
      mock.spend(camp.id, 3.2, { impressions: 140, clicks: 6 });
      await adsOf(t).tick({ force: true });
      const seen = await untilStep(c, (b) => b.adSpend?.clicks === 6, 'the clicks');
      assert.equal(seen.adSpend.views, 140);
      assert.doesNotMatch(JSON.stringify(seen.adSpend), /3\.2|spent|cost/);
      // One that costs more than approved stops at once, and past its end it is closed, on schedule.
      mock.spend(camp.id, 10.4, { impressions: 400, clicks: 15 });
      await adsOf(t).tick({ force: true });
      assert.equal(camp.status, 'PAUSED');
      assert.equal((await biz(c)).adSpend.status, 'paused');
      run(t.db, 'UPDATE ad_spend SET ends_at=? WHERE id=?', Date.now() - 1000, asked.adSpend.id);
      await adsOf(t).tick({ force: true });
      const over = await untilStep(c, (b) => b.adSpend?.status === 'ended', 'the end of the campaign');
      assert.equal(over.adSpend.label, 'Finished');
      const done = await untilStep(c, (b) => b.launched, 'the launch report');
      assert.deepEqual(done.steps.map((s) => s.state), ['done', 'done', 'done', 'done']);
      assert.equal(done.progress, 100);
      // Visitors see the step header, the lamps and the launched ads, and never an amount.
      const v = (await floorState(visitor, c.slug)).business;
      assert.equal(v.launched, true);
      assert.equal(v.adSpend, undefined); assert.equal(v.adMoney, undefined);
      assert.equal(v.ads.pictures.length, 2);
      assert.doesNotMatch(JSON.stringify(v), /\$\d|"amount"|budget/);
      assert.equal((await visitor.raw('GET', `/api/floors/${c.slug}/business/file/ad-1.png`)).status, 200, 'launched ads are shareable');
    } finally { await t.close(); }
  });

  test('the $0 path: no request at all, the ads go up on the floor and on the live site, and the launch report comes', async () => {
    const t = await boot(mediaOn);
    try {
      const c = await claim(t);
      const ready = await toBudget(t, c);
      // Paid ads are off unless ADS_PAID_ENABLED is set: then only the free path exists.
      assert.deepEqual(ready.adMoney.options, [0]);
      assert.equal(ready.adMoney.paid, false);
      assert.deepEqual(ready.channels.map((x) => [x.id, x.on]), [['google', false], ['meta', false]]);
      assert.match(t.app.engine.business.stateLine(t.db.prepare('SELECT id FROM floors WHERE slug=?').get(c.slug).id), /Paid ads aren’t switched on in this building yet, so it launches free/, 'the manager knows only the free path is open');
      const paid = await c.post(`/api/floors/${c.slug}/business/launch`, { amount: 5 });
      assert.equal(paid.status, 400);
      assert.match(paid.data.message || paid.data.error || JSON.stringify(paid.data), /switched on|bad_amount|ad amounts/);
      const go = await c.post(`/api/floors/${c.slug}/business/launch`, { amount: 0 });
      assert.equal(go.status, 200, JSON.stringify(go.data));
      const done = await untilStep(c, (b) => b.launched, 'the launch report');
      assert.equal(done.adSpend, null);
      assert.equal(done.adMoney.chosen, 0);
      const fid = get(t.db, 'SELECT id FROM floors WHERE slug=?', c.slug).id;
      assert.equal(get(t.db, 'SELECT COUNT(*) n FROM ad_spend WHERE floor_id=?', fid).n, 0);
      assert.equal(get(t.db, 'SELECT COUNT(*) n FROM purchases WHERE floor_id=?', fid).n, 0);
      assert.ok(get(t.db, 'SELECT launch_report r FROM projects WHERE floor_id=? AND slug=?', fid, done.project).r, 'the existing launch report');
      const live = await fetch(`http://${t.host}/theoffice/f/${c.slug}/${done.project}/ads/ad-1.png`);
      assert.equal(live.status, 200, 'the ad is on the live site, so it has a link anyone can open');
      assert.equal(live.headers.get('content-type'), 'image/png');
      const visitor = new Client(t);
      const v = (await floorState(visitor, c.slug)).business;
      assert.equal(v.ads.videos.length, 2);
      assert.equal(done.chips.includes('How do I share the ads?'), true);
      // The manager can't ask for money the boss never chose.
      const mgr = get(t.db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", fid);
      const ctx = t.app.engine.toolCtx(get(t.db, 'SELECT * FROM floors WHERE id=?', fid), mgr, null, ['request_ad_spend']);
      assert.match(await t.app.engine.tools.exec(ctx, 'request_ad_spend', JSON.stringify({ amount: 5, audience: 'Anyone' })), /^Error: .*exactly what the boss chose/);
    } finally { await t.close(); }
  });

  test('asking the manager starts it, an unsourced figure is refused until it is fixed, and declining a request spends nothing', async () => {
    const t = await boot(mediaOn);
    try {
      const c = await claim(t);
      await c.post(`/api/floors/${c.slug}/chat`, { text: 'Find me a business idea and build it.' });
      const b = await untilStep(c, (x) => x.active, 'Business mode');
      assert.equal(b.step, 'idea');
      const fid = get(t.db, 'SELECT id FROM floors WHERE slug=?', c.slug).id;
      // The ideas task: the first try with a made-up market size comes back refused.
      const r2 = await until(() => get(t.db, "SELECT transcript FROM tasks WHERE floor_id=? AND title='Find business ideas' AND status IN ('review','done')", fid), { what: 'the ideas task' });
      assert.ok(r2);
      const t3 = await boot(mediaOn);
      try {
        const c3 = await claim(t3);
        await c3.post(`/api/floors/${c3.slug}/business/start`, { wish: 'Something with dogs [unsourced]' });
        await untilStep(c3, (x) => x.phase === 'pick', 'cards after a refusal');
        const f3 = get(t3.db, 'SELECT id FROM floors WHERE slug=?', c3.slug).id;
        const tr = get(t3.db, "SELECT transcript FROM tasks WHERE floor_id=? AND title='Find business ideas'", f3).transcript;
        assert.match(tr, /\\"\$2 billion\\" is not backed by a source/);
        const cards = (await biz(c3)).ideas;
        assert.doesNotMatch(JSON.stringify(cards), /billion/);
      } finally { await t3.close(); }
    } finally { await t.close(); }
  });

  test('declining the ad request spends nothing and frees the floor for another; skipping ads launches without them', async () => {
    const t = await boot({ ...mediaOn, ...paidAds });
    try {
      const c = await claim(t);
      await toBudget(t, c);
      await c.post(`/api/floors/${c.slug}/business/launch`, { amount: 5 });
      const asked = await untilStep(c, (b) => b.adSpend?.status === 'awaiting_boss', 'the request');
      const no = await c.post(`/api/floors/${c.slug}/business/ad-spend/${asked.adSpend.id}`, { answer: 'decline' });
      assert.equal(no.data.business.adSpend.status, 'declined');
      assert.equal(adsOf(t).mock.calls.length, 0, 'Google never heard of it');
      const fid = get(t.db, 'SELECT id FROM floors WHERE slug=?', c.slug).id;
      assert.equal(get(t.db, 'SELECT COUNT(*) n FROM purchases WHERE floor_id=?', fid).n, 0);
      const mgr = get(t.db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", fid);
      const ctx = t.app.engine.toolCtx(get(t.db, 'SELECT * FROM floors WHERE id=?', fid), mgr, null, ['request_ad_spend']);
      assert.match(await t.app.engine.tools.exec(ctx, 'request_ad_spend', JSON.stringify({ amount: 5, audience: 'Dog owners' })), /^Filed/, 'declined is not live, so another can be filed');
      // No bot holds a tool that approves.
      for (const role of ['manager', 'researcher', 'marketer', 'designer', 'builder']) assert.ok(!t.app.engine.business.toolsFor(fid, role, { id: 0 }).some((n) => /approve|decide/.test(n)));
      const t2 = await boot(mediaOn);
      try {
        const c2 = await claim(t2);
        await toBudget(t2, c2);
        await c2.post(`/api/floors/${c2.slug}/chat`, { text: 'Skip ads for now' });
        const done = await untilStep(c2, (b) => b.launched, 'a launch without ads');
        assert.equal(done.ads.skipped, true);
        assert.equal((await floorState(new Client(t2), c2.slug)).business.ads, null, 'skipped ads are not put up');
      } finally { await t2.close(); }
    } finally { await t.close(); }
  });

  test('the building\'s monthly cap is checked at launch and again at the boss\'s click, never named on a floor; a campaign Google refuses spends nothing', async () => {
    const t = await boot({ ...mediaOn, ...paidAds, adMonthlyCapUsd: 30 });
    try {
      const c1 = await claim(t, 'First Floor Co');
      const c2 = await claim(t, 'Second Floor Co');
      await toBudget(t, c1); await toBudget(t, c2);
      onHttps(t, c1, c2);
      const mock = adsOf(t).mock;
      const fileAndApprove = async (c, amount) => {
        const go = await c.post(`/api/floors/${c.slug}/business/launch`, { amount });
        assert.equal(go.status, 200, JSON.stringify(go.data));
        const asked = await untilStep(c, (b) => b.adSpend?.status === 'awaiting_boss', 'the request');
        return { id: asked.adSpend.id, approve: () => c.post(`/api/floors/${c.slug}/business/ad-spend/${asked.adSpend.id}`, { answer: 'approve' }) };
      };
      const first = await fileAndApprove(c1, 25);
      assert.equal((await first.approve()).status, 200);
      await untilStep(c1, (b) => b.adSpend?.status === 'running', 'the first campaign');
      // $25 of $30 is taken this month: $10 more is refused at launch, without a figure.
      const big = await c2.post(`/api/floors/${c2.slug}/business/launch`, { amount: 10 });
      assert.equal(big.status, 409);
      assert.doesNotMatch(JSON.stringify(big.data), /\d/, 'the cap is never named');
      // $5 fits at launch, but by the boss's click the first campaign has cost more than its amount, so it no longer does.
      const second = await fileAndApprove(c2, 5);
      mock.spend([...mock.campaigns.values()][0].id, 26);
      await adsOf(t).tick({ force: true });
      const no = await second.approve();
      assert.equal(no.status, 200);
      assert.equal(no.data.business.adSpend.status, 'withdrawn');
      assert.equal(no.data.business.adSpend.label, 'Not set up. Nothing was spent');
      assert.doesNotMatch(`${no.data.business.adSpend.label} ${no.data.business.adSpend.note}`, /\d|\bcap\b/i, 'no figure and no cap on the floor');
      assert.equal(mock.campaigns.size, 1, 'nothing was made on Google for it');
      // With room again, Google refusing the campaign leaves nothing running and says why; the floor can file again.
      t.cfg.adMonthlyCapUsd = 100;
      const fid = get(t.db, 'SELECT id FROM floors WHERE slug=?', c2.slug).id;
      const mgr = get(t.db, "SELECT * FROM agents WHERE floor_id=? AND role='manager'", fid);
      const ctx = t.app.engine.toolCtx(get(t.db, 'SELECT * FROM floors WHERE id=?', fid), mgr, null, ['request_ad_spend']);
      assert.match(await t.app.engine.tools.exec(ctx, 'request_ad_spend', JSON.stringify({ amount: 5, audience: 'Dog owners' })), /^Filed/);
      const again = await untilStep(c2, (b) => b.adSpend?.status === 'awaiting_boss', 'the second request');
      mock.failNextMutate({ campaignError: 'CANNOT_SET_DATE_TO_PAST' }, 'Mock refusal.');
      await c2.post(`/api/floors/${c2.slug}/business/ad-spend/${again.adSpend.id}`, { answer: 'approve' });
      const failed = await untilStep(c2, (b) => b.adSpend?.status === 'failed', 'Google\'s refusal');
      assert.match(failed.adSpend.note, /CANNOT_SET_DATE_TO_PAST/);
      assert.equal(mock.campaigns.size, 1);
      assert.equal(mock.calls.filter((x) => x.path === 'campaigns:mutate' && x.body.operations[0].update.status === 'ENABLED').length, 1, 'only the first was ever switched on');
      // The admin's emergency stop holds: no paid choices and no new campaign until "ads resume".
      await pauseAll({ db: t.db, api: adsOf(t).api });
      assert.equal(adsOf(t).paidOn(), false);
      assert.match(await t.app.engine.tools.exec(ctx, 'request_ad_spend', JSON.stringify({ amount: 5, audience: 'Dog owners' })), /^Error: .*switched off/);
      resumeAds(t.db);
      assert.equal(adsOf(t).paidOn(), true);
      // Switched off, nothing new starts, and a request already filed is withdrawn at the click.
      t.cfg.adsPaidEnabled = false;
      assert.match(await t.app.engine.tools.exec(ctx, 'request_ad_spend', JSON.stringify({ amount: 5, audience: 'Dog owners' })), /^Error: .*switched off/);
    } finally { await t.close(); }
  });

  test('when the AI video fails, the ads still finish and the failure is said plainly', async () => {
    const t = await boot(mediaOn);
    try {
      const c = await claim(t);
      await c.post(`/api/floors/${c.slug}/chat`, { text: 'Find me a business idea and build it: [videofail]' });
      await untilStep(c, (b) => b.phase === 'pick', 'cards');
      await c.post(`/api/floors/${c.slug}/business/pick`, { idea: 1 });
      const b = await untilStep(c, (x) => x.phase === 'money', 'the ads without videos');
      assert.equal(b.ads.videos.length, 0);
      assert.match(b.ads.videoFailed, /502|upstream/);
      assert.equal(b.ads.pictures.length, 2);
    } finally { await t.close(); }
  });
});
