// The lobby overlay: the sign out front, the felt directory board with its lift panel, the To Let board, and the news strip.
import { stage } from './stage.js';
import { h, api, session, isPhone, toast, clear, put } from './dom.js';
import { LobbyView } from './lobby-scene.js';
import { icon } from './icons.js';
import { muteButton, sfx } from './sfx.js';

// The claim wizard and its character builder are only fetched when someone opens them.
const claimModule = () => import('./claim.js');
const openClaim = () => claimModule().then((m) => m.openClaim());
const openLogin = () => claimModule().then((m) => m.openLogin());

let view = null, poll = null, keepFloors = [], tip = null, tickerPoll = null;

// ---- the building, live: a ticker of public happenings across every floor ----
function tickerItem(it, fresh) {
  return h(`${it.url ? 'a' : 'button'}.ticker-item${fresh ? '.fresh' : ''}${it.kind === 'published' ? '.published' : ''}${it.filler ? '.chatter' : ''}`,
    it.url ? { href: it.url, target: '_blank', rel: 'noopener noreferrer', 'data-id': it.id, title: `Open ${it.text}` }
      : { type: 'button', 'data-id': it.id, title: `Walk into ${it.floor.name}`, onclick: () => window.officeGo(`/floor/${it.floor.slug}`) },
    h('span.ticker-chip', {}, h('b', {}, String(it.floor.number)), it.floor.name || 'New company'),
    h('span.ticker-text', {}, it.text));
}
function buildTicker() {
  const rail = h('div.ticker-rail');
  const strip = h('section.ticker', { 'aria-label': 'The building, live', 'data-ticker': 'empty' },
    h('span.ticker-label', {}, 'Live'),
    h('div.ticker-track', {}, rail));
  let items = []; let latest = 0;
  const paint = (freshIds) => {
    clear(rail);
    strip.dataset.ticker = items.length ? 'live' : 'empty';
    if (!items.length) { rail.append(h('span.ticker-quiet', {}, 'All quiet. Open an office and give the building something to talk about.')); return; }
    const shown = items.slice(0, 20);
    for (const it of shown) rail.append(tickerItem(it, freshIds.has(it.id)));
    // A second copy makes the loop seamless; it carries no meaning of its own.
    for (const it of shown) { const g = tickerItem(it, false); g.className = g.className.replace('ticker-item', 'ticker-ghost'); g.setAttribute('aria-hidden', 'true'); g.tabIndex = -1; rail.append(g); }
    rail.style.setProperty('--dur', `${Math.max(18, shown.length * 5)}s`);
  };
  const refresh = async (first) => {
    const data = await api(`/building/ticker?limit=20${latest && !first ? `&since=${latest}` : ''}`);
    if (!data.items.length) { if (first) paint(new Set()); return; }
    const freshIds = new Set(first ? [] : data.items.map((i) => i.id));
    items = first ? data.items : [...data.items, ...items].slice(0, 20);
    latest = Math.max(latest, ...items.map((i) => i.id));
    paint(freshIds);
  };
  refresh(true).catch(() => paint(new Set()));
  tickerPoll = setInterval(() => refresh(false).catch(() => { /* retried next time */ }), 10000);
  return strip;
}

