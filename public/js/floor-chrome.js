// The furniture of the floor page around the room: the door plaque on the left, the lift panel on the right, and the map pins over
// the rooms. All of it reads the same state as the panels, and everything a visitor sees here is already filtered by the server.
import { h, api, clear, put, toast, BASE } from './dom.js';

import { icon } from './icons.js';
import { portrait } from './portrait.js';

const TAB_ICONS = { chat: 'phone-call', talk: 'chats-teardrop', work: 'notebook', tasks: 'push-pin', projects: 'archive', requests: 'receipt', orders: 'calendar-check', about: 'identification-badge', business: 'briefcase' };
export const tabIcon = (tab) => icon(TAB_ICONS[tab] || 'file-text');

export { portrait };

/** What's on the company card below the name, redrawn as the floor changes: who is here, what they are at, what they've made. */
export function renderCard(page) {
  const { state: s } = page;
  const el = page.cardEl; if (!el) return;
  const crew = s.agents.length + 1;  // the boss counts
  const busy = s.agents.filter((a) => a.state !== 'idle');
  const latest = s.feed.at(-1);
  const line = busy.length ? `${busy.length} at work now` : 'Quiet right now';
  const made = s.projects.filter((p) => !p.private).slice(0, 3);
  const site = s.projects.find((p) => !p.private && ['site', 'app', 'game', 'simulation'].includes(p.kind));
  clear(el);
  put(el,
    h('p.card-boss', {}, 'Run by ', h('b', {}, s.floor.boss.name)),
    h('p.card-crew', {}, h('i.card-dot', { class: busy.length ? 'on' : '' }), `${crew} people · ${line}`),
    latest ? h('p.card-activity', {}, h('b', {}, latest.name), ` ${latest.text}`) : null,
    made.length ? h('div.card-made', {}, h('h3', {}, 'Made here'), ...made.map((p) => h('button.card-project', { type: 'button', 'data-card-project': p.slug, onclick: () => page.openProject(p) }, h('span', {}, p.title), h('small', {}, p.kind)))) : null,
    h('div.card-actions', {},
      site ? h('a.btn.primary', { href: site.appUrl || site.url, target: '_blank', rel: 'noopener noreferrer', 'data-visit': '' }, 'Visit website') : null,
      h('button.btn.ghost', { type: 'button', 'data-share': '', onclick: () => shareFloor(page) }, icon('share-fat'), 'Share')),
  );
  if (page.logoEl) {
    clear(page.logoEl);
    page.logoEl.classList.toggle('has-logo', !!s.floor.logoUrl);
    if (s.floor.logoUrl) page.logoEl.append(h('img', { src: s.floor.logoUrl, alt: '' }));
  }
}

async function shareFloor(page) {
  const url = `${location.origin}${BASE}/floor/${page.slug}`;
  try {
    if (navigator.share) { await navigator.share({ title: page.state.floor.name, url }); return; }
    await navigator.clipboard.writeText(url);
    toast('Link copied');
  } catch (e) { if (e?.name !== 'AbortError') toast(url); }
}

