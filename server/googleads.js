// Google Ads, for Business mode's paid ads: a small REST client (API v26) and the campaign an approved AD SPEND request becomes. It all runs in
// this process: the refresh token comes from the environment, the access token it buys lives in memory only, and neither ever reaches a prompt,
// a tool result, a log line, the database or a floor. The limits that keep spending small are here as constants, so no setting can lift them:
// a campaign's total budget is the boss's approved amount and never over $25, it runs 7 whole days, it shows on Google Search only (no display,
// no search partners), and it bids Maximize Clicks with a ceiling on each click. See docs/ADS.md.

export const API_VERSION = 'v26';
export const HARD_MAX_USD = 25;
// A total budget (CUSTOM_PERIOD) runs 7 whole days, always: the real v26 API refused one over 2 days (UNKNOWN on end_date_time) and took the
// same budget over 7 (start 00:00:00, end on day 7 at 23:59:59), live, 2026-11-07. Validate-only tests refused 3 days too.
export const MAX_DAYS = 7;
const DAY = 86400000;
export const LIMITS = { headline: 30, description: 90, path: 15, keyword: 80, keywordWords: 10, headlines: [3, 15], descriptions: [2, 4], keywords: [3, 10] };

export class AdsError extends Error { constructor(code, message) { super(message); this.code = code; } }

/** The Google Ads settings in a config, or null when this server isn't set up for it. A mock counts, for tests and local runs. */
export function googleAdsFromConfig(cfg, { fetch: f, mock } = {}) {
  const g = cfg.googleAds || {};
  if (mock) return createGoogleAds({ ...mock.settings, fetch: mock.fetch, timeZone: g.timeZone });
  if (!g.customerId || !g.clientId || !g.clientSecret || !g.refreshToken) return null;
  return createGoogleAds({ ...g, fetch: f });
}

/** Google's error, short and plain: the code and what it says, never a token (Google doesn't echo one back). */
export function describeError(body, status) {
  const e = body?.error || body?.[0]?.error;
  const errs = e?.details?.flatMap((d) => d?.errors || []) || [];
  if (errs.length) return errs.slice(0, 3).map((x) => `${Object.values(x.errorCode || {})[0] || 'ERROR'}: ${String(x.message || '').slice(0, 140)}`).join('; ');
  return `${status}${e?.status ? ` ${e.status}` : ''}${e?.message ? `: ${String(e.message).slice(0, 200)}` : ''}`;
}

export function createGoogleAds({ customerId, clientId, clientSecret, refreshToken, developerToken = '', loginCustomerId = '', apiBase = 'https://googleads.googleapis.com',
  tokenUrl = 'https://oauth2.googleapis.com/token', version = API_VERSION, timeZone = 'America/New_York', fetch: f = globalThis.fetch, now = Date.now, timeoutMs = 30000 }) {
  const cid = String(customerId || '').replace(/\D/g, '');
  if (!cid) throw new AdsError('setup', 'no Google Ads customer id');
  let tok = null;
  let signingIn = null;
  async function signIn() {
    const r = await f(tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }).toString(), signal: AbortSignal.timeout(timeoutMs) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.access_token) throw new AdsError('auth', `Google sign-in failed (${r.status}${d.error ? ` ${String(d.error).slice(0, 40)}` : ''})`);
    tok = { value: d.access_token, until: now() + Math.max(60, (Number(d.expires_in) || 3600) - 120) * 1000 };
    return tok.value;
  }
  /** The access token, bought again from the refresh token shortly before it runs out. One sign-in at a time. */
  async function token() {
    if (tok && now() < tok.until) return tok.value;
    signingIn = signingIn || signIn().finally(() => { signingIn = null; });
    return signingIn;
  }
  async function call(path, body) {
    const headers = { authorization: `Bearer ${await token()}`, 'content-type': 'application/json' };
    if (developerToken) headers['developer-token'] = developerToken;
    if (loginCustomerId) headers['login-customer-id'] = String(loginCustomerId).replace(/\D/g, '');
    const r = await f(`${apiBase.replace(/\/+$/, '')}/${version}/customers/${cid}/${path}`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    const text = await r.text();
    let d = null; try { d = JSON.parse(text); } catch { /* not JSON */ }
    if (r.status === 401) tok = null;
    if (!r.ok) throw new AdsError(r.status === 401 || r.status === 403 ? 'auth' : 'api', describeError(d, r.status));
    return d || {};
  }
  const api = {
    customerId: cid, timeZone,
    rn: (kind, id) => `customers/${cid}/${kind}/${id}`,
    async search(query) {
      const out = []; let pageToken;
      do {
        const d = await call('googleAds:search', pageToken ? { query, pageToken } : { query });
        out.push(...(d.results || []));
        pageToken = d.nextPageToken;
      } while (pageToken && out.length < 5000);
      return out;
    },
    mutate: (operations, { validateOnly = false } = {}) => call('googleAds:mutate', { mutateOperations: operations, partialFailure: false, validateOnly }),
    // A pause goes through for every campaign it can change, even if one of them can't be (partialFailure); switching on is all or nothing.
    setStatus: (resourceNames, status) => resourceNames.length ? call('campaigns:mutate', { operations: resourceNames.map((resourceName) => ({ update: { resourceName, status }, updateMask: 'status' })), partialFailure: status === 'PAUSED' }) : Promise.resolve({ results: [] }),
    token,
  };
  return api;
}

