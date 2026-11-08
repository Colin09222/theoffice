// Business mode on the floor: the step header that hangs over the room like a lift's floor indicator, the Business tab (idea cards, the four
// department tracks with their lamps, the live preview, the ads, the ad money and the ad request), and the tap-to-send suggestion chips.
// The journey itself is kept by the server (server/business.js); everything here reads the floor's snapshot and posts the boss's own clicks.
import { h, api, BASE, toast, modal } from './dom.js';
import { icon } from './icons.js';

const SAYS = { done: 'Done', checking: 'Done, being checked', working: 'Working on it', attention: 'Needs a look', yours: 'Waiting for you', waiting: 'Not started', skipped: 'Skipped' };
const PREVIEW_MS = 50 * 60 * 1000;
const dollars = (n) => `$${Number(n) || 0}`;  // only ever the boss's own choice of ad money, or a sourced estimate on a card

export const businessActive = (page) => !!page.state.business?.active;
/** The server answers every click with the journey as it now stands. It shows at once; the rest of the floor catches up on its own reload. */
function apply(page, r, tab) {
  if (r?.business) page.state.business = r.business;
  page.renderJourney(); page.renderControls();
  if (tab) page.tab = tab;
  page.renderTabs(); page.renderBody();
  page.reload();
}

/** The four steps, lit like a lift's floor indicator. Tapping it opens the Business tab. */
export function journeyBar(page) {
  const b = page.state.business;
  if (!b?.active) return null;
  const at = Math.max(0, b.steps.findIndex((s) => s.state === 'now'));
  const now = b.steps[at] || b.steps.at(-1);
  return h('button.journey', { type: 'button', 'data-journey': b.step, 'aria-label': `Business mode, step ${at + 1} of ${b.steps.length}: ${now.label}. ${b.progress} percent of the way. Open the Business tab.`, onclick: () => page.setTab('business') },
    h('span.journey-name', {}, h('b', {}, 'Business mode'), h('small', {}, b.title || (b.step === 'idea' ? 'Finding an idea' : 'Building'))),
    h('ol.journey-steps', {}, ...b.steps.map((s, i) => h(`li.${s.state}`, { 'data-step': s.id }, h('i', {}, s.state === 'done' ? '✓' : String(i + 1)), h('span', {}, s.label)))),
    h('span.journey-meter', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(b.progress), css: { '--p': `${b.progress}%` } }, h('i')));
}

/** What the boss can say next, one tap away. Each is sent as their own message to the manager. */
export function chipsRow(page, { stay = false } = {}) {
  const b = page.state.business;
  if (!page.owner || !b?.active || !b.chips?.length) return null;
  return h('div.chips', { role: 'group', 'aria-label': 'Things you could say' }, ...b.chips.slice(0, 4).map((text) => h('button.chip', { type: 'button', 'data-chip': text, onclick: async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try {
      await api(`/floors/${page.slug}/chat`, { method: 'POST', body: { text } });
      page.view?.bossTalks();
      if (!stay && page.tab !== 'chat') page.setTab('chat');
    } catch (err) { toast(err.message, 'bad'); btn.disabled = false; }
  } }, text)));
}

/** The way in: a button on the floor for the boss, while no journey is running. */
export function startButton(page) {
  const b = page.state.business;
  if (!page.owner || !b || b.on === false || b.active || page.state.floor.status !== 'active') return null;
  return h('button.btn.chrome.biz-start', { type: 'button', 'data-start-business': '', onclick: () => openStart(page) }, icon('briefcase'), 'Start a business');
}
function openStart(page) {
  modal('Start a business', (body, close) => {
    const wish = h('textarea', { rows: 2, maxlength: 300, name: 'wish', placeholder: 'Anything in mind? A field, a kind of customer. Or leave it open.' });
    const go = h('button.btn.primary', { type: 'button', 'data-business-go': '', onclick: async () => {
      go.disabled = true;
      try {
        const r = await api(`/floors/${page.slug}/business/start`, { method: 'POST', body: { wish: wish.value.trim() } });
        close(); if (!page.panelOpen) page.setPanel(true); apply(page, r, 'business');
      } catch (e) { toast(e.message, 'bad'); go.disabled = false; }
    } }, icon('rocket-launch'), 'Find me an idea');
    body.append(
      h('ol.biz-how', {}, ...[['Idea', 'Your researcher reads the web and pins up 2 or 3 ideas, with the pages behind them.'], ['Build', 'The team builds it in four tracks: website, product, payments, analytics.'], ['Customers', 'Your marketer makes picture and video ads and a campaign plan.'], ['Launch', 'It goes live. Ads cost nothing unless you choose to spend.']].map(([b, t]) => h('li', {}, h('b', {}, b), ` ${t}`))),
      h('label.biz-wish', {}, h('span', {}, 'Your manager guides you the whole way, and you can ask anything.'), wish),
      h('div.row', {}, go));
    wish.focus();
  });
}

