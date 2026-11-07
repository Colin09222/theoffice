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
  await p.until('__stage.frame > 8', 'frames', 120000);
  await sleep(1000);
  await p.shot(join(OUT, `floors2-quiet-${label}.jpg`));
  await c.post(`/api/floors/${c.slug}/chat`, { text: `go build ${label === 'desktop' ? 'midnight rolls' : 'morning buns'} [slow]` });
  // The renderer here is software, and slow. Run the room's clock by hand up to the moment worth seeing, then let it be drawn.
  const forward = (until) => p.ev(`new Promise((done) => { const t = setInterval(() => { const v = window.__office.view; for (let i = 0; i < 6; i++) { v.update(0.05); if (${until}) { clearInterval(t); done(true); return; } } }, 40); setTimeout(() => { clearInterval(t); done(false); }, 90000); })`);
  const hold = 'for (const a of window.__office.view.actors.values()) if (a.speech) { a.holdUntil += 60; } true';
  await forward('!!document.querySelector("#labels .char-bubble.speech:not([hidden])")');
  await p.ev(hold);
  await sleep(4000);
  await p.shot(join(OUT, `floors2-talking-${label}.jpg`));
  await p.ev('for (const a of window.__office.view.actors.values()) if (a.speech) a.holdUntil = 0; true');
  await forward('[...window.__office.view.actors.values()].some((a) => a.speech && a.info.id !== window.__office.view.manager.info.id)');
  await p.ev(hold);
  await sleep(4000);
  await p.shot(join(OUT, `floors2-handoff-${label}.jpg`));
  await p.ev('for (const a of window.__office.view.actors.values()) if (a.speech) a.holdUntil = 0; true');
  await p.click('[data-tab=talk]');
  await sleep(1500);
  await p.shot(join(OUT, `floors2-talk-tab-${label}.jpg`));
  if (label === 'desktop') {
    await p.click('.panel-close');
    for (const layout of ['open', 'studio', 'garage', 'lounge', 'pods']) {
      await c.post(`/api/floors/${c.slug}/customise`, { decor: { layout, coffee: true, plants: 4, arcade: layout === 'garage', rug: true } });
      await p.until(`window.__office.view.decor.layout === ${JSON.stringify(layout)}`, layout, 30000);
      await p.until('window.__office.view.modelsOn === true', 'furniture', 60000);
      const f0 = await p.ev('__stage.frame');
      await p.until(`__stage.frame > ${f0 + 4}`, 'frames', 60000);
      await sleep(1500);
      await p.shot(join(OUT, `floors2-layout-${layout}.jpg`));
    }
    await c.post(`/api/floors/${c.slug}/customise`, { decor: { layout: 'open' } });
  }
  // A visitor, arriving at a floor at work: the room, the card and the pill, with the panel shut.
  {
    const b2 = await launch(); const v = await b2.newPage(opts);  // a browser of their own: no boss's cookie
    await v.goto(`${base}/floor/${c.slug}?q=${Q}`);
    await v.until('document.body.dataset.page === "floor" && !!window.__office?.view', 'visitor floor');
    await v.until('window.__office.view.modelsOn === true', 'furniture', 60000);
    await c.post(`/api/floors/${c.slug}/chat`, { text: 'go build a small sign [slow]' });
    await v.ev(`new Promise((done) => { const t = setInterval(() => { const w = window.__office.view; for (let i = 0; i < 6; i++) { w.update(0.05); if ([...w.actors.values()].some((a) => a.speech)) { clearInterval(t); for (const a of w.actors.values()) if (a.speech) a.holdUntil += 60; done(true); return; } } }, 40); setTimeout(() => { clearInterval(t); done(false); }, 60000); })`);
    await sleep(4000);
    await v.shot(join(OUT, `floors2-visitor-${label}.jpg`));
    v.close(); b2.close();
  }
  const info = await p.ev(`(() => { const v = window.__office.view; return { rooms: [...v.actors.values()].map((a) => a.info.name + ':' + v.life.roomOf(a)).join(' '), calls: __stage.renderer.info.render.calls, tris: __stage.renderer.info.render.triangles, talk: window.__office.state.talk.length, errors: 0 }; })()`);
  console.log(label, JSON.stringify(info).slice(0, 400));
  if (p.errors.length) console.log('errors', p.errors.slice(0, 4).join(' | ').slice(0, 500));
  p.close(); b.close();
}
await t.close(); process.exit(0);
