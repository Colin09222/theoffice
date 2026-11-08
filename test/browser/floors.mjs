// Browser checks for the walk-in office: the view API the floor UI relies on, reachable meeting spots, render budgets at both
// tiers, labels that sit above heads instead of over them, and a clean tier step-down. Runs against the mock server in headless Chrome.
import { launch, sleep } from './cdp.mjs';
import { boot, claim, until, floorState } from '../helpers.js';

const ONLY = process.env.FLOORS_ONLY || '';  // 'basic' or 'living', to run one half
const results = []; let failures = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); if (!ok) failures++; console.log(results.at(-1)); };
const step = async (name, fn) => { try { await fn(); check(name, true); } catch (e) { check(name, false, e.message); } };

const t = await boot({ mockDelayMs: 900, rateScale: 50 });  // slow enough for the people to act it out
const c = await claim(t, 'Night Bakery', { body: { colors: { primary: '#7a4bb5', accent: '#f4c95d' } } });
const base = `http://localhost:${t.port}/theoffice`;

for (const [label, opts, q, budget] of ONLY === 'living' || ONLY === 'landscape' ? [] : [['desktop', { width: 1440, height: 900 }, 'high', 350], ['phone', { mobile: true }, 'low', 200]]) {
  const b = await launch(); const p = await b.newPage(opts);
  const tag = (s) => `${label}: ${s}`;
  await p.goto(base);
  await p.send('Network.setCookie', { name: 'office_s', value: c.cookies.office_s, url: `http://localhost:${t.port}/theoffice/`, path: '/theoffice', httpOnly: true, secure: true, sameSite: 'Lax' });
  await step(tag('floor renders with the view API the UI and tests use'), async () => {
    await p.goto(`${base}/floor/${c.slug}?q=${q}`);
    await p.until('document.body.dataset.page === "floor" && !!window.__office?.view', 'floor');
    await sleep(2500);
    const api = await p.ev(`(() => { const v = window.__office.view; const a = [...v.actors.values()][0];
      return { actors: v.actors.size, boss: !!v.boss, manager: !!v.manager && typeof v.manager.action !== 'undefined' && Array.isArray(v.manager.path),
        fns: ['meeting', 'handoff', 'cheer', 'bossTalks', 'updateBoard', 'syncAgents', 'agentEvent', 'setTier', 'resize', 'destroy', 'enter', 'leave'].every((f) => typeof v[f] === 'function'),
        actor: typeof a.state === 'string' && Array.isArray(a.path) && typeof a.char.paper.visible === 'boolean' && typeof a.bubble.hidden === 'boolean' && typeof a.seated === 'boolean' && typeof a.setState === 'function',
        names: document.querySelectorAll('.char-name').length, tier: __stage.tier }; })()`);
    if (api.actors < 3 || !api.boss || !api.manager || !api.fns || !api.actor) throw new Error(JSON.stringify(api));
    if (api.names !== api.actors) throw new Error(`${api.names} labels for ${api.actors} actors`);
    if (api.tier !== q) throw new Error(`tier ${api.tier}`);
  });
  await step(tag('every meeting spot and errand is reachable without cutting through furniture'), async () => {
    const bad = await p.ev(`(() => { const v = window.__office.view; const out = [];
      const L = v.plan; const targets = [...L.meet.spots, L.meet.stand, ...L.rooms.flatMap((r) => r.spots || []), [L.shelf[0] + 1, L.shelf[1]], [L.arcade[0] + 1, L.arcade[1]]];
      for (const a of v.actors.values()) for (const [x, z] of targets) {
        const path = v.nav.path(a.seat.at[0], a.seat.at[1], x, z);
        if (!v.nav.reachable(a.seat.at[0], a.seat.at[1], x, z) || (path.length === 1 && !v.nav.clear(a.seat.at, [x, z]))) out.push(a.info.name + ' -> ' + x + ',' + z);
      }
      return out; })()`);
    if (bad.length) throw new Error(`${bad.length} unreachable: ${bad.slice(0, 8).join('; ')}`);
  });
  await step(tag('labels hang above heads, never over them'), async () => {
    const bad = await p.ev(`(() => { const v = window.__office.view; const out = []; const tv = new (v.camera.position.constructor)();
      for (const a of v.actors.values()) {
        tv.copy(a.group.position); tv.y += a.char.headTop ?? 1.7 * 1.45; tv.project(v.camera);
        const headTop = (-tv.y * 0.5 + 0.5) * innerHeight;
        const r = a.nameEl.getBoundingClientRect();
        if (r.bottom > headTop + 2) out.push(a.info.name + ' ' + Math.round(r.bottom - headTop));
      }
      return out; })()`);
    if (bad.length) throw new Error(bad.join(', '));
  });
  await step(tag(`a busy floor stays under ${budget} draw calls`), async () => {
    // Sampled from here on: a mock run finishes in seconds, and at the high tier a software renderer can be slower than that,
    // so the board, screen and bubble checks below read what was seen while the work was open, not a single later moment.
    await p.ev(`window.__samples = { board: 0, screen: 0, dots: 0 }; window.__samp = setInterval(() => { const v = window.__office?.view; if (!v) return;
      const open = window.__office.state.tasks.some((t) => t.status !== 'done');
      if (open && v.boardKey && v.boardKey !== '[]') window.__samples.board++;
      const busy = [...v.actors.values()].find((a) => a.state !== 'idle');
      if (busy && busy.seat.screenMat && busy.seat.screenMat.map !== v.idleTex) window.__samples.screen++;
      if (busy && !busy.bubble.hidden && busy.bubble.querySelector('.dots')) window.__samples.dots++; }, 100); true`);
    // A software renderer can spend many seconds compiling shaders at the high tier, long enough for a whole mock run to come and go unseen.
    await p.until('__stage.frame > 12', 'the room drawing frames', 60000);
    await c.post(`/api/floors/${c.slug}/chat`, { text: `go build ${label === 'desktop' ? 'midnight rolls' : 'morning buns'} [slow]` });
    await p.until('window.__office.state.tasks.length >= 1', 'tasks', 20000);
    await p.until('[...window.__office.view.actors.values()].some((a) => a.state !== "idle")', 'someone working', 20000);
    await sleep(1500);
    const s = await p.ev('({ calls: __stage.renderer.info.render.calls, tris: __stage.renderer.info.render.triangles })');
    console.log(`  ${label} busy: ${s.calls} calls, ${s.tris} triangles`);
    if (s.calls > budget) throw new Error(`${s.calls} calls`);
  });
  await step(tag('the whiteboard, screens and bubbles follow the real state'), async () => {
    await p.until('(() => { const s = window.__samples; return s.board > 0 && s.screen > 0 && s.dots > 0; })()', 'board, screen and bubble seen', 20000).catch(() => {});
    const st = await p.ev('(clearInterval(window.__samp), window.__samples)');
    if (!st.board) throw new Error(`board empty while tasks were open: ${JSON.stringify(st)}`);
    if (!st.screen) throw new Error('screen stayed dark while working');
    if (!st.dots) throw new Error('bubble has no dots');
  });
  await step(tag('stepping the tier down hides detail and keeps rendering'), async () => {
    await p.ev('__stage.setTier("low"); true');
    await sleep(600);
    const st = await p.ev('({ detail: window.__office.view.detail.visible, shadow: __stage.renderer.shadowMap.enabled, calls: __stage.renderer.info.render.calls })');
    if (st.detail || st.shadow) throw new Error(JSON.stringify(st));
    if (!(st.calls > 20 && st.calls < 200)) throw new Error(`${st.calls} calls at low`);
  });
  await step(tag('no console errors'), async () => {
    const errs = p.errors.filter((e) => !/status of 40[0-9]|status of 429/.test(e));
    if (errs.length) throw new Error(errs.slice(0, 5).join(' | ').slice(0, 800));
  });
  p.close(); b.close();
}

