// A boss never reads the word "budget": money is the building manager's business. Only admin pages may say it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
// String literals only, so names like budgetStopped and role === 'budget' don't count.
const literals = (src) => [...src.matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g)].map((m) => m[0]);
const says = (s) => /\bbudget\b/i.test(s.replace(/\$\{[^}]*\}/g, '')) && !/^['"`]budget['"`]$/.test(s);

test('notices to the boss and order wait reasons never say budget', () => {
  for (const file of ['server/engine.js', 'server/orders.js', 'server/purchases.js', 'server/domains.js']) {
    const src = read(file);
    const told = [...src.matchAll(/(?:bossNotice|officeNotice|managerSays|backToBoss)\([^,]+,\s*(`(?:[^`\\]|\\.)*`|'(?:[^'\\]|\\.)*')/g)].map((m) => m[1]);
    for (const s of told) assert.ok(!says(s), `${file}: ${s}`);
  }
  const blocker = read('server/orders.js').match(/function blocker\(floor\) \{[\s\S]*?\n {2}\}/)[0];
  for (const s of literals(blocker)) assert.ok(!says(s), `orders.js blocker: ${s}`);
});

test('the boss\'s pages never say budget', () => {
  const pages = readdirSync(new URL('../public/js/', import.meta.url)).filter((f) => f.endsWith('.js') && f !== 'admin-ui.js');
  for (const f of pages) for (const s of literals(read(`public/js/${f}`))) assert.ok(!says(s), `public/js/${f}: ${s.slice(0, 120)}`);
});
