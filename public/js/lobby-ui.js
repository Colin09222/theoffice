// The home page (docs/redesign/OFFICE-ANSWERS-1.md, Q1, Q3, section 4 "Home"): what got made and what is happening, in 10 seconds.
// Top bar, the 3 best launches, Happening now (5 lines at most, real work only), the open floors with their state, All launches, Open an
// office and one line of floors to let. All of it is plain DOM from small modules: it is on screen before any 3D code is fetched. On a desktop
// the small 3D tower comes last, in a frame about a third of the width, and works as a navigator; if it can't load, the floor list is the way
// round. A phone gets no 3D on the home page at all.
import { h, api, session, isPhone, clear, put, timeAgo, BASE } from './dom.js';
import { icon } from './icons.js';
import { muteButton, sfx, eventSound } from './sfx.js';
import { stateBadge, idleNote } from './badge.js';
import { launchCard } from './launch-card.js';
import { heroFrames, crossfade } from './hero-fade.js';
import { billboardImages } from './billboard.js';
import { shouldFlyIn, FLYIN_KEY, SKIP_EVENTS } from './flyin.js';
import { mailroomStrip } from './mailroom-ui.js';

// The claim wizard and its character builder are only fetched when someone opens them.
const claimModule = () => import('./claim.js');
const openClaim = () => claimModule().then((m) => m.openClaim());
const openLogin = () => claimModule().then((m) => m.openLogin());

const NOW_LINES = 5;
let floors = [], toLet = [], poll = null, nowPoll = null, tower = null, tip = null, alive = false, fades = [];
// Round 2, r2-j36: the live tower's signals (/api/building/live), read every 5 s while the tab is in view, so a job that starts lights its
// floor within 10 s. The tower draws them; on a phone (and wherever there is no tower) the floor list's dot pulses for a floor at work.
const LIVE_MS = 5000;
let live = null, livePoll = null;
// Round 2, r2-j43: a launch somewhere in the building rings the bell once (if sound is on). The first reading only learns what is already there.
const launchSeen = new Map(); let liveRead = false;
// Round 2, r2-j37: the crown billboard shows the same 3 launches as the hero, from the same list.
let heroList = [];
const liveWork = (n) => !!live?.floors?.find((f) => f.number === n)?.work;

/** One open floor, one line: number, name, what it does, and its state. */
function floorRow(card, onEnter) {
  return h('button.dir-row', { type: 'button', 'data-floor': card.number, 'data-live': liveWork(card.number) ? 'work' : null, css: { '--brand': card.colors.primary }, onclick: () => onEnter(card), onpointerenter: () => tower?.setHover?.(card.number), onpointerleave: () => tower?.setHover?.(-1) },
    h('span.dir-num', {}, String(card.number)),
    h('span.dir-mark', { 'aria-hidden': 'true' }),
    h('span.dir-text', {}, h('b', {}, card.name || 'Moving in'), h('small', {}, idleNote(card) || card.tagline || (card.name ? 'A tiny company' : 'Boxes still in the corridor'))),
    stateBadge(card));
}

/** Happening now (job 30): the newest real work in the building, one line per job from its job card, newest first, five at most, from
 *  /api/building/now. A line that is already up is changed where it stands. Nothing in the last day: "Quiet right now", with when the
 *  last job really finished. A failed fetch hides the strip and says nothing. */
