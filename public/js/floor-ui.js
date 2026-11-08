// The floor page. One SSE stream feeds the 3D characters and the desk: the intercom, the group chat, the logbook, the corkboard, the filing cabinet, the in-tray.
import { stage } from './stage.js';
import { h, api, BASE, $, clear, put, modal, toast, money, timeAgo, session, ApiError } from './dom.js';
import { OfficeView } from './office-scene.js';
import { renderMarkdown } from './markdown.js';
import { openCustomisePanel } from './customise.js';
import { openLogin } from './claim.js';
import { renderCard, buildScrubber, buildPins, wirePins, tabIcon } from './floor-chrome.js';
import { icon } from './icons.js';
import { attachTray, attachmentEl, ACCEPT } from './attach.js';
import { portrait } from './portrait.js';
import { muteButton, sfx } from './sfx.js';
import { confetti, fanfare, mayParty } from './party.js';
import { journeyBar, chipsRow, startButton, renderBusiness, businessActive, businessUnchanged } from './business-ui.js';
import { aheadState, isParked, lift, park, peekAhead, unpark } from './floorcache.js';
import { renderInbox, mailTab, mailPending, renderMailRequests, onMailEvent } from './mail-ui.js';
import { renderServers, renderServerRequests, serverTab, serversPending } from './server-panel.js';
import { payTab, payPending, renderPayRequests, renderPay, onPayLanding } from './pay-ui.js';
import { legalPending, renderLegalRequests } from './legal-ui.js';
import { renderNumbers } from './numbers-ui.js';
import { onChatEvent } from './chat-ui.js';
import { launchFlow, makerCard } from './launch-ui.js';
import { setupOnArrival } from './setup-ui.js';
import { recoveryBox } from './dom.js';
import * as THREE from '../vendor/three/three.module.min.js';

/** When set hours open next, in the reader's own clock: "at 9:00 AM" later today, otherwise the day as well. */
function opensWhen(ms) {
  const d = new Date(ms), now = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `at ${time}`;
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  return d.toDateString() === tomorrow.toDateString() ? `tomorrow at ${time}` : `${d.toLocaleDateString([], { weekday: 'long' })} at ${time}`;
}

const isPhone = () => window.innerWidth <= 760;
const isCompact = () => isPhone() || window.innerHeight <= 520;  // a phone on its side: its panel stays beside the room, but the row of tabs still has to fit
// The phone sheet’s three sizes. A conversation opens tall; everything else opens at half, sharing the screen with the room.
const HALF = 0.58;  // the same number as public/css/mobile.css: the room is told before the sheet has finished moving
const CHAT_TABS = new Set(['chat', 'talk']);
const PHONE_ROW = 4;  // the tabs that always show in the phone’s row; the rest fold under More
const cssPx = (name) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;
/**
 * Keeps a conversation on its newest line while the reader is there. Scrolled up, the list stays put and a small pill says there’s more,
 * and anything that resizes the list (the keyboard, the sheet) keeps the reader where they were. `rest` puts the list at its resting place.
 */
function followList(list, body, rest) {
  const near = () => list.scrollHeight - list.scrollTop - list.clientHeight < 72;
  let ownTop = null;  // where the list last came to rest by itself: a scroll landing there is ours, anywhere else the reader’s
  const pill = h('button.new-pill', { type: 'button', hidden: true, 'data-new-pill': '', onclick: () => { f.pinned = true; f.settle(); } }, icon('caret-down'), 'New messages');
  body.append(pill);
  const place = () => { if (!pill.hidden) pill.style.bottom = `${body.getBoundingClientRect().bottom - list.getBoundingClientRect().bottom + 10}px`; };
  const f = {
    list, pinned: true,
    settle() { rest(); ownTop = list.scrollTop; pill.hidden = true; f.pinned = true; },
    added() { if (f.pinned) f.settle(); else { pill.hidden = false; place(); } },
    stop() { ro.disconnect(); window.removeEventListener('office:kb', onKb); pill.remove(); },
  };
  list.addEventListener('scroll', () => { if (Math.abs(list.scrollTop - ownTop) <= 2) return; f.pinned = near(); if (f.pinned) pill.hidden = true; }, { passive: true });
  // Whenever the list changes size at the bottom, it stays at the bottom. And someone who has just started typing wants to see what they’re answering.
  const typing = () => document.body.classList.contains('kb-open') && document.activeElement?.closest?.('.chat-input');
  const ro = new ResizeObserver(() => { if (f.pinned || typing()) f.settle(); else place(); });
  ro.observe(list);
  // The keyboard moving is the moment that matters most: settle once the page has laid out around it, rather than leaving it to the observer’s timing.
  const onKb = () => requestAnimationFrame(() => requestAnimationFrame(() => { if (f.pinned || typing()) f.settle(); }));
  window.addEventListener('office:kb', onKb);
  return f;
}
const TALK_KIND = { assign: 'Assignment', plan: 'The plan', handoff: 'Handoff', findings: 'Findings', review: 'Review', question: 'Question', answer: 'Answer', ask: 'Asking', meeting: 'Meeting', banter: 'Small talk' };
const NAME_INK = ['#b3261e', '#0b6e69', '#1d5fb8', '#8a5200', '#8a2f6b', '#2c7a31', '#a33f00', '#22577a'];
const COLUMNS = [['todo', 'To do'], ['doing', 'Doing'], ['review', 'With manager'], ['done', 'Done']];
const STATE_LABEL = { idle: 'At desk', thinking: 'Thinking', typing: 'Writing', browsing: 'On the web', reading: 'Reading', talking: 'Talking', queued: 'Waiting for a line' };
// Three ways in for a new floor. Tapping one is simply the boss's first message, so typing anything else works just as well.
const LANES = [
  ['game', 'Game', 'A small browser game people can play right away', 'Let\'s do a game. What could we build?'],
  ['website', 'Website', 'A real site with real words, live at a link', 'Let\'s do a website. What do you need from me?'],
  ['business', 'Business', 'Market research, a plan and a landing page', 'Let\'s do a small business. Help me work it out.'],
];
const HELP_STATUS = { pending: 'Waiting for an answer. The team carries on meanwhile.', answered: 'Buddehbot answered. It is in the chat.', declined: 'Buddehbot passed on this one, so the manager is using their judgment.', expired: 'No answer came in time, so the manager is using their judgment.' };

let F = null; // the active floor page

class FloorPage {
  constructor(root, slug) { this.root = root; this.slug = slug; this.dead = false; this.tab = 'work'; this.seen = new Set(); this.streamBuf = ''; }

  async load() {
    // Fetched ahead while the floor below or above was looked at: the lift opens on it at once.
    this.state = (await aheadState(this.slug)) || await api(`/floors/${this.slug}`);
    return this.state;
  }
  get owner() { return this.state.viewer.owner; }
  get canSeeChat() { return !!this.state.messages; }

