// Office game kit: screens, input, audio, settings, saves, leaderboard and juice for any canvas game. No engine inside, so the 2D
// (Phaser) and 3D (three.js) starters share it. The game plugs in with kit.run({ start, update, render, state }) and reads kit.input.
// Test hook: window.officeGame.state() is what the Tester's playtest reads. Keep it working when you change the game.
const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, attrs = {}, ...kids) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v); } for (const c of kids.flat()) n.append(c?.nodeType ? c : document.createTextNode(String(c ?? ''))); return n; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---- settings: kept on this device and in the player's Office Cloud save ----
const DEFAULTS = { volume: 0.7, muted: false, music: true, shake: true, touch: 'auto', name: '' };
function loadSettings() { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('kit.settings') || '{}') }; } catch { return { ...DEFAULTS }; } }
export const settings = loadSettings();
if (matchMedia?.('(prefers-reduced-motion: reduce)').matches && localStorage.getItem('kit.settings') == null) settings.shake = false;
export function saveSettings() { try { localStorage.setItem('kit.settings', JSON.stringify(settings)); } catch { /* private mode */ } audio.apply(); }

// ---- Office Cloud: saves and a shared leaderboard. Falls back to this device when there is no Office server (a local preview). ----
const office = window.Office?.connect ? window.Office.connect() : null;
export const cloud = {
  office,
  get live() { return !!office && office.mode !== 'local'; },
  async load(key, fallback) { try { return office ? await office.saves.get(key, fallback) : JSON.parse(localStorage.getItem(`kit.save.${key}`) ?? 'null') ?? fallback; } catch { return fallback; } },
  async save(key, value) { try { if (office) await office.saves.set(key, value); else localStorage.setItem(`kit.save.${key}`, JSON.stringify(value)); return true; } catch (e) { toast(e.message || 'Could not save'); return false; } },
  async submit(score, name) { if (!office) return null; try { return await office.leaderboard.submit('main', Math.floor(score), { name: (name || 'Player').slice(0, 24) }); } catch (e) { toast(e.message || 'Score not sent'); return null; } },
  async top(limit = 10) { if (!office) return { entries: [], me: null }; try { return await office.leaderboard.top('main', { limit }); } catch { return { entries: [], me: null }; } },
};

// ---- input: keyboard, touch and gamepad as one set of actions ----
const KEYS = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', Space: 'action', KeyJ: 'action', KeyZ: 'action', ShiftLeft: 'alt', ShiftRight: 'alt', KeyK: 'alt', KeyX: 'alt', Escape: 'pause', KeyP: 'pause', Enter: 'confirm', KeyM: 'mute' };
const ACTIONS = ['left', 'right', 'up', 'down', 'action', 'alt', 'pause', 'confirm', 'mute'];
export const input = {
  held: Object.fromEntries(ACTIONS.map((a) => [a, false])), was: {}, stick: { x: 0, y: 0 }, pad: { x: 0, y: 0 }, device: 'keyboard', events: 0,
  down(a) { return this.held[a]; },
  pressed(a) { return this.held[a] && !this.was[a]; },
  axis() {
    const kx = (this.held.right ? 1 : 0) - (this.held.left ? 1 : 0), ky = (this.held.down ? 1 : 0) - (this.held.up ? 1 : 0);
    let x = kx || this.stick.x || this.pad.x, y = ky || this.stick.y || this.pad.y;
    const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
    return { x, y };
  },
  set(a, on, device) { if (this.held[a] !== on) this.events++; this.held[a] = on; if (device) this.device = device; },
  endFrame() { this.was = { ...this.held }; },
};
addEventListener('keydown', (e) => { const a = KEYS[e.code]; if (!a) return; if (a !== 'confirm' || state.scene === 'play') e.preventDefault(); audio.unlock(); input.set(a, true, 'keyboard'); });
addEventListener('keyup', (e) => { const a = KEYS[e.code]; if (a) input.set(a, false, 'keyboard'); });
addEventListener('blur', () => { for (const a of ACTIONS) input.held[a] = false; if (state.scene === 'play') pause(true); });
document.addEventListener('visibilitychange', () => { if (document.hidden && state.scene === 'play') pause(true); });
const PAD_BUTTONS = { 0: 'action', 1: 'alt', 2: 'action', 3: 'alt', 9: 'pause', 8: 'mute', 12: 'up', 13: 'down', 14: 'left', 15: 'right' };
function pollPad() {
  const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  const p = pads[0]; if (!p) { input.pad.x = input.pad.y = 0; return; }
  const dz = (v) => (Math.abs(v) < 0.2 ? 0 : v);
  input.pad.x = dz(p.axes[0] || 0); input.pad.y = dz(p.axes[1] || 0);
  for (const [i, a] of Object.entries(PAD_BUTTONS)) { const on = !!p.buttons[i]?.pressed; if (on || input.device === 'gamepad') { if (on !== input.held[a]) input.set(a, on, 'gamepad'); } }
  if (input.pad.x || input.pad.y) input.device = 'gamepad';
}

