// A stand-in for Stripe that speaks its REST API over real HTTP on 127.0.0.1, so tests run the real provider code end to end and nothing ever reaches
// stripe.com. It holds connected accounts, products, prices, Checkout, subscriptions, invoices, refunds and the customer portal per account, serves
// Stripe-hosted pages of its own (onboarding, checkout, portal) that a real browser can click through, signs and delivers webhooks the way Stripe does,
// and keeps idempotency keys. Shapes and refusals follow docs.stripe.com for API version 2026-10-28.endive.
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { signStripe, STRIPE_VERSION } from './pay-provider.js';

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const rid = (n = 18) => { const b = randomBytes(n); let s = ''; for (let i = 0; i < n; i++) s += ID_CHARS[b[i] % ID_CHARS.length]; return s; };
const CURRENTLY_DUE = ['business_profile.url', 'business_type', 'external_account', 'tos_acceptance.date', 'tos_acceptance.ip', 'individual.first_name', 'individual.id_number'];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The nested object a form body means: a[b][0]=c. Numeric keys become arrays. */
function parseForm(text) {
  const root = {};
  for (const pair of String(text || '').split('&')) {
    if (!pair) continue;
    const i = pair.indexOf('=');
    const name = decodeURIComponent(pair.slice(0, i < 0 ? undefined : i).replace(/\+/g, ' '));
    const value = i < 0 ? '' : decodeURIComponent(pair.slice(i + 1).replace(/\+/g, ' '));
    const path = name.replace(/\]/g, '').split('[');
    let at = root;
    for (let n = 0; n < path.length - 1; n++) {
      const k = path[n];
      if (at[k] === undefined) at[k] = {};
      at = at[k];
    }
    at[path[path.length - 1]] = value;
  }
  const arrays = (v) => {
    if (v && typeof v === 'object') {
      const keys = Object.keys(v);
      for (const k of keys) v[k] = arrays(v[k]);
      if (keys.length && keys.every((k) => /^\d+$/.test(k))) return keys.sort((a, b) => a - b).map((k) => v[k]);
    }
    return v;
  };
  return arrays(root);
}
const bool = (v) => v === true || v === 'true';