  mount() {
    document.body.dataset.page = 'floor';
    const s = this.state;
    this.tab = this.canSeeChat ? 'chat' : 'talk';
    if (new URLSearchParams(location.search).get('ad') && businessActive(this)) { this.tab = 'business'; this.panelOpen = true; }
    onPayLanding(this);  // back from Stripe's onboarding: straight to the Payments tab
    // The boss arrives at the chat with the manager. A visitor arrives at the room, with the panel a tap away.
    this.panelOpen = this.panelOpen || this.owner;
    this.localTalk = [];
    this.tapAgent = (e) => { const id = typeof e.detail === 'string' ? e.detail : e.detail?.id; const a = this.state.agents.find((x) => x.id === id); if (a) this.openAgent(a); };
    window.addEventListener('office:agent-tap', this.tapAgent);
    this.applyBrand();
    this.buildShell();
    if (stage.ok) {
      this.labels = $('#labels'); clear(this.labels);
      this.view = this.adoptView() || this.makeView();
      stage.setView(this.view);
      wirePins(this);
    } else this.pinsEl.hidden = true;  // no room to float over
    this.renderAll();
    this.layout();
    this.learnZone();
    this.onResize = () => this.layout();
    window.addEventListener('resize', this.onResize);
    this.catchUpBanner();
    this.connect();
    this.wireSceneTaps();
    if (!setupOnArrival(this) && s.floor.setup && this.owner) setTimeout(() => { if (!this.dead && !isPhone()) this.bodyEl.querySelector('.chat-input textarea')?.focus(); }, 500);
  }
  /** Tap someone in the room to open their file. A drag still spins the room: only a tap that barely moved counts, and only on a person. */
  wireSceneTaps() {
    const scene = $('#scene'); if (!scene || !stage.ok) return;
    let down = null;
    const onDown = (e) => { down = e.target === scene ? [e.clientX, e.clientY] : null; };
    const onUp = (e) => {
      if (!down || e.target !== scene) return;
      const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]); down = null;
      if (moved > 9) return;
      const a = this.agentAt(e.clientX, e.clientY);
      if (a) { sfx('tab'); this.openAgent(a); }
    };
    scene.addEventListener('pointerdown', onDown); window.addEventListener('pointerup', onUp);
    this.unwireTaps = () => { scene.removeEventListener('pointerdown', onDown); window.removeEventListener('pointerup', onUp); };
  }
  agentAt(x, y) {
    const v = this.view; if (!v?.camera || !v.actors) return null;
    const rect = $('#scene').getBoundingClientRect();
    const toScreen = (p) => { const q = p.clone().project(v.camera); return [rect.left + (q.x + 1) / 2 * rect.width, rect.top + (1 - q.y) / 2 * rect.height]; };
    let best = null, bestD = Infinity;
    for (const [id, actor] of v.actors) {
      const g = actor.char?.group; if (!g || id === 'boss') continue;
      const a = this.state.agents.find((p) => p.id === id); if (!a) continue;
      const foot = g.getWorldPosition(new THREE.Vector3());
      const [fx, fy] = toScreen(foot), [, hy] = toScreen(foot.clone().setY(foot.y + 1.8));
      const tall = Math.max(30, fy - hy), half = Math.max(22, tall * 0.42);  // never smaller than a fingertip
      if (x < fx - half || x > fx + half || y < hy - 6 || y > fy + 6) continue;
      const d = Math.hypot(x - fx, y - (fy + hy) / 2);
      if (d < bestD) { bestD = d; best = a; }
    }
    return best;
  }
  /** Find anyone by id or name: the staff, or the boss. */
  person(id, name) {
    if (id === 'boss' || (name && name === this.state.floor.boss?.name)) return { ...this.state.floor.boss, boss: true };
    return this.state.agents.find((a) => a.id === id) || (name ? this.state.agents.find((a) => a.name === name) : null) || null;
  }
  face(person) { return portrait(person?.look, { accent: this.state.floor.colors?.accent, name: person?.name }); }
  nameInk(name) { let h2 = 7; for (const c of String(name || '')) h2 = (h2 * 31 + c.charCodeAt(0)) >>> 0; return NAME_INK[h2 % NAME_INK.length]; }
  get manager() { return this.state.agents.find((a) => a.role === 'manager'); }
  applyBrand() {
    const { primary, accent } = this.preview?.colors || this.state.floor.colors;
    document.documentElement.style.setProperty('--brand', primary);
    document.documentElement.style.setProperty('--brand-2', accent);
  }

  buildShell() {
    const s = this.state;
    this.titleEl = h('h1.floor-name'); this.tagEl = h('p.floor-tag');
    this.statusEl = h('span.status-pill');
    this.controlsEl = h('div.controls');
    this.staffEl = h('div.staff-strip', { role: 'list' });
    this.tabsEl = h('nav.tabs', { role: 'tablist' });
    this.bodyEl = h('div.tab-body');
    this.bannerEl = h('div.floor-banner', { hidden: true });
    this.grip = h('button.panel-grip', { type: 'button', 'aria-label': 'Open or close this panel', onclick: () => this.setPanel(!this.panelOpen) }, h('i'));
    this.stepBtn = h('button.sheet-step', { type: 'button', 'data-sheet-step': '', 'aria-label': 'Make this panel bigger', onclick: () => this.stepSheet() }, icon('caret-up'));
    this.bindGrip();
    this.sheetBar = h('div.sheet-bar', {}, this.grip, this.stepBtn);
    this.headEl = h('div.sheet-head');  // phones: the sheet’s own title row, under the handle
    this.peekEl = h('div.sheet-rest');  // phones: what shows when the sheet is resting
    const panel = h('aside.floor-panel', {}, this.sheetBar, this.headEl, this.peekEl, h('button.panel-close', { type: 'button', 'aria-label': 'Close this panel', onclick: () => this.setPanel(false) }, icon('x')), this.staffEl, this.tabsEl, this.bannerEl, this.bodyEl);
    this.panel = panel;
    panel.addEventListener('pointerdown', (e) => { if (this.moreOpen && !e.target.closest('.tabs')) this.setMore(false); });
    this.cardEl = h('div.card-more');
    this.logoEl = h('span.card-logo', { 'aria-hidden': 'true' });
    this.pillEl = h('button.talk-pill', { type: 'button', 'data-talk-pill': '', onclick: () => this.setTab(this.canSeeChat ? 'chat' : 'talk') });
    this.journeyEl = h('div.journey-slot', { 'data-journey-slot': '' });
    this.pinsEl = buildPins(this);
    this.scrubberEl = buildScrubber(this);
    document.body.append(this.pinsEl);  // under the people's labels, so a pin never hides what someone is saying
    this.root.append(
      h('header.floor-top', {},
        h('div.plaque-top', {}, h('button.btn.chrome.back', { type: 'button', 'aria-label': 'Back to building', onclick: () => window.officeGo('/') }, icon('elevator'), h('span', {}, 'Back to building')), muteButton()),
        h('div.floor-title', {}, h('span.floor-num', {}, `Floor ${s.floor.number}`), this.logoEl, this.titleEl, this.tagEl),
        h('div.floor-meta', {}, this.statusEl, this.hoursEl = h('div.hours-sign', { 'data-hours': '' }, h('b'), h('small'))),
        this.cardEl),
      this.controlsEl,
      this.journeyEl,
      this.pillEl,
      this.scrubberEl,
      panel,
    );
  }

  /**
   * The floors either side, their rooms built ahead while this one is left alone and kept for the lift (see floorcache.js): a desktop
   * builds both, a phone the one the lift was last going towards. A room takes a moment to put together, so it waits for a quiet spell.
   */
  async buildAhead(above, below) {
    const list = (isPhone() ? [lift.dir > 0 ? above || below : below || above] : [above, below]).filter(Boolean);
    for (const f of list) {
      for (let i = 0; i < 40 && !this.dead; i++) {
        await new Promise((r) => setTimeout(r, 400));
        if (stage.view === this.view && performance.now() - (stage.lastInput || 0) > 2500 && this.view?.loading?.settled) break;
      }
      if (this.dead || !stage.ok || isParked(f.slug)) continue;
      const state = await peekAhead(f.slug);
      if (!state || this.dead) continue;
      // Its bake, furniture and people come a step at a time in the gaps between frames, like a floor in the tower.
      const v = new OfficeView({ state, labels: document.createElement('div'), pace: () => new Promise((r) => (window.requestIdleCallback || setTimeout)(() => r(), { timeout: 400 })) });
      park(f.slug, v, isPhone() ? 2 : 3);
      // Its shaders compiled and its baked floor on the GPU now, so its first frame on screen has nothing left to do.
      const r = stage.renderer;
      try { r.compileAsync?.(v.scene, v.camera)?.catch(() => {}); if (v.floorMat?.map) r.initTexture(v.floorMat.map); } catch { /* compiled on first sight instead */ }
    }
  }
  makeView() { return new OfficeView({ state: this.viewState(), labels: this.labels, onSmallTalk: (line) => this.addLocalTalk(line) }); }
  /** Back by the lift to a floor left a moment ago (see floorcache.js): the same room, brought up to date with what this viewer may see. */
  adoptView() {
    const v = unpark(this.slug); if (!v || v.dead) return null;
    v.bind(); v.labels = this.labels; v.pace = null;
    const f = this.viewState().floor;
    if (JSON.stringify([v.decor, v.colors, v.companyName]) !== JSON.stringify([f.decor, f.colors, f.name])) { v.destroy(); return null; }
    v.tasks = this.state.tasks;
    v.life.onSmallTalk = (line) => this.addLocalTalk(line);
    for (const a of v.actors.values()) this.labels.append(a.tag);
    v.syncAgents(this.viewState());
    for (const a of this.state.agents) v.agentEvent(a);
    return v;
  }
  /** A panel is open or it isn't; on a phone closed means just the tabs showing at the bottom. Either way the room is told what's left for it. */
  setPanel(open) { this.panelOpen = open; if (isPhone()) this.sheet = open ? this.openSize() : 'peek'; this.layout(); }
  /** The size the phone’s sheet opens at for the tab on show: tall for a conversation, unless the boss has chosen otherwise. */
  openSize() { return CHAT_TABS.has(this.tab) ? (this.chatSheet || 'full') : (this.sheet === 'full' ? 'full' : 'half'); }
  /** The phone’s sheet: ’peek’ is the handle and the tabs, ’half’ shares the screen with the room, ’full’ is the whole visible height. */
  setSheet(size, { hand = false } = {}) {
    if (!isPhone()) { this.setPanel(size !== 'peek'); return; }
    this.sheet = size; this.panelOpen = size !== 'peek';
    if (hand && size !== 'peek' && CHAT_TABS.has(this.tab)) this.chatSheet = size;
    this.setMore(false);
    this.layout();
    if (hand && size === 'peek') document.activeElement?.blur?.();
  }
  /** The plain button beside the handle: a size bigger, or at full back to half. */
  stepSheet() { this.setSheet(this.sheet === 'peek' ? this.openSize() : this.sheet === 'half' ? 'full' : 'half', { hand: true }); }
  layout() {
    if (this.dead || !this.panel) return;
    const phone = isPhone();
    this.panel.classList.toggle('closed', !this.panelOpen);
    // The card's details sit on the card on a desktop and under About on a phone. Turning a tablet round moves them.
    const wasPhone = this.phoneLayout; this.phoneLayout = phone;
    if (wasPhone !== phone) {
      if (!phone) this.root.querySelector('.floor-top').append(this.cardEl);
      if (!phone && this.tab === 'about') this.tab = this.canSeeChat ? 'chat' : 'talk';
      if (wasPhone !== undefined) { this.setMore(false); this.renderTabs(); this.renderBody(); }
    }
    if (phone) { if (!this.panelOpen) this.sheet = 'peek'; else if (!this.sheet || this.sheet === 'peek') this.sheet = this.openSize(); }
    document.body.dataset.sheet = phone ? this.sheet : this.panelOpen ? 'half' : 'peek';
    if (phone) {
      // Peek is as tall as what it’s showing, so the sheet’s other measurements wait on it.
      this.peekH = Math.round(this.sheetBar.offsetHeight + this.peekEl.offsetHeight + this.tabsEl.offsetHeight + cssPx('--sa-b'));
      document.documentElement.style.setProperty('--peek', `${this.peekH}px`);
    }
    if (this.stepBtn) { const up = !phone || this.sheet !== 'full'; this.stepBtn.replaceChildren(icon(up ? 'caret-up' : 'caret-down')); this.stepBtn.setAttribute('aria-label', up ? 'Make this panel bigger' : 'Make this panel smaller'); }
    this.pillEl.hidden = phone || this.panelOpen;
    if (!this.pillEl.hidden) this.pillEl.replaceChildren(icon(this.owner ? 'phone-call' : 'chats-teardrop'), this.canSeeChat ? (this.owner ? `Call ${this.manager?.name || 'your manager'}` : 'Read the chat') : 'See what they\'re saying');
    const w = window.innerWidth, h = window.innerHeight;
    if (!this.view) return;
    if (phone) {
      // Not measured: mid-slide the panel is still its old height. Behind a full sheet the room keeps the half-sheet framing, so it doesn’t jump when the sheet comes down.
      const sheet = this.sheet === 'peek' ? this.peekH : h * HALF;
      this.view.setInsets({ left: 0, right: 0, top: businessActive(this) ? 112 : 58, bottom: sheet + 44 });
    } else {
      const card = this.root.querySelector('.floor-top').getBoundingClientRect();
      const taken = this.panelOpen ? w - this.panel.getBoundingClientRect().left : w - this.scrubberEl.getBoundingClientRect().left;
      this.view.setInsets({ left: Math.min(w * 0.3, card.right + 6), right: Math.min(w * 0.42, taken + 6), top: businessActive(this) ? 92 : 20, bottom: 56 });
    }
  }
  /** The sheet’s resting heights, in pixels, within what’s visible right now (the keyboard takes its share). */
  sheetSizes() {
    const room = this.panel.offsetParent.clientHeight - cssPx('--kb') - cssPx('--vvt') - cssPx('--sa-t');
    return { peek: this.peekH, half: room * HALF, full: room };
  }
  /** Drag the sheet’s handle on a phone: it follows the finger and settles on the nearest size, or the next one with a flick. A plain tap is handled by the click. */
  bindGrip() {
    let d = null;
    const g = this.grip;
    const move = (e) => {
      if (!d || e.pointerId !== d.id) return;
      const up = d.startY - e.clientY;
      if (!d.moved && Math.abs(up) < 5) return;
      if (!d.moved) { d.moved = true; this.panel.classList.add('dragging'); document.activeElement?.blur?.(); }
      const batch = e.getCoalescedEvents?.();
      for (const c of batch?.length ? batch : [e]) d.trail.push([c.timeStamp, c.clientY]);
      const { peek, full } = this.sheetSizes();
      this.panel.style.height = `${Math.max(peek, Math.min(full, d.startH + up))}px`;
    };
    const end = (e) => {
      if (!d || (e.pointerId !== undefined && e.pointerId !== d.id)) return;
      const was = d; d = null;
      if (!was.moved) return;
      const now = this.panel.getBoundingClientRect().height, sizes = this.sheetSizes();
      // How fast the finger was going at the end: only the last moments count, and a finger that stopped before lifting isn’t a flick.
      const trail = was.trail, whole = e.timeStamp - trail[0][0];
      // A quick swipe is its whole length; a long drag is judged on its last moments, so slowing to a stop before lifting isn’t a flick.
      const recent = whole < 300 ? trail : trail.filter(([t]) => e.timeStamp - t < 110), first = recent[0], last = recent.at(-1);
      const v = first && last !== first ? (first[1] - last[1]) / Math.max(16, last[0] - first[0]) : 0;
      const order = ['peek', 'half', 'full'].sort((a, b) => sizes[a] - sizes[b]);
      let target = order.reduce((best, k) => (Math.abs(sizes[k] - now) < Math.abs(sizes[best] - now) ? k : best), order[0]);
      if (v > 0.6) target = order.find((k) => sizes[k] > now + 4) || order.at(-1);  // a flick up
      if (v < -0.6) target = [...order].reverse().find((k) => sizes[k] < now - 4) || order[0];  // a flick down
      this.panel.classList.remove('dragging'); this.panel.style.height = '';
      this.gripDragged = true; setTimeout(() => { this.gripDragged = false; }, 0);
      this.setSheet(target, { hand: true });
    };
    g.addEventListener('pointerdown', (e) => {
      if (!isPhone()) return;
      d = { id: e.pointerId, startY: e.clientY, startH: this.panel.getBoundingClientRect().height, trail: [[e.timeStamp, e.clientY]], moved: false };
      g.setPointerCapture?.(e.pointerId);
    });
    g.addEventListener('pointermove', move);
    g.addEventListener('pointerup', end);
    g.addEventListener('pointercancel', end);
    g.addEventListener('click', (e) => { if (this.gripDragged) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  }

  renderAll() {
    this.renderJourney(); this.renderHeader(); this.renderControls(); this.renderStaff(); this.renderTabs(); this.renderBody(); renderCard(this);
  }
  /** Business mode's four steps, over the room. The room makes space for them. */
  renderJourney() {
    const bar = journeyBar(this);
    this.journeyEl.replaceChildren(...(bar ? [bar] : []));
    const was = document.body.dataset.business;
    document.body.dataset.business = bar ? 'on' : '';
    if (!!was !== !!bar) this.layout();
  }
  /** The boss's own time zone, for set hours, until they pick one under Customise. */
  learnZone() {
    const w = this.state.workPlan; let tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* an old browser keeps UTC */ }
    if (this.owner && w && !w.tzSet && tz && tz !== w.tz) api(`/floors/${this.slug}/work-mode/zone`, { method: 'POST', body: { tz } }).catch(() => {});
  }
  /** Outside set hours everyone goes home, unless the boss has called them back in for something. */
  get closedNow() { return !!this.state.floor.workMode?.closed && !this.state.agents.some((a) => a.state !== 'idle'); }
  renderHeader() {
    const s = this.state; const f = s.floor;
    this.titleEl.textContent = f.name || 'Moving in'; this.tagEl.textContent = f.filler ? `${f.tagline} · A fictional demo company` : f.tagline || (f.setup ? 'Your manager is sorting out the sign' : '');
    let label = 'Open', cls = 'ok';
    const working = s.agents.some((a) => a.state !== 'idle');
    if (working) { label = 'Working'; cls = 'busy'; }
    if (f.outOfBudget || f.budgetStopped) { label = 'Back soon'; cls = 'warn'; }
    if (f.paused) { label = 'Paused'; cls = 'warn'; }
    if (f.globalPause) { label = 'Building paused'; cls = 'warn'; }
    if (f.status === 'suspended') { label = 'Closed'; cls = 'bad'; }
    else if (label === 'Open' && this.closedNow) { label = 'Closed'; cls = 'warn'; }
    this.statusEl.className = `status-pill ${cls}`; this.statusEl.textContent = label;
    // The sign with the hours: Open 9–5, Open 24/7 or On call.
    const w = f.workMode || { label: 'On call', mode: 'ask' };
    this.hoursEl.dataset.mode = w.mode; this.hoursEl.classList.toggle('closed', this.closedNow);
    this.hoursEl.firstChild.textContent = w.label; this.hoursEl.lastChild.textContent = w.days || (w.mode === 'nonstop' ? 'Every day' : 'When the boss calls');
    this.view?.setClosed?.(this.closedNow);
  }
  renderControls() {
    clear(this.controlsEl);
    const f = this.state.floor;
    if (this.owner) {
      const pause = f.paused
        ? h('button.btn.chrome.resume', { type: 'button', onclick: () => this.control('resume') }, icon('play'), 'Resume')
        : h('button.btn.chrome', { type: 'button', onclick: () => this.control('pause') }, icon('pause'), 'Pause');
      this.controlsEl.append(pause,
        h('button.btn.chrome', { type: 'button', onclick: () => this.confirmStop() }, icon('stop'), 'Stop all'),
        h('button.btn.chrome', { type: 'button', onclick: () => this.openRedirect() }, icon('arrow-bend-up-right'), 'Redirect'),
        h('button.btn.chrome', { type: 'button', onclick: () => this.openCustomise() }, icon('paint-roller'), 'Customise'), startButton(this) || '');
    } else {
      put(this.controlsEl,
        h('span.visitor-note', {}, f.filler ? 'A demo company: scripted and fictional. Watch all you like.' : 'You\'re visiting. Watch all you like.'),
        session.floor || f.filler ? null : h('button.btn.chrome', { type: 'button', onclick: () => openLogin(this.slug) }, 'This is my floor'));
    }
  }
  async control(action, text) {
    try {
      const r = await api(`/floors/${this.slug}/control`, { method: 'POST', body: { action, text } });
      Object.assign(this.state.floor, { paused: r.paused, pauseReason: r.pauseReason, budgetStopped: r.budgetStopped, outOfBudget: r.outOfBudget });
      this.renderHeader(); this.renderControls(); this.renderBanner();
    } catch (e) { toast(e.message, 'bad'); }
  }
  confirmStop() {
    modal('Stop everyone?', (body, close) => {
      body.append(h('div.stack', {}, h('p.lede', {}, 'All open tasks get cancelled. Finished files stay on the drive and published projects stay up.'),
        h('div.row', {}, h('button.btn.ghost.grow', { type: 'button', onclick: () => close() }, 'Keep working'), h('button.btn.danger.grow', { type: 'button', onclick: () => { close(); this.control('stop'); } }, 'Stop all work'))));
    });
  }
  openRedirect() {
    modal('Redirect the team', (body, close) => {
      const text = h('textarea', { rows: 4, maxlength: 4000, placeholder: 'Drop that. Instead, go and...', required: true, autofocus: true, 'aria-label': 'New instruction' });
      body.append(h('form.stack', { onsubmit: (e) => { e.preventDefault(); if (!text.value.trim()) return; close(); this.control('redirect', text.value); this.setTab('chat'); } },
        h('p.lede', {}, 'Open tasks get cancelled and the manager starts again from this.'), text,
        h('button.btn.primary.wide', { type: 'submit' }, 'Change course')));
    });
  }

  renderStaff() {
    this.renderPeek();
    clear(this.staffEl);
    for (const a of this.state.agents) {
      const busy = a.state !== 'idle';
      const waiting = !busy && a.role === 'manager' && this.state.helpWaiting > 0;
      this.staffEl.append(h(`button.staff-chip${busy ? '.busy' : ''}`, { type: 'button', role: 'listitem', 'data-agent': a.id, title: a.activity || STATE_LABEL[a.state] || '', onclick: () => this.openAgent(a) },
        this.face(a),
        h('span.staff-text', {}, h('small.staff-role', {}, a.title), h('b', {}, a.name), h('span.staff-state', {}, busy ? (STATE_LABEL[a.state] || a.state) : waiting ? 'Waiting on buddehbot' : 'At desk'), h('small.staff-now', {}, this.nowDoing(a) || (waiting ? 'is waiting on buddehbot' : 'At desk')))));
    }
  }
  nowDoing(a) { const task = a.taskId ? this.state.tasks.find((t) => t.id === a.taskId) : null; return task?.title || a.activity || (a.state === 'idle' ? '' : STATE_LABEL[a.state] || ''); }
  /** A person's file: their badge, who they are, what they're on, and for the boss what they remember. Empty fields just aren't there. */
  openAgent(person) {
    if (this.profileOpen) return;
    const a = this.state.agents.find((x) => x.id === person.id) || person;
    const f = this.state.floor;
    const busy = a.state !== 'idle';
    const task = a.taskId ? this.state.tasks.find((t) => t.id === a.taskId) : null;
    const now = task?.title || a.activity || '';
    const room = (id) => (id === 'manager' ? 'The manager\'s office' : String(id).replace(/^office-/, '').replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase()) + (String(id).startsWith('office-') ? '\'s office' : ''));
    const text = (v) => (typeof v === 'string' ? v.trim() : '');
    const row = (ic, title, kid) => h('section.file-row', {}, h('h3', {}, icon(ic), title), kid);
    const memory = Array.isArray(a.memory) ? a.memory.filter((m) => typeof m === 'string' && m.trim()) : [];
    this.profileOpen = true;
    modal(`${a.name}'s file`, (body, close) => {
      const bio = text(a.bio) || text(a.persona);
      body.append(h('div.profile', { 'data-profile': a.id },
        h('div.id-badge', {},
          h('div.id-band', { css: { '--brand': f.colors?.primary || 'var(--teal)' } }, `${f.name || 'The Office'} · Floor ${f.number}`),
          this.face(a), h('div.id-title', {}, a.title), h('div.id-name', {}, a.name),
          h(`div.id-state${busy ? '.busy' : ''}`, {}, busy ? (STATE_LABEL[a.state] || a.state) : 'At desk'),
          h('div.id-bars', { 'aria-hidden': 'true' })),
        h('div.file-rows', {},
          bio ? row('identification-badge', 'About', h('p', {}, bio)) : h('section.file-row.dim', {}, h('p', {}, `${a.name} hasn't filled in the staff form yet.`)),
          text(a.quirk) ? row('lightning', 'Quirk', h('p', {}, a.quirk)) : null,
          text(a.mood) ? row('sparkle', 'Mood', h('p', {}, a.mood)) : null,
          text(a.office) ? row('door-open', 'Office', h('p', {}, room(a.office))) : null,
          row('wrench', 'Working on', h('p', {}, now || 'Nothing right now. Free to take something on.')),
          this.owner && memory.length ? row('brain', 'What they remember', h('ul.memory-notes', {}, memory.slice(-12).reverse().map((m) => h('li', {}, m)))) : null,
          this.owner ? h('button.btn.primary', { type: 'button', 'data-profile-edit': a.id, onclick: () => { close(); this.openCustomise('staff', a.id); } }, icon('pencil-simple'), 'Change their look and job') : null)));
    }, { wide: true, onClose: () => { this.profileOpen = false; } });
  }

  tabsFor() {
    const s = this.state;
    const tabs = [];
    if (this.canSeeChat) tabs.push(['chat', this.owner ? 'Manager' : 'Chat']);
    if (businessActive(this)) tabs.push(['business', 'Business']);
    tabs.push(['talk', 'Talk'], ['work', 'Work'], ['tasks', 'Tasks'], ['projects', 'Projects']);
    if (this.owner) {
      const pending = (s.purchases || []).filter((p) => p.status === 'pending').length + (s.domainsOn ? (s.domains || []).filter((d) => d.status === 'awaiting_boss').length : 0) + serversPending(this) + (s.ios || []).filter((i) => i.status === 'awaiting_boss').length + mailPending(this) + payPending(this) + legalPending(this);
      tabs.push(mailTab(this));  // email: the boss's own Inbox (mail-ui.js)
      tabs.push(payTab(this));  // payments: connect Stripe, status, sales (pay-ui.js)
      tabs.push(['requests', pending ? `Requests ${pending}` : 'Requests']);
      tabs.push(['orders', 'Orders']);  // floors-plus: standing orders, after every existing tab
      const srv = serverTab(this); if (srv) tabs.push(srv);  // server slots (server-panel.js)
      tabs.push(['numbers', 'Numbers']);  // the company dashboard: boss-only (numbers-ui.js)
    }
    if (isPhone()) tabs.push(['about', 'About']);  // on a phone the company card lives in the sheet
    return tabs;
  }
  renderTabs() {
    clear(this.tabsEl);
    const tabs = this.tabsFor();
    // A phone’s row never cuts a label off: the first few tabs, then More, which opens right there to show the rest.
    const folded = isCompact() && tabs.length > PHONE_ROW + 1 ? tabs.slice(PHONE_ROW) : [];
    const shown = folded.length ? tabs.slice(0, PHONE_ROW) : tabs;
    const tabEl = ([id, label], over) => {
      const m = (id === 'requests' || id === 'inbox') && label.match(/\d+/);
      if (id === 'requests' && this.pinEls?.requests) { this.pinEls.requests.badge.hidden = !m; this.pinEls.requests.badge.textContent = m ? m[0] : ''; }
      return h(`button.tab${over ? '.overflow' : ''}${this.tab === id ? '.on' : ''}`, { type: 'button', role: 'tab', 'aria-selected': String(this.tab === id), 'data-tab': id, onclick: () => this.setTab(id) }, tabIcon(id), m ? label.replace(/\s*\d+$/, '') : label, m ? h('i.tab-count', {}, ` ${m[0]}`) : null);
    };
    this.tabsEl.append(...shown.map((t) => tabEl(t, false)));
    this.moreBtn = null;
    if (folded.length) {
      const here = folded.find(([id]) => id === this.tab);
      const count = folded.reduce((n, [id, label]) => n + (id === 'requests' || id === 'inbox' ? Number(label.match(/\d+/)?.[0] || 0) : 0), 0);
      this.moreBtn = h(`button.tab.more${here ? '.on' : ''}`, { type: 'button', 'data-tab-more': '', 'aria-expanded': String(!!this.moreOpen), onclick: () => this.setMore(!this.moreOpen) }, here ? tabIcon(here[0]) : icon('dots-three'), here ? here[1].replace(/\s*\d+$/, '') : 'More', count ? h('i.tab-count', {}, ` ${count}`) : null);
      this.tabsEl.append(this.moreBtn, h('div.more-pop', { 'data-more-pop': '' }, ...folded.map((t) => tabEl(t, true)),
        this.owner ? h('button.tab.overflow.action', { type: 'button', 'data-more-action': 'customise', onclick: () => { this.setMore(false); this.openCustomise(); } }, icon('paint-roller'), 'Customise') : '',
        h('button.tab.overflow.action', { type: 'button', 'data-more-action': 'lobby', onclick: () => window.officeGo('/') }, icon('elevator'), 'Lobby')));
    }
  }
  /** The phone’s More: the folded tabs open in place, under the row. */
  setMore(open) {
    if (open && isPhone() && this.sheet === 'peek') this.setSheet('half');
    this.moreOpen = !!open && !!this.moreBtn;
    this.tabsEl.classList.toggle('more-open', this.moreOpen);
    this.moreBtn?.setAttribute('aria-expanded', String(this.moreOpen));
  }
  setTab(id) {
    if (!this.tabsFor().some(([t]) => t === id)) return;
    this.setMore(false);
    this.tab = id;
    // First, so a list can scroll to its newest line.
    if (isPhone()) { if (!this.panelOpen || CHAT_TABS.has(id)) { this.panelOpen = true; this.sheet = this.openSize(); this.layout(); } }
    else if (!this.panelOpen) this.setPanel(true);
    this.renderTabs(); this.renderBody();
  }
  renderBody() {
    this.renderBanner();
    if (this.tab === 'business' && businessUnchanged(this)) return;
    if (this.staffEl.parentNode !== this.panel) this.panel.insertBefore(this.staffEl, this.tabsEl);  // Work borrows the strip on a phone
    this.chatFollow?.stop(); this.talkFollow?.stop(); this.chatFollow = this.talkFollow = null;
    clear(this.bodyEl);
    this.renderHead();
    this.bodyEl.ondragover = this.bodyEl.ondragleave = this.bodyEl.ondrop = null;
    this.bodyEl.dataset.surface = this.tab;
    if (this.tab === 'chat') this.renderChat();
    if (this.tab === 'about') this.bodyEl.append(this.cardEl);
    if (this.tab === 'talk') this.renderTalk();
    if (this.tab === 'work') this.renderWork();
    if (this.tab === 'tasks') this.renderTasks();
    if (this.tab === 'projects') this.renderProjects();
    if (this.tab === 'requests') this.renderRequests();
    if (this.tab === 'orders') this.renderOrders();
    if (this.tab === 'business') renderBusiness(this);
    if (this.tab === 'inbox') renderInbox(this);
    if (this.tab === 'servers') renderServers(this);
    if (this.tab === 'pay') renderPay(this);
    if (this.tab === 'numbers') renderNumbers(this);
  }
  /** The sheet’s title row on a phone: the manager on the phone, or the name of the tab. The size button sits at its right. */
  renderHead() {
    clear(this.headEl);
    if (!isPhone() || this.tab === 'chat') return;  // the chat brings its own, the intercom
    const label = (this.tabsFor().find(([id]) => id === this.tab)?.[1] || '').replace(/\s*\d+$/, '');
    this.headEl.append(h('div.sheet-title', {}, h('b', {}, label || 'Your floor'), this.tab === 'talk' ? h('small', {}, 'The team\'s group chat') : null));
  }
  /** One plain sentence for what’s going on here, and how far along when a job is running. */
  statusLine() {
    const s = this.state; const job = s.makers?.job; const steps = job?.steps || [];
    const counted = steps.filter((x) => x.state !== 'skipped');
    if (job && !job.launched && job.stage !== 'stopped' && counted.length) {
      const doing = steps.find((x) => x.state === 'doing');
      return { line: doing ? doing.label : job.launchable ? 'Ready when you are' : 'Getting started', pct: Math.round(counted.filter((x) => x.state === 'done').length / counted.length * 100) };
    }
    const busy = s.agents.filter((a) => a.state !== 'idle');
    if (busy.length) { const a = busy[0]; return { line: `${a.name}: ${this.nowDoing(a) || (STATE_LABEL[a.state] || 'working').toLowerCase()}${busy.length > 1 ? ` (and ${busy.length - 1} more)` : ''}`, pct: null }; }
    return { line: this.closedNow ? 'Closed for now' : `${this.manager?.name || 'Your manager'} is at the desk`, pct: null };
  }
  /** The newest thing said, for the resting sheet. */
  latestLine() {
    const m = (this.state.messages || []).at(-1);
    if (m) { const who = m.role === 'boss' ? this.state.floor.boss.name : this.state.agents.find((a) => a.id === m.agentId)?.name || this.manager?.name || 'Your manager'; return { who, person: m.role === 'boss' ? { ...this.state.floor.boss, boss: true } : this.person(m.agentId, who), text: m.text }; }
    const l = this.talkLines().at(-1);
    return l ? { who: l.fromName || 'Someone', person: this.person(l.from, l.fromName), text: l.text } : null;
  }
  /** What a resting sheet shows: what’s happening, the last word, and a clear way back to any options waiting. */
  renderPeek() {
    if (!this.peekEl) return;
    if (!isPhone()) { clear(this.peekEl); return; }
    const status = this.statusLine(), last = this.latestLine();
    const chips = this.owner ? (this.state.business?.active && this.state.business.chips?.length || 0) : 0;
    const plain = last?.text.replace(/[*_`#>\[\]]/g, '').replace(/\s+/g, ' ').trim();
    this.peekEl.replaceChildren(
      h('div.rest-status', {}, h('i.rest-dot'), h('b', {}, 'Right now'), status.pct === null ? '' : h('small', {}, `${status.pct}% done`)),
      h('p.rest-line', {}, status.line),
      last ? h('button.rest-latest', { type: 'button', 'data-rest-latest': '', 'aria-label': 'Open the conversation', onclick: () => this.setTab(this.canSeeChat ? 'chat' : 'talk') }, this.face(last.person), h('span', {}, h('b', {}, `${last.who}: `), plain), icon('caret-right')) : '',
      chips ? h('button.btn.soft.rest-reply', { type: 'button', 'data-rest-reply': '', onclick: () => this.setTab('chat') }, `Reply to ${this.manager?.name || 'your manager'} (${chips} options)`) : '');
    this.layout();
  }

  renderBanner() {
    const f = this.state.floor;
    let text = '';
    if (f.status === 'suspended') text = 'The building manager has closed this floor for now.';
    else if (f.globalPause) text = 'The building manager has paused all work.';
    else if (f.paused) text = f.pauseReason || 'This floor is paused.';
    else if (f.budgetStopped) text = 'Everyone has gone home for today. Work picks up again tomorrow.';
    else if (f.outOfBudget) text = 'Work has stopped for now. The building manager knows.';
    else if (this.closedNow) text = `Closed for now: everyone has gone home.${f.workMode.opensAt ? ` Back ${opensWhen(f.workMode.opensAt)}.` : ''}${this.owner ? ' You can still call your manager.' : ''}`;
    else if (this.catchUp) text = this.catchUp;
    this.bannerEl.textContent = text; this.bannerEl.hidden = !text;
  }

  // ---- chat ----
  renderChat() {
    const s = this.state;
    this.chatList = h('div.chat-list', { role: 'log', 'aria-live': 'polite' });
    for (const m of s.messages || []) this.chatList.append(this.messageEl(m));
    this.questionsEl = h('div.questions');
    this.renderQuestions();
    this.streamEl = h('div.msg.manager.streaming', { hidden: !this.streamBuf }, h('div.msg-body', {}, this.streamBuf));
    const mgr = this.manager;
    this.intercomEl = h('div.intercom', {},
      this.face(mgr),
      h('div.intercom-who', {}, h('b', {}, mgr?.name || 'Office Manager', mgr ? h('span.intercom-role', {}, mgr.title || 'Office Manager') : ''), h('small', {}, h('i'), this.streamBuf ? 'Talking…' : this.owner ? 'On the desk phone' : 'The boss\'s line')),
      h('div.intercom-grille', { 'aria-hidden': 'true' }));
    this.intercomEl.classList.toggle('on-air', !!this.streamBuf);
    // On a phone the recovery card sits in the conversation, so it scrolls with it rather than taking a fixed bite out of the page.
    const inList = isCompact() && this.recoveryCard();
    if (isPhone()) this.headEl.append(this.intercomEl);
    this.bodyEl.append(...(!inList && this.recoveryCard() ? [this.recoveryEl] : []), ...(isPhone() ? [] : [this.intercomEl]), this.chatList);
    if (inList) this.chatList.prepend(this.recoveryEl);
    // The launcher (public/js/launch-ui.js): three taps to a building team, then the maker card with Launch.
    this.lanesEl = this.isNewFloor() ? launchFlow(this) : makerCard(this);
    this.chatList.append(...(this.lanesEl ? [this.lanesEl] : []), this.questionsEl, this.streamEl);
    if (this.owner) {
      const input = h('textarea', { rows: 1, maxlength: 4000, placeholder: s.floor.setup ? 'What should this company be?' : `Tell ${this.manager?.name || 'your manager'} what you want...`, 'aria-label': 'Message your office manager', name: 'chat' });
      const tray = attachTray(this.slug, { onError: (m) => toast(m, 'bad') });
      const send = async () => {
        if (tray.busy()) await tray.wait();
        const text = input.value.trim(), attachments = tray.ids();
        if (!text && !attachments.length) return;
        input.value = ''; input.style.height = '';
        const body = attachments.length ? { text, attachments } : { text };
        try { await api(`/floors/${this.slug}/chat`, { method: 'POST', body }); tray.clear(); this.view?.bossTalks(); } catch (e) { input.value = text; toast(e.message, 'bad'); }
      };
      const picker = h('input', { type: 'file', multiple: true, accept: ACCEPT, hidden: true, onchange: () => { tray.add([...picker.files]); picker.value = ''; } });
      input.addEventListener('paste', (e) => { const files = [...(e.clipboardData?.files || [])]; if (files.length) { e.preventDefault(); tray.add(files); } });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
      input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = `${Math.min(120, input.scrollHeight)}px`; });
      const form = h('form.chat-input', { onsubmit: (e) => { e.preventDefault(); send(); } }, picker,
        h('button.btn.attach', { type: 'button', 'aria-label': 'Attach a photo or file', 'data-attach': '', onclick: () => picker.click() }, icon('paperclip')),
        input, h('button.btn.primary.send', { type: 'submit', 'aria-label': 'Send' }, icon('paper-plane-tilt')));
      const drop = this.bodyEl;
      drop.ondragover = (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); drop.classList.add('dropping'); } };
      drop.ondragleave = (e) => { if (e.target === drop) drop.classList.remove('dropping'); };
      drop.ondrop = (e) => { drop.classList.remove('dropping'); if (e.dataTransfer?.files?.length) { e.preventDefault(); tray.add([...e.dataTransfer.files]); } };
      const chips = chipsRow(this, { stay: true });
      if (chips) this.bodyEl.append(h('div.chat-chips', {}, chips));
      this.bodyEl.append(tray.el, form);
    } else {
      this.bodyEl.append(h('p.readonly-note', {}, 'Only the boss of this floor can talk to the manager.'));
    }
    this.chatFollow = followList(this.chatList, this.bodyEl, () => this.restChat());
    this.chatFollow.settle();
  }
  // ---- the three ways in ----
  isNewFloor() { return this.owner && this.state.floor.status === 'active' && !(this.state.messages || []).some((m) => m.role === 'boss') && !this.state.tasks.length; }
  lanePicker() {
    const buttons = LANES.map(([id, title, what, text]) => h('button.lane', { type: 'button', 'data-lane': id, onclick: async () => {
      for (const b of buttons) b.disabled = true;
      try { await api(`/floors/${this.slug}/chat`, { method: 'POST', body: { text } }); this.view?.bossTalks(); this.dropLanes(); } catch (e) { for (const b of buttons) b.disabled = false; toast(e.message, 'bad'); }
    } }, h('b', {}, title), h('span', {}, what)));
    return h('div.lanes', { role: 'group', 'aria-label': 'What should we start on?' },
      this.state.floor.setup ? h('div.setup-note', { 'data-setup': '' }, h('b', {}, 'No forms, no paperwork.'), h('span', {}, `Just tell ${this.manager?.name || 'your manager'} what you want to make. They'll name the company and get everyone moving.`)) : null,
      ...buttons,
      h('p.fineprint', {}, 'Your staff research, write, build and publish, and answer the company\'s email. Nobody here can post, run ads or spend money, and email to anyone new waits for your OK, so they will tell you what only you can do.'),
      this.state.floor.setup ? null : h('button.link.make-yours', { type: 'button', 'data-make-yours': '', onclick: () => this.openCustomise('vibe') }, 'First, make this office yours'));
  }
  // Only the launcher goes once the boss has spoken; a maker card stays with its job.
  /** The keys, handed over on arrival: the same one-time recovery code, on screen until the boss says it's saved, even across a redraw. */
  recoveryCard() {
    if (this.recoveryEl) return this.recoveryEl;
    const rec = session.pendingRecovery;
    if (!rec || rec.slug !== this.slug) return null;
    const card = h('div.recovery-card', { 'data-recovery-card': '' },
      h('p', {}, h('b', {}, 'The keys are yours.'), ' Keep this recovery code somewhere safe: it is the only way back in from another device, and it won\'t be shown again.'),
      recoveryBox(rec.code),
      h('button.btn.ghost', { type: 'button', 'data-recovery-done': '', onclick: () => { session.pendingRecovery = null; this.recoveryEl = null; card.remove(); this.chatFollow?.settle(); } }, 'I\'ve saved it'));
    return (this.recoveryEl = card);
  }
  dropLanes() { if (this.lanesEl && !this.lanesEl.matches('[data-maker]')) { this.lanesEl.remove(); this.lanesEl = null; } }
  messageEl(m) {
    const who = m.role === 'boss' ? this.state.floor.boss.name : m.role === 'help' ? 'buddehbot' : this.state.agents.find((a) => a.id === m.agentId)?.name || 'Office Manager';
    const body = h('div.msg-body');
    body.innerHTML = renderMarkdown(m.text); // renderMarkdown escapes all input first, and the CSP forbids inline script regardless
    // A report (launch report, standing-order report) or an answer from the help line is for the boss alone, and gets its own look.
    const cls = m.role === 'boss' ? 'boss' : m.role === 'office' || m.role === 'budget' ? 'manager.notice' : m.role === 'report' ? 'manager.report' : m.role === 'help' ? 'manager.help' : 'manager';
    const files = this.owner && m.attachments?.length ? h('div.msg-attachments', {}, ...m.attachments.map((a) => attachmentEl(this.slug, a))) : null;
    const face = m.role === 'boss' ? null : this.face(this.person(m.agentId, who) || this.manager);
    if (face) face.classList.add('msg-face');
    return h(`div.msg.${cls}`, { 'data-id': m.id, 'data-role': m.role }, face, h('span.msg-who', {}, who), body, files);
  }
  renderQuestions() {
    if (!this.questionsEl) return;
    clear(this.questionsEl);
    if (!this.owner) return;
    for (const q of this.state.questions || []) {
      const a = h('input', { placeholder: 'Your answer', maxlength: 4000, 'aria-label': `Answer ${q.agentName}` });
      this.questionsEl.append(h('form.question', { onsubmit: async (e) => {
        e.preventDefault();
        if (!a.value.trim()) return;
        try { await api(`/floors/${this.slug}/questions/${q.id}/answer`, { method: 'POST', body: { text: a.value } }); this.state.questions = this.state.questions.filter((x) => x.id !== q.id); this.renderQuestions(); } catch (x) { toast(x.message, 'bad'); }
      } }, h('span.q-who', {}, `${q.agentName} asks`), h('p', {}, q.text), h('div.row', {}, a, h('button.btn.primary', { type: 'submit' }, 'Answer'))));
    }
  }
  /** A new line in the chat, or the conversation redrawn: it follows along unless the boss has scrolled up to read. */
  scrollChat({ line = false, force = false } = {}) {
    const f = this.chatFollow; if (!f) return;
    if (force || f.pinned || Date.now() < (this.landUntil || 0)) { f.pinned = true; f.settle(); }
    else if (line) f.added();
  }
  /** Where the chat rests: the options on a brand-new floor, the step the team is on just after Go, otherwise the newest line. */
  restChat() {
    const list = this.chatList; if (!list) return;
    const l = list.getBoundingClientRect();
    // Right after Go the chat stays on the step the team is on, even as the first messages come in, instead of the bottom of the step list.
    const step = Date.now() < (this.landUntil || 0) ? list.querySelector('[data-step-state="doing"], [data-step-state="todo"]') : null;
    if (step) { const r = step.getBoundingClientRect(); list.scrollTop += r.top - l.top - (l.height - r.height) / 2; return; }
    if (this.recoveryEl && list.contains(this.recoveryEl)) { list.scrollTop = 0; return; }  // the keys come first
    const options = this.lanesEl?.matches?.('[data-launcher]') ? this.lanesEl : null;
    if (options) { const r = options.getBoundingClientRect(); list.scrollTop += r.height <= l.height ? r.bottom - l.bottom : r.top - l.top; return; }
    list.scrollTop = list.scrollHeight;
  }

  // ---- talk ----
  /** Everything people have said to each other, oldest first, with the words the server decided this viewer may read. */
  talkLines() {
    const lines = [...(this.state.talk || []), ...this.localTalk];
    return lines.sort((a, b) => (a.ts || 0) - (b.ts || 0)).slice(-140);
  }
  renderTalk() {
    const list = h('ol.talk-list', { role: 'log', 'aria-live': 'polite' });
    const lines = this.talkLines();
    if (!lines.length) list.append(h('li.empty', {}, 'Nobody has said anything yet. When work passes between people, their words show up here.'));
    lines.forEach((l, i) => list.append(this.talkEl(l, lines[i - 1])));
    this.talkLast = lines.at(-1);
    this.talkList = list;
    this.bodyEl.append(list);
    if (this.panelOpen) this.markTalkRead();
    this.talkFollow = followList(list, this.bodyEl, () => { list.scrollTop = list.scrollHeight; });
    this.talkFollow.settle();
  }
  /** One line of the group chat. The same speaker keeps talking without their face again, as in any office chat. */
  talkEl(l, prev) {
    const kind = TALK_KIND[l.beat || l.kind] ?? '';
    const who = this.person(l.from, l.fromName);
    const name = l.fromName || who?.name || 'Someone';
    const cont = prev && (prev.from || prev.fromName) === (l.from || l.fromName) && prev.toName === l.toName && (l.ts || 0) - (prev.ts || 0) < 180000 && !kind;
    return h(`li.talk-line.${l.kind || 'line'}${l.beat ? `.${l.beat}` : ''}${who?.boss ? '.boss' : ''}${cont ? '.cont' : ''}`, { 'data-kind': l.kind || '', 'data-beat': l.beat || '', 'data-talk': l.id || '' },
      this.face(who),
      h('div.talk-bubble', {},
        h('div.talk-who', { css: { '--who': this.nameInk(name) } }, h('b', {}, name), l.toName ? h('span.talk-to', {}, `to ${l.toName}`) : null, kind ? h('span.talk-kind', {}, kind) : null),
        h('p', {}, l.text),
        h('time', {}, timeAgo(l.ts))));
  }
  addTalkLine(l) {
    if (this.tab === 'talk' && this.talkList) {
      this.talkList.querySelector('.empty')?.remove();
      this.talkList.append(this.talkEl(l, this.talkLast));
      this.talkLast = l;
      this.talkFollow?.added();
    }
    if (this.tab === 'talk' && this.panelOpen) { this.markTalkRead(); return; }
    if (l.kind === 'small' || l.kind === 'banter') return;
    this.talkUnread = (this.talkUnread || 0) + 1;
    const b = this.pinEls?.talk?.badge;
    if (b) { b.hidden = false; b.textContent = String(Math.min(this.talkUnread, 99)); }
  }
  markTalkRead() { this.talkUnread = 0; const b = this.pinEls?.talk?.badge; if (b) b.hidden = true; }
  /** Small talk happens in this browser only. It isn't work, so it's kept here, not on the server, and never many of them. */
  addLocalTalk(line) {
    this.localTalk.push(line);
    if (this.localTalk.length > 12) this.localTalk.shift();
    this.addTalkLine(line);
  }

  // ---- work feed ----
  renderWork() {
    const list = h('ol.feed', { 'aria-live': 'polite' });
    const items = this.state.feed.slice(-120).reverse();
    for (const f of items) list.append(this.feedEl(f));
    if (!items.length) list.append(h('li.empty', {}, this.owner ? 'Nothing in the log yet. Call your manager and give them something to do.' : 'Nothing in the log yet. Nobody has started anything.'));
    this.feedList = list;
    this.bodyEl.append(list);
    if (isPhone()) this.bodyEl.append(this.teamBlock());
    // The boss's plan sits above the log (CSS order), so the log stays the first thing here and keeps its scroll on a reload.
    const plan = this.owner ? this.planCard() : null;
    if (plan) this.bodyEl.append(plan);
  }
  /** On a phone the Work tab leads with the people: what’s happening, a bar when a job is running, one row each, and Launch waiting at the end. */
  teamBlock() {
    const status = this.statusLine(), job = this.state.makers?.job;
    return h('section.team-now', { 'data-team-now': '' },
      h('small.team-company', {}, this.state.floor.name || 'Your company'),
      h('h3.team-status', {}, status.line),
      status.pct === null ? '' : h('div.team-bar', {}, h('i', { css: { width: `${status.pct}%` } })),
      this.staffEl,
      this.owner && job && !job.launched && job.stage !== 'stopped' ? h('div.launch-panel', { 'data-launch-panel': '' }, h('p', {}, h('b', {}, 'Waiting for you. '), job.launchable ? 'It\'s ready. It won\'t go live until you tap.' : 'Launch opens when the team is done. It won\'t go live until you tap.'), job.launchable ? h('button.btn.primary', { type: 'button', onclick: () => this.setTab('chat') }, 'Launch') : '') : '');
  }
  // ---- work modes: the plan the team works from on its own ----
  planCard() {
    const w = this.state.workPlan;
    if (!w) return null;
    const restart = async () => {
      try { await api(`/floors/${this.slug}/work-mode`, { method: 'POST', body: { mode: w.mode, days: w.dayList, start: w.start, end: w.end, tz: w.tz } }); toast('Back to work'); await this.reload(); } catch (e) { toast(e.message, 'bad'); }
    };
    const where = `${w.label}${w.days ? `, ${w.days}` : ''}`;
    const head = w.mode === 'ask' ? 'On call: the team works when you ask.' : w.paused ? `Paused: ${w.pausedReason}.` : w.needsGoal ? `${where}: waiting for a goal. Nothing starts on its own until there is one.` : `${where}: the team picks its own next job whenever the floor is quiet.`;
    // The goal comes first, then the next-up list that works toward it.
    const noGoal = w.mode === 'ask' ? 'None yet. Set one under Hours, or tell your manager.' : w.goalAsked ? 'Not set yet. Your manager has asked you in the chat: answer there, or set one under Hours.' : 'Not set yet. Your manager will ask you for one in the chat.';
    const reached = w.goalsReached || [];
    return h('section.work-plan', { 'data-plan': w.mode },
      h('div.plan-head', {}, h('b', {}, 'Working on our own'), h('button.link', { type: 'button', 'data-plan-hours': '', onclick: () => this.openCustomise('hours') }, 'Hours')),
      h('p.plan-mode', {}, head, w.paused ? h('button.btn.ghost', { type: 'button', 'data-plan-restart': '', onclick: restart }, 'Start again') : null),
      h(`p.plan-goal${w.needsGoal ? '.wanted' : ''}`, {}, h('span', {}, 'Goal'), w.goal || noGoal),
      w.nextUp.length ? h('div.plan-next', {}, h('span', {}, 'Next up'), h('ol', {}, ...w.nextUp.map((x) => h('li', {}, x)))) : null,
      reached.length ? h('p.plan-reached', {}, h('span', {}, 'Reached'), reached.map((g) => g.goal).join(' · ')) : null,
      w.lastJob?.summary ? h('p.plan-last', {}, h('span', {}, 'Last job'), w.lastJob.summary) : null);
  }
  feedEl(f) { return h('li', { 'data-feed': f.id || '' }, h('b', {}, f.name), ` ${f.text}`, h('time', {}, timeAgo(f.ts))); }

  // ---- tasks ----
  renderTasks() {
    const t = this.state.tasks;
    const board = h('div.board');
    const agents = this.state.agents;
    const help = this.helpSection();
    if (help) board.append(help);
    const norm = (x) => (x.status === 'blocked' ? 'doing' : x.status);
    for (const [key, title] of COLUMNS) {
      const col = t.filter((x) => norm(x) === key);
      if (!col.length && t.length && key !== 'todo') continue;  // an empty column is just bare cork
      const shown = key === 'done' ? col.slice(-12).reverse() : col;
      board.append(h('section.col', {}, h('h3', {}, title, h('span', {}, String(col.length))),
        ...shown.map((x) => h(`article.card.${x.status}`, {}, h('b', {}, x.title),
          h('small', {}, x.agentId ? this.face(agents.find((a) => a.id === x.agentId)) : null, h('span', {}, agents.find((a) => a.id === x.agentId)?.name || '', x.status === 'blocked' ? ' · waiting on the boss' : '')),
          this.owner && x.result ? h('p', {}, x.result.slice(0, 180)) : null))));
    }
    const failed = t.filter((x) => x.status === 'failed' || x.status === 'cancelled');
    if (failed.length) board.append(h('section.col', {}, h('h3', {}, 'Dropped', h('span', {}, String(failed.length))), ...failed.slice(-6).reverse().map((x) => h(`article.card.${x.status}`, {}, h('b', {}, x.title), h('small', {}, x.status === 'failed' ? 'Could not finish' : 'Cancelled')))));
    if (!t.length && !help) board.append(h('p.empty', {}, 'Nothing pinned up yet.'));
    this.bodyEl.append(board);
  }
  // The help line on the board. A visitor only learns that a question is out; the words are the boss's alone.
  helpSection() {
    const s = this.state;
    if (!this.owner) return s.helpWaiting ? h('section.col.help-col', {}, h('h3', {}, 'Help line'), h('article.card.help.pending', {}, h('b', {}, 'Asked buddehbot for help'), h('small', {}, 'Waiting for an answer. The team carries on meanwhile.'))) : null;
    if (!s.help?.length) return null;
    return h('section.col.help-col', {}, h('h3', {}, 'Help line', h('span', {}, String(s.help.filter((x) => x.status === 'pending').length))),
      ...s.help.map((x) => h(`article.card.help.${x.status}`, { 'data-help': x.id }, h('b', {}, 'Asked buddehbot for help'), h('p', {}, x.question), h('small', {}, HELP_STATUS[x.status] || x.status))));
  }

  // ---- projects ----
  renderProjects() {
    const s = this.state;
    const wrap = h('div.gallery');
    wrap.append(h('div.drawer-label', {}, `Projects · ${s.projects.length} ${s.projects.length === 1 ? 'folder' : 'folders'}`));
    if (!s.projects.length) wrap.append(h('p.empty', {}, 'The drawer is empty. When the staff ship something, its folder lands here.'));
    for (const p of s.projects) wrap.append(this.projectCard(p));
    this.bodyEl.append(wrap);
    if (this.owner && s.files?.length) {
      const list = h('ul.drive');
      for (const f of s.files) list.append(h('li', {}, h('button.link', { type: 'button', onclick: () => this.openFile(f.path) }, f.path), h('small', {}, `${Math.ceil(f.size / 1024)} KB`)));
      const used = s.storage ? `${(s.storage.used / 1048576).toFixed(1)} of ${Math.round(s.storage.quota / 1048576)} MB` : '';
      this.bodyEl.append(h('section.drive-wrap', {}, h('h3', {}, 'Shared drive', h('small', {}, used)), list));
    }
  }
  projectCard(p) {
    const KIND = { site: 'Site', doc: 'Doc', research: 'Research', app: 'App', game: 'Game', simulation: 'Simulation' };
    const open = () => this.openProject(p);
    const priv = this.owner ? h('label.toggle', {}, h('input', { type: 'checkbox', checked: p.private, 'aria-label': `Keep ${p.title} private`, onchange: async (e) => {
      try { await api(`/floors/${this.slug}/projects/${p.slug}`, { method: 'POST', body: { private: e.target.checked } }); p.private = e.target.checked; toast(p.private ? 'Hidden from visitors' : 'Visible to visitors'); } catch (x) { e.target.checked = !e.target.checked; toast(x.message, 'bad'); }
    } }), h('span', {}, 'Private')) : null;
    return h(`article.project.kind-${p.kind}`, { 'data-project': p.slug },
      h('span.kind', {}, KIND[p.kind] || p.kind), h('h3', {}, p.title), h('p', {}, p.description || ''),
      p.sources?.length ? h('small', {}, `${p.sources.length} ${p.sources.length === 1 ? 'source' : 'sources'}`) : null,
      p.domain ? h('small.live-domain', {}, p.domain) : null,
      this.owner ? this.launchBits(p) : null,
      h('div.row', {}, h('button.btn.primary', { type: 'button', onclick: open }, icon('folder-open'), 'Open'), priv,
        this.owner && p.appUrl ? h('button.link', { type: 'button', onclick: async () => {
          if (!window.confirm(`Delete every save, account, leaderboard, document, upload, shared value and sign-up for ${p.title}? This can't be undone. Download your sign-ups first if you want them.`)) return;
          try { const r = await api(`/floors/${this.slug}/projects/${p.slug}/clear-data`, { method: 'POST', body: {} }); toast(`Cleared ${r.removed} saved ${r.removed === 1 ? 'item' : 'items'}`); } catch (e) { toast(e.message, 'bad'); }
        } }, 'Clear saved data') : null));
  }
  async openProject(p) {
    let url = p.appUrl || p.url;
    if (p.private) { try { url = (await api(`/floors/${this.slug}/projects/${p.slug}/preview`)).url; } catch (e) { toast(e.message, 'bad'); return; } }
    this.previewProject(p, url);
  }
  // The product side of a card, for the boss: who came, who signed up, how money comes in, and what the checklist said.
  launchBits(p) {
    const box = h('div.launch-bits');
    const c = p.launchCheck;
    if (c) {
      const problems = (c.errors?.length || 0) + (c.claims?.length || 0);
      box.append(h(`small.check.${problems ? 'bad' : c.warnings?.length ? 'warn' : 'ok'}`, {}, problems ? `Checklist: ${problems} to look at` : c.warnings?.length ? `Checklist: ${c.warnings.length} rough edges` : 'Checklist passed'));
    }
    if (p.designReview) box.append(h('small', {}, `Design review: ${p.designReview.verdict}`));
    box.append(h('div.row', {},
      h('button.link', { type: 'button', 'data-stats': p.slug, onclick: () => this.openStats(p) }, 'Visitors'),
      p.appUrl ? h('button.link', { type: 'button', 'data-cloud': p.slug, onclick: () => this.openCloud(p) }, 'Backend') : null,
      // Forms need the project's own web address, and a document has nowhere to put a Buy button. Neither gets a button that goes nowhere.
      p.appUrl || p.signups ? h('button.link', { type: 'button', 'data-signups': p.slug, onclick: () => this.openSignups(p) }, `Sign-ups${p.signups ? ` (${p.signups})` : ''}`) : null,
      p.kind !== 'doc' && p.kind !== 'research' ? h('button.link', { type: 'button', 'data-pay': p.slug, onclick: () => this.openPayment(p) }, p.hasPayment ? 'Payment link: on' : 'Add payment link') : null,
      c || p.launchReport ? h('button.link', { type: 'button', onclick: () => this.openChecklist(p) }, 'Report') : null));
    return box;
  }
  async openStats(p) {
    try {
      const s = await api(`/floors/${this.slug}/projects/${p.slug}/stats`);
      modal(`Visitors: ${p.title}`, (body) => {
        const max = Math.max(1, ...s.byDay.map((d) => d.views));
        body.append(h('div.stack', {},
          h('p.lede', {}, `${s.uniques} visitors and ${s.views} page views in the last ${s.days} days. Counted by this building, with no cookies and no outside service.`),
          s.byDay.length ? h('div.bars', { role: 'img', 'aria-label': 'Page views by day' }, ...s.byDay.map((d) => h('i', { title: `${d.day}: ${d.views}`, css: { height: `${Math.max(4, (d.views / max) * 100)}%` } }))) : null,
          s.pages.length ? h('div', {}, h('h3', {}, 'Pages'), ...s.pages.map((x) => h('p.kv', {}, h('span', {}, x.path), h('b', {}, String(x.views))))) : null,
          s.refs.length ? h('div', {}, h('h3', {}, 'Came from'), ...s.refs.map((x) => h('p.kv', {}, h('span', {}, x.ref), h('b', {}, String(x.n))))) : null,
          p.appUrl ? h('label.toggle', {}, h('input', { type: 'checkbox', checked: p.indexable || !!p.domain, disabled: !!p.domain, onchange: async (e) => { try { await api(`/floors/${this.slug}/projects/${p.slug}/indexable`, { method: 'POST', body: { on: e.target.checked } }); p.indexable = e.target.checked; } catch (x) { e.target.checked = !e.target.checked; toast(x.message, 'bad'); } } }), h('span', {}, p.domain ? 'Search engines can find it, because it has its own domain' : 'Let search engines find it')) : null));
      });
    } catch (e) { toast(e.message, 'bad'); }
  }
  // Office Cloud, the backend the project's pages use. Counts only: the boss sees how much, never anyone's data or password.
  async openCloud(p) {
    try {
      const { projects } = await api(`/floors/${this.slug}/cloud`);
      const u = projects.find((x) => x.slug === p.slug);
      if (!u) throw new Error('This project is not published yet.');
      const s = u.usage; const size = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);
      const row = (label, value) => h('p.kv', {}, h('span', {}, label), h('b', {}, String(value)));
      const count = (n) => Number(n).toLocaleString();
      const meter = (label, used, cap) => h('div', {}, row(label, `${size(used)} of ${size(cap)}`), h('div.meter', { role: 'img', 'aria-label': `${label}: ${Math.round((used / cap) * 100)}% used` }, h('i', { css: { width: `${Math.min(100, Math.max(1, (used / cap) * 100))}%` } })));
      modal(`Backend: ${p.title}`, (body) => {
        body.append(h('div.stack', {},
          h('p.lede', {}, 'Saves, accounts, leaderboards, multiplayer rooms, uploads, AI and reading web pages, built in. These are counts only: nobody here can see what people saved or their passwords. Ask your manager to use it in a game or site.'),
          row('Accounts', s.users), row('Documents', `${s.docs} in ${s.collections} ${s.collections === 1 ? 'collection' : 'collections'}`), row('Saves', s.saves),
          row('Leaderboard scores', `${s.scores} on ${s.boards} ${s.boards === 1 ? 'board' : 'boards'}`), row('Uploads', s.files),
          row('Playing right now', `${u.live.players} in ${u.live.rooms} ${u.live.rooms === 1 ? 'room' : 'rooms'}`), row('Requests today', s.requestsToday),
          meter('Data', s.bytes, s.limits.bytes), meter('Uploads', s.fileBytes, s.limits.fileBytes),
          this.powerSwitch(p, 'ai', 'AI features', u.powers.ai, [row('AI requests today', u.powers.ai.callsToday), row('Quick AI left today', `${count(u.powers.ai.fastLeft)} of ${count(u.powers.ai.fastPerDay)} tokens`), row('Smart AI left today', `${count(u.powers.ai.smartLeft)} of ${count(u.powers.ai.smartPerDay)} tokens`)]),
          this.powerSwitch(p, 'fetch', 'Reading web pages', u.powers.fetch, [row('Pages read today', u.powers.fetch.fetchedToday), row('Pages left today', `${count(u.powers.fetch.left)} of ${count(u.powers.fetch.perDay)}`)])));
      });
    } catch (e) { toast(e.message, 'bad'); }
  }
  // On by default: a boss only comes here to turn one off. Counts and what's left, nothing about what it costs.
  powerSwitch(p, kind, label, state, rows) {
    return h('div', {},
      h('h3', {}, label),
      h('label.toggle', {}, h('input', { type: 'checkbox', checked: state.on, 'data-power': kind, onchange: async (e) => {
        const on = e.target.checked;
        try { await api(`/floors/${this.slug}/cloud/${p.slug}/powers`, { method: 'POST', body: { [kind]: on } }); toast(on ? `${label}: on` : `${label}: off`); } catch (err) { e.target.checked = !on; toast(err.message, 'bad'); }
      } }), h('span', {}, 'Let this site use it')),
      state.paused ? h('p', {}, 'Paused for now by the building.') : null,
      ...rows);
  }
  async openSignups(p) {
    try {
      const { entries } = await api(`/floors/${this.slug}/projects/${p.slug}/forms`);
      modal(`Sign-ups: ${p.title}`, (body) => {
        // Written by strangers, so text nodes only. Your staff never see these, only how many there are.
        const keys = [...new Set(entries.flatMap((e) => Object.keys(e.fields)))];
        body.append(h('div.stack', {},
          entries.length ? h('a.btn.ghost', { href: `${BASE}/api/floors/${this.slug}/projects/${p.slug}/forms?format=csv`, download: `${p.slug}-signups.csv` }, 'Download a spreadsheet') : h('p.empty', {}, 'Nobody yet. When someone fills in a form on the site, it lands here.'),
          entries.length > 500 ? h('p', {}, `Showing the newest 500 of ${entries.length}. The spreadsheet has them all.`) : null,
          entries.length ? h('div.table-wrap', {}, h('table.admin-table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Form'), ...keys.map((k) => h('th', {}, k)), h('th', {}, 'When'))), h('tbody', {}, entries.slice(0, 500).map((e) => h('tr', {}, h('td', {}, e.form), ...keys.map((k) => h('td', {}, String(e.fields[k] ?? ''))), h('td', {}, timeAgo(e.createdAt))))))) : null));
      }, { wide: true });
    } catch (e) { toast(e.message, 'bad'); }
  }
  openPayment(p) {
    modal('Take payments', (body, close) => {
      const input = h('input', { type: 'url', placeholder: 'https://buy.stripe.com/...', 'aria-label': 'Stripe Payment Link', name: 'payment' });
      body.append(h('form.stack', { onsubmit: async (e) => {
        e.preventDefault();
        try { await api(`/floors/${this.slug}/projects/${p.slug}/payment`, { method: 'POST', body: { link: input.value.trim() } }); toast(input.value.trim() ? 'Payment link saved' : 'Payment link removed'); close(); this.reload(); } catch (x) { toast(x.message, 'bad'); }
      } }, h('p.lede', {}, 'Make a Payment Link in your own Stripe account and paste it here. Customers pay on Stripe\'s page and the money goes to you. The staff only get a button that points at it, so ask your manager to add one once this is saved. No keys and no card numbers ever come through here.'),
      p.hasPayment ? h('p', {}, 'A link is set. Paste a new one to replace it, or save this empty to remove it.') : null, input,
      h('button.btn.primary.wide', { type: 'submit' }, 'Save')));
    });
  }
  openChecklist(p) {
    const c = p.launchCheck || {};
    modal(`Launch: ${p.title}`, (body) => {
      const sec = (title, items) => (items?.length ? h('div', {}, h('h3', {}, title), h('ul', {}, ...items.map((x) => h('li', {}, x)))) : null);
      const d = h('div.doc');
      if (p.launchReport) d.innerHTML = renderMarkdown(p.launchReport);
      body.append(h('div.stack', {}, p.launchReport ? d : null, sec('Must fix', c.errors), sec('Possibly invented: please check', c.claims), c.reason ? h('p', {}, `The team's reason: ${c.reason}`) : null, sec('Rough edges', c.warnings), sec('Passed', c.passed), p.designReview ? h('div', {}, h('h3', {}, `Design review (${p.designReview.model})`), h('p', { css: { 'white-space': 'pre-wrap' } }, p.designReview.text)) : null));
    }, { wide: true });
  }
  previewProject(p, url) {
    modal(p.title, (body) => {
      // In sandbox mode the server's CSP is the real boundary and this attribute is a second lock on the same door.
      // A project on its own origin needs allow-same-origin to keep its saves; that origin is already separate from this page.
      const own = !!p.appUrl;
      body.append(h('iframe.site-frame', { src: url, title: p.title, sandbox: own ? 'allow-scripts allow-forms allow-popups allow-same-origin allow-pointer-lock allow-modals' : 'allow-scripts allow-forms allow-popups', referrerpolicy: 'no-referrer' }),
        h('p.frame-foot', {}, h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, 'Open in a new tab')));
    }, { wide: true });
  }
  async openFile(path) {
    try {
      const r = await api(`/floors/${this.slug}/files/${b64url(path)}`);
      modal(r.path, (body) => {
        if (r.html !== null) { const d = h('div.doc'); d.innerHTML = r.html; body.append(d); } else body.append(h('pre.code', {}, r.text));
      }, { wide: true });
    } catch (e) { toast(e.message, 'bad'); }
  }

  // ---- requests ----
  renderDomains(list) {
    const DOMAIN_STATUS = { awaiting_boss: 'Waiting for you', buying: 'Buying now', sent: 'Confirming with the registrar', uncertain: 'The building manager is checking', bought: 'Bought, setting its address', live: 'Live', declined: 'You said no', failed: 'Not bought' };
    for (const d of this.state.domains || []) {
      const waiting = d.status === 'awaiting_boss' && this.state.domainsOn;
      const buy = async () => {
        try { await api(`/floors/${this.slug}/domains/${d.id}/buy`, { method: 'POST', body: { priceUsd: d.priceUsd } }); sfx('stamp'); toast(`Buying ${d.domain}`); this.reload(); } catch (e) { toast(e.message, 'bad'); this.reload(); }
      };
      const no = async () => { try { await api(`/floors/${this.slug}/domains/${d.id}/decline`, { method: 'POST', body: {} }); this.reload(); } catch (e) { toast(e.message, 'bad'); } };
      list.append(h(`article.card.request.domain.${d.status}`, { 'data-domain': d.domain },
        h('div.row.spread', {}, h('b', {}, d.domain), h('span.price', {}, money(d.chargedUsd ?? d.priceUsd))),
        d.why ? h('p', {}, d.why) : null,
        h('small', {}, `For ${d.project} · ${DOMAIN_STATUS[d.status] || d.status}`),
        d.note ? h('p.domain-note', {}, d.note) : null,
        d.status === 'live' ? h('p', {}, h('a', { href: `https://${d.domain}/`, target: '_blank', rel: 'noopener noreferrer' }, `https://${d.domain}/`)) : null,
        waiting ? h('div.row', {}, h('button.btn.primary', { type: 'button', 'data-buy': d.domain, onclick: buy }, `Buy for ${money(d.priceUsd)}`), h('button.btn.ghost', { type: 'button', onclick: no }, 'No thanks')) : null,
        waiting ? h('p.fineprint', {}, 'One year, with WHOIS privacy on. It is registered in the building\'s name and paid from the building\'s Namecheap balance.') : null));
    }
    for (const r of this.state.ios || []) {
      const answer = async (a) => { try { await api(`/floors/${this.slug}/ios/${r.id}/${a}`, { method: 'POST', body: {} }); this.reload(); } catch (e) { toast(e.message, 'bad'); } };
      list.append(h('article.card.request', {}, h('b', {}, r.kind === 'submit' ? `Send ${r.project} to TestFlight` : `Build the iPhone app for ${r.project}`), h('small', {}, r.status === 'awaiting_boss' ? 'Waiting for you' : r.status),
        r.status === 'awaiting_boss' ? h('div.row', {}, h('button.btn.primary', { type: 'button', onclick: () => answer('approve') }, 'Allow it'), h('button.btn.ghost', { type: 'button', onclick: () => answer('decline') }, 'No thanks')) : null));
    }
  }
  renderRequests() {
    const list = h('div.requests');
    const items = this.state.purchases || [];
    this.renderDomains(list);
    renderMailRequests(this, list);  // email to someone new, waiting for the boss's OK
    renderServerRequests(this, list);  // a server slot, waiting for the boss's OK
    renderPayRequests(this, list);  // a product and price the team proposed, waiting for the boss's tap
    renderLegalRequests(this, list);  // the Lawyer's drafts and facts, waiting for the boss's tap (legal-ui.js)
    if (!items.length && !(this.state.domains || []).length && !(this.state.ios || []).length && !mailPending(this) && !serversPending(this) && !payPending(this) && !legalPending(this)) list.append(h('p.empty', {}, this.state.domainsOn ? 'No requests. Staff can ask, but only you can say yes.' : 'No requests. Staff can ask for things here, but they can\'t buy anything.'));
    for (const p of items) {
      const setStatus = async (status) => { try { await api(`/floors/${this.slug}/purchases/${p.id}`, { method: 'POST', body: { status } }); p.status = status; sfx('stamp'); this.renderTabs(); this.renderBody(); } catch (e) { toast(e.message, 'bad'); } };
      list.append(h(`article.card.request.${p.status}`, {},
        h('div.row.spread', {}, h('b', {}, p.item), h('span.price', {}, money(p.price))),
        h('p', {}, p.why), h('small', {}, `${p.agentName || 'Staff'} · ${{ pending: 'With the building manager', declined: 'Declined', 'bought-myself': 'You bought it yourself', bought: 'The building manager bought it', rejected: 'The building manager said no' }[p.status] || p.status}${p.adminNote ? `: ${p.adminNote}` : ''}`),
        p.link ? h('p', {}, h('a', { href: safeHref(p.link), target: '_blank', rel: 'noopener noreferrer nofollow' }, 'See the link')) : null,
        p.status === 'pending' ? h('div.row', {}, h('button.btn.ghost', { type: 'button', onclick: () => setStatus('bought-myself') }, 'I bought it myself'), h('button.btn.ghost', { type: 'button', onclick: () => setStatus('declined') }, 'Decline')) : null));
    }
    list.append(h('p.fineprint', {}, this.state.domainsOn ? 'Staff can\'t spend money. A domain needs your click. Anything else goes to the building manager to decide.' : 'Staff can\'t spend money. Anything they ask for goes to the building manager to decide.'));
    this.bodyEl.append(list);
  }

  // ---- standing orders (floors-plus) ----
  async refreshOrders() {
    try {
      const r = await api(`/floors/${this.slug}/orders`);
      if (this.dead) return;
      this.state.orders = r.orders; this.state.orderLimits = r.limits;
      if (this.tab === 'orders') this.renderBody();
    } catch { /* the next full reload brings it */ }
  }
  renderOrders() {
    const orders = this.state.orders || []; const lim = this.state.orderLimits || {};
    const wrap = h('div.orders', { 'data-orders': String(orders.length) });
    wrap.append(h('p.lede', {}, `Standing orders run on their own while you're away, through the same manager and staff as anything you ask for in chat. ${lim.perFloor ? `Up to ${lim.perFloor} per floor, at` : 'At'} most once a day.`));
    if (!orders.length) wrap.append(h('p.empty', {}, 'No standing orders yet. Set one below, or ask your manager for something "every morning".'));
    for (const o of orders) wrap.append(this.orderCard(o));
    if (!lim.perFloor || orders.length < lim.perFloor) wrap.append(this.orderForm());
    wrap.append(h('p.fineprint', {}, `An order waits while the floor is busy or paused. It pauses itself ${lim.maxFails ? `after ${lim.maxFails} failed runs in a row, or ` : ''}if you haven't opened the floor in ${lim.idleDays ?? 14} days; opening it switches ${lim.maxFails ? 'those' : 'it'} back on.`));
    this.bodyEl.append(wrap);
  }
  orderCard(o) {
    const act = async (path, body, okText) => {
      try { await api(`/floors/${this.slug}/orders/${o.id}${path}`, { method: 'POST', body: body || {} }); if (okText) toast(okText); await this.refreshOrders(); } catch (e) { toast(e.message, 'bad'); }
    };
    const cls = o.running ? 'running' : o.status;
    const statusText = o.running ? 'Running now' : o.status === 'paused' ? (o.pauseReason || 'Paused') : 'Active';
    const last = o.history.find((r) => r.status !== 'running');
    return h(`article.order.${cls}`, { 'data-order': o.id, 'data-status': o.status },
      h('p.order-text', {}, o.text),
      h('span.order-status', {}, statusText),
      h('div.order-meta', {},
        h('span', {}, h('b', {}, o.scheduleText)),
        h('span', {}, o.status === 'active' ? `Next run ${timeUntil(o.nextRunAt)}` : 'Not scheduled while paused'),
        last ? h('span', {}, `Last run ${timeAgo(last.startedAt)}${last.status === 'failed' ? ', did not finish' : ''}`) : h('span', {}, 'Not run yet')),
      h('div.order-acts', {},
        o.status === 'active'
          ? h('button.btn.ghost', { type: 'button', 'data-pause': o.id, onclick: () => act('', { status: 'paused' }, 'Paused') }, 'Pause')
          : h('button.btn.ghost', { type: 'button', 'data-resume': o.id, onclick: () => act('', { status: 'active' }, 'Back on') }, 'Resume'),
        h('button.btn.ghost', { type: 'button', 'data-edit': o.id, onclick: () => this.editOrder(o) }, 'Edit'),
        h('button.btn.ghost', { type: 'button', 'data-run': o.id, disabled: o.running, onclick: () => act('/run', {}, 'Started. The report lands in the chat when it is done.') }, 'Run now'),
        h('button.btn.ghost', { type: 'button', 'data-delete': o.id, onclick: () => { if (window.confirm('Delete this standing order? Its run history goes with it.')) act('/delete', {}, 'Deleted'); } }, 'Delete')),
      o.history.length ? h('details.order-history', {}, h('summary', {}, `Last ${o.history.length} ${o.history.length === 1 ? 'run' : 'runs'}`), h('ul.order-runs', {}, ...o.history.map((r) => this.orderRun(r)))) : null);
  }
  orderRun(r) {
    const doc = h('div.doc');
    if (r.report) doc.innerHTML = renderMarkdown(r.report); // renderMarkdown escapes its input, and the CSP forbids inline script regardless
    const label = r.status === 'running' ? 'running' : r.status === 'done' ? 'done' : 'did not finish';
    return h(`li.order-run.${r.status}`, { 'data-run': r.id }, h('small', {}, `${new Date(r.startedAt).toLocaleString()} · ${label}`), r.report ? doc : h('span', {}, 'Working on it...'));
  }
  // The schedule controls, shared by the new-order form and the edit dialog. read() gives the body the API wants.
  orderFields(draft = {}) {
    const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const s = draft.schedule || {};
    const text = h('textarea', { rows: 3, maxlength: 2000, placeholder: 'Every morning, write a short post about something we learned yesterday and publish it.', 'aria-label': 'What to do', name: 'order' }, draft.text || '');
    const every = h('select', { 'aria-label': 'How often', name: 'every' }, h('option', { value: 'day', selected: s.every !== 'week' }, 'Every day'), h('option', { value: 'week', selected: s.every === 'week' }, 'Every week'));
    const weekday = h('select', { 'aria-label': 'Weekday', name: 'weekday' }, ...WEEKDAYS.map((d, i) => h('option', { value: String(i), selected: (s.weekday ?? 1) === i }, d)));
    const dayWrap = h('label', { hidden: s.every !== 'week' }, h('span', {}, 'On'), weekday);
    every.addEventListener('change', () => { dayWrap.hidden = every.value !== 'week'; });
    const at = h('input', { type: 'time', value: s.at || '09:00', required: true, 'aria-label': 'Time', name: 'at' });
    const tz = h('input', { value: s.tz && s.tz !== 'UTC' ? s.tz : '', placeholder: 'UTC', maxlength: 64, 'aria-label': 'Time zone', name: 'tz' });
    const el = h('div.order-when', {}, h('label', {}, h('span', {}, 'How often'), every), dayWrap, h('label', {}, h('span', {}, 'At'), at), h('label', {}, h('span', {}, 'Time zone'), tz));
    return { text, el, read: () => ({ text: text.value, schedule: { every: every.value, at: at.value, weekday: Number(weekday.value), tz: tz.value.trim() || undefined } }) };
  }
  orderForm() {
    const f = this.orderFields();
    const submit = async (e) => {
      e.preventDefault();
      const body = f.read();
      if (body.text.trim().length < 3) { toast('Say what the staff should do.', 'bad'); return; }
      try { await api(`/floors/${this.slug}/orders`, { method: 'POST', body }); toast('Standing order set'); await this.refreshOrders(); } catch (x) { toast(x.message, 'bad'); }
    };
    return h('section.order-new', { 'data-orders-form': '' }, h('h3', {}, 'New standing order'),
      h('form.order-form', { onsubmit: submit }, f.text, f.el, h('button.btn.primary', { type: 'submit' }, 'Set it up')));
  }
  editOrder(o) {
    modal('Edit standing order', (body, close) => {
      const f = this.orderFields(o);
      body.append(h('form.stack.order-form', { onsubmit: async (e) => {
        e.preventDefault();
        try { await api(`/floors/${this.slug}/orders/${o.id}`, { method: 'POST', body: f.read() }); toast('Saved'); close(); await this.refreshOrders(); } catch (x) { toast(x.message, 'bad'); }
      } }, h('label.field', {}, h('span', {}, 'What to do'), f.text), f.el, h('button.btn.primary.wide', { type: 'submit' }, 'Save')));
    });
  }

  // ---- customise ----
  openCustomise(tab = 'vibe', agentId) { openCustomisePanel(this, tab, agentId); }
  /** Shows a draft of the office without saving it. Staff, tasks and everything else stay live, and Cancel puts the real one back. */
  previewRoom(decor, colors) {
    this.preview = { decor, colors };
    this.applyBrand();
    if (stage.ok && this.view) this.rebuildScene();
  }
  clearPreview({ rebuild = true } = {}) {
    if (!this.preview) return;
    this.preview = null;
    this.applyBrand();
    if (rebuild && stage.ok && this.view) this.rebuildScene();
  }
  viewState() { return this.preview ? { ...this.state, floor: { ...this.state.floor, decor: this.preview.decor, colors: this.preview.colors } } : this.state; }

  // ---- live ----
  connect() {
    let first = true;
    const since = this.state.lastEventId;
    this.es = new EventSource(`${BASE}/api/floors/${this.slug}/stream?since=${since}`);
    this.es.onopen = () => { if (!first) this.reload(); first = false; };
    const on = (type, fn) => this.es.addEventListener(type, (e) => { if (this.dead) return; let d; try { d = JSON.parse(e.data); } catch { return; } fn(d); });
    on('agent', (d) => {
      const a = this.state.agents.find((x) => x.id === d.id);
      if (a) { a.state = d.state; a.activity = d.activity; a.taskId = d.taskId; }
      this.view?.agentEvent(d);
      this.renderStaff(); this.renderHeader(); this.renderBanner(); this.cardSoon();
    });
    on('feed', (d) => {
      const item = { id: d._id, name: d.name, text: d.text, ts: d.ts };
      if (item.id && this.seen.has(item.id)) return;
      if (item.id) this.seen.add(item.id);
      if (this.state.feed.some((f) => f.id === item.id)) return;
      this.state.feed.push(item);
      if (this.state.feed.length > 200) this.state.feed.shift();
      if (this.tab === 'work' && this.feedList) { this.feedList.querySelector('.empty')?.remove(); this.feedList.prepend(this.feedEl(item)); }
      this.cardSoon();
    });
    // The words themselves: the same line goes in the Talk tab and over the speaker's head.
    on('talk', (d) => {
      const line = { id: d._id, from: d.from, to: d.to, fromName: d.fromName, toName: d.toName, text: d.text, kind: d.kind, beat: d.beat, ts: d._ts || d.ts };
      this.state.talk ||= [];
      if (line.id && this.state.talk.some((l) => l.id === line.id)) return;
      this.state.talk.push(line);
      if (this.state.talk.length > 200) this.state.talk.shift();
      this.addTalkLine(line);
      if (fresh(d)) this.view?.life?.line(line);  // the room reads the beat and the kind apart: a meeting walks over, banter is small talk
    });
    on('task', (d) => {
      const i = this.state.tasks.findIndex((t) => t.id === d.id);
      if (i >= 0) this.state.tasks[i] = { ...this.state.tasks[i], ...d }; else this.state.tasks.push(d);
      // A page can stay open through any number of tasks. The oldest finished one goes first, and the board only ever shows the last few of those.
      if (this.state.tasks.length > 300) { const old = this.state.tasks.findIndex((t) => ['done', 'failed', 'cancelled'].includes(t.status)); if (old >= 0) this.state.tasks.splice(old, 1); }
      this.view?.updateBoard(this.state.tasks);
      if (this.tab === 'tasks') this.renderBody();
    });
    on('token', (d) => { this.streamBuf += d.text; this.showStream(); });
    on('token_reset', () => { this.streamBuf = ''; this.showStream(); });
    on('message', (d) => {
      if (!this.state.messages) return;
      if (this.state.messages.some((m) => m.id === d.id)) return;
      const m = { id: d.id, role: d.role, agentId: d.agentId, text: d.text, createdAt: d.createdAt, ...(Array.isArray(d.attachments) ? { attachments: d.attachments } : {}) };
      this.state.messages.push(m);
      if (d.role === 'manager') { this.streamBuf = ''; this.showStream(); }
      if (d.role === 'boss') this.dropLanes();
      if (this.tab === 'chat' && this.chatList) { this.chatList.insertBefore(this.messageEl(m), this.lanesEl || this.questionsEl); this.scrollChat({ line: true, force: d.role === 'boss' }); }
      this.renderPeek();
      // floors-plus: a report means an order ran, so the Orders tab and its history are stale.
      if (d.role === 'report') { if (this.tab !== 'chat') toast('A report from your manager is in the chat'); if (this.owner) this.refreshOrders(); }
    });
    on('orders', () => { if (this.owner) this.refreshOrders(); });
    // Work modes: the sign, the hours and the plan.
    on('work_mode', () => this.reload());
    on('work_plan', () => { if (this.owner) this.reload(); });
    on('business', () => this.reload());
    on('ad_spend', () => { if (this.owner) this.reload(); });
    on('help_state', (d) => {
      this.state.helpWaiting = d.waiting;
      // A small touch: the manager picks up the phone. The boss's page reloads for the words, and a visitor only ever has the count.
      if (d.call && fresh(d)) this.view?.phoneCall(d.call);
      if (this.owner) this.reload();
      else { this.renderStaff(); if (this.tab === 'tasks') this.renderBody(); }
    });
    on('question', () => this.reload());
    on('question_answered', () => this.reload());
    on('purchase', () => { this.reload(); toast('A purchase request has gone to the building manager'); });
    let lastWaiting = (this.state.domains || []).filter((d) => d.status === 'awaiting_boss').length;
    on('domain', async () => { await this.reload(); const n = (this.state.domains || []).filter((d) => d.status === 'awaiting_boss').length; if (n > lastWaiting) toast('A domain is waiting for your OK under Requests'); lastWaiting = n; });
    on('hired', () => this.reload());
    on('mail', (d) => onMailEvent(this, d));
    on('pay', () => { this.reload(); });
    on('sitechat', (d) => onChatEvent(this, d));
    on('reload', () => this.reload());
    on('floor', (d) => {
      if (d.status === 'gone') { toast('This floor has been closed.'); window.officeGo('/'); return; }
      // The manager has just named the company, or repainted it: the plaque, the signs and the room all follow, without leaving the conversation.
      const f = this.state.floor;
      const changed = ['name', 'tagline', 'colors', 'decor', 'logoUrl'].some((k) => k in d && JSON.stringify(d[k]) !== JSON.stringify(f[k]));
      if (changed) { this.reload(); return; }
      const wasSetup = f.setup;
      Object.assign(f, d);
      this.renderHeader(); this.renderControls(); this.renderBanner(); renderCard(this);
      if (wasSetup && !f.setup && this.tab === 'chat') this.dropLanes();
    });
    // Replayed events are for the record. Only fresh ones get acted out by the characters.
    const fresh = (d) => Date.now() - (d._ts || 0) < 15000;
    on('meeting', (d) => { if (fresh(d)) this.view?.meeting(d.manager, d.staff); });
    on('handoff', (d) => { if (fresh(d)) this.view?.handoff(d.from, d.to); });
    on('project', (d) => {
      this.reload();
      if (fresh(d)) {
        this.view?.cheer();
        // One publish can raise two project events; the boss gets one toast.
        if (this.lastToast?.slug !== d.slug || Date.now() - this.lastToast.at > 15000) toast(`Published: ${d.slug}`);
        this.lastToast = { slug: d.slug, at: Date.now() };
        this.launchParty(d.slug);
      }
    });
    this.es.onerror = () => { /* EventSource reconnects by itself, sending Last-Event-ID */ };
  }
  showStream() {
    this.intercomEl?.classList.toggle('on-air', !!this.streamBuf);
    const line = this.intercomEl?.querySelector('small'); if (line) line.lastChild.textContent = this.streamBuf ? 'Talking…' : this.owner ? 'On the desk phone' : 'The boss\'s line';
    if (!this.streamEl) return;
    this.streamEl.hidden = !this.streamBuf;
    this.streamEl.firstChild.textContent = this.streamBuf;
    this.scrollChat();
  }
  /** Resolves once the state on the page is newer than this call, even if a reload was already under way. */
  // A real launch, not just a change to a project, gets a short party: confetti, the fanfare and a second round of cheering.
  async launchParty(slug) {
    await this.reloadSettled().catch(() => {});
    const p = this.state?.projects?.find((x) => x.slug === slug);
    if (this.dead || !p?.publishedAt || Date.now() - p.publishedAt > 120000 || !mayParty()) return;
    confetti({ brand: this.state.floor?.colors?.primary });
    fanfare();
    setTimeout(() => { if (!this.dead) this.view?.cheer(); }, 2100);
  }
  async reloadSettled() {
    while (this.reloading) await new Promise((r) => setTimeout(r, 30));
    await this.reload();
  }
  async reload() {
    if (this.reloading) { this.reloadAgain = true; return; }
    this.reloading = true;
    try {
      const next = await api(`/floors/${this.slug}`);
      if (this.dead) return;
      const sceneKey = (s) => JSON.stringify([s.floor.name, s.floor.logoUrl, s.floor.decor, s.floor.colors, s.floor.boss, s.agents.map((a) => [a.id, a.name, a.look])]);
      const roomKey = (s) => JSON.stringify([s.floor.name, s.floor.logoUrl, s.floor.decor, s.floor.colors, s.floor.boss]);
      const crewKey = (s) => s.agents.map((a) => JSON.stringify([a.id, a.name, a.look]));
      const was = crewKey(this.state), now = crewKey(next);
      // Someone new starting gets a desk where they are. Everyone else carries on walking: only a change to the room itself rebuilds it.
      const hired = now.length > was.length && was.every((k, i) => k === now[i]) && roomKey(next) === roomKey(this.state);
      const rebuild = !hired && sceneKey(next) !== sceneKey(this.state);
      const scroll = this.bodyEl.firstChild?.scrollTop;
      const bodyTop = this.bodyEl.scrollTop;  // Work scrolls the whole body on a phone
      const reading = [this.chatFollow, this.talkFollow].find((f) => f && !f.pinned);
      const held = reading ? reading.list.scrollTop : null;
      const typing = this.bodyEl.querySelector('textarea, input');
      const draft = typing?.value; const focused = document.activeElement === typing;
      this.state = next;
      // The floor got its name and its slug followed: the address bar follows too. The old address keeps working.
      if (next.floor.slug && next.floor.slug !== this.slug) { const was = this.slug; this.slug = next.floor.slug; if (location.pathname.includes(`/floor/${was}`)) history.replaceState(history.state, '', location.pathname.replace(`/floor/${was}`, `/floor/${this.slug}`) + location.search); }
      this.applyBrand();
      if (rebuild && stage.ok) this.rebuildScene();
      else { if (hired) this.view?.syncAgents(this.viewState()); for (const a of next.agents) this.view?.agentEvent(a); }
      this.view?.updateBoard(next.tasks);
      this.renderJourney(); this.renderHeader(); this.renderControls(); this.renderStaff(); this.renderTabs(); this.renderBody(); renderCard(this);
      if (this.tab === 'business' && !businessActive(this)) this.setTab(this.canSeeChat ? 'chat' : 'talk');
      const again = this.bodyEl.querySelector('textarea, input');
      if (again && draft) again.value = draft;
      if (again && focused) again.focus();
      if (this.bodyEl.firstChild && scroll !== undefined && this.tab !== 'chat') this.bodyEl.firstChild.scrollTop = scroll;
      if (bodyTop) this.bodyEl.scrollTop = bodyTop;
      const followed = this.tab === 'chat' ? this.chatFollow : this.tab === 'talk' ? this.talkFollow : null;
      if (followed && held !== null) { followed.pinned = false; followed.list.scrollTop = held; }
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) { toast('This floor has been closed.'); window.officeGo('/'); }
    } finally {
      this.reloading = false;
      if (this.reloadAgain) { this.reloadAgain = false; this.reload(); }
    }
  }
  // The camera stays where it was, so a change to the room is just a change to the room.
  rebuildScene() {
    const { yaw, targetYaw, zoom, targetZoom } = this.view;
    this.view.destroy(); clear(this.labels);
    const insets = this.view.insets;
    this.view = new OfficeView({ state: this.viewState(), labels: this.labels, onSmallTalk: (line) => this.addLocalTalk(line), keep: { yaw, targetYaw, zoom, targetZoom } });
    if (insets) this.view.insets = insets;
    stage.setView(this.view);
    wirePins(this);
  }
  /** The card reads the feed and who is busy, which change in bursts. Once a second is plenty. */
  cardSoon() { if (this.cardTimer) return; this.cardTimer = setTimeout(() => { this.cardTimer = null; if (!this.dead) renderCard(this); }, 1000); }
  catchUpBanner() {
    const key = `office.seen.${this.slug}`;
    let last = 0;
    try { last = Number(localStorage.getItem(key) || 0); } catch { /* private mode */ }
    const missed = this.state.feed.filter((f) => f.id > last);
    const finished = missed.filter((f) => /finished|published/.test(f.text)).length;
    if (this.owner && last && missed.length > 2) {
      this.catchUp = `While you were out: ${missed.length} updates${finished ? `, ${finished} finished or published` : ''}.`;
      this.renderBanner();
      setTimeout(() => { this.catchUp = ''; if (!this.dead) this.renderBanner(); }, 12000);
    }
    this.markSeen = () => { try { localStorage.setItem(key, String(this.state.lastEventId || 0)); const newest = this.state.feed.at(-1)?.id; if (newest) localStorage.setItem(key, String(newest)); } catch { /* private mode */ } };
    this.markSeen();
  }
  destroy() {
    this.dead = true;
    clearTimeout(this.cardTimer);
    if (this.onResize) window.removeEventListener('resize', this.onResize);
    window.removeEventListener('office:agent-tap', this.tapAgent);
    this.unwireTaps?.();
    this.unwireLift?.();
    delete document.body.dataset.sheet;
    this.pinsEl?.remove();
    this.markSeen?.();
    this.es?.close();
    // Off to the next floor by the lift: this room is kept a minute, so the way back is instant.
    if (this.parkView && this.view && stage.ok && !this.preview) park(this.slug, this.view, isPhone() ? 2 : 3, this.parkView); else this.view?.destroy();
    if (this.labels) clear(this.labels);
    document.documentElement.style.removeProperty('--brand');
    document.documentElement.style.removeProperty('--brand-2');
  }
}
const b64url = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
// "in 6 hours": the forward-looking twin of timeAgo, for a standing order's next run.
function timeUntil(ms) {
  const s = (ms - Date.now()) / 1000;
  if (s < 60) return 'any moment now';
  if (s < 3600) return `in ${Math.round(s / 60)} minutes`;
  if (s < 86400) { const n = Math.round(s / 3600); return `in ${n} ${n === 1 ? 'hour' : 'hours'}`; }
  const d = Math.round(s / 86400); return `in ${d} ${d === 1 ? 'day' : 'days'}`;
}
const safeHref = (u) => (/^https?:\/\//i.test(u) ? u : '#');

export async function showFloor(root, slug) {
  const page = new FloorPage(root, slug);
  try { await page.load(); } catch (e) {
    root.append(h('div.notfound', {}, h('h1', {}, 'No such floor.'), h('p', {}, e.status === 404 ? 'That office isn\'t in the directory. It may never have opened, or it has closed.' : e.message), h('button.btn.primary', { type: 'button', onclick: () => window.officeGo('/') }, 'Back to the lobby')));
    return;
  }
  // No doors and no curtain: the room's shell is on screen at once, and its furniture and people come in as they load.
  F = page;
  page.mount();
  page.ready = new Promise((done) => {
    const from = performance.now();
    const check = () => {
      const v = page.view;
      const there = !v || page.dead || (v.loading?.settled && [...v.actors.values()].every((a) => a.char.isModel));
      if (there || performance.now() - from > 2200) done(); else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
    setTimeout(done, 2400);  // rAF sleeps in a hidden tab
  });
  window.__office = page; // read by the browser e2e tests
}
export function hideFloor({ next = '' } = {}) {
  if (F && /^\/floor\//.test(next)) F.parkView = next.slice('/floor/'.length);
  F?.destroy(); F = null; window.__office = null;
}
