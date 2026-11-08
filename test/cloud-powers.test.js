// office.ai, office.fetch and office.scrape: who may call them, every limit, the ledger, the kill switches, the SSRF list, robots.txt, redirects,
// and that no key, model name or money ever reaches a response. No real AI calls and no real outside fetches: a stand-in model and a server on this machine.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { get, all, run } from '../server/db.js';
import { isBlockedIp } from '../server/safefetch.js';
import { createMockClient } from '../server/mock.js';
import { ProviderError } from '../server/llm.js';
import { loadModels } from '../server/config.js';
import { platformDocs } from '../server/prompts.js';
import { parseRobots, robotsAllows } from '../server/cloud/robots.js';
import { scrapeHtml, decodeEntities } from '../server/cloud/scrape.js';
import { USER_AGENT } from '../server/cloud/web.js';
import { boot, claim, adminClient, sleep } from './helpers.js';
import { BASE, publish, cloud, hit } from './cloud-helpers.js';

const SECRET = 'sk-ant-api03-this-is-a-secret-test-key';
const LOTS = [1e6, 60000], LOTS_DAY = [1e7, 86400000];
const ROOMY = { all: LOTS, project: LOTS, ip: LOTS, write: LOTS, aiVisitor: LOTS, aiVisitorDay: LOTS_DAY, aiProject: LOTS, webVisitor: LOTS, webVisitorDay: LOTS_DAY, webProject: LOTS };
const CLEAN = (s) => { assert.doesNotMatch(s, /sk-ant|Bearer |\$\s?\d|\busd\b|claude|haiku|sonnet|\bcost\b|\bprice\b/i); assert.ok(!s.includes(SECRET)); };

async function setup(overrides = {}, deps = {}) {
  const t = await boot({ appsBaseDomain: BASE, appsScheme: 'https', publicOrigin: 'https://main.test.example', cloudRateScale: 1, anthropicKey: SECRET, ...overrides, cloudRates: { ...ROOMY, ...(overrides.cloudRates || {}) } }, deps);
  t.cfg.publicOrigin = '';
  const boss = await claim(t, 'Power Co');
  const floor = get(t.db, 'SELECT * FROM floors WHERE slug=?', boss.slug);
  const host = publish(t, floor, 'app');
  const powers = t.app.cloud.powers;
  const call = (path) => (body, opts) => cloud(t, opts?.host || host, 'POST', path, { body, ...opts });
  return { t, boss, floor, host, powers, ai: call('ai/chat'), fetchPage: (url, opts) => call('fetch')({ url }, opts), scrape: (url, opts) => call('scrape')({ url }, opts) };
}
function fakeModel(handler) {
  const mock = createMockClient({ mockDelayMs: 2 });
  const calls = [];
  return { calls, chat(a) { if (a.meta?.kind !== 'app_ai') return mock.chat(a); calls.push(a); return Promise.resolve().then(() => handler(a, calls.length)); } };
}
const reply = (content = 'hello there', prompt = 20, completion = 10, cost = 0.001) => ({ content, toolCalls: [], finish: 'stop', usage: { prompt, completion, cost, real: true } });
const ledger = (t, floorId) => all(t.db, "SELECT * FROM ledger WHERE floor_id=? AND kind='app_ai'", floorId);

