// The furniture of the floor page around the room: the company card on the left, the floor scrubber on the right, and the round pins over
// the rooms. All of it reads the same state as the panels, and everything a visitor sees here is already filtered by the server.
import { h, api, clear, toast, BASE } from './dom.js';

const SVG = 'http://www.w3.org/2000/svg';
const ICONS = {
  chat: 'M4 5h16v11H9l-5 4z',
  talk: 'M3 5h12v8H7l-4 3zM18 9h3v8l-3-2.5h-7V13',
  tasks: 'M5 6l2 2 3-3M12 7h8M5 13l2 2 3-3M12 14h8M5 19.5h15',
  projects: 'M4 6h6l2 2h8v11H4z',
  requests: 'M5 4h14v16l-3-2-2 2-2-2-2 2-2-2-3 2zM9 9h6M9 13h6',
  orders: 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 7v5l3.5 2',
  up: 'M6 15l6-6 6 6', down: 'M6 9l6 6 6-6', share: 'M12 15V4M8 8l4-4 4 4M5 13v7h14v-7',
};
export function icon(name) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'ico');
  const p = document.createElementNS(SVG, 'path'); p.setAttribute('d', ICONS[name] || ''); svg.append(p);
  return svg;
}

const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';

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
  el.append(
    h('p.card-boss', {}, 'Run by ', h('b', {}, s.floor.boss.name)),
    h('p.card-crew', {}, h('i.card-dot', { class: busy.length ? 'on' : '' }), `${crew} people · ${line}`),
    latest ? h('p.card-activity', {}, h('b', {}, latest.name), ` ${latest.text}`) : null,
    made.length ? h('div.card-made', {}, h('h3', {}, 'Made here'), ...made.map((p) => h('button.card-project', { type: 'button', 'data-card-project': p.slug, onclick: () => page.openProject(p) }, h('span', {}, p.title), h('small', {}, p.kind)))) : null,
    h('div.card-actions', {},
      site ? h('a.btn.primary', { href: site.appUrl || site.url, target: '_blank', rel: 'noopener noreferrer', 'data-visit': '' }, 'Visit website') : null,
      h('button.btn.ghost', { type: 'button', 'data-share': '', onclick: () => shareFloor(page) }, icon('share'), 'Share')),
  );
  if (page.logoEl) {
    clear(page.logoEl);
    if (s.floor.logoUrl) page.logoEl.append(h('img', { src: s.floor.logoUrl, alt: '' })); else page.logoEl.textContent = initials(s.floor.name);
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

/** The floor scrubber: up and down through the floors that are open, and a tick for each of them. */
export function buildScrubber(page) {
  const here = page.state.floor.number;
  const up = h('button.scrub-btn', { type: 'button', 'aria-label': 'Floor above', 'data-scrub': 'up' }, icon('up'));
  const down = h('button.scrub-btn', { type: 'button', 'aria-label': 'Floor below', 'data-scrub': 'down' }, icon('down'));
  const track = h('div.scrub-track', { role: 'list' });
  const name = h('span.scrub-name', {}, `Floor ${here}`);
  const el = h('nav.floor-scrubber.glass', { 'aria-label': 'Other floors' }, up, track, down, name);
  const load = async () => {
    const d = await api('/floors').catch(() => null);
    if (!d || page.dead) return;
    const list = d.floors.filter((f) => f.status === 'active').sort((a, b) => b.number - a.number);
    const go = (f) => { if (f) window.officeGo(`/floor/${f.slug}`); };
    const above = [...list].reverse().find((f) => f.number > here), below = list.find((f) => f.number < here);
    const wire = (btn, f, word) => { btn.disabled = !f; btn.title = f ? `${word}: floor ${f.number}, ${f.name}` : `No open floor ${word.toLowerCase()}`; btn.onclick = () => go(f); };
    wire(up, above, 'Up'); wire(down, below, 'Down');
    clear(track);
    const top = Math.max(d.towerFloors || 40, here), span = Math.max(1, top - 1);
    for (const f of list) {
      track.append(h(`button.scrub-tick${f.number === here ? '.on' : ''}`, { type: 'button', role: 'listitem', 'aria-label': `Floor ${f.number}, ${f.name}`, title: `Floor ${f.number}, ${f.name}`, css: { top: `${(1 - (f.number - 1) / span) * 100}%` }, onclick: () => { if (f.number !== here) go(f); } }));
    }
    page.floorList = list;
  };
  load();
  return el;
}

/** The round pins over the rooms. Each one is a shortcut to a panel tab and floats where that tab's work happens. */
export function buildPins(page) {
  const defs = [];
  if (page.canSeeChat) defs.push(['chat', page.owner ? 'Manager' : 'Chat']);
  defs.push(['tasks', 'Tasks'], ['talk', 'Talk'], ['projects', 'Projects']);
  if (page.owner) defs.push(['requests', 'Requests'], ['orders', 'Orders']);
  const layer = h('div.floor-pins');
  page.pinEls = {};
  for (const [tab, label] of defs) {
    const badge = h('i.pin-badge', { hidden: true });
    const el = h('button.pin', { type: 'button', 'data-pin': tab, 'aria-label': `Open ${label}`, title: label, onclick: () => page.setTab(tab, { fromPin: true }) }, icon(tab), h('span.pin-label', {}, label), badge);
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