// Touch: a stick under the left thumb wherever it lands, and two buttons under the right.
function touchControls(root) {
  const pad = el('div', { class: 'kit-touch', 'aria-hidden': 'true' },
    el('div', { class: 'kit-stick' }, el('i')),
    el('button', { class: 'kit-btn kit-a', type: 'button', 'data-act': 'action' }, 'A'),
    el('button', { class: 'kit-btn kit-bb', type: 'button', 'data-act': 'alt' }, 'B'),
    el('button', { class: 'kit-btn kit-pause', type: 'button', 'data-act': 'pause', 'aria-label': 'Pause' }, 'II'));
  root.append(pad);
  const stick = $('.kit-stick', pad), knob = $('i', stick);
  let id = null, ox = 0, oy = 0;
  pad.addEventListener('pointerdown', (e) => {
    audio.unlock(); input.device = 'touch'; document.body.classList.add('kit-touching');
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act) { input.set(act, true, 'touch'); e.target.setPointerCapture?.(e.pointerId); e.target.addEventListener('pointerup', () => input.set(act, false, 'touch'), { once: true }); e.target.addEventListener('pointercancel', () => input.set(act, false, 'touch'), { once: true }); return; }
    if (e.clientX > innerWidth * 0.55 || id !== null) return;
    id = e.pointerId; ox = e.clientX; oy = e.clientY; stick.style.left = `${ox}px`; stick.style.top = `${oy}px`; stick.classList.add('on');
    pad.setPointerCapture?.(e.pointerId);
  });
  pad.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    const dx = e.clientX - ox, dy = e.clientY - oy, r = 46, m = Math.hypot(dx, dy) || 1, k = Math.min(1, m / r);
    input.stick.x = (dx / m) * k; input.stick.y = (dy / m) * k; input.events++;
    knob.style.transform = `translate(${input.stick.x * r}px, ${input.stick.y * r}px)`;
  });
  const end = (e) => { if (e.pointerId !== id) return; id = null; input.stick.x = input.stick.y = 0; knob.style.transform = ''; stick.classList.remove('on'); };
  pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end);
  return pad;
}

// ---- audio: small synthesised sounds, a quiet music loop, one mute ----
export const audio = {
  ctx: null, master: null, musicGain: null, timer: null,
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    this.ctx = new AC(); this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain(); this.musicGain.connect(this.master); this.apply();
  },
  apply() { if (!this.master) return; this.master.gain.value = settings.muted ? 0 : settings.volume; this.musicGain.gain.value = settings.music ? 0.18 : 0; $('[data-kit-mute]')?.setAttribute('aria-pressed', String(settings.muted)); },
  tone(freq, dur, { type = 'square', slide = 0, vol = 0.25, at = 0, dest } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + at, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(dest || this.master); o.start(t); o.stop(t + dur + 0.02);
  },
  noise(dur, vol = 0.3) {
    if (!this.ctx) return;
    const n = Math.floor(this.ctx.sampleRate * dur), b = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = this.ctx.createBufferSource(), g = this.ctx.createGain(); s.buffer = b; g.gain.value = vol; s.connect(g); g.connect(this.master); s.start();
  },
  sfx(name) {
    const S = {
      shoot: () => this.tone(880, 0.08, { slide: 0.5, vol: 0.12 }),
      hit: () => { this.tone(220, 0.12, { type: 'sawtooth', slide: 0.4, vol: 0.2 }); this.noise(0.08, 0.15); },
      explode: () => { this.noise(0.35, 0.35); this.tone(120, 0.3, { type: 'triangle', slide: 0.3, vol: 0.3 }); },
      pickup: () => { this.tone(660, 0.06, { vol: 0.15 }); this.tone(990, 0.08, { vol: 0.15, at: 0.05 }); },
      power: () => [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.12, { type: 'triangle', vol: 0.18, at: i * 0.06 })),
      hurt: () => { this.tone(160, 0.25, { type: 'sawtooth', slide: 0.5, vol: 0.3 }); this.noise(0.15, 0.2); },
      select: () => this.tone(520, 0.05, { type: 'triangle', vol: 0.12 }),
      lose: () => [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.25, { type: 'triangle', vol: 0.22, at: i * 0.16 })),
      win: () => [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.18, { type: 'square', vol: 0.14, at: i * 0.09 })),
      dash: () => this.tone(300, 0.15, { type: 'sine', slide: 2.5, vol: 0.2 }),
    };
    S[name]?.();
  },
  music(on) {
    clearInterval(this.timer); this.timer = null;
    if (!on || !this.ctx) return;
    const notes = [0, 3, 7, 10, 7, 3, 12, 7], root = 110; let i = 0;
    this.timer = setInterval(() => { if (state.scene !== 'play') return; const n = notes[i++ % notes.length]; this.tone(root * 2 ** (n / 12), 0.22, { type: 'triangle', vol: 0.5, dest: this.musicGain }); if (i % 4 === 1) this.tone(root / 2, 0.4, { type: 'sine', vol: 0.6, dest: this.musicGain }); }, 240);
  },
};

