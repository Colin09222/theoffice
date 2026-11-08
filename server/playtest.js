// The Tester's browser half: plays a game, uses an app or walks a site in a real browser, with no model. The same file runs on the
// Tester's computer under Playwright (.office/playtest.mjs) and in this repo's tests under CDP. Its results fill the browser done-rules;
// the Tester's model judges the screenshots against the design doc. No imports, so it can be concatenated into one file for a computer.
//
// A driver is { goto(url), eval(expression), key(code, down), drag(x1, y1, x2, y2, ms), shot(name), errors(), size: {w, h}, phone }.

/** Runs before any page script: a fake gamepad the run can move, and errors caught as they happen. */
export const INIT_SCRIPT = `(() => {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
  const pad = { id: 'playtest pad', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons, timestamp: 0 };
  window.__pt = { errors: [], pad, padOn: false };
  const real = navigator.getGamepads ? navigator.getGamepads.bind(navigator) : () => [];
  try { Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => (window.__pt.padOn ? [pad, null, null, null] : real()) }); } catch (e) { /* left as it is */ }
  addEventListener('error', (e) => window.__pt.errors.push(String(e.message || e)));
  addEventListener('unhandledrejection', (e) => window.__pt.errors.push('unhandled rejection: ' + String((e.reason && e.reason.message) || e.reason)));
})();`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(d, expr, ms = 5000, every = 100) {
  const end = Date.now() + ms;
  for (;;) { let v = null; try { v = await d.eval(expr); } catch { v = null; } if (v) return v; if (Date.now() > end) return null; await wait(every); }
}
const KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'ShiftLeft', 'KeyA', 'KeyD', 'KeyW', 'KeyS'];
async function hold(d, code, ms) { await d.key(code, true); await wait(ms); await d.key(code, false); }
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const STATE = 'window.officeGame ? window.officeGame.state() : null';
const clickText = (sel, text) => `(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (b) b.click(); return !!b; })()`;
const moved = (a, b) => !!(a?.player && b?.player && (Math.abs(a.player.x - b.player.x) + Math.abs(a.player.y - b.player.y)) > 0.5);