// ---- the words: what Google takes, checked before anything is sent ----
const tidy = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
const EMOJI = /\p{Extended_Pictographic}/u;
const list = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\n|;/) : []).map(tidy).filter(Boolean);
const dedupe = (xs) => { const seen = new Set(); return xs.filter((x) => { const k = x.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }); };

// Google counts a wide character (Chinese, Japanese, Korean, full-width forms) as two towards an ad's limits; one over and the whole ad is TOO_LONG.
const WIDE = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/u;
export const adLength = (x) => [...String(x)].reduce((n, ch) => n + (WIDE.test(ch) ? 2 : 1), 0);
/** The Google search ad's words and keywords, as the marketer wrote them: the problems in plain words, or the cleaned-up set. */
export function checkSearchAd({ headlines, descriptions, keywords, path1, path2 } = {}) {
  const problems = [];
  const L = LIMITS;
  const hs = dedupe(list(headlines)), ds = dedupe(list(descriptions));
  const ks = dedupe(list(keywords).map((k) => k.toLowerCase().replace(/[^\p{L}\p{N}\s&'.-]+/gu, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean));
  if (hs.length < L.headlines[0] || hs.length > L.headlines[1]) problems.push(`give ${L.headlines[0]} to ${L.headlines[1]} different search headlines, not ${hs.length}`);
  for (const x of hs) if (adLength(x) > L.headline) problems.push(`search headline "${x.slice(0, 40)}" is ${adLength(x)} characters; ${L.headline} at most`);
  for (const x of hs) if (/!/.test(x)) problems.push(`search headline "${x.slice(0, 40)}" has an exclamation mark, which Google doesn't allow in headlines`);
  if (ds.length < L.descriptions[0] || ds.length > L.descriptions[1]) problems.push(`give ${L.descriptions[0]} to ${L.descriptions[1]} different search descriptions, not ${ds.length}`);
  for (const x of ds) if (adLength(x) > L.description) problems.push(`search description "${x.slice(0, 40)}…" is ${adLength(x)} characters; ${L.description} at most`);
  for (const x of [...hs, ...ds]) if (EMOJI.test(x)) problems.push(`"${x.slice(0, 40)}" has an emoji, which Google refuses`);
  if (ks.length < L.keywords[0] || ks.length > L.keywords[1]) problems.push(`give ${L.keywords[0]} to ${L.keywords[1]} different keywords, not ${ks.length}`);
  for (const k of ks) if (k.length > L.keyword || k.split(' ').length > L.keywordWords) problems.push(`keyword "${k.slice(0, 40)}" is too long: ${L.keyword} characters and ${L.keywordWords} words at most`);
  const path = (p) => tidy(p).replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, L.path);
  const p1 = path(path1), p2 = p1 ? path(path2) : '';
  return { ok: !problems.length, problems: [...new Set(problems)].slice(0, 10), headlines: hs.slice(0, L.headlines[1]), descriptions: ds.slice(0, L.descriptions[1]), keywords: ks.slice(0, L.keywords[1]), path1: p1, path2: p2 };
}

// ---- dates, in the ad account's own time zone ----
function localParts(ms, timeZone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}` };
}
const addDays = (date, n) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
/** The moment a wall-clock time in a time zone happens. */
export function zonedMs(date, time, timeZone) {
  const [y, m, d] = date.split('-').map(Number); const [hh, mm, ss] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm, ss);
  const p = localParts(guess, timeZone);
  const [y2, m2, d2] = p.date.split('-').map(Number); const [h2, i2, s2] = p.time.split(':').map(Number);
  return guess - (Date.UTC(y2, m2 - 1, d2, h2, i2, s2) - guess);
}
/** The first day of this month, in the account's time zone, as a moment. */
export const monthStartMs = (now, timeZone) => zonedMs(`${localParts(now, timeZone).date.slice(0, 8)}01`, '00:00:00', timeZone);

/** Everything one campaign will be, worked out and checked before Google hears of it. Throws AdsError('plan') with the reason. */
export function planCampaign({ requestId, tag, label = '', amountUsd, cpcCeilingUsd = 0.5, now = Date.now(), timeZone = 'America/New_York', finalUrl,
  headlines, descriptions, keywords, path1, path2, geo = [2840], language = 1000 }) {
  const amount = Number(amountUsd);
  if (!Number.isInteger(amount) || amount < 1 || amount > HARD_MAX_USD) throw new AdsError('plan', 'the amount has to be a whole number of dollars, $25 at most');
  let url;
  try { url = new URL(finalUrl); } catch { throw new AdsError('plan', 'the ad needs the live site\'s address'); }
  if (url.protocol !== 'https:' || /^(localhost|127\.|10\.|192\.168\.)/.test(url.hostname)) throw new AdsError('plan', 'the ad has to point at the live site on the public web (https)');
  const words = checkSearchAd({ headlines, descriptions, keywords, path1, path2 });
  if (!words.ok) throw new AdsError('plan', words.problems.join('; '));
  // v26 wants whole days: a start at 00:00:00 and an end at 23:59:59, 7 days of them. It takes today's date as the start (it runs from now), or
  // tomorrow's in the last minutes of a day, so the start is never in the past by the time Google reads it.
  const here = localParts(now, timeZone);
  const start = { date: here.time >= '23:45:00' ? addDays(here.date, 1) : here.date, time: '00:00:00' };
  const startText = `${start.date} ${start.time}`;
  const endText = `${addDays(start.date, MAX_DAYS - 1)} 23:59:59`;
  const startsAt = zonedMs(start.date, start.time, timeZone), endsAt = zonedMs(...endText.split(' '), timeZone);
  if (startsAt - now > DAY || endsAt - startsAt > MAX_DAYS * DAY + 3600000) throw new AdsError('plan', 'the campaign would run past 7 whole days from today');
  const ceiling = Math.max(0.1, Math.min(Number(cpcCeilingUsd) || 0.5, 2, amount));
  const name = `Office ad #${Number(requestId)} ${String(tag || '').replace(/[^a-z0-9]/gi, '').slice(0, 12)}${label ? ` · ${tidy(label).replace(/['"\\]/g, '').slice(0, 80)}` : ''}`;
  return {
    name, amountUsd: amount, totalMicros: amount * 1e6, cpcCeilingMicros: Math.round(ceiling * 100) * 10000,
    startText, endText, startsAt, endsAt, days: MAX_DAYS,
    finalUrl: url.href, headlines: words.headlines, descriptions: words.descriptions, keywords: words.keywords, path1: words.path1, path2: words.path2,
    geo: geo.map(Number).filter((g) => Number.isInteger(g) && g > 0), language: Number(language) || 1000,
  };
}

/** One atomic request: budget, campaign (PAUSED), US and English targeting, the ad group, its keywords and the responsive search ad. All or nothing. */
export function campaignOperations(api, plan) {
  const budget = api.rn('campaignBudgets', -1), campaign = api.rn('campaigns', -2), adGroup = api.rn('adGroups', -3);
  const rsa = { headlines: plan.headlines.map((text) => ({ text })), descriptions: plan.descriptions.map((text) => ({ text })), ...(plan.path1 ? { path1: plan.path1 } : {}), ...(plan.path1 && plan.path2 ? { path2: plan.path2 } : {}) };
  return [
    { campaignBudgetOperation: { create: { resourceName: budget, name: `${plan.name} budget`, period: 'CUSTOM_PERIOD', totalAmountMicros: String(plan.totalMicros), explicitlyShared: false } } },
    { campaignOperation: { create: {
      resourceName: campaign, name: plan.name, status: 'PAUSED', advertisingChannelType: 'SEARCH', campaignBudget: budget,
      targetSpend: { cpcBidCeilingMicros: String(plan.cpcCeilingMicros) },
      networkSettings: { targetGoogleSearch: true, targetSearchNetwork: false, targetContentNetwork: false },
      containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
      startDateTime: plan.startText, endDateTime: plan.endText,
    } } },
    ...plan.geo.map((g) => ({ campaignCriterionOperation: { create: { campaign, location: { geoTargetConstant: `geoTargetConstants/${g}` } } } })),
    { campaignCriterionOperation: { create: { campaign, language: { languageConstant: `languageConstants/${plan.language}` } } } },
    { adGroupOperation: { create: { resourceName: adGroup, name: `${plan.name} ads`, campaign, status: 'ENABLED', type: 'SEARCH_STANDARD', cpcBidMicros: String(plan.cpcCeilingMicros) } } },
    ...plan.keywords.map((text) => ({ adGroupCriterionOperation: { create: { adGroup, status: 'ENABLED', keyword: { text, matchType: 'PHRASE' } } } })),
    { adGroupAdOperation: { create: { adGroup, status: 'ENABLED', ad: { finalUrls: [plan.finalUrl], responsiveSearchAd: rsa } } } },
  ];
}

const quote = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
/** The campaign made for this request already, if an earlier try got that far before it was cut off. */
export async function findCampaign(api, name) {
  const rows = await api.search(`SELECT campaign.resource_name, campaign.status, campaign.campaign_budget FROM campaign WHERE campaign.name = '${quote(name)}' AND campaign.status != 'REMOVED'`);
  const c = rows[0]?.campaign;
  return c ? { campaign: c.resourceName, budget: c.campaignBudget || '', status: c.status } : null;
}
/** Makes the campaign, PAUSED, unless it is already there. Says what it made. */
export async function createCampaign(api, plan) {
  const had = await findCampaign(api, plan.name);
  if (had) return { ...had, adopted: true };
  const r = await api.mutate(campaignOperations(api, plan));
  const res = r.mutateOperationResponses || [];
  const pick = (k) => res.map((x) => x?.[k]?.resourceName).find(Boolean) || '';
  const out = { campaign: pick('campaignResult'), budget: pick('campaignBudgetResult'), adGroup: pick('adGroupResult'), status: 'PAUSED' };
  if (!out.campaign) throw new AdsError('api', 'Google answered without a campaign');
  return out;
}
export const campaignId = (rn) => String(rn || '').split('/').pop();
/** What a pause couldn't change, in a few words, or ''. */
export const pauseTrouble = (resp) => (resp?.partialFailureError ? describeError({ error: resp.partialFailureError }, 'partial').slice(0, 200) || 'some campaigns could not be paused' : '');
/** The account's own currency and time zone: budgets are in its currency, and Google reads dates in its zone. */
export async function accountInfo(api) {
  const c = (await api.search('SELECT customer.currency_code, customer.time_zone FROM customer'))[0]?.customer || {};
  return { currency: c.currencyCode || '', timeZone: c.timeZone || '' };
}
const micros = (v) => Number(v || 0);
export const usd = (m) => `$${(Number(m || 0) / 1e6).toFixed(2)}`;

/** Clicks, views and cost so far for some campaigns, by campaign id. */
export async function campaignStats(api, ids) {
  const want = [...new Set(ids.map(String).filter((x) => /^\d+$/.test(x)))];
  if (!want.length) return new Map();
  const rows = await api.search(`SELECT campaign.id, campaign.status, metrics.cost_micros, metrics.impressions, metrics.clicks FROM campaign WHERE campaign.id IN (${want.join(',')})`);
  return new Map(rows.map((r) => [String(r.campaign?.id), { status: r.campaign?.status, costMicros: micros(r.metrics?.costMicros), impressions: Number(r.metrics?.impressions || 0), clicks: Number(r.metrics?.clicks || 0) }]));
}

/**
 * The spend watchdog's reading of the account, and what it pauses. known: the Office's own campaigns, [{ id, approvedUsd, endsAt, label }].
 * Every enabled campaign in the account is paused at once if any Office campaign has cost more than its approved amount, or the account's cost
 * this month is over the cap. A campaign the Office doesn't know is always paused, and one past its end date is paused on schedule.
 */
export async function watchAccount({ api, known: knownIn, capUsd, now = Date.now(), pause = true }) {
  const live = await api.search("SELECT campaign.id, campaign.name, campaign.status, campaign.resource_name FROM campaign WHERE campaign.status != 'REMOVED'");
  const life = await api.search('SELECT campaign.id, metrics.cost_micros FROM campaign');
  const month = await api.search('SELECT campaign.id, metrics.cost_micros FROM campaign WHERE segments.date DURING THIS_MONTH');
  // Read after Google, so a campaign switched on while it was reading is already on the list rather than taken for a stranger.
  const known = typeof knownIn === 'function' ? knownIn() : knownIn;
  const byId = new Map(known.map((k) => [String(k.id), k]));
  const lifeCost = new Map(); for (const r of life) lifeCost.set(String(r.campaign?.id), (lifeCost.get(String(r.campaign?.id)) || 0) + micros(r.metrics?.costMicros));
  const monthMicros = month.reduce((n, r) => n + micros(r.metrics?.costMicros), 0);
  const capMicros = Math.max(0, Number(capUsd) || 0) * 1e6;
  const campaigns = live.map((r) => ({ id: String(r.campaign?.id), name: String(r.campaign?.name || ''), status: r.campaign?.status, rn: r.campaign?.resourceName || api.rn('campaigns', r.campaign?.id) }));
  const enabled = campaigns.filter((c) => c.status === 'ENABLED');
  const on = new Set(enabled.map((c) => c.id));
  // Over its approved amount and still on. One that went over and was paused already stays paused and trips nothing more.
  const over = known.filter((k) => on.has(String(k.id)) && (lifeCost.get(String(k.id)) || 0) > Number(k.approvedUsd) * 1e6).map((k) => ({ ...k, costMicros: lifeCost.get(String(k.id)) }));
  const capHit = monthMicros > capMicros;
  const unknown = enabled.filter((c) => !byId.has(c.id));
  // The Office's own, on at Google though its request is closed or stopped: switched on by hand, or a pause that never landed.
  const stray = enabled.filter((c) => byId.has(c.id) && byId.get(c.id).live === false);
  const ended = enabled.filter((c) => byId.has(c.id) && byId.get(c.id).live !== false && byId.get(c.id).endsAt && byId.get(c.id).endsAt <= now);
  const toPause = over.length || capHit ? enabled : [...unknown, ...stray, ...ended];
  let trouble = '';
  if (pause && toPause.length) trouble = pauseTrouble(await api.setStatus(toPause.map((c) => c.rn), 'PAUSED'));
  const alert = !!(over.length || capHit || unknown.length || stray.length || trouble);
  const why = [
    ...over.map((k) => `campaign ${k.id} cost ${usd(k.costMicros)} of its ${usd(Number(k.approvedUsd) * 1e6)}`),
    capHit ? `this month's cost ${usd(monthMicros)} is over the ${usd(capMicros)} cap` : '',
    ...unknown.map((c) => `campaign ${c.id} "${c.name.slice(0, 40)}" isn't the Office's`),
    ...stray.map((c) => `campaign ${c.id} was on though its request is closed`),
    trouble ? `some couldn't be paused: ${trouble}` : '',
  ].filter(Boolean);
  const officeCount = campaigns.filter((c) => byId.has(c.id)).length;
  const line = alert
    ? `ads ALERT: ${pause ? 'paused' : 'would pause'} ${toPause.length} campaign${toPause.length === 1 ? '' : 's'}: ${why.join('; ')}`
    : `ads ok: ${officeCount} Office campaign${officeCount === 1 ? '' : 's'}, ${usd(monthMicros)} this month of the ${usd(capMicros)} cap${ended.length ? `; paused ${ended.length} that ended` : ''}`;
  return { alert, line, paused: pause ? toPause.map((c) => c.id) : [], over: over.map((k) => String(k.id)), unknown: unknown.map((c) => c.id), stray: stray.map((c) => c.id), ended: ended.map((c) => c.id), capHit, monthMicros, lifeCost, campaigns, known, trouble };
}
