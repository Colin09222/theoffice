// The floor's status card (docs/redesign/OFFICE-ANSWERS-1.md, Q4, section 3 sketches, job 15). For everyone: company, floor number, boss, lane,
// the state badge (drawn by the page header), goal, now (step N of M), last shipped (thumbnail, name, how long ago), next, Visit website and
// Share. The boss also gets the one open question with reply chips, and a message box. Every field comes from task data; no model is asked.
// The weekly fuel gauge and Approve plan (jobs 20 and 21) are on hold: their places are marked and left empty.
import { h, api, clear, put, toast, timeAgo, BASE } from './dom.js';
import { icon } from './icons.js';

const QUICK = ['Yes', 'No', 'You decide'];
const OPEN = new Set(['todo', 'working', 'review', 'waiting']);

/** The job on show under Now: the newest open card the page holds (it is live), else what the snapshot said. */
function nowOf(s) {
  const live = (s.jobs || []).filter((c) => OPEN.has(c.state)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
  return live ? { line: live.line, state: live.state } : s.status?.now || null;
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
    nothingYet ? h('p.stc-empty', {}, 'Just moved in. First job starts soon.') : h('dl.stc-fields', {},
      st.goal ? row('Goal', h('span.stc-goal', {}, st.goal)) : null,
      row('Now', now ? h('span.stc-now', { 'data-state': now.state }, now.line) : h('span.stc-quiet', {}, 'Nothing under way')),
      shipped ? row('Last shipped', h('a.stc-shipped', { href: shipped.url || '#', target: '_blank', rel: 'noopener noreferrer', 'data-shipped': shipped.slug },
        h('img', { src: shipped.thumb, alt: '', width: '64', height: '40', loading: 'lazy' }), h('span', {}, h('b', {}, shipped.title), h('small', {}, timeAgo(shipped.publishedAt))))) : null,
      st.next ? row('Next', h('span.stc-next', {}, st.next)) : null),
    // Jobs 20 and 21, on hold: the weekly fuel gauge and Approve plan go here, for the boss only. Nothing is drawn until they are built.
    page.owner ? h('div.stc-slot', { 'data-slot': 'fuel-gauge', hidden: true }) : null,
    page.owner ? h('div.stc-slot', { 'data-slot': 'approve-plan', hidden: true }) : null,
    page.owner ? bossBits(page) : null,
    h('div.card-actions', {},
      site ? h('a.btn.primary', { href: site.appUrl || site.url, target: '_blank', rel: 'noopener noreferrer', 'data-visit': '' }, 'Visit website') : null,
      h('button.btn', { type: 'button', 'data-share': '', onclick: () => shareFloor(page) }, icon('share-fat'), 'Share')));
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