describe('office.ai', () => {
  test('answers the project\'s own page and goes on the floor\'s ledger, with no key, model name or money in the reply', async () => {
    const m = fakeModel(() => reply('A nice welcome.', 120, 30, 0.002));
    const s = await setup({}, { llm: m });
    try {
      const before = s.t.app.engine.budget.spent('anthropic');
      const r = await s.ai({ prompt: 'Say hello', system: 'Be brief.', maxTokens: 100 });
      assert.equal(r.status, 200, r.text);
      assert.equal(r.json.text, 'A nice welcome.');
      assert.equal(r.json.model, 'fast');
      assert.equal(r.json.tokens, 150);
      CLEAN(r.text);
      const a = m.calls[0];
      assert.equal(a.provider, 'anthropic'); assert.equal(a.model, 'claude-haiku-5-5'); assert.equal(a.thinking, 'off'); assert.deepEqual(a.tools, []);
      assert.deepEqual(a.messages, [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'Say hello' }]);
      const rows = ledger(s.t, s.floor.id);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].provider, 'anthropic'); assert.equal(rows[0].model, 'claude-haiku-5-5'); assert.equal(rows[0].prompt_tokens, 120); assert.equal(rows[0].completion_tokens, 30); assert.equal(rows[0].cost_usd, 0.002);
      assert.ok(s.t.app.engine.budget.spent('anthropic') - before >= 0.002 - 1e-9, 'counts toward the building\'s Anthropic budget');
      assert.equal(get(s.t.db, 'SELECT COUNT(*) n FROM budget_holds').n, 0, 'the hold is released');
      assert.equal(s.powers.counts(s.floor.id, 'app').ai_fast, 150);
    } finally { await s.t.close(); }
  });

  test('the mock works in mock mode and never needs a key', async () => {
    const s = await setup({ anthropicKey: '' });
    try {
      const r = await s.ai({ prompt: 'Write a poem about soup' });
      assert.equal(r.status, 200, r.text);
      assert.match(r.json.text, /Mock AI reply to: Write a poem about soup/);
      assert.equal(ledger(s.t, s.floor.id).length, 1);
    } finally { await s.t.close(); }
  });

  test('only the project\'s own pages may call it', async () => {
    const m = fakeModel(() => reply());
    const s = await setup({}, { llm: m });
    try {
      const body = { prompt: 'hi' };
      const sibling = publish(s.t, s.floor, 'sibling');
      for (const [origin, label] of [['https://evil.example', 'another site'], [`https://${sibling}`, 'a sibling project'], ['null', 'a sandboxed frame'], [`http://${s.host}`, 'the wrong scheme']]) {
        const r = await s.ai(body, { origin });
        assert.equal(r.status, 403, label); assert.equal(r.json.error, 'bad_origin', label); assert.equal(r.headers['access-control-allow-origin'], undefined, label);
      }
      const noOrigin = await cloud(s.t, s.host, 'POST', 'ai/chat', { body, origin: null });
      assert.equal(noOrigin.status, 403); assert.equal(noOrigin.json.error, 'bad_origin');
      const foreignPreflight = await cloud(s.t, s.host, 'OPTIONS', 'ai/chat', { origin: 'https://evil.example' });
      assert.equal(foreignPreflight.status, 403);
      assert.equal((await cloud(s.t, s.host, 'GET', 'ai/chat', {})).status, 404, 'POST only');
      assert.equal(m.calls.length, 0);
      const own = await s.ai(body);
      assert.equal(own.status, 200); assert.equal(own.headers['access-control-allow-origin'], `https://${s.host}`);
    } finally { await s.t.close(); }
  });

  test('fast and smart map to the two configured models; anything else, including a real model id, is refused', async () => {
    const m = fakeModel(() => reply());
    const s = await setup({}, { llm: m });
    try {
      assert.equal((await s.ai({ prompt: 'a' })).status, 200);
      assert.equal((await s.ai({ prompt: 'a', model: 'smart' })).json.model, 'smart');
      assert.deepEqual(m.calls.map((c) => c.model), ['claude-haiku-5-5', 'claude-sonnet-5-5']);
      for (const model of ['claude-opus-5-5', 'gpt', 'FAST', 1, null]) {
        const r = await s.ai({ prompt: 'a', model });
        assert.equal(r.status, 400, String(model)); assert.equal(r.json.error, 'bad_model'); CLEAN(r.text);
      }
      assert.equal(m.calls.length, 2);
    } finally { await s.t.close(); }
  });

  test('a call is held to its size limits, and a bad conversation is refused', async () => {
    const m = fakeModel(() => reply());
    const s = await setup({ cloudAiLimits: { maxTokens: 500, defaultTokens: 200, inputChars: 200, systemChars: 50, messages: 4 } }, { llm: m });
    try {
      await s.ai({ prompt: 'hi', maxTokens: 999999 });
      assert.equal(m.calls.at(-1).maxTokens, 500, 'asking for more gets the cap');
      await s.ai({ prompt: 'hi' });
      assert.equal(m.calls.at(-1).maxTokens, 200, 'the default');
      const n = m.calls.length;
      for (const [body, code] of [
        [{ prompt: 'x'.repeat(201) }, 'ai_too_long'], [{ prompt: 'hi', system: 'x'.repeat(51) }, 'ai_too_long'],
        [{ prompt: 'hi', maxTokens: 0 }, 'bad_request'], [{ prompt: 'hi', maxTokens: '5' }, 'bad_request'], [{ prompt: 'hi', maxTokens: 1.5 }, 'bad_request'],
        [{}, 'bad_request'], [{ prompt: 'a', messages: [] }, 'bad_request'], [{ prompt: '   ' }, 'bad_request'], [{ system: 'x' }, 'bad_request'],
        [{ messages: [] }, 'bad_request'], [{ messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] }, 'bad_request'],
        [{ messages: [{ role: 'assistant', content: 'b' }, { role: 'user', content: 'a' }] }, 'bad_request'], [{ messages: [{ role: 'system', content: 'a' }, { role: 'user', content: 'b' }] }, 'bad_request'],
        [{ messages: Array.from({ length: 5 }, () => ({ role: 'user', content: 'a' })) }, 'bad_request'], [{ messages: [{ role: 'user', content: 7 }] }, 'bad_request'],
      ]) {
        const r = await s.ai(body);
        assert.ok(r.status === 400 || r.status === 413, `${JSON.stringify(body).slice(0, 60)} ${r.status}`);
        assert.equal(r.json.error, code);
      }
      assert.equal(m.calls.length, n, 'none of those reached the model');
      const ok = await s.ai({ messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }] });
      assert.equal(ok.status, 200);
    } finally { await s.t.close(); }
  });

  test('each project has its own daily allowance, fast and smart counted apart, and clearing its data gives none back', async () => {
    const m = fakeModel(() => reply('ok', 100, 100));
    const s = await setup({ cloudAiLimits: { dayFast: 500, daySmart: 300, maxTokens: 100, defaultTokens: 100 } }, { llm: m });
    try {
      // 200 tokens a call, against 500: the third call fits only part of its reply, and then there is too little left to try.
      assert.equal((await s.ai({ prompt: 'a' })).status, 200);
      assert.equal((await s.ai({ prompt: 'a' })).status, 200);
      const short = await s.ai({ prompt: 'a' });
      assert.equal(short.status, 200, short.text);
      assert.ok(m.calls.at(-1).maxTokens < 100, 'the last of the allowance goes on a shorter reply');
      const out = await s.ai({ prompt: 'a' });
      assert.equal(out.status, 429); assert.equal(out.json.error, 'ai_limit'); assert.match(out.json.message, /allowance/i); CLEAN(out.text);
      const calls = m.calls.length;
      const smart = await s.ai({ prompt: 'a', model: 'smart' });
      assert.equal(smart.status, 200, 'smart is counted apart');
      assert.equal(smart.json.left.smart, 100);
      assert.equal(m.calls.length, calls + 1);
      const other = publish(s.t, s.floor, 'other');
      assert.equal((await s.ai({ prompt: 'a' }, { host: other })).status, 200, 'another project has its own');
      const wiped = await s.boss.post(`/api/floors/${s.boss.slug}/projects/app/clear-data`, {});
      assert.equal(wiped.status, 200);
      assert.equal((await s.ai({ prompt: 'a' })).status, 429, 'clearing the data does not reset the day');
      assert.ok(s.powers.counts(s.floor.id, 'app').ai_fast >= 500);
    } finally { await s.t.close(); }
  });

  test('the day\'s allowance comes back the next day', async () => {
    let clock = Date.parse('2026-11-08T12:00:00Z');
    const m = fakeModel(() => reply('ok', 100, 100));
    const s = await setup({ cloudAiLimits: { dayFast: 150, maxTokens: 100, defaultTokens: 100 } }, { llm: m, now: () => clock });
    try {
      assert.equal((await s.ai({ prompt: 'a' })).status, 200);
      assert.equal((await s.ai({ prompt: 'a' })).status, 429);
      clock += 86400000;
      assert.equal((await s.ai({ prompt: 'a' })).status, 200);
    } finally { await s.t.close(); }
  });

  test('calls still running count against the allowance, so a burst can\'t overshoot it', async () => {
    let release; const gateOpen = new Promise((r) => { release = r; });
    const m = fakeModel(async () => { await gateOpen; return reply('ok', 10, 10); });
    const s = await setup({ cloudAiLimits: { dayFast: 200, maxTokens: 150, defaultTokens: 150 }, trustProxy: true }, { llm: m });
    try {
      const first = s.ai({ prompt: 'a' }, { headers: { 'x-forwarded-for': '1.1.1.1' } });
      for (let i = 0; i < 100 && m.calls.length < 1; i++) await sleep(5);
      const second = await s.ai({ prompt: 'a' }, { headers: { 'x-forwarded-for': '2.2.2.2' } });
      assert.equal(second.status, 429, 'nothing is left while the first is promised most of it');
      assert.equal(second.json.error, 'ai_limit');
      release();
      assert.equal((await first).status, 200);
    } finally { release(); await s.t.close(); }
  });

  test('a visitor is rate limited by address, and two addresses are counted apart', async () => {
    const m = fakeModel(() => reply());
    const s = await setup({ trustProxy: true, cloudRates: { aiVisitor: [2, 60000] } }, { llm: m });
    try {
      const from = (ip) => ({ headers: { 'x-forwarded-for': ip } });
      assert.equal((await s.ai({ prompt: 'a' }, from('9.9.9.1'))).status, 200);
      assert.equal((await s.ai({ prompt: 'a' }, from('9.9.9.1'))).status, 200);
      const third = await s.ai({ prompt: 'a' }, from('9.9.9.1'));
      assert.equal(third.status, 429); assert.equal(third.json.error, 'rate_limited'); assert.match(third.json.message, /minute/);
      assert.equal(third.headers['retry-after'], '30');
      assert.equal((await s.ai({ prompt: 'a' }, from('9.9.9.2'))).status, 200);
      assert.equal(m.calls.length, 3);
    } finally { await s.t.close(); }
  });

  test('a visitor can only have two calls running at once', async () => {
    let release; const open = new Promise((r) => { release = r; });
    const m = fakeModel(async () => { await open; return reply(); });
    const s = await setup({}, { llm: m });
    try {
      const running = [s.ai({ prompt: 'a' }), s.ai({ prompt: 'b' })];
      for (let i = 0; i < 100 && m.calls.length < 2; i++) await sleep(5);
      const third = await s.ai({ prompt: 'c' });
      assert.equal(third.status, 429); assert.match(third.json.message, /other requests/);
      release();
      for (const r of await Promise.all(running)) assert.equal(r.status, 200);
    } finally { release(); await s.t.close(); }
  });

  test('a project has its own requests-per-minute ceiling', async () => {
    const m = fakeModel(() => reply());
    const s = await setup({ trustProxy: true, cloudRates: { aiProject: [2, 60000] } }, { llm: m });
    try {
      const from = (ip) => ({ headers: { 'x-forwarded-for': ip } });
      assert.equal((await s.ai({ prompt: 'a' }, from('8.8.1.1'))).status, 200);
      assert.equal((await s.ai({ prompt: 'a' }, from('8.8.1.2'))).status, 200);
      assert.equal((await s.ai({ prompt: 'a' }, from('8.8.1.3'))).status, 429);
    } finally { await s.t.close(); }
  });

  test('the building-wide daily ceiling stops all app AI, whichever floor spent it', async () => {
    const m = fakeModel(() => reply('ok', 10, 10, 0.01));
    const s = await setup({ cloudAiLimits: { buildingDayUsd: 0.015 } }, { llm: m });
    try {
      assert.equal((await s.ai({ prompt: 'a' })).status, 200);
      assert.equal((await s.ai({ prompt: 'a' })).status, 200);
      const stopped = await s.ai({ prompt: 'a' });
      assert.equal(stopped.status, 503); assert.equal(stopped.json.error, 'ai_resting'); CLEAN(stopped.text);
      const other = publish(s.t, s.floor, 'other');
      assert.equal((await s.ai({ prompt: 'a' }, { host: other })).status, 503, 'every project');
      assert.equal(m.calls.length, 2, 'the model was never reached');
    } finally { await s.t.close(); }
  });

  test('the staff\'s own spending does not use up the ceiling for apps', async () => {
    const m = fakeModel(() => reply());
    const s = await setup({ cloudAiLimits: { buildingDayUsd: 0.5 } }, { llm: m });
    try {
      run(s.t.db, "INSERT INTO ledger (floor_id,day,agent_id,model,prompt_tokens,completion_tokens,cost_usd,created_at,kind,provider) VALUES (?,?,NULL,'claude-sonnet-5-5',1,1,0.8,?,'model','anthropic')", s.floor.id, new Date().toISOString().slice(0, 10), Date.now());
      assert.equal((await s.ai({ prompt: 'a' })).status, 200);
    } finally { await s.t.close(); }
  });

  test('when the building\'s Anthropic budget is reached, calls stop cleanly', async () => {
    const m = fakeModel(() => reply());
    const s = await setup({ budgetAnthropicUsd: 1 }, { llm: m });
    try {
      run(s.t.db, "INSERT INTO ledger (floor_id,day,agent_id,model,prompt_tokens,completion_tokens,cost_usd,created_at,kind,provider) VALUES (?,?,NULL,'claude-sonnet-5-5',1,1,0.95,?,'model','anthropic')", s.floor.id, new Date().toISOString().slice(0, 10), Date.now());
      const r = await s.ai({ prompt: 'a' });
      assert.equal(r.status, 503); assert.equal(r.json.error, 'ai_resting'); CLEAN(r.text);
      assert.equal(m.calls.length, 0);
      assert.equal(ledger(s.t, s.floor.id).length, 0);
      assert.equal(get(s.t.db, 'SELECT COUNT(*) n FROM budget_holds').n, 0);
    } finally { await s.t.close(); }
  });

  test('every kill switch works: the setting, the building pause, the project pause and the boss\'s own switch', async () => {
    const m = fakeModel(() => reply());
    const off = await setup({ officeAiEnabled: false }, { llm: m });
    try {
      const r = await off.ai({ prompt: 'a' });
      assert.equal(r.status, 403); assert.equal(r.json.error, 'ai_off'); assert.equal(m.calls.length, 0); CLEAN(r.text);
      assert.equal(off.powers.view(off.floor.id, 'app').ai.paused, true);
    } finally { await off.t.close(); }

    const m2 = fakeModel(() => reply());
    const s = await setup({}, { llm: m2 });
    try {
      const F = s.floor.id;
      assert.equal((await s.ai({ prompt: 'a' })).status, 200, 'on by default, with nothing set up');
      s.powers.setPaused(F, 'app', 'ai', true);
      assert.equal((await s.ai({ prompt: 'a' })).json.error, 'ai_off', 'admin pause');
      assert.equal((await s.boss.post(`/api/floors/${s.boss.slug}/cloud/app/powers`, { ai: true })).status, 200);
      assert.equal((await s.ai({ prompt: 'a' })).status, 403, 'the boss can\'t lift the admin\'s pause');
      s.powers.setPaused(F, 'app', 'ai', false);
      assert.equal((await s.ai({ prompt: 'a' })).status, 200);
      s.powers.setBuildingPaused('ai', true);
      assert.equal((await s.ai({ prompt: 'a' })).json.error, 'ai_off', 'building pause');
      s.powers.setBuildingPaused('ai', false);
      const offNow = await s.boss.post(`/api/floors/${s.boss.slug}/cloud/app/powers`, { ai: false });
      assert.equal(offNow.status, 200, JSON.stringify(offNow.data)); assert.equal(offNow.data.powers.ai.on, false);
      assert.equal((await s.ai({ prompt: 'a' })).json.error, 'ai_off', 'the boss\'s own switch');
      assert.equal((await s.boss.post(`/api/floors/${s.boss.slug}/cloud/app/powers`, { ai: true })).data.powers.ai.on, true);
      assert.equal((await s.ai({ prompt: 'a' })).status, 200);
      assert.equal(m2.calls.length, 3);
    } finally { await s.t.close(); }
  });

  test('a broken provider gives a plain answer with no details, frees its hold and charges nothing', async () => {
    const m = fakeModel(() => { throw new ProviderError(`Model provider said 500: bad key ${SECRET} for claude-haiku-5-5, credit balance $4.20`, { status: 500 }); });
    const s = await setup({}, { llm: m });
    try {
      const r = await s.ai({ prompt: 'a' });
      assert.equal(r.status, 503); assert.equal(r.json.error, 'ai_unavailable'); CLEAN(r.text);
      assert.equal(ledger(s.t, s.floor.id).length, 0);
      assert.equal(get(s.t.db, 'SELECT COUNT(*) n FROM budget_holds').n, 0);
      assert.equal(s.powers.counts(s.floor.id, 'app').ai_calls, 0);
    } finally { await s.t.close(); }
  });

  test('a stream that dies part way is still charged for what it wrote', async () => {
    const m = fakeModel(() => { const e = new ProviderError('The model stream broke.', { retryable: true }); e.streamedChars = 400; throw e; });
    const s = await setup({}, { llm: m });
    try {
      assert.equal((await s.ai({ prompt: 'a' })).status, 503);
      const rows = ledger(s.t, s.floor.id);
      assert.equal(rows.length, 1); assert.equal(rows[0].completion_tokens, 100); assert.ok(rows[0].cost_usd > 0);
      assert.equal(get(s.t.db, 'SELECT COUNT(*) n FROM budget_holds').n, 0);
    } finally { await s.t.close(); }
  });

  test('a reply cut off at the token limit says so, and a refusal comes back as a refusal', async () => {
    const m = fakeModel((a, n) => (n === 1 ? { content: 'half a sen', toolCalls: [], finish: 'max_tokens', usage: { prompt: 5, completion: 5, cost: 0, real: true } } : { content: 'I can\'t help with that one.', toolCalls: [], finish: 'refusal', usage: { prompt: 5, completion: 5, cost: 0, real: true } }));
    const s = await setup({}, { llm: m });
    try {
      assert.deepEqual([(await s.ai({ prompt: 'a' })).json.truncated, (await s.ai({ prompt: 'b' })).json.refused], [true, true]);
    } finally { await s.t.close(); }
  });

  test('without a price for the model it stays off rather than spending uncounted', async () => {
    const m = fakeModel(() => reply());
    const models = loadModels();
    delete models.prices['claude-haiku-5-5'];
    const s = await setup({}, { llm: m, models });
    try {
      const r = await s.ai({ prompt: 'a' });
      assert.equal(r.status, 503); assert.equal(r.json.error, 'ai_resting');
      assert.equal(m.calls.length, 0);
    } finally { await s.t.close(); }
  });
});

