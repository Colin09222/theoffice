// Setup: a fresh floor's first run, on a screen of its own. What are we making, which one, then Ready: the company's name, the plan, one big Go.
// The questions and their endpoints are the launcher's (launch-ui.js). A floor that already has a name never gets this by itself; "Make something new" opens the same flow later.
import { h, session, recoveryBox, toast } from './dom.js';
import { icon } from './icons.js';
import { LAUNCH_NOTE, launchTypes, typeIcon, ideaTag, fetchIdeas, wordsToCard, startWork, landInChat } from './launch-ui.js';

const QUESTIONS = ['what', 'which', 'ready'];
// The place a boss has reached is kept per floor, per device. The recovery code is never in it.
const placeKey = (slug) => `office-setup-${slug}`;
const recall = (slug) => { try { return JSON.parse(localStorage.getItem(placeKey(slug))) || {}; } catch { return {}; } };
const remember = (slug, v) => { try { localStorage.setItem(placeKey(slug), JSON.stringify(v)); } catch { /* private browsing: the place is lost on a reload, and nothing else */ } };
const forget = (slug) => { try { localStorage.removeItem(placeKey(slug)); } catch { /* as above */ } };
const text = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');

/** What a saved place is worth: anything stale or broken falls back to the start rather than to a crash. */
function restored(saved, types) {
  const s = { step: 'what', type: '', label: '', seed: 0, own: '', card: null, company: '', typedCompany: false, name: '', pitch: '', goal: '', plan: '' };
  const t = types.find(([id]) => id === saved.type);
  if (!t) return s;
  Object.assign(s, { type: t[0], label: t[1], seed: Number.isInteger(saved.seed) && saved.seed >= 0 ? saved.seed : 0, own: text(saved.own, 400), step: saved.step === 'what' ? 'what' : 'which' });
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
  let depth = history.state?.setup?.slug === page.slug ? history.state.setup.depth : 0;
  let settling = null, asking = 0;

  const save = () => { if (!again) remember(page.slug, { ...S, card: S.card }); };
  const entry = (step) => ({ setup: { slug: page.slug, step, depth } });

  // ---- moving between steps. Each step is a history entry, so the phone's Back gesture and the button here are the same Back. ----
  const backOf = { keys: null, what: rec ? 'keys' : null, which: 'what', ready: 'which' };
  function forward(step) { depth += 1; history.pushState(entry(step), '', location.href); render(step); }
  function goBack() {
    if (again && S.step === 'what') { close(); return; }
    const to = backOf[S.step];
    if (!to) return;
    if (depth > 0) { history.back(); return; }
    render(to); history.replaceState(entry(to), '', location.href);
  }
  const onPop = (e) => {
    if (!root.isConnected) { window.removeEventListener('popstate', onPop, true); return; }
    if (settling) { e.stopImmediatePropagation(); settling(); return; }
    const at = e.state?.setup;
    if (at?.slug === page.slug) { e.stopImmediatePropagation(); depth = at.depth; render(at.step); }
    // Anything else is a real trip off this floor, the router's to handle; the place is saved for the way back.
  };
  // Before leaving Setup or naming the floor (the name can change the address), come back down to the floor's own history entry.
  const unwind = () => new Promise((done) => {
    if (!depth) { done(); return; }
    const finish = () => { if (settling === finish) settling = null; done(); };
    settling = finish;
    history.go(-depth); depth = 0;
    setTimeout(finish, 500);
  });

  // ---- the screen follows the part of the phone you can actually see, keyboard and browser bars included ----
  const vv = window.visualViewport;
  const fit = () => {
    if (!root.isConnected) { vv?.removeEventListener('resize', fit); vv?.removeEventListener('scroll', fit); return; }
    root.style.setProperty('--setup-top', `${Math.round(vv.offsetTop)}px`);
    root.style.setProperty('--setup-h', `${Math.round(vv.height)}px`);
    keepFieldInView();
  };
  const keepFieldInView = () => { const f = document.activeElement; if (f && /^(INPUT|TEXTAREA)$/.test(f.tagName) && main.contains(f)) f.scrollIntoView({ block: 'center' }); };

  function close() {
    root.remove(); page.setupEl = null;
    window.removeEventListener('popstate', onPop, true);
    vv?.removeEventListener('resize', fit); vv?.removeEventListener('scroll', fit);
    if (history.state?.setup) { const { setup: _, ...rest } = history.state; history.replaceState(rest, '', location.href); }
  }

  // ---- the steps ----
  function render(step) {
    if (step === 'keys' && !rec) step = 'what';
    if (step === 'which' && !S.type) step = 'what';
    if (step === 'ready' && !S.card) step = S.type ? 'which' : 'what';
    S.step = step; save(); root.dataset.step = step;
    ({ keys, what, which, ready })[step]();
    const n = QUESTIONS.indexOf(step) + 1;
    head.replaceChildren(
      backOf[step] || (again && step === 'what')
        ? h('button.setup-back', { type: 'button', 'data-setup-back': '', ...(again && step === 'what' ? { 'data-launcher-back': '' } : {}), onclick: goBack }, icon('arrow-left'), 'Back')
        : h('span.setup-back-gap'),
      n ? h('div.setup-progress', { 'data-setup-step': n }, h('span', {}, `Step ${n} of 3`), h('div.setup-dots', { 'aria-hidden': 'true' }, ...QUESTIONS.map((_, i) => h(`i${i < n ? '.on' : ''}`)))) : null);
    main.scrollTop = 0;
    // The heading takes the focus, never a field: the keyboard shouldn't jump up unasked.
    root.querySelector('.setup-q')?.focus({ preventScroll: true });
  }
  const q = (t) => h('h1.setup-q', { tabindex: '-1' }, t);
  const wayOut = () => (again ? null : h('button.link.setup-out', { type: 'button', 'data-setup-out': '', onclick: toTheManager }, 'I\'d rather just tell the manager'));

  async function toTheManager() {
    await unwind();
    remember(page.slug, { out: true });
    close();
    page.setTab?.('chat');
    if (window.innerWidth > 760) page.bodyEl?.querySelector('.chat-input textarea')?.focus();
  }

  function keys() {
    main.replaceChildren(q('The keys are yours.'),
      h('p.setup-sub', {}, 'Keep this recovery code somewhere safe. It is the only way back in from another device, and it won\'t be shown again.'),
      h('div.setup-keys', { 'data-setup-keys': '' }, recoveryBox(rec.code)));
    foot.replaceChildren(h('button.btn.primary.setup-go', { type: 'button', 'data-setup-saved': '', onclick: () => { session.pendingRecovery = null; page.recoveryEl?.remove(); page.recoveryEl = null; forward('what'); } }, 'I\'ve saved it'));
  }
  function what() {
    main.replaceChildren(q('What are we making?'),
      h('div.setup-types', {}, ...types.map(([id, label, blurb]) => h('button.setup-type', { type: 'button', 'data-type': id, onclick: () => { Object.assign(S, { type: id, label, seed: 0 }); forward('which'); } }, typeIcon(id), h('b', {}, label), h('span', {}, blurb)))),
      h('p.setup-fine', {}, LAUNCH_NOTE));
    foot.replaceChildren(...[wayOut()].filter(Boolean));
  }
  function which() {
    const cards = h('div.setup-cards', {}, h('p.setup-loading', {}, 'Thinking of ideas...'));
    const own = h('textarea', { name: 'own', rows: 2, maxlength: 400, placeholder: S.type === 'game' ? 'A frog who delivers mail across a swamp...' : 'Say it in your own words...', 'aria-label': 'In your own words' });
    own.value = S.own;
    const useOwn = h('button.btn.primary.setup-go', { type: 'button', 'data-own': '', hidden: !S.own.trim(), onclick: async () => {
      const t = own.value.trim(); if (!t) { own.focus(); return; }
      useOwn.disabled = true;
      try { const r = await wordsToCard(page, S.type, t); if (root.isConnected) pick(r.card); } catch (e) { toast(e.message, 'bad'); useOwn.disabled = false; }
    } }, 'Use my words');
    own.addEventListener('input', () => { S.own = own.value; save(); useOwn.hidden = !own.value.trim(); });
    main.replaceChildren(q(`Which ${S.label.toLowerCase().split(' ')[0]}?`), cards,
      h('button.link.setup-more', { type: 'button', 'data-more': '', onclick: () => { S.seed += 1; save(); which(); main.scrollTop = 0; } }, 'More ideas'),
      h('label.setup-own', {}, h('span', {}, 'Or in your own words'), own));
    foot.replaceChildren(useOwn, ...[wayOut()].filter(Boolean));
    const mine = ++asking;
    fetchIdeas(page, S.type, S.seed).then((r) => {
      if (mine !== asking || !cards.isConnected) return;  // they've moved on
      cards.replaceChildren(
        ...r.cards.map((c) => h('button.setup-card', { type: 'button', 'data-idea': c.id, onclick: () => pick(c) }, h('b', {}, c.title), h('span', {}, c.pitch), ideaTag(c))),
        h('button.setup-card.surprise', { type: 'button', 'data-surprise': '', onclick: () => pick(r.surprise) }, icon('sparkle'), h('b', {}, 'Surprise me'), h('span', {}, 'The team picks one it believes in')));
    }).catch((e) => {
      if (mine !== asking || !cards.isConnected) return;
      cards.replaceChildren(h('p.bad', {}, e.message), h('button.btn.ghost', { type: 'button', 'data-setup-retry': '', onclick: () => which() }, 'Try again'));
    });
  }
  function pick(card) {
    S.card = card;
    Object.assign(S, { name: card.name, pitch: card.pitch, goal: card.goal, plan: (card.plan || []).join('\n') });
    if (!S.typedCompany) S.company = card.name;
    forward('ready');
  }
  function ready() {
    const nameless = !!page.state.floor.setup;
    const input = (name, maxlength, what) => { const i = h('input', { name, maxlength, autocomplete: 'off', 'aria-label': what }); i.value = S[name]; return i; };
    const area = (name, maxlength, rows, what) => { const i = h('textarea', { name, maxlength, rows, 'aria-label': what }); i.value = S[name]; return i; };
    const field = (label, el, hint) => h('label.setup-field', {}, h('span', {}, label), el, hint ? h('small', {}, hint) : null);
    const company = nameless ? input('company', 60, 'Company name') : null;
    const name = input('name', 40, 'What we are making'), pitch = area('pitch', 400, 2, 'What it is'), goal = input('goal', 200, 'Goal'), plan = area('plan', 600, 4, 'The plan, one step a line');
    const fields = { company, name, pitch, goal, plan };
    for (const [k, el] of Object.entries(fields)) el?.addEventListener('input', () => { S[k] = el.value; if (k === 'company') S.typedCompany = true; el.closest('.setup-field').classList.remove('bad'); save(); });
    const complain = (el, why) => { const f = el.closest('.setup-field'); f.classList.add('bad'); f.querySelector('small') ? (f.querySelector('small').textContent = why) : f.append(h('small', {}, why)); el.focus(); };
    const go = h('button.btn.primary.setup-go', { type: 'button', 'data-go': '', onclick: async () => {
      if (company && company.value.trim().length < 2) { complain(company, 'The company needs a name of at least two letters.'); return; }
      if (!name.value.trim()) { complain(name, 'Give it a name.'); return; }
      go.disabled = true; go.textContent = 'Starting...';
      try {
        await unwind();
        await startWork(page, { type: S.type, card: S.card, name: name.value.trim(), pitch: pitch.value.trim(), goal: goal.value.trim(), plan: plan.value.split('\n').map((s) => s.trim()).filter(Boolean), ...(company ? { company: company.value.trim() } : {}) });
      } catch (e) { toast(e.message, 'bad'); go.disabled = false; go.replaceChildren(icon('rocket-launch'), 'Go'); return; }
      forget(page.slug);
      try { await landInChat(page); } finally { close(); }
    } }, icon('rocket-launch'), 'Go');
    main.replaceChildren(q('Ready?'),
      h('div.setup-ready', {},
        company ? field('Company name', company, 'What the company is called. Change it any time.') : null,
        field('What we\'re making', name), field('What it is', pitch), field('Goal', goal), field('Plan', plan, 'One step a line.')));
    foot.replaceChildren(go, ...[wayOut()].filter(Boolean));
  }

  page.setupEl = root;
  page.root.append(root);
  window.addEventListener('popstate', onPop, true);
  if (vv) { vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); fit(); }
  root.addEventListener('focusin', () => setTimeout(keepFieldInView, 300));
  const first = rec ? 'keys' : S.step;
  history.replaceState(entry(first), '', location.href);
  render(first);
}