function buildNow() {
  const list = h('ol.now-list');
  const strip = h('section.home-now.card-ui', { 'aria-label': 'Happening now', 'data-now': '', hidden: true }, h('h2', {}, h('i.live-dot', { 'aria-hidden': 'true' }), 'Happening now'), list);
  const rows = new Map();
  const line = (it) => {
    const go = it.url ? h('a.now-text', { href: it.url, target: '_blank', rel: 'noopener noreferrer' }, it.text) : h('span.now-text', {}, it.text);
    const li = rows.get(it.id) || h('li.now-line', { 'data-id': it.id });
    li.className = `now-line${it.kind === 'published' ? ' launch' : ''}`;
    li.dataset.kind = it.kind;
    li.replaceChildren(
      h('button.now-floor', { type: 'button', title: `Walk into ${it.floor.name}`, onclick: () => window.officeGo(`/floor/${it.floor.slug}`) }, h('b', {}, String(it.floor.number)), it.floor.name),
      go, h('time', {}, timeAgo(it.ts)));
    rows.set(it.id, li);
    return li;
  };
  const refresh = async () => {
    let d;
    try { d = await api('/building/now'); } catch { strip.hidden = true; return; }
    const items = (d.items || []).slice(0, NOW_LINES);
    if (!items.length) {
      rows.clear();
      list.replaceChildren(h('li.now-quiet', {}, d.lastFinished ? `Quiet right now. Last job finished ${timeAgo(d.lastFinished)}.` : 'Quiet right now.'));
    } else {
      const keep = new Set(items.map((i) => i.id));
      for (const id of [...rows.keys()]) if (!keep.has(id)) rows.delete(id);
      list.replaceChildren(...items.map(line));
    }
    strip.hidden = false;
  };
  strip.ready = refresh();
  nowPoll = setInterval(() => { if (!document.hidden) refresh(); }, 15000);
  return strip;
}

/** The hero: the three best launches, with real screenshots. Fewer than three: what there is, then an Open an office card. */
function buildHero(onFloor) {
  const strip = h('section.hero-strip', { 'data-hero': '', 'aria-label': 'The best launches this week', hidden: true });
  strip.ready = api('/building/hero').then(({ projects }) => {
    const list = projects || [];
    heroList = list; tower?.setBillboard?.(billboardImages(heroList));
    const cards = list.map((pr) => launchCard(pr, { hero: true, onFloor }));
    // Round 2, r2-j33: a card with more than one real screenshot fades between them while it is on screen.
    fades.forEach((f) => f?.stop()); fades = cards.map((c, i) => crossfade(c, heroFrames(list[i])));
    if (cards.length < 3) cards.push(h('article.lcard.lcard-open', {}, h('div.lcard-body', {}, h('h3.lcard-title', {}, 'Your company could be here'), h('p.lcard-line', {}, 'A floor of your own, a team of AI staff, and a real thing on the web.'), h('button.btn.small.lcard-go', { type: 'button', onclick: () => openClaim() }, 'Open an office'))));
    strip.replaceChildren(...cards);
    strip.hidden = false;
  }).catch(() => { /* no strip, and no error for a visitor */ });
  return strip;
}

