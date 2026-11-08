// Stripe, the building's way of taking money for its companies, through its REST API and nothing else (docs.stripe.com, as of 2026-11).
// Stripe Connect with accounts set up by controller properties, Stripe's own hosted pages for onboarding, checkout and the customer portal,
// and direct charges made on the boss's own account with the Stripe-Account header. No platform fee and no application fee.
// The key goes in one header to the API and nowhere else: not in a log, not in an error, not in a response.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const STRIPE_API = 'https://api.stripe.com';
// Every call and the Connect webhook endpoint are pinned to this, so the shapes read below are the shapes that arrive.
export const STRIPE_VERSION = '2026-10-28.endive';
export const WEBHOOK_EVENTS = [
  'account.updated', 'account.application.deauthorized',
  'checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired',
  'invoice.paid', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
  'charge.refunded', 'charge.dispute.created', 'charge.dispute.closed',
];
export class PayProviderError extends Error {
  constructor(message, { status = 0, code = '', retryable = false } = {}) { super(message); this.status = status; this.code = code; this.retryable = retryable; }
}

/** 'live' or 'test' from a secret or restricted key's own prefix, or '' for anything that isn't one. */
export const keyMode = (key) => (/^(sk|rk)_live_[A-Za-z0-9_]+$/.test(key || '') ? 'live' : /^(sk|rk)_test_[A-Za-z0-9_]+$/.test(key || '') ? 'test' : '');
const HIDE = /\b((?:sk|rk|pk)_(?:live|test)_|whsec_)[A-Za-z0-9_]+/g;
/** Anything that may have seen a key or signing secret, on its way to a log. */
export const hideKeys = (s) => String(s ?? '').replace(HIDE, '$1[redacted]').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 300);

