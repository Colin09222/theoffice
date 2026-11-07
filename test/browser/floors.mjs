// Browser checks for the walk-in office: the view API the floor UI relies on, reachable meeting spots, render budgets at both
// tiers, labels that sit above heads instead of over them, and a clean tier step-down. Runs against the mock server in headless Chrome.
import { launch, sleep } from './cdp.mjs';
import { boot, claim } from '../helpers.js';

const results = []; let failures = 0;
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); if (!ok) failures++; console.log(results.at(-1)); };
const step = async (name, fn) => { try { await fn(); check(name, true); } catch (e) { check(name, false, e.message); } };

const t = await boot({ mockDelayMs: 900, rateScale: 50 });
const c = await claim(t, 'Night Bakery', { body: { colors: { primary: '#7a4bb5', accent: '#f4c95d' } } });
const base = `http://localhost:${t.port}/theoffice`;

for (const [label, opts, q, budget] of [['desktop', { width: 1440, height: 900 }, 'high', 350], ['phone', { mobile: true }, 'low', 200]]) {
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
      const targets = [[-2.7, -3.5], [-0.35, -3.45], [1.9, -3.5], [-0.7, -5.95], [9.2, 1.7], [-9.3, 2.4], [4.0, 5.3], [-8.8, 6.0]];
      for (const a of v.actors.values()) for (const [x, z] of targets) {
        const path = v.nav.path(a.seat.at[0], a.seat.at[1], x, z);
        if (path.length === 1 && !v.nav.clear(a.seat.at, [x, z])) out.push(a.info.name + ' -> ' + x + ',' + z);
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
    await c.post(`/api/floors/${c.slug}/chat`, { text: `go build ${label === 'desktop' ? 'midnight rolls' : 'morning buns'}` });
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
    if (!st.board) throw new Error('board empty while tasks were open');
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
console.log(`\n${results.filter((r) => r.startsWith('PASS')).length} passed, ${failures} failed`);
await t.close();
process.exit(failures ? 1 : 0);
