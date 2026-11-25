// The floor's status card (docs/redesign/OFFICE-ANSWERS-1.md, Q4, section 3 sketches, job 15). For everyone: company, floor number, boss, lane,
// the state badge (drawn by the page header), goal, now (step N of M), last shipped (thumbnail, name, how long ago), next, Visit website and
// Share. The boss also gets the one open question with reply chips, and a message box. Every field comes from task data; no model is asked.
// The weekly fuel gauge and Approve plan (jobs 20 and 21) are on hold: their places are marked and left empty.
import { h, api, clear, put, toast, timeAgo, modal, BASE } from './dom.js';
import { icon } from './icons.js';
import { emptyLine } from './timeline-ui.js';
import { trackersBox } from './trackers-ui.js';

const QUICK = ['Yes', 'No', 'You decide'];
const OPEN = new Set(['todo', 'working', 'review', 'waiting']);

/** A job untouched for a day is not happening now (job 30; the server's NOW_HORIZON_MS). */
const NOW_HORIZON_MS = 24 * 3600e3;
/** The job on show under Now: the newest open card the page holds (it is live) from the last day, else what the snapshot said. */
function nowOf(s) {
  const live = (s.jobs || []).filter((c) => OPEN.has(c.state) && (c.updatedAt || 0) >= Date.now() - NOW_HORIZON_MS).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
  return live ? { line: live.line, state: live.state, estimate: live.estimate || null } : s.status?.now || null;
}
const row = (label, ...kids) => h('div.stc-row', {}, h('dt', {}, label), h('dd', {}, ...kids));

export function renderStatusCard(page, el, { shareFloor }) {
  const s = page.state; const st = s.status || {};
  clear(el);
  el.classList.add('status-card');
  const now = nowOf(s);
  const shipped = st.lastShipped;
  const site = s.projects.find((p) => !p.private && ['site', 'app', 'game', 'simulation'].includes(p.kind));
  const nothingYet = !now && !shipped && !st.goal && !(s.jobs || []).length;
  put(el,
    h('p.stc-who', {}, 'Run by ', h('b', {}, s.floor.boss?.name || 'the boss'), st.lane ? h('span.stc-lane', { 'data-lane': st.lane.toLowerCase() }, st.lane) : null),
    nothingYet ? h('p.stc-empty', {}, emptyLine(st)) : h('dl.stc-fields', {},
      st.goal ? row('Goal', h('span.stc-goal', {}, st.goal)) : null,
      row('Now', now ? h('span.stc-now', { 'data-state': now.state }, now.line) : h('span.stc-quiet', {}, 'Nothing under way'),
        // The boss's copy only: what the job is expected to cost, as information (round 1 rest, j21). A visitor's snapshot never has it.
        page.owner && now?.estimate?.line ? h('small.stc-est', { 'data-estimate': '' }, now.estimate.line) : null),
      shipped ? row('Last shipped', h('a.stc-all', { href: `${BASE}/launched/${page.slug}`, 'data-portfolio': '', onclick: (e) => { e.preventDefault(); window.officeGo(`/launched/${page.slug}`); } }, 'All launches'), h('a.stc-shipped', { href: shipped.url || '#', target: '_blank', rel: 'noopener noreferrer', 'data-shipped': shipped.slug },
        h('img', { src: shipped.thumb, alt: '', width: '64', height: '40', loading: 'lazy' }), h('span', {}, h('b', {}, shipped.title), h('small', {}, timeAgo(shipped.publishedAt))))) : null,
      st.next ? row('Next', h('span.stc-next', {}, st.next)) : null),
    // Jobs 20 and 21, on hold: the weekly fuel gauge and Approve plan go here, for the boss only. Nothing is drawn until they are built.
    page.owner ? h('div.stc-slot', { 'data-slot': 'fuel-gauge', hidden: true }) : null,
    page.owner && s.weekPlan && ['draft', 'approved'].includes(s.weekPlan.status) ? weekPlanBox(page) : null,
    page.owner && st.proposal ? proposalBox(page, st.proposal) : null,
    page.owner ? bossBits(page) : null,
    h('div.card-actions', {},
      site ? h('a.btn.primary', { href: site.appUrl || site.url, target: '_blank', rel: 'noopener noreferrer', 'data-visit': '' }, 'Visit website') : null,
      h('button.btn', { type: 'button', 'data-share': '', onclick: () => shareFloor(page) }, icon('share-fat'), 'Share'),
      page.owner && st.figuresTap ? h('button.link.stc-spend', { type: 'button', 'data-spend': '', onclick: () => openSpend(page) }, 'Spend') : null),
    // Sales and website traffic (server/trackers.js): only in the boss's and the admin's snapshot.
    trackersBox(s));
}

