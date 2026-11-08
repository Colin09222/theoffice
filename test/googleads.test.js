// Paid Google ads, against a mocked Google Ads API only: nothing in here reaches Google. The campaign an approved request becomes (a total budget
// equal to the approved amount and never over $25, an end within 7 days, Search only, Maximize Clicks with a ceiling, made PAUSED), the token
// bought from the refresh token in memory, the spend watchdog and the admin's list and emergency stop, run as their own processes like a scheduler would.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planCampaign, campaignOperations, createCampaign, createGoogleAds, googleAdsFromConfig, watchAccount, checkSearchAd, campaignId, zonedMs, HARD_MAX_USD, MAX_DAYS } from '../server/googleads.js';
import { createMockGoogleAds } from '../server/googleads-mock.js';
import { ensureAdSpend } from '../server/business.js';
import { openDb, run, get, all } from '../server/db.js';
import { scrub } from '../server/llm.js';

const DAY = 86400000;
const TZ = 'America/New_York';
const WORDS = {
  headlines: ['Dog Grooming at Your Door', 'No More Salon Waits', 'Calm, One Dog at a Time'],
  descriptions: ['Home grooming visits, booked online. Comes to you.', 'Not open yet: join the notify-me list.'],
  keywords: ['mobile dog grooming', 'dog grooming at home', 'dog groomer near me'],
};
const plan = (over = {}) => planCampaign({ requestId: 7, tag: 'abc123', label: 'floor 3 doorstep', amountUsd: 10, now: Date.now(), timeZone: TZ, finalUrl: 'https://doorstep.example/', ...WORDS, ...over });
const apiFor = (mock, over = {}) => createGoogleAds({ ...mock.settings, fetch: mock.fetch, ...over });
const createOp = (ops, kind) => ops.find((o) => o[kind])?.[kind].create;

