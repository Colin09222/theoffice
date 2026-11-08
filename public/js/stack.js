// The building as a stacked cutaway: every floor at once, roof to ground, as plain strips you slide through. No WebGL in here: a strip
// is a few DOM nodes in its company's colours, its staff as badge faces, and a status line from the public floor list. Only the strips
// on screen animate, and the 3D scene behind sleeps while this is up.
import { h, api, clear, isPhone } from './dom.js';
import { stage } from './stage.js';
import { portrait } from './portrait.js';

const MODE_KEY = 'office:lobby-mode', SPOT_KEY = 'office:stack-y';
const MAX_FACES = 6;

/** Building (the stack) or Outside (the 3D tower). Phones and machines without WebGL start in the Building; a choice is remembered. */
export function lobbyMode() {
  let m = null; try { m = localStorage.getItem(MODE_KEY); } catch { /* private mode */ }
  if (m === 'building' || m === 'outside') return stage.ok ? m : 'building';
  return isPhone() || !stage.ok ? 'building' : 'outside';
}
export function setLobbyMode(m) { try { localStorage.setItem(MODE_KEY, m); } catch { /* private mode */ } }

/** One line on how the floor is doing, from what the directory already knows. */
export function statusLine(c) {
  if (c.status === 'suspended') return 'Closed by the building manager';
  if (c.setup || !c.name) return 'New company moving in';
  const mode = c.workMode && c.workMode.label !== 'On call' ? c.workMode.label : '';
  if (c.workMode?.closed) return `${mode || 'Closed'} · closed for now`;
  const at = c.busy ? `${c.busy} at work now` : 'Quiet right now';
  return mode ? `${at} · ${mode}` : at;
}

function strip(card, staff, onEnter) {
  const brand = card.colors?.primary || '#d9774a', accent = card.colors?.accent || brand;
  const moving = card.setup || !card.name;
  const faces = h('span.stack-staff', { 'aria-hidden': 'true' });
  for (const p of staff.slice(0, MAX_FACES)) {
    const f = portrait(p.look, { accent, name: p.name, develop: false });
    if (p.busy) f.classList.add('busy');
    faces.append(f);
  }
  if (staff.length > MAX_FACES) faces.append(h('span.stack-more', {}, `+${staff.length - MAX_FACES}`));
  const busy = !moving && card.status === 'active' && (card.busy > 0 || staff.some((p) => p.busy));
  return h(`button.stack-strip${moving ? '.moving' : ''}${card.status === 'suspended' ? '.shut' : ''}`, {
    type: 'button', 'data-floor': card.number, css: { '--brand': brand, '--accent': accent },
    'aria-label': `Floor ${card.number}, ${card.name || 'new company moving in'}. ${statusLine(card)}`,
    onclick: () => onEnter(card),
  },
  h('span.stack-num', {}, String(card.number)),
  h('span.stack-text', {},
    h('b', {}, card.name || 'New company moving in'),
    h('small', {}, busy ? h('i.stack-dot', { 'aria-hidden': 'true' }) : null, statusLine(card)),
    staff.length ? faces : null),
  h('span.stack-go', { 'aria-hidden': 'true' }, '›'));
}

/** The stack, ready to be shown or hidden. update() takes a fresh /floors answer; the staff come from their own small list. */
export function buildStack({ onEnter }) {
  const list = h('div.stack-list');
  const el = h('section.stack', { 'aria-label': 'The building, floor by floor', tabindex: '-1', hidden: true },
    h('div.stack-roof', { 'aria-hidden': 'true' }, h('span', {}, 'The Office')), list,
    h('div.stack-ground', { 'aria-hidden': 'true' }, h('span', {}, 'Ground · the lobby')));
  let data = null, staff = {}, shown = false, staffAt = 0, restored = false;
  // The spot being returned to, until the person scrolls for themselves: the staff faces arrive later and make the strips taller.
  let wanted = 0;
  for (const t of ['wheel', 'touchstart', 'pointerdown', 'keydown']) el.addEventListener(t, () => { wanted = 0; }, { passive: true });

  // Only what's on screen moves: the busy dots and faces pulse on strips in view, and nowhere else.
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => { for (const e of es) e.target.classList.toggle('live', e.isIntersecting); }, { root: el }) : null;

  const render = () => {
    if (!data) return;
    io?.disconnect();
    clear(list);
    const byNum = new Map(data.floors.map((f) => [f.number, f]));
    const toLet = new Set(data.toLet || []);
    for (let n = data.towerFloors; n >= 1; n--) {
      const card = byNum.get(n);
      if (card) list.append(strip(card, staff[n] || [], enter));
      else if (toLet.has(n)) list.append(h('div.stack-strip.to-let', { 'data-floor': n }, h('span.stack-num', {}, String(n)), h('span.stack-text', {}, h('b', {}, 'To let'))));
      // anything else is a hidden floor, or one a code is holding: it doesn't appear
    }
    if (io) for (const s of list.children) io.observe(s);
    if (!restored && shown) restore();
  };
  const restore = () => {
    restored = true;
    let y = 0; try { y = Number(sessionStorage.getItem(SPOT_KEY)) || 0; } catch { /* private mode */ }
    wanted = y;
    if (y) el.scrollTop = y;
    else { const first = list.querySelector('.stack-strip:not(.to-let)'); if (first) el.scrollTop = Math.max(0, first.offsetTop - 24); }
  };
  const loadStaff = async () => {
    if (Date.now() - staffAt < 15000) return;
    staffAt = Date.now();
    const d = await api('/building/staff').catch(() => null);
    if (d?.floors) { staff = d.floors; render(); if (wanted && el.scrollTop < wanted) el.scrollTop = wanted; }
  };
  const enter = (card) => {
    if (dragged) return;
    try { sessionStorage.setItem(SPOT_KEY, String(Math.round(el.scrollTop))); } catch { /* private mode */ }
    onEnter(card);
  };

  // Slide it: the wheel and a finger scroll it natively, a mouse can drag it, and the arrow keys step a floor at a time.
  let drag = null, dragged = false;
  el.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse' || e.button !== 0) return; drag = { y: e.clientY, top: el.scrollTop }; dragged = false; });
  const onMove = (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.y;
    if (Math.abs(dy) > 6) dragged = true;
    if (dragged) el.scrollTop = drag.top - dy;
  };
  const onUp = () => { drag = null; setTimeout(() => { dragged = false; }, 0); };
  window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  const onKey = (e) => {
    if (!shown || e.altKey || e.ctrlKey || e.metaKey) return;
    const t = document.activeElement;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const step = { ArrowDown: 1, ArrowUp: -1, PageDown: 'page', PageUp: '-page' }[e.key];
    if (!step) return;
    e.preventDefault();
    const strip1 = list.querySelector('.stack-strip:not(.to-let)')?.offsetHeight || 90;
    const by = step === 'page' ? el.clientHeight * 0.85 : step === '-page' ? -el.clientHeight * 0.85 : step * strip1;
    el.scrollBy({ top: by, behavior: 'smooth' });
  };
  window.addEventListener('keydown', onKey);

  return {
    el,
    update(d) { data = d; render(); if (shown) loadStaff(); },
    show() { shown = true; el.hidden = false; loadStaff(); if (!restored) restore(); },
    hide() { shown = false; el.hidden = true; },
    destroy() { window.removeEventListener('keydown', onKey); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); io?.disconnect(); },
  };
}
