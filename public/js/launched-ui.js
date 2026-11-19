// Launched (docs/redesign/OFFICE-ANSWERS-1.md, section 4 "Launched and floor portfolio"): one shareable page of real results. Title, a filter by
// lane, launch cards with their real screenshots, and work in progress below. Visits and plays only: never sign-ups, sales or money, and never
// a demo floor. Plain DOM: no 3D code on this page.
import { h, api, clear, BASE } from './dom.js';
import { icon } from './icons.js';
import { launchCard } from './launch-card.js';
import { stateBadge } from './badge.js';

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
  let items = [], snap = null;
  const onFloor = (fl) => window.officeGo(`/floor/${fl.slug}`);
  // A floor's own page (job 24) leads with the floor: who runs it, its lane, its state, and a way in.
  const header = h('section.floor-header.card-ui', { hidden: !floor });
  const empty = () => {
    const now = snap?.status?.now;
    return now && now.steps ? `Nothing launched yet. The team is on step ${now.step} of ${now.steps}.` : 'Nothing launched yet.';
  };
  const render = () => {
    clear(chips);
    for (const [id, label] of LANES) chips.append(h('button.chip', { type: 'button', 'aria-checked': String(lane === id), role: 'radio', 'data-lane': id, onclick: () => { lane = id; render(); } }, label));
    const shown = items.filter((p) => lane === 'all' || p.lane === lane);
    const done = shown.filter((p) => !p.wip), wip = shown.filter((p) => p.wip);
    clear(grid); clear(wipGrid);
    if (!done.length) grid.append(h('p.launched-empty.card-ui', {}, lane === 'all' ? empty() : 'Nothing launched in this lane yet.'));
    for (const p of done) grid.append(launchCard(p, { onFloor }));
    for (const p of wip) wipGrid.append(launchCard(p, { onFloor }));
    wipSection.hidden = !wip.length;
  };
  const drawHeader = () => {
    if (!floor || !snap) return;
    const f = snap.floor;
    header.replaceChildren(
      h('div.fh-top', {}, h('span.fh-num', {}, `Floor ${f.number}`), stateBadge(f), snap.status?.lane ? h('span.stc-lane', {}, snap.status.lane) : null),
      h('h2.fh-name', {}, f.name || 'Moving in'),
      f.tagline ? h('p.fh-tag', {}, f.tagline) : null,
      h('p.fh-boss', {}, 'Run by ', h('b', {}, f.boss?.name || 'the boss')),
      h('button.btn.primary', { type: 'button', 'data-visit-floor': '', onclick: () => window.officeGo(`/floor/${floor}`) }, icon('elevator'), 'Visit floor'));
    header.hidden = false;
  };
  const url = `${location.origin}${BASE}/launched${floor ? `/${floor}` : ''}`;
  const title = h('h1', {}, 'Launched');
  const sub = h('p', {}, floor ? 'What this floor has made, live on the web.' : 'Everything the building has made, live on the web.');
  const share = h('button.btn', { type: 'button', 'data-share': '', onclick: (e) => sharePage(document.title, url, e.currentTarget) }, icon('share-fat'), h('span', {}, 'Share'));
  root.append(h('div.launched-page', {},
    h('header.home-top', {},
      h('div.home-brand', {}, h('button.btn.back', { type: 'button', onclick: () => window.officeGo('/') }, icon('arrow-left'), h('span', {}, 'Home')), h('div', {}, title, sub)),
      h('div.home-acts', {}, share)),
    h('main.launched-main', {}, header, chips, grid, wipSection)));
  render();
  const [list, s] = await Promise.all([
    api(`/building/launched?limit=120${floor ? `&floor=${encodeURIComponent(floor)}` : ''}`).then((d) => d.projects).catch(() => []),
    floor ? api(`/floors/${floor}`).catch(() => null) : null,
  ]);
  items = list; snap = s;
  if (floor && snap) { title.textContent = `Launched by ${snap.floor.name || `floor ${snap.floor.number}`}`; document.title = `${snap.floor.name || 'A floor'}: launched in The Office`; }
  drawHeader();
  render();
}
export function hideLaunched() {}
