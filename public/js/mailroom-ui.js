// The mailroom page (round 2, r2-j50 on; docs/redesign/OFFICE-ANSWERS-2.md, Q17, Q20 and section 3): the basement, reached from the foot of the
// tower on the home panel and from B on the lift. On a desktop it is a small 3D room with buddehbot at its desk; on a phone (and with no 3D) the
// same room as plain DOM: the robot, its state, the tray and the stamps, with no tube animation (Q9). It READS /api/mailroom and nothing else:
// tapping the robot shows a small card with its state and counts by kind, and never contacts buddehbot.
import { h, api, isPhone, put } from './dom.js';
import { icon } from './icons.js';
import { kindLine, trayView, signFor, COLORS, eyeFor } from './mailroom-state.js';

export const STATE_WORDS = { asleep: 'Asleep', away: 'Away', busy: 'Busy', waiting: 'Inbox waiting', free: 'Free' };
const POLL_MS = 5000;
let poll = null, view = null, alive = false;

/** The robot as a small drawing, for a phone and for the strip at the foot of the tower. Its eye is the state's colour. */
export function robotSvg(state, size = 56) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 40 48'); svg.setAttribute('width', String(size)); svg.setAttribute('height', String(Math.round(size * 1.2)));
  svg.setAttribute('aria-hidden', 'true'); svg.classList.add('robot-svg'); svg.dataset.state = state;
  const el = (tag, a) => { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(a)) e.setAttribute(k, v); svg.append(e); return e; };
  el('rect', { x: 8, y: 4, width: 24, height: 13, rx: 3, fill: COLORS.ink });
  el('circle', { cx: 20, cy: 10.5, r: 3.4, fill: eyeFor(state), class: 'robot-eye' });
  el('rect', { x: 18, y: 17, width: 4, height: 3, fill: COLORS.slate });
  el('rect', { x: 7, y: 20, width: 26, height: 17, rx: 3, fill: COLORS.ink });
  el('rect', { x: 11, y: 22, width: 18, height: 4, rx: 1, fill: COLORS.brass });
  el('rect', { x: 11, y: 28, width: 18, height: 6, rx: 1, fill: COLORS.slate });
  el('rect', { x: 33, y: 22, width: 3, height: 10, fill: COLORS.slate });
  el('rect', { x: 31.5, y: 32, width: 6, height: 3, rx: 1, fill: COLORS.red });
  el('circle', { cx: 13, cy: 41, r: 4.5, fill: '#15171d' }); el('circle', { cx: 27, cy: 41, r: 4.5, fill: '#15171d' });
  return svg;
}

/** The strip at the foot of the tower on the home panel, and the B on the lift's line: what state the basement is in, one tap away. */
export function mailroomStrip(d) {
  const state = d?.robot?.state || 'free', tray = d?.robot?.tray || { folders: 0, more: 0 };
  const n = tray.folders + tray.more;
  return h('button.mailroom-strip', { type: 'button', 'data-mailroom': state, 'aria-label': `B, the mailroom: buddehbot is ${STATE_WORDS[state].toLowerCase()}`, onclick: () => window.officeGo('/mailroom') },
    h('b.mailroom-b', {}, 'B'), robotSvg(state, 22), h('span', {}, h('strong', {}, 'Mailroom'), ' · ', STATE_WORDS[state], n ? ` · ${n} in the tray` : ''));
}

function card(d) {
  const state = d.robot?.state || 'free';
  const c = d.counts || { help: 0, purchase: 0, contractor: 0 };
  const sign = d.robot?.sign ?? signFor(state);
  return h('div.mailroom-card.card-ui', { 'data-robot-card': state },
    h('h2', {}, 'buddehbot'),
    h('p.mailroom-state', {}, h('i.robot-dot', { css: { background: eyeFor(state) } }), STATE_WORDS[state]),
    sign ? h('p.mailroom-sign', {}, sign) : null,
    h('ul.mailroom-counts', {}, h('li', {}, `Help questions: ${c.help}`), h('li', {}, `Purchase requests: ${c.purchase}`), h('li', {}, `Build jobs: ${c.contractor}`)));
}

/** The plain DOM room: a phone, or no 3D. Robot, tray and stamp stay; no tube animation (Q9). */
function domRoom(d) {
  const state = d.robot?.state || 'free';
  const tray = d.robot?.tray || trayView(d.items || []);
  const folders = h('div.dom-tray', { 'data-tray': String(tray.folders) }, ...Array.from({ length: tray.folders }, () => h('i.dom-folder', { 'aria-hidden': 'true' })), tray.label ? h('b.dom-more', {}, tray.label) : null);
  return h('div.dom-room', { 'data-state': state }, h('div.dom-desk', {}, robotSvg(state, 88), folders), h('p.dom-tray-label', {}, tray.folders ? `${tray.folders + tray.more} in the tray` : 'The tray is empty'));
}

export async function showMailroom(root) {
  document.body.dataset.page = 'mailroom';
  alive = true;
  const side = h('aside.mailroom-side');
  const lines = h('ul.mailroom-lines', { 'aria-label': 'In the mailroom' });
  const roomBox = h('div.mailroom-room');
  let robotOpen = false;
  const robotBtn = h('button.btn.small.mailroom-robot-btn', { type: 'button', onclick: () => { robotOpen = !robotOpen; render(last); } }, 'buddehbot');
  put(root, h('div.mailroom-page', {},
    h('header.home-top', {}, h('div.home-brand', {}, h('button.btn.back', { type: 'button', onclick: () => window.officeGo('/') }, icon('arrow-left'), h('span', {}, 'Home')), h('div', {}, h('h1', {}, 'The mailroom'), h('p', {}, 'B, under the lobby. buddehbot reads what the floors send down.')))),
    h('div.mailroom-main', {}, roomBox, h('div.mailroom-col', {}, robotBtn, side, lines))));
  let last = null;
  const render = (d) => {
    if (!d) return;
    side.replaceChildren(robotOpen ? card(d) : '');
    // One line of kind with the floor number for each open item (Q20). Nothing else.
    lines.replaceChildren(...(d.items || []).filter((i) => i.state === 'open' || i.state === 'picked').map((i) => h('li', { 'data-record': `${i.type}:${i.number}` }, kindLine(i))));
    if (view) view.setData(d); else roomBox.replaceChildren(domRoom(d));
  };
  // A desktop gets the room in 3D; a phone, or a browser with no 3D, the plain one.
  if (!isPhone()) {
    try {
      const [{ startStage }, { MailroomView }] = await Promise.all([import('./stage-start.js'), import('./mailroom-scene.js')]);
      const stage = startStage();
      if (stage.ok && alive) { stage.setBoxed(false); view = new MailroomView(); stage.setView(view); window.__mailroomDebug = view; document.body.classList.add('mailroom-3d'); }
    } catch (e) { console.warn('mailroom', e?.message); view = null; }
  }
  const read = async () => { try { last = await api('/mailroom'); } catch { return; } if (alive) render(last); };
  await read();
  poll = setInterval(() => { if (!document.hidden) read(); }, POLL_MS);
}

export function hideMailroom() {
  alive = false; clearInterval(poll); poll = null;
  document.body.classList.remove('mailroom-3d');
  if (view) { import('./stage-start.js').then(({ stage }) => { if (stage.view === view) stage.setView(null); }); view = null; }
}
