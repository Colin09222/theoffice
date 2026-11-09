// A few small real calls to Claude through the app's own request builder, to prove the prompt cache is doing what server/anthropic.js says:
// the system prompt is written once and read back by a call with different messages, the second step of a loop reads the first, and the
// keep-alive (max_tokens 0) is accepted and bills only a cache read. Prints the usage meters of each call, never the key. Costs a few cents.
//   ANTHROPIC_KEY_FILE=/path/to/key node scripts/proof-cache.mjs [role]
// Exits 1 if the cache was not read where it should have been.
import { readFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { loadConfig, loadModels, routeFor } from '../server/config.js';
import { buildRequest, costOf } from '../server/anthropic.js';
import { computerPrompt } from '../server/prompts.js';

const keyFile = process.env.ANTHROPIC_KEY_FILE;
if (!keyFile) { console.error('Set ANTHROPIC_KEY_FILE.'); process.exit(2); }
const key = readFileSync(keyFile, 'utf8').trim();
const cfg = loadConfig({ ANTHROPIC_API_KEY: key });
const models = loadModels();
const roleKey = process.argv[2] || 'builder';
const route = routeFor(models, roleKey);
const client = new Anthropic({ apiKey: key, maxRetries: 0 });
// A real, long, stable prompt, with a line that makes this run's cache its own so an earlier run can't flatter it.
const system = `${computerPrompt(cfg, roleKey, models.all[roleKey])}\n\nProof run ${Date.now()}.`;
const meters = (u) => ({ input: u.input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, output: u.output_tokens || 0, usd: Number(costOf(u, route.pricing).cost.toFixed(5)) });
const send = async (label, messages, extra = {}) => {
  const body = { ...buildRequest({ model: route.model, effort: 'low', maxTokens: 2000, system, messages, stream: false }), ...extra };
  const { betas, ...rest } = body;
  const msg = await client.beta.messages.create({ ...rest, ...(betas ? { betas } : {}) });
  console.log(label, JSON.stringify(meters(msg.usage)));
  return msg;
};

let bad = 0;
try {
  const first = [{ role: 'user', content: 'Reply with the single word: one.' }];
  const a = await send('1. first call (writes the cache)      ', first);
  const second = [...first, { role: 'assistant', content: a.content }, { role: 'user', content: 'Now reply with the single word: two.' }];
  const b = await send('2. next step of the same loop (reads) ', second);
  if (!b.usage.cache_read_input_tokens) { bad++; console.log('   NOT READ: step 2 read nothing from the cache'); }
  const c = await send('3. other messages, same system (reads)', [{ role: 'user', content: 'Reply with the single word: three.' }]);
  if (!c.usage.cache_read_input_tokens) { bad++; console.log('   NOT READ: a call with different messages did not read the system prompt'); }
  try {
    const d = await send('4. keep-alive, max_tokens 0 (reads)   ', second, { max_tokens: 0 });
    if (!d.usage.cache_read_input_tokens || d.usage.output_tokens) { bad++; console.log('   UNEXPECTED: the keep-alive should read the cache and write no reply'); }
  } catch (e) { bad++; console.log('4. keep-alive REJECTED', String(e?.message || e).replace(key, '[key]').slice(0, 300), '\n   Set CACHE_KEEP_WARM=0 until this is sorted out; a refused keep-alive is never retried within a call and costs nothing.'); }
} catch (e) {
  console.log('REJECTED', String(e?.message || e).replace(key, '[key]').slice(0, 300));
  process.exit(1);
}
console.log(bad ? `${bad} thing(s) not as expected` : 'OK: the system prompt, the loop and the keep-alive all read from the cache');
process.exitCode = bad ? 1 : 0;
