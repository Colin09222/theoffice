// The boss's Payments tab (connect Stripe, what's still missing, what sold) and the approval cards under Requests.
// Boss-only by construction: the server answers these routes for the floor's own boss and nobody else, and visitors' views never carry any of it.
import { h, api, clear, modal, toast } from './dom.js';

const fmt = (cents, currency) => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: String(currency || 'usd').toUpperCase() }).format(cents / 100); } catch { return `${(cents / 100).toFixed(2)} ${String(currency || '').toUpperCase()}`; }
};
const priceOf = (p) => `${fmt(p.amountCents, p.currency)}${p.interval ? ` a ${p.interval}` : ''}`;
const NOT_READY = 'Payments are being set up. Soon you will connect your own Stripe account here and take payments right inside the apps your team makes.';
const PAY_STATUS = { active: 'Paid', refunded: 'Refunded', lapsed: 'Ended', disputed: 'Disputed' };

export const payTab = () => ['pay', 'Payments'];
export const payPending = (page) => (page.state?.pay?.ready ? (page.state.pay.waiting || []).length : 0);

/** Back from Stripe's onboarding, with ?pay=return or ?pay=refresh on the address. Land on the panel and clean the address. */
export function onPayLanding(page) {
  const q = new URLSearchParams(location.search);
  const flag = q.get('pay');
  if (!page.owner || (flag !== 'return' && flag !== 'refresh')) return;
  page.tab = 'pay'; page.panelOpen = true; page.payLanded = flag;
  q.delete('pay');
  history.replaceState({}, '', `${location.pathname}${q.toString() ? `?${q}` : ''}`);
}

/** The Requests tab's share: products and prices the team proposed, each one tap from going on sale. */
export function renderPayRequests(page, list) {
  for (const p of page.state?.pay?.waiting || []) {
    const answer = (action) => async () => {
      try {
        await api(`/floors/${page.slug}/pay/products/${p.id}/${action}`, { method: 'POST', body: {} });
        toast(action === 'approve' ? `${p.name} is on sale` : 'Declined');
      } catch (e) { toast(e.message, 'bad'); }
      page.reload();
    };
    list.append(h('article.card.request.pay-approve', { 'data-pay-approve': p.key },
      h('div.row.spread', {}, h('b', {}, p.name), h('span.price', {}, priceOf(p))),
      p.description ? h('p', {}, p.description) : null,
      h('small', {}, `${p.agentName || 'The team'} proposed this for ${p.project}${p.replaces ? '. It replaces the current price; people already subscribed keep theirs.' : '.'}${page.state.pay.testMode ? ' Test mode.' : ''}`),
      p.why ? h('p.fineprint', {}, p.why) : null,
      !page.state.pay.connected ? h('p.fineprint', {}, 'Connect Stripe on the Payments tab first, then approve this.') : null,
      p.unlocks?.length ? h('p.fineprint', {}, `Only buyers can use: ${p.unlocks.join(', ')}`) : null,
      h('div.row', {}, h('button.btn.primary', { type: 'button', 'data-pay-approve-yes': p.key, onclick: answer('approve') }, 'Approve'), h('button.btn.ghost', { type: 'button', onclick: answer('decline') }, 'No thanks'))));
  }
}

const connectButton = (page, label) => h('button.btn.primary.wide', { type: 'button', 'data-pay-connect': '', onclick: async (e) => {
  e.target.disabled = true;
  try { const r = await api(`/floors/${page.slug}/pay/connect`, { method: 'POST', body: {} }); location.assign(r.url); } catch (err) { toast(err.message, 'bad'); e.target.disabled = false; }
} }, label);

function accountBox(page, a) {
  if (a.state === 'none') {
    return h('section.card.pay-card', { 'data-pay-state': 'none' },
      h('h3', {}, 'Take payments in your apps'),
      h('ul.pay-points', {},
        h('li', {}, 'Customers pay on Stripe\'s own page. Card details never reach this building, your team or your site.'),
        h('li', {}, 'The money goes straight to your own Stripe account. The Office takes no cut.'),
        h('li', {}, 'You are the seller, so tax, refunds and any disputes are yours to handle. Your own Stripe dashboard is where you do that.')),
      connectButton(page, 'Connect Stripe'),
      h('p.fineprint', {}, 'Stripe will ask for your details and a bank account. Have ID handy.'));
  }
  return h('section.card.pay-card', { 'data-pay-state': a.state },
    h('h3', {}, 'Your Stripe account'),
    h('p', { 'data-pay-summary': '' }, a.summary),
    a.missing?.length ? h('div', {}, h('h4', {}, 'Stripe still needs:'), h('ul.pay-missing', { 'data-pay-missing': '' }, ...a.missing.map((m) => h('li', {}, m)))) : null,
    a.state !== 'ready' ? connectButton(page, a.state === 'incomplete' ? 'Finish with Stripe' : 'Continue with Stripe') : h('p', {}, h('a', { href: 'https://dashboard.stripe.com/', target: '_blank', rel: 'noopener noreferrer' }, 'Open my Stripe dashboard')));
}

