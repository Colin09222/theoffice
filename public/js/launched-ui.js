// Launched (docs/redesign/OFFICE-ANSWERS-1.md, section 4 "Launched and floor portfolio"): one shareable page of real results. Title, a filter by
// lane, launch cards with their real screenshots, and work in progress below. Visits and plays only: never sign-ups, sales or money, and never
// a demo floor. Plain DOM: no 3D code on this page.
import { h, api, clear, BASE } from './dom.js';
import { icon } from './icons.js';
import { launchCard } from './launch-card.js';

const LANES = [['all', 'All'], ['game', 'Games'], ['website', 'Websites'], ['business', 'Business']];

/** Share a page: the phone's own share sheet where there is one, else the link copied. */
export async function sharePage(title, url, button) {
  try {
    if (navigator.share) { await navigator.share({ title, url }); return; }
    await navigator.clipboard.writeText(url);
    if (button) { const was = button.lastChild.textContent; button.lastChild.textContent = 'Link copied'; setTimeout(() => { button.lastChild.textContent = was; }, 1800); }
  } catch { /* closed, or no clipboard: nothing to say */ }
}

export async function showLaunched(root, { floor = null } = {}) {
  document.body.dataset.page = 'launched';
  let lane = 'all';
  const grid = h('div.launched-grid');
  const wipGrid = h('div.launched-grid');
  const wipSection = h('section.launched-wip', { hidden: true }, h('h2', {}, 'Work in progress'), wipGrid);
  const chips = h('div.lane-filter', { role: 'group', 'aria-label': 'Filter by lane' });
  let items = [];
  const onFloor = (fl) => window.officeGo(`/floor/${fl.slug}`);
  const render = () => {
    clear(chips);
    for (const [id, label] of LANES) chips.append(h('button.chip', { type: 'button', 'aria-checked': String(lane === id), role: 'radio', 'data-lane': id, onclick: () => { lane = id; render(); } }, label));
    const shown = items.filter((p) => lane === 'all' || p.lane === lane);
    const done = shown.filter((p) => !p.wip), wip = shown.filter((p) => p.wip);
    clear(grid); clear(wipGrid);
    if (!done.length) grid.append(h('p.launched-empty.card-ui', {}, lane === 'all' ? 'Nothing launched yet.' : 'Nothing launched in this lane yet.'));
    for (const p of done) grid.append(launchCard(p, { onFloor }));
    for (const p of wip) wipGrid.append(launchCard(p, { onFloor }));
    wipSection.hidden = !wip.length;
  };
  const url = `${location.origin}${BASE}/launched`;
  const share = h('button.btn', { type: 'button', 'data-share': '', onclick: (e) => sharePage('Launched in The Office', url, e.currentTarget) }, icon('share-fat'), h('span', {}, 'Share'));
  root.append(h('div.launched-page', {},
    h('header.home-top', {},
      h('div.home-brand', {}, h('button.btn.back', { type: 'button', onclick: () => window.officeGo('/') }, icon('arrow-left'), h('span', {}, 'Home')), h('div', {}, h('h1', {}, 'Launched'), h('p', {}, 'Everything the building has made, live on the web.'))),
      h('div.home-acts', {}, share)),
    h('main.launched-main', {}, chips, grid, wipSection)));
  render();
  try { items = (await api('/building/launched?limit=120')).projects; } catch { items = []; }
  render();
}
export function hideLaunched() {}
