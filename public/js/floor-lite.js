// A floor on a phone, before anyone asks for the room (docs/redesign/OFFICE-ANSWERS-1.md, Q12 and the phone sketch, job 16): the status card,
// the timeline and what the team has made, as plain DOM. No 3D code (three.js, models, textures) is fetched until "Watch the room" is tapped;
// then the full floor page, room and all, takes over. Everything here is the same data the full page reads.
import { h, api, clear, put, timeAgo, BASE, isPhone } from './dom.js';
import { icon } from './icons.js';
import { renderStatusCard } from './status-card.js';
import { renderTimeline, onJobCard, onTimelineMessage } from './timeline-ui.js';
import { STATE_WORDS, stateOf, idleNote } from './badge.js';

/** Floors whose room someone has asked to see, this visit. */
export const roomWanted = new Set();
const FACE_COLORS = ['#17766F', '#C93A24', '#5B6270', '#1F2430'];
let page = null;

/** A face without the 3D bean: a circle with an initial, in one of the palette's dark colours. */
function flatFace(person) {
  const name = String(person?.name || '?');
  let n = 7; for (const c of name) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  return h('span.flat-face', { css: { background: FACE_COLORS[n % FACE_COLORS.length] } }, name.trim()[0]?.toUpperCase() || '?');
}

async function shareFloor(p) {
  const url = `${location.origin}${BASE}/floor/${p.slug}`;
  try { if (navigator.share) await navigator.share({ title: p.state.floor.name, url }); else await navigator.clipboard.writeText(url); } catch { /* closed */ }
}

export async function showFloorLite(root, slug, { onRoom }) {
  const state = await api(`/floors/${slug}`);
  // The boss of a floor that is still being set up needs Setup, which lives on the full page: they go straight there (found by
  // test/browser/e2e.mjs, job 29: a new boss on a phone landed here with no way to name the company or pick a lane).
  if (state.viewer?.owner && state.floor?.setup) { roomWanted.add(slug); return 'room'; }
  document.body.dataset.page = 'floor-lite';
  const p = page = {
    slug, state, owner: !!state.viewer?.owner, dead: false,
    get manager() { return state.agents.find((a) => a.role === 'manager'); },
    person(id, name) { if (id === 'boss' || (name && name === state.floor.boss?.name)) return { ...state.floor.boss, boss: true }; return state.agents.find((a) => a.id === id) || (name ? state.agents.find((a) => a.name === name) : null) || null; },
    face: flatFace,
    cardSoon() { clearTimeout(p.cardTimer); p.cardTimer = setTimeout(() => { if (!p.dead) drawCard(); }, 400); },
    renderQuestions() {},
  };
  const badge = h('span.badge');
  const cardEl = h('div.lite-status');  // not .card-more: the full page's phone rules hide that one
  const drawCard = () => {
    const s = stateOf(state.floor);
    badge.dataset.state = s; badge.textContent = STATE_WORDS[s]; badge.title = idleNote(state.floor);
    renderStatusCard(p, cardEl, { shareFloor });
  };
  p.bodyEl = h('div.lite-timeline');
  const projects = h('section.lite-projects.card-ui', {}, h('h2', {}, 'Projects'));
  const made = state.projects.filter((x) => !x.private);
  if (!made.length) projects.append(h('p.lite-none', {}, 'Nothing published yet.'));
  for (const pr of made.slice(0, 8)) projects.append(h('a.lite-project', { href: pr.appUrl || pr.url, target: '_blank', rel: 'noopener noreferrer' }, h('b', {}, pr.title), h('small', {}, `${pr.kind} · ${timeAgo(pr.publishedAt)}`)));
  const watch = h('button.btn.primary.watch-room', { type: 'button', 'data-watch-room': '', onclick: () => { roomWanted.add(slug); onRoom(); } }, icon('play'), 'Watch the room');
  put(root, h('div.floor-lite', {},
    h('header.lite-top', {},
      h('button.btn.back', { type: 'button', onclick: () => window.officeGo('/') }, icon('arrow-left'), h('span', {}, 'Home')),
      h('div.lite-title', {}, h('b', {}, state.floor.name || 'Moving in'), h('small', {}, `Floor ${state.floor.number}`)),
      badge),
    h('main.lite-main', {},
      h('section.lite-card', {}, cardEl),
      h('section.lite-tl.card-ui', {}, h('h2', {}, 'Timeline'), p.bodyEl),
      projects,
      watch)));
  drawCard();
  renderTimeline(p);
  // Live: job cards and the boss's conversation, from the floor's own stream. No snapshot of the room is needed.
  const es = new EventSource(`${BASE}/api/floors/${slug}/stream`);
  const on = (type, fn) => es.addEventListener(type, (e) => { if (p.dead) return; try { fn(JSON.parse(e.data)); } catch { /* a bad line is skipped */ } });
  on(p.owner ? 'jobcard' : 'jobcard_public', (d) => { onJobCard(p, d); });
  on('message', (d) => { if (!state.messages || state.messages.some((m) => m.id === d.id)) return; const m = { id: d.id, role: d.role, agentId: d.agentId, text: d.text, createdAt: d.createdAt }; state.messages.push(m); onTimelineMessage(p, m); });
  on('floor', (d) => { Object.assign(state.floor, d); drawCard(); });
  const reload = async () => { try { Object.assign(state, await api(`/floors/${slug}`)); drawCard(); } catch { /* next time */ } };
  on('question', reload); on('question_answered', reload);
  p.es = es;
  p.poll = setInterval(() => { if (!document.hidden) reload(); }, 30000);
}
export function hideFloorLite() {
  if (!page) return;
  page.dead = true; page.es?.close(); clearInterval(page.poll); clearTimeout(page.cardTimer); page = null;
}
/** Whether a floor URL should open the light page: a phone, and the room not asked for yet. */
export const liteFloor = (slug) => isPhone() && !roomWanted.has(slug);