function productsBox(page, v, reload) {
  if (!v.products.length && !v.proposals.length) return h('section.card.pay-card', {}, h('h3', {}, 'What you sell'), h('p.empty', {}, 'Nothing yet. Ask your team what to charge for: they propose it and you approve each product and price here with one tap.'));
  const off = (p) => async (e) => {
    e.target.disabled = true;
    try { await api(`/floors/${page.slug}/pay/products/${p.id}/archive`, { method: 'POST', body: {} }); toast('Taken off sale. Anyone who already bought it keeps it.'); } catch (err) { toast(err.message, 'bad'); }
    reload();
  };
  return h('section.card.pay-card', {},
    h('h3', {}, 'What you sell'),
    ...v.products.map((p) => h('div.pay-product', { 'data-pay-product': p.key, class: p.status === 'archived' ? 'pay-off' : '' },
      h('div.row.spread', {}, h('b', {}, p.name), h('span', {}, priceOf(p))),
      h('small', {}, `${p.project}${p.status === 'archived' ? ' · off sale' : ''}${p.unlocks?.length ? ` · unlocks ${p.unlocks.join(', ')}` : ''}`),
      p.status === 'live' ? h('button.link', { type: 'button', onclick: off(p) }, 'Take off sale') : null)),
    v.proposals.length ? h('p.fineprint', {}, `${v.proposals.length} more waiting for your OK under Requests.`) : null);
}

function salesBox(page, v, reload) {
  const s = v.sales;
  const tile = (label, value) => h('div.pay-tile', {}, h('b', {}, value), h('span', {}, label));
  const max = Math.max(1, ...s.byDay.map((d) => d.grossCents));
  const refund = (o) => () => modal('Refund this order?', (body, close) => {
    body.append(h('div.stack', {},
      h('p', {}, `${fmt(o.amountCents, o.currency)} goes back to ${o.buyer} and they lose ${o.product}.${o.kind === 'subscription' ? ' Their subscription ends now too.' : ''} This can't be undone.`),
      h('button.btn.primary.wide', { type: 'button', 'data-pay-refund-yes': o.token, onclick: async (e) => {
        e.target.disabled = true;
        try { await api(`/floors/${page.slug}/pay/orders/${o.token}/refund`, { method: 'POST', body: {} }); toast('Refunded'); close(); } catch (err) { toast(err.message, 'bad'); e.target.disabled = false; return; }
        reload();
      } }, 'Refund'),
      h('button.btn.ghost.wide', { type: 'button', onclick: close }, 'Keep it')));
  });
  return h('section.card.pay-card', {},
    h('h3', {}, 'Sales, last 30 days'),
    h('div.pay-tiles', {}, tile('sold', fmt(s.grossCents, s.currency)), tile('refunded', fmt(s.refundsCents, s.currency)), tile('orders', String(s.orders)), tile('subscribers', String(s.activeSubs))),
    s.byDay.length ? h('div.bars', { role: 'img', 'aria-label': 'Sales by day' }, ...s.byDay.map((d) => h('i', { title: `${d.day}: ${fmt(d.grossCents, s.currency)}`, css: { height: `${Math.max(4, (d.grossCents / max) * 100)}%` } }))) : null,
    v.orders.length ? h('div.pay-orders', {}, h('h4', {}, 'Recent orders'), ...v.orders.map((o) => h('div.pay-order', { 'data-pay-order': o.token },
      h('div.row.spread', {}, h('b', {}, o.product), h('span', {}, fmt(o.amountCents, o.currency))),
      h('small', {}, `${o.buyer} · ${PAY_STATUS[o.status] || o.status}${o.kind === 'subscription' ? ' · subscription' : ''}`),
      o.refundable ? h('button.link', { type: 'button', 'data-pay-refund': o.token, onclick: refund(o) }, 'Refund') : null))) : h('p.empty', {}, 'No orders yet.'),
    h('p.fineprint', {}, 'Only you can see this. Stripe emails your customers their receipts; check that "Successful payments" is on under Customer emails in your Stripe settings.'));
}

export async function renderPay(page) {
  const box = h('div.pay-panel', { 'data-pay-panel': '' });
  page.bodyEl.append(box);
  const reload = () => { if (page.tab === 'pay') page.renderBody(); };
  let v;
  try { v = await api(`/floors/${page.slug}/pay${page.payLanded ? '?refresh=1' : ''}`); } catch (e) { box.append(h('p.empty', {}, e.message)); return; }
  if (!box.isConnected) return;
  clear(box);
  if (!v.ready) { box.append(h('section.card.pay-card', { 'data-pay-state': 'not-ready' }, h('h3', {}, 'Payments are being set up'), h('p', {}, NOT_READY))); return; }
  if (v.testMode) box.append(h('p.pay-test', { 'data-pay-test': '' }, 'Test mode: no real money moves, and Stripe\'s test cards are the only cards that work.'));
  if (page.payLanded === 'refresh') box.append(h('p.pay-note', {}, 'That Stripe link expired. Tap below to pick up where you left off.'));
  else if (page.payLanded === 'return' && v.account.state !== 'none') box.append(h('p.pay-note', {}, v.account.state === 'ready' ? 'Connected. You are ready to take payments.' : 'Welcome back. Here is where it stands.'));
  page.payLanded = null;
  box.append(accountBox(page, v.account));
  if (v.account.state !== 'none') box.append(productsBox(page, v, reload), salesBox(page, v, reload));
  box.append(h('p.fineprint', {}, 'Already have a Stripe Payment Link? You can still paste it on a project card under Projects; it stays as a simple Buy button.'));
}