// ---- the launched wall: every public project in the building ----
function wallCard(pr, onFloor) {
  const floor = keepFloors.find((f) => f.slug === pr.floor.slug) || pr.floor;
  return h('article.wall-card', { 'data-project': pr.slug, 'data-floor': pr.floor.slug, css: { '--brand': pr.floor.colors.primary } },
    h('a.wall-thumb', { href: pr.url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `Open ${pr.title}` }, h('img', { src: pr.thumb, alt: '', loading: 'lazy', width: '480', height: '300' })),
    h('div.wall-body', {},
      h('div.wall-meta', {}, h('span.wall-floor', {}, h('b', {}, String(pr.floor.number)), pr.floor.name || 'New company'), h('span.wall-kind', {}, pr.kind)),
      h('h4', {}, pr.title),
      pr.description ? h('p', {}, pr.description) : null,
      h('div.wall-acts', {},
        h('a.btn.small.primary', { href: pr.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open'),
        h('button.btn.small', { type: 'button', onclick: () => onFloor(floor) }, 'Visit floor'))));
}

function directoryRow(card, onEnter, onHover) {
  return h('button.dir-row', { type: 'button', 'data-floor': card.number, css: { '--brand': card.colors.primary }, onclick: () => onEnter(card), onpointerenter: () => onHover(card.number) },
    h('span.dir-num', {}, String(card.number)),
    h('span.dir-mark', { 'aria-hidden': 'true' }),
    h('span.dir-text', {}, h('b', {}, card.name || 'Moving in'), card.filler ? h('span.demo-tag', { title: 'A fictional demo company. Nothing here is real.' }, 'demo') : null, h('small', {}, card.status === 'suspended' ? 'Closed by the building manager' : card.tagline || (card.name ? 'A tiny company' : 'Boxes still in the corridor'))),
    card.busy ? h('span.dir-busy', { title: `${card.busy} at work` }, h('i'), String(card.busy)) : null,
    // The floor's hours, as its door sign shows them. On call is the usual, so it goes unsaid here.
    card.workMode && card.workMode.label !== 'On call' ? h(`span.dir-hours${card.workMode.closed ? '.closed' : ''}`, { title: card.workMode.closed ? 'Closed for now' : 'Working on its own' }, card.workMode.label) : null);
}

export async function showLobby(root) {
  document.body.dataset.page = 'lobby';
  const data = await api('/floors').catch(() => ({ floors: [], towerFloors: 40, vacant: 1 }));
  keepFloors = data.floors;

  const enterFloor = async (card) => {
    sfx('press', { rate: 0.75 });
    if (view && stage.ok) {
      view.rideTo(card.number);
      document.body.classList.add('flying');
      await Promise.race([view.flyTo(card.number), new Promise((r) => setTimeout(r, 1400))]);
      document.body.classList.remove('flying');
    }
    window.officeGo(`/floor/${card.slug}`);
  };

  if (stage.ok) {
    view ||= new LobbyView({
      floorCount: data.towerFloors,
      onHover: (n, x, y) => showTip(n, x, y),
      onPick: (n) => {
        if (n < 1) return;
        const card = keepFloors.find((f) => f.number === n);
        if (card) enterFloor(card); else { toast(`Floor ${n} is to let. Got a code?`); }
      },
    });
    view.setFloors(data.floors);
    stage.setView(view);
    window.__lobbyDebug = view;  // read by the browser e2e tests
  }

  const search = h('input', { type: 'search', placeholder: 'Search the building', 'aria-label': 'Search the directory', oninput: () => renderList() });
  const list = h('div.dir-list', { tabindex: '-1' });
  const count = h('span.dir-count');
  const renderList = () => {
    const q = search.value.trim().toLowerCase();
    const shown = keepFloors.filter((f) => !q || `${f.name} ${f.tagline}`.toLowerCase().includes(q));
    count.textContent = `${keepFloors.length} ${keepFloors.length === 1 ? 'company' : 'companies'}`;
    clear(list);
    for (const c of shown) list.append(directoryRow(c, enterFloor, (n) => { view?.setHover(n); view?.rideTo(n); }));
    if (q && !shown.length) list.append(h('p.dir-empty', {}, 'Nobody by that name in the building.'));
    if (!q) {
      if (!keepFloors.length) list.append(h('p.dir-empty', {}, 'The building is brand new, and every floor is empty. Someone has to go first.'));
      list.append(elevatorPanel());
    }
  };
  // The lift buttons: every floor in the building. Lit ones have someone in, and dark ones are for the taking.
  const elevatorPanel = () => {
    const grid = h('div.lift', { role: 'group', 'aria-label': 'Lift buttons' });
    for (let n = data.towerFloors; n >= 1; n--) {
      const card = keepFloors.find((f) => f.number === n);
      grid.append(h(`button.lift-btn${card ? '.lit' : ''}`, { type: 'button', 'data-lift': n, css: card ? { '--brand': card.colors.primary } : {}, 'aria-label': card ? `Floor ${n}, ${card.name || 'moving in'}` : `Floor ${n}, empty`, onpointerenter: () => { view?.setHover(n); view?.rideTo(n); }, onclick: () => { if (card) enterFloor(card); else openClaim(); } }, String(n)));
    }
    const vacant = data.towerFloors - keepFloors.length;
    return h('section.lift-wrap', {}, h('h3', {}, 'The lift', h('small', {}, `${vacant} ${vacant === 1 ? 'floor' : 'floors'} to let`)), grid);
  };
  renderList();

  // The launched wall shares the panel with the directory. The directory's own list is left exactly as it is.
  const wall = h('div.wall', { 'data-wall': 'grid', hidden: true });
  const wallCount = h('span.dir-count');
  const wallHead = h('div.dir-head.wall-head', { hidden: true }, h('span', {}, 'Launched'), wallCount);
  let wallOn = false, wallItems = null;
  const renderWall = () => {
    const q = search.value.trim().toLowerCase();
    clear(wall);
    if (!wallItems) { wall.append(h('p.dir-empty', {}, 'Looking down the corridors…')); return; }
    const shown = wallItems.filter((p) => !q || `${p.title} ${p.description} ${p.floor.name} ${p.kind}`.toLowerCase().includes(q));
    wallCount.textContent = `${wallItems.length} ${wallItems.length === 1 ? 'launch' : 'launches'}`;
    if (!wallItems.length) { wall.append(h('p.dir-empty', {}, 'Nothing has launched yet. The first site, game or doc to go public shows up here.')); return; }
    if (!shown.length) { wall.append(h('p.dir-empty', {}, 'Nothing launched by that name.')); return; }
    wall.append(h('div.wall-grid', {}, shown.map((p) => wallCard(p, enterFloor))));
  };
  const loadWall = async () => {
    try { wallItems = (await api('/building/launched?limit=60')).projects; } catch { wallItems = wallItems || []; }
    if (wallOn) renderWall();
  };
  const toggle = h('button.wall-toggle', { type: 'button', 'data-wall': 'toggle', 'aria-pressed': 'false', title: 'Everything the building has launched' }, icon('rocket-launch'), 'Launched');
  const setWall = (on) => {
    wallOn = on;
    toggle.setAttribute('aria-pressed', String(on));
    panel.classList.toggle('showing-wall', on);
    list.hidden = on; head.hidden = on; wall.hidden = !on; wallHead.hidden = !on;
    search.placeholder = on ? 'Search what launched' : 'Search the building';
    if (on) { if (isPhone()) panel.classList.add('open'); renderWall(); loadWall(); } else renderList();
  };
  toggle.addEventListener('click', () => setWall(!wallOn));
  // On a phone the sheet is mostly tucked away. Tapping search brings it up, so the results and the field aren't left behind the keyboard.
  search.addEventListener('focus', () => { if (isPhone()) panel.classList.add('open'); });
  search.addEventListener('input', () => { if (wallOn) renderWall(); });

  const head = h('div.dir-head', {}, h('span', {}, 'Directory'), count);
  const panel = h('aside.directory', { 'aria-label': 'Floor directory' },
    h('button.sheet-grip', { type: 'button', 'aria-label': 'Show or hide the directory', onclick: () => panel.classList.toggle('open') }, h('i'), h('span.grip-label', {}, 'Directory')),
    h('div.dir-search', {}, search, toggle),
    head, wallHead,
    list, wall,
    h('p.dir-hint', {}, 'Anyone can walk in and watch'));

  const account = session.floor
    ? h('button.btn.chrome', { type: 'button', onclick: () => window.officeGo(`/floor/${session.floor.slug}`) }, icon('elevator'), h('span', {}, 'My floor'))
    : h('button.btn.chrome', { type: 'button', onclick: () => openLogin() }, icon('sign-in'), h('span', {}, 'Sign in'));

  put(root,
    h('header.topbar', {}, h('div.topbar-right', {}, account, muteButton())),
    h('section.hero', {},
      h('h1', {}, 'The Office', h('span', {}, 'Clock in. Someone else does the work.')),
      h('p', {}, 'Each floor belongs to one friend, with an office manager and a small staff of AI agents who plan, research, write and build while you watch. Spin the building, go up in the lift, and drop in on anyone.')),
    panel,
    h('button.open-pill', { type: 'button', onclick: () => openClaim() },
      h('span.pill-status', {}, data.vacant ? 'To let' : 'Full up', h('small', {}, data.vacant ? `Floor ${data.vacant} is empty` : 'Building full')),
      h('span.pill-go', {}, 'Open an office'), h('span.pill-arrow', {}, icon('key'))),
    h('p.hints', {}, isPhone() ? 'Drag to look around. Tap a lit floor.' : 'Drag to spin. Wheel goes up and down. Any lit floor is open.'),
    buildTicker(),
    data.globalPause ? h('p.banner', {}, 'The building manager has paused all work for now.') : null,
    tip = h('div.floor-tip', { hidden: true }),
  );

  poll = setInterval(async () => {
    try {
      const fresh = await api('/floors');
      keepFloors = fresh.floors; view?.setFloors(fresh.floors);
      if (document.activeElement !== search) renderList();
      if (wallOn) loadWall();
    } catch { /* retried next time */ }
  }, 20000);
}

function showTip(n, x, y) {
  if (!tip) return;
  if (n < 1) { tip.hidden = true; return; }
  const c = keepFloors.find((f) => f.number === n);
  tip.hidden = false;
  tip.textContent = c ? `${n} · ${c.name || 'Moving in'}` : `${n} · To let`;
  tip.style.transform = `translate(${x + 16}px, ${y - 12}px)`;
}

export function hideLobby() {
  clearInterval(poll); poll = null; tip = null;
  clearInterval(tickerPoll); tickerPoll = null;
}