// ---- the living floor: rooms, walking, words you can read, and the page around them ----
const asOwner = async (p, c2, q = 'low') => {
  await p.goto(base);
  await p.send('Network.setCookie', { name: 'office_s', value: c2.cookies.office_s, url: `http://localhost:${t.port}/theoffice/`, path: '/theoffice', httpOnly: true, secure: true, sameSite: 'Lax' });
  await p.goto(`${base}/floor/${c2.slug}?q=${q}`);
  await p.until('document.body.dataset.page === "floor" && !!window.__office?.view', 'floor');
  await p.until('window.__office.view.modelsOn === true', 'furniture', 45000);
};
const rects = (p, list) => p.ev(`(() => { const out = {}; for (const s of ${JSON.stringify(list)}) { const e = document.querySelector(s); const r = e && !e.hidden && getComputedStyle(e).display !== 'none' ? e.getBoundingClientRect() : null; out[s] = r ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null; } return out; })()`);
const hits = (a, b) => a && b && !(a.r <= b.l || a.l >= b.r || a.b <= b.t || a.t >= b.b);
if (ONLY !== 'basic' && ONLY !== 'landscape') {
const owner = await claim(t, 'Living Floor', { body: { colors: { primary: '#2f6f62', accent: '#f4c95d' } } });
const neighbour = await claim(t, 'Next Door', { body: { colors: { primary: '#aa5522', accent: '#ffe08a' } } });
const hush = await claim(t, 'Hush Floor', { body: { colors: { primary: '#334466', accent: '#ffcc66' } } });
// Runs the room's clock by hand, far faster than a software renderer would, so this tests the people and not the machine's patience. Records each
// step: the rooms each person passes through, the biggest single jump anyone makes, any step inside furniture, and what was said out loud.
const RECORD = `(() => { const last = new Map(); const r = window.__rec = { rooms: {}, jump: 0, jumper: '', cut: 0, steps: 0, said: new Set(), pills: new Set(), bubblesOverHeads: 0 };
  const tv = new (window.__office.view.camera.position.constructor)();
  const note = (v) => { for (const a of v.actors.values()) { const p = a.group.position; const was = last.get(a.id);
      if (was) { const d = Math.hypot(p.x - was[0], p.z - was[1]); if (d > r.jump) { r.jump = d; r.jumper = a.info.name; } if (d > 0) r.steps++; }
      last.set(a.id, [p.x, p.z]);
      const room = v.life.roomOf(a); const seq = (r.rooms[a.id] ||= []); if (seq.at(-1) !== room) seq.push(room);
      if (a.path.length && v.nav.isBlocked(p.x, p.z) && Math.hypot(p.x - a.seat.at[0], p.z - a.seat.at[1]) > 1.3 && Math.hypot(p.x - a.path.at(-1)[0], p.z - a.path.at(-1)[1]) > 0.8) r.cut++;
      if (a.speech && !a.bubble.hidden) { r.said.add(a.speech.text);
        tv.copy(p); tv.y += a.char.headTop ?? 2.4; tv.project(v.camera); const head = (-tv.y * 0.5 + 0.5) * innerHeight; if (a.bubble.getBoundingClientRect().bottom > head + 2) r.bubblesOverHeads++; }
      const pct = a.bubble.querySelector('.pill-done'); if (pct && !a.bubble.hidden) r.pills.add(pct.textContent);
    } };
  // Only this clock moves the room while recording: a real frame or two slipped in between two of these steps would count as one jump.
  const v0 = window.__office.view, realUpdate = v0.update; v0.update = () => {}; window.__unclock = () => { delete v0.update; };
  window.__ff = setInterval(() => { const v = window.__office?.view; if (!v) return; for (let i = 0; i < 10; i++) { if (v === v0) realUpdate.call(v0, 0.05); else v.update(0.05); note(v); } }, 50);
  return true; })()`;
const readRec = (p) => p.ev('(() => { clearInterval(window.__ff); window.__unclock?.(); const r = window.__rec; return { rooms: r.rooms, jump: r.jump, jumper: r.jumper, cut: r.cut, steps: r.steps, said: [...r.said], pills: [...r.pills], bubblesOverHeads: r.bubblesOverHeads }; })()');

{ // desktop
  const b = await launch(); const p = await b.newPage({ width: 1440, height: 900 });
  const tag = (s) => `desktop: ${s}`;
  await asOwner(p, owner);
  await step(tag('a company card on the left, a floor scrubber on the right, and nothing on top of anything'), async () => {
    const box = await rects(p, ['.floor-top', '.floor-panel', '.floor-scrubber', '.controls']);
    for (const [k, r] of Object.entries(box)) if (!r || r.l < -1 || r.t < -1 || r.r > 1441 || r.b > 901) throw new Error(`${k} ${JSON.stringify(r)}`);
    if (box['.floor-top'].r > 340) throw new Error('the card should sit on the left');
    if (box['.floor-scrubber'].l < 1340) throw new Error('the scrubber should sit on the right');
    for (const [x, y] of [['.floor-top', '.floor-panel'], ['.floor-top', '.controls'], ['.floor-panel', '.floor-scrubber'], ['.floor-panel', '.controls']]) if (hits(box[x], box[y])) throw new Error(`${x} over ${y}`);
    const card = await p.ev('document.querySelector(".floor-top").textContent');
    if (!/Floor \d+/.test(card) || !/Living Floor/.test(card) || !/Run by/.test(card) || !/\d+ people/.test(card)) throw new Error(card.slice(0, 200));
    if (!(await p.ev('!!document.querySelector("[data-share]")'))) throw new Error('no Share button');
    if (/null|undefined|NaN/.test(card)) throw new Error(`a blank field on the card: ${card.slice(0, 200)}`);
  });
  await step(tag('the room sits in the space between the card and the panel'), async () => {
    await sleep(1200);
    const bad = await p.ev(`(() => { const v = window.__office.view; const card = document.querySelector('.floor-top').getBoundingClientRect(), panel = document.querySelector('.floor-panel').getBoundingClientRect(); return [...v.actors.values()].filter((a) => a.tagX < card.right - 4 || a.tagX > panel.left + 4).map((a) => a.info.name + ' ' + Math.round(a.tagX)); })()`);
    if (bad.length) throw new Error(bad.join(', '));
  });
  await step(tag('pins float over the rooms and open Tasks, Projects, Talk, Requests, Orders and the manager chat'), async () => {
    const pins = await p.ev('[...document.querySelectorAll(".pin")].map((e) => e.dataset.pin)');
    for (const want of ['chat', 'tasks', 'talk', 'projects', 'requests', 'orders']) {
      if (!pins.includes(want)) throw new Error(`no ${want} pin: ${pins}`);
      // An open panel can cover a pin at the closer starting view, and its own tabs are the way there then. From the room, every pin opens its tab.
      const covered = await p.ev(`(() => { const el = document.querySelector('.pin[data-pin=${want}]'); const r = el.getBoundingClientRect(); const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !(t && (t === el || el.contains(t))); })()`);
      if (covered) await p.ev(`document.querySelector('.pin[data-pin=${want}]').click()`); else await p.click(`.pin[data-pin=${want}]`);
      await p.until(`window.__office.tab === ${JSON.stringify(want)} && !document.querySelector('.floor-panel').classList.contains('closed')`, `${want} tab`, 4000);
    }
    const off = await p.ev('[...document.querySelectorAll(".pin")].filter((e) => { const r = e.getBoundingClientRect(); return r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight; }).length');
    if (off) throw new Error(`${off} pins off screen`);
  });
  await step(tag('the panel closes for a bigger room, and the manager chat is still one tap away'), async () => {
    const wide = await p.ev('window.__office.view.visW');
    await p.click('.panel-close');
    await p.until('document.querySelector(".floor-panel").classList.contains("closed")', 'closed', 3000);
    await sleep(1500);
    const after = await p.ev('({ w: window.__office.view.visW, pill: document.querySelector(".talk-pill").textContent, hidden: document.querySelector(".talk-pill").hidden })');
    if (after.hidden || !/^(Talk to|Call) /.test(after.pill)) throw new Error(JSON.stringify(after));
    if (after.w <= wide + 100) throw new Error(`the room got no more space: ${wide} then ${after.w}`);
    await p.click('.talk-pill');
    await p.until('window.__office.tab === "chat" && !!document.querySelector(".chat-input textarea") && !document.querySelector(".floor-panel").classList.contains("closed")', 'chat open', 3000);
    const input = await rects(p, ['.chat-input']);
    if (!input['.chat-input']) throw new Error('no chat input showing');
  });
  await step(tag('the scrubber goes to the floor next door and comes back'), async () => {
    await p.until('!document.querySelector("[data-scrub=up]").disabled || !document.querySelector("[data-scrub=down]").disabled', 'floor list', 8000);
    const dir = await p.ev('document.querySelector("[data-scrub=up]").disabled ? "down" : "up"');
    const back = dir === 'up' ? 'down' : 'up';
    const here = await p.ev('window.__office.slug');
    await p.click(`[data-scrub=${dir}]`);
    await p.until(`window.__office?.slug && window.__office.slug !== ${JSON.stringify(here)} && !!window.__office.view`, 'next floor', 20000);
    await p.until(`!document.querySelector('[data-scrub=${back}]').disabled`, 'list on the next floor', 8000);
    await p.click(`[data-scrub=${back}]`);
    await p.until(`window.__office?.slug === ${JSON.stringify(here)} && !!window.__office.view`, 'back again', 20000);
    await p.until('window.__office.view.modelsOn === true', 'furniture again', 45000);
  });
  await step(tag('people walk from their own rooms to the meeting room and back through the doors, with no teleporting, and say the real lines'), async () => {
    await p.ev('for (const a of window.__office.view.actors.values()) a.idleTimer = 1e9; true');
    await p.ev(RECORD);
    await owner.post(`/api/floors/${owner.slug}/chat`, { text: 'go build tiny loaves' });
    await p.until('window.__office.state.tasks.length >= 4 && window.__office.state.tasks.every((x) => x.status === "done") && [...window.__office.view.actors.values()].every((a) => a.seated && !a.scene && !window.__office.view.life.queues.size)', 'all back at their desks', 110000);
    const r = await readRec(p);
    const staff = await p.ev('window.__office.state.agents.filter((a) => a.role !== "manager").map((a) => a.id)');
    const crew = staff.map((id) => r.rooms[id] || []);
    const went = crew.filter((seq) => seq.includes('meeting') && seq.length >= 3).length;
    if (went < staff.length) throw new Error(`only ${went} of ${staff.length} went to the meeting and back: ${JSON.stringify(crew)}`);
    if (!crew.every((seq) => seq[0] === seq.at(-1))) throw new Error(`someone did not go back to their room: ${JSON.stringify(crew)}`);
    if (r.jump > 0.5) throw new Error(`${r.jumper} jumped ${r.jump.toFixed(2)} in one frame`);
    if (r.steps < 300) throw new Error(`hardly anyone moved: ${r.steps} steps`);
    if (r.cut > r.steps * 0.02) throw new Error(`walked through furniture ${r.cut} of ${r.steps}`);
    const talk = await p.ev('window.__office.state.talk.map((l) => l.text)');
    if (!r.said.length) throw new Error('nobody spoke');
    for (const s of r.said) if (!talk.includes(s)) throw new Error(`said out loud but not in Talk: ${s}`);
    if (r.bubblesOverHeads) throw new Error(`${r.bubblesOverHeads} bubbles sat over a head`);
    if (!r.pills.length || !r.pills.every((x) => /^\d+\/4$/.test(x))) throw new Error(`task pills: ${r.pills}`);
    console.log(`  walked: ${r.steps} steps, biggest step ${r.jump.toFixed(2)}, ${r.said.length} lines said, pills ${r.pills.join(' ')}`);
  });
  await step(tag('the Talk tab lists the same lines, as plain text'), async () => {
    await p.click('[data-tab=talk]');
    await p.until('document.querySelectorAll(".talk-line").length >= 8', 'talk lines', 5000);
    const st = await p.ev(`({ shown: [...document.querySelectorAll('.talk-line p')].map((e) => e.textContent), real: window.__office.state.talk.map((l) => l.text), kinds: [...new Set([...document.querySelectorAll('.talk-line')].map((e) => e.dataset.beat || e.dataset.kind))] })`);
    for (const s of st.real) if (!st.shown.includes(s)) throw new Error(`not listed: ${s}`);
    for (const k of ['assign', 'handoff', 'review']) if (!st.kinds.includes(k)) throw new Error(`no ${k} line: ${st.kinds}`);
  });
  await step(tag('in every office layout, people walk between rooms through doors'), async () => {
    for (const layout of ['open', 'studio', 'garage', 'lounge', 'pods']) {
      await owner.post(`/api/floors/${owner.slug}/customise`, { decor: { layout, coffee: true, plants: 8, arcade: true } });
      await p.until(`window.__office.view.decor.layout === ${JSON.stringify(layout)}`, `${layout} room`, 15000);
      await p.until('window.__office.view.modelsOn === true', `${layout} furniture`, 45000);
      const out = await p.ev(`(() => { const v = window.__office.view; const st = window.__office.state;
        for (const a of v.actors.values()) a.idleTimer = 1e9;
        const mgr = st.agents.find((a) => a.role === 'manager').id, staff = st.agents.filter((a) => a.role !== 'manager').map((a) => a.id);
        const rooms = {}; const note = () => { for (const a of v.actors.values()) { const r = v.life.roomOf(a), q = (rooms[a.id] ||= []); if (q.at(-1) !== r) q.push(r); } };
        let jump = 0; const was = new Map(); let wall = 0;
        const run = (most) => { for (let t = 0; t < most; t += 0.05) { v.update(0.05); note(); for (const a of v.actors.values()) { const p = a.group.position, w = was.get(a.id); if (w) jump = Math.max(jump, Math.hypot(p.x - w[0], p.z - w[1])); was.set(a.id, [p.x, p.z]); if (a.path.length && v.nav.isBlocked(p.x, p.z) && Math.hypot(p.x - a.seat.at[0], p.z - a.seat.at[1]) > 1.3 && Math.hypot(p.x - a.path.at(-1)[0], p.z - a.path.at(-1)[1]) > 0.8) wall++; } if ([...v.actors.values()].every((a) => a.seated && !a.action && !a.scene) && !v.life.queues.size && t > 1) return t; } return -1; };
        v.meeting(mgr, staff); const a1 = run(180);
        v.life.line({ from: staff[0], to: mgr, text: 'Here is the work.', kind: 'handoff' }); const a2 = run(90);
        v.life.line({ from: mgr, to: staff[1], text: 'A note for you.', kind: 'review' }); const a3 = run(90);
        v.life.line({ from: staff[1], to: 'boss', text: 'A question.', kind: 'question' }); const a4 = run(90);
        const kitchen = v.plan.rooms.find((r) => r.kind === 'kitchen'), lounge = v.plan.rooms.find((r) => r.kind === 'lounge');
        v.life.go(v.actors.get(staff[2]), kitchen.spots[0], 'sip', 2); v.life.go(v.actors.get(staff[3]), lounge.spots[0], 'phone', 2); const a5 = run(90);
        return { a1, a2, a3, a4, a5, jump, wall, seated: [...v.actors.values()].every((a) => a.seated), rooms: staff.map((id) => rooms[id]), mgr: rooms[mgr] }; })()`);
      if ([out.a1, out.a2, out.a3, out.a4, out.a5].some((n) => n < 0) || !out.seated) throw new Error(`${layout}: stuck ${JSON.stringify(out).slice(0, 400)}`);
      if (out.jump > 0.5) throw new Error(`${layout}: a jump of ${out.jump}`);
      if (out.wall > 12) throw new Error(`${layout}: ${out.wall} steps inside a wall or furniture`);
      if (!out.rooms[0].includes('meeting') || !out.rooms[0].includes('manager')) throw new Error(`${layout}: ${JSON.stringify(out.rooms[0])}`);
      if (!out.rooms[1].includes('boss')) throw new Error(`${layout}: no walk to the boss ${JSON.stringify(out.rooms[1])}`);
      if (!out.rooms[2].includes('kitchen') || !out.rooms[3].includes('lounge')) throw new Error(`${layout}: no break ${JSON.stringify(out.rooms.slice(2, 4))}`);
      if (!out.mgr.includes('meeting')) throw new Error(`${layout}: manager stayed away ${JSON.stringify(out.mgr)}`);
      const f0 = await p.ev('__stage.frame');
      await p.until(`__stage.frame > ${f0 + 2}`, 'a fresh frame', 20000);
      const calls = await p.ev('({ calls: __stage.renderer.info.render.calls, tris: __stage.renderer.info.render.triangles })');
      console.log(`  ${layout} low: ${calls.calls} calls, ${calls.tris} triangles`);
      if (calls.calls > 200) throw new Error(`${layout}: ${calls.calls} draw calls`);
    }
    await owner.post(`/api/floors/${owner.slug}/customise`, { decor: { layout: 'open' } });
    await p.until('window.__office.view.decor.layout === "open"', 'open plan again', 15000);
  });
  await step(tag('someone new starting leaves everyone else where they are'), async () => {
    await p.ev('window.__before = window.__office.view; window.__crew = window.__office.view.actors.size; true');
    const r = await owner.post(`/api/floors/${owner.slug}/hire`, { role: 'tester' });
    if (r.status !== 201) throw new Error(`hire: ${r.status}`);
    await p.until('window.__office.view.actors.size === window.__crew + 1', 'the new person at a desk', 15000);
    if (!(await p.ev('window.__office.view === window.__before'))) throw new Error('the room was rebuilt, so everyone jumped back to their chairs');
  });
  await step(tag('no console errors'), async () => {
    const errs = p.errors.filter((e) => !/status of 40[0-9]|status of 429/.test(e));
    if (errs.length) throw new Error(errs.slice(0, 5).join(' | ').slice(0, 800));
  });
  p.close(); b.close();
}
{ // a visitor, watching a private project
  const b = await launch(); const v = await b.newPage({ width: 1440, height: 900 });
  const tag = (s) => `visitor: ${s}`;
  await v.goto(`${base}/floor/${hush.slug}?q=low`);
  await v.until('document.body.dataset.page === "floor" && !!window.__office?.view', 'floor');
  await step(tag('arrives to the room, not a panel, with no controls or chat'), async () => {
    const st = await v.ev('({ closed: document.querySelector(".floor-panel").classList.contains("closed"), pill: document.querySelector(".talk-pill").textContent, chat: !!document.querySelector(".chat-input"), pins: [...document.querySelectorAll(".pin")].map((e) => e.dataset.pin), tab: window.__office.tab, controls: document.querySelector(".controls").textContent })');
    if (!st.closed || st.chat || st.tab !== 'talk' || /Pause|Stop|Redirect|Customise/.test(st.controls)) throw new Error(JSON.stringify(st));
    if (st.pins.includes('requests') || st.pins.includes('orders') || st.pins.includes('chat')) throw new Error(`visitor pins ${st.pins}`);
  });
  await step(tag('sees people walk over but reads no private words, in the bubbles or the Talk tab'), async () => {
    await v.ev('for (const a of window.__office.view.actors.values()) a.idleTimer = 1e9; true');
    await v.ev(RECORD);
    await hush.post(`/api/floors/${hush.slug}/chat`, { text: 'go build secret soup [private]' });
    const owned = await until(async () => { const s = await floorState(hush); return s.tasks.length >= 4 && s.tasks.every((x) => x.status === 'done') ? s : null; }, { timeout: 60000, what: 'private run' });
    await v.until('window.__office.state.talk.length >= 8 && [...window.__office.view.actors.values()].every((a) => a.seated && !a.scene) && !window.__office.view.life.queues.size', 'back at their desks', 80000);
    const r = await readRec(v);
    if (!r.said.length) throw new Error('nobody was seen talking');
    for (const s of r.said) if (s !== 'Talking about something private.') throw new Error(`a visitor read: ${s}`);
    const moved = Object.values(r.rooms).filter((q) => q.length >= 3).length;
    if (moved < 3) throw new Error(`only ${moved} people were seen walking between rooms`);
    await v.click('.talk-pill');
    await v.until('document.querySelectorAll(".talk-line").length >= 4', 'talk tab', 5000);
    const body = await v.ev('document.body.textContent + JSON.stringify(window.__office.state.talk)');
    if (/secret|soup/i.test(body)) throw new Error('private words on the page');
    const real = owned.talk.map((l) => l.text).filter((x) => x.length > 12);
    for (const s of real) if (body.includes(s)) throw new Error(`a visitor can read: ${s}`);
    if (!/Talking about something private/.test(body)) throw new Error('no private line shown');
  });
  await step(tag('no console errors'), async () => {
    const errs = v.errors.filter((e) => !/status of 40[0-9]|status of 429/.test(e));
    if (errs.length) throw new Error(errs.slice(0, 5).join(' | ').slice(0, 800));
  });
  v.close(); b.close();
}
{ // phone
  const b = await launch(); const p = await b.newPage({ mobile: true });
  const tag = (s) => `phone: ${s}`;
  await asOwner(p, neighbour);
  const peopleClear = () => p.ev(`(() => { const v = window.__office.view; const sheet = document.querySelector('.floor-panel').getBoundingClientRect(); const tops = document.querySelector('.floor-top').getBoundingClientRect(); const ctl = document.querySelector('.controls').getBoundingClientRect(); const bad = [];
    for (const a of v.actors.values()) { const r = a.nameEl.getBoundingClientRect(); if (r.bottom > sheet.top + 2) bad.push(a.info.name + ' under the sheet'); if (r.left < -4 || r.right > innerWidth + 4) bad.push(a.info.name + ' off the side'); if (r.bottom > ctl.top && r.top < ctl.bottom && r.right > ctl.left && r.left < ctl.right) bad.push(a.info.name + ' under the buttons'); }
    return { bad, sheet: sheet.top, h: innerHeight }; })()`);
  await step(tag('the sheet holds the panel, the room stays above it, and nobody is covered'), async () => {
    await sleep(1800);
    const box = await rects(p, ['.floor-panel', '.panel-grip', '.tabs', '.floor-scrubber', '.controls', '.floor-name']);
    for (const [k, r] of Object.entries(box)) if (!r || r.l < -1 || r.r > 391 || r.b > 845) throw new Error(`${k} ${JSON.stringify(r)}`);
    if (hits(box['.floor-scrubber'], box['.controls'])) throw new Error('scrubber over the buttons');
    if (hits(box['.floor-scrubber'], box['.floor-panel'])) throw new Error('scrubber under the sheet');
    const c1 = await peopleClear();
    if (c1.bad.length) throw new Error(c1.bad.join(', '));
    if (await p.ev('document.documentElement.scrollWidth > innerWidth + 1')) throw new Error('the page scrolls sideways');
    if (await p.ev('getComputedStyle(document.querySelector(".card-more")).display !== "none"')) throw new Error('the card is in the way on a phone');
  });
  await step(tag('the handle folds the sheet down to its tabs, and the room moves into the space'), async () => {
    const before = await p.ev('window.__office.view.visH');
    await p.click('.panel-grip');
    await p.until('document.querySelector(".floor-panel").classList.contains("closed")', 'folded', 3000);
    await sleep(1400);
    const st = await p.ev('({ h: document.querySelector(".floor-panel").getBoundingClientRect().height, vis: window.__office.view.visH, tabs: document.querySelector(".tabs").getBoundingClientRect().height, tab: document.querySelector(".tab").getBoundingClientRect().height })');
    if (st.h > 130) throw new Error(`folded sheet is ${st.h} tall`);
    if (st.vis <= before + 150) throw new Error(`the room got no more space ${before} then ${st.vis}`);
    if (st.tab < 44) throw new Error(`tabs are ${st.tab} tall`);
    const c1 = await peopleClear();
    if (c1.bad.length) throw new Error(c1.bad.join(', '));
    await p.click('[data-tab=chat]');
    await p.until('window.__office.tab === "chat" && !document.querySelector(".floor-panel").classList.contains("closed") && !!document.querySelector(".chat-input textarea")', 'one tap to the manager', 3000);
  });
  await step(tag('pins and scrubber buttons are big enough to tap, and a pin opens its tab'), async () => {
    const sizes = await p.ev(`(() => { const hit = (e) => { const r = e.getBoundingClientRect(); const b = getComputedStyle(e, '::before'); const grow = -2 * (parseFloat(b.top) || 0); return Math.min(r.width, r.height) + grow; }; return { pins: [...document.querySelectorAll('.pin')].map(hit), scrub: [...document.querySelectorAll('.scrub-btn')].map(hit) }; })()`);
    if (sizes.pins.some((n) => n < 43.5)) throw new Error(`pins ${sizes.pins}`);
    if (sizes.scrub.some((n) => n < 43.5)) throw new Error(`scrub ${sizes.scrub}`);
    // The room eases into its new space a frame at a time, and on this renderer that takes a while.
    await p.until('(() => { const v = window.__office.view; return Math.abs(v.insetNow.bottom - v.insets.bottom) < 1 && v.pinKey; })()', 'the room settled', 30000);
    await sleep(600);
    await p.click('.pin[data-pin=talk]');
    await p.until('window.__office.tab === "talk"', 'talk tab', 3000);
    await p.click('[data-tab=chat]');
  });
  await step(tag('the company card lives in the sheet'), async () => {
    await p.click('[data-tab=about]');
    await p.until('!!document.querySelector(".tab-body [data-share]")', 'the card under About', 3000);
    const st = await p.ev('({ text: document.querySelector(".tab-body").textContent, panel: document.querySelector(".floor-panel").getBoundingClientRect().height, share: document.querySelector("[data-share]").getBoundingClientRect() })');
    if (!/Run by/.test(st.text) || !/\d+ people/.test(st.text)) throw new Error(st.text.slice(0, 160));
    if (st.share.bottom > 845 || st.share.height < 36) throw new Error(JSON.stringify(st.share));
    await p.click('[data-tab=chat]');
  });
  await step(tag('a line said out loud fits the screen and stays above the sheet, with people walking between rooms'), async () => {
    await p.ev('for (const a of window.__office.view.actors.values()) a.idleTimer = 1e9; true');
    await p.ev(RECORD);
    await p.ev(`window.__bubbleBad = []; window.__watch = setInterval(() => { for (const e of document.querySelectorAll('#labels .char-bubble.speech:not([hidden])')) { const r = e.getBoundingClientRect(); const sheet = document.querySelector('.floor-panel').getBoundingClientRect(); if (r.left < -2 || r.right > innerWidth + 2) window.__bubbleBad.push('off side ' + Math.round(r.left) + ' ' + Math.round(r.right)); if (r.bottom > sheet.top + 2) window.__bubbleBad.push('under the sheet'); if (parseFloat(getComputedStyle(e).fontSize) < 11) window.__bubbleBad.push('too small'); } }, 120); true`);
    await neighbour.post(`/api/floors/${neighbour.slug}/chat`, { text: 'go build little buns' });
    await p.until('window.__office.state.tasks.length >= 4 && window.__office.state.tasks.every((x) => x.status === "done") && [...window.__office.view.actors.values()].every((a) => a.seated && !a.scene) && !window.__office.view.life.queues.size', 'everyone back', 110000);
    const r = await readRec(p);
    const bad = await p.ev('(clearInterval(window.__watch), window.__bubbleBad)');
    if (!r.said.length) throw new Error('nobody spoke');
    if (bad.length) throw new Error(`${bad.length} bad bubbles: ${[...new Set(bad)].slice(0, 5).join('; ')}`);
    if (r.jump > 0.5) throw new Error(`a jump of ${r.jump}`);
    if (Object.values(r.rooms).filter((q) => q.includes('meeting')).length < 4) throw new Error(JSON.stringify(r.rooms));
    const s = await p.ev('({ calls: __stage.renderer.info.render.calls, tris: __stage.renderer.info.render.triangles })');
    console.log(`  phone low, living floor: ${s.calls} calls, ${s.tris} triangles`);
    if (s.calls > 200) throw new Error(`${s.calls} draw calls`);
  });
  await step(tag('no console errors'), async () => {
    const errs = p.errors.filter((e) => !/status of 40[0-9]|status of 429/.test(e));
    if (errs.length) throw new Error(errs.slice(0, 5).join(' | ').slice(0, 800));
  });
  p.close(); b.close();
}
}
if (ONLY !== 'basic') { // a phone on its side
  const land = await claim(t, 'Sideways Floor');
  const b = await launch(); const p = await b.newPage({ width: 844, height: 390 });
  await step('landscape: the card, panel, scrubber and buttons all fit, with no overlaps, and the room has space', async () => {
    await asOwner(p, land);
    await sleep(1200);
    const box = await rects(p, ['.floor-top', '.floor-panel', '.floor-scrubber', '.controls']);
    for (const [k, r] of Object.entries(box)) if (!r || r.l < -1 || r.t < -1 || r.r > 845 || r.b > 391) throw new Error(`${k} ${JSON.stringify(r)}`);
    for (const [x, y] of [['.floor-top', '.floor-panel'], ['.floor-top', '.controls'], ['.floor-panel', '.floor-scrubber'], ['.floor-panel', '.controls']]) if (hits(box[x], box[y])) throw new Error(`${x} over ${y}`);
    await p.click('.panel-close');
    await p.until('document.querySelector(".floor-panel").classList.contains("closed") && !document.querySelector(".talk-pill").hidden', 'closed', 4000);
    const pill = await rects(p, ['.talk-pill', '.controls', '.floor-scrubber']);
    if (hits(pill['.talk-pill'], pill['.controls']) || hits(pill['.talk-pill'], pill['.floor-scrubber'])) throw new Error(JSON.stringify(pill));
    await p.click('.talk-pill');
    await p.until('window.__office.tab === "chat" && !document.querySelector(".floor-panel").classList.contains("closed")', 'chat', 4000);
  });
  p.close(); b.close();
}
console.log(`\n${results.filter((r) => r.startsWith('PASS')).length} passed, ${failures} failed`);
await t.close();
process.exit(failures ? 1 : 0);