/** Stripe's scheme: HMAC-SHA256 of "t.body" keyed with the signing secret as it stands, hex, in a `v1=` part of the header next to `t=`. Other schemes are ignored. */
export function verifyStripeSignature({ secret, header, body, now = Date.now(), toleranceSec = 300 }) {
  if (!secret || !header) return { ok: false, reason: 'missing_signature' };
  let t = ''; const signatures = [];
  for (const part of String(header).split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (k === 't') t = v; else if (k === 'v1') signatures.push(v);
  }
  if (!/^\d{1,12}$/.test(t) || !signatures.length) return { ok: false, reason: 'bad_header' };
  const expected = createHmac('sha256', secret).update(`${t}.`).update(body).digest();
  let good = false;
  for (const s of signatures) { const got = Buffer.from(s, 'hex'); if (got.length === expected.length && timingSafeEqual(got, expected)) good = true; }
  if (!good) return { ok: false, reason: 'bad_signature' };
  // Checked after the signature, so a stale timestamp on a forged body says nothing useful. Stripe signs each retry afresh, so a late one is never a real delivery.
  if (Math.abs(now / 1000 - Number(t)) > toleranceSec) return { ok: false, reason: 'stale' };
  return { ok: true, timestamp: Number(t) };
}
export function signStripe({ secret, timestamp, body }) {
  return `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

/** form-encodes a[b][0]=c, the shape Stripe's API takes. Null and undefined leave a field out. */
export function formEncode(obj) {
  const out = [];
  const walk = (k, v) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) v.forEach((x, i) => walk(`${k}[${i}]`, x));
    else if (typeof v === 'object') for (const [a, b] of Object.entries(v)) walk(`${k}[${a}]`, b);
    else out.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  };
  for (const [k, v] of Object.entries(obj || {})) walk(k, v);
  return out.join('&');
}

/** A client for one key. `account` names the connected account a call acts on: the Stripe-Account header makes it that account's object. */
export function createStripe({ apiKey, base = STRIPE_API, fetchImpl = fetch, timeoutMs = 20000, retries = 1, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  if (!keyMode(apiKey)) throw new PayProviderError('That is not a Stripe secret key.', { code: 'bad_key' });
  const root = String(base).replace(/\/+$/, '');
  async function call(method, path, { params, query, account, idem, jsonBody = false } = {}) {
    const url = `${root}${path}${query ? `?${formEncode(query)}` : ''}`;
    const headers = { authorization: `Bearer ${apiKey}`, 'stripe-version': STRIPE_VERSION };
    if (account) headers['stripe-account'] = account;
    if (idem) headers['idempotency-key'] = idem;
    let body;
    if (method !== 'GET' && method !== 'DELETE') {
      if (jsonBody) { headers['content-type'] = 'application/json'; body = JSON.stringify(params); } else { headers['content-type'] = 'application/x-www-form-urlencoded'; body = formEncode(params); }
    }
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt) await sleep(200 * attempt);
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        const r = await fetchImpl(url, { method, headers, body, signal: ctl.signal, redirect: 'error' });
        const text = await r.text();
        let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
        if (r.ok && json) return json;
        const e = json?.error || {};
        const retryable = r.status === 429 || r.status >= 500;
        lastError = new PayProviderError(`Stripe ${method} ${path} said ${r.status}: ${hideKeys(e.code || e.type || '')} ${hideKeys(e.message || '')}`.trim(), { status: r.status, code: String(e.code || e.type || ''), retryable });
        if (!retryable) throw lastError;
      } catch (e) {
        if (e instanceof PayProviderError && !e.retryable) throw e;
        lastError = e instanceof PayProviderError ? e : new PayProviderError(`Could not reach Stripe: ${hideKeys(e?.message)}`, { retryable: true });
      } finally { clearTimeout(timer); }
      // Only something the same request can't do twice gets a second try: a read, or a write Stripe will recognise by its idempotency key.
      if (method !== 'GET' && !idem) break;
    }
    throw lastError;
  }
  const on = (account, idem) => ({ account, idem });
  return {
    call,
    // Stripe refuses POST /v1/accounts on new platforms, so an account is made through Accounts v2. The acct_ id it returns works with every v1 route below.
    createAccount: (params, idem) => call('POST', '/v2/core/accounts', { params, idem, jsonBody: true }),
    getAccount: (id) => call('GET', `/v1/accounts/${encodeURIComponent(id)}`),
    createAccountLink: (params) => call('POST', '/v1/account_links', { params }),
    createProduct: (account, params, idem) => call('POST', '/v1/products', { params, ...on(account, idem) }),
    updateProduct: (account, id, params) => call('POST', `/v1/products/${encodeURIComponent(id)}`, { params, account }),
    createPrice: (account, params, idem) => call('POST', '/v1/prices', { params, ...on(account, idem) }),
    updatePrice: (account, id, params) => call('POST', `/v1/prices/${encodeURIComponent(id)}`, { params, account }),
    createCheckoutSession: (account, params, idem) => call('POST', '/v1/checkout/sessions', { params, ...on(account, idem) }),
    getCheckoutSession: (account, id) => call('GET', `/v1/checkout/sessions/${encodeURIComponent(id)}`, { account }),
    createPortalConfiguration: (account, params, idem) => call('POST', '/v1/billing_portal/configurations', { params, ...on(account, idem) }),
    createPortalSession: (account, params) => call('POST', '/v1/billing_portal/sessions', { params, account }),
    getSubscription: (account, id) => call('GET', `/v1/subscriptions/${encodeURIComponent(id)}`, { account }),
    cancelSubscription: (account, id, idem) => call('DELETE', `/v1/subscriptions/${encodeURIComponent(id)}`, { account, idem }),
    getInvoice: (account, id) => call('GET', `/v1/invoices/${encodeURIComponent(id)}`, { account, query: { expand: ['payments'] } }),
    createRefund: (account, params, idem) => call('POST', '/v1/refunds', { params, ...on(account, idem) }),
    createWebhookEndpoint: (params, idem) => call('POST', '/v1/webhook_endpoints', { params, idem }),
    listWebhookEndpoints: () => call('GET', '/v1/webhook_endpoints', { query: { limit: 100 } }),
    deleteWebhookEndpoint: (id) => call('DELETE', `/v1/webhook_endpoints/${encodeURIComponent(id)}`),
  };
}
