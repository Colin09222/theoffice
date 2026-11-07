// Screenshots of the filler companies in real headless Chrome: the lobby directory with the demo tags, and a filler floor
// seen by a visitor, on desktop and phone. Usage: node scripts/shots-filler.mjs
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, sleep } from '../test/browser/cdp.mjs';
import { boot, claim } from '../test/helpers.js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../media');
mkdirSync(OUT, { recursive: true });
const t = await boot({ fillerCompanies: true, fillerTickMs: 700, mockDelayMs: 300, rateScale: 50 });
// One real floor too, so the ticker mixes real work with the filler chatter.
const real = await claim(t, 'Night Bakery', { body: { tagline: 'Warm ideas, baked overnight', colors: { primary: '#7a4bb5', accent: '#f4c95d' } } });
await real.post(`/api/floors/${real.slug}/chat`, { text: 'go build midnight rolls' });
await sleep(6000);
const base = `http://localhost:${t.port}/theoffice`;
const floors = (await real.get('/api/floors')).data.floors;
const fillers = floors.filter((f) => f.filler);
console.log('filler floors:', fillers.map((f) => `${f.number} ${f.name}`).join(' | '));
const first = fillers[0];
for (const [label, opts] of [['desktop', { width: 1440, height: 900 }], ['phone', { mobile: true }]]) {
  const b = await launch();
  const p = await b.newPage(opts);
  await p.goto(`${base}/`);
  await p.until('document.documentElement.classList.contains("ready")', 'ready');
  await sleep(2500);
  if (label === 'phone') { await p.click('.sheet-grip'); await sleep(600); }
  const tags = await p.ev('document.querySelectorAll(".demo-tag").length');
  console.log(`${label}: ${tags} demo tags in the directory`);
  await p.shot(join(OUT, `plus-filler-lobby-${label}.jpg`));
  await p.goto(`${base}/floor/${first.slug}`);
  await p.until('document.body.dataset.page === "floor" && !!window.__office', 'filler floor');
  await sleep(4500);
  const note = await p.ev('document.querySelector(".visitor-note")?.textContent');
  const feed = await p.ev('window.__office.state.feed.length');
  const login = await p.ev('!!document.querySelector(".controls .btn")');
  console.log(`${label}: note "${note}", feed ${feed} items, login button ${login}`);
  await p.shot(join(OUT, `plus-filler-floor-${label}.jpg`));
  b.close();
}
await t.close();
process.exit(0);
