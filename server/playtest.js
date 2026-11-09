// The Tester's browser half: plays a game, uses an app or walks a site in a real browser, with no model. The same file runs on the
// Tester's computer under Playwright (.office/playtest.mjs) and in this repo's tests under CDP. Its results fill the browser done-rules;
// the Tester's model judges the screenshots against the design doc. No imports, so it can be concatenated into one file for a computer.
//
// A driver is { goto(url), evaluate(expression), key(code, down), drag(x1, y1, x2, y2, ms), shot(name), errors(), size: {w, h}, phone }.

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
  for (;;) { let v = null; try { v = await d.evaluate(expr); } catch { v = null; } if (v) return v; if (Date.now() > end) return null; await wait(every); }
}
const KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'ShiftLeft', 'KeyA', 'KeyD', 'KeyW', 'KeyS'];
async function hold(d, code, ms) { await d.key(code, true); await wait(ms); await d.key(code, false); }
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
// In brackets, so that `${STATE}?.scene === 'play'` tests the scene. Without them the test was swallowed by the conditional and was always true.
const STATE = '(window.officeGame ? window.officeGame.state() : null)';
const clickText = (sel, text) => `(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (b) b.click(); return !!b; })()`;
const lifeOf = (s) => ['lives', 'health', 'hp'].map((k) => s?.[k]).find((v) => typeof v === 'number');
const tenths = (ms) => Math.round(ms / 100) / 10;
const moved = (a, b) => !!(a?.player && b?.player && (Math.abs(a.player.x - b.player.x) + Math.abs(a.player.y - b.player.y)) > 0.5);

/** The numbers the browser half holds a game to. config/makers.json carries the same ones in the game's bars (unit-tested), so the briefs and this file agree. */
export const GAME_BARS = { frozenSeconds: 12, headlessMinFps: 18, idleHurtSeconds: 30, idleLoseSeconds: 60, idleSafeSeconds: 10 };

/**
 * The "pressure" rule from an idle run's numbers. idle: {hurt, lose, won, watched, tellsHurt}, all times in seconds of play, null when it
 * didn't happen while watched. True, false, or null when the run was too short to say. A hook with no lives, health or hurts can't say when
 * the player was first hurt, so then only the time to game over is judged.
 */
export function idleVerdict(idle, bars = GAME_BARS) {
  const hurtBar = bars.idleHurtSeconds ?? GAME_BARS.idleHurtSeconds, loseBar = bars.idleLoseSeconds ?? GAME_BARS.idleLoseSeconds, safe = bars.idleSafeSeconds ?? GAME_BARS.idleSafeSeconds;
  const notes = [];
  if (!idle) return { ok: null, notes };
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const hurt = num(idle.hurt), lose = num(idle.lose), watched = num(idle.watched) ?? 0;
  let bad = false, unknown = false;
  if (idle.won) { bad = true; notes.push(`A player who did nothing won the run${lose !== null ? ` after ${lose} s` : ''}.`); }
  else if (lose !== null) {
    if (lose < safe) { bad = true; notes.push(`A player who did nothing lost after ${lose} s. Nobody should lose in the first ${safe} s.`); }
    else if (lose > loseBar) { bad = true; notes.push(`A player who did nothing lasted ${lose} s. The bar is game over within ${loseBar} s.`); }
  } else if (watched >= loseBar) { bad = true; notes.push(`A player who did nothing was still alive after ${watched} s. The bar is game over within ${loseBar} s.`); }
  else unknown = true;
  if (hurt !== null) { if (hurt > hurtBar) { bad = true; notes.push(`A player who did nothing was first hurt after ${hurt} s. The bar is ${hurtBar} s.`); } }
  else if (lose !== null && lose <= hurtBar) { /* lost inside the bar, so hurt inside it too */ }
  else if (idle.tellsHurt && Math.max(watched, lose ?? 0) >= hurtBar) { bad = true; notes.push(`A player who did nothing was not hurt in the first ${hurtBar} s.`); }
  else if (!idle.tellsHurt && !idle.won && (lose !== null || watched >= hurtBar)) notes.push('The test hook has no lives, health or hurts, so the time to first hurt is unknown and only the time to game over was judged.');
  else if (!idle.won) unknown = true;
  return { ok: bad ? false : unknown ? null : true, notes };
}

