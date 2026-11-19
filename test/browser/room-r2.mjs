// Round 2, lane A, in a real browser: the floor room (docs/redesign/OFFICE-ANSWERS-2.md). Each check names its job. npm run e2e:room2
// ROOM2_ONLY=j31,j32 runs some of them; ROOM2_SHOTS=dir saves a picture of each.
import { launch, sleep } from './cdp.mjs';
import { boot, claim } from '../helpers.js';
import { get } from '../../server/db.js';
import { storeShot } from '../../server/shots.js';
import { REAL_JPEG, publish } from '../r2-fixtures.js';

const only = (process.env.ROOM2_ONLY || '').split(',').filter(Boolean);
const want = (j) => !only.length || only.includes(j);
const shots = process.env.ROOM2_SHOTS || '';
const t = await boot({ mockDelayMs: 50 });
const base = `http://localhost:${t.port}/theoffice`;
const b = await launch({});
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };

/** Room time, stepped by hand through the room's own update(): software rendering here runs the room clock at a few percent of real time. */
const step = (p, secs, each = '') => p.ev(`(() => { const v = window.__office.view; for (let i = 0; i < ${secs} * 10; i++) { v.update(0.1); ${each} } })()`);
async function openRoom(slug, opts = {}) {
  const p = await b.newPage(opts);
  await p.goto(`${base}/floor/${slug}`);
  await p.until('document.body.dataset.page === "floor" && !!window.__office?.view?.manager', 'room', 120000);
  return p;
}

try {
  if (want('j31')) {
    // r2-j31: on an Idle floor no bean types and at least one idle move plays within 20 s.
    const boss = await claim(t, 'Quiet Corner');
    const p = await openRoom(boss.slug);
    await p.ev('window.__seen = { moves: [], typed: 0, glow: 0 }');
    await step(p, 20, "for (const a of v.actors.values()) { if (a.action?.idleMove && a.path.length === 0) window.__seen.moves.push(a.action.idleMove); if (a.char.anim === 'type' || a.char.blend.type > 0.5) window.__seen.typed++; if (a.seat.glow?.visible) window.__seen.glow++; }");
    await sleep(1500);
    const seen = await p.ev('({ ...window.__seen, idle: window.__office.view.life.wasIdle, state: window.__office.view.floorState })');
    check(seen.state === 'idle' && seen.idle === true, `j31 the room knows the floor is Idle (${seen.state})`);
    check(seen.moves.length > 0, `j31 an idle move played within 20 s of room time (${[...new Set(seen.moves)].join(', ')})`);
    check(seen.typed === 0, `j31 nobody typed (${seen.typed})`);
    check(seen.glow === 0, `j31 no monitor glowed (${seen.glow})`);
    check(!p.errors.length, `j31 no page errors ${p.errors.slice(0, 2).join(' | ')}`);
    if (shots) await p.shot(`${shots}/r2-j31-idle.jpg`);
  }
  if (want('j32')) {
    // r2-j32: floor 6's wall shows one frame with the real TheTireRx photo.
    const six = await claim(t, 'TheTireRx', { floor: 6 });
    const f = get(t.db, 'SELECT * FROM floors WHERE slug=?', six.slug);
    publish(t.db, f.id, 'thetirerx', 'TheTireRx', Date.now() - 3600000);
    storeShot(t.db, { floorId: f.id, project: 'thetirerx', image: REAL_JPEG, url: 'https://thetirerx.com/' });
    const p = await openRoom(six.slug);
    await p.until('window.__office.view.frameMeshes?.[0]?.userData.photo', 'the photo in the frame', 30000);
    const r = await p.ev('(() => { const v = window.__office.view; return { n: v.frameMeshes.length, photo: v.frameMeshes[0].userData.photo, launch: v.frameMeshes[0].userData.launch, w: v.frameMeshes[0].material.map.image.width, low: v.low, more: !!v.frameMore }; })()');
    check(r.n === 1 && r.launch === 'thetirerx' && !r.more, `j32 one frame on floor 6's wall, for TheTireRx (${r.n}, ${r.launch})`);
    check(/\/api\/building\/shot\/[^/]+\/thetirerx\?v=/.test(r.photo) && r.w === (r.low ? 256 : 512), `j32 it shows the real launch photo (${r.photo}, ${r.w}px${r.low ? ', phone low' : ''})`);
    if (shots) {
      // Turn to the side wall and close in on the frame for the picture.
      await p.ev('(() => { const v = window.__office.view; const m = v.frameMeshes[0]; v.targetYaw = v.yaw = 1.3; v.targetZoom = v.zoom = 3.2; v.targetPan.set(m.position.x + 3, m.position.z); v.pan.copy(v.targetPan); })()');
      await sleep(2500); await p.shot(`${shots}/r2-j32-frames.jpg`);
    }
    check(!p.errors.length, `j32 no page errors ${p.errors.slice(0, 2).join(' | ')}`);
  }
} finally {
  b.close(); await t.close();
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