// ---- the Business tab ----
/** True when the tab already shows exactly this journey. The floor reloads on every bit of news, and rebuilding the tab each time would reload the
 * preview and could swallow a click on its way down. */
export function businessUnchanged(page) {
  return !!page.bizEl && page.bodyEl.firstChild === page.bizEl && page.bizSig === JSON.stringify(page.state.business);
}
export function renderBusiness(page) {
  const b = page.state.business;
  const owner = page.owner;
  const box = h('div.biz', { 'data-biz': b?.step || 'off' });
  page.bizEl = box; page.bizSig = JSON.stringify(b);
  if (!b?.active) {
    box.append(h('p.biz-quiet', {}, owner ? 'Business mode is off. Tap Start a business, or tell your manager "find me a business idea and build it".' : 'Nothing here yet.'));
    page.bodyEl.append(box);
    return;
  }
  box.append(journeyBar(page));
  if (b.step === 'idea') box.append(owner ? ideaStep(page, b) : h('p.biz-quiet', {}, 'The team is looking for a business idea.'));
  else box.append(tracksEl(b));
  if (owner && b.step === 'build' && b.preview) box.append(previewEl(page, b));
  if (b.step === 'customers' && owner) box.append(...customersStep(page, b));
  if (b.step === 'launch') box.append(...launchStep(page, b));
  const chips = chipsRow(page);
  if (chips) box.append(h('div.biz-chips', {}, h('span', {}, 'Ask your manager'), chips));
  page.bodyEl.append(box);
  // A shared link to an ad lands on it.
  const want = new URLSearchParams(location.search).get('ad');
  if (want) box.querySelector(`[data-ad="${CSS.escape(want)}"]`)?.scrollIntoView({ block: 'center' });
}

function ideaStep(page, b) {
  const part = h('div.biz-idea');
  const r = b.research || {};
  const working = !b.ideas.length;
  part.append(h('section.desk', { 'data-desk': '' },
    h('div.desk-head', {}, icon('magnifying-glass'), h('b', {}, 'The research desk'), h('small', {}, working ? 'Reading the web now' : 'What the researcher did')),
    r.searches?.length ? h('div.desk-row', {}, h('span', {}, 'Searched'), h('ul.desk-list', {}, ...r.searches.map((s) => h('li', {}, `“${s.q}”`)))) : null,
    h('div.desk-row', {}, h('span', {}, 'Pages read'), r.pages?.length ? h('ul.desk-list', {}, ...r.pages.map((p) => h('li', {}, h('a', { href: p.url, target: '_blank', rel: 'noopener noreferrer nofollow' }, p.host || p.url)))) : h('em', {}, working ? 'None yet' : 'Only what the searches returned')),
    r.markets?.length ? h('div.desk-row', {}, h('span', {}, 'Markets checked'), h('p.tags', {}, ...r.markets.map((m) => h('i', {}, m)))) : null,
    r.compared?.length ? h('div.desk-row', {}, h('span', {}, 'Compared'), h('ul.desk-list', {}, ...r.compared.map((c) => h('li', {}, h('b', {}, c.idea), ` — ${c.verdict}`)))) : null,
    working ? h('p.desk-wait', {}, h('i.typing-lamp'), 'The idea cards appear here when the research is done.') : null));
  if (b.ideas.length) part.append(h('div.idea-cards', { role: 'list' }, ...b.ideas.map((x, i) => ideaCard(page, x, i))));
  return part;
}
function ideaCard(page, x, i) {
  const pickIt = async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try { const r = await api(`/floors/${page.slug}/business/pick`, { method: 'POST', body: { idea: i } }); toast(`Building ${x.name}`); apply(page, r); } catch (err) { toast(err.message, 'bad'); btn.disabled = false; }
  };
  const row = (label, text) => h('div.card-row', {}, h('span', {}, label), h('p', {}, text));
  return h('article.idea-card', { role: 'listitem', 'data-idea': String(i) },
    h('header', {}, h('i.card-no', {}, String(i + 1)), h('h3', {}, x.name)),
    row('Who pays', x.whoPays), row('Their problem', x.problem), row('What you sell', x.sell), row('Why now', x.whyNow),
    x.revenue ? h('div.card-row.estimate', {}, h('span', {}, 'Estimate'), h('p', {}, `${dollars(x.revenue.low)}–${dollars(x.revenue.high)} a ${x.revenue.per}, if:`),
      h('ul', {}, ...x.revenue.assumptions.map((a) => h('li', {}, `${a.text} `, h('a', { href: a.source, target: '_blank', rel: 'noopener noreferrer nofollow' }, 'source'))))) : null,
    h('div.card-row.evidence', {}, h('span', {}, 'Evidence'), h('ul', {}, ...x.evidence.map((e) => h('li', {}, h('a', { href: e.url, target: '_blank', rel: 'noopener noreferrer nofollow' }, e.title || hostOf(e.url)), e.shows ? ` — ${e.shows}` : '')))),
    h('button.btn.primary', { type: 'button', 'data-pick': String(i), onclick: pickIt }, 'Pick this one'));
}
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

