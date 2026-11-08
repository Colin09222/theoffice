// A stand-in for the Google Ads API (v26 over REST) and Google's token endpoint, for tests and mock mode. Nothing here reaches Google. It keeps
// campaigns in memory and refuses what the real API refused in the live test on 2026-11-07: startDate/endDate (v26 wants startDateTime and
// endDateTime), an end time that isn't the end of a day, a total budget on a two-day run, and over-long ad text. Spend is whatever a test
// says it is (spend()), and campaigns made outside the Office can be added (foreign()) to see the watchdog pause them.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { zonedMs } from './googleads.js';

const SETTINGS = { customerId: '1234567890', clientId: 'mock-client.apps.googleusercontent.com', clientSecret: 'mock-client-secret', refreshToken: 'mock-refresh-token', apiBase: 'https://googleads.mock', tokenUrl: 'https://oauth2.mock/token' };

export function createMockGoogleAds({ now = Date.now, timeZone = 'America/New_York', version = 'v26' } = {}) {
  const settings = { ...SETTINGS };
  const tokens = new Map();         // access token -> expiry
  const calls = [];                 // { path, body }, never a token
  let nextId = 1000001;
  const budgets = new Map(), campaigns = new Map(), adGroups = new Map(), criteria = [], keywords = [], ads = [];
  let failNext = null;
  const cid = () => settings.customerId;
  const rn = (kind, id) => `customers/${cid()}/${kind}/${id}`;
  const idOf = (r) => String(r || '').split('/').pop();

  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const adsError = (errors, status = 400) => json(status, { error: { code: status, message: 'Request contains an invalid argument.', status: 'INVALID_ARGUMENT',
    details: [{ '@type': `type.googleapis.com/google.ads.googleads.${version}.errors.GoogleAdsFailure`, errors, requestId: randomBytes(8).toString('hex') }] } });
  const err = (code, message, path = []) => ({ errorCode: code, message, location: { fieldPathElements: path.map((fieldName) => (typeof fieldName === 'number' ? { index: fieldName } : { fieldName })) } });

  function token(body) {
    const p = new URLSearchParams(body);
    if (p.get('grant_type') !== 'refresh_token' || p.get('client_id') !== settings.clientId || p.get('client_secret') !== settings.clientSecret) return json(401, { error: 'invalid_client' });
    if (p.get('refresh_token') !== settings.refreshToken) return json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
    const t = `ya29.mock-${randomBytes(12).toString('hex')}`;
    tokens.set(t, now() + 3599 * 1000);
    mock.signIns++;
    return json(200, { access_token: t, expires_in: 3599, token_type: 'Bearer', scope: 'https://www.googleapis.com/auth/adwords' });
  }

  // ---- mutate: check every operation first, then apply them all, or nothing ----
  function checkOps(ops) {
    const errors = [];
    const temp = new Map();       // temporary resource name -> kind
    const budgetOf = (r) => budgets.get(idOf(r)) || (temp.get(r)?.kind === 'budget' ? temp.get(r).body : null);
    const usedBudgets = new Set([...campaigns.values()].filter((c) => c.status !== 'REMOVED').map((c) => c.campaignBudget));
    ops.forEach((op, i) => {
      const [kind, inner] = Object.entries(op || {})[0] || [];
      const c = inner?.create;
      const at = (f) => ['mutate_operations', i, kind, 'create', ...f];
      if (!c) { errors.push(err({ requestError: 'BAD_RESOURCE_ID' }, 'Only create is supported here.', at([]))); return; }
      if (kind === 'campaignBudgetOperation') {
        if (!c.name || [...budgets.values()].some((b) => b.name === c.name)) errors.push(err({ campaignBudgetError: 'DUPLICATE_NAME' }, 'A budget with this name already exists.', at(['name'])));
        if (c.period === 'CUSTOM_PERIOD') {
          if (!(Number(c.totalAmountMicros) > 0) || Number(c.totalAmountMicros) % 10000) errors.push(err({ campaignBudgetError: 'INVALID_TOTAL_AMOUNT' }, 'A custom period budget needs a total amount.', at(['total_amount_micros'])));
          if (c.amountMicros !== undefined) errors.push(err({ campaignBudgetError: 'AMOUNT_AND_TOTAL_AMOUNT_SET' }, 'Only one of amount and total amount can be set.', at(['amount_micros'])));
          if (c.explicitlyShared) errors.push(err({ campaignBudgetError: 'CANNOT_SHARE_TOTAL_BUDGET' }, 'A total budget cannot be shared.', at(['explicitly_shared'])));
        } else if (!(Number(c.amountMicros) > 0)) errors.push(err({ campaignBudgetError: 'MISSING_AMOUNT' }, 'The budget needs an amount.', at(['amount_micros'])));
        temp.set(c.resourceName, { kind: 'budget', body: c });
      } else if (kind === 'campaignOperation') {
        for (const bad of ['startDate', 'endDate']) if (bad in c) return void errors.push({ invalidJson: `Unknown name "${bad}" at 'mutate_operations[${i}].campaign_operation.create': Cannot find field.` });
        if (!c.name || [...campaigns.values()].some((x) => x.name === c.name && x.status !== 'REMOVED')) errors.push(err({ campaignError: 'DUPLICATE_CAMPAIGN_NAME' }, 'A campaign with this name already exists.', at(['name'])));
        if (!['ENABLED', 'PAUSED'].includes(c.status)) errors.push(err({ fieldError: 'REQUIRED' }, 'The status is required.', at(['status'])));
        if (c.advertisingChannelType !== 'SEARCH') errors.push(err({ campaignError: 'INVALID_CHANNEL_TYPE' }, 'Search only here.', at(['advertising_channel_type'])));
        if (!c.containsEuPoliticalAdvertising) errors.push(err({ fieldError: 'REQUIRED' }, 'The required field was not present.', at(['contains_eu_political_advertising'])));
        if (!c.manualCpc && !c.targetSpend && !c.maximizeConversions) errors.push(err({ biddingError: 'BIDDING_STRATEGY_NOT_SUPPORTED' }, 'A bidding strategy is required.', at([])));
        const b = budgetOf(c.campaignBudget);
        if (!b) errors.push(err({ campaignBudgetError: 'CAMPAIGN_BUDGET_REMOVED' }, 'The requested campaign budget no longer exists.', at(['campaign_budget'])));
        else if (usedBudgets.has(c.campaignBudget)) errors.push(err({ campaignBudgetError: 'CAMPAIGN_BUDGET_IN_USE' }, 'This budget is already used by another campaign.', at(['campaign_budget'])));
        const fmt = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
        if (c.endDateTime !== undefined && (!fmt.test(c.endDateTime) || !c.endDateTime.endsWith('23:59:59'))) errors.push(err({ dateError: 'DATE_RANGE_ERROR_END_TIME_MUST_BE_THE_END_OF_A_DAY' }, 'The end time must be the end of a day.', at(['end_date_time'])));
        if (c.startDateTime !== undefined && (!fmt.test(c.startDateTime) || zonedMs(...c.startDateTime.split(' '), timeZone) < now() - 60000)) errors.push(err({ dateError: 'START_DATE_TIME_IN_THE_PAST' }, 'The start time is in the past.', at(['start_date_time'])));
        if (b?.period === 'CUSTOM_PERIOD') {
          if (!c.startDateTime || !c.endDateTime) errors.push(err({ campaignError: 'MISSING_DATES_FOR_TOTAL_BUDGET' }, 'A total budget needs a start and an end.', at(['end_date_time'])));
          else {
            const days = (zonedMs(...c.endDateTime.split(' '), timeZone) - zonedMs(...c.startDateTime.split(' '), timeZone)) / 86400000;
            if (days < 2 || days > 90) errors.push(err({ requestError: 'UNKNOWN' }, 'The error code is not in this version.', at(['end_date_time'])));
          }
        }
        temp.set(c.resourceName, { kind: 'campaign', body: c });
      } else if (kind === 'campaignCriterionOperation') {
        if (!temp.has(c.campaign) && !campaigns.has(idOf(c.campaign))) errors.push(err({ mutateError: 'RESOURCE_NOT_FOUND' }, 'Resource was not found.', at(['campaign'])));
        if (!c.location?.geoTargetConstant && !c.language?.languageConstant) errors.push(err({ criterionError: 'CRITERION_TYPE_NOT_SUPPORTED' }, 'Location or language only here.', at([])));
      } else if (kind === 'adGroupOperation') {
        if (!temp.has(c.campaign) && !campaigns.has(idOf(c.campaign))) errors.push(err({ mutateError: 'RESOURCE_NOT_FOUND' }, 'Resource was not found.', at(['campaign'])));
        if (c.type !== 'SEARCH_STANDARD') errors.push(err({ adGroupError: 'AD_GROUP_TYPE_NOT_VALID_FOR_ADVERTISING_CHANNEL_TYPE' }, 'Wrong ad group type.', at(['type'])));
        temp.set(c.resourceName, { kind: 'adGroup', body: c });
      } else if (kind === 'adGroupCriterionOperation') {
        if (!temp.has(c.adGroup)) errors.push(err({ mutateError: 'RESOURCE_NOT_FOUND' }, 'Resource was not found.', at(['ad_group'])));
        const t = String(c.keyword?.text || '');
        if (!t || t.length > 80 || t.split(/\s+/).length > 10) errors.push(err({ criterionError: 'KEYWORD_TEXT_TOO_LONG' }, 'Keyword text is too long.', at(['keyword', 'text'])));
        if (!['EXACT', 'PHRASE', 'BROAD'].includes(c.keyword?.matchType)) errors.push(err({ fieldError: 'REQUIRED' }, 'The match type is required.', at(['keyword', 'match_type'])));
      } else if (kind === 'adGroupAdOperation') {
        if (!temp.has(c.adGroup)) errors.push(err({ mutateError: 'RESOURCE_NOT_FOUND' }, 'Resource was not found.', at(['ad_group'])));
        const ad = c.ad || {}; const rsa = ad.responsiveSearchAd || {};
        if (!Array.isArray(ad.finalUrls) || !/^https:\/\//.test(ad.finalUrls[0] || '')) errors.push(err({ adError: 'FINAL_URL_REQUIRED' }, 'A final URL is required.', at(['ad', 'final_urls'])));
        const hs = rsa.headlines || [], ds = rsa.descriptions || [];
        if (hs.length < 3 || hs.length > 15) errors.push(err({ adError: 'TOO_FEW_HEADLINES' }, 'Between 3 and 15 headlines.', at(['ad', 'responsive_search_ad', 'headlines'])));
        if (ds.length < 2 || ds.length > 4) errors.push(err({ adError: 'TOO_FEW_DESCRIPTIONS' }, 'Between 2 and 4 descriptions.', at(['ad', 'responsive_search_ad', 'descriptions'])));
        hs.forEach((x, j) => { if (String(x.text).length > 30) errors.push(err({ stringLengthError: 'TOO_LONG' }, 'Too long.', at(['ad', 'responsive_search_ad', 'headlines', j, 'text']))); });
        ds.forEach((x, j) => { if (String(x.text).length > 90) errors.push(err({ stringLengthError: 'TOO_LONG' }, 'Too long.', at(['ad', 'responsive_search_ad', 'descriptions', j, 'text']))); });
        for (const k of ['path1', 'path2']) if (rsa[k] && rsa[k].length > 15) errors.push(err({ stringLengthError: 'TOO_LONG' }, 'Too long.', at(['ad', 'responsive_search_ad', k])));
      } else errors.push(err({ requestError: 'UNKNOWN' }, `${kind} isn't handled by the mock.`, at([])));
    });
    return errors;
  }
  function mutate(body) {
    const ops = Array.isArray(body?.mutateOperations) ? body.mutateOperations : [];
    if (failNext) { const f = failNext; failNext = null; return adsError([err(f.code, f.message, ['mutate_operations', 0])]); }
    const errors = checkOps(ops);
    const bad = errors.find((e) => e.invalidJson);
    if (bad) return json(400, { error: { code: 400, message: `Invalid JSON payload received. ${bad.invalidJson}`, status: 'INVALID_ARGUMENT' } });
    if (errors.length) return adsError(errors);
    if (body.validateOnly) return json(200, {});
    const real = new Map();
    const swap = (r) => real.get(r) || r;
    const responses = ops.map((op) => {
      const [kind, inner] = Object.entries(op)[0]; const c = { ...inner.create };
      const id = String(nextId++);
      if (kind === 'campaignBudgetOperation') { real.set(c.resourceName, rn('campaignBudgets', id)); budgets.set(id, { ...c, id, resourceName: rn('campaignBudgets', id) }); return { campaignBudgetResult: { resourceName: rn('campaignBudgets', id) } }; }
      if (kind === 'campaignOperation') { real.set(c.resourceName, rn('campaigns', id)); campaigns.set(id, { ...c, id, resourceName: rn('campaigns', id), campaignBudget: swap(c.campaignBudget), costMicros: 0, monthCostMicros: 0, impressions: 0, clicks: 0 }); return { campaignResult: { resourceName: rn('campaigns', id) } }; }
      if (kind === 'campaignCriterionOperation') { criteria.push({ ...c, campaign: swap(c.campaign) }); return { campaignCriterionResult: { resourceName: `customers/${cid()}/campaignCriteria/${idOf(swap(c.campaign))}~${id}` } }; }
      if (kind === 'adGroupOperation') { real.set(c.resourceName, rn('adGroups', id)); adGroups.set(id, { ...c, id, resourceName: rn('adGroups', id), campaign: swap(c.campaign) }); return { adGroupResult: { resourceName: rn('adGroups', id) } }; }
      if (kind === 'adGroupCriterionOperation') { keywords.push({ ...c, adGroup: swap(c.adGroup) }); return { adGroupCriterionResult: { resourceName: `customers/${cid()}/adGroupCriteria/${idOf(swap(c.adGroup))}~${id}` } }; }
      ads.push({ ...c, adGroup: swap(c.adGroup) }); return { adGroupAdResult: { resourceName: `customers/${cid()}/adGroupAds/${idOf(swap(c.adGroup))}~${id}` } };
    });
    return json(200, { mutateOperationResponses: responses });
  }
  function setStatus(body) {
    const ops = Array.isArray(body?.operations) ? body.operations : [];
    const errors = [];
    ops.forEach((op, i) => {
      const c = campaigns.get(idOf(op?.update?.resourceName));
      if (!c) errors.push(err({ mutateError: 'RESOURCE_NOT_FOUND' }, 'Resource was not found.', ['operations', i, 'update']));
      else if (op.updateMask !== 'status' || !['ENABLED', 'PAUSED', 'REMOVED'].includes(op.update.status)) errors.push(err({ fieldMaskError: 'FIELD_NOT_FOUND' }, 'Only status here.', ['operations', i]));
    });
    if (errors.length) return adsError(errors);
    for (const op of ops) campaigns.get(idOf(op.update.resourceName)).status = op.update.status;
    return json(200, { results: ops.map((op) => ({ resourceName: op.update.resourceName })) });
  }

  // ---- search: the handful of GAQL queries the Office sends, read properly; anything else is refused ----
  function search(body) {
    const q = String(body?.query || '').replace(/\s+/g, ' ').trim();
    const m = q.match(/^SELECT (.+?) FROM campaign(?: WHERE (.+))?$/);
    if (!m) return adsError([err({ queryError: 'UNRECOGNIZED_FIELD' }, `The mock doesn't read: ${q.slice(0, 80)}`, ['query'])]);
    const fields = m[1].split(',').map((s) => s.trim());
    const conds = m[2] ? m[2].split(/ AND /) : [];
    let month = false;
    let rows = [...campaigns.values()];
    for (const c of conds) {
      let x;
      if ((x = c.match(/^campaign\.name = '((?:[^'\\]|\\.)*)'$/))) { const v = x[1].replace(/\\(.)/g, '$1'); rows = rows.filter((r) => r.name === v); }
      else if ((x = c.match(/^campaign\.status != '([A-Z]+)'$/))) rows = rows.filter((r) => r.status !== x[1]);
      else if ((x = c.match(/^campaign\.id IN \(([\d, ]+)\)$/))) { const ids = new Set(x[1].split(',').map((s) => s.trim())); rows = rows.filter((r) => ids.has(r.id)); }
      else if (c === 'segments.date DURING THIS_MONTH') month = true;
      else return adsError([err({ queryError: 'UNEXPECTED_INPUT' }, `The mock doesn't read: ${c}`, ['query'])]);
    }
    const metric = fields.some((f) => f.startsWith('metrics.'));
    if (metric && month) rows = rows.filter((r) => r.monthCostMicros > 0 || r.impressions > 0);   // like Google: a date-segmented query leaves out empty rows
    const pickField = (r, f) => ({
      'campaign.id': ['campaign', 'id', r.id], 'campaign.name': ['campaign', 'name', r.name], 'campaign.status': ['campaign', 'status', r.status],
      'campaign.resource_name': ['campaign', 'resourceName', r.resourceName], 'campaign.campaign_budget': ['campaign', 'campaignBudget', r.campaignBudget],
      'metrics.cost_micros': ['metrics', 'costMicros', String(month ? r.monthCostMicros : r.costMicros)], 'metrics.impressions': ['metrics', 'impressions', String(r.impressions)], 'metrics.clicks': ['metrics', 'clicks', String(r.clicks)],
    })[f];
    for (const f of fields) if (!pickField(rows[0] || { }, f)) return adsError([err({ queryError: 'UNRECOGNIZED_FIELD' }, `Unrecognized field: ${f}`, ['query'])]);
    const results = rows.map((r) => { const o = {}; for (const f of fields) { const [a, b, v] = pickField(r, f); (o[a] = o[a] || {})[b] = v; } if (!o.campaign) o.campaign = { resourceName: r.resourceName }; else o.campaign.resourceName = r.resourceName; return o; });
    return json(200, { results, fieldMask: fields.map((f) => f.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase())).join(',') });
  }

  async function fetchMock(url, init = {}) {
    const u = new URL(url);
    const body = typeof init.body === 'string' ? init.body : init.body ? String(init.body) : '';
    if (`${u.origin}${u.pathname}` === settings.tokenUrl) return token(body);
    const auth = String(init.headers?.authorization || init.headers?.Authorization || '').replace(/^Bearer /, '');
    if (!tokens.has(auth) || tokens.get(auth) < now()) return json(401, { error: { code: 401, message: 'Request is missing required authentication credential.', status: 'UNAUTHENTICATED' } });
    const prefix = `/${version}/customers/${cid()}/`;
    if (!u.pathname.startsWith(prefix)) return json(404, { error: { code: 404, message: 'Not found', status: 'NOT_FOUND' } });
    let parsed = {}; try { parsed = JSON.parse(body || '{}'); } catch { return json(400, { error: { code: 400, message: 'Invalid JSON payload received.', status: 'INVALID_ARGUMENT' } }); }
    const path = u.pathname.slice(prefix.length);
    calls.push({ path, body: parsed, developerToken: !!init.headers?.['developer-token'] });
    if (path === 'googleAds:mutate') return mutate(parsed);
    if (path === 'googleAds:search') return search(parsed);
    if (path === 'campaigns:mutate') return setStatus(parsed);
    return json(404, { error: { code: 404, message: 'Not found', status: 'NOT_FOUND' } });
  }

  const mock = {
    settings, calls, signIns: 0, fetch: fetchMock, budgets, campaigns, adGroups, criteria, keywords, ads,
    /** What a campaign has cost: all of it this month unless lastMonth is said. */
    spend(id, usd, { lastMonth = 0, impressions = 0, clicks = 0 } = {}) {
      const c = campaigns.get(String(id)); if (!c) throw new Error(`no campaign ${id}`);
      c.costMicros = Math.round((usd + lastMonth) * 1e6); c.monthCostMicros = Math.round(usd * 1e6); c.impressions = impressions; c.clicks = clicks;
    },
    /** A campaign somebody made by hand in the same account. */
    foreign(name, { status = 'ENABLED', usd = 0 } = {}) {
      const id = String(nextId++);
      campaigns.set(id, { id, name, status, resourceName: rn('campaigns', id), campaignBudget: '', costMicros: Math.round(usd * 1e6), monthCostMicros: Math.round(usd * 1e6), impressions: 0, clicks: 0 });
      return id;
    },
    failNextMutate(code = { campaignError: 'CANNOT_SET_DATE_TO_PAST' }, message = 'Mock refusal.') { failNext = { code, message }; },
    expireTokens() { for (const k of tokens.keys()) tokens.set(k, 0); },
    /** The same API on a local port, for a script run as its own process. */
    async listen() {
      const server = createServer(async (req, res) => {
        const chunks = []; for await (const ch of req) chunks.push(ch);
        const r = await fetchMock(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString() });
        res.writeHead(r.status, { 'content-type': 'application/json' }); res.end(await r.text());
      });
      await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
      const base = `http://127.0.0.1:${server.address().port}`;
      settings.apiBase = base; settings.tokenUrl = `${base}/token`;
      return { base, env: { GOOGLE_ADS_CUSTOMER_ID: settings.customerId, GOOGLE_ADS_CLIENT_ID: settings.clientId, GOOGLE_ADS_CLIENT_SECRET: settings.clientSecret, GOOGLE_ADS_REFRESH_TOKEN: settings.refreshToken, GOOGLE_ADS_API_BASE: base, GOOGLE_ADS_TOKEN_URL: `${base}/token` }, close: () => new Promise((ok) => server.close(ok)) };
    },
  };
  return mock;
}
