// The launcher: three taps from a fresh floor to a team that is building. What are we making, which idea, Go. Name, goal and plan
// come filled in and stay editable. Once a job runs, the maker card shows its passes and, when the Tester has passed a version, Launch.
import { h, api, toast } from './dom.js';
import { icon } from './icons.js';

const TYPE_ICON = { game: 'play', app: 'lightning', website: 'globe', business: 'briefcase' };
const FALLBACK_TYPES = [['game', 'Game', 'A real game with levels, enemies and upgrades'], ['app', 'App / SaaS', 'A signed-in web app with real accounts and data'], ['website', 'Website', 'A fast, good-looking site with real words'], ['business', 'Business', 'Research, a plan and a landing page, step by step']];

/** The whole flow, for a floor with nothing on it yet. */
export function launchFlow(page, { onBack = null } = {}) {
  const root = h('div.launcher', { role: 'group', 'aria-label': 'Start something', 'data-launcher': '' });
  const types = page.state.makers?.types?.map((t) => [t.id, t.label, t.blurb]) || FALLBACK_TYPES;
  // Each step starts at its question, so a phone shows the choices rather than the middle of the last list.
  const step = (n, ...kids) => { root.replaceChildren(h('p.launch-step', {}, `Step ${n} of 3`), ...kids.filter(Boolean)); root.querySelector('button:not([disabled]), input, textarea')?.focus({ preventScroll: true }); if (root.isConnected) { const list = root.closest('.chat-list'); if (list) list.scrollTo({ top: list.scrollTop + root.getBoundingClientRect().top - list.getBoundingClientRect().top, behavior: 'smooth' }); else root.scrollIntoView({ block: 'start', behavior: 'smooth' }); } };

  function pickType() {
    const setup = page.state.floor.setup;
    step(1, setup ? h('div.setup-note', { 'data-setup': '' }, h('b', {}, 'No forms, no paperwork.'), h('span', {}, `Tap one below, or just tell ${page.manager?.name || 'your manager'} what you want to make. They'll name the company and get everyone moving.`)) : null,
      h('h3.launch-q', {}, 'What are we making?'),
      h('div.launch-types', {}, ...types.map(([id, label, blurb]) => h('button.launch-type', { type: 'button', 'data-type': id, onclick: () => pickIdea(id, label) }, icon(TYPE_ICON[id] || 'sparkle'), h('b', {}, label), h('span', {}, blurb)))),
      h('p.fineprint', {}, 'Your team designs it, builds it, plays it in a real browser and fixes it. You launch it with one tap. Nobody here can post, run ads or spend money, and email to anyone new waits for your OK, so they will tell you what only you can do.'),
      onBack ? h('button.link', { type: 'button', 'data-launcher-back': '', onclick: onBack }, 'Back') : setup ? null : h('button.link.make-yours', { type: 'button', 'data-make-yours': '', onclick: () => page.openCustomise?.('vibe') }, 'First, make this office yours'));
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
        page.landUntil = Date.now() + 8000;
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
const STEP_WORD = { done: 'done', doing: 'running', failed: 'failed', skipped: 'skipped' };
/** The running job: its passes, the last test, Launch once a version passed, the share link after. Null when there is no job. */
export function makerCard(page) {
  const m = page.state.makers;
  if (!page.owner || !m?.job || m.job.stage === 'stopped') return null;
  const box = h('div.maker-card', { 'data-maker': '', 'data-stage': m.job.stage });
  let shown = '';
  const render = (job) => {
    // Each server step arrives as an event; a redraw of an unchanged card could swallow a tap on Launch.
    const same = JSON.stringify(job);
    if (same === shown) return;
    shown = same;
    box.dataset.stage = job.stage;
    const building = ['doc', 'build', 'test'].includes(job.stage);
    const steps = h('ol.maker-steps', {}, ...job.steps.map((s) => h(`li.${s.state}`, { 'data-step-state': s.state }, icon(STEP_ICON[s.state] || 'caret-down'), s.label, STEP_WORD[s.state] ? h('em.step-word', {}, s.state === 'skipped' && s.note && s.note !== 'not run' ? `skipped, ${s.note}` : STEP_WORD[s.state]) : null)));
    const held = job.held?.fixing ? h('div.maker-held', { 'data-launch-held': '' }, h('button.btn.primary.maker-launch', { type: 'button', disabled: true }, icon('rocket-launch'), 'Fixing a serious bug first'), job.held.bugs.length ? h('p.maker-bugs', {}, job.held.bugs[0]) : null) : null;
    const launch = job.launchable && !job.launched ? h('button.btn.primary.maker-launch', { type: 'button', 'data-launch': '', onclick: async () => {
      launch.disabled = true;
      try { const r = await api(`/floors/${page.slug}/makers/launch`, { method: 'POST', body: {} }); render(r.makers.job); share(r.url); } catch (e) { toast(e.message, 'bad'); launch.disabled = false; }
    } }, icon('rocket-launch'), 'Launch') : null;
    const link = job.launched && job.url ? h('div.maker-share', {}, h('a', { href: job.url, target: '_blank', rel: 'noopener', 'data-share-url': '' }, job.url), h('button.btn.ghost', { type: 'button', onclick: () => share(job.url) }, icon('share-fat'), 'Share')) : null;
    // After two failed fixes the boss chooses, and a launch with a serious bug takes two deliberate taps.
    const stillHeld = !!job.asking?.held;
    const armed = { on: false };
    const anyway = stillHeld && job.asking.canLaunch ? h('button.btn.maker-anyway', { type: 'button', 'data-launch-anyway': '', onclick: async () => {
      if (!armed.on) { armed.on = true; anyway.textContent = 'Yes, launch it anyway'; anyway.classList.add('armed'); return; }
      anyway.disabled = true;
      try { const r = await api(`/floors/${page.slug}/makers/launch`, { method: 'POST', body: { anyway: true } }); render(r.makers.job); share(r.url); } catch (e) { toast(e.message, 'bad'); anyway.disabled = false; }
    } }, 'Launch anyway') : null;
    const asking = job.asking ? h('div.maker-ask', {}, h('p', {}, stillHeld ? `Serious bug: ${job.asking.why}.` : `Stuck: ${job.asking.why}.`),
      stillHeld && job.held?.bugs?.length ? h('ul.maker-bugs', {}, ...job.held.bugs.map((t) => h('li', {}, t))) : null,
      anyway ? h('p.maker-warn', { 'data-launch-warning': '' }, job.asking.flaws?.length ? `Launch anyway puts this live with a known serious bug: ${job.asking.flaws[0]}` : 'Launch anyway puts the last version with no known serious bug live, without the newest work.') : null,
      h('button.btn', { type: 'button', 'data-retry': '', onclick: () => decide('retry') }, stillHeld ? 'Keep trying' : 'Try again'),
      anyway || (job.asking.canLaunch && !job.launched ? h('button.btn.primary', { type: 'button', onclick: () => launch?.click() }, 'Launch what works') : null),
      h('button.btn.ghost', { type: 'button', onclick: () => decide('stop') }, 'Stop')) : null;
    // Once this one is out in the world, the same three taps start the next thing. Back returns to this card.
    const another = job.stage === 'ready' && job.launched ? h('button.link.maker-new', { type: 'button', 'data-make-new': '', onclick: () => { const flow = launchFlow(page, { onBack: () => { flow.replaceWith(box); page.lanesEl = box; } }); page.lanesEl = flow; box.replaceWith(flow); } }, 'Make something new') : null;
    box.replaceChildren(...[
      h('div.maker-head', {}, h('b', {}, job.title), h('span', {}, building ? (job.launched ? 'Live, and getting better' : 'Team is building') : job.stage === 'ready' ? (job.launched ? 'Live' : 'Ready to launch') : job.stage === 'asking' ? 'Needs you' : '')),
      steps, job.report ? h('p.maker-report', {}, `Last test: ${job.report.verdict === 'pass' ? 'passed' : 'not yet'}${job.report.summary ? `, ${job.report.summary}` : ''}`) : null,
      job.liveCheck ? h('p.maker-report', { 'data-live-check': job.liveCheck.ok ? 'ok' : 'failed' }, job.liveCheck.ok ? (job.type === 'website' ? 'Checked on the live link.' : 'Saves and leaderboard checked on the live link.') : `The live link check found a problem: ${job.liveCheck.problem}`) : null,
      asking, held, launch, job.launchedWith?.length ? h('p.maker-warn', { 'data-launched-with': '' }, `Live with a known serious bug: ${job.launchedWith[0]}`) : null, link, another].filter(Boolean));
    if (Date.now() < (page.landUntil || 0)) requestAnimationFrame(() => page.scrollChat?.());
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