function tracksEl(b) {
  return h('section.tracks', { 'aria-label': 'Build tracks' }, ...b.tracks.map((t) => h(`div.track.${t.lamp}`, { 'data-track': t.id },
    h('div.track-head', {}, h('span.lamp', { role: 'img', 'aria-label': t.lamp === 'done' ? 'Done' : t.lamp === 'working' ? 'Working' : t.lamp === 'attention' ? 'Needs a look' : 'Not started' }), h('b', {}, t.label), h('span.count', {}, `${t.done}/${t.total}`)),
    t.items.length ? h('ul.track-items', {}, ...t.items.map((i) => h(`li.${i.state}`, { title: SAYS[i.state] || i.state }, h('i'), i.label, i.optional ? h('small', {}, ' optional') : null))) : null,
    t.note ? h('p.track-note', {}, t.note) : null)));
}

function previewEl(page, b) {
  const frame = h('iframe.site-frame.biz-frame', { title: `Live preview of ${b.title || 'the site'}`, sandbox: 'allow-scripts allow-forms', referrerpolicy: 'no-referrer' });
  const empty = h('p.preview-empty', {}, 'The page shows up here as soon as the Builder saves it.');
  const box = h('section.biz-preview', { 'data-preview': '' }, h('div.preview-head', {}, h('b', {}, 'Live preview'), h('small', {}, 'Updates as the team saves')), empty);
  const show = (url) => { if (!url) return; empty.replaceWith(frame); frame.src = url; box.append(h('a.preview-open', { href: url, target: '_blank', rel: 'noopener noreferrer' }, 'Open it full size')); };
  const c = page.bizPreview;
  // The tab isn't rebuilt while the journey stands still, and a builder can save the page long before a lamp changes, so it asks again every
  // few seconds until the page is there, for as long as this box is on screen.
  let tries = 0;
  const look = () => api(`/floors/${page.slug}/business/preview`).then((r) => {
    if (r.url) { page.bizPreview = { url: r.url, project: b.project, at: Date.now() }; show(r.url); } else if (++tries < 200 && (box.isConnected || tries === 1)) setTimeout(look, 3000);
  }).catch(() => { if (++tries < 200 && box.isConnected) setTimeout(look, 6000); });
  if (c?.url && c.project === b.project && Date.now() - c.at < PREVIEW_MS) show(c.url);
  else look();
  return box;
}