/**
 * One run with no input at all, from its start: how long until the player is first hurt (lives, health or hp going down, or the hook's
 * hurts count going up) and until game over. Time is counted only while the game is in play, so a choice screen, which waits for the
 * player by design, costs nothing: its first option is picked and the run goes on. The clock is the game's own (the hook's t, seconds
 * of play) when it has one that behaves, so a slow test machine, where the game runs slower than real time, doesn't make a game look
 * gentler than it is. Otherwise it is real time spent in play.
 */
export async function idleRun(d, { maxSeconds = GAME_BARS.idleLoseSeconds, frozenSeconds = GAME_BARS.frozenSeconds, every = 200, fps = [], now: clock = Date.now, sleep = wait } = {}) {
  const out = { hurt: null, lose: null, won: false, watched: 0, tellsHurt: false, picks: 0, clock: 'real', speed: 1, wallMs: 0, softlock: '' };
  const began = clock(), wallEnd = began + maxSeconds * 2500;
  let playMs = 0, last = began, prevScene = 'play', prevLife, prevHurts, lastT = null, frozenMs = 0, fpsAt = 0, away = 0, t0 = null, gameClock = true, clockMs = 0;
  for (;;) {
    await sleep(every);
    let s; try { s = await d.evaluate(STATE); } catch { out.softlock = 'the page stopped answering'; break; }
    if (!s) { out.softlock = 'the game\'s state went away'; break; }
    const now = clock(), step = now - last; last = now;
    if (prevScene === 'play') playMs += step;
    prevScene = s.scene;
    // The game's clock, checked against real time: it may run slower (a slow machine), never faster or backwards.
    if (gameClock && (s.scene === 'play' || s.scene === 'over')) {
      if (typeof s.t !== 'number') gameClock = false;
      else { if (!t0) t0 = { t: s.t, at: playMs }; const g = t0.at + (s.t - t0.t) * 1000; if (g < clockMs - 150 || g > playMs * 1.1 + 1000) gameClock = false; else clockMs = Math.max(clockMs, g); }
    }
    if (!gameClock) clockMs = playMs;
    if (s.scene === 'over') { out.lose = tenths(clockMs); out.won = s.won === true; break; }
    if (s.scene === 'play') {
      away = 0;
      const life = lifeOf(s), hurts = typeof s.hurts === 'number' ? s.hurts : undefined;
      if (life !== undefined || hurts !== undefined) out.tellsHurt = true;
      if (out.hurt === null && ((life !== undefined && prevLife !== undefined && life < prevLife) || (hurts !== undefined && hurts > (prevHurts ?? 0)))) out.hurt = tenths(clockMs);
      prevLife = life; prevHurts = hurts;
      frozenMs = s.t === lastT ? frozenMs + step : 0; lastT = s.t;
      if (typeof s.t === 'number' && frozenMs >= frozenSeconds * 1000) { out.softlock = `play froze for ${frozenSeconds} s`; break; }
      if (s.fps && now - fpsAt >= 1000) { fpsAt = now; fps.push(s.fps); }
    } else if (s.scene === 'pick') { out.picks++; if (++away > 20) { out.softlock = 'stuck on a choice screen'; break; } await d.evaluate('document.querySelector("[data-pick]")?.click()'); }
    else if (s.scene === 'pause') { if (++away > 20) break; await d.evaluate('window.officeGame.resume && window.officeGame.resume()'); }
    else if (++away > 10) break;
    if (clockMs >= maxSeconds * 1000 || now > wallEnd) break;
  }
  out.watched = tenths(clockMs); out.wallMs = clock() - began;
  out.clock = gameClock && t0 ? 'game' : 'real'; out.speed = playMs > 2000 ? Math.round((clockMs / playMs) * 100) / 100 : 1;
  return out;
}

