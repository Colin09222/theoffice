// The Numbers tab: the boss's company dashboard, phone first. Only the boss's page ever asks for it, and the server answers nobody else.
// No chart library and nothing from anywhere else: the bars are plain SVG, and tapping or hovering one reads it out. See docs/NUMBERS.md.
import { h, api, clear } from './dom.js';
import { renderMarkdown } from './markdown.js';

const WINDOWS = [['today', 'Today'], ['week', '7 days'], ['month', '30 days']];
const SVG_NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => { const el = document.createElementNS(SVG_NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };
const count = (n) => Number(n || 0).toLocaleString();
const SIGNS = { usd: '$', gbp: '£', eur: '€' };
const money = (cents, currency = 'usd') => { const v = (Number(cents || 0) / 100).toFixed(2); const c = String(currency || 'usd').toLowerCase(); return SIGNS[c] ? `${SIGNS[c]}${v}` : `${v} ${c.toUpperCase()}`; };
const dayLabel = (day) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const shortDay = (day) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });

function tile(label, value, sub) { return h('div.num-tile', {}, h('b', {}, value), h('span', {}, label), sub ? h('small', {}, sub) : null); }

/** Bars for one measure, oldest on the left. Tap or hover a bar to read that day; the newest day is read out to begin with. */
function barChart({ title, rows, value, line, id, mark = '' }) {
  const box = h('section.num-chart', { 'data-chart': id });
  const top = Math.max(...rows.map(value), 0);
  box.append(h('h4', {}, title));
  if (!top) { box.append(h('p.num-none', {}, 'Nothing on record yet.')); return box; }
  const W = 320, H = 120, gap = rows.length > 14 ? 2 : 6, base = H - 16;
  const bw = (W - gap * (rows.length - 1)) / rows.length;
  const read = h('p.num-read', { 'aria-live': 'polite' });
  const say = (r) => { read.textContent = `${dayLabel(r.day)}: ${line(r)}`; };
  const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${title}. ${rows.map((r) => `${shortDay(r.day)}: ${line(r)}`).join('; ')}` });
  chart.append(svg('line', { x1: 0, x2: W, y1: base, y2: base, class: 'num-axis' }));
  rows.forEach((r, i) => {
    const x = i * (bw + gap), v = value(r), bar = v ? Math.max(3, (v / top) * (base - 4)) : 0;
    const g = svg('g', { class: `num-bar${mark === r.day ? ' mark' : ''}` });
    if (bar) { const y = base - bar, rr = Math.min(4, bw / 2, bar / 2); g.append(svg('path', { d: `M${x},${base}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + bw - rr}Q${x + bw},${y} ${x + bw},${y + rr}V${base}Z` })); }
    const hit = svg('rect', { x: Math.max(0, x - gap / 2), y: 0, width: bw + gap, height: H, class: 'num-hit' });
    const label = svg('title'); label.textContent = `${dayLabel(r.day)}: ${line(r)}`; hit.append(label);
    for (const ev of ['pointerenter', 'pointerdown', 'click']) hit.addEventListener(ev, () => say(r));
    g.append(hit); chart.append(g);
  });
  const first = svg('text', { x: 0, y: H - 3, class: 'num-tick' }); first.textContent = shortDay(rows[0].day);
  const last = svg('text', { x: W, y: H - 3, class: 'num-tick', 'text-anchor': 'end' }); last.textContent = shortDay(rows.at(-1).day);
  chart.append(first, last);
  say(rows.at(-1));
  box.append(chart, read);
  return box;
}
function listCard(title, rows, label, none) {
  const box = h('section.num-list', {}, h('h4', {}, title));
  if (!rows.length) { box.append(h('p.num-none', {}, none)); return box; }
  const top = Math.max(...rows.map((r) => r.n), 1);
  for (const r of rows) box.append(h('div.num-row', { css: { '--w': `${Math.max(2, r.n / top * 100)}%` } }, h('span', { title: label(r) }, label(r)), h('b', {}, count(r.n))));
  return box;
}

function paint(page, box, v) {
  const st = page.numbersView;
  clear(box);
  const win = v.windows[st.win];
  const nothing = !v.series.some((d) => d.visitors || d.views || d.signups || d.accounts || d.orders);
  const seg = h('div.num-seg', { role: 'radiogroup', 'aria-label': 'Period' });
  for (const [id, label] of WINDOWS) seg.append(h('button', { type: 'button', role: 'radio', 'aria-checked': String(st.win === id), 'data-win': id, onclick: () => { st.win = id; paint(page, box, v); } }, label));
  const bar = h('div.num-top', {}, seg);
  if (v.projects.length > 1) {
    bar.append(h('select.num-project', { 'aria-label': 'Project', name: 'numbers-project', onchange: (e) => { st.project = e.target.value; loadNumbers(page, box); } },
      h('option', { value: '', selected: !v.project }, 'All projects'),
      ...v.projects.map((p) => h('option', { value: p.slug, selected: v.project === p.slug }, p.title))));
  }
  box.append(bar);
  if (nothing) box.append(h('p.num-empty', {}, 'No visitors or sign-ups on record yet. When people open something this company has published, or fill in one of its forms, they show up here.'));
  const sold = v.sales.state === 'ok';
  box.append(h('div.num-tiles', {},
    tile('Visitors', count(win.visitors)), tile('Page views', count(win.views)), tile('Sign-ups', count(win.signups)), tile('New accounts', count(win.accounts)),
    sold ? tile('Sales', money(win.grossCents, v.sales.currency)) : tile('Sales', '–', v.sales.state === 'error' ? 'couldn\'t be read just now' : 'no sales yet'),
    sold ? tile('Orders', count(win.orders)) : null, sold || v.sales.activeSubs ? tile('Active subscribers', count(v.sales.activeSubs)) : null));
  if (v.sales.wholeCompany && sold) box.append(h('p.num-note', {}, 'Sales are for the whole company, not this one project.'));
  if (v.usage.accounts || v.signupsTotal) box.append(h('p.num-note', {}, `So far: ${count(v.usage.accounts)} account${v.usage.accounts === 1 ? '' : 's'} and ${count(v.signupsTotal)} sign-up${v.signupsTotal === 1 ? '' : 's'}.`));

  // Today has no bars of its own, so it shows the last 7 days with today picked out.
  const days = v.series.slice(st.win === 'month' ? -30 : -7);
  const mark = st.win === 'today' ? days.at(-1).day : '';
  box.append(barChart({ id: 'visitors', title: st.win === 'today' ? 'Visitors, last 7 days' : 'Visitors', rows: days, mark, value: (d) => d.visitors, line: (d) => `${count(d.visitors)} visitor${d.visitors === 1 ? '' : 's'}, ${count(d.views)} page view${d.views === 1 ? '' : 's'}` }));
  box.append(barChart({ id: 'signups', title: st.win === 'today' ? 'Sign-ups and new accounts, last 7 days' : 'Sign-ups and new accounts', rows: days, mark, value: (d) => d.signups + d.accounts, line: (d) => `${count(d.signups)} sign-up${d.signups === 1 ? '' : 's'}, ${count(d.accounts)} new account${d.accounts === 1 ? '' : 's'}` }));
  if (sold) box.append(barChart({ id: 'sales', title: st.win === 'today' ? 'Sales, last 7 days' : 'Sales', rows: days, mark, value: (d) => d.grossCents, line: (d) => `${money(d.grossCents, v.sales.currency)}, ${count(d.orders)} order${d.orders === 1 ? '' : 's'}` }));

  if (v.ads) {
    const a = v.ads;
    box.append(h('section.num-ads', { 'data-ads': '' }, h('h4', {}, 'Ads against what you earned'),
      h('div.num-versus', {},
        h('div', {}, h('small', {}, 'Spent on ads'), h('b', {}, a.reported ? money(a.spentCents) : 'Not reported yet')),
        h('div', {}, h('small', {}, 'Earned'), h('b', {}, sold ? money(a.earnedCents, a.currency) : 'No sales yet')),
        a.reported && sold && a.leftCents !== null ? h('div', {}, h('small', {}, 'Left after ads'), h('b', {}, money(a.leftCents))) : null),
      h('p.num-note', {}, `The last 30 days. ${a.campaigns === 1 ? 'One campaign' : `${a.campaigns} campaigns`}${a.clicks ? `, ${count(a.clicks)} clicks` : ''}. Ad spend is a running total, so it doesn't change with the period above.`)));
  } else box.append(h('section.num-ads', { 'data-ads': 'none' }, h('h4', {}, 'Ads against what you earned'), h('p.num-none', {}, 'No ads have run in the last 30 days.')));

  box.append(listCard('Top pages', win.pages.map((p) => ({ n: p.views, name: p.path === '/' ? 'Home page' : `/${String(p.path).replace(/^\/+/, '')}` })), (r) => r.name, 'No page views in this period.'));
  box.append(listCard('Where visitors came from', win.sources.map((s) => ({ n: s.n, name: s.ref })), (r) => r.name, 'No links from other sites in this period yet.'));
  box.append(h('p.num-note.num-foot', {}, 'Only you can see this page. Days run midnight to midnight UTC. A person who comes back on another day counts again.'));
}

