// The building as a stack of dollhouse cutaways: every floor at once, roof to ground, each one a little room you can see into, with its
// staff at their desks. No WebGL in here, and not much work either: a floor is a shell with its plaque until it comes near the screen,
// then its room is built (dollhouse.js); rooms well off screen are taken down again, only the ones on screen move, and nothing at all
// runs while the tab is hidden. The 3D scene behind sleeps while this is up.
import { h, api, isPhone } from './dom.js';
import { stage } from './stage.js';
import { Room, shade, MEETING_MS } from './dollhouse.js';

const MODE_KEY = 'office:lobby-mode', SPOT_KEY = 'office:stack-y';
const LIFE_EVERY = 10_000, STAFF_EVERY = 45_000;
const THINK_MS = 250;
const HOLD_MS = 450;
const FRESH_LINE_MS = 120_000;  // a room coming into view says its latest line if it's this new

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

const brandOf = (card) => { const brand = card.colors?.primary || '#d9774a'; return [brand, card.colors?.accent || brand]; };
const sigOf = (card) => [card.slug, ...brandOf(card), !!(card.setup || !card.name), card.status].join('|');
const skyNow = () => { const hr = new Date().getHours(); return hr >= 7 && hr < 18 ? 'day' : (hr >= 18 && hr < 20) || (hr >= 5 && hr < 7) ? 'dusk' : 'night'; };

/** A floor's shell: its plaque, and the space its room goes in. The plaque's words change in place; anything else makes a new shell. */
function shell(n, card) {
  if (!card) {
    return { n, card: null, sig: 'to-let', el: h('div.dh-floor.to-let', { 'data-floor': n },
      h('span.dh-plate', {}, h('span.dh-num', {}, String(n)), h('span.dh-name', {}, h('b', {}, 'To let')))) };
  }
  const [brand, accent] = brandOf(card);
  const moving = !!(card.setup || !card.name);
  const name = h('b'), status = h('small');
  const el = h(`button.dh-floor${moving ? '.moving' : ''}${card.status === 'suspended' ? '.shut' : ''}`, {
    type: 'button', 'data-floor': card.number,
    css: { '--brand': brand, '--accent': accent, '--wall': shade(brand, 0.8), '--wall-lo': shade(brand, 0.55), '--skirt': shade(brand, -0.4), '--door': shade(brand, -0.3), '--door-d': shade(brand, -0.55), '--table': shade(accent, -0.4), '--table-top': shade(accent, -0.15) },
  }, h('span.dh-plate', {}, h('span.dh-num', {}, String(card.number)), h('span.dh-name', {}, name, status), h('span.dh-go', { 'aria-hidden': 'true' }, 'Go in ›')));
  const sh = { n, card, el, name, status, moving, sig: sigOf(card) };
  words(sh, card);
  return sh;
}
function words(sh, card) {
  sh.card = card;
  const moving = sh.moving;
  const busy = !moving && card.status === 'active' && card.busy > 0;
  sh.name.textContent = card.name || 'New company moving in';
  sh.status.replaceChildren(...(busy ? [h('i.dh-dot', { 'aria-hidden': 'true' })] : []), statusLine(card));
  sh.el.classList.toggle('closed', !!card.workMode?.closed);
  sh.el.setAttribute('aria-label', `Floor ${card.number}, ${card.name || 'new company moving in'}. ${statusLine(card)}`);
}