/** A game: boot, menu, settings, play, every input device, pause, a long random run, game over, restart, saves and the leaderboard. */
export async function playGame(d, { seconds = 60, frozenSeconds = GAME_BARS.frozenSeconds, minFps = GAME_BARS.headlessMinFps, random = Math.random, idle: idleOn = true, bars = GAME_BARS } = {}) {
  const notes = [], shots = [], scenes = new Set(), fps = [];
  const rules = { loads: null, inputs: null, nosoftlock: null, pressure: null, fps: null, screens: null, cloud: null };
  const hooked = await until(d, 'window.officeGame && window.officeGame.state().scene === "menu"', 20000);
  if (!hooked) {
    notes.push('No window.officeGame hook reached the menu, so the game could not be driven. Keep the starter\'s test hook.');
    rules.loads = !(await errorsOf(d)).length;
    shots.push(await d.shot('boot'));
    return { rules, notes, shots, errors: await errorsOf(d) };
  }
  scenes.add('menu'); shots.push(await d.shot('menu'));
  const settingsOk = await d.evaluate(clickText('[data-screen="menu"] button', 'Settings')) && !!(await until(d, '!!document.querySelector(\'[data-screen="settings"]\')', 2000));
  if (settingsOk) await d.evaluate(clickText('[data-screen="settings"] button', 'Back'));
  if (!(await until(d, '!!document.querySelector(\'[data-screen="menu"]\')', 2000))) { notes.push('Back from settings did not return to the menu.'); await d.evaluate('window.officeGame.menu && window.officeGame.menu()'); await until(d, `${STATE}?.scene === 'menu'`, 2000); }
  await d.key('Enter', true); await d.key('Enter', false);
  if (!(await until(d, `${STATE}?.scene === 'play'`, 3000))) { await d.evaluate('document.querySelector("[data-kit-play]")?.click()'); }
  if (!(await until(d, `${STATE}?.scene === 'play'`, 3000))) { notes.push('Enter and the Play button did not start the game.'); await d.evaluate('window.officeGame.start && window.officeGame.start()'); await until(d, `${STATE}?.scene === 'play'`, 3000); }
  scenes.add((await d.evaluate(STATE))?.scene);
  await wait(400);
  // Input is only fair to judge while playing; a game that paused itself on start is noted and resumed.
  if ((await d.evaluate(STATE))?.scene === 'pause') { notes.push('It paused itself straight after starting.'); await d.evaluate('window.officeGame.resume()'); await wait(200); }
  // Each device on its own: the player has to move. A game can pause itself (focus, a stray key), so each check starts from play and gets a second go.
  const ensurePlay = async () => {
    for (let i = 0; i < 4; i++) {
      const s = await d.evaluate(STATE);
      if (s?.scene === 'play') return true;
      if (s?.scene === 'pause') await d.evaluate('window.officeGame.resume()');
      else if (s?.scene === 'settings') await d.evaluate(clickText('.kit-screen button', 'Back'));
      else if (s?.scene === 'pick') await d.evaluate('document.querySelector("[data-pick]")?.click()');
      else await d.evaluate('window.officeGame.start && window.officeGame.start()');
      await wait(300);
    }
    return (await d.evaluate(STATE))?.scene === 'play';
  };
  // The idle run comes first, on a fresh run: nothing is pressed, and the clock runs until the player is hurt and until game over.
  let idle = null, idleSoftlock = '', idleRestartOk = true;
  // A game can pause itself as it starts (a focus change), and the time on pause is not counted.
  if (idleOn && (await ensurePlay())) {
    idle = await idleRun(d, { maxSeconds: bars.idleLoseSeconds ?? GAME_BARS.idleLoseSeconds, frozenSeconds, fps });
    idleSoftlock = idle.softlock;
    const v = idleVerdict(idle, bars); rules.pressure = idle.softlock ? null : v.ok;
    if (idle.speed < 0.8) notes.push(`The game ran at about ${Math.round(idle.speed * 100)}% of real speed on this machine, so the idle times are in the game's own clock.`);
    if (v.ok === null && !idle.softlock) notes.push(`The idle run was watched for ${idle.watched} s of play, too short to judge the pressure rule.`);
    notes.push(`Idle run, no input: first hurt ${idle.hurt !== null ? `after ${idle.hurt} s` : idle.tellsHurt ? `not in ${idle.watched} s` : 'unknown'}, game over ${idle.lose !== null ? `after ${idle.lose} s${idle.won ? ' (a win)' : ''}` : `not in ${idle.watched} s`}.`, ...v.notes);
    if (idle.lose !== null) {
      scenes.add('over'); shots.push(await d.shot('over'));
      await d.key('Enter', true); await d.key('Enter', false);
      if (!(await until(d, `${STATE}?.scene === 'play'`, 3000))) idleRestartOk = false;
      await wait(400);
    }
  }
  const tryMove = async (act, after) => {
    for (let k = 0; k < 2; k++) {
      if (!(await ensurePlay())) { notes.push('The game would not stay in play long enough to test input.'); return false; }
      const a = await d.evaluate(STATE); await act(); const b = await d.evaluate(STATE); if (after) await after();
      if (moved(a, b)) return true;
      if (b?.scene !== 'play' && k === 0) notes.push(`It left play (${b?.scene}) during an input check, so the check ran again.`);
    }
    return false;
  };
  const input = {};
  input.keyboard = await tryMove(() => hold(d, 'ArrowRight', 500), () => hold(d, 'ArrowLeft', 300));
  input.gamepad = await tryMove(async () => { await d.evaluate('window.__pt.padOn = true; window.__pt.pad.axes[0] = -1; window.__pt.pad.axes[1] = 0.3'); await wait(500); }, () => d.evaluate('window.__pt.pad.axes[0] = 0; window.__pt.pad.axes[1] = 0'));
  if (d.phone) input.touch = await tryMove(() => d.drag(d.size.w * 0.22, d.size.h * 0.7, d.size.w * 0.22 + 70, d.size.h * 0.7 - 20, 600));
  rules.inputs = Object.values(input).every(Boolean);
  if (!rules.inputs) notes.push(`Input that did not move the player: ${Object.entries(input).filter(([, v]) => !v).map(([k]) => k).join(', ')}.`);
  // Pause and back.
  await ensurePlay();
  await d.key('Escape', true); await d.key('Escape', false);
  const paused = !!(await until(d, `${STATE}?.scene === 'pause'`, 1500)); if (paused) scenes.add('pause');
  if (paused) shots.push(await d.shot('pause'));
  await d.key('Escape', true); await d.key('Escape', false); await until(d, `${STATE}?.scene === 'play'`, 1500);
  // The long run: scripted and random input, watched once a second.
  // The idle run is part of the watched time, so the random run is shorter by it, though never under half.
  let softlock = idleSoftlock, frozenFor = 0, lastT = -1, pickFor = 0, overlayFor = 0, restarts = 0, restartOk = idleRestartOk;
  if (!idleRestartOk && !softlock) softlock = 'game over did not restart';
  const runMs = Math.max(seconds * 500, seconds * 1000 - (idle?.wallMs || 0)), end = Date.now() + runMs; let midShot = false, lastSample = 0;
  while (Date.now() < end && !softlock) {
    const r = random();
    if (r < 0.55) await hold(d, KEYS[Math.floor(random() * KEYS.length)], 80 + Math.floor(random() * 220));
    else if (r < 0.7) { await d.evaluate(`window.__pt.pad.axes[0] = ${(random() * 2 - 1).toFixed(2)}; window.__pt.pad.axes[1] = ${(random() * 2 - 1).toFixed(2)}`); await wait(200); }
    else if (r < 0.8 && d.phone) await d.drag(d.size.w * 0.2, d.size.h * 0.72, d.size.w * (0.1 + random() * 0.3), d.size.h * (0.6 + random() * 0.25), 250);
    else await wait(150);
    if (Date.now() - lastSample < 1000) continue;
    lastSample = Date.now();
    let s; try { s = await d.evaluate(STATE); } catch { softlock = 'the page stopped answering'; break; }
    if (!s) { softlock = 'the game\'s state went away'; break; }
    scenes.add(s.scene);
    if (s.scene === 'play') {
      if (s.fps) fps.push(s.fps);
      frozenFor = s.t === lastT ? frozenFor + 1 : 0; lastT = s.t;
      if (frozenFor >= frozenSeconds) softlock = `play froze for ${frozenSeconds} s`;
      if (!midShot && Date.now() > end - runMs / 2) { midShot = true; shots.push(await d.shot('play')); }
    } else if (s.scene === 'over') {
      if (!shots.some((x) => /over/.test(x))) shots.push(await d.shot('over'));
      await d.key('Enter', true); await d.key('Enter', false); restarts++;
      if (!(await until(d, `${STATE}?.scene === 'play'`, 3000))) { restartOk = false; softlock = 'game over did not restart'; }
      lastT = -1;
    } else if (s.scene === 'pause') { await d.key('Escape', true); await d.key('Escape', false); }
    else if (s.scene === 'pick') {
      pickFor++; await d.key('Enter', true); await d.key('Enter', false);
      if (pickFor > 3) await d.evaluate('document.querySelector("[data-pick]")?.click()');
      if (pickFor > 8) softlock = 'stuck on a choice screen';
    } else if (s.scene === 'menu') { await d.key('Enter', true); await d.key('Enter', false); }
    else if (['settings', 'help', 'board'].includes(s.scene)) { overlayFor++; await d.evaluate(clickText('.kit-screen button', 'Back')); if (overlayFor > 5) softlock = `stuck on the ${s.scene} screen`; }
    if (!['settings', 'help', 'board'].includes(s.scene)) overlayFor = 0;
    if (s.scene !== 'pick') pickFor = 0;
  }
  if (!midShot) shots.push(await d.shot('play'));
  // End a run on purpose, so game over, restart and the cloud are always checked.
  await d.evaluate('window.__pt.padOn = false');
  // From play, whatever screen the run ended on (an upgrade choice, say).
  await ensurePlay();
  await d.evaluate('window.officeGame.forceOver && window.officeGame.forceOver()');
  const over = await until(d, `${STATE}?.scene === 'over'`, 4000);
  if (over) { scenes.add('over'); if (!shots.some((x) => /over/.test(x))) shots.push(await d.shot('over')); }
  // The save is written as game over shows, so it is waited for rather than read once.
  const mode = await d.evaluate(`(async () => { const o = window.Office && window.Office.connect && window.Office.connect(); if (!o) return 'none'; await (o.ready || Promise.resolve()); return o.mode; })()`);
  const cloud = mode !== 'live' ? mode : (await until(d, `(async () => { const s = await window.Office.connect().saves.get('best', null); return s ? 'saved' : null; })()`, 6000, 300)) || 'nosave';
  let posted = false;
  if (over && cloud === 'saved') {
    await d.evaluate(clickText('[data-screen="over"] button', 'Post score'));
    posted = !!(await until(d, `(async () => { const r = await window.Office.connect().leaderboard.top('main', { limit: 5 }); return r.entries.length > 0; })()`, 5000, 300));
  }
  if (over) { await d.key('Enter', true); await d.key('Enter', false); if (!(await until(d, `${STATE}?.scene === 'play'`, 3000))) restartOk = false; }
  rules.cloud = cloud === 'saved' ? posted : cloud === 'nosave' ? false : null;
  if (rules.cloud === false) notes.push(cloud === 'nosave' ? 'No saved best was found after game over.' : over ? 'The score did not reach the leaderboard.' : 'Game over could not be reached to check saving.');
  if (rules.cloud === null) notes.push(`Office Cloud is '${cloud}' here (a local preview), so saves and the leaderboard are checked once it is published.`);
  rules.nosoftlock = !softlock && restartOk;
  if (softlock) notes.push(`Soft-lock: ${softlock}.`);
  const f = median(fps); rules.fps = fps.length ? f >= minFps : null;
  if (rules.fps === false) notes.push(`Frame rate ${f} fps, under ${minFps}.`);
  rules.screens = ['menu', 'play', 'pause', 'over'].every((x) => scenes.has(x)) && settingsOk;
  if (!rules.screens) notes.push(`Screens reached: ${[...scenes].filter(Boolean).join(', ')}${settingsOk ? ', settings' : ''}.`);
  const errors = await errorsOf(d); rules.loads = !errors.length;
  return { rules, notes, shots, errors, fps: f, restarts, scenes: [...scenes].filter(Boolean), input, idle: idle ? { hurt: idle.hurt, lose: idle.lose, won: idle.won, watched: idle.watched, tellsHurt: idle.tellsHurt, clock: idle.clock, speed: idle.speed } : null };
}

