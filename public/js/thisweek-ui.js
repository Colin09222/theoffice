// "What we made this week" (round 2, r2-j66; docs/redesign/OFFICE-ANSWERS-2.md, Q12 a): the page the server builds every Monday at 08:10 New York
// time from real records: launches, changes shipped with their before and after screenshots, and real visits. A quiet week says so. The last 12
// weeks can be picked. Plain DOM, no 3D, no model: every word on it came from the records.
import { h, api, BASE, timeAgo } from './dom.js';
import { icon } from './icons.js';

const fmtWeek = (w) => new Date(`${w}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });

export async function showThisWeek(root, { week = null } = {}) {
  document.body.dataset.page = 'thisweek';
  const body = h('div.thisweek-body');
  const picker = h('select.thisweek-pick', { 'aria-label': 'Pick a week' });
  root.append(h('div.thisweek-page', {},
    h('header.home-top', {}, h('div.home-brand', {}, h('button.btn.back', { type: 'button', onclick: () => window.officeGo('/') }, icon('arrow-left'), h('span', {}, 'Home')), h('div', {}, h('h1', {}, 'This week in The Office'), h('p', {}, 'What the building made, from the records.'))), picker),
    body));
  const load = async (w) => {
    let d;
    try { d = await api(`/building/thisweek${w ? `?week=${encodeURIComponent(w)}` : ''}`); } catch { body.replaceChildren(h('p.empty', {}, 'Nothing to show yet.')); return; }
    picker.replaceChildren(...d.weeks.map((x) => h('option', { value: x, selected: x === d.week }, `Week of ${fmtWeek(x)}`)));
    picker.hidden = d.weeks.length < 2;
    const p = d.page;
    if (!p) { body.replaceChildren(h('p.empty', { 'data-thisweek-empty': '' }, 'The first week is written next Monday morning.')); return; }
    body.replaceChildren(
      h('p.thisweek-line', { 'data-thisweek-line': '', 'data-quiet': p.quiet ? '1' : '0' }, p.line),
      p.launches.length ? h('section', {}, h('h2', {}, 'Launched'), h('div.thisweek-grid', {}, ...p.launches.map((l) => h('article.lcard', {},
        l.shot ? h('a.lcard-shot', { href: l.url || '#', target: '_blank', rel: 'noopener noreferrer' }, h('img', { src: l.shot, alt: '', loading: 'lazy', width: '640', height: '400' })) : null,
        h('div.lcard-body', {}, h('h3.lcard-title', {}, l.title), h('p.lcard-made', {}, `Floor ${l.floor.number}${l.floor.name ? ` · ${l.floor.name}` : ''}`)))))) : null,
      p.changes.length ? h('section', {}, h('h2', {}, 'Changes shipped'), h('ul.thisweek-changes', {}, ...p.changes.map((c) => h('li', {},
        h('div', {}, h('b', {}, c.title), h('small', {}, ` · floor ${c.floor.number} · ${timeAgo(c.at)}`), c.result ? h('p', {}, c.result) : null),
        c.before || c.after ? h('div.thisweek-shots', {}, c.before ? h('figure', {}, h('img', { src: c.before, alt: '', loading: 'lazy', width: '240', height: '150' }), h('figcaption', {}, 'Before')) : null,
          c.after ? h('figure', {}, h('img', { src: c.after, alt: '', loading: 'lazy', width: '240', height: '150' }), h('figcaption', {}, 'After')) : null) : null)))) : null);
  };
  picker.addEventListener('change', () => load(picker.value));
  await load(week);
}
export function hideThisWeek() {}