/**
 * This week's proposal (round 2, r2-j64), for the boss: one change, one reason, the number behind it, and Yes or No. No reply in 7 days drops it.
 */
function proposalBox(page, pr) {
  const answer = async (a, box) => {
    for (const b of box.querySelectorAll('button')) b.disabled = true;
    try { await api(`/floors/${page.slug}/proposal/${pr.id}`, { method: 'POST', body: { answer: a } }); box.replaceChildren(h('p.stc-proposal-done', {}, a === 'yes' ? 'Yes: the team has it.' : 'No: dropped.')); } catch (e) { toast(e.message, 'bad'); for (const b of box.querySelectorAll('button')) b.disabled = false; }
  };
  const box = h('section.stc-proposal', { 'data-proposal': String(pr.id) },
    h('h3', {}, "This week's proposal"),
    h('p.stc-proposal-change', {}, pr.change),
    h('p', {}, h('b', {}, 'Why: '), pr.reason),
    h('p', {}, h('b', {}, 'The number: '), pr.number));
  box.append(h('div.card-actions', {}, h('button.btn.small.primary', { type: 'button', 'data-proposal-yes': '', onclick: () => answer('yes', box) }, 'Yes'), h('button.btn.small', { type: 'button', 'data-proposal-no': '', onclick: () => answer('no', box) }, 'No')));
  return box;
}

const dollars = (n) => `$${(Number(n) || 0).toFixed(2)}`;
/**
 * The boss's own floor's dollars, behind the tap (job 34): this week, last week and since the floor opened, split Claude and OpenRouter, and
 * the latest jobs with what each cost. Fetched only now, from the boss's own route. Nothing here is a limit: no gauge, no budget, nothing "left".
 */
async function openSpend(page) {
  let d;
  try { d = await api(`/floors/${page.slug}/spend`); } catch (e) { toast(e.message, 'bad'); return; }
  modal('Spend', (body) => {
    const line = (label, x) => h('tr', {}, h('th', { scope: 'row' }, label), h('td', {}, dollars(x.totalUsd)), h('td', {}, dollars(x.claudeUsd)), h('td', {}, dollars(x.openrouterUsd)));
    body.append(
      h('p.fineprint', {}, 'What your floor has spent. Your floor only.'),
      h('table.spend-table', { 'data-spend-table': '' },
        h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', { scope: 'col' }, 'Total'), h('th', { scope: 'col' }, 'Claude'), h('th', { scope: 'col' }, 'OpenRouter'))),
        h('tbody', {}, line('This week', d.thisWeek), line('Last week', d.lastWeek), line('Since you opened', d.sinceOpened))),
      h('h3.spend-jobs-head', {}, 'Latest jobs'),
      d.jobs.length ? h('ul.spend-jobs', {}, ...d.jobs.map((j) => h('li', { 'data-spend-job': '' }, h('span', {}, j.title), h('b', {}, dollars(j.costUsd)), h('small', {}, timeAgo(j.at)))))
        : h('p.empty', {}, 'No jobs yet.'));
  });
}

/**
 * This week's plan (round 1 rest, j20), for the boss: the goal, the jobs with what each will cost as information, Approve and Edit. Nothing waits
 * for money: a plan nobody approves starts by itself the next morning.
 */
