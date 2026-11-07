// Pictures of the living floor, for looking at by eye. `node scripts/shots-floors2.mjs [outdir] [q] [only]`
import { launch, sleep } from '../test/browser/cdp.mjs';
import { boot, claim } from '../test/helpers.js';
import { join } from 'node:path';

const OUT = process.argv[2] || 'media'; const Q = process.argv[3] || 'low'; const ONLY = process.argv[4] || '';
const t = await boot({ mockDelayMs: Number(process.env.SHOT_DELAY || 2200), rateScale: 50 });
const c = await claim(t, 'Night Bakery', { body: { tagline: 'Warm bread, late hours.', colors: { primary: '#7a4bb5', accent: '#f4c95d' } } });
const base = `http://localhost:${t.port}/theoffice`;
for (const [label, opts] of [['desktop', { width: 1440, height: 900 }], ['phone', { mobile: true }]]) {
  if (ONLY && ONLY !== label) continue;
  const b = await launch(); const p = await b.newPage(opts);
  await p.goto(base);
  await p.send('Network.setCookie', { name: 'office_s', value: c.cookies.office_s, url: `http://localhost:${t.port}/theoffice/`, path: '/theoffice', httpOnly: true, secure: true, sameSite: 'Lax' });
  await p.goto(`${base}/floor/${c.slug}?q=${Q}`);
  try { await p.until('document.body.dataset.page === "floor" && !!window.__office?.view', 'floor', 20000); } catch (e) { console.log('ERRORS', p.errors.slice(0, 5).join(' | ').slice(0, 900)); throw e; }
  await p.until('window.__office.view.modelsOn === true && [...window.__office.view.actors.values()].every((a) => a.char.isModel)', 'models', 60000);
  await sleep(1500);
  for (const a of (await p.ev('[...window.__office.view.actors.keys()]'))) await p.ev(`window.__office.view.actors.get(${JSON.stringify(a)}).idleTimer = 1e9; true`);
  await p.shot(join(OUT, `floors2-quiet-${label}.jpg`));
  await c.post(`/api/floors/${c.slug}/chat`, { text: `go build ${label === 'desktop' ? 'midnight rolls' : 'morning buns'}` });
  await p.until('!!document.querySelector("#labels .char-bubble.speech:not([hidden])")', 'a speech bubble', 60000);
  await sleep(600);
  await p.shot(join(OUT, `floors2-talking-${label}.jpg`));
  const info = await p.ev(`(() => { const v = window.__office.view; return { rooms: [...v.actors.values()].map((a) => a.info.name + ':' + v.life.roomOf(a)).join(' '), calls: __stage.renderer.info.render.calls, tris: __stage.renderer.info.render.triangles, talk: window.__office.state.talk.length, errors: 0 }; })()`);
  console.log(label, JSON.stringify(info).slice(0, 400));
  if (p.errors.length) console.log('errors', p.errors.slice(0, 4).join(' | ').slice(0, 500));
  p.close(); b.close();
}
await t.close(); process.exit(0);
