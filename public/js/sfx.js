// Small sounds for a building you can touch: a click on every button, paper on a tab, and the ding of the lift. Quiet by nature, off with one button.
// Round 2, r2-j34 (docs/redesign/OFFICE-ANSWERS-2.md, Q7): sound is OFF until someone turns it on, the choice is remembered, and a hidden tab
// is silent. The rules are in sound-state.js, which a node test reads.
import { h } from './dom.js';
import { icon } from './icons.js';
import { SOUND_KEY as KEY, mutedAtStart, mayPlay, makeGate, EVENT_SOUNDS, EVENT_VOLUME, ROOM_TONE_VOLUME } from './sound-state.js';

let ctx = null, gain = null, loading = null;
const buffers = {};
let muted = true;
try { muted = mutedAtStart(localStorage.getItem(KEY)); } catch { /* private mode: off, as for anyone new */ }
const buttons = new Set();

// Browsers only allow sound after a touch, so nothing loads before the first one.
function unlock() {
  if (loading) { ctx?.resume?.(); return loading; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return (loading = Promise.resolve());
  ctx = new AC(); gain = ctx.createGain(); gain.gain.value = 0.55; gain.connect(ctx.destination);
  ctx.resume?.();
  loading = import('./sfx-data.js').then(async ({ SOUNDS }) => {
    await Promise.all(Object.entries(SOUNDS).map(async ([name, b64]) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      buffers[name] = await ctx.decodeAudioData(bytes.buffer);
    }));
  }).catch(() => { /* no sound is a fine way to run an office */ });
  return loading;
}

export function sfx(name, { volume = 1, rate = 1 } = {}) {
  if (!mayPlay({ muted, hidden: document.hidden }) || !ctx || !buffers[name]) return;
  try {
    const src = ctx.createBufferSource(); src.buffer = buffers[name]; src.playbackRate.value = rate;
    const g = ctx.createGain(); g.gain.value = volume;
    src.connect(g); g.connect(gain); src.start();
  } catch { /* the context can be suspended by the system */ }
}

function paint() {
  for (const b of buttons) {
    if (!b.isConnected) { buttons.delete(b); continue; }
    b.replaceChildren(icon(muted ? 'speaker-slash' : 'speaker-high'));
    b.setAttribute('aria-pressed', String(muted));
    b.setAttribute('aria-label', muted ? 'Turn the sound on' : 'Turn the sound off');
    b.title = muted ? 'Sound off' : 'Sound on';
  }
}
export function muteButton() {
  const b = h('button.mute-btn', { type: 'button', 'data-mute': '', onclick: () => {
    muted = !muted;
    try { localStorage.setItem(KEY, muted ? '1' : '0'); } catch { /* private mode */ }
    if (!muted) unlock()?.then?.(syncTone); else syncTone();
    paint();
  } });
  buttons.add(b);
  b.replaceChildren(icon(muted ? 'speaker-slash' : 'speaker-high'));
  b.setAttribute('aria-pressed', String(muted));
  b.setAttribute('aria-label', muted ? 'Turn the sound on' : 'Turn the sound off');
  return b;
}

/** One listener for the whole page: whatever a button does, it clicks when pressed. Tabs sound like paper. */
// Round 2, r2-j43: the event sounds (launch bell, paper thunk, stamp, lift ding) at 40%, one every 2 s at most, through one gate; room tone at 15%.
const gate = makeGate();
export const soundLog = [];  // what played, for the browser test: [{ kind, at }]
/** Play one event sound, if sound is on, the tab is in view and no event sound played in the last 2 s. Returns whether it played. */
export function eventSound(kind, now = performance.now()) {
  const e = EVENT_SOUNDS[kind];
  if (!e || !mayPlay({ muted, hidden: document.hidden }) || !ctx || !buffers[e[0]]) return false;
  if (!gate(now)) return false;
  try {
    const src = ctx.createBufferSource(); src.buffer = buffers[e[0]]; src.playbackRate.value = e[1];
    const g = ctx.createGain(); g.gain.value = EVENT_VOLUME;
    src.connect(g); g.connect(ctx.destination); src.start();
    soundLog.push({ kind, at: Math.round(now) }); if (soundLog.length > 50) soundLog.shift();
    return true;
  } catch { return false; }
}
let tone = null;
/** The room tone: a soft, low hum of a room with people in it, at 15%, only while a floor's room is open, sound is on and the tab is in view. */
function roomTone(want) {
  want = want && mayPlay({ muted, hidden: document.hidden }) && !!ctx;
  if (!want) { if (tone) { try { tone.src.stop(); } catch { /* already stopped */ } tone = null; } return; }
  if (tone) return;
  const len = ctx.sampleRate * 4, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  let last = 0; for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.2; }  // brown noise
  const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
  const g = ctx.createGain(); g.gain.value = ROOM_TONE_VOLUME;
  src.connect(lp); lp.connect(g); g.connect(ctx.destination); src.start();
  tone = { src, gain: g };
}
const syncTone = () => roomTone(document.body?.dataset.page === 'floor');
/** Whether the room tone is playing (for the browser test). */
export const toneOn = () => !!tone;

/** Whether sound is on right now (the button's choice). */
export const soundOn = () => !muted;

export function wireSounds() {
  // A hidden tab is silent: the sound system itself is suspended until the tab is seen again (and only resumed if sound is on).
  document.addEventListener('visibilitychange', () => { syncTone(); if (!ctx) return; if (document.hidden) ctx.suspend?.(); else if (!muted) ctx.resume?.(); });
  new MutationObserver(syncTone).observe(document.body, { attributes: true, attributeFilter: ['data-page'] });
  const wake = () => { unlock()?.then?.(syncTone); };
  window.__officeSound = { log: soundLog, eventSound, toneOn };  // read by the browser tests
  document.addEventListener('pointerdown', wake, { capture: true, passive: true });
  document.addEventListener('keydown', wake, { capture: true, passive: true });
  document.addEventListener('click', (e) => {
    const t = e.target.closest?.('button, a.btn, [role=tab]');
    if (!t || t.disabled) return;
    if (t.matches('.tab, .pin')) sfx('tab', { volume: 0.8 });
    else if (t.matches('.send')) sfx('send', { volume: 0.6 });
    else if (t.matches('.lift-btn, .scrub-tick, .scrub-btn')) sfx('press', { volume: 1, rate: 0.75 });
    else sfx('press', { volume: 0.8 });
  }, true);
  // The lift doors open with a ding, wherever the trip began.
  const fade = document.getElementById('fade');
  if (fade) new MutationObserver((list) => {
    for (const m of list) if (m.oldValue?.includes('in') && !fade.classList.contains('in')) { eventSound('lift'); return; }
  }).observe(fade, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
}
