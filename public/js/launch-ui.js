// The launcher: three taps from a fresh floor to a team that is building. What are we making, which idea, Go. Name, goal and plan
// come filled in and stay editable. Once a job runs, the maker card shows its passes and, when the Tester has passed a version, Launch.
import { h, api, toast } from './dom.js';
import { icon } from './icons.js';

const TYPE_ICON = { game: 'play', app: 'lightning', website: 'globe', business: 'briefcase' };
const FALLBACK_TYPES = [['game', 'Game', 'A real game with levels, enemies and upgrades'], ['app', 'App / SaaS', 'A signed-in web app with real accounts and data'], ['website', 'Website', 'A fast, good-looking site with real words'], ['business', 'Business', 'Research, a plan and a landing page, step by step']];

/** The whole flow, for a floor with nothing on it yet. */
export function launchFlow(page) {
  const root = h('div.launcher', { role: 'group', 'aria-label': 'Start something', 'data-launcher': '' });
  const types = page.state.makers?.types?.map((t) => [t.id, t.label, t.blurb]) || FALLBACK_TYPES;
  const step = (n, ...kids) => { root.replaceChildren(h('p.launch-step', {}, `Step ${n} of 3`), ...kids); root.querySelector('button:not([disabled]), input, textarea')?.focus({ preventScroll: true }); };

  function pickType() {
    step(1, h('h3.launch-q', {}, 'What are we making?'),
      h('div.launch-types', {}, ...types.map(([id, label, blurb]) => h('button.launch-type', { type: 'button', 'data-type': id, onclick: () => pickIdea(id, label) }, icon(TYPE_ICON[id] || 'sparkle'), h('b', {}, label), h('span', {}, blurb)))),
      h('p.fineprint', {}, 'Your team designs it, builds it, plays it in a real browser and fixes it. You launch it with one tap. Nobody here can send email, post, run ads or spend money, so they will tell you what only you can do.'));
  }
  async function pickIdea(type, label, seed = 0) {
    const cards = h('div.launch-cards', {}, h('p.launch-loading', {}, 'Thinking of ideas...'));
    const own = h('textarea', { rows: 2, maxlength: 400, name: 'own', placeholder: type === 'game' ? 'A frog who delivers mail across a swamp...' : 'Say it in your own words...', 'aria-label': 'In your own words' });
    const useOwn = h('button.btn.ghost', { type: 'button', 'data-own': '', onclick: async () => {
      const text = own.value.trim(); if (!text) { own.focus(); return; }
      useOwn.disabled = true;
      try { const r = await api(`/floors/${page.slug}/makers/words`, { method: 'POST', body: { type, text } }); review(type, label, r.card); } catch (e) { toast(e.message, 'bad'); useOwn.disabled = false; }
    } }, 'Use my words');
    step(2, h('h3.launch-q', {}, `Which ${label.toLowerCase().split(' ')[0]}?`), cards,
      h('div.launch-own', {}, own, useOwn),
      h('div.launch-row', {}, h('button.link', { type: 'button', onclick: pickType }, 'Back'), h('button.link', { type: 'button', 'data-more': '', onclick: () => pickIdea(type, label, seed + 1) }, 'More ideas')));
    try {
      const r = await api(`/floors/${page.slug}/makers/ideas?type=${type}&seed=${seed}`);
      cards.replaceChildren(...r.cards.map((c) => ideaButton(c, () => review(type, label, c))),
        h('button.launch-card.surprise', { type: 'button', 'data-surprise': '', onclick: () => review(type, label, r.surprise) }, icon('sparkle'), h('b', {}, 'Surprise me'), h('span', {}, 'The team picks one it believes in')));
    } catch (e) { cards.replaceChildren(h('p.bad', {}, e.message)); }
  }
  function ideaButton(c, fn) {
    return h('button.launch-card', { type: 'button', 'data-idea': c.id, onclick: fn }, h('b', {}, c.title), h('span', {}, c.pitch), c.starter === 'game-3d' ? h('i.tag', {}, '3D') : c.starter === 'game-2d' ? h('i.tag', {}, '2D') : '');
  }
  function review(type, label, card) {
    const name = h('input', { name: 'name', value: card.name, maxlength: 40, 'aria-label': 'Name', required: true });
    const goal = h('input', { name: 'goal', value: card.goal, maxlength: 200, 'aria-label': 'Goal' });
    const plan = h('textarea', { name: 'plan', rows: 4, maxlength: 600, 'aria-label': 'Plan, one step a line' }); plan.value = (card.plan || []).join('\n');
    const pitch = h('textarea', { name: 'pitch', rows: 2, maxlength: 400, 'aria-label': 'What it is' }); pitch.value = card.pitch;
    const go = h('button.btn.primary.launch-go', { type: 'button', 'data-go': '', onclick: async () => {
      go.disabled = true; go.textContent = 'Starting...';
      try {
        if (type === 'business') await api(`/floors/${page.slug}/business/start`, { method: 'POST', body: { wish: `${name.value.trim()}: ${pitch.value.trim()}`.slice(0, 300) } });
        else await api(`/floors/${page.slug}/makers/start`, { method: 'POST', body: { type, idea: card.id, starter: card.starter, name: name.value.trim(), pitch: pitch.value.trim(), goal: goal.value.trim(), plan: plan.value.split('\n').map((s) => s.trim()).filter(Boolean) } });
        page.view?.bossTalks?.(); toast('The team is on it');
        // The maker card lives in the chat, which is where the boss just was, even once the floor has a name.
        page.tab = 'chat'; page.panelOpen = true;
        await page.reload?.();
      } catch (e) { toast(e.message, 'bad'); go.disabled = false; go.replaceChildren(icon('rocket-launch'), 'Go'); }
    } }, icon('rocket-launch'), 'Go');
    step(3, h('h3.launch-q', {}, 'Ready?'),
      h('div.launch-review', {}, h('label', {}, h('span', {}, 'Name'), name), h('label', {}, h('span', {}, 'What it is'), pitch), h('label', {}, h('span', {}, 'Goal'), goal), h('label', {}, h('span', {}, 'Plan'), plan)),
      go, h('button.link', { type: 'button', onclick: () => pickIdea(type, label) }, 'Back'));
    go.focus({ preventScroll: true });
  }
  pickType();
  return root;
}

