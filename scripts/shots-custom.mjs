// Reproduces media/custom-floor-*.jpg: each vibe as a boss would see it, at both sizes, with a full crew hard at it. Run on Node 22.
import { launch, sleep } from '../test/browser/cdp.mjs';
import { boot, claim } from '../test/helpers.js';
import { VIBES } from '../public/js/looks.js';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

const OUT = process.env.OUT || 'media'; mkdirSync(OUT, { recursive: true });
const NAMES = { serious: ['Hale & Hale', 'Quiet advice for small firms'], silly: ['Duck Ltd', 'Serious about nonsense'], punk: ['Bad Wiring', 'Loud little software'], corporate: ['Synergex', 'Delivering aligned outcomes'], cosy: ['Slow Pottery', 'Things made slowly'], dreamy: ['Moonlight Co', 'Soft things for late hours'] };
const CREWS = [
  { hat: 'beret', wear: 'scarf', body: 'female-e' }, { hat: 'none', glasses: 'round', body: 'male-a' }, { hat: 'headphones', body: 'male-f' }, { hat: 'cap', body: 'female-b' },
  { hat: 'none', wear: 'tie', body: 'male-d' }, { hat: 'cowboy', body: 'male-c' }, { glasses: 'shades', body: 'female-f' }, { hat: 'party', body: 'female-c' }, { wear: 'beard', body: 'male-b' },
];
const only = process.argv.slice(2);
const t = await boot({ mockDelayMs: 1200, rateScale: 50 });
const base = `http://localhost:${t.port}/theoffice`;
for (const [label, opts, q] of [['desktop', { width: 1440, height: 900 }, 'mid'], ['phone', { mobile: true }, 'low']]) {
  const b = await launch(); const p = await b.newPage(opts);
  for (const [id, v] of Object.entries(VIBES)) {
    if (only.length && !only.includes(id)) continue;
    const c = await claim(t, `${NAMES[id][0]} ${label}`, { body: { tagline: NAMES[id][1], colors: v.colors } });
    for (const role of ['analyst', 'marketer']) await c.post(`/api/floors/${c.slug}/hire`, { role });
    const s = (await c.get(`/api/floors/${c.slug}`)).data;
    await c.post(`/api/floors/${c.slug}/customise`, { name: NAMES[id][0], decor: v.decor, colors: v.colors, identity: { tone: v.tone }, boss: { look: { hat: 'crown', wear: 'cape', body: 'female-d', outfit: 'suit', outfitColor: v.colors.primary } }, staff: s.agents.map((a, i) => ({ id: a.id, look: { ...CREWS[i % CREWS.length], outfitColor: i % 2 ? v.colors.primary : v.colors.accent } })) });
    await p.goto(base);
    await p.send('Network.setCookie', { name: 'office_s', value: c.cookies.office_s, url: `http://localhost:${t.port}/theoffice/`, path: '/theoffice', httpOnly: true, secure: true, sameSite: 'Lax' });
    await p.goto(`${base}/floor/${c.slug}?q=${q}`);
    await p.until('document.body.dataset.page === "floor" && window.__office?.view?.modelsOn === true && [...window.__office.view.actors.values()].every((a) => a.char.isModel)', 'floor', 60000);
    await c.post(`/api/floors/${c.slug}/chat`, { text: 'go build a tiny launch' });
    await p.until('window.__office.state.tasks.some((t) => t.status === "doing")', 'work', 30000);
    await sleep(2800);
    const st = await p.ev('({ calls: __stage.renderer.info.render.calls, tris: __stage.renderer.info.render.triangles })');
    console.log(label, id, v.decor.layout, st.calls, 'calls', st.tris, 'triangles');
    await p.shot(join(OUT, `custom-floor-${id}-${label}.jpg`));
  }
  console.log('errors', JSON.stringify(p.errors.filter((e) => !/status of 40/.test(e)).slice(0, 4)));
  p.close(); b.close();
}
await t.close();
process.exit(0);
