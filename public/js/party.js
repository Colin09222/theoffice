// Launch parties: confetti and a little fanfare, in the lobby for a public launch and on the floor that launched it.
import { h } from './dom.js';
import { sfx } from './sfx.js';

const SEEN = 'office.party';
const GAP_MS = 60_000;
const COLORS = ['#ffb52e', '#e4572e', '#6dffa0', '#4ea5d9', '#fffdf4', '#c879ff'];
let lastAt = -Infinity;

/** Three rising dings. sfx stays quiet when the building is muted. */
export function fanfare() {
  sfx('ding', { volume: 0.6 });
  setTimeout(() => sfx('ding', { volume: 0.6, rate: 1.26 }), 150);
  setTimeout(() => sfx('ding', { volume: 0.75, rate: 1.5 }), 300);
}

export function confetti({ brand, pieces = window.innerWidth <= 760 ? 30 : 48 } = {}) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = brand ? [brand, ...COLORS] : COLORS;
  const layer = h('div.confetti', { 'aria-hidden': 'true', 'data-party': 'confetti' });
  for (let i = 0; i < pieces; i++) {
    layer.append(h('i', { css: { left: `${Math.random() * 100}%`, background: colors[i % colors.length], '--dx': `${Math.round((Math.random() - 0.5) * 240)}px`, '--spin': `${Math.round(Math.random() * 900 - 450)}deg`, 'animation-delay': `${(Math.random() * 0.3).toFixed(2)}s`, 'animation-duration': `${(1.3 + Math.random() * 0.8).toFixed(2)}s` } }));
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 2600);
}

/** One party a minute in any tab, and the same launch is never celebrated twice. */
export function mayParty(id) {
  const t = Date.now();
  let seen = 0;
  try { seen = Number(localStorage.getItem(SEEN)) || 0; } catch { /* private mode */ }
  if (id && id <= seen) return false;
  if (t - lastAt < GAP_MS) return false;
  lastAt = t;
  try { if (id) localStorage.setItem(SEEN, String(id)); } catch { /* private mode */ }
  return true;
}
