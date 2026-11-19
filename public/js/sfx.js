// Small sounds for a building you can touch: a click on every button, paper on a tab, and the ding of the lift. Quiet by nature, off with one button.
// Round 2, r2-j34 (docs/redesign/OFFICE-ANSWERS-2.md, Q7): sound is OFF until someone turns it on, the choice is remembered, and a hidden tab
// is silent. The rules are in sound-state.js, which a node test reads.
import { h } from './dom.js';
import { icon } from './icons.js';
import { SOUND_KEY as KEY, mutedAtStart, mayPlay } from './sound-state.js';

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
    if (!muted) unlock();
    paint();
  } });
  buttons.add(b);
  b.replaceChildren(icon(muted ? 'speaker-slash' : 'speaker-high'));
  b.setAttribute('aria-pressed', String(muted));
  b.setAttribute('aria-label', muted ? 'Turn the sound on' : 'Turn the sound off');
  return b;
}

/** One listener for the whole page: whatever a button does, it clicks when pressed. Tabs sound like paper. */
/** Whether sound is on right now (the button's choice). */
export const soundOn = () => !muted;

export function wireSounds() {
  // A hidden tab is silent: the sound system itself is suspended until the tab is seen again (and only resumed if sound is on).
  document.addEventListener('visibilitychange', () => { if (!ctx) return; if (document.hidden) ctx.suspend?.(); else if (!muted) ctx.resume?.(); });
  document.addEventListener('pointerdown', unlock, { capture: true, passive: true });
  document.addEventListener('keydown', unlock, { capture: true, passive: true });
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
    for (const m of list) if (m.oldValue?.includes('in') && !fade.classList.contains('in')) { sfx('ding', { volume: 0.9, rate: 0.82 }); return; }
  }).observe(fade, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
}