async function errorsOf(d) { let page = []; try { page = (await d.evaluate('window.__pt ? window.__pt.errors : []')) || []; } catch { /* gone */ } return [...new Set([...(d.errors?.() || []), ...page])].slice(0, 20); }
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
  rules.mobile = d.phone ? !!(await d.evaluate(noSideScroll)) : null;
  // Accounts need the Office server; a local preview on a computer can only check the pages.
  const mode = await d.evaluate('(async () => { const o = window.Office && window.Office.connect && window.Office.connect(); if (!o) return "none"; await (o.ready || Promise.resolve()); return o.mode; })()');
  if (mode !== 'live') { for (const k of ['signup', 'create', 'persist', 'relogin']) rules[k] = null; notes.push(`Office Cloud is '${mode}' here, so sign-up, saving and sign-in are checked once it is published.`); const errors = await errorsOf(d); rules.loads = !errors.length; return { rules, notes, shots, errors }; }
  // A first-time visitor: any session left from an earlier run in this browser goes first.
  await d.evaluate('(async () => { const o = window.Office && window.Office.connect && window.Office.connect(); if (o && o.auth && o.auth.user) await o.auth.logOut().catch(() => null); return true; })()');
  await d.goto(`${url}#/signup`);
  if (!(await until(d, visible('[data-office="auth-form"]'), 5000))) { notes.push('No sign-up form with data-office="auth-form".'); return { rules, notes, shots, errors: await errorsOf(d) }; }
  await d.evaluate(fill('[data-office="username"]', user)); await d.evaluate(fill('[data-office="password"]', password)); await d.evaluate(fill('[data-office="name"]', 'Play Tester'));
  await d.evaluate(submit('[data-office="auth-form"]'));
  rules.signup = !!(await until(d, visible('[data-office="create-form"]'), 8000));
  if (!rules.signup) { notes.push(`Sign-up did not reach the app: ${await d.evaluate('document.querySelector(\'[data-office="auth-error"]\')?.textContent || ""')}`); return { rules, notes, shots, errors: await errorsOf(d) }; }
  await until(d, `!document.querySelector('[data-office="list"][aria-busy]')`, 5000);
  await d.evaluate(fill('[data-office="create-input"]', item)); await d.evaluate(submit('[data-office="create-form"]'));
  rules.create = !!(await until(d, hasItem, 6000));
  shots.push(await d.shot('app'));
  await d.goto(`${url}#/app`);
  rules.persist = !!(await until(d, hasItem, 8000));
  await d.evaluate('document.querySelector(\'[data-office="signout"]\')?.click()');
  await until(d, '!document.querySelector(\'[data-office="signout"]\') || !!document.querySelector(\'[data-office="signout"]\').closest("[hidden]") || document.querySelector(\'[data-office="signout"]\').hidden', 5000);
  await d.goto(`${url}#/signin`); await until(d, visible('[data-office="auth-form"]'), 5000);
  await d.evaluate(fill('[data-office="username"]', user)); await d.evaluate(fill('[data-office="password"]', password)); await d.evaluate(submit('[data-office="auth-form"]'));
  rules.relogin = !!(await until(d, hasItem, 8000));
  if (d.phone && rules.mobile) rules.mobile = !!(await d.evaluate(noSideScroll));
  const errors = await errorsOf(d); rules.loads = !errors.length;
  for (const k of ['signup', 'create', 'persist', 'relogin']) if (!rules[k]) notes.push(`${k} failed.`);
  return { rules, notes, shots, errors };
}

