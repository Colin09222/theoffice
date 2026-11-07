#!/usr/bin/env node
// Build-time check: every model in config/models.json must exist on OpenRouter and support tools. Prints live prices. No key needed.
import { loadModels } from '../server/config.js';
const res = await fetch('https://openrouter.ai/api/v1/models');
if (!res.ok) { console.error(`OpenRouter /models said ${res.status}`); process.exit(2); }
const live = new Map((await res.json()).data.map((m) => [m.id, m]));
const { all } = loadModels(); let bad = 0;
const money = (v) => `$${(Number(v) * 1e6).toFixed(2)}`;
for (const [role, c] of Object.entries(all)) {
  if (c.provider === 'anthropic') { console.log(`ok   ${role.padEnd(12)} ${c.model} (Claude API)`); continue; }
  const m = live.get(c.model);
  if (!m) { console.log(`FAIL ${role}: ${c.model} not on OpenRouter`); bad++; continue; }
  if (!(m.supported_parameters || []).includes('tools')) { console.log(`FAIL ${role}: ${c.model} has no tool support`); bad++; continue; }
  console.log(`ok   ${role.padEnd(12)} ${c.model.padEnd(32)} ${money(m.pricing.prompt)} in, ${money(m.pricing.completion)} out per Mtok`);
}
// The brokers: a picture model that really outputs images, and a reviewer from another lab that really reads them.
const { tools } = loadModels();
const brokers = [['image', tools.image, (m) => (m.architecture?.output_modalities || []).includes('image')], ['review', tools.review, (m) => (m.architecture?.input_modalities || []).includes('image') && !/^anthropic\//.test(m.id)]];
for (const [name, t, fits] of brokers) {
  const m = t && live.get(t.model);
  if (!m) { console.log(`FAIL ${name}: ${t?.model} not on OpenRouter`); bad++; continue; }
  if (!fits(m)) { console.log(`FAIL ${name}: ${t.model} can't do this job`); bad++; continue; }
  console.log(`ok   ${name.padEnd(12)} ${t.model.padEnd(32)} ${money(m.pricing.prompt)} in, ${money(m.pricing.completion)} out per Mtok`);
}
process.exit(bad ? 1 : 0);