describe('the campaign an approved request becomes', () => {
  test('a total budget of exactly the approved amount, an end within 7 days at the end of a day, Search only, a click ceiling, made PAUSED', () => {
    const now = Date.now();
    const p = plan({ now });
    assert.equal(p.totalMicros, 10e6);
    assert.ok(p.endsAt - now <= MAX_DAYS * DAY && p.endsAt > now + 3 * DAY, `${p.startText} to ${p.endText}`);
    assert.match(p.endText, / 23:59:59$/);
    assert.match(p.startText, / 00:00:00$/, 'whole days, as v26 wants');
    assert.ok(p.startsAt <= now && now - p.startsAt < DAY, 'today\'s date: it runs from now');
    assert.ok(p.cpcCeilingMicros > 0 && p.cpcCeilingMicros <= 2e6);
    const ops = campaignOperations({ rn: (k, id) => `customers/1/${k}/${id}` }, p);
    const budget = createOp(ops, 'campaignBudgetOperation'), c = createOp(ops, 'campaignOperation');
    assert.deepEqual([budget.period, budget.totalAmountMicros, budget.explicitlyShared, 'amountMicros' in budget], ['CUSTOM_PERIOD', '10000000', false, false]);
    assert.equal(c.status, 'PAUSED');
    assert.equal(c.advertisingChannelType, 'SEARCH');
    assert.deepEqual(c.networkSettings, { targetGoogleSearch: true, targetSearchNetwork: false, targetContentNetwork: false }, 'no search partners, no display');
    assert.ok(Number(c.targetSpend.cpcBidCeilingMicros) > 0 && !c.manualCpc, 'Maximize Clicks with a ceiling on each click');
    assert.ok(!('startDate' in c) && !('endDate' in c) && c.startDateTime && c.endDateTime, 'v26 takes startDateTime and endDateTime');
    assert.equal(c.campaignBudget, budget.resourceName);
    const kws = ops.filter((o) => o.adGroupCriterionOperation).map((o) => o.adGroupCriterionOperation.create.keyword);
    assert.deepEqual(kws.map((k) => k.text), WORDS.keywords);
    assert.ok(kws.every((k) => k.matchType === 'PHRASE'));
    assert.deepEqual(createOp(ops, 'adGroupAdOperation').ad.finalUrls, ['https://doorstep.example/']);
  });
  test('$25 is the most, whatever the settings say; whole dollars only; the ad has to point at a live https site', () => {
    assert.equal(HARD_MAX_USD, 25);
    assert.equal(plan({ amountUsd: 25 }).totalMicros, 25e6);
    for (const amountUsd of [26, 50, 100, 0, -5, 2.5, NaN, '10; DROP']) assert.throws(() => plan({ amountUsd }), /\$25 at most/, String(amountUsd));
    for (const finalUrl of ['', 'http://doorstep.example/', 'https://localhost/x', '/theoffice/f/a/b/', 'javascript:alert(1)']) assert.throws(() => plan({ finalUrl }), /live site/, finalUrl);
    assert.ok(plan({ amountUsd: 5, cpcCeilingUsd: 40 }).cpcCeilingMicros <= 2e6, 'a click never bids over $2');
  });
  test('7 days at most from now, at any hour, even a few minutes before midnight', () => {
    for (const at of ['2026-11-07 23:55:00', '2026-11-08 00:00:30', '2026-03-07 23:58:00', '2026-12-31 12:00:00']) {
      const now = zonedMs(...at.split(' '), TZ);
      const p = plan({ now, days: 30 });
      assert.ok(p.endsAt - now <= MAX_DAYS * DAY, `${at}: ends ${p.endText}`);
      assert.ok(p.days >= 4 && p.endsAt - p.startsAt >= 4 * DAY - 1000, `${at}: long enough for a total budget (${p.startText} to ${p.endText})`);
    }
  });
  test('the search ad\'s words are checked the way Google checks them', () => {
    assert.equal(checkSearchAd(WORDS).ok, true);
    const bad = (over) => checkSearchAd({ ...WORDS, ...over }).problems.join('; ');
    assert.match(bad({ headlines: ['Dog grooming that comes right to your door', ...WORDS.headlines.slice(1)] }), /characters; 30 at most/);
    assert.match(bad({ headlines: ['Book Today!', ...WORDS.headlines.slice(1)] }), /exclamation mark/);
    assert.match(bad({ descriptions: ['x'.repeat(91), 'Fine.'] }), /90 at most/);
    assert.match(bad({ keywords: ['dogs', 'grooming'] }), /3 to 10 different keywords/);
    assert.match(bad({ headlines: WORDS.headlines.slice(0, 2) }), /3 to 15 different search headlines/);
    assert.match(bad({ descriptions: ['Fun for dogs 🐶', 'Fine.'] }), /emoji/);
    assert.deepEqual(checkSearchAd({ ...WORDS, keywords: ['Dog Grooming!!', 'dog grooming', 'groomer <near> me', 'x'] }).keywords, ['dog grooming', 'groomer near me', 'x'], 'cleaned and de-duplicated');
  });
});