export async function showLobby(root) {
  document.body.dataset.page = 'lobby';
  alive = true;
  const data = await api('/floors').catch(() => ({ floors: [], towerFloors: 10, vacant: null, toLet: [] }));
  floors = data.floors; toLet = data.toLet;

  const enterFloor = async (card) => {
    sfx('press', { rate: 0.75 });
    // A short swoop to the floor's glass in the small tower, when it is there, then the floor's page.
    if (tower?.flyTo) { document.body.classList.add('flying'); await Promise.race([tower.flyTo(card.number), new Promise((r) => setTimeout(r, 650))]); document.body.classList.remove('flying'); }
    window.officeGo(`/floor/${card.slug}`);
  };
  const onFloor = (fl) => { const f = floors.find((x) => x.slug === fl.slug); if (f) enterFloor(f); else window.officeGo(`/floor/${fl.slug}`); };

  // ---- the open floors: the directory and the lift, both open floors only ----
  const list = h('div.dir-list', { role: 'list' });
  const lift = h('div.lift', { role: 'group', 'aria-label': 'The lift' });
  const letLine = h('p.to-let');
  const renderFloors = () => {
    clear(list); clear(lift);
    if (!floors.length) list.append(h('p.dir-empty', {}, 'The building is brand new, and every floor is empty. Someone has to go first.'));
    for (const c of floors) list.append(floorRow(c, enterFloor));
    // Round 2, r2-j50: B, the basement mailroom, at the bottom of the lift.
    if (mailroomOn) lift.append(h('button.lift-btn.lift-b', { type: 'button', 'data-lift': 'B', 'aria-label': 'B, the mailroom', onclick: () => window.officeGo('/mailroom') }, 'B'));
    for (const c of [...floors].sort((a, b) => b.number - a.number)) lift.append(h('button.lift-btn.lit', { type: 'button', 'data-lift': c.number, css: { '--brand': c.colors.primary }, 'aria-label': `Floor ${c.number}, ${c.name || 'moving in'}`, onclick: () => enterFloor(c), onpointerenter: () => tower?.setHover?.(c.number) }, String(c.number)));
    const n = toLet.length;
    letLine.replaceChildren(n ? `${n} ${n === 1 ? 'floor' : 'floors'} to let` : 'Every floor is taken');
  };
  // Round 2, r2-j50: the basement shows at the foot of the tower panel: buddehbot's state and the tray, one tap from the mailroom.
  const footStrip = h('div.tower-foot');
  let mailroomOn = false;
  const readMailroom = async () => { try { const d = await api('/mailroom'); if (!mailroomOn) { mailroomOn = true; renderFloors(); } footStrip.replaceChildren(mailroomStrip(d)); } catch { /* no mailroom: no B */ } };
  renderFloors();
  readMailroom();

  const account = session.floor
    ? h('button.btn', { type: 'button', onclick: () => window.officeGo(`/floor/${session.floor.slug}`) }, icon('elevator'), h('span', {}, 'My floor'))
    : h('button.btn', { type: 'button', onclick: () => openLogin() }, icon('sign-in'), h('span', {}, 'Sign in'));
  const towerFrame = h('aside.home-tower', { 'aria-label': 'The building', hidden: isPhone() }, h('p.tower-wait', {}, 'The building is on its way…'), footStrip);
  tip = h('div.floor-tip', { hidden: true });

  const hero = buildHero(onFloor), now = buildNow();
  put(root,
    h('div.home', {},
      h('header.home-top', {},
        h('div.home-brand', {}, h('span.home-logo', { 'aria-hidden': 'true' }, 'O'), h('div', {}, h('h1', {}, 'The Office'), h('p', {}, 'Clock in. Someone else does the work.'))),
        h('div.home-acts', {}, account, muteButton())),
      h('div.home-main', {},
        h('div.home-col', {},
          hero,
          data.globalPause ? h('p.banner', {}, 'The building manager has paused all work for now.') : null,
          now,
          h('section.home-dir.card-ui', { 'aria-label': 'Open floors' },
            h('div.home-dir-head', {}, h('h2', {}, 'Floors'),
              // Round 2, r2-j66: the Monday page, next to All launches.
              h('a.all-launches.this-week', { href: `${BASE}/thisweek`, 'data-this-week': '', onclick: (e) => { e.preventDefault(); window.officeGo('/thisweek'); } }, 'This week'),
              h('a.all-launches', { href: `${BASE}/launched`, 'data-all-launches': '', onclick: (e) => { e.preventDefault(); window.officeGo('/launched'); } }, 'All launches', icon('caret-right'))),
            list,
            h('div.lift-wrap', {}, lift, letLine)),
          h('div.home-foot', {},
            h('button.btn.primary.open-office', { type: 'button', onclick: () => openClaim() }, icon('key'), 'Open an office'),
            h('p.dir-legal', {}, h('a', { href: `${BASE}/about` }, 'About'), ' · ', h('a', { href: `${BASE}/privacy` }, 'Privacy'), ' · ', h('a', { href: `${BASE}/terms` }, 'Terms')))),
        towerFrame)),
    tip);

  const readLive = async () => {
    try { live = await api('/building/live'); } catch { return; }
    if (!alive) return;
    let rang = false;
    for (const f of live.floors || []) {
      if (!f.launchAt) continue;
      if (liveRead && f.launchAt > (launchSeen.get(f.number) || 0) && !rang) rang = eventSound('launch') || true;
      launchSeen.set(f.number, Math.max(launchSeen.get(f.number) || 0, f.launchAt));
    }
    liveRead = true;
    for (const row of list.querySelectorAll('.dir-row')) { if (liveWork(Number(row.dataset.floor))) row.dataset.live = 'work'; else delete row.dataset.live; }
    tower?.setLive?.(live.floors);
  };
  readLive();
  livePoll = setInterval(() => { if (!document.hidden) { readLive(); readMailroom(); } }, LIVE_MS);

  poll = setInterval(async () => {
    if (document.hidden) return;  // a tab nobody is looking at asks for nothing
    try { const fresh = await api('/floors'); floors = fresh.floors; toLet = fresh.toLet; renderFloors(); tower?.setFloors?.(fresh.floors, fresh.toLet); } catch { /* retried next time */ }
  }, 20000);

  // ---- the tower, last: once the hero and Happening now are on screen (or have failed), and never on a phone ----
  const contentIn = Promise.race([Promise.allSettled([hero.ready, now.ready]), new Promise((r) => setTimeout(r, 4000))]);
  if (!isPhone()) {
    contentIn.then(() => requestAnimationFrame(() => setTimeout(async () => {
      try {
        const m = await import('./tower-nav.js');
        if (!alive) return;
        tower = await m.showTower({ frame: towerFrame, floorCount: data.towerFloors, floors, toLet, onPick: (n) => { const c = floors.find((f) => f.number === n); if (c) enterFloor(c); else if (toLet.includes(n)) openClaim(); }, onHover: showTip });
        if (!tower) towerFrame.hidden = true;  // no 3D here: the floor list is the way round, and it is already on screen
        else { if (live) tower.setLive(live.floors); tower.setBillboard(billboardImages(heroList)); flyInOnce(); }
      } catch (e) { console.warn('tower', e?.message); towerFrame.hidden = true; }
    }, 0)));
  }
}