const STEP_ICON = { done: 'check-circle', doing: 'clock', failed: 'warning', skipped: 'x', todo: 'caret-down' };
/** The running job: its passes, the last test, Launch once a version passed, the share link after. Null when there is no job. */
export function makerCard(page) {
  const m = page.state.makers;
  if (!page.owner || !m?.job || m.job.stage === 'stopped') return null;
  const box = h('div.maker-card', { 'data-maker': '', 'data-stage': m.job.stage });
  const render = (job) => {
    box.dataset.stage = job.stage;
    const building = ['doc', 'build', 'test'].includes(job.stage);
    const steps = h('ol.maker-steps', {}, ...job.steps.map((s) => h(`li.${s.state}`, {}, icon(STEP_ICON[s.state] || 'caret-down'), s.label)));
    const launch = job.launchable && !job.launched ? h('button.btn.primary.maker-launch', { type: 'button', 'data-launch': '', onclick: async () => {
      launch.disabled = true;
      try { const r = await api(`/floors/${page.slug}/makers/launch`, { method: 'POST', body: {} }); render(r.makers.job); share(r.url); } catch (e) { toast(e.message, 'bad'); launch.disabled = false; }
    } }, icon('rocket-launch'), 'Launch') : null;
    const link = job.launched && job.url ? h('div.maker-share', {}, h('a', { href: job.url, target: '_blank', rel: 'noopener', 'data-share-url': '' }, job.url), h('button.btn.ghost', { type: 'button', onclick: () => share(job.url) }, icon('share-fat'), 'Share')) : null;
    const asking = job.asking ? h('div.maker-ask', {}, h('p', {}, `Stuck: ${job.asking.why}.`),
      h('button.btn', { type: 'button', 'data-retry': '', onclick: () => decide('retry') }, 'Try again'),
      job.asking.canLaunch && !job.launched ? h('button.btn.primary', { type: 'button', onclick: () => launch?.click() }, 'Launch what works') : null,
      h('button.btn.ghost', { type: 'button', onclick: () => decide('stop') }, 'Stop')) : null;
    box.replaceChildren(
      h('div.maker-head', {}, h('b', {}, job.title), h('span', {}, building ? 'Team is building' : job.stage === 'ready' ? (job.launched ? 'Live' : 'Ready to launch') : job.stage === 'asking' ? 'Needs you' : '')),
      steps, job.report ? h('p.maker-report', {}, `Last test: ${job.report.verdict === 'pass' ? 'passed' : 'not yet'}${job.report.summary ? `, ${job.report.summary}` : ''}`) : null,
      asking, launch, link);
  };
  async function decide(choice) { try { const r = await api(`/floors/${page.slug}/makers/decide`, { method: 'POST', body: { choice } }); render(r.makers.job); } catch (e) { toast(e.message, 'bad'); } }
  async function share(url) {
    try { if (navigator.share) { await navigator.share({ title: m.job.title, url }); return; } } catch { /* the sheet was closed */ }
    try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { toast(url); }
  }
  render(m.job);
  // Each step the server takes arrives as a maker event; the card fetches its own fresh view rather than rebuilding the floor.
  page.es?.addEventListener('maker', async () => { if (page.dead || !box.isConnected) return; try { const s = await api(`/floors/${page.slug}`); if (s.makers?.job) render(s.makers.job); } catch { /* the next event will do */ } });
  return box;
}
