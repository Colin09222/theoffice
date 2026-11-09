// Which model each job runs on, and the request each model is sent. Opus stays where quality shows (code, games, pictures), Sonnet does the rest,
// and everything the team picks for itself in a work mode runs on Sonnet. See config/models.json.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { loadModels, loadConfig, routeFor } from '../server/config.js';
import { buildRequest, modelShape, costOf, createAnthropicClient, FALLBACK_BETA } from '../server/anthropic.js';
import { computerRole } from '../server/computer.js';

const m = loadModels();
const OPUS = 'claude-opus-5-5', SONNET = 'claude-sonnet-5-5';

describe('routing', () => {
  test('jobs the boss asks for: every role that shapes the work is on Opus at high or above', () => {
    const at = (role) => { const r = routeFor(m, role); return `${r.model} ${r.effort}`; };
    assert.equal(at('builder'), `${OPUS} xhigh`);
    assert.equal(at('designer'), `${OPUS} xhigh`);
    for (const role of ['manager', 'researcher', 'writer', 'analyst', 'marketer', 'illustrator']) assert.equal(at(role), `${OPUS} high`, role);
    assert.equal(at('lawyer'), `${SONNET} medium`, 'the Lawyer stays as it was');
    // The Tester's review is another lab's eye, through OpenRouter.
    const tester = routeFor(m, 'tester');
    assert.equal(tester.model, 'google/gemini-3.1-pro-preview'); assert.equal(tester.provider, 'openrouter');
  });

  test('computers: the Builder runs Opus at xhigh for the boss, and the Tester\'s computer is Opus at high', () => {
    assert.deepEqual(pick(computerRole(m, 'builder')), { model: OPUS, effort: 'xhigh' });
    assert.deepEqual(pick(computerRole(m, 'tester')), { model: OPUS, effort: 'high' });
    assert.equal(computerRole(m, 'writer'), null);
  });

  test('autonomous jobs: every Claude role on Sonnet at high, computers included; the Tester\'s review stays on its own model', () => {
    for (const role of ['manager', 'researcher', 'writer', 'builder', 'designer', 'illustrator', 'analyst', 'marketer']) {
      const r = routeFor(m, role, { autonomous: true });
      assert.deepEqual([r.provider, r.model, r.effort], ['anthropic', SONNET, 'high'], role);
      assert.deepEqual(r.pricing, m.prices[SONNET], `${role} is charged what Sonnet costs`);
    }
    assert.deepEqual(pick(computerRole(m, 'builder', { autonomous: true })), { model: SONNET, effort: 'high' });
    assert.deepEqual(pick(computerRole(m, 'tester', { autonomous: true })), { model: SONNET, effort: 'high' });
    assert.equal(routeFor(m, 'tester', { autonomous: true }).model, 'google/gemini-3.1-pro-preview');
  });

  test('talk stays on Haiku and search on Sonnet at low effort, whoever is working', () => {
    assert.equal(m.tools.talk.model, 'claude-haiku-5-5'); assert.equal(m.tools.talk.effort, 'low');
    assert.equal(m.tools.search.model, SONNET); assert.equal(m.tools.search.effort, 'low');
  });

  test('prices live in one table by model, and the ledger charges what the model that ran costs', () => {
    // Cache reads are 0.05 times the input price on both 5.5 models (the pricing table on the prompt caching page): a tenth of a dollar on Sonnet, two tenths on Opus.
    assert.deepEqual(m.prices[SONNET], { prompt: 2, completion: 10, cacheRead: 0.1 });
    assert.deepEqual(m.prices[OPUS], { prompt: 4, completion: 20, cacheRead: 0.2 });
    assert.deepEqual(m.all.manager.pricing, m.prices[OPUS]);
    assert.deepEqual(m.all.builder.pricing, m.prices[OPUS]);
    assert.deepEqual(m.tools.search.pricing, m.prices[SONNET]);
    assert.deepEqual(computerRole(m, 'tester').pricing, m.prices[OPUS], 'the Tester\'s computer runs on Opus, charged at Opus\'s price, not Gemini\'s');
    const u = costOf({ input_tokens: 1e6, cache_read_input_tokens: 1e6, output_tokens: 1e6 }, m.prices[SONNET]);
    assert.ok(Math.abs(u.cost - (2 + 0.1 + 10)) < 1e-9, `cost ${u.cost}`);
  });
});

const pick = (r) => ({ model: r.model, effort: r.effort });
const tools = [{ name: 'write_file', description: 'd', input_schema: { type: 'object', properties: {} } }];