/** A game: boot, menu, settings, play, every input device, pause, a long random run, game over, restart, saves and the leaderboard. */
export async function playGame(d, { seconds = 60, frozenSeconds = 12, minFps = 18, random = Math.random } = {}) {
  const notes = [], shots = [], scenes = new Set(), fps = [];
  const rules = { loads: null, inputs: null, nosoftlock: null, fps: null, screens: null, cloud: null };
  const hooked = await until(d, 'window.officeGame && window.officeGame.state().scene === "menu"', 20000);
  if (!hooked) {
    notes.push('No window.officeGame hook reached the menu, so the game could not be driven. Keep the starter\'s test hook.');
    rules.loads = !(await errorsOf(d)).length;
    shots.push(await d.shot('boot'));
    return { rules, notes, shots, errors: await errorsOf(d) };
  }
  scenes.add('menu'); shots.push(await d.shot('menu'));
  const settingsOk = await d.eval(clickText('[data-screen="menu"] button', 'Settings')) && !!(await until(d, '!!document.querySelector(\'[data-screen="settings"]\')', 2000));
  if (settingsOk) await d.eval(clickText('[data-screen="settings"] button', 'Back'));
  await until(d, '!!document.querySelector(\'[data-screen="menu"]\')', 2000);
  await d.key('Enter', true); await d.key('Enter', false);
  if (!(await until(d, `${STATE}?.scene === 'play'`, 3000))) { await d.eval('document.querySelector("[data-kit-play]")?.click()'); }
  if (!(await until(d, `${STATE}?.scene === 'play'`, 3000))) notes.push('Enter and the Play button did not start the game.');
  scenes.add((await d.eval(STATE))?.scene);
  await wait(400);
  // Input is only fair to judge while playing; a game that paused itself on start is noted and resumed.
  if ((await d.eval(STATE))?.scene === 'pause') { notes.push('It paused itself straight after starting.'); await d.eval('window.officeGame.resume()'); await wait(200); }
  // Each device on its own: the player has to move.
  const input = {};
  let s0 = await d.eval(STATE); await hold(d, 'ArrowRight', 500); let s1 = await d.eval(STATE);
  input.keyboard = moved(s0, s1); await hold(d, 'ArrowLeft', 300);
  s0 = await d.eval(STATE); await d.eval('window.__pt.padOn = true; window.__pt.pad.axes[0] = -1; window.__pt.pad.axes[1] = 0.3'); await wait(500); s1 = await d.eval(STATE);
  input.gamepad = moved(s0, s1); await d.eval('window.__pt.pad.axes[0] = 0; window.__pt.pad.axes[1] = 0');
  if (d.phone) { s0 = await d.eval(STATE); await d.drag(d.size.w * 0.22, d.size.h * 0.7, d.size.w * 0.22 + 70, d.size.h * 0.7 - 20, 600); s1 = await d.eval(STATE); input.touch = moved(s0, s1); }
  rules.inputs = Object.values(input).every(Boolean);
  if (!rules.inputs) notes.push(`Input that did not move the player: ${Object.entries(input).filter(([, v]) => !v).map(([k]) => k).join(', ')}.`);
  // Pause and back.
  await d.key('Escape', true); await d.key('Escape', false);
  const paused = !!(await until(d, `${STATE}?.scene === 'pause'`, 1500)); if (paused) scenes.add('pause');
  if (paused) shots.push(await d.shot('pause'));
  await d.key('Escape', true); await d.key('Escape', false); await until(d, `${STATE}?.scene === 'play'`, 1500);
  // The long run: scripted and random input, watched once a second.
  let softlock = '', frozenFor = 0, lastT = -1, pickFor = 0, restarts = 0, restartOk = true;
  const end = Date.now() + seconds * 1000; let midShot = false, lastSample = 0;
  while (Date.now() < end && !softlock) {
    const r = random();
    if (r < 0.55) await hold(d, KEYS[Math.floor(random() * KEYS.length)], 80 + Math.floor(random() * 220));
    else if (r < 0.7) { await d.eval(`window.__pt.pad.axes[0] = ${(random() * 2 - 1).toFixed(2)}; window.__pt.pad.axes[1] = ${(random() * 2 - 1).toFixed(2)}`); await wait(200); }
    else if (r < 0.8 && d.phone) await d.drag(d.size.w * 0.2, d.size.h * 0.72, d.size.w * (0.1 + random() * 0.3), d.size.h * (0.6 + random() * 0.25), 250);
    else await wait(150);
    if (Date.now() - lastSample < 1000) continue;
    lastSample = Date.now();
    let s; try { s = await d.eval(STATE); } catch { softlock = 'the page stopped answering'; break; }
    if (!s) { softlock = 'the game\'s state went away'; break; }
    scenes.add(s.scene);
    if (s.scene === 'play') {
      if (s.fps) fps.push(s.fps);
      frozenFor = s.t === lastT ? frozenFor + 1 : 0; lastT = s.t;
      if (frozenFor >= frozenSeconds) softlock = `play froze for ${frozenSeconds} s`;
      if (!midShot && Date.now() > end - seconds * 500) { midShot = true; shots.push(await d.shot('play')); }
    } else if (s.scene === 'over') {
      if (!shots.some((x) => /over/.test(x))) shots.push(await d.shot('over'));
      await d.key('Enter', true); await d.key('Enter', false); restarts++;
      if (!(await until(d, `${STATE}?.scene === 'play'`, 3000))) { restartOk = false; softlock = 'game over did not restart'; }
      lastT = -1;
    } else if (s.scene === 'pause') { await d.key('Escape', true); await d.key('Escape', false); }
    else if (s.scene === 'pick') {
      pickFor++; await d.key('Enter', true); await d.key('Enter', false);
      if (pickFor > 3) await d.eval('document.querySelector("[data-pick]")?.click()');
      if (pickFor > 8) softlock = 'stuck on a choice screen';
    } else if (s.scene === 'menu') { await d.key('Enter', true); await d.key('Enter', false); }
    if (s.scene !== 'pick') pickFor = 0;
  }
  if (!midShot) shots.push(await d.shot('play'));
  // End a run on purpose, so game over, restart and the cloud are always checked.
  await d.eval('window.__pt.padOn = false');
  if ((await d.eval(STATE))?.scene === 'play') await d.eval('window.officeGame.forceOver && window.officeGame.forceOver()');
  const over = await until(d, `${STATE}?.scene === 'over'`, 4000);
  if (over) { scenes.add('over'); if (!shots.some((x) => /over/.test(x))) shots.push(await d.shot('over')); }
  const cloud = await d.eval(`(async () => { const o = window.Office && window.Office.connect && window.Office.connect(); if (!o) return 'none'; await (o.ready || Promise.resolve()); if (o.mode !== 'live') return o.mode; const s = await o.saves.get('best', null); return s ? 'saved' : 'nosave'; })()`);
  let posted = false;
  if (over && cloud === 'saved') {
    await d.eval(clickText('[data-screen="over"] button', 'Post score'));
    posted = !!(await until(d, `(async () => { const r = await window.Office.connect().leaderboard.top('main', { limit: 5 }); return r.entries.length > 0; })()`, 5000, 300));
  }
  if (over) { await d.key('Enter', true); await d.key('Enter', false); if (!(await until(d, `${STATE}?.scene === 'play'`, 3000))) restartOk = false; }
  rules.cloud = cloud === 'saved' ? posted : cloud === 'nosave' ? false : null;
  if (rules.cloud === null) notes.push(`Office Cloud is '${cloud}' here (a local preview), so saves and the leaderboard are checked once it is published.`);
  rules.nosoftlock = !softlock && restartOk;
  if (softlock) notes.push(`Soft-lock: ${softlock}.`);
  const f = median(fps); rules.fps = fps.length ? f >= minFps : null;
  if (rules.fps === false) notes.push(`Frame rate ${f} fps, under ${minFps}.`);
  rules.screens = ['menu', 'play', 'pause', 'over'].every((x) => scenes.has(x)) && settingsOk;
  if (!rules.screens) notes.push(`Screens reached: ${[...scenes].filter(Boolean).join(', ')}${settingsOk ? ', settings' : ''}.`);
  const errors = await errorsOf(d); rules.loads = !errors.length;
  return { rules, notes, shots, errors, fps: f, restarts, scenes: [...scenes].filter(Boolean), input };
}

