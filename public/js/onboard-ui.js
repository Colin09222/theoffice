// Onboarding (round 1 rest, job 23; the spec's Q7 and section 4): a new code holder's first three minutes, full screen on the floor.
// "This is your floor" and three lane cards (Game, Website, Business), then a template with its price as information, three short questions, and the
// manager's plan: the goal, up to 5 jobs with their done-means lines, and "This will cost about $X". One button, Start, which starts the work: it is not
// a price approval. "Something else" is the plain message box to the manager. Built on Setup's screen (setup-ui.js) and its styles.
import { h, api, session, recoveryBox, toast } from './dom.js';
import { icon } from './icons.js';
import { typeIcon } from './launch-ui.js';

const TILE = { game: '#FFE6EF', website: '#E3F6EC', business: '#FFF2D6' };
const STEPS = ['lanes', 'template', 'questions', 'plan'];

/** Opens onboarding over the floor. `out` is Setup's way to the manager chat (the "Something else" box). */
export function openOnboarding(page, { out }) {
  if (page.setupEl?.isConnected) return;
  const rec = session.pendingRecovery?.slug === page.slug ? session.pendingRecovery : null;
  const S = { lanes: [], lane: null, template: null, answers: ['', '', ''], plan: page.state.onboarding?.plan || null };
  const head = h('div.setup-head'), main = h('div.setup-main'), foot = h('div.setup-foot');
  const root = h('div.setup.onboard', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Set up your floor', 'data-onboard': '' }, head, main, foot);
  const q = (t) => h('h1.setup-q', { tabindex: '-1' }, t);
  const btn = (cls, attrs, ...kids) => h(`button.setup-btn.${cls}`, { type: 'button', ...attrs }, ...kids);
  const back = { lanes: rec ? 'keys' : null, template: 'lanes', questions: 'template', plan: 'questions' };
  const vv = window.visualViewport;
  const fit = () => {
    if (!root.isConnected) { vv?.removeEventListener('resize', fit); vv?.removeEventListener('scroll', fit); return; }
    root.style.setProperty('--setup-top', `${Math.round(vv.offsetTop)}px`);
    root.style.setProperty('--setup-h', `${Math.round(vv.height)}px`);
  };
  const close = () => { root.remove(); page.setupEl = null; vv?.removeEventListener('resize', fit); vv?.removeEventListener('scroll', fit); };
  const somethingElse = () => btn('ghost.wide.setup-out', { 'data-something-else': '', onclick: () => { close(); out(); } }, 'Something else');

  function render(step) {
    if (step === 'keys' && !rec) step = 'lanes';
    if (step === 'template' && !S.lane) step = 'lanes';
    if (step === 'questions' && !S.template) step = S.lane ? 'template' : 'lanes';
    if (step === 'plan' && !S.plan) step = S.template ? 'questions' : 'lanes';
    root.dataset.step = step;
    ({ keys, lanes, template, questions, plan })[step]();
    const n = STEPS.indexOf(step) + 1;
    const dots = n ? h('div.setup-steps', {}, h('span.setup-dots', { 'aria-hidden': 'true' }, ...STEPS.map((_, i) => h(`i${i < n ? '.on' : ''}`))), h('span', {}, `${n} of ${STEPS.length}`)) : h('span');
    head.replaceChildren(...(back[step] && !(step === 'plan' && !S.template)
      ? [h('button.setup-back', { type: 'button', 'aria-label': 'Back', 'data-setup-back': '', onclick: () => render(back[step]) }, icon('arrow-left')), dots]
      : [dots, h('span.setup-floor', {}, `Floor ${page.state.floor.number}`)]));
    main.scrollTop = 0;
    root.querySelector('.setup-q')?.focus({ preventScroll: true });
  }

  function keys() {
    main.replaceChildren(q('The keys are yours.'),
      h('p.setup-sub', {}, 'Keep this recovery code somewhere safe. It is the only way back in from another device, and it won\'t be shown again.'),
      h('div.setup-keys', { 'data-setup-keys': '' }, recoveryBox(rec.code)));
    foot.replaceChildren(btn('primary.wide', { 'data-setup-saved': '', onclick: () => { session.pendingRecovery = null; page.recoveryEl?.remove(); page.recoveryEl = null; render('lanes'); } }, 'I\'ve saved it'));
  }
  function lanes() {
    main.replaceChildren(q('This is your floor'), h('p.setup-sub', {}, 'Your team is at their desks. What should they make first?'),
      h('div.setup-list', { 'data-lanes': '' }, ...S.lanes.map((l) => h('button.setup-choice.lane', { type: 'button', 'data-lane': l.id, onclick: () => { if (S.lane?.id !== l.id) { S.template = null; S.answers = ['', '', '']; } S.lane = l; render('template'); } },
        h('span.setup-tile', { css: { background: TILE[l.id] || '#FFF2D6' } }, typeIcon(l.id)), h('span', {}, h('b', {}, l.label), h('small', {}, l.blurb))))));
    foot.replaceChildren(somethingElse());
  }
  function template() {
    main.replaceChildren(q(`${S.lane.label}: which kind?`), h('p.setup-sub', {}, 'Prices are a guide, from what jobs like these have cost.'),
      h('div.setup-list', { 'data-templates': '' }, ...S.lane.templates.map((t) => h('button.setup-choice', { type: 'button', 'data-template': t.id, onclick: () => { S.template = t; render('questions'); } },
        h('span', {}, h('b', {}, t.label), h('small.ob-price', { 'data-price': '' }, t.price))))));
    foot.replaceChildren(somethingElse());
  }
  function questions() {
    const inputs = S.lane.questions.map((label, i) => {
      const el = h('input', { name: `answer-${i}`, maxlength: 300, autocomplete: 'off', 'aria-label': label, placeholder: i === 2 ? 'Optional' : 'A few words' });
      el.value = S.answers[i];
      el.addEventListener('input', () => { S.answers[i] = el.value; el.closest('.setup-field').classList.remove('bad'); });
      return el;
    });
    const go = btn('primary.wide', { 'data-ask-plan': '', onclick: async () => {
      const empty = inputs.slice(0, 2).find((el) => !el.value.trim());
      if (empty) { empty.closest('.setup-field').classList.add('bad'); empty.focus(); return; }
      go.disabled = true; go.textContent = 'The manager is writing the plan...';
      try {
        const r = await api(`/floors/${page.slug}/onboarding/plan`, { method: 'POST', body: { lane: S.lane.id, template: S.template.id, answers: inputs.map((el) => el.value.trim()) } });
        S.plan = r.plan; if (root.isConnected) render('plan');
      } catch (e) { toast(e.message, 'bad'); go.disabled = false; go.textContent = 'Show me the plan'; }
    } }, 'Show me the plan');
    main.replaceChildren(q(S.template.label), h('p.setup-sub', {}, 'Three quick questions for the manager.'),
      ...inputs.map((el, i) => h('label.setup-field', {}, h('span.setup-label', {}, S.lane.questions[i]), h('span.setup-input', {}, el))));
    foot.replaceChildren(go);
  }
  function plan() {
    const p = S.plan;
    const start = btn('primary.wide.setup-go', { 'data-start': '', onclick: async () => {
      start.disabled = true; start.textContent = 'Starting...';
      try { await api(`/floors/${page.slug}/onboarding/start`, { method: 'POST', body: { plan: p.id } }); }
      catch (e) { toast(e.message, 'bad'); start.disabled = false; start.replaceChildren(icon('rocket-launch'), 'Start'); return; }
      close();
      toast('The team is on it');
      page.tab = 'talk'; page.panelOpen = true;
      await page.reload?.();
    } }, icon('rocket-launch'), 'Start');
    main.replaceChildren(q('The plan'),
      h('p.ob-goal', { 'data-plan-goal': '' }, h('span.setup-label', {}, 'Goal'), h('b', {}, p.goal)),
      h('ol.ob-jobs', { 'data-plan-jobs': '' }, ...p.jobs.map((j) => h('li', {}, h('b', {}, j.title), h('ul.ob-done', { 'aria-label': 'Done means' }, ...j.checks.map((c) => h('li', {}, c)))))),
      p.estimate?.line ? h('p.ob-est', { 'data-plan-estimate': '' }, p.estimate.line) : null);
    foot.replaceChildren(start, somethingElse());
  }

  page.setupEl = root;
  page.root.append(root);
  if (vv) { vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); fit(); }
  main.replaceChildren(h('p.setup-loading', {}, 'Opening the door...'));
  api(`/floors/${page.slug}/onboarding`).then((r) => {
    S.lanes = r.lanes; if (r.plan?.status === 'draft') S.plan = r.plan;
    if (!root.isConnected) return;
    render(rec ? 'keys' : S.plan ? 'plan' : 'lanes');
  }).catch(() => { if (root.isConnected) { close(); out(); } });
}
