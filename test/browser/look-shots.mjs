// Screenshots for judging the look: the lobby and a busy demo floor at the sizes it is reviewed at, as a visitor sees them.
// LOOK_SHOTS=/some/dir (default ./look-shots). LOOK_SIZES=390x844,... picks sizes. LOOK_ONLY=lobby|floor. Nothing here is a test; it only saves pictures.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, sleep } from './cdp.mjs';
import { boot, claim } from '../helpers.js';

const OUT = process.env.LOOK_SHOTS || 'look-shots'; mkdirSync(OUT, { recursive: true });
const SIZES = (process.env.LOOK_SIZES || '390x844,360x640,430x932,844x390,1280x800').split(',').map((s) => s.split('x').map(Number));
const ONLY = process.env.LOOK_ONLY || '';
const TAG = process.env.LOOK_TAG || '';
const Q = process.env.LOOK_Q ? `?q=${process.env.LOOK_Q}` : "";
const t = await boot({ mockDelayMs: 2500, peopleTalk: true, towerFloors: 30, fillerCompanies: true, fillerTickMs: 2500 });
const base = `http://localhost:${t.port}/theoffice`;
const PALETTE = [['#2f6f62', '#f4c95d'], ['#6a4c93', '#f4c95d'], ['#c8392b', '#ffd27a'], ['#1d5fb8', '#9be3c8'], ['#d9774a', '#2a3a4a'], ['#37b679', '#1f2a44']];
const owners = {};
for (const [i, n] of [3, 4, 5, 7, 8, 11, 12, 15, 16, 19, 22, 26].entries()) { const [primary, accent] = PALETTE[i % PALETTE.length]; owners[n] = await claim(t, `Company ${n}`, { floor: n, body: { colors: { primary, accent } } }).catch(() => null); }
await sleep(1500);
const demo = t.db.prepare('SELECT slug, number FROM floors WHERE filler=1 ORDER BY number').all();
console.log('demo floors', JSON.stringify(demo));
const slugs = (process.env.LOOK_FLOORS ? process.env.LOOK_FLOORS.split(',') : [demo[0]?.slug || owners[3].slug]);
const b = await launch({});
for (const [w, h] of SIZES) {
  const phone = Math.min(w, h) < 500;
  const p = await b.newPage(phone ? { phone: { width: w, height: h } } : { width: w, height: h });
  try {
    if (ONLY !== 'floor') {
      await p.goto(`${base}/${Q}`);
      await p.until('document.body.dataset.page === "lobby" && !document.querySelector("#boot")', 'lobby', 60000);
      await sleep(Number(process.env.LOOK_WAIT || 5000));
      await p.shot(join(OUT, `${TAG}lobby-${w}x${h}.jpg`));
    }
    if (ONLY !== 'lobby') for (const [i, slug] of slugs.entries()) {
      await p.goto(`${base}/floor/${slug}${Q}`);
      await p.until('document.body.dataset.page === "floor" && !!window.__office?.state && !document.querySelector("#boot")', 'floor', 60000);
      await sleep(Number(process.env.LOOK_WAIT || 9000));
      await p.shot(join(OUT, `${TAG}floor${i || ''}-${w}x${h}.jpg`));
      console.log(w, h, JSON.stringify(await p.ev('({ tier: window.__stage?.tier, ok: !!window.__stage?.ok, dpr: window.__stage?.dpr, sheet: document.body.dataset.sheet })')));
    }
    if (p.errors.length) console.log('errors', w, h, p.errors.slice(0, 5));
  } catch (e) { console.log('FAILED', w, h, e.message); }
  p.close();
}
b.close(); await t.close(); process.exit(0);
