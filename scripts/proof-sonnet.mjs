// One tiny real call to Claude Sonnet 5.5 through the app's own client and request builder, with a tool and the server-side fallback, to prove
// the API accepts the shape. Prints the shape and the answer, never the key. Costs a fraction of a cent.
//   ANTHROPIC_KEY_FILE=/path/to/key node scripts/proof-sonnet.mjs
import { readFileSync } from 'node:fs';
import { loadConfig, loadModels, routeFor } from '../server/config.js';
import { createAnthropicClient, buildRequest, toAnthropic } from '../server/anthropic.js';

const keyFile = process.env.ANTHROPIC_KEY_FILE;
if (!keyFile) { console.error('Set ANTHROPIC_KEY_FILE.'); process.exit(2); }
const key = readFileSync(keyFile, 'utf8').trim();
const cfg = loadConfig({ ANTHROPIC_API_KEY: key });
const route = routeFor(loadModels(), process.argv[2] || 'builder', { autonomous: true });
const tools = [{ type: 'function', function: { name: 'save_note', description: 'Save a short note for the team.', parameters: { type: 'object', properties: { note: { type: 'string', description: 'The note' } }, required: ['note'] } } }];
const messages = [{ role: 'system', content: 'You are a terse assistant in a test.' }, { role: 'user', content: 'Call save_note once with the note "ok", then stop.' }];

const conv = toAnthropic(messages, tools);
const shape = buildRequest({ model: route.model, effort: route.effort, maxTokens: 512, system: conv.system, messages: conv.messages, tools: conv.tools });
console.log('shape', JSON.stringify({ model: shape.model, effort: shape.output_config?.effort, thinking: shape.thinking, betas: shape.betas, fallbacks: shape.fallbacks, tool_choice: shape.tool_choice ?? null, tools: shape.tools.map((t) => t.name) }));
try {
  const r = await createAnthropicClient(cfg).chat({ model: route.model, effort: route.effort, maxTokens: 512, messages, tools, pricing: route.pricing });
  console.log('answer', JSON.stringify({ finish: r.finish, text: r.content.slice(0, 80), toolCalls: r.toolCalls.map((c) => ({ name: c.name, args: c.args.slice(0, 60) })), blocks: (r.rawContent || []).map((b) => b.type), tokensIn: r.usage.prompt, tokensOut: r.usage.completion }));
  console.log(r.toolCalls.some((c) => c.name === 'save_note') ? 'ACCEPTED: Sonnet 5.5 took the shape and called the tool' : 'ACCEPTED: Sonnet 5.5 took the shape');
} catch (e) {
  console.log('REJECTED', String(e?.message || e).replace(key, '[key]').slice(0, 300));
  process.exitCode = 1;
}