// ---- juice: hit-stop, screen shake, tweens and easing that any renderer can use ----
export const ease = { linear: (t) => t, outQuad: (t) => 1 - (1 - t) ** 2, inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2), outBack: (t) => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2, outElastic: (t) => (t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1) };
const tweens = new Set();
export const juice = {
  stopUntil: 0, trauma: 0, offset: { x: 0, y: 0 },
  hitStop(ms = 60) { this.stopUntil = Math.max(this.stopUntil, performance.now() + ms); },
  shake(amount = 0.4) { if (settings.shake) this.trauma = clamp(this.trauma + amount, 0, 1); },
  tween(obj, to, ms = 300, fn = ease.outQuad) { const from = Object.fromEntries(Object.keys(to).map((k) => [k, obj[k]])); return new Promise((done) => tweens.add({ obj, from, to, ms, fn, t: 0, done })); },
  step(dt) {
    for (const tw of tweens) { tw.t += dt * 1000; const k = tw.fn(Math.min(1, tw.t / tw.ms)); for (const p in tw.to) tw.obj[p] = tw.from[p] + (tw.to[p] - tw.from[p]) * k; if (tw.t >= tw.ms) { tweens.delete(tw); tw.done(); } }
    const s = this.trauma * this.trauma * 14; const t = performance.now() / 1000;
    this.offset.x = s * Math.sin(t * 61.3) * Math.cos(t * 13.7); this.offset.y = s * Math.cos(t * 57.1) * Math.sin(t * 17.9);
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
  },
  get stopped() { return performance.now() < this.stopUntil; },
};