async function errorsOf(d) { let page = []; try { page = (await d.eval('window.__pt ? window.__pt.errors : []')) || []; } catch { /* gone */ } return [...new Set([...(d.errors?.() || []), ...page])].slice(0, 20); }
const fill = (sel, value) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`;
const submit = (sel) => `(() => { const f = document.querySelector(${JSON.stringify(sel)}); if (!f) return false; f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event('submit', { cancelable: true })); return true; })()`;
const noSideScroll = 'document.documentElement.scrollWidth <= innerWidth + 1';

/** An app, end to end: sign up, create something, reload, sign out and back in, through the starter's data-office hooks. */
export async function useApp(d, { url, user = `pt${Date.now().toString(36)}`, password = 'playtest-pass-1' } = {}) {
  const notes = [], shots = [], rules = { loads: null, signup: false, create: false, persist: false, relogin: false, mobile: null };
  const visible = (sel) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); return !!el && !el.closest('[hidden]'); })()`;
  const item = 'Playtest item one';
  const hasItem = `[...document.querySelectorAll('[data-office="item"]')].some((li) => li.textContent.includes(${JSON.stringify(item)}))`;
  await d.goto(`${url}#/`); await until(d, 'document.readyState === "complete"', 8000);
  shots.push(await d.shot('landing'));
  rules.mobile = d.phone ? !!(await d.eval(noSideScroll)) : null;
  // Accounts need the Office server; a local preview on a computer can only check the pages.
  const mode = await d.eval('(async () => { const o = window.Office && window.Office.connect && window.Office.connect(); if (!o) return "none"; await (o.ready || Promise.resolve()); return o.mode; })()');
  if (mode !== 'live') { for (const k of ['signup', 'create', 'persist', 'relogin']) rules[k] = null; notes.push(`Office Cloud is '${mode}' here, so sign-up, saving and sign-in are checked once it is published.`); const errors = await errorsOf(d); rules.loads = !errors.length; return { rules, notes, shots, errors }; }
  await d.goto(`${url}#/signup`);
  if (!(await until(d, visible('[data-office="auth-form"]'), 5000))) { notes.push('No sign-up form with data-office="auth-form".'); return { rules, notes, shots, errors: await errorsOf(d) }; }
  await d.eval(fill('[data-office="username"]', user)); await d.eval(fill('[data-office="password"]', password)); await d.eval(fill('[data-office="name"]', 'Play Tester'));
  await d.eval(submit('[data-office="auth-form"]'));
  rules.signup = !!(await until(d, visible('[data-office="create-form"]'), 8000));
  if (!rules.signup) { notes.push(`Sign-up did not reach the app: ${await d.eval('document.querySelector(\'[data-office="auth-error"]\')?.textContent || ""')}`); return { rules, notes, shots, errors: await errorsOf(d) }; }
  await until(d, `!document.querySelector('[data-office="list"][aria-busy]')`, 5000);
  await d.eval(fill('[data-office="create-input"]', item)); await d.eval(submit('[data-office="create-form"]'));
  rules.create = !!(await until(d, hasItem, 6000));
  shots.push(await d.shot('app'));
  await d.goto(`${url}#/app`);
  rules.persist = !!(await until(d, hasItem, 8000));
  await d.eval('document.querySelector(\'[data-office="signout"]\')?.click()');
  await until(d, '!document.querySelector(\'[data-office="signout"]\') || !!document.querySelector(\'[data-office="signout"]\').closest("[hidden]") || document.querySelector(\'[data-office="signout"]\').hidden', 5000);
  await d.goto(`${url}#/signin`); await until(d, visible('[data-office="auth-form"]'), 5000);
  await d.eval(fill('[data-office="username"]', user)); await d.eval(fill('[data-office="password"]', password)); await d.eval(submit('[data-office="auth-form"]'));
  rules.relogin = !!(await until(d, hasItem, 8000));
  if (d.phone && rules.mobile) rules.mobile = !!(await d.eval(noSideScroll));
  const errors = await errorsOf(d); rules.loads = !errors.length;
  for (const k of ['signup', 'create', 'persist', 'relogin']) if (!rules[k]) notes.push(`${k} failed.`);
  return { rules, notes, shots, errors };
}

