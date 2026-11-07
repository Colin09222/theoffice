// The floor page. One SSE stream feeds the 3D characters and the panels: chat, work feed, task board, projects, requests.
import { stage } from './stage.js';
import { h, api, BASE, $, clear, put, modal, toast, money, timeAgo, session, ApiError, refreshMe } from './dom.js';
import { OfficeView } from './office-scene.js';
import { renderMarkdown } from './markdown.js';
import { characterBuilder, swatches, chips } from './builder.js';
import { FLOOR_STYLES, PETS } from './looks.js';
import { openLogin } from './claim.js';

const COLUMNS = [['todo', 'To do'], ['doing', 'Doing'], ['review', 'With manager'], ['done', 'Done']];
const STATE_LABEL = { idle: 'At desk', thinking: 'Thinking', typing: 'Writing', browsing: 'On the web', reading: 'Reading', talking: 'Talking', queued: 'Waiting for a line' };

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
    this.tab = this.canSeeChat ? 'chat' : 'work';
    this.applyBrand();
    this.buildShell();
    if (stage.ok) {
      this.labels = $('#labels'); clear(this.labels);
      this.view = new OfficeView({ state: s, labels: this.labels });
      stage.setView(this.view);
    }
    this.renderAll();
    this.catchUpBanner();
    this.connect();
  }
  applyBrand() {
    const { primary, accent } = this.state.floor.colors;
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
    const panel = h('aside.floor-panel.glass', {}, this.staffEl, this.tabsEl, this.bannerEl, this.bodyEl);
    this.panel = panel;
    this.root.append(
      h('header.floor-top', {},
        h('button.btn.chrome.back', { type: 'button', 'aria-label': 'Back to the lobby', onclick: () => window.officeGo('/') }, '←', h('span', {}, 'Lobby')),
        h('div.floor-title', {}, h('span.floor-num', {}, `Floor ${s.floor.number}`), this.titleEl, this.tagEl),
        h('div.floor-meta', {}, this.statusEl, h('div.spend-wrap', {}, this.spendEl, h('span.spend-track', {}, this.spendBar)))),
      this.controlsEl,
      panel,
    );
  }

  renderAll() {
    this.renderHeader(); this.renderControls(); this.renderStaff(); this.renderTabs(); this.renderBody();
  }
  renderHeader() {
    const s = this.state; const f = s.floor;
    this.titleEl.textContent = f.name; this.tagEl.textContent = f.tagline;
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
        h('span.visitor-note', {}, 'You\'re visiting. Watch all you like.'),
        session.floor ? null : h('button.btn.chrome', { type: 'button', onclick: () => openLogin(this.slug) }, 'This is my floor'));
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
      this.staffEl.append(h(`button.staff-chip${busy ? '.busy' : ''}`, { type: 'button', role: 'listitem', 'data-agent': a.id, title: a.activity || STATE_LABEL[a.state] || '', onclick: () => this.openAgent(a) },
        h('span.staff-dot', { css: { '--c': a.look.outfitColor } }, (a.name[0] || '?').toUpperCase()),
        h('span.staff-text', {}, h('b', {}, a.name), h('small', {}, busy ? (STATE_LABEL[a.state] || a.state) : a.title))));
    }
  }
  openAgent(a) {
    if (!this.owner) {
      modal(a.name, (body) => {
        body.append(h('div.stack', {}, h('p.lede', {}, `${a.title}. ${a.activity || STATE_LABEL[a.state] || 'At desk'}.`)));
      });
      return;
    }
    this.openCustomise('staff', a.id);
  }

  tabsFor() {
    const s = this.state;
    const tabs = [];
    if (this.canSeeChat) tabs.push(['chat', this.owner ? 'Manager' : 'Chat']);
    tabs.push(['work', 'Work'], ['tasks', 'Tasks'], ['projects', 'Projects']);
    if (this.owner) {
      const pending = (s.purchases || []).filter((p) => p.status === 'pending').length;
      tabs.push(['requests', pending ? `Requests ${pending}` : 'Requests']);
    }
    return tabs;
  }
  renderTabs() {
    clear(this.tabsEl);
    for (const [id, label] of this.tabsFor()) {
      this.tabsEl.append(h(`button.tab${this.tab === id ? '.on' : ''}`, { type: 'button', role: 'tab', 'aria-selected': String(this.tab === id), 'data-tab': id, onclick: () => this.setTab(id) }, label));
    }
  }
  setTab(id) { this.tab = id; this.renderTabs(); this.renderBody(); }
  renderBody() {
    this.renderBanner();
    clear(this.bodyEl);
    if (this.tab === 'chat') this.renderChat();
    if (this.tab === 'work') this.renderWork();
    if (this.tab === 'tasks') this.renderTasks();
    if (this.tab === 'projects') this.renderProjects();
    if (this.tab === 'requests') this.renderRequests();
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
    this.chatList.append(this.questionsEl, this.streamEl);
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
  messageEl(m) {
    const who = m.role === 'boss' ? this.state.floor.boss.name : this.state.agents.find((a) => a.id === m.agentId)?.name || 'Office Manager';
    const body = h('div.msg-body');
    body.innerHTML = renderMarkdown(m.text); // renderMarkdown escapes all input first, and the CSP forbids inline script regardless
    const cls = m.role === 'boss' ? 'boss' : m.role === 'office' ? 'manager.notice' : 'manager';
    return h(`div.msg.${cls}`, { 'data-id': m.id }, h('span.msg-who', {}, who), body);
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
    if (!t.length) board.append(h('p.empty', {}, 'No tasks yet.'));
    this.bodyEl.append(board);
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
    const open = async () => {
      let url = p.appUrl || p.url;
      if (p.private) { try { url = (await api(`/floors/${this.slug}/projects/${p.slug}/preview`)).url; } catch (e) { toast(e.message, 'bad'); return; } }
      this.previewProject(p, url);
    };
    const priv = this.owner ? h('label.toggle', {}, h('input', { type: 'checkbox', checked: p.private, 'aria-label': `Keep ${p.title} private`, onchange: async (e) => {
      try { await api(`/floors/${this.slug}/projects/${p.slug}`, { method: 'POST', body: { private: e.target.checked } }); p.private = e.target.checked; toast(p.private ? 'Hidden from visitors' : 'Visible to visitors'); } catch (x) { e.target.checked = !e.target.checked; toast(x.message, 'bad'); }
    } }), h('span', {}, 'Private')) : null;
    return h(`article.project.kind-${p.kind}`, { 'data-project': p.slug },
      h('span.kind', {}, KIND[p.kind] || p.kind), h('h3', {}, p.title), h('p', {}, p.description || ''),
      p.sources?.length ? h('small', {}, `${p.sources.length} ${p.sources.length === 1 ? 'source' : 'sources'}`) : null,
      h('div.row', {}, h('button.btn.primary', { type: 'button', onclick: open }, 'Open'), priv,
        this.owner && p.appUrl ? h('button.link', { type: 'button', onclick: async () => {
          if (!window.confirm(`Delete every save, leaderboard and shared value for ${p.title}? This can't be undone.`)) return;
          try { const r = await api(`/floors/${this.slug}/projects/${p.slug}/clear-data`, { method: 'POST', body: {} }); toast(`Cleared ${r.removed} saved ${r.removed === 1 ? 'item' : 'items'}`); } catch (e) { toast(e.message, 'bad'); }
        } }, 'Clear saved data') : null));
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
  renderRequests() {
    const list = h('div.requests');
    const items = this.state.purchases || [];
    if (!items.length) list.append(h('p.empty', {}, 'No purchase requests. Staff can ask, but they can\'t buy anything.'));
    for (const p of items) {
      const setStatus = async (status) => { try { await api(`/floors/${this.slug}/purchases/${p.id}`, { method: 'POST', body: { status } }); p.status = status; this.renderTabs(); this.renderBody(); } catch (e) { toast(e.message, 'bad'); } };
      list.append(h(`article.card.request.${p.status}`, {},
        h('div.row.spread', {}, h('b', {}, p.item), h('span.price', {}, money(p.price))),
        h('p', {}, p.why), h('small', {}, `${p.agentName || 'Staff'} · ${p.status === 'pending' ? 'Pending' : p.status === 'declined' ? 'Declined' : 'You bought it yourself'}`),
        p.link ? h('p', {}, h('a', { href: safeHref(p.link), target: '_blank', rel: 'noopener noreferrer nofollow' }, 'See the link')) : null,
        p.status === 'pending' ? h('div.row', {}, h('button.btn.ghost', { type: 'button', onclick: () => setStatus('bought-myself') }, 'I bought it myself'), h('button.btn.ghost', { type: 'button', onclick: () => setStatus('declined') }, 'Decline')) : null));
    }
    list.append(h('p.fineprint', {}, 'Nothing in The Office can pay for anything. These are just notes from your staff.'));
    this.bodyEl.append(list);
  }

  // ---- customise ----
  openCustomise(tab = 'company', agentId) {
    const s = this.state;
    let cleanup = () => {};
    modal('Customise', (body, close) => {
      const draft = { name: s.floor.name, tagline: s.floor.tagline, colors: { ...s.floor.colors }, decor: { ...s.floor.decor }, publicChat: s.floor.publicChat, defaultPrivate: s.floor.defaultPrivate, boss: { name: s.floor.boss.name, look: { ...s.floor.boss.look } } };
      const pane = h('div.custom-pane');
      const tabs = h('nav.tabs');
      const save = async () => {
        try { await api(`/floors/${this.slug}/settings`, { method: 'POST', body: draft }); toast('Saved'); close(); } catch (e) { toast(e.message, 'bad'); }
      };
      const show = (id, agent) => {
        cleanup(); cleanup = () => {};
        clear(tabs);
        for (const [k, label] of [['company', 'Company'], ['boss', 'You'], ['staff', 'Staff'], ['decor', 'Decor']]) tabs.append(h(`button.tab${k === id ? '.on' : ''}`, { type: 'button', 'data-custom': k, onclick: () => show(k) }, label));
        clear(pane);
        if (id === 'company') {
          pane.append(h('form.stack', { onsubmit: (e) => { e.preventDefault(); save(); } },
            h('label.field', {}, h('span', {}, 'Company name'), h('input', { name: 'company', value: draft.name, maxlength: 60, oninput: (e) => { draft.name = e.target.value; } })),
            h('label.field', {}, h('span', {}, 'Tagline'), h('input', { value: draft.tagline, maxlength: 120, oninput: (e) => { draft.tagline = e.target.value; } })),
            h('label.field', {}, h('span', {}, 'Main colour'), h('input', { type: 'color', value: draft.colors.primary, oninput: (e) => { draft.colors.primary = e.target.value; } })),
            h('label.field', {}, h('span', {}, 'Accent colour'), h('input', { type: 'color', value: draft.colors.accent, oninput: (e) => { draft.colors.accent = e.target.value; } })),
            h('label.toggle', {}, h('input', { type: 'checkbox', checked: draft.publicChat, onchange: (e) => { draft.publicChat = e.target.checked; } }), h('span', {}, 'Visitors can read my chat with the manager. Private project names are hidden, but anything else said about them isn\'t')),
            h('label.toggle', {}, h('input', { type: 'checkbox', checked: draft.defaultPrivate, onchange: (e) => { draft.defaultPrivate = e.target.checked; } }), h('span', {}, 'New projects start private')),
            h('button.btn.primary.wide', { type: 'submit' }, 'Save'),
            h('button.btn.ghost.wide', { type: 'button', onclick: async () => { try { await api('/logout', { method: 'POST' }); await refreshMe(); close(); window.officeGo('/'); } catch (e) { toast(e.message, 'bad'); } } }, 'Sign out of this floor')));
        }
        if (id === 'boss') {
          const holder = h('div');
          pane.append(h('form.stack', { onsubmit: (e) => { e.preventDefault(); draft.boss.look = builder.look; save(); } },
            h('label.field', {}, h('span', {}, 'Your name'), h('input', { value: draft.boss.name, maxlength: 30, oninput: (e) => { draft.boss.name = e.target.value; } })), holder,
            h('div.sticky-foot', {}, h('button.btn.primary.wide', { type: 'submit' }, 'Save'))));
          const builder = characterBuilder(holder, draft.boss.look, draft.colors.accent);
          draft.boss.look = builder.look;
          cleanup = () => builder.dispose();
        }
        if (id === 'staff') {
          const list = h('div.chips.staff-pick');
          const editor = h('div');
          const pick = (a) => {
            for (const b of list.children) b.setAttribute('aria-checked', String(b.dataset.v === String(a.id)));
            cleanup();
            const holder = h('div');
            const name = h('input', { value: a.name, maxlength: 24, 'aria-label': 'Name' });
            clear(editor).append(h('form.stack', { onsubmit: async (e) => {
              e.preventDefault();
              try { await api(`/floors/${this.slug}/staff/${a.id}`, { method: 'POST', body: { name: name.value, look: b.look } }); toast(`${name.value.trim() || a.name} looks great`); close(); } catch (x) { toast(x.message, 'bad'); }
            } }, h('label.field', {}, h('span', {}, `${a.title}'s name`), name), holder, h('div.sticky-foot', {}, h('button.btn.primary.wide', { type: 'submit' }, 'Save'))));
            const b = characterBuilder(holder, a.look, draft.colors.accent);
            cleanup = () => b.dispose();
          };
          for (const a of s.agents) list.append(h('button.chip', { type: 'button', 'data-v': String(a.id), role: 'radio', onclick: () => pick(a) }, a.name));
          pane.append(list, editor);
          pick(s.agents.find((a) => a.id === agent) || s.agents[0]);
        }
        if (id === 'decor') {
          const d = draft.decor;
          const toggle = (k, label) => h('label.toggle', {}, h('input', { type: 'checkbox', checked: d[k], onchange: (e) => { d[k] = e.target.checked; } }), h('span', {}, label));
          const plants = h('input', { type: 'range', min: 0, max: 8, value: d.plants, 'aria-label': 'Plants', oninput: (e) => { d.plants = Number(e.target.value); } });
          pane.append(h('form.stack', { onsubmit: (e) => { e.preventDefault(); save(); } },
            h('div.field', {}, h('span', {}, 'Floor'), chips(FLOOR_STYLES, d.floor, (v) => { d.floor = v; }, 'Floor')),
            h('label.field', {}, h('span', {}, 'Wall colour'), h('input', { type: 'color', value: d.wall, oninput: (e) => { d.wall = e.target.value; } })),
            h('label.field', {}, h('span', {}, 'Plants'), plants),
            h('div.field', {}, h('span', {}, 'Office pet'), chips(PETS, d.pet, (v) => { d.pet = v; }, 'Pet')),
            h('div.toggle-grid', {}, toggle('rug', 'Rugs'), toggle('art', 'Art'), toggle('coffee', 'Coffee bar'), toggle('arcade', 'Arcade cabinet'), toggle('neon', 'Neon sign')),
            h('button.btn.primary.wide', { type: 'submit' }, 'Save')));
        }
      };
      body.append(tabs, pane);
      show(tab, agentId);
    }, { wide: true, onClose: () => cleanup() });
  }

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
      this.renderStaff(); this.renderHeader();
    });
    on('feed', (d) => {
      const item = { id: d._id, name: d.name, text: d.text, ts: d.ts };
      if (item.id && this.seen.has(item.id)) return;
      if (item.id) this.seen.add(item.id);
      if (this.state.feed.some((f) => f.id === item.id)) return;
      this.state.feed.push(item);
      if (this.state.feed.length > 200) this.state.feed.shift();
      if (this.tab === 'work' && this.feedList) { this.feedList.querySelector('.empty')?.remove(); this.feedList.prepend(this.feedEl(item)); }
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
      if (this.tab === 'chat' && this.chatList) { this.chatList.insertBefore(this.messageEl(m), this.questionsEl); this.scrollChat(); }
    });
    on('question', () => this.reload());
    on('question_answered', () => this.reload());
    on('purchase', () => { this.reload(); toast('A purchase request is waiting for you'); });
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
  async reload() {
    if (this.reloading) { this.reloadAgain = true; return; }
    this.reloading = true;
    try {
      const next = await api(`/floors/${this.slug}`);
      if (this.dead) return;
      const rebuild = JSON.stringify([next.floor.decor, next.floor.colors, next.floor.boss, next.agents.map((a) => [a.id, a.name, a.look])]) !== JSON.stringify([this.state.floor.decor, this.state.floor.colors, this.state.floor.boss, this.state.agents.map((a) => [a.id, a.name, a.look])]);
      const scroll = this.bodyEl.firstChild?.scrollTop;
      const typing = this.bodyEl.querySelector('textarea, input');
      const draft = typing?.value; const focused = document.activeElement === typing;
      this.state = next;
      this.applyBrand();
      if (rebuild && stage.ok) this.rebuildScene();
      else for (const a of next.agents) this.view?.agentEvent(a);
      this.view?.updateBoard(next.tasks);
      this.renderHeader(); this.renderControls(); this.renderStaff(); this.renderTabs(); this.renderBody();
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
  rebuildScene() {
    this.view.destroy(); clear(this.labels);
    this.view = new OfficeView({ state: this.state, labels: this.labels });
    stage.setView(this.view);
  }
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
    this.markSeen?.();
    this.es?.close();
    this.view?.destroy();
    if (this.labels) clear(this.labels);
    document.documentElement.style.removeProperty('--brand');
    document.documentElement.style.removeProperty('--brand-2');
  }
}
const b64url = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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
