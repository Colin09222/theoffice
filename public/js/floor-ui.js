// The floor page. One SSE stream feeds the 3D characters and the panels: chat, work feed, task board, projects, requests.
import { stage } from './stage.js';
import { h, api, BASE, $, clear, put, modal, toast, money, timeAgo, session, ApiError } from './dom.js';
import { OfficeView } from './office-scene.js';
import { renderMarkdown } from './markdown.js';
import { openCustomisePanel } from './customise.js';
import { openLogin } from './claim.js';
import { renderCard, buildScrubber, buildPins, wirePins } from './floor-chrome.js';

const isPhone = () => window.innerWidth <= 760;
const TALK_KIND = { assign: 'Assignment', plan: 'The plan', handoff: 'Handoff', findings: 'Findings', review: 'Review', question: 'Question', answer: 'Answer', small: 'Small talk', private: '' };
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
    this.state = await api(`/floors/${this.slug}`);
    return this.state;
  }
  get owner() { return this.state.viewer.owner; }
  get canSeeChat() { return !!this.state.messages; }

  mount() {
    document.body.dataset.page = 'floor';
    const s = this.state;
    this.tab = this.canSeeChat ? 'chat' : 'talk';
    // The boss arrives at the chat with the manager. A visitor arrives at the room, with the panel a tap away.
    this.panelOpen = this.owner;
    this.localTalk = [];
    this.applyBrand();
    this.buildShell();
    if (stage.ok) {
      this.labels = $('#labels'); clear(this.labels);
      this.view = this.makeView();
      stage.setView(this.view);
      wirePins(this);
    }
    this.renderAll();
    this.layout();
    this.onResize = () => this.layout();
    window.addEventListener('resize', this.onResize);
    this.catchUpBanner();
    this.connect();
  }
  applyBrand() {
    const { primary, accent } = this.preview?.colors || this.state.floor.colors;
    document.documentElement.style.setProperty('--brand', primary);
    document.documentElement.style.setProperty('--brand-2', accent);
  }

  buildShell() {
    const s = this.state;
    this.titleEl = h('h1.floor-name'); this.tagEl = h('p.floor-tag');
    this.statusEl = h('span.status-pill'); this.spendEl = h('span.spend');
    this.spendBar = h('i.spend-fill');
    this.controlsEl = h('div.controls');
    this.staffEl = h('div.staff-strip', { role: 'list' });
    this.tabsEl = h('nav.tabs', { role: 'tablist' });
    this.bodyEl = h('div.tab-body');
    this.bannerEl = h('div.floor-banner', { hidden: true });
    this.grip = h('button.panel-grip', { type: 'button', 'aria-label': 'Open or close this panel', onclick: () => this.setPanel(!this.panelOpen) }, h('i'));
    this.bindGrip();
    const panel = h('aside.floor-panel.glass', {}, this.grip, h('button.panel-close', { type: 'button', 'aria-label': 'Close this panel', onclick: () => this.setPanel(false) }, '×'), this.staffEl, this.tabsEl, this.bannerEl, this.bodyEl);
    this.panel = panel;
    this.cardEl = h('div.card-more');
    this.logoEl = h('span.card-logo', { 'aria-hidden': 'true' });
    this.pillEl = h('button.talk-pill.glass', { type: 'button', 'data-talk-pill': '', onclick: () => this.setTab(this.canSeeChat ? 'chat' : 'talk') });
    this.pinsEl = buildPins(this);
    this.scrubberEl = buildScrubber(this);
    this.root.append(
      this.pinsEl,
      h('header.floor-top.glass', {},
        h('button.btn.chrome.back', { type: 'button', 'aria-label': 'Back to the lobby', onclick: () => window.officeGo('/') }, '←', h('span', {}, 'Lobby')),
        h('div.floor-title', {}, h('span.floor-num', {}, `Floor ${s.floor.number}`), this.logoEl, this.titleEl, this.tagEl),
        h('div.floor-meta', {}, this.statusEl, h('div.spend-wrap', {}, this.spendEl, h('span.spend-track', {}, this.spendBar))),
        this.cardEl),
      this.controlsEl,
      this.pillEl,
      this.scrubberEl,
      panel,
    );
  }

  makeView() { return new OfficeView({ state: this.viewState(), labels: this.labels, onSmallTalk: (line) => this.addLocalTalk(line) }); }
  /** A panel is open or it isn't; on a phone closed means just the tabs showing at the bottom. Either way the room is told what's left for it. */
  setPanel(open) { this.panelOpen = open; this.layout(); }
  layout() {
    if (this.dead || !this.panel) return;
    const phone = isPhone();
    this.panel.classList.toggle('closed', !this.panelOpen);
    document.body.dataset.sheet = this.panelOpen ? 'half' : 'peek';
    this.pillEl.hidden = phone || this.panelOpen;
    if (!this.pillEl.hidden) this.pillEl.textContent = this.canSeeChat ? (this.owner ? `Talk to ${this.state.agents.find((a) => a.role === 'manager')?.name || 'your manager'}` : 'Read the chat') : 'See what they\'re saying';
    const w = window.innerWidth, h = window.innerHeight;
    if (!this.view) return;
    if (phone) {
      const sheet = this.panelOpen ? h * 0.54 : this.panel.getBoundingClientRect().height || 104;
      this.view.setInsets({ left: 0, right: 0, top: 58, bottom: sheet + 44 });
    } else {
      const card = this.root.querySelector('.floor-top').getBoundingClientRect();
      const taken = this.panelOpen ? w - this.panel.getBoundingClientRect().left : w - this.scrubberEl.getBoundingClientRect().left;
      this.view.setInsets({ left: Math.min(w * 0.3, card.right + 6), right: Math.min(w * 0.42, taken + 6), top: 20, bottom: 56 });
    }
  }
  /** Drag the sheet's handle on a phone: up opens it, down closes it. A plain tap is handled by the click. */
  bindGrip() {
    let from = null;
    this.grip.addEventListener('pointerdown', (e) => { from = e.clientY; this.grip.setPointerCapture?.(e.pointerId); });
    this.grip.addEventListener('pointerup', (e) => {
      if (from === null) return;
      const d = e.clientY - from; from = null;
      if (Math.abs(d) > 24) { this.gripDragged = true; this.setPanel(d < 0); setTimeout(() => { this.gripDragged = false; }, 0); }
    });
    this.grip.addEventListener('click', (e) => { if (this.gripDragged) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  }

  renderAll() {
    this.renderHeader(); this.renderControls(); this.renderStaff(); this.renderTabs(); this.renderBody(); renderCard(this);
  }
  renderHeader() {
    const s = this.state; const f = s.floor;
    this.titleEl.textContent = f.name; this.tagEl.textContent = f.filler ? `${f.tagline} · A fictional demo company` : f.tagline;
    let label = 'Open', cls = 'ok';
    const working = s.agents.some((a) => a.state !== 'idle');
    if (working) { label = 'Working'; cls = 'busy'; }
    if (f.budgetStopped) { label = 'Budget used, back tomorrow'; cls = 'warn'; }
    if (f.paused) { label = 'Paused'; cls = 'warn'; }
    if (f.globalPause) { label = 'Building paused'; cls = 'warn'; }
    if (f.status === 'suspended') { label = 'Closed'; cls = 'bad'; }
    this.statusEl.className = `status-pill ${cls}`; this.statusEl.textContent = label;
    this.renderSpend();
  }
  renderSpend() {
    const { today, cap } = this.state.spend;
    this.spendEl.textContent = cap == null ? `${money(today)} today` : `${money(today)} of ${money(cap)} today`;
    this.spendBar.style.width = cap == null ? '0%' : `${Math.min(100, (today / cap) * 100)}%`;
  }
  renderControls() {
    clear(this.controlsEl);
    const f = this.state.floor;
    if (this.owner) {
      const pause = f.paused
        ? h('button.btn.chrome.resume', { type: 'button', onclick: () => this.control('resume') }, 'Resume')
        : h('button.btn.chrome', { type: 'button', onclick: () => this.control('pause') }, 'Pause');
      this.controlsEl.append(pause,
        h('button.btn.chrome', { type: 'button', onclick: () => this.confirmStop() }, 'Stop all'),
        h('button.btn.chrome', { type: 'button', onclick: () => this.openRedirect() }, 'Redirect'),
        h('button.btn.chrome', { type: 'button', onclick: () => this.openCustomise() }, 'Customise'));
    } else {
      put(this.controlsEl,
        h('span.visitor-note', {}, f.filler ? 'A demo company: scripted and fictional. Watch all you like.' : 'You\'re visiting. Watch all you like.'),
        session.floor || f.filler ? null : h('button.btn.chrome', { type: 'button', onclick: () => openLogin(this.slug) }, 'This is my floor'));
    }
  }
  async control(action, text) {
    try {
      const r = await api(`/floors/${this.slug}/control`, { method: 'POST', body: { action, text } });
      Object.assign(this.state.floor, { paused: r.paused, pauseReason: r.pauseReason, budgetStopped: r.budgetStopped });
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
    clear(this.staffEl);
    for (const a of this.state.agents) {
      const busy = a.state !== 'idle';
      const waiting = !busy && a.role === 'manager' && this.state.helpWaiting > 0;
      this.staffEl.append(h(`button.staff-chip${busy ? '.busy' : ''}`, { type: 'button', role: 'listitem', 'data-agent': a.id, title: a.activity || STATE_LABEL[a.state] || '', onclick: () => this.openAgent(a) },
        h('span.staff-dot', { css: { '--c': a.look.outfitColor } }, (a.name[0] || '?').toUpperCase()),
        h('span.staff-text', {}, h('b', {}, a.name), h('small', {}, busy ? (STATE_LABEL[a.state] || a.state) : waiting ? 'Waiting on buddehbot' : a.title))));
    }
  }
  openAgent(a) {
    if (!this.owner) {
      modal(a.name, (body) => {
        body.append(h('div.stack', {}, h('p.lede', {}, `${a.title}${a.vibe ? `, ${a.vibe.toLowerCase()} type` : ''}. ${a.activity || STATE_LABEL[a.state] || 'At desk'}.`)));
      });
      return;
    }
    this.openCustomise('staff', a.id);
  }

  tabsFor() {
    const s = this.state;
    const tabs = [];
    if (this.canSeeChat) tabs.push(['chat', this.owner ? 'Manager' : 'Chat']);
    tabs.push(['talk', 'Talk'], ['work', 'Work'], ['tasks', 'Tasks'], ['projects', 'Projects']);
    if (this.owner) {
      const pending = (s.purchases || []).filter((p) => p.status === 'pending').length + (s.domainsOn ? (s.domains || []).filter((d) => d.status === 'awaiting_boss').length : 0) + (s.ios || []).filter((i) => i.status === 'awaiting_boss').length;
      tabs.push(['requests', pending ? `Requests ${pending}` : 'Requests']);
      tabs.push(['orders', 'Orders']);  // floors-plus: standing orders, after every existing tab
    }
    return tabs;
  }
  renderTabs() {
    clear(this.tabsEl);
    for (const [id, label] of this.tabsFor()) {
      this.tabsEl.append(h(`button.tab${this.tab === id ? '.on' : ''}`, { type: 'button', role: 'tab', 'aria-selected': String(this.tab === id), 'data-tab': id, onclick: () => this.setTab(id) }, label));
      const m = id === 'requests' && label.match(/\d+/);
      if (id === 'requests' && this.pinEls?.requests) { this.pinEls.requests.badge.hidden = !m; this.pinEls.requests.badge.textContent = m ? m[0] : ''; }
    }
  }
  setTab(id) {
    if (!this.tabsFor().some(([t]) => t === id)) return;
    this.tab = id; this.renderTabs(); this.renderBody();
    if (!this.panelOpen) this.setPanel(true);
    if (id === 'talk') this.markTalkRead();
  }
  renderBody() {
    this.renderBanner();
    clear(this.bodyEl);
    if (this.tab === 'chat') this.renderChat();
    if (this.tab === 'talk') this.renderTalk();
    if (this.tab === 'work') this.renderWork();
    if (this.tab === 'tasks') this.renderTasks();
    if (this.tab === 'projects') this.renderProjects();
    if (this.tab === 'requests') this.renderRequests();
    if (this.tab === 'orders') this.renderOrders();
  }
  renderBanner() {
    const f = this.state.floor;
    let text = '';
    if (f.status === 'suspended') text = 'The building manager has closed this floor for now.';
    else if (f.globalPause) text = 'The building manager has paused all work.';
    else if (f.paused) text = f.pauseReason || 'This floor is paused.';
    else if (f.budgetStopped) text = 'Today\'s budget is used up. Work picks up again tomorrow.';
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
    this.bodyEl.append(this.chatList);
    this.lanesEl = this.isNewFloor() ? this.lanePicker() : null;
    this.chatList.append(...(this.lanesEl ? [this.lanesEl] : []), this.questionsEl, this.streamEl);
    if (this.owner) {
      const input = h('textarea', { rows: 1, maxlength: 4000, placeholder: 'Tell your office manager...', 'aria-label': 'Message your office manager', name: 'chat' });
      const send = async () => {
        const text = input.value.trim();
        if (!text) return;
        input.value = ''; input.style.height = '';
        try { await api(`/floors/${this.slug}/chat`, { method: 'POST', body: { text } }); this.view?.bossTalks(); } catch (e) { input.value = text; toast(e.message, 'bad'); }
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
      input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = `${Math.min(120, input.scrollHeight)}px`; });
      this.bodyEl.append(h('form.chat-input', { onsubmit: (e) => { e.preventDefault(); send(); } }, input, h('button.btn.primary.send', { type: 'submit', 'aria-label': 'Send' }, '↑')));
    } else {
      this.bodyEl.append(h('p.readonly-note', {}, 'Only the boss of this floor can talk to the manager.'));
    }
    this.scrollChat();
  }
  // ---- the three ways in ----
  isNewFloor() { return this.owner && this.state.floor.status === 'active' && !(this.state.messages || []).some((m) => m.role === 'boss') && !this.state.tasks.length; }
  lanePicker() {
    const buttons = LANES.map(([id, title, what, text]) => h('button.lane', { type: 'button', 'data-lane': id, onclick: async () => {
      for (const b of buttons) b.disabled = true;
      try { await api(`/floors/${this.slug}/chat`, { method: 'POST', body: { text } }); this.view?.bossTalks(); this.dropLanes(); } catch (e) { for (const b of buttons) b.disabled = false; toast(e.message, 'bad'); }
    } }, h('b', {}, title), h('span', {}, what)));
    return h('div.lanes', { role: 'group', 'aria-label': 'What should we start on?' }, ...buttons,
      h('p.fineprint', {}, 'Your staff research, write, build and publish. Nobody here can send email, post, run ads or spend money, so they will tell you what only you can do.'),
      h('button.link.make-yours', { type: 'button', 'data-make-yours': '', onclick: () => this.openCustomise('vibe') }, 'First, make this office yours'));
  }
  dropLanes() { this.lanesEl?.remove(); this.lanesEl = null; }
  messageEl(m) {
    const who = m.role === 'boss' ? this.state.floor.boss.name : m.role === 'help' ? 'buddehbot' : this.state.agents.find((a) => a.id === m.agentId)?.name || 'Office Manager';
    const body = h('div.msg-body');
    body.innerHTML = renderMarkdown(m.text); // renderMarkdown escapes all input first, and the CSP forbids inline script regardless
    // A report (launch report, standing-order report) or an answer from the help line is for the boss alone, and gets its own look.
    const cls = m.role === 'boss' ? 'boss' : m.role === 'office' ? 'manager.notice' : m.role === 'report' ? 'manager.report' : m.role === 'help' ? 'manager.help' : 'manager';
    return h(`div.msg.${cls}`, { 'data-id': m.id, 'data-role': m.role }, h('span.msg-who', {}, who), body);
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
  scrollChat() { if (this.chatList) this.chatList.scrollTop = this.chatList.scrollHeight; }

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
    for (const l of lines) list.append(this.talkEl(l));
    this.talkList = list;
    this.bodyEl.append(list);
    this.markTalkRead();
    list.scrollTop = list.scrollHeight;
  }
  talkEl(l) {
    const kind = TALK_KIND[l.kind] ?? '';
    return h(`li.talk-line.${l.kind || 'line'}`, { 'data-kind': l.kind || '', 'data-talk': l.id || '' },
      h('div.talk-who', {}, h('b', {}, l.fromName || 'Someone'), l.toName ? h('span.talk-to', {}, ` to ${l.toName}`) : null, kind ? h('span.talk-kind', {}, kind) : null),
      h('p', {}, l.text),
      h('time', {}, timeAgo(l.ts)));
  }
  addTalkLine(l) {
    if (this.tab === 'talk' && this.talkList) {
      const keep = this.talkList.scrollHeight - this.talkList.scrollTop - this.talkList.clientHeight < 60;
      this.talkList.querySelector('.empty')?.remove();
      this.talkList.append(this.talkEl(l));
      if (keep) this.talkList.scrollTop = this.talkList.scrollHeight;
      if (this.panelOpen) this.markTalkRead();
    } else if (l.kind !== 'small') {
      this.talkUnread = (this.talkUnread || 0) + 1;
      const b = this.pinEls?.talk?.badge;
      if (b) { b.hidden = false; b.textContent = String(Math.min(this.talkUnread, 99)); }
    }
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
    if (!items.length) list.append(h('li.empty', {}, this.owner ? 'Quiet so far. Tell your manager what to do.' : 'Quiet so far. Nobody has started anything yet.'));
    this.feedList = list;
    this.bodyEl.append(list);
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
      const shown = key === 'done' ? col.slice(-12).reverse() : col;
      board.append(h('section.col', {}, h('h3', {}, title, h('span', {}, String(col.length))),
        ...shown.map((x) => h(`article.card.${x.status}`, {}, h('b', {}, x.title),
          h('small', {}, agents.find((a) => a.id === x.agentId)?.name || '', x.status === 'blocked' ? ' · waiting on the boss' : '', this.owner && x.costUsd ? ` · ${money(x.costUsd)}` : ''),
          this.owner && x.result ? h('p', {}, x.result.slice(0, 180)) : null))));
    }
    const failed = t.filter((x) => x.status === 'failed' || x.status === 'cancelled');
    if (failed.length) board.append(h('section.col', {}, h('h3', {}, 'Dropped', h('span', {}, String(failed.length))), ...failed.slice(-6).reverse().map((x) => h(`article.card.${x.status}`, {}, h('b', {}, x.title), h('small', {}, x.status === 'failed' ? 'Could not finish' : 'Cancelled')))));
    if (!t.length && !help) board.append(h('p.empty', {}, 'No tasks yet.'));
    this.bodyEl.append(board);
  }
  // The help line on the board. A visitor only learns that a question is out; the words are the boss's alone.
  helpSection() {
    const s = this.state;
    if (!this.owner) return s.helpWaiting ? h('section.col.help-col', {}, h('h3', {}, 'Help line'), h('article.card.help.pending', {}, h('b', {}, '☎ Asked buddehbot for help'), h('small', {}, 'Waiting for an answer. The team carries on meanwhile.'))) : null;
    if (!s.help?.length) return null;
    return h('section.col.help-col', {}, h('h3', {}, 'Help line', h('span', {}, String(s.help.filter((x) => x.status === 'pending').length))),
      ...s.help.map((x) => h(`article.card.help.${x.status}`, { 'data-help': x.id }, h('b', {}, '☎ Asked buddehbot for help'), h('p', {}, x.question), h('small', {}, HELP_STATUS[x.status] || x.status))));
  }

  // ---- projects ----
  renderProjects() {
    const s = this.state;
    const wrap = h('div.gallery');
    if (!s.projects.length) wrap.append(h('p.empty', {}, 'Nothing published yet. When the staff ship something, it shows up here.'));
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
      h('div.row', {}, h('button.btn.primary', { type: 'button', onclick: open }, 'Open'), priv,
        this.owner && p.appUrl ? h('button.link', { type: 'button', onclick: async () => {
          if (!window.confirm(`Delete every save, leaderboard, shared value and sign-up for ${p.title}? This can't be undone. Download your sign-ups first if you want them.`)) return;
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
        try { await api(`/floors/${this.slug}/domains/${d.id}/buy`, { method: 'POST', body: { priceUsd: d.priceUsd } }); toast(`Buying ${d.domain}`); this.reload(); } catch (e) { toast(e.message, 'bad'); this.reload(); }
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
    if (!items.length && !(this.state.domains || []).length && !(this.state.ios || []).length) list.append(h('p.empty', {}, this.state.domainsOn ? 'No requests. Staff can ask, but only you can say yes.' : 'No requests. Staff can ask for things here, but they can\'t buy anything.'));
    for (const p of items) {
      const setStatus = async (status) => { try { await api(`/floors/${this.slug}/purchases/${p.id}`, { method: 'POST', body: { status } }); p.status = status; this.renderTabs(); this.renderBody(); } catch (e) { toast(e.message, 'bad'); } };
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
    wrap.append(h('p.lede', {}, `Standing orders run on their own while you're away, through the same manager, staff and daily budget as anything you ask for in chat. Up to ${lim.perFloor ?? 3} per floor, at most once a day.`));
    if (!orders.length) wrap.append(h('p.empty', {}, 'No standing orders yet. Set one below, or ask your manager for something "every morning".'));
    for (const o of orders) wrap.append(this.orderCard(o));
    if (orders.length < (lim.perFloor ?? 3)) wrap.append(this.orderForm());
    wrap.append(h('p.fineprint', {}, `An order waits while the floor is busy, paused or out of budget. It pauses itself after ${lim.maxFails ?? 3} failed runs in a row, or if you haven't opened the floor in ${lim.idleDays ?? 14} days; opening it switches those back on.`));
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
        h('span', {}, `About ${money(o.estUsd)} a run`),
        last ? h('span', {}, `Last run ${money(last.costUsd)}${last.status === 'failed' ? ', did not finish' : ''}`) : h('span', {}, 'Not run yet')),
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
    return h(`li.order-run.${r.status}`, { 'data-run': r.id }, h('small', {}, `${new Date(r.startedAt).toLocaleString()} · ${label} · ${money(r.costUsd)} (estimated ${money(r.estUsd)})`), r.report ? doc : h('span', {}, 'Working on it...'));
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
      this.renderStaff(); this.renderHeader(); this.cardSoon();
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
      const line = { id: d._id, from: d.from, to: d.to, fromName: d.fromName, toName: d.toName, text: d.text, kind: d.kind, ts: d._ts || d.ts };
      this.state.talk ||= [];
      if (line.id && this.state.talk.some((l) => l.id === line.id)) return;
      this.state.talk.push(line);
      if (this.state.talk.length > 200) this.state.talk.shift();
      this.addTalkLine(line);
      if (fresh(d)) this.view?.life?.line(line);
    });
    on('task', (d) => {
      const i = this.state.tasks.findIndex((t) => t.id === d.id);
      if (i >= 0) this.state.tasks[i] = { ...this.state.tasks[i], ...d }; else this.state.tasks.push(d);
      this.view?.updateBoard(this.state.tasks);
      if (this.tab === 'tasks') this.renderBody();
    });
    on('spend', (d) => { this.state.spend.today = d.today; this.renderSpend(); });
    on('token', (d) => { this.streamBuf += d.text; this.showStream(); });
    on('token_reset', () => { this.streamBuf = ''; this.showStream(); });
    on('message', (d) => {
      if (!this.state.messages) return;
      if (this.state.messages.some((m) => m.id === d.id)) return;
      const m = { id: d.id, role: d.role, agentId: d.agentId, text: d.text, createdAt: d.createdAt };
      this.state.messages.push(m);
      if (d.role === 'manager') { this.streamBuf = ''; this.showStream(); }
      if (d.role === 'boss') this.dropLanes();
      if (this.tab === 'chat' && this.chatList) { this.chatList.insertBefore(this.messageEl(m), this.lanesEl || this.questionsEl); this.scrollChat(); }
      // floors-plus: a report means an order ran, so the Orders tab and its history are stale.
      if (d.role === 'report') { if (this.tab !== 'chat') toast('A report from your manager is in the chat'); if (this.owner) this.refreshOrders(); }
    });
    on('orders', () => { if (this.owner) this.refreshOrders(); });
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
    on('reload', () => this.reload());
    on('floor', (d) => {
      Object.assign(this.state.floor, d);
      if (d.status === 'gone') { toast('This floor has been closed.'); window.officeGo('/'); return; }
      this.renderHeader(); this.renderControls(); this.renderBanner();
    });
    // Replayed events are for the record. Only fresh ones get acted out by the characters.
    const fresh = (d) => Date.now() - (d._ts || 0) < 15000;
    on('meeting', (d) => { if (fresh(d)) this.view?.meeting(d.manager, d.staff); });
    on('handoff', (d) => { if (fresh(d)) this.view?.handoff(d.from, d.to); });
    on('project', (d) => {
      this.reload();
      if (fresh(d)) { this.view?.cheer(); toast(`Published: ${d.slug}`); }
    });
    this.es.onerror = () => { /* EventSource reconnects by itself, sending Last-Event-ID */ };
  }
  showStream() {
    if (!this.streamEl) return;
    this.streamEl.hidden = !this.streamBuf;
    this.streamEl.firstChild.textContent = this.streamBuf;
    this.scrollChat();
  }
  /** Resolves once the state on the page is newer than this call, even if a reload was already under way. */
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
      const rebuild = sceneKey(next) !== sceneKey(this.state);
      const scroll = this.bodyEl.firstChild?.scrollTop;
      const typing = this.bodyEl.querySelector('textarea, input');
      const draft = typing?.value; const focused = document.activeElement === typing;
      this.state = next;
      this.applyBrand();
      if (rebuild && stage.ok) this.rebuildScene();
      else for (const a of next.agents) this.view?.agentEvent(a);
      this.view?.updateBoard(next.tasks);
      this.renderHeader(); this.renderControls(); this.renderStaff(); this.renderTabs(); this.renderBody(); renderCard(this);
      const again = this.bodyEl.querySelector('textarea, input');
      if (again && draft) again.value = draft;
      if (again && focused) again.focus();
      if (this.bodyEl.firstChild && scroll !== undefined && this.tab !== 'chat') this.bodyEl.firstChild.scrollTop = scroll;
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
    delete document.body.dataset.sheet;
    this.markSeen?.();
    this.es?.close();
    this.view?.destroy();
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
    root.append(h('div.notfound.glass', {}, h('h1', {}, 'No such floor.'), h('p', {}, e.status === 404 ? 'That office isn\'t in the directory. It may never have opened, or it has closed.' : e.message), h('button.btn.primary', { type: 'button', onclick: () => window.officeGo('/') }, 'Back to the lobby')));
    return;
  }
  const fade = $('#fade');
  fade.classList.add('in');
  F = page;
  page.mount();
  requestAnimationFrame(() => fade.classList.remove('in'));
  window.__office = page; // read by the browser e2e tests
}
export function hideFloor() {
  F?.destroy(); F = null; window.__office = null;
}