function weekPlanBox(page) {
  const p = page.state.weekPlan;
  const done = (r) => { page.state.weekPlan = r.plan; page.cardSoon?.(); };
  const approve = async () => { try { done(await api(`/floors/${page.slug}/weekplan/approve`, { method: 'POST', body: {} })); toast('Plan approved. The team is on it.'); } catch (e) { toast(e.message, 'bad'); } };
  const editPlan = () => modal('This week\'s plan', (body, close) => {
    const goal = h('input', { type: 'text', value: p.goal, maxlength: 200, 'aria-label': 'This week\'s goal', name: 'plan-goal' });
    const rows = p.jobs.map((j, i) => ({ i, input: h('input', { type: 'text', value: j.title, maxlength: 160, 'aria-label': `Job ${i + 1}`, name: `plan-job-${i}` }), keep: h('input', { type: 'checkbox', checked: true, 'aria-label': `Keep job ${i + 1}` }) }));
    const extra = h('input', { type: 'text', maxlength: 160, placeholder: 'Add a job (optional)', 'aria-label': 'Add a job', name: 'plan-add' });
    body.append(h('form.stack', { onsubmit: async (e) => {
      e.preventDefault();
      const jobs = rows.filter((r) => r.keep.checked).map((r) => ({ keep: r.i, title: r.input.value.trim() }));
      if (extra.value.trim()) jobs.push({ title: extra.value.trim() });
      try { done(await api(`/floors/${page.slug}/weekplan/edit`, { method: 'POST', body: { goal: goal.value.trim(), jobs } })); close(); toast('Plan changed'); } catch (x) { toast(x.message, 'bad'); }
    } }, h('label.field', {}, h('span', {}, 'Goal'), goal), ...rows.map((r) => h('label.field.wp-row', {}, r.keep, r.input)), extra, h('button.btn.primary.wide', { type: 'submit' }, 'Save the plan')));
  });
  return h('div.stc-plan', { 'data-slot': 'approve-plan', 'data-plan': p.id },
    h('p.stc-plan-head', {}, h('b', {}, 'This week\'s plan'), p.status === 'approved' ? h('small', {}, ' Approved: starting as soon as the last job is done') : null),
    h('p.stc-plan-goal', {}, p.goal),
    h('ol.stc-plan-jobs', {}, ...p.jobs.map((j) => h('li', {}, h('span', {}, j.title), j.estimate?.line ? h('small.stc-est', {}, j.estimate.line) : null))),
    p.status === 'draft' ? h('p.stc-plan-auto', {}, 'If you do nothing, the team starts on it by itself tomorrow morning.') : null,
    p.status === 'draft' ? h('div.card-actions', {}, h('button.btn.primary', { type: 'button', 'data-approve-plan': '', onclick: approve }, 'Approve'), h('button.btn', { type: 'button', 'data-edit-plan': '', onclick: editPlan }, 'Edit')) : null);
}

/** The boss's part: the one open question with reply chips, and a message box to the manager. */
function bossBits(page) {
  const s = page.state;
  const q = (s.questions || [])[0];
  const answer = async (text) => {
    try {
      await api(`/floors/${page.slug}/questions/${q.id}/answer`, { method: 'POST', body: { text } });
      s.questions = (s.questions || []).filter((x) => x.id !== q.id);
      page.renderQuestions?.(); page.cardSoon?.();
      toast('Answer sent');
    } catch (e) { toast(e.message, 'bad'); }
  };
  const input = h('input', { type: 'text', maxlength: 4000, placeholder: `Message ${page.manager?.name || 'your manager'}`, 'aria-label': 'Message your office manager', name: 'card-message' });
  const send = async (e) => {
    e.preventDefault();
    const text = input.value.trim(); if (!text) return;
    input.value = '';
    try { await api(`/floors/${page.slug}/chat`, { method: 'POST', body: { text } }); page.view?.bossTalks?.(); toast('Sent to your manager'); } catch (x) { input.value = text; toast(x.message, 'bad'); }
  };
  return h('div.stc-boss', {},
    q ? h('div.stc-question', { 'data-question': q.id },
      h('p', {}, h('b', {}, `${q.agentName || 'Your manager'} asks: `), q.text),
      h('div.chips', {}, ...QUICK.map((t) => h('button.chip', { type: 'button', 'data-reply': t, onclick: () => answer(t) }, t)))) : null,
    h('form.stc-message', { onsubmit: send }, input, h('button.btn.primary', { type: 'submit', 'aria-label': 'Send' }, icon('paper-plane-tilt'))));
}

export const floorShareUrl = (slug) => `${location.origin}${BASE}/floor/${slug}`;
