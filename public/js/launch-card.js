// The launch card (docs/redesign/OFFICE-ANSWERS-1.md, section 3): a 16:10 screenshot on top, the name, one line, visits or plays this week,
// "Made by floor N in X days", and one button. Used on the home hero, the Launched wall and a floor's portfolio. No money, no sign-ups.
import { h } from './dom.js';

const plural = (n, one, many) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
/** "12 plays this week" for a game, "12 visits this week" for anything else. */
export const usage = (pr) => (pr.kind === 'game' ? plural(pr.visits || 0, 'play', 'plays') : plural(pr.visits || 0, 'visit', 'visits')) + ' this week';
export const madeBy = (pr) => `Made by floor ${pr.floor.number} in ${plural(pr.madeDays || 1, 'day', 'days')}`;

export function launchCard(pr, { onFloor, hero = false } = {}) {
  const go = pr.kind === 'game' ? 'Play' : 'Visit';
  return h(`article.lcard${hero ? '.lcard-hero' : ''}`, { 'data-project': pr.slug, 'data-floor': pr.floor.slug, 'data-shot': pr.shot ? 'real' : 'card', ...(pr.wip ? { 'data-wip': '' } : {}) },
    h('a.lcard-shot', { href: pr.url, target: '_blank', rel: 'noopener noreferrer', tabindex: '-1', 'aria-hidden': 'true' },
      h('img', { src: pr.thumb, alt: '', loading: hero ? 'eager' : 'lazy', width: '640', height: '400', decoding: 'async' })),
    h('div.lcard-body', {},
      pr.wip ? h('span.lcard-wip', {}, 'Work in progress') : null,
      // r2-j58: the launch checklist's own stamp, when all eight code checks passed. Never anyone's signature.
      pr.checked ? h('span.lcard-checked', { title: `Passed all ${pr.checked.of} launch checks: speed, phone, links, forms, preview, icon, 404 page, HTTPS` }, `CHECKED ${pr.checked.passed} of ${pr.checked.of}`) : null,
      h('h3.lcard-title', {}, pr.title),
      pr.description ? h('p.lcard-line', {}, pr.description) : null,
      h('p.lcard-use', {}, usage(pr)),
      onFloor ? h('button.link.lcard-made', { type: 'button', onclick: () => onFloor(pr.floor) }, madeBy(pr)) : h('p.lcard-made', {}, madeBy(pr)),
      h('a.btn.small.lcard-go', { href: pr.url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `${go} ${pr.title}` }, go)));
}
