// Hero card crossfade (round 2, r2-j33; docs/redesign/OFFICE-ANSWERS-2.md, Q1): a hero card with more than one real screenshot fades between
// them, up to 3, each held 4 s, with a 0.6 s fade. Only a card that is on screen animates; a card scrolled away, a hidden tab and "reduce
// motion" hold still on the first picture. Phone "low" keeps it (Q9's table). No 3D, no model: two <img> layers and a timer.
//
// The timing is a small controller with its clock passed in, so a node test can run it on a fake clock (test/r2-hero.test.js).

export const HOLD_MS = 4000, FADE_MS = 600, MAX_FRAMES = 3;

/** The frames a card shows: its real screenshots, in order, no repeats, 3 at most. */
export function heroFrames(pr) {
  const out = [];
  for (const u of Array.isArray(pr?.shots) ? pr.shots : []) if (typeof u === 'string' && u && !out.includes(u)) out.push(u);
  return out.slice(0, MAX_FRAMES);
}

/**
 * The clock of one card. `show(i)` is called each time frame i should fade in. It runs only while `setVisible(true)` and only with 2 or more
 * frames and no reduce motion. `timers` defaults to the page's own setTimeout/clearTimeout.
 */
export function makeFader({ count, show, reduce = false, timers = globalThis }) {
  let i = 0, timer = null, visible = false;
  const can = count > 1 && !reduce;
  const tick = () => { timer = null; i = (i + 1) % count; show(i); arm(); };
  const arm = () => { if (can && visible && !timer) timer = timers.setTimeout(tick, HOLD_MS); };
  const disarm = () => { if (timer) { timers.clearTimeout(timer); timer = null; } };
  return {
    get index() { return i; },
    get running() { return !!timer; },
    setVisible(on) { visible = !!on; if (visible) arm(); else disarm(); },
    stop() { visible = false; disarm(); },
  };
}

/**
 * Wire a hero card: a second picture layer over the first, swapped by opacity (the 0.6 s fade is a CSS transition on .lcard-fade), and the
 * card's own clock started and stopped by an IntersectionObserver, so only the card in view animates.
 */
export function crossfade(card, frames) {
  const shot = card.querySelector('.lcard-shot');
  const base = shot?.querySelector('img');
  if (!shot || !base || frames.length < 2) return null;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  base.src = frames[0];
  const top = base.cloneNode(); top.classList.add('lcard-fade'); top.style.opacity = '0'; shot.append(top);
  let front = base, back = top;
  const fader = makeFader({ count: frames.length, reduce, show: (n) => {
    back.src = frames[n];
    const swap = () => { back.style.opacity = '1'; front.style.opacity = back === top ? '1' : '0'; [front, back] = [back, front]; };
    if (back.complete) swap(); else back.addEventListener('load', swap, { once: true });
  } });
  card.dataset.frames = String(frames.length);
  let inView = false;
  const sync = () => fader.setVisible(inView && !document.hidden);
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => { inView = es.some((e) => e.isIntersecting); sync(); }, { threshold: 0.35 }) : null;
  if (io) io.observe(card); else { inView = true; sync(); }
  document.addEventListener('visibilitychange', sync);
  return { fader, stop() { fader.stop(); io?.disconnect(); document.removeEventListener('visibilitychange', sync); } };
}