// ---- screens ----
const state = { scene: 'boot', score: 0, best: 0, frames: 0, fps: 0, t: 0, game: null, title: document.title };
let ui, game, last = 0, fpsAcc = 0, fpsN = 0;
export function toast(text) { const t = el('div', { class: 'kit-toast', role: 'status' }, text); ui?.append(t); setTimeout(() => t.remove(), 2600); }
function screen(name, ...kids) {
  ui.querySelector('.kit-screen')?.remove();
  if (!name) return null;
  const s = el('section', { class: `kit-screen kit-${name}`, 'data-screen': name }, ...kids);
  ui.append(s);
  const first = s.querySelector('button:not([disabled]), input, select');
  setTimeout(() => first?.focus({ preventScroll: true }), 30);
  return s;
}
const button = (label, fn, attrs = {}) => el('button', { type: 'button', class: 'kit-b', onclick: () => { audio.unlock(); audio.sfx('select'); fn(); }, ...attrs }, label);
function menu() {
  state.scene = 'menu'; document.body.dataset.scene = 'menu';
  screen('menu', el('h1', {}, state.title), el('p', { class: 'kit-pitch' }, game.pitch || ''),
    button('Play', startGame, { 'data-kit-play': '' }), button('How to play', help), button('Leaderboard', board), button('Settings', () => settingsScreen(menu)),
    el('p', { class: 'kit-best' }, state.best ? `Best: ${state.best}` : ''));
}
function help() { screen('help', el('h2', {}, 'How to play'), el('p', {}, game.howTo || 'Move, survive, score.'), el('p', { class: 'kit-keys' }, 'Keys: arrows or WASD to move, Space for A, Shift for B, Esc to pause, M to mute. Touch: left thumb moves, A and B on the right. Gamepad works too.'), button('Back', menu)); }
async function board(back = menu) {
  const list = el('ol', { class: 'kit-board' }, el('li', {}, 'Loading...'));
  screen('board', el('h2', {}, 'Leaderboard'), list, button('Back', back));
  const r = await cloud.top(10);
  list.replaceChildren(...(r.entries.length ? r.entries.map((e) => el('li', { class: e.you ? 'you' : '' }, el('span', {}, e.name), el('b', {}, String(e.score)))) : [el('li', {}, cloud.office ? 'No scores yet. Be the first.' : 'The leaderboard goes live once this is published.')]));
}
function settingsScreen(back) {
  const prev = state.scene; state.scene = prev === 'pause' ? 'pause' : 'settings';
  const row = (label, control) => el('label', { class: 'kit-row' }, el('span', {}, label), control);
  const vol = el('input', { type: 'range', min: 0, max: 1, step: 0.05, value: settings.volume, oninput: (e) => { settings.volume = Number(e.target.value); saveSettings(); } });
  const check = (key, after) => { const c = el('input', { type: 'checkbox', onchange: (e) => { settings[key] = e.target.checked; saveSettings(); after?.(); } }); c.checked = !!settings[key]; return c; };
  const touch = el('select', { onchange: (e) => { settings.touch = e.target.value; saveSettings(); applyTouch(); } }, ...['auto', 'on', 'off'].map((v) => { const o = el('option', { value: v }, v); if (settings.touch === v) o.selected = true; return o; }));
  screen('settings', el('h2', {}, 'Settings'), row('Volume', vol), row('Mute', check('muted')), row('Music', check('music', () => audio.music(settings.music))), row('Screen shake', check('shake')), row('Touch controls', touch), button('Back', () => { state.scene = prev; back(); }));
}
function applyTouch() { const show = settings.touch === 'on' || (settings.touch === 'auto' && (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window)); ui.classList.toggle('kit-has-touch', show); }
async function startGame() {
  screen(null); state.scene = 'play'; document.body.dataset.scene = 'play'; state.score = 0; state.t = 0;
  audio.unlock(); audio.music(settings.music);
  await game.start?.();
}
export function pause(on) {
  if (on && state.scene === 'play') {
    state.scene = 'pause'; document.body.dataset.scene = 'pause';
    screen('pause', el('h2', {}, 'Paused'), button('Resume', () => pause(false)), button('Settings', () => settingsScreen(() => pause(true, true))), button('Quit to menu', () => { game.quit?.(); menu(); }));
  } else if (!on && state.scene === 'pause') { screen(null); state.scene = 'play'; document.body.dataset.scene = 'play'; last = performance.now(); }
}
/** The game calls this when the run ends. It saves the best, posts the score and shows the game-over screen. */
export async function gameOver({ score = state.score, won = false, stats = {} } = {}) {
  if (state.scene !== 'play') return;
  state.scene = 'over'; document.body.dataset.scene = 'over'; state.score = Math.floor(score);
  audio.sfx(won ? 'win' : 'lose');
  const isBest = state.score > state.best; if (isBest) state.best = state.score;
  const name = el('input', { type: 'text', maxlength: 24, value: settings.name || '', placeholder: 'Your name', 'aria-label': 'Your name for the leaderboard' });
  const rank = el('p', { class: 'kit-rank' }, '');
  const send = button('Post score', async () => { settings.name = name.value.trim() || 'Player'; saveSettings(); send.disabled = true; const r = await cloud.submit(state.score, settings.name); rank.textContent = r?.rank ? `You're #${r.rank} on the board.` : cloud.office ? '' : 'Scores post once this is published.'; });
  screen('over', el('h2', {}, won ? 'You win!' : 'Game over'), el('p', { class: 'kit-score' }, String(state.score)), el('p', {}, isBest ? 'New best!' : `Best: ${state.best}`),
    ...Object.entries(stats).map(([k, v]) => el('p', { class: 'kit-stat' }, `${k}: ${v}`)), rank, el('div', { class: 'kit-row' }, name, send),
    button('Play again', startGame, { 'data-kit-again': '' }), button('Leaderboard', () => board(() => gameOver.show())), button('Menu', menu));
  gameOver.show = () => { state.scene = 'over'; screen('over', el('h2', {}, 'Game over'), el('p', { class: 'kit-score' }, String(state.score)), button('Play again', startGame, { 'data-kit-again': '' }), button('Menu', menu)); };
  await cloud.save('best', { best: state.best, at: Date.now() });
}
export const addScore = (n) => { state.score += n; };
/** A choice mid-run, such as an upgrade between waves. Play waits until one is picked. Resolves with the index. */
export function choose(title, options) {
  return new Promise((resolve) => {
    state.scene = 'pick'; document.body.dataset.scene = 'pick';
    screen('pick', el('h2', {}, title), ...options.map((o, i) => button(o.label || o, () => { screen(null); state.scene = 'play'; document.body.dataset.scene = 'play'; last = performance.now(); resolve(i); }, { 'data-pick': String(i), title: o.text || '' })));
  });
}