describe('the request each model gets', () => {
  test('Sonnet 5.5: adaptive thinking, no forced tool choice, and only the default fallback under its own beta', () => {
    const b = buildRequest({ model: SONNET, effort: 'high', maxTokens: 1000, system: 'S', messages: [{ role: 'user', content: 'hi' }], tools, toolChoice: { type: 'any' } });
    assert.deepEqual(b.thinking, { type: 'adaptive' });
    assert.deepEqual(b.tool_choice, { type: 'auto' });
    assert.equal(b.fallbacks, 'default');
    assert.deepEqual(b.betas, ['server-side-fallback-2026-07-01']);
    assert.equal(FALLBACK_BETA, 'server-side-fallback-2026-07-01');
    assert.deepEqual(b.output_config, { effort: 'high' });
    assert.deepEqual(b.cache_control, { type: 'ephemeral' });
    // Thinking off is between_tools at high or below, and adaptive above that. Never 'disabled'.
    assert.deepEqual(buildRequest({ model: SONNET, effort: 'high', maxTokens: 10, messages: [], thinking: 'off' }).thinking, { type: 'between_tools' });
    assert.deepEqual(buildRequest({ model: SONNET, effort: 'xhigh', maxTokens: 10, messages: [], thinking: 'off' }).thinking, { type: 'adaptive' });
    assert.equal(buildRequest({ model: SONNET, maxTokens: 10, messages: [], tools, toolChoice: { type: 'tool', name: 'write_file' } }).tool_choice.type, 'auto');
  });

  test('Opus 5.5: thinking can\'t be switched off and forced tools become auto; Haiku has no server-side fallback', () => {
    const o = buildRequest({ model: OPUS, effort: 'xhigh', maxTokens: 10, messages: [], tools, toolChoice: { type: 'tool', name: 'write_file', disable_parallel_tool_use: true }, thinking: 'off' });
    assert.deepEqual(o.thinking, { type: 'adaptive' });
    assert.deepEqual(o.tool_choice, { type: 'auto', disable_parallel_tool_use: true });
    assert.equal(o.fallbacks, 'default');
    const h = buildRequest({ model: 'claude-haiku-5-5', effort: 'low', maxTokens: 10, messages: [] });
    assert.equal(h.fallbacks, undefined); assert.equal(h.betas, undefined);
    assert.equal(modelShape('claude-haiku-5-5').forcedToolChoice, true);
    // No model is ever sent the array form of fallbacks.
    for (const model of [OPUS, SONNET, 'claude-haiku-5-5']) assert.ok(!Array.isArray(buildRequest({ model, maxTokens: 1, messages: [] }).fallbacks), model);
  });

  test('the client sends that shape through the real SDK: tools, the fallback beta header, nothing forced', async () => {
    const seen = [];
    const srv = http.createServer((req, res) => {
      let body = ''; req.on('data', (c) => { body += c; });
      req.on('end', () => {
        seen.push({ url: req.url, beta: req.headers['anthropic-beta'], body: JSON.parse(body) });
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
        ev('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model: SONNET, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } });
        ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
        ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'OK' } });
        ev('content_block_stop', { index: 0 });
        ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } });
        ev('message_stop', {});
        res.end();
      });
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    try {
      const cfg = loadConfig({ ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${srv.address().port}` });
      const route = routeFor(m, 'builder', { autonomous: true });
      const fnTool = { type: 'function', function: { name: 'write_file', description: 'Write a file', parameters: { type: 'object', properties: { path: { type: 'string' } } } } };
      const r = await createAnthropicClient(cfg).chat({ model: route.model, effort: route.effort, maxTokens: 64, messages: [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'Say OK.' }], tools: [fnTool], pricing: route.pricing });
      assert.equal(r.content, 'OK');
      const [req] = seen;
      assert.match(req.url, /\/v1\/messages/);
      assert.match(req.beta, /server-side-fallback-2026-07-01/);
      assert.doesNotMatch(req.beta, /server-side-fallback-2026-06-01/);
      assert.equal(req.body.model, SONNET); assert.equal(req.body.fallbacks, 'default'); assert.equal(req.body.betas, undefined, 'the beta goes in the header');
      assert.deepEqual(req.body.thinking, { type: 'adaptive' }); assert.equal(req.body.tool_choice, undefined);
      assert.deepEqual(req.body.output_config, { effort: 'high' });
      assert.equal(req.body.tools[0].name, 'write_file');
      assert.ok(Math.abs(r.usage.cost - (10 * 2 + 2 * 10) / 1e6) < 1e-12, 'charged at Sonnet\'s price');
    } finally { srv.close(); }
  });
});
