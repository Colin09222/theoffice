// Setup: a fresh floor's first run, on a screen of its own. What are we making, which one, then Ready: the company's name, the plan, one big Go.
// The questions and their endpoints are the launcher's (launch-ui.js). A floor that already has a name never gets this by itself; "Make something new" opens the same flow later.
import { h, session, recoveryBox, toast } from './dom.js';
import { icon } from './icons.js';
import { launchTypes, typeIcon, ideaTag, fetchIdeas, wordsToCard, startWork, landInChat } from './launch-ui.js';

const QUESTIONS = ['what', 'which', 'ready'];
const TILE = { game: '#FFE6EF', app: '#E0EEFC', website: '#E3F6EC', business: '#FFF2D6' };
const FACE = { manager: '#FF9C7A', researcher: '#7FB8F0', writer: '#C8A2EE', builder: '#7DD3A8', designer: '#FFC65C', tester: '#F48FB1' };
// The place a boss has reached is kept per floor, per device. The recovery code is never in it.
const placeKey = (slug) => `office-setup-${slug}`;
const recall = (slug) => { try { return JSON.parse(localStorage.getItem(placeKey(slug))) || {}; } catch { return {}; } };
const remember = (slug, v) => { try { localStorage.setItem(placeKey(slug), JSON.stringify(v)); } catch { /* private browsing: the place is lost on a reload, and nothing else */ } };
const forget = (slug) => { try { localStorage.removeItem(placeKey(slug)); } catch { /* as above */ } };
const text = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');

/** What a saved place is worth: anything stale or broken falls back to the start rather than to a crash. */
function restored(saved, types) {
  const s = { step: 'what', type: '', label: '', picked: '', own: '', card: null, company: '', typedCompany: false, name: '', pitch: '', goal: '', plan: '' };
  const t = types.find(([id]) => id === saved.type);
  if (!t) return s;
  Object.assign(s, { type: t[0], label: t[1], picked: text(saved.picked, 30), own: text(saved.own, 400), step: saved.step === 'what' ? 'what' : 'which' });
  if (saved.card && typeof saved.card === 'object' && typeof saved.card.name === 'string' && typeof saved.card.pitch === 'string') {
    Object.assign(s, { card: saved.card, company: text(saved.company, 60), typedCompany: !!saved.typedCompany, name: text(saved.name, 40), pitch: text(saved.pitch, 400), goal: text(saved.goal, 200), plan: text(saved.plan, 600) });
    if (saved.step === 'ready') s.step = 'ready';
  }
  return s;
}

/** The floor page's one hook: wires "Make something new", and takes over the screen if this boss has a floor to set up. True when it did. */
export function setupOnArrival(page) {
  page.startNew = () => openSetup(page, { again: true });
  if (!page.state.floor.setup || !page.isNewFloor() || recall(page.slug).out) return false;
  openSetup(page);
  return true;
}