/** Round 2, r2-j38: the fly-in, once ever, on the desktop, never under reduce motion. The mark is set as it starts, so it never plays twice;
 *  any input (a tap, a click, a key, the wheel) skips it. The page content was already on screen before the tower began to load. */
function flyInOnce() {
  let seen = false;
  try { seen = localStorage.getItem(FLYIN_KEY) === '1'; } catch { seen = true; /* no storage: we could not keep it to once, so not at all */ }
  if (!shouldFlyIn({ phone: isPhone(), reduce: window.matchMedia('(prefers-reduced-motion: reduce)').matches, seen })) return;
  try { localStorage.setItem(FLYIN_KEY, '1'); } catch { return; }
  tower.flyIn();
  const skip = () => { tower?.skipFlyIn?.(); for (const e of SKIP_EVENTS) window.removeEventListener(e, skip, true); };
  for (const e of SKIP_EVENTS) window.addEventListener(e, skip, { capture: true, passive: true });
  setTimeout(skip, 3000);
}

function showTip(n, x, y) {
  if (!tip) return;
  if (n < 1) { tip.hidden = true; return; }
  const c = floors.find((f) => f.number === n);
  tip.hidden = false;
  tip.textContent = c ? `${n} · ${c.name || 'Moving in'}` : toLet.includes(n) ? `${n} · To let` : `${n}`;
  tip.style.transform = `translate(${x + 16}px, ${y - 12}px)`;
}

export function hideLobby() {
  alive = false;
  clearInterval(poll); poll = null; clearInterval(nowPoll); nowPoll = null; tip = null;
  clearInterval(livePoll); livePoll = null;
  fades.forEach((f) => f?.stop()); fades = [];
  tower?.leave?.(); tower = null;
}
