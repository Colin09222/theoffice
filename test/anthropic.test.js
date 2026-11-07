// The Claude client's pure parts: message conversion, cost with caching, truncated tool calls, routing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toAnthropic, costOf, toolCallsOf, createRouter } from '../server/anthropic.js';
import { scrub } from '../server/llm.js';
import { compact } from '../server/engine.js';

test('system goes top-level, tool results merge into one user message', () => {
  const r = toAnthropic([
    { role: 'system', content: 'S' }, { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'ok', tool_calls: [{ id: 'a', function: { name: 'x', arguments: '{"p":1}' } }, { id: 'b', function: { name: 'y', arguments: 'bad' } }] },
    { role: 'tool', tool_call_id: 'a', content: 'one' }, { role: 'tool', tool_call_id: 'b', content: 'two' },
  ], [{ function: { name: 'x', description: 'd', parameters: { type: 'object' } } }]);
  assert.equal(r.system, 'S');
  assert.equal(r.messages.length, 3);
  assert.deepEqual(r.messages[1].content[1], { type: 'tool_use', id: 'a', name: 'x', input: { p: 1 } });
  assert.deepEqual(r.messages[1].content[2].input, {});
  assert.deepEqual(r.messages[2].content.map((b) => b.tool_use_id), ['a', 'b']);
  assert.equal(r.tools[0].input_schema.type, 'object');
});

test('replayed turns stay verbatim even after compact() shrinks old tool calls', () => {
  const raw = [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'tool_use', id: 'a', name: 'write_file', input: { path: 'f', content: 'x'.repeat(500) } }];
  const msgs = [{ role: 'user', content: 'go' },
    { role: 'assistant', content: null, anthropic_content: raw, tool_calls: [{ id: 'a', function: { name: 'write_file', arguments: JSON.stringify(raw[1].input) } }] },
    { role: 'tool', tool_call_id: 'a', content: 'ok' }, { role: 'assistant', content: 'done' }];
  assert.deepEqual(toAnthropic(compact(msgs)).messages[1].content, raw);
});

test('cost counts cache writes and reads at their own rates', () => {
  const u = costOf({ input_tokens: 1e6, cache_creation_input_tokens: 1e6, cache_read_input_tokens: 1e6, output_tokens: 1e6 }, { prompt: 4, completion: 20, cacheRead: 0.2 });
  assert.equal(u.prompt, 3e6);
  assert.ok(Math.abs(u.cost - (4 + 5 + 0.2 + 20)) < 1e-9);
});

test('a tool call cut off by max_tokens comes back invalid', () => {
  const content = [{ type: 'tool_use', id: 'a', name: 'x', input: { path: 'half' } }];
  assert.throws(() => JSON.parse(toolCallsOf({ content, stop_reason: 'max_tokens' })[0].args));
  assert.deepEqual(JSON.parse(toolCallsOf({ content, stop_reason: 'tool_use' })[0].args), { path: 'half' });
});

test('router picks the provider and never leaks the replay field to OpenRouter', async () => {
  const seen = {};
  const r = createRouter({ anthropic: { chat: (a) => { seen.a = a; } }, openrouter: { chat: (a) => { seen.o = a; } } });
  const messages = [{ role: 'assistant', content: 'x', anthropic_content: [{ type: 'text', text: 'x' }] }];
  await r.chat({ provider: 'anthropic', messages }); await r.chat({ messages });
  assert.ok(seen.a.messages[0].anthropic_content);
  assert.equal(seen.o.messages[0].anthropic_content, undefined);
});

test('scrub removes both kinds of key', () => {
  const out = scrub('a sk-ant-usr-abc_123 b sk-or-v1-xyz c');
  assert.ok(!out.includes('abc_123') && !out.includes('xyz'));
});