function openSetup(page, { again = false } = {}) {
  if (page.setupEl?.isConnected) return;
  const types = launchTypes(page);
  const S = restored(again ? {} : recall(page.slug), types);
  // The one-time code from claiming the floor comes first, while Setup is still this boss's whole screen. It stays in memory only.
  const rec = !again && session.pendingRecovery?.slug === page.slug ? session.pendingRecovery : null;
  const head = h('div.setup-head'), main = h('div.setup-main'), foot = h('div.setup-foot');
  const root = h('div.setup', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Set up your company', 'data-setup-flow': '', 'data-launcher': '' }, head, main, foot);
  let asking = 0;
  const save = () => { if (!again) remember(page.slug, S); };

  // ---- moving between steps. The phone's own Back gesture leaves the floor, as any page would; the place is saved, so coming back lands on the same step. ----
  const backOf = { keys: null, what: rec ? 'keys' : null, which: 'what', ready: 'which' };
  const canGoBack = (step) => !!backOf[step] || (again && step === 'what');
  function goBack() {
    if (again && S.step === 'what') { close(); return; }
    if (backOf[S.step]) render(backOf[S.step]);
  }

  // ---- the screen follows the part of the phone you can actually see, keyboard and browser bars included ----
  const vv = window.visualViewport;
  const keepFieldInView = () => { const f = document.activeElement; if (f && /^(INPUT|TEXTAREA)$/.test(f.tagName) && main.contains(f)) f.scrollIntoView({ block: 'center' }); };
  const fit = () => {
    if (!root.isConnected) { vv?.removeEventListener('resize', fit); vv?.removeEventListener('scroll', fit); return; }
    root.style.setProperty('--setup-top', `${Math.round(vv.offsetTop)}px`);
    root.style.setProperty('--setup-h', `${Math.round(vv.height)}px`);
    keepFieldInView();
  };

  function close() {
    root.remove(); page.setupEl = null;
    vv?.removeEventListener('resize', fit); vv?.removeEventListener('scroll', fit);
  }

  // ---- the steps ----
  function render(step) {
    if (step === 'keys' && !rec) step = 'what';
    if (step === 'which' && !S.type) step = 'what';
    if (step === 'ready' && !S.card) step = S.type ? 'which' : 'what';
    S.step = step; save(); root.dataset.step = step;
    ({ keys, what, which, ready })[step]();
    const n = QUESTIONS.indexOf(step) + 1;
    const dots = n ? h('div.setup-steps', { 'data-setup-step': n }, h('span.setup-dots', { 'aria-hidden': 'true' }, ...QUESTIONS.map((_, i) => h(`i${i < n ? '.on' : ''}`))), h('span', {}, `Step ${n} of 3`)) : h('span');
    head.replaceChildren(...(canGoBack(step)
      ? [h('button.setup-back', { type: 'button', 'aria-label': 'Back', 'data-setup-back': '', ...(again && step === 'what' ? { 'data-launcher-back': '' } : {}), onclick: goBack }, icon('arrow-left')), dots]
      : [dots, step === 'what' ? h('span.setup-floor', {}, `Floor ${page.state.floor.number}`) : h('span')]));
    main.scrollTop = 0;
    // The heading takes the focus, never a field: the keyboard shouldn't jump up unasked.
    root.querySelector('.setup-q')?.focus({ preventScroll: true });
  }
  const q = (t) => h('h1.setup-q', { tabindex: '-1' }, t);
  const btn = (cls, attrs, ...kids) => h(`button.setup-btn.${cls}`, { type: 'button', ...attrs }, ...kids);
  const face = (a) => h('span.setup-face', { css: { '--face': FACE[a?.role] || '#ECE4D8' } }, page.face(a));
  // The manager's on the phone, so the faces in the room are everyone else.
  const crew = () => { const all = page.state.agents || []; const rest = all.filter((a) => a.role !== 'manager'); return rest.length ? rest : all; };

  function toTheManager() {
    remember(page.slug, { out: true });
    close();
    page.setTab?.('chat');
    if (window.innerWidth > 760) page.bodyEl?.querySelector('.chat-input textarea')?.focus();
  }

  function keys() {
    main.replaceChildren(q('The keys are yours.'),
      h('p.setup-sub', {}, 'Keep this recovery code somewhere safe. It is the only way back in from another device, and it won\'t be shown again.'),
      h('div.setup-keys', { 'data-setup-keys': '' }, recoveryBox(rec.code)));
    foot.replaceChildren(btn('primary.wide', { 'data-setup-saved': '', onclick: () => { session.pendingRecovery = null; page.recoveryEl?.remove(); page.recoveryEl = null; render('what'); } }, 'I\'ve saved it'));
  }
  function what() {
    const team = crew().slice(0, 3);
    main.replaceChildren(
      h('div.setup-team', {}, h('span.setup-faces', {}, ...team.map(face)), h('span', {}, 'The team is stretching. Pick a job.')),
      q('What are we making?'),
      h('div.setup-list', {}, ...types.map(([id, label, blurb]) => h('button.setup-choice', { type: 'button', 'data-type': id, onclick: () => { Object.assign(S, { type: id, label, picked: '', own: '' }); render('which'); } },
        h('span.setup-tile', { css: { background: TILE[id] || '#FFF2D6' } }, typeIcon(id)), h('span', {}, h('b', {}, label), h('small', {}, blurb))))));
    foot.replaceChildren(btn('ghost.wide.setup-out', { 'data-setup-out': '', onclick: toTheManager }, 'I\'d rather just tell the manager'));
  }
  function which() {
    const who = (page.state.agents || []).find((a) => a.role === 'researcher')?.name;
    const list = h('div.setup-list', {}, h('p.setup-loading', {}, 'Thinking of ideas...'));
    const own = h('textarea', { name: 'own', rows: 3, maxlength: 400, placeholder: S.type === 'game' ? 'A frog who delivers mail across a swamp...' : 'Say it in your own words...', 'aria-label': 'In your own words' });
    own.value = S.own;
    let cards = [];
    const chosen = () => cards.find((c) => c.id === S.picked);
    const next = btn('primary.wide', { 'data-next': '', disabled: true, onclick: async () => {
      const card = chosen();
      if (card) { pick(card); return; }
      const t = own.value.trim(); if (!t) { own.focus(); return; }
      next.disabled = true;
      try { const r = await wordsToCard(page, S.type, t); if (root.isConnected) pick(r.card); } catch (e) { toast(e.message, 'bad'); refresh(); }
    } }, 'Next');
    const refresh = () => {
      for (const b of list.querySelectorAll('[data-idea]')) { const on = b.dataset.idea === S.picked; b.classList.toggle('sel', on); b.setAttribute('aria-pressed', String(on)); }
      next.disabled = !(chosen() || own.value.trim());
    };
    own.addEventListener('input', () => { S.own = own.value; if (own.value.trim()) S.picked = ''; save(); refresh(); });
    main.replaceChildren(q('Which one?'), h('p.setup-sub', {}, `${S.label.split(' ')[0]} ideas from ${who || 'the team'}. Tap one, or tell us yours.`), list,
      h('label.setup-own', {}, h('span.setup-label', {}, 'Or in your own words'), own));
    foot.replaceChildren(next);
    const mine = ++asking;
    fetchIdeas(page, S.type).then((r) => {
      if (mine !== asking || !list.isConnected) return;  // they've moved on
      cards = r.cards;
      list.replaceChildren(
        ...cards.map((c) => h('button.setup-choice.idea', { type: 'button', 'data-idea': c.id, onclick: () => { S.picked = c.id; S.own = ''; own.value = ''; save(); refresh(); } }, h('span', {}, h('b', {}, c.title), h('small', {}, c.pitch)), ideaTag(c))),
        btn('soft.wide', { 'data-surprise': '', onclick: () => pick(r.surprise) }, icon('sparkle'), 'Surprise me'));
      if (S.picked && !chosen()) S.picked = '';
      refresh();
    }).catch((e) => {
      if (mine !== asking || !list.isConnected) return;
      list.replaceChildren(h('p.bad', {}, e.message), btn('soft.wide', { 'data-setup-retry': '', onclick: () => which() }, 'Try again'));
    });
  }
  function pick(card) {
    S.card = card;
    Object.assign(S, { name: card.name, pitch: card.pitch, goal: card.goal, plan: (card.plan || []).join('\n') });
    if (!S.typedCompany) S.company = card.name;
    render('ready');
  }
  function ready() {
    const nameless = !!page.state.floor.setup;
    const input = (name, maxlength, what) => { const i = h('input', { name, maxlength, autocomplete: 'off', 'aria-label': what }); i.value = S[name]; return i; };
    const field = (label, el) => h('label.setup-field', {}, h('span.setup-label', {}, label), h('span.setup-input', {}, el, icon('pencil-simple')));
    const company = nameless ? input('company', 60, 'Company name') : null;
    const name = input('name', 40, nameless ? 'What we are making' : 'Name'), goal = input('goal', 200, 'Goal');
    for (const [k, el] of Object.entries({ company, name, goal })) el?.addEventListener('input', () => { S[k] = el.value; if (k === 'company') S.typedCompany = true; el.closest('.setup-field').classList.remove('bad'); save(); });
    const complain = (el, why) => { const f = el.closest('.setup-field'); f.classList.add('bad'); f.querySelector('small')?.remove(); f.append(h('small', {}, why)); el.focus(); };
    const steps = S.plan.split('\n').filter(Boolean);
    const rows = steps.map((_, i) => { const r = h('input', { 'data-plan-step': i, maxlength: 120, autocomplete: 'off', 'aria-label': `Step ${i + 1} of the plan` }); r.value = steps[i]; r.addEventListener('input', () => { steps[i] = r.value; S.plan = steps.filter(Boolean).join('\n'); save(); }); return r; });
    const team = crew();
    const go = btn('primary.wide.setup-go', { 'data-go': '', onclick: async () => {
      if (company && company.value.trim().length < 2) { complain(company, 'The company needs a name of at least two letters.'); return; }
      if (!name.value.trim()) { complain(name, 'Give it a name.'); return; }
      go.disabled = true; go.textContent = 'Starting...';
      try {
        const plan = rows.map((r) => r.value.trim()).filter(Boolean);
        await startWork(page, { type: S.type, card: S.card, name: name.value.trim(), pitch: S.pitch, goal: goal.value.trim(), ...(plan.length ? { plan } : {}), ...(company ? { company: company.value.trim() } : {}) });
      } catch (e) { toast(e.message, 'bad'); go.disabled = false; go.replaceChildren(icon('rocket-launch'), 'Go'); return; }
      forget(page.slug);
      try { await landInChat(page); } finally { close(); }
    } }, icon('rocket-launch'), 'Go');
    main.replaceChildren(q('Ready?'),
      company ? field('Company name', company) : null,
      field(nameless ? 'What we\'re making' : 'Name', name),
      field('Goal', goal),
      steps.length ? h('div.setup-field', {}, h('span.setup-label', {}, 'The plan'), h('div.setup-plan', {}, ...rows.map((r, i) => h('div.setup-plan-row', {}, face(team[i % team.length]), r)))) : null);
    foot.replaceChildren(go, h('p.setup-fine', {}, 'Nothing goes live or spends money until you say so.'));
  }

  page.setupEl = root;
  page.root.append(root);
  if (vv) { vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); fit(); }
  root.addEventListener('focusin', () => setTimeout(keepFieldInView, 300));
  render(rec ? 'keys' : S.step);
}
