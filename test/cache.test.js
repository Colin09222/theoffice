// What a tool loop sends to Claude, step after step, has to be readable from the prompt cache: the same bytes as last time, with a breakpoint that
// moves to the newest turn. These tests hold that down without a real API call: they build the requests the engine would send and compare them.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { buildRequest, toAnthropic, costOf, createAnthropicClient, KEEP_WARM_MS } from '../server/anthropic.js';
import { withFiles, MAX_FILE_BLOCKS, KEPT_FILE_BLOCKS } from '../server/attachments.js';
import { compact, trimSteps } from '../server/engine.js';
import { openDb, run } from '../server/db.js';
import { loadConfig, loadModels } from '../server/config.js';
import { sleep } from './helpers.js';

const OPUS = 'claude-opus-5-5';
const TOOLS = [{ type: 'function', function: { name: 'read_file', description: 'Read', parameters: { type: 'object', properties: { path: { type: 'string' } } } } }, { type: 'function', function: { name: 'view_file', description: 'View', parameters: { type: 'object', properties: { path: { type: 'string' } } } } }];
// The request the engine's loop would send for this history: compact(), the files, the Messages API shape, then the body.
const requestFor = (db, messages) => {
  const c = toAnthropic(withFiles(db, 1, compact(messages), 'anthropic'), TOOLS);
  return buildRequest({ model: OPUS, effort: 'xhigh', maxTokens: 24000, system: c.system, messages: c.messages, tools: c.tools });
};
const markers = (body) => JSON.stringify(body).split('"cache_control"').length - 1;
const isPrefix = (a, b) => a.length <= b.length && a.every((m, i) => JSON.stringify(m) === JSON.stringify(b[i]));
// One step of a loop: the model's turn (thinking and all, replayed verbatim) and the answer to its tool call.
const step = (n, name, args, result, files) => [
  { role: 'assistant', content: null, tool_calls: [{ id: `t${n}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }], anthropic_content: [{ type: 'thinking', thinking: '', signature: `sig${n}` }, { type: 'tool_use', id: `t${n}`, name, input: args }] },
  { role: 'tool', tool_call_id: `t${n}`, content: result, ...(files ? { files } : {}) },
];
const PNG = (n) => { const b = Buffer.alloc(64 + n); Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').copy(b); b.writeUInt32BE(8, 16); b.writeUInt32BE(8, 20); b[63] = n; return b; };
const picture = (db, path, n, at = 1) => run(db, 'INSERT INTO files (floor_id,path,content,size,updated_at) VALUES (1,?,?,?,?) ON CONFLICT(floor_id,path) DO UPDATE SET content=excluded.content, size=excluded.size', path, new Uint8Array(PNG(n)), 64 + n, at);
const imagesIn = (body) => body.messages.flatMap((m, i) => (Array.isArray(m.content) ? m.content : []).flatMap((b) => (b.type === 'tool_result' && Array.isArray(b.content) ? b.content : [b]).filter((x) => x.type === 'image').map(() => i)));

describe('where the cache breakpoints go', () => {
  test('a call caches its system prompt by name and its newest turn by itself, and uses two of the four breakpoints', () => {
    const b = buildRequest({ model: OPUS, effort: 'high', maxTokens: 100, system: 'You are the Office Manager.', messages: [{ role: 'user', content: 'hi' }], tools: [{ name: 'x', description: 'd', input_schema: { type: 'object' } }] });
    // Tools render before system, so the marker on the system prompt covers both, whatever the messages turn out to be.
    assert.deepEqual(b.system, [{ type: 'text', text: 'You are the Office Manager.', cache_control: { type: 'ephemeral' } }]);
    // The top-level field is the API's moving breakpoint: it lands on the last block of whatever is sent.
    assert.deepEqual(b.cache_control, { type: 'ephemeral' });
    assert.equal(markers(b), 2); assert.ok(markers(b) <= 4);
    assert.ok(!JSON.stringify(b.tools).includes('cache_control') && !JSON.stringify(b.messages).includes('cache_control'), 'nothing is marked by hand in the conversation, so nothing has to be unmarked on the next step');
  });

  test('a one-off question keeps only what comes before it, and a call that shares nothing caches nothing', () => {
    const one = buildRequest({ model: OPUS, maxTokens: 100, system: 'Who you are and what you know.', messages: [{ role: 'user', content: 'a question nobody will ask again' }], cache: 'system' });
    assert.equal(one.cache_control, undefined, 'the question is not written to the cache');
    assert.deepEqual(one.system[0].cache_control, { type: 'ephemeral' });
    const none = buildRequest({ model: OPUS, maxTokens: 100, system: 'S', messages: [{ role: 'user', content: 'q' }], cache: false });
    assert.equal(none.system, 'S'); assert.equal(markers(none), 0);
    assert.equal(buildRequest({ model: OPUS, maxTokens: 100, messages: [{ role: 'user', content: 'q' }] }).system, undefined, 'no system prompt, no block for one');
  });

  test('a cache write is charged at its own rate: 1.25 times for five minutes, twice for an hour', () => {
    const price = { prompt: 4, completion: 20, cacheRead: 0.2 };
    const five = costOf({ input_tokens: 0, cache_creation_input_tokens: 1e6, cache_read_input_tokens: 1e6, output_tokens: 0 }, price);
    assert.ok(Math.abs(five.cost - (5 + 0.2)) < 1e-9);
    const hour = costOf({ input_tokens: 0, cache_creation_input_tokens: 1e6, cache_creation: { ephemeral_5m_input_tokens: 4e5, ephemeral_1h_input_tokens: 6e5 }, cache_read_input_tokens: 0, output_tokens: 0 }, price);
    assert.ok(Math.abs(hour.cost - (0.4 * 5 + 0.6 * 8)) < 1e-9, `cost ${hour.cost}`);
  });
});

describe('a tool loop, step after step', () => {
  test('step N sends step N-1 unchanged and adds to the end, so the breakpoint on its newest turn reads everything before it', () => {
    const db = openDb(':memory:');
    const messages = [{ role: 'system', content: 'You are the Designer.' }, { role: 'user', content: 'Task #1: a poster' }];
    const sent = [requestFor(db, messages)];
    for (let n = 1; n <= 6; n++) {
      messages.push(...step(n, 'read_file', { path: `notes/${n}.md` }, `<untrusted_data source="workspace:notes/${n}.md">\n${'words '.repeat(50)}\n</untrusted_data>`));
      sent.push(requestFor(db, messages));
    }
    for (let n = 1; n < sent.length; n++) {
      const before = sent[n - 1], now = sent[n];
      assert.deepEqual(now.system, before.system, 'the system prompt is the same bytes on every step');
      assert.deepEqual(now.tools, before.tools, 'and so are the tools');
      assert.ok(isPrefix(before.messages, now.messages), `step ${n} begins with exactly what step ${n - 1} sent`);
      assert.equal(now.messages.length, before.messages.length + 2, 'and adds one turn and its results');
      // The moving breakpoint: the top-level field puts it on the last block sent, which is the newest tool result.
      assert.deepEqual(now.cache_control, { type: 'ephemeral' });
      assert.equal(now.messages.at(-1).role, 'user'); assert.equal(now.messages.at(-1).content.at(-1).type, 'tool_result');
      assert.equal(now.messages.at(-1).content.at(-1).tool_use_id, `t${n}`, 'the latest turn is the last thing in the request');
      assert.deepEqual(now.output_config, before.output_config); assert.deepEqual(now.thinking, before.thinking);
      assert.equal(markers(now), 2);
    }
    // Each step adds an assistant turn and one run of results: far inside the twenty positions a breakpoint looks back over.
    assert.ok(sent.at(-1).messages.length - sent.at(-2).messages.length < 20);
    db.close();
  });

  test('looking at more pictures never rewrites an earlier step, until a whole batch goes at once', () => {
    const db = openDb(':memory:');
    const messages = [{ role: 'system', content: 'You are the Designer.' }, { role: 'user', content: 'Task #1: pictures' }];
    let last = requestFor(db, messages); let rewrites = 0; const shownAt = [];
    for (let n = 1; n <= MAX_FILE_BLOCKS + KEPT_FILE_BLOCKS + 2; n++) {
      picture(db, `projects/p/images/${n}.png`, n);
      messages.push(...step(n, 'view_file', { path: `projects/p/images/${n}.png` }, `projects/p/images/${n}.png follows.`, [`projects/p/images/${n}.png`]));
      const now = requestFor(db, messages);
      if (!isPrefix(last.messages, now.messages)) rewrites++;
      shownAt.push(imagesIn(now).length);
      last = now;
    }
    // The old rule kept the newest six and took one out of the middle of history for every picture after that: a dozen rewrites here.
    assert.equal(rewrites, 2, 'one rewrite per batch let go, not one per picture');
    assert.equal(Math.max(...shownAt), MAX_FILE_BLOCKS);
    assert.ok(shownAt.every((n, i) => n === Math.min(i + 1, MAX_FILE_BLOCKS) || n <= MAX_FILE_BLOCKS), 'nothing is dropped before the limit');
    assert.equal(shownAt[MAX_FILE_BLOCKS], KEPT_FILE_BLOCKS, 'the thirteenth picture lets the oldest go, all at once');
    assert.ok(imagesIn(last).length >= KEPT_FILE_BLOCKS, 'the newest are always there to see');
    // Run again from the same history, as after a restart, and the same request comes out: the decision depends on nothing but the history.
    assert.deepEqual(requestFor(db, JSON.parse(JSON.stringify(messages))).messages, last.messages);
    db.close();
  });

  test('a picture looked at twice stays where it was first shown, and one saved again under the same name does not change what was seen', () => {
    const db = openDb(':memory:');
    picture(db, 'projects/p/images/hero.png', 1);
    const messages = [{ role: 'system', content: 'S' }, { role: 'user', content: 'Task' }, ...step(1, 'view_file', { path: 'projects/p/images/hero.png' }, 'hero.png follows.', ['projects/p/images/hero.png'])];
    const first = requestFor(db, messages);
    assert.deepEqual(imagesIn(first), [2]);
    // Looked at again, unchanged: the picture is not moved to the later message, and not sent a second time.
    messages.push(...step(2, 'view_file', { path: 'projects/p/images/hero.png' }, 'hero.png follows.', ['projects/p/images/hero.png']));
    const second = requestFor(db, messages);
    assert.ok(isPrefix(first.messages, second.messages), 'the first look is still where it was');
    assert.deepEqual(imagesIn(second), [2]);
    assert.match(JSON.stringify(second.messages.at(-1)), /same file you were shown earlier/);
    // Made again under the same name: the earlier step still shows what it showed, and the new look shows the new picture.
    picture(db, 'projects/p/images/hero.png', 2, 5);
    messages.push(...step(3, 'view_file', { path: 'projects/p/images/hero.png' }, 'hero.png follows.', ['projects/p/images/hero.png']));
    const third = requestFor(db, messages);
    assert.ok(isPrefix(second.messages, third.messages), 'history did not change when the file did');
    assert.deepEqual(imagesIn(third), [2, 6]);
    const data = (body, i) => body.messages[i].content[0].content.find((b) => b.type === 'image').source.data;
    assert.equal(data(third, 2), PNG(1).toString('base64')); assert.equal(data(third, 6), PNG(2).toString('base64'));
    // The saved transcript holds paths only, as before: nothing of the picture is written to the database.
    assert.ok(!JSON.stringify(compact(messages)).includes(PNG(1).toString('base64')));
    db.close();
  });

  test('dropping old steps is the one rewrite a long job makes, and what is left is sent the same way from then on', () => {
    const db = openDb(':memory:');
    const messages = [{ role: 'system', content: 'S' }, { role: 'user', content: 'Task' }];
    for (let n = 1; n <= 12; n++) messages.push(...step(n, 'read_file', { path: `f${n}` }, 'x'.repeat(30000)));
    assert.ok(trimSteps(messages, 2).length > 0, 'the oldest steps went');
    const a = requestFor(db, messages);
    messages.push(...step(13, 'read_file', { path: 'f13' }, 'short'));
    assert.equal(trimSteps(messages, 2).length, 0, 'and nothing more goes on the very next step');
    assert.ok(isPrefix(a.messages, requestFor(db, messages).messages));
    db.close();
  });
});

describe('a long reply does not let the cache behind it expire', () => {
  const server = async ({ cached, holdMs }) => {
    const seen = [];
    const srv = http.createServer((req, res) => {
      let body = ''; req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        const b = JSON.parse(body); seen.push(b);
        if (!b.stream) {
          // The keep-alive: no reply, only the prefix read back from the cache.
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ id: 'msg_w', type: 'message', role: 'assistant', model: OPUS, content: [], stop_reason: 'max_tokens', stop_sequence: null, usage: { input_tokens: 0, cache_read_input_tokens: cached, cache_creation_input_tokens: 0, output_tokens: 0 } }));
          return;
        }
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
        ev('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model: OPUS, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, cache_read_input_tokens: cached, cache_creation_input_tokens: 0, output_tokens: 1 } } });
        ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
        await sleep(holdMs);
        ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'OK' } });
        ev('content_block_stop', { index: 0 });
        ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } });
        ev('message_stop', {});
        res.end();
      });
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    return { srv, seen, base: `http://127.0.0.1:${srv.address().port}` };
  };
  const pricing = loadModels().prices[OPUS];
  const ask = (cfg) => createAnthropicClient(cfg).chat({ model: OPUS, effort: 'xhigh', maxTokens: 64, messages: [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'Say OK.' }], pricing });

  test('while a reply is still being written, the same request goes out again with max_tokens 0, and its cache read is charged', async () => {
    assert.equal(KEEP_WARM_MS, 4 * 60_000, 'inside the cache\'s five minutes');
    const { srv, seen, base } = await server({ cached: 50000, holdMs: 220 });
    try {
      const cfg = { ...loadConfig({ ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: base }), cacheKeepWarmMs: 60 };
      const r = await ask(cfg);
      assert.equal(r.content, 'OK');
      const [main, ...warm] = seen;
      assert.ok(warm.length >= 1, 'it was kept warm');
      for (const w of warm) {
        assert.equal(w.max_tokens, 0); assert.equal(w.stream, false);
        // The same prefix, byte for byte, or it would read nothing and write a second copy.
        for (const k of ['model', 'system', 'messages', 'thinking', 'output_config', 'cache_control']) assert.deepEqual(w[k], main[k], k);
      }
      // One sent just as the reply ended may not have come back in time to count, so the bill is checked against the ones that did.
      const answered = (r.usage.prompt - 10 - 50000) / 50000;
      assert.ok(Number.isInteger(answered) && answered >= 1 && answered <= warm.length, `answered ${answered} of ${warm.length}`);
      const reads = answered * 50000;
      assert.ok(Math.abs(r.usage.cost - ((10 * pricing.prompt + 50000 * pricing.cacheRead + 2 * pricing.completion) + reads * pricing.cacheRead) / 1e6) < 1e-9, 'the call and each cache read are on the bill');
      assert.equal(r.usage.prompt, 10 + 50000 + reads);
      // Nothing is left ticking once the reply is in.
      await sleep(150); const n = seen.length; await sleep(200); assert.equal(seen.length, n);
    } finally { srv.close(); }
  });

  test('not for a prefix too small to matter, and not when it is switched off', async () => {
    for (const [cached, extra] of [[100, {}], [50000, { cacheKeepWarm: false }]]) {
      const { srv, seen, base } = await server({ cached, holdMs: 200 });
      try {
        await ask({ ...loadConfig({ ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: base }), cacheKeepWarmMs: 50, ...extra });
        assert.equal(seen.length, 1, `cached ${cached}`);
      } finally { srv.close(); }
    }
    assert.equal(loadConfig({ CACHE_KEEP_WARM: '0' }).cacheKeepWarm, false); assert.equal(loadConfig({}).cacheKeepWarm, true);
  });

  test('a refused keep-alive is not tried again, and the reply still arrives', async () => {
    const seen = [];
    const srv = http.createServer((req, res) => {
      let body = ''; req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        const b = JSON.parse(body); seen.push(b);
        if (!b.stream) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'max_tokens: 0 is not supported here' } })); return; }
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
        ev('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model: OPUS, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, cache_read_input_tokens: 50000, output_tokens: 1 } } });
        ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
        await sleep(300);
        ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'OK' } });
        ev('content_block_stop', { index: 0 });
        ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } });
        ev('message_stop', {});
        res.end();
      });
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    try {
      const r = await ask({ ...loadConfig({ ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${srv.address().port}` }), cacheKeepWarmMs: 40 });
      assert.equal(r.content, 'OK');
      assert.equal(seen.filter((b) => !b.stream).length, 1, 'asked once, refused, left alone');
      assert.ok(Math.abs(r.usage.cost - (10 * pricing.prompt + 50000 * pricing.cacheRead + 2 * pricing.completion) / 1e6) < 1e-9, 'a refused request costs nothing');
    } finally { srv.close(); }
  });
});