/** The stack, ready to be shown or hidden. update() takes a fresh /floors answer; the staff and what they're up to come from their own small lists. */
export function buildStack({ onEnter }) {
  const list = h('div.tower-list');
  const scroller = h('section.tower', { 'aria-label': 'The building, floor by floor', tabindex: '-1', 'data-sky': skyNow() },
    h('div.tower-roof', { 'aria-hidden': 'true' }, h('span', {}, 'The Office')), list,
    h('div.tower-ground', { 'aria-hidden': 'true' }, h('span', {}, 'Ground · the lobby')));
  const tip = h('div.dh-tip', { hidden: true, role: 'tooltip' });
  const el = h('div.tower-wrap', { hidden: true }, scroller, tip);
  const shells = new Map(), live = new Set(), budget = { up: 0, max: 3 };
  const life = { floors: {}, ts: 0 }, heard = new Map();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let data = null, staff = {}, staffSig = {}, staffReady = false, shown = false, restored = false, dead = false;
  let width = 0, k = 1, max = 6;

  // ---- rooms near the screen are built, far ones taken down, and only the ones on it think ----
  const measure = () => { const phone = isPhone(); k = phone ? 1 : 1.15; max = phone ? 6 : 8; width = Math.max(0, list.clientWidth - 2 * (phone ? 8 : 12)); };
  const nearby = new Set();
  // A room waits for the staff list, so it's built once with its people in it rather than empty and then again.
  const build = (sh) => {
    if (sh.room || !width || (sh.card && !staffReady)) return;
    if (!sh.card) {
      sh.room = { el: h('span.dh-room.dark', { 'aria-hidden': 'true' }, h('span.dh-wall'), h('span.dh-floorband'), h('span.dh-window.off', {}, h('i')), h('span.dh-sign', {}, 'To let')), think() {}, destroy() { this.el.remove(); } };
      sh.el.prepend(sh.room.el);
      return;
    }
    const st = sh.card.status === 'active' ? staff[sh.n] || [] : [];
    sh.room = new Room({ card: sh.card, staff: st, width, k, max, budget, moving: sh.moving, reduced });
    sh.staffSig = staffSig[sh.n] || '';
    sh.el.prepend(sh.room.el);
    feed(sh, performance.now(), true);
    if (sh.el.classList.contains('live')) { live.add(sh.room); run(); }
  };
  const unbuild = (sh) => { if (!sh.room) return; live.delete(sh.room); sh.room.destroy(); sh.room = null; };
  const near = new IntersectionObserver((es) => {
    for (const e of es) { const sh = e.target.__shell; if (e.isIntersecting) { nearby.add(sh); build(sh); } else nearby.delete(sh); }
  }, { root: scroller, rootMargin: '100% 0px' });
  const far = new IntersectionObserver((es) => { for (const e of es) if (!e.isIntersecting) unbuild(e.target.__shell); }, { root: scroller, rootMargin: '250% 0px' });
  const seen = new IntersectionObserver((es) => {
    for (const e of es) {
      const sh = e.target.__shell;
      sh.el.classList.toggle('live', e.isIntersecting);
      if (!sh.room?.people) continue;
      if (e.isIntersecting) live.add(sh.room); else { live.delete(sh.room); sh.room.quiet(); }
    }
    run();
  }, { root: scroller });
  const watch = (sh) => { sh.el.__shell = sh; near.observe(sh.el); far.observe(sh.el); seen.observe(sh.el); };
  const forget = (sh) => { nearby.delete(sh); near.unobserve(sh.el); far.unobserve(sh.el); seen.unobserve(sh.el); unbuild(sh); sh.el.remove(); };

  let timer = 0;
  const tick = () => { const now = performance.now(); for (const r of live) r.think(now); };
  const run = () => {
    const want = shown && !dead && !document.hidden && live.size > 0;
    if (want && !timer) timer = setInterval(tick, THINK_MS);
    else if (!want && timer) { clearInterval(timer); timer = 0; }
  };

  const render = () => {
    if (!data) return;
    const byNum = new Map(data.floors.map((f) => [f.number, f]));
    const toLet = new Set(data.toLet || []);
    const want = [];
    for (let n = data.towerFloors; n >= 1; n--) {
      if (byNum.has(n)) want.push([n, byNum.get(n)]);
      else if (toLet.has(n)) want.push([n, null]);
      // anything else is a hidden floor, or one a code is holding: it doesn't appear
    }
    const keep = new Set(want.map(([n]) => n));
    for (const [n, sh] of shells) if (!keep.has(n)) { forget(sh); shells.delete(n); }
    if (!width) measure();
    let prev = null;
    for (const [n, card] of want) {
      let sh = shells.get(n);
      const sig = card ? sigOf(card) : 'to-let';
      if (sh && sh.sig !== sig) { forget(sh); sh = null; }
      if (!sh) { sh = shell(n, card); shells.set(n, sh); watch(sh); } else if (card) words(sh, card);
      // in order, roof to ground, moving only what's out of place so the rooms already up keep going
      if ((prev ? prev.nextElementSibling : list.firstElementChild) !== sh.el) { if (prev) prev.after(sh.el); else list.prepend(sh.el); }
      prev = sh.el;
    }
    if (!restored && shown) restore();
  };

  const restore = () => {
    restored = true;
    let y = 0; try { y = Number(sessionStorage.getItem(SPOT_KEY)) || 0; } catch { /* private mode */ }
    if (y) scroller.scrollTop = y;
    else { const first = list.querySelector('.dh-floor:not(.to-let)'); if (first) scroller.scrollTop = Math.max(0, first.offsetTop - 24); }
  };

  // ---- the people: who works where (now and then), and what they're up to (every few seconds) ----
  const ready = () => { if (staffReady || dead) return; staffReady = true; for (const sh of nearby) build(sh); run(); };
  const loadStaff = async () => {
    const d = await api('/building/staff').catch(() => null);
    if (dead) return;
    if (!d?.floors) { ready(); return; }  // rooms without their people, rather than no rooms; the next try fills them
    staff = d.floors; staffSig = {};
    for (const [n, crew] of Object.entries(staff)) staffSig[n] = crew.map((p) => `${p.id}:${p.name}:${p.title}:${JSON.stringify(p.look)}`).join('|');
    // A hire, a leaver or a new look: that room is drawn again. Everyone else carries on.
    for (const sh of shells.values()) if (sh.room?.people && sh.staffSig !== (staffSig[sh.n] || '')) { unbuild(sh); build(sh); }
    ready(); run();
  };
  const loadLife = async () => {
    const d = await api('/building/life').catch(() => null);
    if (!d?.floors || dead) return;
    life.floors = d.floors; life.ts = d.ts;
    const now = performance.now();
    for (const sh of shells.values()) if (sh.room?.people) feed(sh, now, false);
  };
  /** Hands a room what its floor is up to. A room just built only gets its latest line, and only if it's fresh. */
  const feed = (sh, now, fresh) => {
    const f = life.floors[sh.n] || { busy: [], talk: [], meeting: null };
    const room = sh.room;
    if (!room.people.length) return;
    room.setBusy(new Set(f.busy), now);
    const left = f.meeting ? MEETING_MS - (life.ts - f.meeting.at) : 0;
    room.setMeeting(left > 0 ? { at: f.meeting.at, ids: f.meeting.ids, left } : null, now);
    const last = heard.get(sh.n) || 0;
    let lines = f.talk.filter((l) => l.id > last);
    if (fresh) lines = lines.filter((l) => life.ts - l.ts < FRESH_LINE_MS).slice(-1);
    if (f.talk.length) heard.set(sh.n, Math.max(last, f.talk[f.talk.length - 1].id));
    if (lines.length) room.hear(lines, now);
  };
  let lifeTimer = 0, staffTimer = 0;
  const polls = (on) => {
    clearInterval(lifeTimer); clearInterval(staffTimer); lifeTimer = staffTimer = 0;
    if (!on) return;
    loadStaff(); loadLife();
    lifeTimer = setInterval(loadLife, LIFE_EVERY);
    staffTimer = setInterval(loadStaff, STAFF_EVERY);
  };
  const onVisible = () => { polls(shown && !document.hidden); run(); };
  document.addEventListener('visibilitychange', onVisible);

  // A phone turned on its side, or a window made narrower: the rooms on screen are drawn again to fit.
  const ro = 'ResizeObserver' in window ? new ResizeObserver(() => {
    const was = width; measure();
    if (Math.abs(was - width) < 2) return;
    for (const sh of shells.values()) if (sh.room) { unbuild(sh); build(sh); }
    run();
  }) : null;
  ro?.observe(scroller);

  // ---- going in ----
  const enter = (card) => {
    try { sessionStorage.setItem(SPOT_KEY, String(Math.round(scroller.scrollTop))); } catch { /* private mode */ }
    onEnter(card);
  };
  list.addEventListener('click', (e) => {
    const f = e.target.closest('button.dh-floor');
    if (!f || dragged || held) return;
    const card = shells.get(Number(f.dataset.floor))?.card;
    if (card) enter(card);
  });

  // ---- who's that: hover with a mouse, or touch and hold ----
  const personAt = (x, y) => {
    const f = document.elementFromPoint(x, y)?.closest?.('.dh-floor');
    const room = f && shells.get(Number(f.dataset.floor))?.room;
    return room?.personAt ? room.personAt(x, y) : null;
  };
  let tipFor = null, tipTimer = 0;
  const showTip = (p, linger) => {
    clearTimeout(tipTimer);
    if (!p) { hideTip(); return; }
    if (tipFor !== p) {
      tipFor = p;
      tip.replaceChildren(h('b', {}, p.name), p.title || p.role ? h('small', {}, p.title || p.role) : null);
    }
    const r = p.el.firstChild.getBoundingClientRect(), w = el.getBoundingClientRect();
    tip.style.left = `${Math.round(Math.min(w.width - 70, Math.max(70, r.left + r.width / 2 - w.left)))}px`;
    tip.style.top = `${Math.round(Math.max(44, r.top - w.top))}px`;
    tip.hidden = false;
    if (linger) tipTimer = setTimeout(hideTip, 2200);
  };
  const hideTip = () => { clearTimeout(tipTimer); tipFor = null; tip.hidden = true; };
  let hover = null, hoverFrame = 0;
  const hoverNow = () => { hoverFrame = 0; if (hover && !drag?.moved && !fling) showTip(personAt(hover.x, hover.y)); };
  scroller.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') { if (hold && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 10) noHold(); return; }
    hover = { x: e.clientX, y: e.clientY };
    if (!hoverFrame) hoverFrame = requestAnimationFrame(hoverNow);
  });
  scroller.addEventListener('pointerleave', () => { hover = null; if (!held) hideTip(); });
  let hold = null, holdTimer = 0, held = false;
  const noHold = () => { clearTimeout(holdTimer); hold = null; };
  scroller.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    noHold(); hideTip();
    hold = { x: e.clientX, y: e.clientY };
    holdTimer = setTimeout(() => {
      const p = hold && personAt(hold.x, hold.y);
      if (p) { held = true; showTip(p, true); }
    }, HOLD_MS);
  });
  const holdEnd = () => { noHold(); if (held) setTimeout(() => { held = false; }, 450); };
  scroller.addEventListener('pointerup', holdEnd);
  scroller.addEventListener('pointercancel', holdEnd);
  scroller.addEventListener('contextmenu', (e) => { if (held || hold) e.preventDefault(); });

  // ---- sliding it: a finger and the wheel scroll it natively; a mouse can drag it, and a drag let go of keeps going for a bit ----
  let drag = null, dragged = false, fling = 0;
  const stopFling = () => { if (fling) cancelAnimationFrame(fling); fling = 0; };
  const flingFrom = (v) => {
    let last = performance.now();
    const step = (t) => {
      const dt = Math.min(48, t - last); last = t;
      const before = scroller.scrollTop;
      scroller.scrollTop = before + v * dt;
      v *= Math.pow(0.94, dt / 16.7);
      fling = Math.abs(v) > 0.03 && scroller.scrollTop !== before ? requestAnimationFrame(step) : 0;
    };
    fling = requestAnimationFrame(step);
  };
  scroller.addEventListener('pointerdown', (e) => {
    stopFling();
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    drag = { y: e.clientY, top: scroller.scrollTop, moved: false, trail: [[e.timeStamp, e.clientY]] };
    dragged = false;
  });
  const onMove = (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dy) > 6) { drag.moved = dragged = true; scroller.classList.add('dragging'); hideTip(); }
    if (!drag.moved) return;
    scroller.scrollTop = drag.top - dy;
    drag.trail.push([e.timeStamp, e.clientY]);
    while (drag.trail.length > 2 && e.timeStamp - drag.trail[0][0] > 100) drag.trail.shift();
  };
  const onUp = (e) => {
    if (!drag) return;
    const d = drag; drag = null;
    scroller.classList.remove('dragging');
    if (d.moved) {
      // How fast it was going over the last tenth of a second, unless the hand had already stopped before letting go.
      const [t0, y0] = d.trail[0], [t1, y1] = d.trail[d.trail.length - 1];
      const v = t1 > t0 && e.timeStamp - t1 < 120 ? -(y1 - y0) / (t1 - t0) : 0;
      if (Math.abs(v) > 0.25) flingFrom(Math.max(-6, Math.min(6, v)));
    }
    setTimeout(() => { dragged = false; }, 0);
  };
  window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  scroller.addEventListener('wheel', stopFling, { passive: true });
  scroller.addEventListener('scroll', () => { if (!held) hideTip(); }, { passive: true });
  const onKey = (e) => {
    if (!shown || e.altKey || e.ctrlKey || e.metaKey) return;
    const t = document.activeElement;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const step = { ArrowDown: 1, ArrowUp: -1, PageDown: 'page', PageUp: '-page' }[e.key];
    if (!step) return;
    e.preventDefault(); stopFling();
    const one = list.querySelector('.dh-floor:not(.to-let)')?.offsetHeight || 160;
    const by = step === 'page' ? scroller.clientHeight * 0.85 : step === '-page' ? -scroller.clientHeight * 0.85 : step * one;
    scroller.scrollBy({ top: by, behavior: reduced ? 'auto' : 'smooth' });
  };
  window.addEventListener('keydown', onKey);

  return {
    el,
    update(d) { data = d; render(); },
    show() { shown = true; el.hidden = false; scroller.dataset.sky = skyNow(); measure(); render(); if (!restored) restore(); polls(!document.hidden); run(); },
    hide() { shown = false; el.hidden = true; hideTip(); stopFling(); polls(false); run(); },
    destroy() {
      dead = true; shown = false; polls(false); run(); stopFling(); clearTimeout(tipTimer); noHold();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('keydown', onKey); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp);
      near.disconnect(); far.disconnect(); seen.disconnect(); ro?.disconnect();
      for (const sh of shells.values()) unbuild(sh);
    },
  };
}