async function loadNumbers(page, box) {
  const st = page.numbersView;
  let v;
  try { v = await api(`/floors/${page.slug}/numbers${st.project ? `?project=${encodeURIComponent(st.project)}` : ''}`); } catch (e) { if (box.isConnected) clear(box).append(h('p.empty', {}, e.message)); return; }
  if (!box.isConnected) return;  // the boss went to another tab meanwhile
  paint(page, box, v);
}

export async function renderNumbers(page) {
  page.numbersView ||= { win: 'week', project: '' };
  const wrap = h('div.numbers', { 'data-numbers': '' });
  page.bodyEl.append(wrap);
  const last = page.state.daily?.last;
  if (last?.report) { const r = h('section.num-report', { 'data-report': '' }); r.innerHTML = renderMarkdown(last.report); wrap.append(r); }
  const box = h('div.numbers-body', {}, h('p.empty', {}, 'Adding up the numbers…'));
  wrap.append(box);
  loadNumbers(page, box);
}

/** The opt-in under Customise, Hours: off until the boss turns it on, at the time they pick, in their own time zone. */
export function dailyFields(daily, ownTz) {
  const d = daily || {};
  const state = { on: !!d.on, at: d.at || '09:00', tz: d.tz && d.tz !== 'UTC' ? d.tz : ownTz };
  const before = JSON.stringify(state);
  const when = h('div.field.daily-when', { hidden: !state.on });
  const box = h('input', { type: 'checkbox', name: 'daily-on', checked: state.on, onchange: (e) => { state.on = e.target.checked; when.hidden = !state.on; } });
  when.append(h('label.field', {}, h('span', {}, 'What time'), h('input', { type: 'time', name: 'daily-at', value: state.at, step: 900, oninput: (e) => { if (e.target.value) state.at = e.target.value; } })),
    h('small.field-hint', {}, `In your own time zone: ${state.tz.replace(/_/g, ' ')}. The first run is the next time the clock gets there.${d.needsGoal ? ' Your manager will ask you for a goal first.' : ''}`));
  const el = h('div.stack.daily-box', { 'data-daily': '' },
    h('label.daily-switch', {}, box, h('span', {}, h('b', {}, 'Run my company every day'), h('small', {}, 'Once a day your manager looks at the numbers, the inbox and open bugs, picks one improvement and has the team build it. It only goes live if the Tester passes it, and you get a short report. Off unless you turn it on.'))),
    when);
  return { el, changed: () => JSON.stringify(state) !== before, value: () => ({ on: state.on, at: state.at, tz: state.tz }) };
}