/** A site: the phone layout, every link, the meta tags and a real form submission. */
export async function walkSite(d, { url } = {}) {
  const notes = [], shots = [], rules = { loads: null, mobile: null, links: null, meta: null, form: null };
  await d.goto(url); await until(d, 'document.readyState === "complete"', 8000); await wait(300);
  shots.push(await d.shot('site'));
  rules.mobile = d.phone ? !!(await d.evaluate(noSideScroll)) : null;
  const meta = await d.evaluate(`(() => { const m = (s) => document.querySelector(s)?.getAttribute('content') || ''; return { title: document.title.trim().length >= 3, description: m('meta[name="description"]').length >= 30, ogTitle: !!m('meta[property="og:title"]'), ogDescription: !!m('meta[property="og:description"]'), ogImage: !!m('meta[property="og:image"]'), viewport: !!document.querySelector('meta[name="viewport"]'), lang: !!document.documentElement.lang, favicon: !!document.querySelector('link[rel~="icon"]') }; })()`);
  rules.meta = Object.values(meta).every(Boolean);
  if (!rules.meta) notes.push(`Missing meta: ${Object.entries(meta).filter(([, v]) => !v).map(([k]) => k).join(', ')}.`);
  const broken = await d.evaluate(`(async () => { const bad = []; const seen = new Set();
    for (const a of document.querySelectorAll('a[href]')) { const h = a.getAttribute('href'); if (!h || seen.has(h)) continue; seen.add(h);
      if (h.startsWith('#')) { if (h.length > 1 && !document.getElementById(decodeURIComponent(h.slice(1)))) bad.push(h); continue; }
      let u; try { u = new URL(h, location.href); } catch { bad.push(h); continue; }
      if (u.origin !== location.origin) continue;
      try { const r = await fetch(u.href, { method: 'GET' }); if (!r.ok) bad.push(h + ' ' + r.status); } catch { bad.push(h); } }
    return bad; })()`);
  rules.links = !broken.length; if (broken.length) notes.push(`Broken links: ${broken.slice(0, 8).join(', ')}.`);
  const sent = await d.evaluate(`(() => { const f = document.querySelector('[data-office="contact-form"]') || document.querySelector('form'); if (!f) return false;
    for (const el of f.querySelectorAll('input, textarea')) { if (el.name === 'website' || el.type === 'hidden' || el.type === 'checkbox') continue; el.value = el.type === 'email' ? 'tester@example.org' : el.tagName === 'TEXTAREA' ? 'Hello from the playtest. Is this working?' : 'Pat Tester'; }
    f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event('submit', { cancelable: true })); return true; })()`);
  if (!sent) { rules.form = null; notes.push('No form on the page.'); }
  else rules.form = !!(await until(d, `/thank/i.test((document.querySelector('[data-office="form-status"]') || document.querySelector('[role="status"]') || {}).textContent || '')`, 8000));
  if (rules.form === false) notes.push(`The form did not thank the visitor: ${await d.evaluate('(document.querySelector(\'[data-office="form-status"]\') || {}).textContent || ""')}`);
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