/** The lift panel: a lit display, up and down, and one lit button for every floor that's open. */
export function buildScrubber(page) {
  const here = page.state.floor.number;
  const upTo = h('b.scrub-to'), downTo = h('b.scrub-to');
  const up = h('button.scrub-btn', { type: 'button', 'aria-label': 'Floor above', 'data-scrub': 'up', disabled: true }, icon('caret-up'), upTo);
  const down = h('button.scrub-btn', { type: 'button', 'aria-label': 'Floor below', 'data-scrub': 'down', disabled: true }, icon('caret-down'), downTo);
  const track = h('div.scrub-track', { role: 'list' });
  const name = h('span.scrub-name', {}, `Floor ${here} · ${page.state.floor.name || 'Moving in'}`);
  const el = h('nav.floor-scrubber', { 'aria-label': 'The lift: other floors' }, h('span.lift-display', { 'aria-hidden': 'true' }, String(here)), up, track, down, name);
  const load = async () => {
    const d = await api('/floors').catch(() => null);
    if (!d || page.dead) return;
    const list = d.floors.filter((f) => f.status === 'active').sort((a, b) => b.number - a.number);
    const go = (f) => { if (f) window.officeGo(`/floor/${f.slug}`); };
    const above = [...list].reverse().find((f) => f.number > here), below = list.find((f) => f.number < here);
    const wire = (btn, to, f, word) => { btn.disabled = !f; to.textContent = f ? String(f.number) : ''; btn.title = f ? `${word}: floor ${f.number}, ${f.name || 'moving in'}` : `No open floor ${word.toLowerCase()}`; btn.setAttribute('aria-label', f ? `${word} to floor ${f.number}` : `No open floor ${word.toLowerCase()}`); btn.onclick = () => go(f); };
    wire(up, upTo, above, 'Up'); wire(down, downTo, below, 'Down');
    page.liftGo = (dir) => go(dir > 0 ? above : below);
    clear(track);
    let lit = null;
    for (const f of list) {
      const b = h(`button.scrub-tick${f.number === here ? '.on' : ''}`, { type: 'button', role: 'listitem', 'aria-label': `Floor ${f.number}, ${f.name || 'moving in'}`, title: `Floor ${f.number}, ${f.name || 'moving in'}`, onclick: () => { if (f.number !== here) go(f); } }, String(f.number));
      if (f.number === here) lit = b;
      track.append(b);
    }
    if (lit) track.scrollTop = Math.max(0, lit.offsetTop - track.offsetTop - track.clientHeight / 2);
    page.floorList = list;
  };
  load();
  wireLiftKeys(page, el);
  return el;
}

/** The lift without aiming for it: PageUp and PageDown on a keyboard, and a quick upward or downward flick on a phone, over the room or
 *  the lift panel. A slow drag still moves the room; only a fast, mostly vertical flick changes floor. */
function wireLiftKeys(page, panel) {
  const typing = (t) => t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  const onKey = (e) => {
    if (page.dead || e.altKey || e.ctrlKey || e.metaKey || typing(document.activeElement)) return;
    if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); page.liftGo?.(e.key === 'PageUp' ? 1 : -1); }
  };
  let start = null;
  const onDown = (e) => {
    const t = e.target;
    const free = t.id === 'scene' || panel.contains(t) || !t.closest('button, a, input, textarea, select, .floor-panel, .floor-top, .controls, .modal-back');
    start = e.pointerType === 'touch' && e.isPrimary && free ? { x: e.clientX, y: e.clientY, at: performance.now() } : null;
  };
  const onUp = (e) => {
    if (!start || page.dead || !e.isPrimary) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y, ms = performance.now() - start.at; start = null;
    if (ms < 700 && Math.abs(dy) > 70 && Math.abs(dy) > Math.abs(dx) * 2.2) page.liftGo?.(dy < 0 ? 1 : -1);
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('pointerdown', onDown, true); window.addEventListener('pointerup', onUp, true);
  page.unwireLift = () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('pointerup', onUp, true); };
}

/** The map pins over the rooms. Each one is a shortcut to a panel tab and floats where that tab's work happens. */
export function buildPins(page) {
  const defs = [];
  if (page.canSeeChat) defs.push(['chat', page.owner ? 'Manager' : 'Chat']);
  defs.push(['tasks', 'Tasks'], ['talk', 'Talk'], ['projects', 'Projects']);
  if (page.owner) defs.push(['requests', 'Requests'], ['orders', 'Orders']);
  const layer = h('div.floor-pins');
  page.pinEls = {};
  for (const [tab, label] of defs) {
    const badge = h('i.pin-badge', { hidden: true });
    const el = h('button.pin', { type: 'button', 'data-pin': tab, 'aria-label': `Open ${label}`, title: label, onclick: () => page.setTab(tab, { fromPin: true }) }, tabIcon(tab), h('span.pin-label', {}, label), badge);
    el.badge = badge;
    page.pinEls[tab] = el;
    layer.append(el);
  }
  return layer;
}
export function wirePins(page) {
  const v = page.view; if (!v) return;
  const at = v.pinAnchors();
  v.setPins(Object.entries(page.pinEls || {}).map(([tab, el]) => ({ el, at: at[tab] })));
}