/** A site: the phone layout, every link, the meta tags and a real form submission. */
export async function walkSite(d, { url } = {}) {
  const notes = [], shots = [], rules = { loads: null, mobile: null, links: null, meta: null, form: null };
  await d.goto(url); await until(d, 'document.readyState === "complete"', 8000); await wait(300);
  shots.push(await d.shot('site'));
  rules.mobile = d.phone ? !!(await d.eval(noSideScroll)) : null;
  const meta = await d.eval(`(() => { const m = (s) => document.querySelector(s)?.getAttribute('content') || ''; return { title: document.title.trim().length >= 3, description: m('meta[name="description"]').length >= 30, ogTitle: !!m('meta[property="og:title"]'), ogDescription: !!m('meta[property="og:description"]'), ogImage: !!m('meta[property="og:image"]'), viewport: !!document.querySelector('meta[name="viewport"]'), lang: !!document.documentElement.lang, favicon: !!document.querySelector('link[rel~="icon"]') }; })()`);
  rules.meta = Object.values(meta).every(Boolean);
  if (!rules.meta) notes.push(`Missing meta: ${Object.entries(meta).filter(([, v]) => !v).map(([k]) => k).join(', ')}.`);
  const broken = await d.eval(`(async () => { const bad = []; const seen = new Set();
    for (const a of document.querySelectorAll('a[href]')) { const h = a.getAttribute('href'); if (!h || seen.has(h)) continue; seen.add(h);
      if (h.startsWith('#')) { if (h.length > 1 && !document.getElementById(decodeURIComponent(h.slice(1)))) bad.push(h); continue; }
      let u; try { u = new URL(h, location.href); } catch { bad.push(h); continue; }
      if (u.origin !== location.origin) continue;
      try { const r = await fetch(u.href, { method: 'GET' }); if (!r.ok) bad.push(h + ' ' + r.status); } catch { bad.push(h); } }
    return bad; })()`);
  rules.links = !broken.length; if (broken.length) notes.push(`Broken links: ${broken.slice(0, 8).join(', ')}.`);
  const sent = await d.eval(`(() => { const f = document.querySelector('[data-office="contact-form"]') || document.querySelector('form'); if (!f) return false;
    for (const el of f.querySelectorAll('input, textarea')) { if (el.name === 'website' || el.type === 'hidden' || el.type === 'checkbox') continue; el.value = el.type === 'email' ? 'tester@example.org' : el.tagName === 'TEXTAREA' ? 'Hello from the playtest. Is this working?' : 'Pat Tester'; }
    f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event('submit', { cancelable: true })); return true; })()`);
  if (!sent) { rules.form = null; notes.push('No form on the page.'); }
  else rules.form = !!(await until(d, `/thank/i.test((document.querySelector('[data-office="form-status"]') || document.querySelector('[role="status"]') || {}).textContent || '')`, 8000));
  if (rules.form === false) notes.push(`The form did not thank the visitor: ${await d.eval('(document.querySelector(\'[data-office="form-status"]\') || {}).textContent || ""')}`);
  shots.push(await d.shot('form'));
  const errors = await errorsOf(d); rules.loads = !errors.length;
  return { rules, notes, shots, errors };
}

/** Desktop and phone results folded into one set of rules: a rule fails if it failed anywhere, and is unknown only if never checked. */
export function combine(runs) {
  const rules = {};
  for (const r of runs) for (const [k, v] of Object.entries(r.rules || {})) rules[k] = v === false || rules[k] === false ? false : v === true || rules[k] === true ? true : null;
  return { rules, notes: runs.flatMap((r) => r.notes || []), errors: [...new Set(runs.flatMap((r) => r.errors || []))], shots: runs.flatMap((r) => r.shots || []) };
}