function adsEl(page, b, { share }) {
  const a = b.ads;
  if (!a || (!a.pictures.length && !a.videos.length)) return h('p.biz-quiet', {}, a?.skipped ? 'No ads this time.' : 'The ads appear here as they are made.');
  const shareBtn = (name) => h('button.btn.ghost.share', { type: 'button', 'data-share': name, onclick: () => shareAd(page, b, name) }, icon('share-fat'), 'Share');
  return h('section.ad-wall', { 'aria-label': 'The ads' },
    ...a.pictures.map((p) => h('figure.ad.picture', { 'data-ad': p.name }, h('img', { src: p.src, alt: `Picture ad: ${a.plan?.headline || b.title}`, loading: 'lazy' }), share ? shareBtn(p.name) : null)),
    ...a.videos.map((v) => {
      const video = h('video', { src: v.src, controls: true, playsinline: true, preload: 'metadata', 'aria-label': `Video ad for ${b.title}` }, v.captions ? h('track', { kind: 'captions', src: v.captions, srclang: 'en', label: 'Captions', default: true }) : null);
      video.muted = true;
      return h('figure.ad.video', { 'data-ad': v.name }, video, share ? shareBtn(v.name) : null);
    }));
}
async function shareAd(page, b, name) {
  const url = `${location.origin}${BASE}/floor/${page.slug}?ad=${encodeURIComponent(name)}`;
  const title = b.ads?.plan?.headline || b.title;
  try {
    if (navigator.share) { await navigator.share({ title, text: b.ads?.plan?.primaryText || title, url }); return; }
    await navigator.clipboard.writeText(url); toast('Link copied');
  } catch (e) { if (e?.name !== 'AbortError') toast('Copy this link: ' + url); }
}

function planEl(b) {
  const p = b.ads?.plan;
  if (!p) return null;
  const row = (label, text) => h('div.wo-row', {}, h('span', {}, label), h('p', {}, text));
  const s = p.search;
  const host = hostOf(b.liveUrl || '') || 'your-site';
  return h('section.work-order', { 'data-plan': '' },
    h('div.wo-head', {}, h('b', {}, 'Campaign plan'), h('small', {}, 'Work order')),
    h('div.ad-words', {}, h('span', {}, 'The ad'), h('b', {}, p.headline), h('p', {}, p.primaryText)),
    s ? h('div.search-ad', { 'data-search-ad': '', 'aria-label': 'The Google search ad' },
      h('small', {}, 'Sponsored · ', h('span', {}, [host, s.path1, s.path2].filter(Boolean).join(' › '))),
      h('b', {}, s.headlines.slice(0, 3).join(' | ')),
      h('p', {}, s.descriptions[0] || '')) : null,
    row('Goal', p.goal), row('Who', p.who), row('Where', (p.where || []).join(', ')),
    s ? h('div.wo-row', {}, h('span', {}, 'Keywords'), h('p.keywords', { 'data-keywords': '' }, ...s.keywords.map((k) => h('span.kw', {}, k)))) : null,
    row('A vs B', `A: ${p.test.a}  ·  B: ${p.test.b}`), row('Winner', p.test.measure));
}
/** Where paid ads run, as a switch plate: Google Search lit, Facebook and Instagram taped over until they come. */
function whereEl(b) {
  const ch = b.channels || [];
  if (!ch.length) return null;
  return h('div.ad-where', { role: 'radiogroup', 'aria-label': 'Where paid ads run', 'data-ad-where': '' }, ...ch.map((c) => {
    const off = !c.on;
    return h(`button.plate${c.on ? '.on' : ''}${off ? '.soon' : ''}`, { type: 'button', role: 'radio', 'aria-checked': String(!!c.on), 'aria-disabled': String(off), disabled: off, 'data-channel': c.id },
      h('i.plate-lamp', { 'aria-hidden': 'true' }), h('b', {}, `${c.label} ads`), off ? h('span.tape', {}, c.soon ? 'coming soon' : 'off for now') : null);
  }));
}
function moneyEl(page, b) {
  let chosen = page.bizMoney ?? b.adMoney.chosen ?? 0;
  if (!b.adMoney.options.includes(chosen)) chosen = 0;
  const coins = b.adMoney.options.map((n) => h(`button.coin${n === chosen ? '.on' : ''}`, { type: 'button', role: 'radio', 'aria-checked': String(n === chosen), 'data-money': String(n), onclick: (e) => {
    chosen = n; page.bizMoney = n;
    for (const c of e.currentTarget.parentNode.children) { c.classList.toggle('on', c === e.currentTarget); c.setAttribute('aria-checked', String(c === e.currentTarget)); }
    go.lastChild.textContent = n ? `Launch with ${dollars(n)} of ads` : 'Launch for free';
  } }, n ? dollars(n) : h('span', {}, '$0', h('small', {}, 'just for fun'))));
  const go = h('button.btn.primary', { type: 'button', 'data-launch': '', disabled: !b.adMoney.ready, onclick: async () => {
    go.disabled = true;
    try { const r = await api(`/floors/${page.slug}/business/launch`, { method: 'POST', body: { amount: chosen } }); page.bizMoney = undefined; apply(page, r); } catch (e) { toast(e.message, 'bad'); go.disabled = false; }
  } }, icon('rocket-launch'), h('span', {}, chosen ? `Launch with ${dollars(chosen)} of ads` : 'Launch for free'));
  return h('section.ad-money', { 'data-money-box': '' },
    h('div.wo-head', {}, h('b', {}, 'Ad money'), h('small', {}, b.adMoney.ready ? 'Your choice' : 'Once the ads are ready')),
    whereEl(b),
    h('div.coins', { role: 'radiogroup', 'aria-label': 'Ad money for this campaign' }, ...coins),
    h('p.fineprint', {}, b.adMoney.paid
      ? 'With $0 the ads go up on your floor to share, free. Any other amount becomes a request you approve with one click; then it runs as a Google search ad for up to a week and never spends more than you chose.'
      : 'Paid ads are coming soon. For now the ads go up on your floor to share, free.'),
    go);
}
function customersStep(page, b) {
  return [adsEl(page, b, { share: false }), b.ads?.videoFailed ? h('p.biz-note', {}, `The AI video didn’t work (${b.ads.videoFailed}).`) : null, planEl(b), moneyEl(page, b)].filter(Boolean);
}