// Keyboard and gamepad move focus round a screen's buttons; confirm or A presses the focused one.
function navigate() {
  const s = ui.querySelector('.kit-screen'); if (!s) return;
  const items = [...s.querySelectorAll('button:not([disabled]), input, select')]; if (!items.length) return;
  const i = items.indexOf(document.activeElement);
  if (input.pressed('down') || input.pressed('right') && document.activeElement?.type !== 'range') { items[(i + 1) % items.length].focus(); audio.sfx('select'); }
  if (input.pressed('up') || input.pressed('left') && document.activeElement?.type !== 'range') { items[(i - 1 + items.length) % items.length].focus(); audio.sfx('select'); }
  if ((input.pressed('action') && input.device !== 'keyboard') || (input.pressed('confirm') && input.device === 'gamepad')) document.activeElement?.click?.();
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
  fpsAcc += dt; fpsN++; if (fpsAcc >= 0.5) { state.fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
  pollPad();
  if (input.pressed('mute')) { settings.muted = !settings.muted; saveSettings(); toast(settings.muted ? 'Muted' : 'Sound on'); }
  if (state.scene === 'play' && input.pressed('pause')) pause(true);
  else if (state.scene === 'pause' && input.pressed('pause')) pause(false);
  else if (state.scene === 'over' && input.pressed('confirm')) startGame();
  else if (state.scene === 'menu' && input.pressed('confirm') && document.activeElement?.tagName !== 'BUTTON') startGame();
  if (state.scene !== 'play') navigate();
  juice.step(dt);
  if (state.scene === 'play' && !juice.stopped) { state.t += dt; state.frames++; game.update?.(dt, input); }
  game.render?.(dt, state.scene);
  input.endFrame();
}

/**
 * Starts everything. game: {title, pitch, howTo, start(), update(dt, input), render(dt, scene), quit(), state()}.
 * state() returns what the Tester's playtest compares as it plays: {score, lives, level, wave, player: {x, y}, ...}.
 */
export async function run(g) {
  game = g; state.title = g.title || document.title;
  ui = el('div', { class: 'kit-ui' }); document.body.append(ui);
  ui.append(el('button', { class: 'kit-mute', type: 'button', 'data-kit-mute': '', 'aria-label': 'Mute', 'aria-pressed': String(settings.muted), onclick: () => { audio.unlock(); settings.muted = !settings.muted; saveSettings(); } }, '♪'));
  touchControls(ui); applyTouch();
  const boot = screen('boot', el('h1', {}, state.title), el('div', { class: 'kit-bar' }, el('i')));
  try { await g.boot?.((p) => { const i = boot.querySelector('.kit-bar i'); if (i) i.style.width = `${Math.round(p * 100)}%`; }); } catch (e) { console.error(e); }
  const saved = await cloud.load('best', null); state.best = saved?.best || 0;
  window.officeGame = { version: 1, state: () => ({ scene: state.scene, score: state.score, best: state.best, t: Math.round(state.t * 10) / 10, frames: state.frames, fps: state.fps, device: input.device, inputs: input.events, cloud: cloud.live ? 'live' : cloud.office ? cloud.office.mode : 'none', ...(g.state?.() || {}) }), start: startGame, pause: () => pause(true), resume: () => pause(false), menu };
  menu();
  requestAnimationFrame(frame);
}