describe('the Google Ads client and the mocked API', () => {
  test('the access token is bought from the refresh token, kept in memory and bought again when it runs out; no developer token is sent', async () => {
    let clock = Date.now();
    const mock = createMockGoogleAds({ now: () => clock });
    const api = apiFor(mock, { now: () => clock });
    await api.search("SELECT campaign.id, campaign.name, campaign.status, campaign.resource_name FROM campaign WHERE campaign.status != 'REMOVED'");
    await api.search("SELECT campaign.id, campaign.name, campaign.status, campaign.resource_name FROM campaign WHERE campaign.status != 'REMOVED'");
    assert.equal(mock.signIns, 1, 'one sign-in for both');
    clock += 3600 * 1000;
    await api.search("SELECT campaign.id, campaign.name, campaign.status, campaign.resource_name FROM campaign WHERE campaign.status != 'REMOVED'");
    assert.equal(mock.signIns, 2, 'signed in again once the hour was up');
    mock.expireTokens();
    await assert.rejects(api.search("SELECT campaign.id, campaign.name, campaign.status, campaign.resource_name FROM campaign WHERE campaign.status != 'REMOVED'"), /401/);
    await api.search("SELECT campaign.id, campaign.name, campaign.status, campaign.resource_name FROM campaign WHERE campaign.status != 'REMOVED'");
    assert.equal(mock.signIns, 3, 'a refused token is dropped and the next call signs in again');
    assert.ok(mock.calls.every((c) => !c.developerToken));
    const wrong = createGoogleAds({ ...mock.settings, refreshToken: 'revoked', fetch: mock.fetch });
    const e = await wrong.search('SELECT campaign.id FROM campaign').catch((x) => x);
    assert.match(e.message, /sign-in failed \(400 invalid_grant\)/);
    assert.doesNotMatch(e.message, /revoked|mock-client-secret|ya29/);
  });
  test('the mock refuses what Google refused: startDate, a start or end off the day\'s edge, a total budget over 3 days, long text', async () => {
    const mock = createMockGoogleAds();
    const api = apiFor(mock);
    const ops = campaignOperations(api, plan());
    const swap = (fn) => ops.map((o) => (o.campaignOperation ? { campaignOperation: { create: fn({ ...o.campaignOperation.create }) } } : o));
    await assert.rejects(api.mutate(swap((c) => { delete c.startDateTime; delete c.endDateTime; return { ...c, startDate: '2026-11-08', endDate: '2026-11-14' }; })), /Unknown name|400/);
    await assert.rejects(api.mutate(swap((c) => ({ ...c, endDateTime: c.endDateTime.replace('23:59:59', '00:00:00') }))), /END_TIME_MUST_BE_THE_END_OF_A_DAY/);
    await assert.rejects(api.mutate(swap((c) => ({ ...c, startDateTime: c.startDateTime.replace('00:00:00', '21:50:00') }))), /START_TIME_MUST_BE_THE_START_OF_A_DAY/);
    const start = plan().startText.split(' ')[0];
    const plus = (n) => { const d = new Date(`${start}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
    await assert.rejects(api.mutate(swap((c) => ({ ...c, endDateTime: `${plus(2)} 23:59:59` }))), /UNKNOWN/, 'three days is too short for a total budget');
    await api.mutate(swap((c) => ({ ...c, endDateTime: `${plus(3)} 23:59:59` })), { validateOnly: true });
    await assert.rejects(api.mutate(ops.map((o) => (o.adGroupAdOperation ? { adGroupAdOperation: { create: { ...o.adGroupAdOperation.create, ad: { ...o.adGroupAdOperation.create.ad, responsiveSearchAd: { ...o.adGroupAdOperation.create.ad.responsiveSearchAd, descriptions: [{ text: 'x'.repeat(92) }, { text: 'ok' }] } } } } } : o))), /TOO_LONG/);
    assert.equal(mock.campaigns.size, 0, 'a refused request makes nothing at all');
    await api.mutate(ops, { validateOnly: true });
    assert.equal(mock.campaigns.size, 0, 'validateOnly makes nothing');
  });
  test('the campaign is made PAUSED, all at once, and a second try finds it instead of making another', async () => {
    const mock = createMockGoogleAds();
    const api = apiFor(mock);
    const p = plan();
    const made = await createCampaign(api, p);
    assert.equal(mock.campaigns.size, 1);
    const c = mock.campaigns.get(campaignId(made.campaign));
    assert.equal(c.status, 'PAUSED');
    assert.equal(mock.budgets.get(campaignId(made.budget)).totalAmountMicros, '10000000');
    assert.equal(mock.keywords.length, 3);
    assert.equal(mock.ads[0].ad.responsiveSearchAd.headlines.length, 3);
    const again = await createCampaign(api, p);
    assert.equal(again.adopted, true);
    assert.equal(mock.campaigns.size, 1, 'no second campaign');
  });
});

/** An account with Office campaigns A ($10 approved) and B ($5), both on. */
async function account() {
  const mock = createMockGoogleAds();
  const api = apiFor(mock);
  const a = await createCampaign(api, plan({ requestId: 1 }));
  const b = await createCampaign(api, plan({ requestId: 2, amountUsd: 5 }));
  await api.setStatus([a.campaign, b.campaign], 'ENABLED');
  const ids = { a: campaignId(a.campaign), b: campaignId(b.campaign) };
  const known = [{ id: ids.a, approvedUsd: 10, endsAt: Date.now() + 3 * DAY }, { id: ids.b, approvedUsd: 5, endsAt: Date.now() + 3 * DAY }];
  return { mock, api, ids, known, status: (id) => mock.campaigns.get(id).status };
}

describe('the spend watchdog', () => {
  test('all within limits: nothing is paused and it says so in one line', async () => {
    const { mock, api, ids, known, status } = await account();
    mock.spend(ids.a, 4.2); mock.spend(ids.b, 1);
    const r = await watchAccount({ api, known, capUsd: 50 });
    assert.equal(r.alert, false);
    assert.deepEqual(r.paused, []);
    assert.equal(r.line, 'ads ok: 2 Office campaigns, $5.20 this month of the $50.00 cap');
    assert.equal(status(ids.a), 'ENABLED');
  });
  test('one campaign past its approved amount pauses every campaign at once', async () => {
    const { mock, api, ids, known, status } = await account();
    mock.spend(ids.a, 10.01);
    const r = await watchAccount({ api, known, capUsd: 50 });
    assert.equal(r.alert, true);
    assert.deepEqual([status(ids.a), status(ids.b)], ['PAUSED', 'PAUSED']);
    assert.match(r.line, /^ads ALERT: paused 2 campaigns: campaign \d+ cost \$10\.01 of its \$10\.00$/);
    assert.equal(r.line.split('\n').length, 1);
  });
  test('the month\'s cost past the cap pauses everything, counting last month\'s cost only for each campaign\'s own limit', async () => {
    const { mock, api, ids, known, status } = await account();
    mock.spend(ids.a, 6); mock.spend(ids.b, 3);
    const r = await watchAccount({ api, known, capUsd: 8 });
    assert.equal(r.capHit, true);
    assert.deepEqual([status(ids.a), status(ids.b)], ['PAUSED', 'PAUSED']);
    assert.match(r.line, /this month's cost \$9\.00 is over the \$8\.00 cap/);
    const m2 = await account();
    m2.mock.spend(m2.ids.a, 2, { lastMonth: 9 });
    const r2 = await watchAccount({ api: m2.api, known: m2.known, capUsd: 8 });
    assert.equal(r2.capHit, false, 'last month\'s cost is not this month\'s');
    assert.deepEqual(r2.over, [m2.ids.a], 'but it counts toward the campaign\'s own approved amount');
  });
  test('a campaign the Office doesn\'t know is paused on sight; one past its end is paused on schedule; --dry-run pauses nothing', async () => {
    const { mock, api, ids, known, status } = await account();
    const stranger = mock.foreign('Made by hand', { usd: 1 });
    const dry = await watchAccount({ api, known, capUsd: 50, pause: false });
    assert.equal(status(stranger), 'ENABLED');
    assert.match(dry.line, /would pause 1 campaign: campaign \d+ "Made by hand" isn't the Office's/);
    const r = await watchAccount({ api, known, capUsd: 50 });
    assert.equal(status(stranger), 'PAUSED');
    assert.deepEqual([status(ids.a), status(ids.b)], ['ENABLED', 'ENABLED'], 'the Office\'s own are left alone');
    const later = await watchAccount({ api, known: [{ ...known[0], endsAt: Date.now() - 1000 }, known[1]], capUsd: 50 });
    assert.equal(later.alert, false);
    assert.deepEqual([status(ids.a), status(ids.b)], ['PAUSED', 'ENABLED']);
    assert.match(later.line, /paused 1 that ended/);
    assert.equal(r.alert, true);
  });
});

describe('the watchdog and the admin commands, as their own processes', () => {
  // Async, so this process keeps answering as the mocked API while the script runs.
  const node = (args, env) => new Promise((ok) => {
    const p = spawn(process.execPath, args, { cwd: new URL('..', import.meta.url).pathname, env: { PATH: process.env.PATH, ...env } });
    let stdout = '', stderr = '';
    p.stdout.on('data', (d) => { stdout += d; }); p.stderr.on('data', (d) => { stderr += d; });
    const kill = setTimeout(() => p.kill(), 60000);
    p.on('close', (status) => { clearTimeout(kill); ok({ status, stdout, stderr }); });
  });
  test('scripts/ads-watchdog.mjs and admin ads list / pause-all read the mocked API and the database, print one line, and never a secret', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'office-ads-'));
    const mock = createMockGoogleAds();
    const srv = await mock.listen();
    try {
      const api = apiFor(mock);
      const a = await createCampaign(api, plan({ requestId: 1 }));
      const b = await createCampaign(api, plan({ requestId: 2, amountUsd: 5 }));
      await api.setStatus([a.campaign, b.campaign], 'ENABLED');
      const db = openDb(dir); ensureAdSpend(db);
      const ins = (id, amount, campaign) => run(db, "INSERT INTO ad_spend (id, floor_id, project, amount, status, campaign, created_at, decided_at, ends_at) VALUES (?, ?, 'doorstep', ?, 'running', ?, ?, ?, ?)", id, id, amount, campaign, Date.now(), Date.now(), Date.now() + 3 * DAY);
      ins(1, 10, a.campaign); ins(2, 5, b.campaign);
      db.close();
      const env = { DATA_DIR: dir, ...srv.env, AD_MONTHLY_CAP_USD: '50' };
      mock.spend(campaignId(a.campaign), 3.2);
      let r = await node(['scripts/ads-watchdog.mjs'], env);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.equal(r.stdout.trim(), 'ads ok: 2 Office campaigns, $3.20 this month of the $50.00 cap');
      const listed = await node(['scripts/admin.mjs', 'ads', 'list'], env);
      assert.equal(listed.status, 0, listed.stderr);
      assert.match(listed.stdout, /This month: \$15\.00 committed of the \$50\.00 cap/);
      assert.match(listed.stdout, /#1 floor \? doorstep: running \(Google: ENABLED\), approved \$10, spent \$3\.20, campaign \d+/);
      mock.spend(campaignId(b.campaign), 5.5);
      r = await node(['scripts/ads-watchdog.mjs'], env);
      assert.equal(r.status, 1, 'an alert exits 1');
      assert.match(r.stdout.trim(), /^ads ALERT: paused 2 campaigns: campaign \d+ cost \$5\.50 of its \$5\.00$/);
      assert.deepEqual([...mock.campaigns.values()].map((c) => c.status), ['PAUSED', 'PAUSED']);
      const db2 = openDb(dir);
      assert.deepEqual(all(db2, 'SELECT status FROM ad_spend ORDER BY id').map((x) => x.status), ['paused', 'paused']);
      assert.equal(get(db2, 'SELECT spent_micros FROM ad_spend WHERE id=2').spent_micros, 5.5e6);
      run(db2, "UPDATE ad_spend SET status='running'"); db2.close();
      await api.setStatus([a.campaign], 'ENABLED');
      const stop = await node(['scripts/admin.mjs', 'ads', 'pause-all'], env);
      assert.equal(stop.status, 0, stop.stderr);
      assert.equal(stop.stdout.trim(), 'ads pause-all: paused 1 campaign on Google; 2 Office requests marked stopped');
      assert.equal(mock.campaigns.get(campaignId(a.campaign)).status, 'PAUSED');
      const off = await node(['scripts/ads-watchdog.mjs'], { DATA_DIR: dir });
      assert.deepEqual([off.status, off.stdout.trim()], [0, 'ads off: Google Ads is not set up on this server']);
      const broken = await node(['scripts/ads-watchdog.mjs'], { ...env, GOOGLE_ADS_REFRESH_TOKEN: 'a-revoked-token' });
      assert.equal(broken.status, 2);
      assert.match(broken.stdout.trim(), /^ads ERROR: Google Ads couldn't be read: Google sign-in failed/);
      for (const out of [r, listed, stop, off, broken]) assert.doesNotMatch(out.stdout + out.stderr, /mock-client-secret|mock-refresh-token|a-revoked-token|ya29\./);
    } finally { await srv.close(); rmSync(dir, { recursive: true, force: true }); }
  });
  test('secrets are scrubbed from any message that might be logged', () => {
    const cfg = { googleAds: { clientSecret: 'GOCSPX-secret-value', refreshToken: '1//0g-refresh-token-value-long-enough', developerToken: '' } };
    const out = scrub('failed with GOCSPX-secret-value and 1//0g-refresh-token-value-long-enough and ya29.a0AfB_byC-token and Bearer abc.def', cfg);
    assert.doesNotMatch(out, /GOCSPX-secret|refresh-token-value|ya29\.a0|abc\.def/);
    assert.equal(googleAdsFromConfig({ googleAds: { customerId: '1', clientId: 'x', clientSecret: '', refreshToken: 'y' } }), null, 'no secret, no client');
  });
});