function spendEl(page, b) {
  const s = b.adSpend;
  if (!s) return null;
  const decide = (answer) => async (e) => {
    for (const x of e.currentTarget.parentNode.querySelectorAll('button')) x.disabled = true;
    try { const r = await api(`/floors/${page.slug}/business/ad-spend/${s.id}`, { method: 'POST', body: { answer } }); apply(page, r); } catch (err) { toast(err.message, 'bad'); for (const x of e.currentTarget.parentNode.querySelectorAll('button')) x.disabled = false; }
  };
  const live = s.status === 'running' || s.status === 'ended' || s.status === 'paused';
  return h(`section.requisition.${s.status}`, { 'data-ad-spend': s.status },
    h('div.wo-head', {}, h('b', {}, 'AD SPEND request'), h('small', {}, `No. ${s.id}`)),
    h('div.wo-row', {}, h('span', {}, 'Amount'), h('p', {}, h('b', {}, dollars(s.amount)), ', your choice for this campaign')),
    h('div.wo-row', {}, h('span', {}, 'Where'), h('p', {}, s.where || 'Google Search')),
    h('div.wo-row', {}, h('span', {}, 'Ads'), h('p', {}, s.ads.join(', ') || 'The ads above')),
    h('div.wo-row', {}, h('span', {}, 'Audience'), h('p', {}, s.audience)),
    s.endsOn ? h('div.wo-row', {}, h('span', {}, s.status === 'ended' ? 'Ended' : 'Ends'), h('p', {}, s.endsOn)) : null,
    live ? h('div.wo-row', { 'data-ad-stats': '' }, h('span', {}, 'So far'), h('p', {}, `Seen ${s.views} ${s.views === 1 ? 'time' : 'times'}, ${s.clicks} ${s.clicks === 1 ? 'click' : 'clicks'}`)) : null,
    h('p.stamp', {}, s.label),
    s.note ? h('p.fineprint', {}, s.note) : null,
    s.status === 'awaiting_boss' ? h('div.row', {}, h('button.btn.primary', { type: 'button', 'data-approve': '', onclick: decide('approve') }, icon('check-circle'), 'Approve'), h('button.btn.ghost', { type: 'button', 'data-decline': '', onclick: decide('decline') }, 'Decline')) : null,
    s.status === 'awaiting_boss' ? h('p.fineprint', {}, 'Approve and it runs as a Google search ad for up to a week, then stops on its own. It never spends more than this amount.') : null,
    s.status === 'queued' ? h('p.fineprint', {}, 'Nothing runs until the building manager picks it up. Nothing is spent before then.') : null);
}
function launchStep(page, b) {
  const out = [];
  if (b.liveUrl) out.push(h('p.biz-live', {}, icon('globe'), h('a', { href: b.liveUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Open the live site')));
  if (page.owner) {
    out.push(h('p.biz-note', {}, b.launched ? 'Launched. Your launch report is in the chat.' : 'Launching: your manager is writing the launch report.'));
    const s = spendEl(page, b);
    if (s) out.push(s);
    const w = whereEl(b);
    if (w) out.push(w);
  }
  if (b.ads && !b.ads.skipped) out.push(h('h3.biz-sub', {}, 'The ads, ready to share'), adsEl(page, b, { share: true }));
  return out;
}