function site(routes, host = '127.0.0.1') {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push({ url: req.url, ua: req.headers['user-agent'], cookie: req.headers.cookie, at: Date.now() });
    const r = routes[req.url.split('?')[0]];
    if (!r) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('nope'); }
    if (typeof r === 'function') return r(req, res);
    res.writeHead(r.status ?? 200, { ...(r.type === null ? {} : { 'content-type': r.type || 'text/html; charset=utf-8' }), ...(r.headers || {}) });
    res.end(r.body ?? '');
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => {
      const port = server.address().port, name = host.includes(':') ? `[${host}]` : host;
      resolve({ hits, port, url: (p) => `http://${name}:${port}${p}`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}
const LOCAL = { isBlocked: (ip) => ip !== '127.0.0.1' && ip !== '::ffff:127.0.0.1' && isBlockedIp(ip), allowAnyPort: true };
const WEB = (over) => ({ cloudFetchLimits: { hostDelayMs: 0, ...over } });
const pageHits = (w, path) => w.hits.filter((x) => x.url === path).length;
const ARTICLE = `<!doctype html><html lang="en"><head><title>The &amp; Story</title><meta name="description" content="All about it"><meta property="og:title" content="Story"><script>window.ran = 1; fetch('/tracker')</script></head>
<body><nav><a href="/">Home</a></nav><main><h1>A headline</h1><p>Some words here, ${'more words '.repeat(30)}</p><a href="/next">Next page</a><a href="https://elsewhere.example/x">Elsewhere</a><a href="javascript:alert(1)">Bad</a></main><footer>Small print</footer></body></html>`;

describe('office.fetch and office.scrape', () => {
  test('fetch returns status, type and text, honestly labelled and with nothing else sent', async () => {
    const w = await site({ '/data.json': { type: 'application/json', body: '{"a":1}' }, '/page': { body: '<p>hello</p>' }, '/feed': { type: 'application/rss+xml', body: '<rss/>' }, '/notes': { type: 'text/plain; charset=utf-8', body: 'notes' } });
    const s = await setup(WEB(), { cloudNet: LOCAL });
    try {
      const j = await s.fetchPage(w.url('/data.json'));
      assert.equal(j.status, 200, j.text);
      assert.deepEqual([j.json.status, j.json.type, j.json.text, j.json.cached], [200, 'application/json', '{"a":1}', false]);
      CLEAN(j.text);
      const html = await s.fetchPage(w.url('/page'));
      assert.equal(html.json.text, '<p>hello</p>', 'raw HTML');
      assert.equal((await s.fetchPage(w.url('/feed'))).json.type, 'application/rss+xml');
      assert.equal((await s.fetchPage(w.url('/notes'))).json.text, 'notes');
      assert.ok(w.hits.filter((x) => x.url !== '/robots.txt').every((x) => x.ua === USER_AGENT && !x.cookie));
      assert.match(USER_AGENT, /The ?Office/); assert.match(USER_AGENT, /iscolinfree\.com\/theoffice/);
    } finally { await s.t.close(); await w.close(); }
  });

  test('a 404 from a site comes back as a 404, not as a failure', async () => {
    const w = await site({ '/gone': { status: 404, body: 'gone' } });
    const s = await setup(WEB(), { cloudNet: LOCAL });
    try {
      const r = await s.fetchPage(w.url('/gone'));
      assert.equal(r.status, 200); assert.equal(r.json.status, 404);
    } finally { await s.t.close(); await w.close(); }
  });

  test('only HTML, JSON, XML and plain text get through', async () => {
    const w = await site({ '/a.png': { type: 'image/png', body: 'x' }, '/s.js': { type: 'application/javascript', body: 'alert(1)' }, '/css': { type: 'text/css', body: 'a{}' }, '/none': { type: null, body: 'x' }, '/zip': { type: 'application/zip', body: 'x' } });
    const s = await setup(WEB(), { cloudNet: LOCAL });
    try {
      for (const p of ['/a.png', '/s.js', '/css', '/none', '/zip']) {
        const r = await s.fetchPage(w.url(p));
        assert.equal(r.status, 415, p); assert.equal(r.json.error, 'fetch_type'); CLEAN(r.text);
      }
    } finally { await s.t.close(); await w.close(); }
  });

  test('scrape returns cleaned text, title, meta and links, and runs nothing on the page', async () => {
    const w = await site({ '/article': { body: ARTICLE }, '/tracker': { body: 'ran' } });
    const s = await setup(WEB(), { cloudNet: LOCAL });
    try {
      const r = await s.scrape(w.url('/article'));
      assert.equal(r.status, 200, r.text);
      assert.equal(r.json.title, 'The & Story');
      assert.equal(r.json.description, 'All about it');
      assert.equal(r.json.meta['og:title'], 'Story');
      assert.match(r.json.text, /A headline/); assert.match(r.json.text, /more words/);
      assert.doesNotMatch(r.json.text, /window\.ran|Small print|Home/);
      assert.deepEqual(r.json.links.map((l) => l.url), [w.url('/'), w.url('/next'), 'https://elsewhere.example/x']);
      assert.equal(r.json.links.find((l) => l.url.endsWith('/next')).text, 'Next page');
      assert.ok(r.json.links.every((l) => l.url.startsWith('http')));
      assert.equal(pageHits(w, '/tracker'), 0, 'its scripts never ran');
      const plain = await site({ '/t': { type: 'text/plain', body: 'just text' } });
      try {
        const p = await s.scrape(plain.url('/t'));
        assert.deepEqual([p.json.text, p.json.title, p.json.links], ['just text', '', []]);
      } finally { await plain.close(); }
    } finally { await s.t.close(); await w.close(); }
  });

  test('robots.txt is obeyed, cached, and a site can say no to just one path', async () => {
    const w = await site({ '/robots.txt': { type: 'text/plain', body: 'User-agent: *\nDisallow: /private\nDisallow: /secret$\nAllow: /private/open\n\nUser-agent: TheOfficeBot\nDisallow: /nobots' }, '/ok': { body: 'fine' }, '/private/x': { body: 'no' }, '/nobots': { body: 'no' }, '/private/open/a': { body: 'allowed' } });
    const s = await setup(WEB(), { cloudNet: LOCAL });
    try {
      assert.equal((await s.fetchPage(w.url('/nobots'))).json.error, 'robots_denied');
      assert.equal(pageHits(w, '/nobots'), 0);
      assert.equal((await s.fetchPage(w.url('/ok'))).status, 200, 'its own group applies, not the star group');
      assert.equal((await s.scrape(w.url('/private/x'))).status, 200, 'the star group is ignored once it has its own');
      assert.equal(pageHits(w, '/robots.txt'), 1, 'asked once');
    } finally { await s.t.close(); await w.close(); }
    const star = await site({ '/robots.txt': { type: 'text/plain', body: 'User-agent: *\nDisallow: /private\nAllow: /private/open' }, '/private/x': { body: 'no' }, '/private/open/a': { body: 'yes' } });
    const s2 = await setup(WEB(), { cloudNet: LOCAL });
    try {
      const r = await s2.scrape(star.url('/private/x'));
      assert.equal(r.status, 403); assert.equal(r.json.error, 'robots_denied'); CLEAN(r.text);
      assert.equal(pageHits(star, '/private/x'), 0);
      assert.equal((await s2.fetchPage(star.url('/private/open/a'))).status, 200);
      // A page turned away by robots.txt never left the building, so it doesn't count.
      assert.equal(s2.powers.counts(s2.floor.id, 'app').fetches, 1);
    } finally { await s2.t.close(); await star.close(); }
  });

  test('a missing robots.txt means anything goes; one that is unreachable means no', async () => {
    const a = await site({ '/ok': { body: 'fine' } });
    const b = await site({ '/robots.txt': { status: 500, body: 'broken' }, '/ok': { body: 'no' } });
    const s = await setup(WEB(), { cloudNet: LOCAL });
    try {
      assert.equal((await s.fetchPage(a.url('/ok'))).status, 200);
      const r = await s.fetchPage(b.url('/ok'));
      assert.equal(r.status, 502); assert.equal(r.json.error, 'fetch_failed');
      assert.equal(pageHits(b, '/ok'), 0, 'unreachable means assume no');
    } finally { await s.t.close(); await a.close(); await b.close(); }
  });

  test('a redirect is checked against the robots.txt of where it lands', async () => {
    const dest = await site({ '/robots.txt': { type: 'text/plain', body: 'User-agent: *\nDisallow: /' }, '/landing': { body: 'no' } });
    const from = await site({ '/start': (req, res) => { res.writeHead(302, { location: dest.url('/landing') }); res.end(); } });
    const s = await setup(WEB(), { cloudNet: LOCAL });
    try {
      assert.equal((await s.fetchPage(from.url('/start'))).json.error, 'robots_denied');
      assert.equal(pageHits(dest, '/landing'), 0);
    } finally { await s.t.close(); await dest.close(); await from.close(); }
  });

  test('visits to one site are spaced out across the whole building, and a long wait is refused', async () => {
    const w = await site({ '/a': { body: 'a' }, '/b': { body: 'b' } });
    const s = await setup({ cloudFetchLimits: { hostDelayMs: 150, maxWaitMs: 2000 } }, { cloudNet: LOCAL });
    const other = publish(s.t, s.floor, 'other');
    try {
      await s.fetchPage(w.url('/a'));
      await s.fetchPage(w.url('/b'), { host: other });
      const gap = w.hits.find((x) => x.url === '/b').at - w.hits.find((x) => x.url === '/a').at;
      assert.ok(gap >= 130, `gap ${gap}ms`);
    } finally { await s.t.close(); await w.close(); }
    const w2 = await site({ '/a': { body: 'a' }, '/b': { body: 'b' } });
    const s2 = await setup({ cloudFetchLimits: { hostDelayMs: 5000, maxWaitMs: 50 } }, { cloudNet: LOCAL });
    try {
      assert.equal((await s2.fetchPage(w2.url('/a'))).status, 200);
      const r = await s2.fetchPage(w2.url('/b'));
      assert.equal(r.status, 429); assert.equal(r.json.error, 'host_busy'); CLEAN(r.text);
      assert.equal(pageHits(w2, '/b'), 0);
      assert.equal((await s2.fetchPage(w2.url('/a'))).status, 200, 'a page already fetched is answered from the cache');
    } finally { await s2.t.close(); await w2.close(); }
  });

  test('a site\'s Crawl-delay is respected', async () => {
    const w = await site({ '/robots.txt': { type: 'text/plain', body: 'User-agent: *\nCrawl-delay: 30\nDisallow:' }, '/a': { body: 'a' }, '/b': { body: 'b' } });
    const s = await setup({ cloudFetchLimits: { hostDelayMs: 0, maxWaitMs: 100, maxDelayMs: 5000 } }, { cloudNet: LOCAL });
    try {
      assert.equal((await s.fetchPage(w.url('/a'))).status, 200);
      assert.equal((await s.fetchPage(w.url('/b'))).json.error, 'host_busy');
      assert.equal(pageHits(w, '/b'), 0);
    } finally { await s.t.close(); await w.close(); }
  });

  test('a repeat fetch is answered from a short cache, shared by the building, and doesn\'t count', async () => {
    const w = await site({ '/a': { body: 'a' }, '/err': { status: 503, body: 'down' } });
    const s = await setup(WEB({ cacheTtlMs: 200 }), { cloudNet: LOCAL });
    const other = publish(s.t, s.floor, 'other');
    try {
      assert.equal((await s.fetchPage(w.url('/a'))).json.cached, false);
      const again = await s.fetchPage(w.url('/a'));
      assert.equal(again.json.cached, true); assert.equal(again.json.text, 'a');
      assert.equal((await s.scrape(w.url('/a'), { host: other })).json.cached, true, 'another project gets it too');
      assert.equal(pageHits(w, '/a'), 1);
      assert.equal(s.powers.counts(s.floor.id, 'app').fetches, 1);
      await sleep(250);
      assert.equal((await s.fetchPage(w.url('/a'))).json.cached, false, 'then it goes stale');
      assert.equal(pageHits(w, '/a'), 2);
      await s.fetchPage(w.url('/err')); await s.fetchPage(w.url('/err'));
      assert.equal(pageHits(w, '/err'), 2, 'a server error is not remembered');
    } finally { await s.t.close(); await w.close(); }
  });

  test('the same page asked for at once is fetched once', async () => {
    const w = await site({ '/slow': async (req, res) => { await sleep(80); res.writeHead(200, { 'content-type': 'text/plain' }); res.end('slow'); } });
    const s = await setup(WEB(), { cloudNet: LOCAL });
    try {
      const out = await Promise.all([s.fetchPage(w.url('/slow')), s.fetchPage(w.url('/slow'), { headers: {} }), s.scrape(w.url('/slow'))]);
      assert.ok(out.every((r) => r.status === 200), JSON.stringify(out.map((r) => r.status)));
      assert.equal(pageHits(w, '/slow'), 1);
    } finally { await s.t.close(); await w.close(); }
  });

  test('a project has a daily allowance of real fetches', async () => {
    const w = await site({ '/a': { body: 'a' }, '/b': { body: 'b' }, '/c': { body: 'c' } });
    const s = await setup(WEB({ dayProject: 2 }), { cloudNet: LOCAL });
    const other = publish(s.t, s.floor, 'other');
    try {
      assert.equal((await s.fetchPage(w.url('/a'))).status, 200);
      assert.equal((await s.fetchPage(w.url('/b'))).status, 200);
      const out = await s.fetchPage(w.url('/c'));
      assert.equal(out.status, 429); assert.equal(out.json.error, 'fetch_limit'); CLEAN(out.text);
      assert.equal(pageHits(w, '/c'), 0);
      assert.equal((await s.fetchPage(w.url('/a'))).status, 200, 'what is cached still answers');
      assert.equal((await s.fetchPage(w.url('/c'), { host: other })).status, 200, 'another project has its own');
      assert.equal(s.powers.view(s.floor.id, 'app').fetch.left, 0);
      assert.equal(s.powers.view(s.floor.id, 'other').fetch.left, 1);
    } finally { await s.t.close(); await w.close(); }
  });

  test('a visitor and a project are rate limited', async () => {
    const w = await site({ '/a': { body: 'a' }, '/b': { body: 'b' }, '/c': { body: 'c' } });
    const s = await setup({ ...WEB(), trustProxy: true, cloudRates: { webVisitor: [2, 60000] } }, { cloudNet: LOCAL });
    try {
      const from = (ip) => ({ headers: { 'x-forwarded-for': ip } });
      assert.equal((await s.fetchPage(w.url('/a'), from('7.7.7.7'))).status, 200);
      assert.equal((await s.fetchPage(w.url('/b'), from('7.7.7.7'))).status, 200);
      const third = await s.fetchPage(w.url('/c'), from('7.7.7.7'));
      assert.equal(third.status, 429); assert.equal(third.json.error, 'rate_limited');
      assert.equal(pageHits(w, '/c'), 0);
      assert.equal((await s.fetchPage(w.url('/c'), from('7.7.7.8'))).status, 200);
    } finally { await s.t.close(); await w.close(); }
    const w2 = await site({ '/a': { body: 'a' }, '/b': { body: 'b' } });
    const s2 = await setup({ ...WEB(), trustProxy: true, cloudRates: { webProject: [1, 60000] } }, { cloudNet: LOCAL });
    try {
      assert.equal((await s2.fetchPage(w2.url('/a'), { headers: { 'x-forwarded-for': '6.6.6.1' } })).status, 200);
      assert.equal((await s2.fetchPage(w2.url('/b'), { headers: { 'x-forwarded-for': '6.6.6.2' } })).status, 429);
    } finally { await s2.t.close(); await w2.close(); }
  });

  test('a big page is cut off at the limit and says so', async () => {
    const w = await site({ '/big': { type: 'text/plain', body: Buffer.alloc(200000, 'a') } });
    const s = await setup(WEB({ maxBytes: 1024 }), { cloudNet: LOCAL });
    try {
      const r = await s.fetchPage(w.url('/big'));
      assert.equal(r.status, 200); assert.equal(r.json.text.length, 1024); assert.equal(r.json.truncated, true);
    } finally { await s.t.close(); await w.close(); }
  });

  test('every kill switch works for fetching too', async () => {
    const w = await site({ '/a': { body: 'a' } });
    const off = await setup({ ...WEB(), officeFetchEnabled: false }, { cloudNet: LOCAL });
    try {
      for (const r of [await off.fetchPage(w.url('/a')), await off.scrape(w.url('/a'))]) { assert.equal(r.status, 403); assert.equal(r.json.error, 'fetch_off'); }
    } finally { await off.t.close(); }
    const s = await setup(WEB(), { cloudNet: LOCAL });
    try {
      const F = s.floor.id;
      assert.equal((await s.fetchPage(w.url('/a'))).status, 200);
      s.powers.setPaused(F, 'app', 'fetch', true);
      assert.equal((await s.scrape(w.url('/a'))).json.error, 'fetch_off', 'admin pause, even for a cached page');
      assert.equal((await s.boss.post(`/api/floors/${s.boss.slug}/cloud/app/powers`, { fetch: true })).status, 200);
      assert.equal((await s.scrape(w.url('/a'))).status, 403, 'the boss can\'t lift it');
      s.powers.setPaused(F, 'app', 'fetch', false);
      s.powers.setBuildingPaused('fetch', true);
      assert.equal((await s.fetchPage(w.url('/a'))).json.error, 'fetch_off');
      s.powers.setBuildingPaused('fetch', false);
      await s.boss.post(`/api/floors/${s.boss.slug}/cloud/app/powers`, { fetch: false });
      assert.equal((await s.fetchPage(w.url('/a'))).json.error, 'fetch_off', 'the boss\'s own switch');
      await s.boss.post(`/api/floors/${s.boss.slug}/cloud/app/powers`, { fetch: true });
      assert.equal((await s.fetchPage(w.url('/a'))).status, 200);
    } finally { await s.t.close(); await w.close(); }
  });

  test('only the project\'s own pages may call it', async () => {
    const w = await site({ '/a': { body: 'a' } });
    const s = await setup(WEB(), { cloudNet: LOCAL });
    try {
      assert.equal((await s.fetchPage(w.url('/a'), { origin: 'https://evil.example' })).status, 403);
      assert.equal((await cloud(s.t, s.host, 'POST', 'scrape', { body: { url: w.url('/a') }, origin: null })).status, 403);
      assert.equal(pageHits(w, '/a'), 0);
    } finally { await s.t.close(); await w.close(); }
  });

  describe('private and internal addresses', () => {
    let s;
    before(async () => { s = await setup(WEB()); });
    after(() => s.t.close());
    const REFUSED = [
      'http://127.0.0.1/', 'http://127.1/', 'http://2130706433/', 'http://0x7f.0.0.1/', 'http://0177.0.0.1/', 'http://127.0.0.1./', 'https://127.255.255.254/',
      'http://0.0.0.0/', 'http://10.0.0.1/', 'http://10.255.255.255/', 'http://172.16.0.1/', 'http://172.31.255.255/', 'http://192.168.1.1/', 'http://169.254.169.254/latest/meta-data/', 'http://100.64.0.1/', 'http://198.18.0.1/', 'http://224.0.0.1/', 'http://240.0.0.1/',
      'http://localhost/', 'http://localhost./', 'http://foo.localhost/', 'http://printer.local/', 'http://db.internal/', 'http://metadata.google.internal/computeMetadata/v1/',
      'http://[::1]/', 'http://[::]/', 'http://[0:0:0:0:0:0:0:1]/', 'http://[fe80::1]/', 'http://[fc00::1]/', 'http://[fd00:ec2::254]/', 'http://[ff02::1]/',
      'http://[::ffff:127.0.0.1]/', 'http://[::ffff:7f00:1]/', 'http://[::ffff:a9fe:a9fe]/', 'http://[::ffff:10.0.0.1]/', 'http://[::127.0.0.1]/', 'http://[64:ff9b::7f00:1]/', 'http://[2002:7f00:1::]/', 'http://[::ffff:0:7f00:1]/',
      'http://example.com:8080/', 'http://example.com:22/', 'https://example.com:8443/', 'http://user:pass@example.com/',
    ];
    for (const url of REFUSED) test(`refuses ${url}`, async () => {
      const r = await s.fetchPage(url);
      assert.ok(r.status === 403 || r.status === 400, `${url}: ${r.status} ${r.text.slice(0, 80)}`);
      assert.ok(r.json.error === 'fetch_blocked' || r.json.error === 'bad_url', r.json.error); CLEAN(r.text);
      assert.doesNotMatch(r.text, /private|internal|resolve|10\.0/i);
    });
    test('refuses other schemes and nonsense', async () => {
      for (const url of ['file:///etc/passwd', 'ftp://example.com/', 'gopher://example.com/', 'javascript:alert(1)', 'data:text/html,hi', 'not a url', '', 'x'.repeat(3000), 42, null]) {
        const r = await s.fetchPage(url);
        assert.equal(r.status, 400, String(url).slice(0, 30)); assert.equal(r.json.error, 'bad_url');
      }
    });
    test('refuses the building\'s own addresses', async () => {
      s.t.cfg.publicOrigin = 'https://main.test.example';
      try {
        for (const url of ['https://main.test.example/theoffice/api/me', `https://${s.host}/`, `https://x.${BASE}/_office/cloud/ping`]) {
          assert.equal((await s.fetchPage(url)).status, 403, url);
        }
      } finally { s.t.cfg.publicOrigin = ''; }
    });
  });

  test('a name that resolves to a private address is refused, even mixed with a public one, and nothing is connected', async () => {
    let connected = false;
    const hookResolver = (answers) => (hostname, options, cb) => { connected = connected || !!options.nope; cb(null, answers); };
    for (const answers of [[{ address: '10.1.2.3', family: 4 }], [{ address: '93.184.216.34', family: 4 }, { address: '169.254.169.254', family: 4 }], [{ address: '::ffff:127.0.0.1', family: 6 }], [{ address: 'fd00::1', family: 6 }]]) {
      const s = await setup(WEB(), { cloudNet: { resolver: hookResolver(answers) } });
      try {
        const r = await s.fetchPage('https://sneaky.example/secret');
        assert.ok(r.status === 403 || r.status === 502, `${JSON.stringify(answers)} ${r.status}`);
        assert.ok(['fetch_blocked', 'fetch_failed'].includes(r.json.error)); CLEAN(r.text);
      } finally { await s.t.close(); }
    }
    assert.equal(connected, false);
  });

  test('a redirect to a private address is refused at every hop', async () => {
    for (const target of ['http://127.0.0.1:1/x', 'http://10.0.0.1/', 'http://172.16.5.5/', 'http://192.168.0.1/', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/', 'http://[::ffff:a9fe:a9fe]/', 'http://[fd00:ec2::254]/']) {
      // The test site itself is allowed for the first hop only. A redirect to the loopback is judged by the real list, so the site is reached over IPv6.
      const useV6 = target.includes('127.0.0.1');
      const w = await site({ '/go': (req, res) => { res.writeHead(302, { location: target }); res.end(); } }, useV6 ? '::1' : '127.0.0.1').catch(() => null);
      if (!w) continue;   // no IPv6 loopback on this machine: the IPv4 cases above still run
      const net = useV6 ? { isBlocked: (ip) => ip !== '::1' && isBlockedIp(ip), allowAnyPort: true } : LOCAL;
      const s = await setup(WEB(), { cloudNet: net });
      try {
        const r = await s.fetchPage(w.url('/go'));
        assert.equal(r.status, 403, `${target}: ${r.status} ${r.text.slice(0, 80)}`);
        assert.equal(r.json.error, 'fetch_blocked'); CLEAN(r.text);
      } finally { await s.t.close(); await w.close(); }
    }
  });

  test('redirects to a public page are followed; too many are refused', async () => {
    const w = await site({
      '/start': (req, res) => { res.writeHead(301, { location: '/final' }); res.end(); }, '/final': { body: 'arrived' },
      '/loop': (req, res) => { res.writeHead(302, { location: '/loop' }); res.end(); },
    });
    const s = await setup(WEB({ maxRedirects: 3 }), { cloudNet: LOCAL });
    try {
      const r = await s.fetchPage(w.url('/start'));
      assert.equal(r.status, 200); assert.equal(r.json.text, 'arrived'); assert.equal(r.json.url, w.url('/final'));
      const loop = await s.fetchPage(w.url('/loop'));
      assert.equal(loop.status, 502); assert.equal(loop.json.error, 'fetch_failed');
    } finally { await s.t.close(); await w.close(); }
  });
});

describe('robots.txt rules', () => {
  const rules = (txt) => parseRobots(txt);
  test('the longest match wins, Allow wins a tie, and no match means yes', () => {
    const r = rules('User-agent: *\nDisallow: /a\nAllow: /a/b\nDisallow: /a/b/c\nAllow: /tie\nDisallow: /tie\n');
    assert.equal(robotsAllows(r, '/z'), true); assert.equal(robotsAllows(r, '/a/x'), false); assert.equal(robotsAllows(r, '/a/b/x'), true); assert.equal(robotsAllows(r, '/a/b/c/d'), false); assert.equal(robotsAllows(r, '/tie'), true);
  });
  test('* and $ work, and the query counts', () => {
    const r = rules('User-agent: *\nDisallow: /*.pdf$\nDisallow: /search?*q=\nDisallow: /a*b*c');
    assert.equal(robotsAllows(r, '/x.pdf'), false); assert.equal(robotsAllows(r, '/x.pdf?y=1'), true); assert.equal(robotsAllows(r, '/search?a=1&q=z'), false); assert.equal(robotsAllows(r, '/search?a=1'), true); assert.equal(robotsAllows(r, '/1a2b3c4'), true, 'starts with /a? no');
    assert.equal(robotsAllows(r, '/a2b3c4'), false);
    assert.equal(robotsAllows(rules('User-agent: *\nDisallow: /x$'), '/x'), false);
    assert.equal(robotsAllows(rules('User-agent: *\nDisallow: /x$'), '/xy'), true);
  });
  test('this crawler\'s own group replaces the star group, case and version aside', () => {
    const r = rules('User-agent: *\nDisallow: /star\n\nUser-agent: TheOfficeBot/1.0\nDisallow: /mine');
    assert.equal(robotsAllows(r, '/star'), true); assert.equal(robotsAllows(r, '/mine'), false);
  });
  test('grouped user-agents share rules, comments and a BOM are ignored, and an empty Disallow means nothing', () => {
    const r = rules('﻿User-agent: a\nUser-agent: *\n# comment\nDisallow: /x # trailing\nDisallow:\nCrawl-delay: 7\n');
    assert.equal(robotsAllows(r, '/x'), false); assert.equal(robotsAllows(r, '/y'), true); assert.equal(r.delay, 7);
    assert.equal(robotsAllows(rules('garbage line\nDisallow: /early\n'), '/early'), true, 'a rule before any user-agent belongs to nobody');
  });
  test('robots.txt itself can always be read, and percent-escapes compare the same', () => {
    assert.equal(robotsAllows(rules('User-agent: *\nDisallow: /'), '/robots.txt'), true);
    assert.equal(robotsAllows(rules('User-agent: *\nDisallow: /a%2fb'), '/a%2Fb'), false);
  });
  test('a hostile robots.txt can\'t stall it', () => {
    const body = 'User-agent: *\n' + Array.from({ length: 5000 }, (_, i) => `Disallow: /${'*a'.repeat(200)}${i}`).join('\n');
    const started = Date.now();
    const r = rules(body);
    assert.ok(r.rules.length <= 2000);
    robotsAllows(r, `/${'a'.repeat(2000)}`);
    assert.ok(Date.now() - started < 1000, `took ${Date.now() - started}ms`);
  });
});

describe('reading a page', () => {
  test('entities are decoded exactly once', () => {
    assert.equal(decodeEntities('&amp;lt; &#8217; &#x41; &rsquo; &bogus; &#xD800; &#0;'), '&lt; ’ A ’ &bogus; &#xD800; &#0;');
  });
  test('a hostile page costs only its own length', () => {
    const started = Date.now();
    for (const page of ['<a href="'.repeat(60000), '<'.repeat(500000), '<a '.repeat(150000), '<div '.repeat(100000), '<!--'.repeat(120000), '<script>'.repeat(60000), `<a href=${'x'.repeat(490000)}>`, '&'.repeat(500000), '&#'.repeat(250000)]) scrapeHtml(page, 'https://x.example/');
    assert.ok(Date.now() - started < 2000, `took ${Date.now() - started}ms`);
  });
  test('characters that change length when lowercased don\'t misplace the parser', () => {
    const r = scrapeHtml('<title>İİİ</title><p>İ<script>hidden()</script>after</p>', 'https://x.example/');
    assert.equal(r.title, 'İİİ'); assert.match(r.text, /after/); assert.doesNotMatch(r.text, /hidden/);
  });
  test('unclosed tags and quotes don\'t eat the text before them', () => {
    const r = scrapeHtml(`<p>${'Visible words. '.repeat(30)}</p><a href="oops`, 'https://x.example/');
    assert.match(r.text, /Visible words/);
    const nav = scrapeHtml(`<nav><p>${'Everything is inside an unclosed nav. '.repeat(30)}</p>`, 'https://x.example/');
    assert.match(nav.text, /unclosed nav/, 'boilerplate is left out only when something else remains');
  });
  test('a page can\'t pollute anything by naming a meta tag __proto__', () => {
    const r = scrapeHtml('<meta name="__proto__" content="x"><meta name="constructor" content="y"><meta name="a" content="b">', 'https://x.example/');
    assert.equal(Object.getPrototypeOf(r.meta), null);
    assert.equal(({}).x, undefined);
    assert.equal(JSON.parse(JSON.stringify(r.meta)).a, 'b');
  });
  test('links are absolute web links only, de-duplicated, capped and stripped of credentials', () => {
    const r = scrapeHtml(`<base href="https://x.example/dir/">${'<a href="p">P</a>'.repeat(5)}<a href="https://u:p@y.example/z#f">Z</a><a href="mailto:a@b">M</a><a href="data:text/html,hi">D</a><a href="ftp://x/">F</a>`, 'https://x.example/', { links: 3 });
    assert.deepEqual(r.links.map((l) => l.url), ['https://x.example/dir/p', 'https://y.example/z']);
  });
  test('text is capped and a very long page says it was cut', () => {
    const r = scrapeHtml(`<p>${'word '.repeat(5000)}</p>`, 'https://x.example/', { textChars: 100 });
    assert.equal(r.text.length, 100); assert.equal(r.truncated, true);
  });
  test('script, style and the like are never text', () => {
    const r = scrapeHtml('<style>p{}</style><p>Keep</p><script type="x">Bad</script><template>Bad</template><noscript>Bad</noscript><textarea>Bad</textarea><svg><title>Bad</title></svg><select><option>Bad</option></select>', 'https://x.example/');
    assert.equal(r.text, 'Keep'); assert.equal(r.title, '');
  });
});

describe('the boss and the staff', () => {
  test('the Backend panel gets counts and what is left today, with no money, and only for the floor\'s own boss', async () => {
    const m = fakeModel(() => reply('ok', 40, 10));
    const w = await site({ '/a': { body: 'a' } });
    const s = await setup({ cloudAiLimits: { dayFast: 1000, daySmart: 200 }, ...WEB({ dayProject: 10 }) }, { llm: m, cloudNet: LOCAL });
    try {
      await s.ai({ prompt: 'a' }); await s.ai({ prompt: 'a', model: 'smart' });
      await s.fetchPage(w.url('/a'));
      const r = await s.boss.get(`/api/floors/${s.boss.slug}/cloud`);
      assert.equal(r.status, 200);
      const p = r.data.projects.find((x) => x.slug === 'app');
      assert.deepEqual(p.powers, {
        ai: { on: true, paused: false, callsToday: 2, fastLeft: 950, smartLeft: 150, fastPerDay: 1000, smartPerDay: 200 },
        fetch: { on: true, paused: false, fetchedToday: 1, left: 9, perDay: 10 },
      });
      CLEAN(JSON.stringify(p.powers));
      const stranger = await claim(s.t, 'Other Co');
      assert.equal((await stranger.get(`/api/floors/${s.boss.slug}/cloud`)).status, 403);
      assert.equal((await stranger.post(`/api/floors/${s.boss.slug}/cloud/app/powers`, { ai: false })).status, 403);
      assert.equal((await s.boss.post(`/api/floors/${s.boss.slug}/cloud/nope/powers`, { ai: false })).status, 404);
      assert.equal((await s.boss.post(`/api/floors/${s.boss.slug}/cloud/app/powers`, { ai: 'off' })).status, 400);
      const admin = await adminClient(s.t);
      const listing = await admin.get('/api/admin/cloud');
      CLEAN(JSON.stringify(listing.data.projects.map((x) => x.powers)));
    } finally { await s.t.close(); await w.close(); }
  });

  test('the staff are told to use it, to show a friendly message when a limit is hit, and to keep keys out', async () => {
    const s = await setup();
    try {
      const docs = platformDocs(s.t.cfg);
      for (const word of ['office.ai.chat', 'office.scrape', 'office.fetch', 'err.message']) assert.ok(docs.includes(word), word);
      assert.match(docs, /key must never go in client code/);
      CLEAN(docs.slice(docs.indexOf('AI features'), docs.indexOf('Show anything a visitor wrote')));
    } finally { await s.t.close(); }
  });

  test('the SDK offers office.ai.chat, office.fetch and office.scrape and holds no key', async () => {
    const s = await setup();
    try {
      const sdk = (await hit(s.t, s.host, '/_office/office.js')).text;
      assert.match(sdk, /self\.ai = ai/); assert.match(sdk, /self\.fetch = fetchPage/); assert.match(sdk, /self\.scrape = scrapePage/);
      assert.doesNotMatch(sdk, /sk-ant|claude-|api\.anthropic|ANTHROPIC/i);
    } finally { await s.t.close(); }
  });
});
