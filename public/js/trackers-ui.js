// The sales and website traffic cards (server/trackers.js, docs/TRACKERS.md), inside the status card, for the floor's boss and the admin.
// The server only sends `trackers` in their snapshot; a visitor's page never has it, so nothing here is drawn for them.
import { h } from './dom.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => { const el = document.createElementNS(SVG_NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };
const TZ = 'America/New_York';
const n = (v) => Number(v || 0).toLocaleString('en-US');
const usd = (cents) => `$${(Number(cents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dayName = (day) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const when = (r) => (r.timed ? new Date(r.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: TZ }) : dayName(r.day));

const tile = (label, big, small, attrs = {}) => h('div.trk-tile', attrs, h('span.trk-label', {}, label), h('b.trk-big', {}, big), small ? h('small.trk-small', {}, small) : null);

function salesCard(s) {
  const sold = (x) => `${n(x.count)} sold`;
  return h('section.trk-card', { 'data-tracker': 'sales' },
    h('h3.trk-title', {}, 'Sales'),
    h('div.trk-tiles', {},
      tile('Today', usd(s.today.cents), sold(s.today), { 'data-window': 'today' }),
      tile('7 days', usd(s.week.cents), sold(s.week), { 'data-window': 'week' }),
      tile('This month', usd(s.month.cents), sold(s.month), { 'data-window': 'month' }),
      tile('All time', usd(s.all.cents), sold(s.all), { 'data-window': 'all' })),
    s.recent.length
      ? h('ul.trk-recent', {}, s.recent.slice(0, 5).map((r) => h('li', { 'data-sale': String(r.id) },
        h('span.trk-when', {}, when(r)), h('b.trk-amt', {}, usd(r.amountCents)), h('span.trk-note', {}, `${r.qty > 1 ? `${r.qty} × ` : ''}${r.note || 'Sale'}`), h('small.trk-src', {}, r.source))))
      : h('p.trk-empty', {}, 'No sales logged yet.'));
}

function sparkline(series) {
  const W = 120, H = 28, max = Math.max(1, ...series.map((d) => d.visits));
  const step = series.length > 1 ? W / (series.length - 1) : W;
  const pts = series.map((d, i) => `${(i * step).toFixed(1)},${(H - 2 - (d.visits / max) * (H - 4)).toFixed(1)}`);
  const el = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'trk-spark', role: 'img', preserveAspectRatio: 'none', 'aria-label': `Visitors a day, last ${series.length} days, from ${n(Math.min(...series.map((d) => d.visits)))} to ${n(max)}` });
  el.append(svg('polyline', { points: `0,${H} ${pts.join(' ')} ${W},${H}`, class: 'trk-spark-fill' }), svg('polyline', { points: pts.join(' '), class: 'trk-spark-line' }));
  return el;
}

function trafficCard(t) {
  const test = t.test ? h('span.trk-test', { 'data-test-offset': String(t.test.perDay), title: `Test: +${t.test.perDay} a day since ${dayName(t.test.from)}. Real today: ${n(t.today.real.visits)} visitors, ${n(t.today.real.views)} pageviews.` }, 'test') : null;
  const win = (label, x, key) => tile(label, n(x.visits), `${n(x.views)} views`, { 'data-window': key });
  return h('section.trk-card', { 'data-tracker': 'traffic', 'data-source': t.source },
    h('h3.trk-title', {}, 'Website traffic', test),
    h('div.trk-traffic', {},
      h('div.trk-tiles.trk-3', {}, win('Today', t.today, 'today'), win('7 days', t.week, 'week'), win('30 days', t.month, 'month')),
      h('div.trk-spark-wrap', {}, sparkline(t.series), h('small.trk-small', {}, 'Visitors a day, 30 days'))),
    h('p.trk-foot', {}, t.source === 'manual' ? 'Entered by hand.' : t.source === 'none' ? 'No visits counted yet.' : `Counted by the Office, bots left out${t.source === 'counted+manual' ? '; some days entered by hand' : ''}.`));
}

/** Both cards, or null when the snapshot has none (a visitor, or TRACKERS=0). */
export function trackersBox(state) {
  const tr = state?.trackers;
  if (!tr) return null;
  return h('div.trk', { 'data-trackers': '' }, salesCard(tr.sales), tr.traffic?.shown ? trafficCard(tr.traffic) : null);
}