export async function startMockStripe({ apiKey = 'sk_test_mock_key', connectedSecret = `whsec_${rid(32)}`, version = STRIPE_VERSION } = {}) {
  const state = { accounts: new Map(), requests: [], endpoints: [], delivered: [], failNext: [], idem: new Map() };
  const perAccount = () => ({ products: new Map(), prices: new Map(), customers: new Map(), sessions: new Map(), subscriptions: new Map(), invoices: new Map(), charges: new Map(), intents: new Map(), portal: new Map(), portalSessions: new Map(), refunds: new Map() });
  const stores = new Map();
  const db = (acct) => { if (!stores.has(acct)) stores.set(acct, perAccount()); return stores.get(acct); };
  const onboardTokens = new Map();
  let base = '';
  let t0 = null;
  const now = () => Math.floor((t0 ?? Date.now()) / 1000);
  const err = (status, type, message, extra = {}) => ({ status, body: { error: { type, message, ...extra } } });
  const invalid = (message, extra) => err(400, 'invalid_request_error', message, extra);
  const notFound = (what, id) => err(404, 'invalid_request_error', `No such ${what}: '${id}'`, { code: 'resource_missing' });

  async function deliver(type, object, account) {
    const event = { id: `evt_${rid(24)}`, object: 'event', api_version: version, created: now(), data: { object }, livemode: !apiKey.includes('_test_'), pending_webhooks: 1, request: { id: null, idempotency_key: null }, type, account };
    for (const ep of state.endpoints) {
      if (!ep.enabled_events.includes('*') && !ep.enabled_events.includes(type)) continue;
      await post(ep, event, account);
    }
    return event;
  }
  async function post(ep, event, account) {
    const body = JSON.stringify(event);
    const timestamp = now();
    const signature = `t=${timestamp},v0=${'0'.repeat(64)},${signStripe({ secret: ep.secret, timestamp, body }).split(',')[1]}`;
    const entry = { event, account, status: 0 };
    state.delivered.push(entry);
    try {
      const r = await fetch(ep.url, { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8', 'stripe-signature': signature, 'user-agent': 'Stripe/1.0 (+https://stripe.com/docs/webhooks)' }, body });
      entry.status = r.status;
      await r.text();
    } catch { entry.status = -1; }
  }

  /** The answer is shaped like Accounts v2, the account itself is the v1 record the rest of the mock (and the app) reads. */
  function makeV2Account(p) {
    if (!p.identity?.country) return err(400, 'invalid_request_error', 'The field identity.country is required before setting configuration.merchant.', { code: 'identity_country_required' });
    if (p.dashboard !== 'full' || p.defaults?.responsibilities?.fees_collector !== 'stripe' || p.defaults?.responsibilities?.losses_collector !== 'stripe') return invalid('A full Stripe Dashboard account must pay its own Stripe fees and leave losses with Stripe.');
    if (p.configuration?.merchant?.capabilities?.card_payments?.requested !== true) return invalid('Request the card_payments capability.');
    const made = makeAccount({ country: String(p.identity.country).toUpperCase(), metadata: p.metadata, controller: { fees: { payer: 'account' }, losses: { payments: 'stripe' }, requirement_collection: 'stripe', stripe_dashboard: { type: 'full' } } });
    if (made.status !== 200) return made;
    return { status: 200, body: { id: made.body.id, object: 'v2.core.account', applied_configurations: ['merchant'], dashboard: 'full', display_name: p.display_name ?? null, livemode: false } };
  }
  function makeAccount(p) {
    const c = p.controller || {};
    const dash = c.stripe_dashboard?.type ?? 'full';
    const fees = c.fees?.payer ?? (dash === 'full' ? 'account' : 'application');
    const losses = c.losses?.payments ?? (dash === 'full' ? 'stripe' : 'application');
    const req = c.requirement_collection ?? 'stripe';
    // The combinations docs.stripe.com/connect/accounts/controller-properties rules out.
    if (dash === 'full' && (fees !== 'account' || losses !== 'stripe' || req !== 'stripe')) return invalid('A full Stripe Dashboard account must pay its own Stripe fees, leave losses and requirement collection with Stripe.');
    const id = `acct_${rid(16)}`;
    const account = {
      id, object: 'account', business_profile: { url: null, name: null }, business_type: null, capabilities: {}, charges_enabled: false, payouts_enabled: false, details_submitted: false,
      controller: { fees: { payer: fees }, is_controller: true, losses: { payments: losses }, requirement_collection: req, stripe_dashboard: { type: dash }, type: 'application' },
      country: p.country || 'US', created: now(), default_currency: 'usd', email: p.email ?? null, metadata: p.metadata || {}, type: dash === 'full' ? 'standard' : 'none',
      requirements: { alternatives: [], current_deadline: null, currently_due: [...CURRENTLY_DUE], disabled_reason: 'requirements.past_due', errors: [], eventually_due: [...CURRENTLY_DUE], past_due: [...CURRENTLY_DUE], pending_verification: [] },
      future_requirements: { alternatives: [], current_deadline: null, currently_due: [], disabled_reason: null, errors: [], eventually_due: [], past_due: [], pending_verification: [] },
      settings: { dashboard: { display_name: null }, payments: { statement_descriptor: null } },
    };
    state.accounts.set(id, account);
    return { status: 200, body: account };
  }
  const enable = (a) => {
    a.charges_enabled = true; a.payouts_enabled = true; a.details_submitted = true;
    a.requirements = { ...a.requirements, currently_due: [], eventually_due: [], past_due: [], disabled_reason: null };
    a.business_type = 'individual'; a.business_profile.url = 'https://example.com';
    return a;
  };

  function makeSession(acct, p) {
    const d = db(acct);
    const item = p.line_items?.[0];
    if (!item?.price) return invalid('line_items is required.');
    const price = d.prices.get(item.price);
    if (!price) return invalid(`No such price: '${item.price}'`, { code: 'resource_missing' });
    if (!price.active) return invalid(`The price specified is inactive. This field only accepts active prices.`);
    if (!['payment', 'subscription', 'setup'].includes(p.mode)) return invalid('mode must be payment, subscription or setup.');
    if (p.mode === 'subscription' && !price.recurring) return invalid('You specified `subscription` mode but passed non-recurring prices.');
    if (p.mode === 'payment' && price.recurring) return invalid('You must specify `mode` to be `subscription` for recurring prices.');
    if (p.mode === 'payment' && p.subscription_data) return invalid('You can only set `subscription_data` in `subscription` mode.');
    if (p.mode === 'subscription' && p.payment_intent_data) return invalid('You can only set `payment_intent_data` in `payment` mode.');
    if (p.mode === 'subscription' && p.customer_creation) return invalid('`customer_creation` can only be set in `payment` and `setup` mode.');
    // Every line is checked the way the first is, and a basket's total is the sum of its lines.
    let total = 0; const lineList = [];
    for (const li of p.line_items) {
      const pr = d.prices.get(li?.price);
      if (!pr) return invalid(`No such price: '${li?.price}'`, { code: 'resource_missing' });
      if (!pr.active) return invalid('The price specified is inactive. This field only accepts active prices.');
      if (p.mode === 'payment' && pr.recurring) return invalid('You must specify `mode` to be `subscription` for recurring prices.');
      const q = Number(li.quantity || 1);
      if (!Number.isInteger(q) || q < 1) return invalid('quantity must be a positive integer.');
      total += pr.unit_amount * q; lineList.push({ price: li.price, quantity: q });
    }
    const sac = p.shipping_address_collection;
    if (sac !== undefined && !(Array.isArray(sac?.allowed_countries) && sac.allowed_countries.length && sac.allowed_countries.every((c) => /^[A-Z]{2}$/.test(c)))) return invalid('shipping_address_collection.allowed_countries must be a list of two-letter country codes.');
    if (sac && p.mode !== 'payment') return invalid('shipping_address_collection is for payment mode.');
    if (p.payment_intent_data?.application_fee_amount !== undefined || p.subscription_data?.application_fee_percent !== undefined) return invalid('Mock: this platform never takes an application fee.');
    if (!p.success_url || !/^https?:\/\//.test(p.success_url)) return invalid('success_url must be a URL.');
    const id = `cs_test_${rid(40)}`;
    const session = {
      id, object: 'checkout.session', amount_subtotal: total, amount_total: total, lines: lineList, shipping_address_collection: sac || null, collected_information: null, client_reference_id: p.client_reference_id || null, created: now(),
      currency: price.currency, customer: p.customer || null, customer_creation: p.customer_creation || null, customer_details: null, customer_email: p.customer_email || null, expires_at: now() + 86400, livemode: false,
      metadata: p.metadata || {}, mode: p.mode, payment_intent: null, payment_intent_data: p.payment_intent_data || null, payment_status: 'unpaid', status: 'open', subscription: null, subscription_data: p.subscription_data || null,
      success_url: p.success_url, cancel_url: p.cancel_url || null, url: `${base}/hosted/checkout/${id}?a=${acct}`, invoice: null, line_price: item.price,
    };
    d.sessions.set(id, session);
    return { status: 200, body: session };
  }

  function chargeFor(d, amount, currency, metadata, customer, receipt) {
    const pi = `pi_${rid(24)}`, ch = `ch_${rid(24)}`;
    const charge = { id: ch, object: 'charge', amount, amount_refunded: 0, captured: true, currency, customer, disputed: false, metadata: metadata || {}, paid: true, payment_intent: pi, receipt_email: receipt || null, refunded: false, status: 'succeeded', created: now() };
    d.charges.set(ch, charge);
    d.intents.set(pi, { id: pi, object: 'payment_intent', amount, amount_received: amount, currency, customer, latest_charge: ch, metadata: metadata || {}, receipt_email: receipt || null, status: 'succeeded' });
    return charge;
  }
  /** What pressing Pay on the hosted page does: the customer, the payment, the subscription and its first invoice, then the events. */
  async function payCheckout(acct, id, { email = 'buyer@example.com', asyncPayment = false } = {}) {
    const d = db(acct);
    const s = d.sessions.get(id);
    if (!s) throw new Error('no session');
    if (s.status !== 'open') throw new Error(`session is ${s.status}`);
    const price = d.prices.get(s.line_price);
    let customer = s.customer;
    if (!customer) { customer = `cus_${rid(14)}`; d.customers.set(customer, { id: customer, object: 'customer', email, created: now() }); }
    s.customer = customer;
    s.customer_details = { email, name: 'Test Buyer', address: null, tax_exempt: 'none', tax_ids: [] };
    if (s.shipping_address_collection) {
      const address = { line1: '12 Test Lane', line2: null, city: 'Testville', state: 'CA', postal_code: '94000', country: s.shipping_address_collection.allowed_countries[0] };
      s.customer_details.address = address;
      s.collected_information = { shipping_details: { name: 'Test Buyer', address } };
    }
    s.status = 'complete';
    if (s.mode === 'subscription') {
      const sub = `sub_${rid(24)}`;
      const inv = `in_${rid(24)}`;
      const interval = price.recurring.interval;
      const end = now() + (interval === 'year' ? 365 : 30) * 86400;
      const metadata = s.subscription_data?.metadata || {};
      const subscription = {
        id: sub, object: 'subscription', cancel_at_period_end: false, canceled_at: null, created: now(), currency: price.currency, customer, latest_invoice: inv, metadata, start_date: now(), status: 'active',
        items: { object: 'list', data: [{ id: `si_${rid(14)}`, object: 'subscription_item', current_period_start: now(), current_period_end: end, price, quantity: 1, metadata: {} }], has_more: false },
      };
      d.subscriptions.set(sub, subscription);
      const charge = chargeFor(d, price.unit_amount, price.currency, {}, customer, null);
      const invoice = {
        id: inv, object: 'invoice', amount_due: price.unit_amount, amount_paid: price.unit_amount, amount_remaining: 0, billing_reason: 'subscription_create', currency: price.currency, customer, customer_email: email, status: 'paid', created: now(),
        parent: { type: 'subscription_details', quote_details: null, subscription_details: { metadata, subscription: sub } }, period_end: end, period_start: now(),
        payments: { object: 'list', data: [{ id: `inpay_${rid(14)}`, object: 'invoice_payment', amount_paid: price.unit_amount, invoice: inv, is_default: true, livemode: false, payment: { type: 'payment_intent', payment_intent: charge.payment_intent }, status: 'paid' }], has_more: false, url: '/v1/invoice_payments' },
      };
      d.invoices.set(inv, invoice);
      s.subscription = sub; s.invoice = inv; s.payment_status = 'paid';
      await deliver('customer.subscription.created', subscription, acct);
      await deliver('invoice.paid', withoutPayments(invoice), acct);
      await deliver('checkout.session.completed', s, acct);
      return s;
    }
    const metadata = s.payment_intent_data?.metadata || {};
    const receipt = s.payment_intent_data?.receipt_email || null;
    const charge = chargeFor(d, s.amount_total, s.currency, metadata, customer, receipt);
    s.payment_intent = charge.payment_intent;
    if (asyncPayment) {
      charge.paid = false; charge.status = 'pending';
      s.payment_status = 'unpaid';
      await deliver('checkout.session.completed', s, acct);
      return s;
    }
    s.payment_status = 'paid';
    await deliver('checkout.session.completed', s, acct);
    return s;
  }
  const withoutPayments = (invoice) => { const { payments: _p, ...rest } = invoice; return rest; };
  async function finishAsync(acct, id, ok = true) {
    const d = db(acct);
    const s = d.sessions.get(id);
    if (ok) { s.payment_status = 'paid'; const c = [...d.charges.values()].find((x) => x.payment_intent === s.payment_intent); if (c) { c.paid = true; c.status = 'succeeded'; } await deliver('checkout.session.async_payment_succeeded', s, acct); } else { await deliver('checkout.session.async_payment_failed', s, acct); }
    return s;
  }
  async function renew(acct, subId) {
    const d = db(acct);
    const sub = d.subscriptions.get(subId);
    const price = sub.items.data[0].price;
    const inv = `in_${rid(24)}`;
    const charge = chargeFor(d, price.unit_amount, price.currency, {}, sub.customer, null);
    const invoice = {
      id: inv, object: 'invoice', amount_due: price.unit_amount, amount_paid: price.unit_amount, amount_remaining: 0, billing_reason: 'subscription_cycle', currency: price.currency, customer: sub.customer, status: 'paid', created: now(),
      parent: { type: 'subscription_details', quote_details: null, subscription_details: { metadata: sub.metadata, subscription: subId } },
      payments: { object: 'list', data: [{ id: `inpay_${rid(14)}`, object: 'invoice_payment', amount_paid: price.unit_amount, invoice: inv, is_default: true, livemode: false, payment: { type: 'payment_intent', payment_intent: charge.payment_intent }, status: 'paid' }], has_more: false, url: '/v1/invoice_payments' },
    };
    d.invoices.set(inv, invoice);
    sub.latest_invoice = inv;
    await deliver('invoice.paid', withoutPayments(invoice), acct);
    return invoice;
  }
  async function setSubscriptionStatus(acct, subId, status) {
    const sub = db(acct).subscriptions.get(subId);
    sub.status = status;
    await deliver(status === 'canceled' ? 'customer.subscription.deleted' : 'customer.subscription.updated', sub, acct);
    return sub;
  }
  async function refund(acct, p) {
    const d = db(acct);
    const pi = p.payment_intent, ch = p.charge;
    const charge = [...d.charges.values()].find((c) => (pi && c.payment_intent === pi) || (ch && c.id === ch));
    if (!charge) return pi ? notFound('payment_intent', pi) : invalid('You must supply a charge or a payment_intent.');
    const left = charge.amount - charge.amount_refunded;
    if (left <= 0) return invalid(`Charge ${charge.id} has already been refunded.`, { code: 'charge_already_refunded' });
    const amount = p.amount === undefined ? left : Number(p.amount);
    if (amount > left) return invalid(`Refund amount (${amount}) is greater than unrefunded amount on charge (${left})`);
    const id = `re_${rid(24)}`;
    const re = { id, object: 'refund', amount, charge: charge.id, currency: charge.currency, metadata: p.metadata || {}, payment_intent: charge.payment_intent, reason: p.reason || null, status: 'succeeded', created: now() };
    d.refunds.set(id, re);
    charge.amount_refunded += amount;
    charge.refunded = charge.amount_refunded >= charge.amount;
    await deliver('charge.refunded', charge, acct);
    return { status: 200, body: re };
  }
  async function dispute(acct, chargeId, { status = null } = {}) {
    const charge = db(acct).charges.get(chargeId);
    charge.disputed = !status || status === 'needs_response';
    const d = { id: `dp_${rid(24)}`, object: 'dispute', amount: charge.amount, charge: chargeId, currency: charge.currency, payment_intent: charge.payment_intent, reason: 'fraudulent', status: status || 'needs_response', created: now(), metadata: {} };
    await deliver(status ? 'charge.dispute.closed' : 'charge.dispute.created', d, acct);
    return d;
  }

  async function api(method, path, query, p, acct) {
    const a = acct ? state.accounts.get(acct) : null;
    if (acct && !a) return err(403, 'invalid_request_error', `The provided key does not have access to account '${acct}' (or that account does not exist).`, { code: 'account_invalid' });
    // Every hosted-page object is the connected account's, so they all need the header. A forgotten one is a bug the mock must catch.
    const needsAccount = (re) => { if (!acct) throw Object.assign(new Error('x'), { res: err(400, 'invalid_request_error', `Mock: ${re} only exists on a connected account, and no Stripe-Account header was sent.`) }); };
    let m;
    if (path === '/v1/accounts' && method === 'POST') return invalid('Stripe no longer recommends Accounts v1 for new Connect integrations. Create connected accounts with POST /v2/core/accounts instead.');
    if (path === '/v2/core/accounts' && method === 'POST') return makeV2Account(p);
    if ((m = /^\/v1\/accounts\/(acct_[A-Za-z0-9]+)$/.exec(path)) && method === 'GET') { const x = state.accounts.get(m[1]); return x ? { status: 200, body: x } : notFound('account', m[1]); }
    if (path === '/v1/account_links' && method === 'POST') {
      const x = state.accounts.get(p.account);
      if (!x) return notFound('account', p.account);
      if (p.type !== 'account_onboarding') return invalid('Accounts with access to a Stripe-hosted Dashboard can only use the `account_onboarding` type.');
      if (!/^https?:\/\//.test(p.refresh_url || '') || !/^https?:\/\//.test(p.return_url || '')) return invalid('refresh_url and return_url must be URLs.');
      const token = rid(24); onboardTokens.set(token, { account: p.account, return_url: p.return_url, refresh_url: p.refresh_url, used: false });
      return { status: 200, body: { object: 'account_link', created: now(), expires_at: now() + 300, url: `${base}/hosted/onboard/${token}` } };
    }
    if (path === '/v1/products' && method === 'POST') { needsAccount('a product'); if (!p.name) return invalid('Missing required param: name.'); const id = `prod_${rid(14)}`; const x = { id, object: 'product', active: true, name: p.name, description: p.description || null, metadata: p.metadata || {}, created: now() }; db(acct).products.set(id, x); return { status: 200, body: x }; }
    if ((m = /^\/v1\/products\/(prod_[A-Za-z0-9]+)$/.exec(path)) && method === 'POST') { needsAccount('a product'); const x = db(acct).products.get(m[1]); if (!x) return notFound('product', m[1]); if (p.active !== undefined) x.active = bool(p.active); if (p.name) x.name = p.name; if (p.description !== undefined) x.description = p.description; return { status: 200, body: x }; }
    if (path === '/v1/prices' && method === 'POST') {
      needsAccount('a price');
      if (!db(acct).products.has(p.product)) return notFound('product', p.product);
      if (!/^[a-z]{3}$/.test(p.currency || '')) return invalid('currency must be a three-letter code.');
      const unit = Number(p.unit_amount);
      if (!Number.isInteger(unit) || unit < 0) return invalid('Invalid integer for unit_amount.');
      if (p.recurring && !['month', 'year', 'week', 'day'].includes(p.recurring.interval)) return invalid('Invalid recurring interval.');
      const id = `price_${rid(24)}`;
      const x = { id, object: 'price', active: true, currency: p.currency, metadata: p.metadata || {}, nickname: p.nickname || null, product: p.product, recurring: p.recurring ? { interval: p.recurring.interval, interval_count: 1, usage_type: 'licensed' } : null, type: p.recurring ? 'recurring' : 'one_time', unit_amount: unit, created: now() };
      db(acct).prices.set(id, x);
      return { status: 200, body: x };
    }
    if ((m = /^\/v1\/prices\/(price_[A-Za-z0-9]+)$/.exec(path)) && method === 'POST') { needsAccount('a price'); const x = db(acct).prices.get(m[1]); if (!x) return notFound('price', m[1]); if (p.active !== undefined) x.active = bool(p.active); return { status: 200, body: x }; }
    if (path === '/v1/checkout/sessions' && method === 'POST') { needsAccount('a Checkout Session'); return makeSession(acct, p); }
    if ((m = /^\/v1\/checkout\/sessions\/(cs_[A-Za-z0-9_]+)$/.exec(path)) && method === 'GET') { needsAccount('a Checkout Session'); const x = db(acct).sessions.get(m[1]); return x ? { status: 200, body: x } : notFound('checkout.session', m[1]); }
    if (path === '/v1/billing_portal/configurations' && method === 'POST') {
      needsAccount('a portal configuration');
      if (bool(p.features?.subscription_cancel?.enabled) && !['immediately', 'at_period_end'].includes(p.features.subscription_cancel.mode)) return invalid('features[subscription_cancel][mode] must be immediately or at_period_end.');
      const id = `bpc_${rid(24)}`; const x = { id, object: 'billing_portal.configuration', active: true, features: p.features || {}, default_return_url: p.default_return_url ?? null, business_profile: p.business_profile || {}, created: now() }; db(acct).portal.set(id, x); return { status: 200, body: x };
    }
    if (path === '/v1/billing_portal/sessions' && method === 'POST') {
      needsAccount('a portal session');
      const d = db(acct);
      if (!d.customers.has(p.customer)) return notFound('customer', p.customer);
      if (p.configuration ? !d.portal.has(p.configuration) : !d.portal.size) return invalid("You can't create a portal session in test mode until you save your customer portal settings in test mode at https://dashboard.stripe.com/test/settings/billing/portal.");
      const id = `bps_${rid(24)}`;
      const x = { id, object: 'billing_portal.session', configuration: p.configuration || [...d.portal.keys()][0], created: now(), customer: p.customer, livemode: false, on_behalf_of: null, return_url: p.return_url || null, url: `${base}/hosted/portal/${id}?a=${acct}` };
      d.portalSessions.set(id, x);
      return { status: 200, body: x };
    }
    if ((m = /^\/v1\/subscriptions\/(sub_[A-Za-z0-9]+)$/.exec(path))) {
      needsAccount('a subscription');
      const x = db(acct).subscriptions.get(m[1]);
      if (!x) return notFound('subscription', m[1]);
      if (method === 'GET') return { status: 200, body: x };
      if (method === 'DELETE') { if (x.status === 'canceled') return invalid('This subscription has already been canceled.'); x.status = 'canceled'; x.canceled_at = now(); await deliver('customer.subscription.deleted', x, acct); return { status: 200, body: x }; }
    }
    if ((m = /^\/v1\/invoices\/(in_[A-Za-z0-9]+)$/.exec(path)) && method === 'GET') {
      needsAccount('an invoice');
      const x = db(acct).invoices.get(m[1]);
      if (!x) return notFound('invoice', m[1]);
      return { status: 200, body: query.includes('payments') ? x : withoutPayments(x) };
    }
    if (path === '/v1/refunds' && method === 'POST') { needsAccount('a refund'); return refund(acct, p); }
    if (path === '/v1/webhook_endpoints' && method === 'POST') {
      if (!p.url || !Array.isArray(p.enabled_events) || !p.enabled_events.length) return invalid('url and enabled_events are required.');
      const id = `we_${rid(24)}`;
      const ep = { id, object: 'webhook_endpoint', api_version: p.api_version || null, application: bool(p.connect) ? 'ca_mock' : null, created: now(), description: p.description || null, enabled_events: p.enabled_events, livemode: false, metadata: p.metadata || {}, secret: connectedSecret, status: 'enabled', url: p.url };
      state.endpoints.push(ep);
      return { status: 200, body: { ...ep } };
    }
    if (path === '/v1/webhook_endpoints' && method === 'GET') return { status: 200, body: { object: 'list', data: state.endpoints.map(({ secret: _s, ...ep }) => ep), has_more: false, url: '/v1/webhook_endpoints' } };
    if ((m = /^\/v1\/webhook_endpoints\/(we_[A-Za-z0-9]+)$/.exec(path)) && method === 'DELETE') { const i = state.endpoints.findIndex((x) => x.id === m[1]); if (i < 0) return notFound('webhook_endpoint', m[1]); state.endpoints.splice(i, 1); return { status: 200, body: { id: m[1], object: 'webhook_endpoint', deleted: true } }; }
    return err(404, 'invalid_request_error', `Unrecognized request URL (${method}: ${path}).`);
  }

  const page = (title, inner) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{font:16px system-ui;margin:0;padding:24px;background:#f6f9fc;color:#30313d}main{max-width:420px;margin:auto;background:#fff;border-radius:10px;padding:20px;box-shadow:0 2px 8px #0002}button{font:inherit;background:#635bff;color:#fff;border:0;border-radius:6px;padding:12px;width:100%;margin-top:12px}a{display:block;margin-top:14px;text-align:center}.t{color:#a15c00;font-size:.8em}</style><main><p class="t">Test mode (mock Stripe)</p><h1>${esc(title)}</h1>${inner}</main>`;
  async function hosted(req, res, path, url, body) {
    const send = (html) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); };
    const go = (to) => { res.writeHead(303, { location: to }); res.end(); };
    const acct = url.searchParams.get('a');
    let m;
    if ((m = /^\/hosted\/checkout\/([^/]+)(\/pay)?$/.exec(path))) {
      const s = acct && db(acct).sessions.get(m[1]);
      if (!s) { res.writeHead(404); return res.end('No such session'); }
      const price = db(acct).prices.get(s.line_price);
      if (req.method === 'GET' && !m[2]) return send(page('Pay with Stripe', `<p id="what">${(s.lines || [{ price: s.line_price, quantity: 1 }]).map((l) => { const pr = db(acct).prices.get(l.price); return `${l.quantity > 1 ? `${l.quantity} x ` : ''}${esc(db(acct).products.get(pr.product)?.name)}`; }).join('<br>')}</p>${s.shipping_address_collection ? '<p id="ship">Shipping address: collected here, on Stripe\'s page.</p>' : ''}<p id="amount">${(s.amount_total / 100).toFixed(2)} ${esc(price.currency.toUpperCase())}${price.recurring ? ` / ${esc(price.recurring.interval)}` : ''}</p><form method="post" action="/hosted/checkout/${esc(m[1])}/pay?a=${esc(acct)}"><input name="email" value="buyer@example.com" aria-label="Email"><button id="pay" type="submit">Pay</button></form>${s.cancel_url ? `<a id="cancel" href="${esc(s.cancel_url)}">Cancel</a>` : ''}`));
      if (req.method === 'POST' && m[2]) { const f = parseForm(body); await payCheckout(acct, m[1], { email: f.email || 'buyer@example.com' }); return go(s.success_url.replace('{CHECKOUT_SESSION_ID}', m[1])); }
    }
    if ((m = /^\/hosted\/onboard\/([^/]+)(\/finish)?$/.exec(path))) {
      const tok = onboardTokens.get(m[1]);
      if (!tok || tok.used) { res.writeHead(410); return res.end('This link has expired.'); }
      if (req.method === 'GET' && !m[2]) return send(page('Tell Stripe about your business', `<p>Stripe collects this on its own page: nothing here reaches The Office.</p><form method="post" action="/hosted/onboard/${esc(m[1])}/finish"><button id="finish" type="submit">Finish</button></form>`));
      if (req.method === 'POST' && m[2]) { tok.used = true; const a = enable(state.accounts.get(tok.account)); await deliver('account.updated', a, a.id); return go(tok.return_url); }
    }
    if ((m = /^\/hosted\/portal\/([^/]+)(\/cancel)?$/.exec(path))) {
      const ps = acct && db(acct).portalSessions.get(m[1]);
      if (!ps) { res.writeHead(404); return res.end('No such session'); }
      if (req.method === 'GET' && !m[2]) return send(page('Manage your subscription', `<form method="post" action="/hosted/portal/${esc(m[1])}/cancel?a=${esc(acct)}"><button id="cancel-sub" type="submit">Cancel my plan</button></form>${ps.return_url ? `<a id="back" href="${esc(ps.return_url)}">Back</a>` : ''}`));
      if (req.method === 'POST' && m[2]) { for (const sub of db(acct).subscriptions.values()) if (sub.customer === ps.customer && sub.status === 'active') { sub.status = 'canceled'; sub.canceled_at = now(); await deliver('customer.subscription.deleted', sub, acct); } return go(ps.return_url || base); }
    }
    res.writeHead(404); return res.end('Not found');
  }

  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;
    try {
      if (path.startsWith('/hosted/')) return await hosted(req, res, path, url, raw);
      const auth = req.headers.authorization || '';
      const acct = req.headers['stripe-account'] || '';
      const idem = req.headers['idempotency-key'] || '';
      state.requests.push({ method: req.method, path, auth: auth === `Bearer ${apiKey}`, account: acct, idem, version: req.headers['stripe-version'] || '', body: raw, query: url.search });
      const reply = (status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'request-id': `req_${rid(14)}`, 'stripe-version': req.headers['stripe-version'] || version }); res.end(JSON.stringify(body)); };
      if (auth !== `Bearer ${apiKey}`) return reply(401, { error: { type: 'invalid_request_error', message: `Invalid API Key provided: ${auth.slice(7, 15)}********`, code: 'api_key_invalid' } });
      if (state.failNext.length) { const f = state.failNext.shift(); return reply(f.status || 500, { error: { type: 'api_error', message: f.message || 'Mock failure.', code: f.code } }); }
      const p = req.method === 'POST' ? (path.startsWith('/v2/') ? JSON.parse(raw || '{}') : parseForm(raw)) : {};
      if (idem) {
        const prior = state.idem.get(`${acct}:${idem}`);
        if (prior) {
          if (prior.fingerprint !== `${req.method} ${path} ${raw}`) return reply(400, { error: { type: 'idempotency_error', message: 'Keys for idempotent requests can only be used with the same parameters they were first used with.' } });
          return reply(prior.status, prior.body);
        }
      }
      let out;
      try { out = await api(req.method, path, url.search, p, acct); } catch (e) { if (e.res) out = e.res; else throw e; }
      if (idem && out.status < 500) state.idem.set(`${acct}:${idem}`, { fingerprint: `${req.method} ${path} ${raw}`, status: out.status, body: out.body });
      return reply(out.status, out.body);
    } catch (e) {
      if (!res.headersSent) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { type: 'api_error', message: String(e?.message).slice(0, 200) } })); }
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  return {
    base, apiKey, state, secret: connectedSecret,
    close: () => new Promise((r) => { server.close(r); server.closeAllConnections?.(); }),
    /** Webhooks go to the running app's endpoint, signed with the secret, for all connected accounts. */
    connect(url, enabled = ['*']) { state.endpoints.length = 0; state.endpoints.push({ id: `we_${rid(24)}`, object: 'webhook_endpoint', api_version: version, application: 'ca_mock', enabled_events: enabled, livemode: false, secret: connectedSecret, status: 'enabled', url }); },
    setClock(ms) { t0 = ms; },
    finishOnboarding: async (acct) => { const a = enable(state.accounts.get(acct)); await deliver('account.updated', a, acct); return a; },
    setAccount: async (acct, patch) => { const a = state.accounts.get(acct); Object.assign(a, patch); await deliver('account.updated', a, acct); return a; },
    deauthorize: (acct) => deliver('account.application.deauthorized', { id: 'ca_mock', object: 'application', name: 'The Office' }, acct),
    payCheckout, finishAsync, renew, setSubscriptionStatus, dispute,
    refundDirect: (acct, p) => refund(acct, p),
    expireSession: async (acct, id) => { const s = db(acct).sessions.get(id); s.status = 'expired'; await deliver('checkout.session.expired', s, acct); return s; },
    get: (acct, kind, id) => db(acct)[kind].get(id),
    list: (acct, kind) => [...db(acct)[kind].values()],
    deliver,
  };
}
