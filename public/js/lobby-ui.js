// The lobby overlay: headline, floor directory with search, and the way in.
import { stage } from './stage.js';
import { h, api, session, isPhone, toast, clear, put } from './dom.js';
import { LobbyView } from './lobby-scene.js';
import { openClaim, openLogin } from './claim.js';

let view = null, poll = null, keepFloors = [], tip = null;

function directoryRow(card, onEnter, onHover) {
  return h('button.dir-row', { type: 'button', 'data-floor': card.number, css: { '--brand': card.colors.primary }, onclick: () => onEnter(card), onpointerenter: () => onHover(card.number) },
    h('span.dir-num', {}, String(card.number)),
    h('span.dir-mark', { 'aria-hidden': 'true' }, (card.name.trim()[0] || '?').toUpperCase()),
    h('span.dir-text', {}, h('b', {}, card.name), h('small', {}, card.status === 'suspended' ? 'Closed by the building manager' : card.tagline || 'A tiny company')),
    card.busy ? h('span.dir-busy', { title: `${card.busy} at work` }, h('i'), String(card.busy)) : null);
}

export async function showLobby(root) {
  document.body.dataset.page = 'lobby';
  const data = await api('/floors').catch(() => ({ floors: [], towerFloors: 40, vacant: 1 }));
  keepFloors = data.floors;

  const enterFloor = async (card) => {
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
        if (card) enterFloor(card); else { toast(`Floor ${n} is empty. Got a code?`); }
      },
    });
    view.setFloors(data.floors);
    stage.setView(view);
    window.__lobbyDebug = view;  // read by the browser e2e tests
  }

  const search = h('input', { type: 'search', placeholder: 'Find a company or what it does', 'aria-label': 'Search the directory', oninput: () => renderList() });
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
      grid.append(h(`button.lift-btn${card ? '.lit' : ''}`, { type: 'button', 'data-lift': n, css: card ? { '--brand': card.colors.primary } : {}, 'aria-label': card ? `Floor ${n}, ${card.name}` : `Floor ${n}, empty`, onpointerenter: () => { view?.setHover(n); view?.rideTo(n); }, onclick: () => { if (card) enterFloor(card); else openClaim(); } }, String(n)));
    }
    const vacant = data.towerFloors - keepFloors.length;
    return h('section.lift-wrap', {}, h('h3', {}, 'Lift', h('small', {}, `${vacant} empty ${vacant === 1 ? 'floor' : 'floors'}`)), grid);
  };
  renderList();

  const panel = h('aside.directory.glass', { 'aria-label': 'Floor directory' },
    h('button.sheet-grip', { type: 'button', 'aria-label': 'Show or hide the directory', onclick: () => panel.classList.toggle('open') }, h('i'), h('span.grip-label', {}, 'Directory')),
    h('div.dir-search', {}, search),
    h('div.dir-head', {}, h('span', {}, h('i.live-dot'), 'The Office'), count),
    list,
    h('p.dir-hint', {}, 'Anyone can walk in and watch'));

  const account = session.floor
    ? h('button.btn.chrome', { type: 'button', onclick: () => window.officeGo(`/floor/${session.floor.slug}`) }, 'My floor')
    : h('button.btn.chrome', { type: 'button', onclick: () => openLogin() }, 'Sign in');

  put(root,
    h('header.topbar', {}, h('span.wordmark', {}, 'The Office'), account),
    h('section.hero', {},
      h('h1', {}, 'Clock in. ', h('em', {}, 'Someone else'), ' does the work.'),
      h('p', {}, 'Each floor belongs to one friend, with an office manager and a small staff of AI agents who plan, research, write and build while you watch. Turn the tower, ride the floors, and walk in on anyone.')),
    panel,
    h('button.open-pill', { type: 'button', onclick: () => openClaim() },
      h('span.pill-status', {}, h('i.live-dot'), data.vacant ? `Floor ${data.vacant} is empty` : 'Building full'),
      h('span.pill-go', {}, 'Open an office'), h('span.pill-arrow', { 'aria-hidden': 'true' }, '↗')),
    h('p.hints', {}, isPhone() ? 'Drag to turn and ride. Tap a floor.' : 'Drag to turn. Scroll to ride. Click a floor to walk in.'),
    data.globalPause ? h('p.banner', {}, 'The building manager has paused all work for now.') : null,
    tip = h('div.floor-tip', { hidden: true }),
  );

  poll = setInterval(async () => {
    try {
      const fresh = await api('/floors');
      keepFloors = fresh.floors; view?.setFloors(fresh.floors);
      if (document.activeElement !== search) renderList();
    } catch { /* retried next time */ }
  }, 20000);
}

function showTip(n, x, y) {
  if (!tip) return;
  if (n < 1) { tip.hidden = true; return; }
  const c = keepFloors.find((f) => f.number === n);
  tip.hidden = false;
  tip.textContent = c ? `${n} · ${c.name}` : `${n} · Empty floor`;
  tip.style.transform = `translate(${x + 16}px, ${y - 12}px)`;
}

export function hideLobby() {
  clearInterval(poll); poll = null; tip = null;
}
