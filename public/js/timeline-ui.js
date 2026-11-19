// The floor's Timeline (docs/redesign/OFFICE-ANSWERS-1.md, Q5 and section 3 "Timeline item"): one card per job, newest first, each with a small
// bean face, one line of what is happening, the time and, when there is one, a photo of the step. Every word comes from the server's job
// cards, built by code. The boss's own conversation with the manager shows too; bean-to-bean small talk does not. A new card slides in;
// a card that changes is updated where it is, and nothing else moves.
import { h, timeAgo } from './dom.js';

const MAX_ITEMS = 60;
const STATE_WORD = { todo: 'Up next', working: 'Working', review: 'Handed in', waiting: 'Waiting', done: 'Done', failed: 'Not finished', cancelled: 'Called off' };
const plain = (s, n = 220) => { const t = String(s || '').replace(/[*_`#>[\]]/g, '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** The conversation that belongs on the timeline: the boss's words and the manager's replies to them, when this viewer may read them. */
function talkWithBoss(F) {
  return (F.state.messages || []).filter((m) => m.role === 'boss' || m.role === 'manager').map((m) => ({ kind: 'msg', at: m.createdAt || 0, m }));
}
function jobItem(F, card) {
  const who = F.person(card.agentId, card.who) || F.manager;
  return h(`li.tl-item.tl-job`, { 'data-job': card.id, 'data-state': card.state },
    h('span.tl-face', { 'aria-hidden': 'true' }, F.face(who)),
    h('div.tl-body', {},
      h('div.tl-top', {}, h('b.tl-title', {}, card.title), h('span.tl-state', { 'data-state': card.state }, STATE_WORD[card.state] || '')),
      h('p.tl-line', {}, card.line),
      h('time.tl-time', { datetime: new Date(card.updatedAt || Date.now()).toISOString() }, timeAgo(card.updatedAt || Date.now()))),
    card.thumb ? h('a.tl-thumb', { href: card.thumb, target: '_blank', rel: 'noopener', 'aria-label': `A picture of ${card.title}` }, h('img', { src: card.thumb, alt: '', loading: 'lazy', width: '160', height: '100' })) : null);
}
function msgItem(F, m) {
  const boss = m.role === 'boss';
  const who = boss ? { ...F.state.floor.boss, boss: true } : F.person(m.agentId) || F.manager;
  return h(`li.tl-item.tl-msg.${boss ? 'boss' : 'manager'}`, { 'data-msg': m.id },
    h('span.tl-face', { 'aria-hidden': 'true' }, F.face(who)),
    h('div.tl-body', {},
      h('div.tl-top', {}, h('b.tl-title', {}, boss ? (F.state.floor.boss?.name || 'The boss') : (who?.name || 'The manager'))),
      h('p.tl-line', {}, plain(m.text)),
      h('time.tl-time', {}, timeAgo(m.createdAt || Date.now()))));
}

/** Draw the whole timeline into the panel's body. */
export function renderTimeline(F) {
  const list = h('ol.timeline', { role: 'log', 'aria-live': 'polite', 'aria-label': 'What the team is doing' });
  const items = [...(F.state.jobs || []).map((c) => ({ kind: 'job', at: c.updatedAt || 0, c })), ...talkWithBoss(F)]
    .sort((a, b) => b.at - a.at).slice(0, MAX_ITEMS);
  if (!items.length) list.append(h('li.empty', {}, 'Just moved in. First job starts soon.'));
  for (const it of items) list.append(it.kind === 'job' ? jobItem(F, it.c) : msgItem(F, it.m));
  F.timelineEl = list;
  F.bodyEl.append(list);
}

/** A job card changed or a new one came in. In place if it is on show; a new one slides in at the top. */
export function onJobCard(F, card) {
  F.state.jobs ||= [];
  const i = F.state.jobs.findIndex((c) => c.id === card.id);
  if (i >= 0) F.state.jobs[i] = card; else F.state.jobs.unshift(card);
  F.cardSoon?.();  // the status card's Now follows the newest job
  const list = F.timelineEl;
  if (!list?.isConnected) return;
  const el = jobItem(F, card);
  const old = list.querySelector(`[data-job="${card.id}"]`);
  if (old) { old.replaceWith(el); return; }
  list.querySelector('.empty')?.remove();
  el.classList.add('tl-new');
  list.prepend(el);
}
/** The boss or the manager said something: it goes at the top. */
export function onTimelineMessage(F, m) {
  const list = F.timelineEl;
  if (!list?.isConnected || !['boss', 'manager'].includes(m.role) || list.querySelector(`[data-msg="${m.id}"]`)) return;
  list.querySelector('.empty')?.remove();
  const el = msgItem(F, m);
  el.classList.add('tl-new');
  list.prepend(el);
}
