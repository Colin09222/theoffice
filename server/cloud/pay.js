// Checkout in the apps the teams make: real payments through Stripe Connect, with the money going straight to each company's boss. See docs/PAYMENTS.md.
// Each boss connects their own Stripe account through Stripe's hosted onboarding and is the seller of record; the platform takes no cut.
// Stripe-hosted Checkout only, so a card number never touches this building. The team proposes products and prices; only the boss's tap makes one real,
// and only the boss's tap refunds. Nothing here gives a bot a way to charge, change a price or send money back.
import { randomBytes, createHash } from 'node:crypto';
import { get, all, run, tx } from '../db.js';
import { CloudError, COLL } from './store.js';
import { createStripe, keyMode, verifyStripeSignature, hideKeys, PayProviderError } from './pay-provider.js';
import { payReady } from './pay-config.js';
import { slugPattern } from '../workspace.js';

const PRODUCT_KEY = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const NOT_READY = { ok: false, ready: false, code: 'not_ready', message: 'Payments are being set up. Check back soon.' };
const notOpen = (message) => ({ ok: false, ready: false, code: 'not_ready', message });
// Stripe's own floor for card payments in most currencies, and a ceiling so a slip can't put a five-figure price one tap from live.
const MIN_CENTS = 50, MAX_CENTS = 1000000;
const OPEN_PROPOSALS = 20, OPEN_ORDER_MS = 30 * 60000, CONFIRM_EVERY_MS = 2000, RAW_MAX = 1024 * 1024, EVENT_DAYS = 35;
const INTERVAL = { one_off: '', monthly: 'month', yearly: 'year' };
// Per docs.stripe.com/billing/subscriptions/webhooks: past_due keeps access while Stripe retries the card, and canceled or unpaid ends it.
const ACCESS = new Set(['active', 'trialing', 'past_due']);
const REVOKED = new Set(['refunded', 'disputed']);
const newToken = (prefix, n = 16) => `${prefix}_${randomBytes(n).toString('base64url')}`;
const idOf = (v) => (v && typeof v === 'object' ? v.id : v) || '';
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').trim().slice(0, max);
const MISSING = [
  [/^external_account/, 'A bank account for your payouts'], [/^tos_acceptance/, 'Accepting Stripe\'s terms'], [/^business_profile\.url/, 'Your website'],
  [/^business_profile\./, 'What your business does'], [/^business_type/, 'Your business type'], [/^(individual|representative|owners?|directors?|executives?|person)/, 'Your ID details'],
  [/^company/, 'Your company details'], [/^settings\.(payments|card_payments)/, 'Your statement name'],
];
const friendlyMissing = (fields) => [...new Set((fields || []).map((f) => MISSING.find(([re]) => re.test(f))?.[1] || 'A few more details on Stripe'))];

export const payMode = (db) => get(db, "SELECT v FROM pay_settings WHERE k='mode'")?.v || '';

/** The one check for "has this person paid for this": any server code in the building can call it. Project-scoped, by construction, with the test/live split. */
export function payHas(db, floorId, project, ownerKey, productKey) {
  const m = payMode(db);
  if (!m || !ownerKey) return false;
  const live = m === 'live' ? 1 : 0;
  if (get(db, "SELECT 1 x FROM pay_orders WHERE floor_id=? AND project=? AND livemode=? AND owner=? AND product_key=? AND status='active' LIMIT 1", floorId, project, live, ownerKey, productKey)) return true;
  // A basket holds several things under one order: its lines count as well.
  return all(db, "SELECT items FROM pay_orders WHERE floor_id=? AND project=? AND livemode=? AND owner=? AND status='active' AND items!='' ORDER BY id DESC LIMIT 200", floorId, project, live, ownerKey)
    .some((o) => itemsOf(o).some((i) => i.key === productKey));
}
const itemsOf = (order) => { try { const v = JSON.parse(order.items || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
/** The short code a buyer and the boss both see for one order. From the order's own random token, so it says nothing about how many there have been. */
export const orderNumber = (token) => createHash('sha256').update(String(token)).digest('hex').slice(0, 8).toUpperCase().replace(/^(.{4})/, '$1-');
const CART_LINES = 20, CART_QTY = 20;
const SHIP_COUNTRIES = /^[A-Z]{2}$/;

/** Money summary for a floor's own dashboard. Shown only to that floor's boss, never to a visitor, the feed, the tower or the ticker. */
export function salesSummary(db, floorId, { days = 30, now = Date.now() } = {}) {
  const m = payMode(db);
  if (!m) return { currency: 'usd', grossCents: 0, refundsCents: 0, orders: 0, activeSubs: 0, byDay: [] };
  const live = m === 'live' ? 1 : 0;
  const n = Math.max(1, Math.min(366, Math.floor(Number(days) || 30)));
  const since = new Date(now - (n - 1) * 86400000).toISOString().slice(0, 10);
  const currency = get(db, 'SELECT currency, COUNT(*) n FROM pay_sales WHERE floor_id=? AND livemode=? AND day>=? GROUP BY currency ORDER BY n DESC LIMIT 1', floorId, live, since)?.currency
    || get(db, 'SELECT currency FROM pay_accounts WHERE floor_id=? AND livemode=?', floorId, live)?.currency || 'usd';
  const sum = get(db, 'SELECT COALESCE(SUM(amount_cents),0) gross, COALESCE(SUM(refunded_cents),0) refunds, COUNT(*) orders FROM pay_sales WHERE floor_id=? AND livemode=? AND currency=? AND day>=?', floorId, live, currency, since);
  const byDay = all(db, 'SELECT day, SUM(amount_cents) grossCents, COUNT(*) orders FROM pay_sales WHERE floor_id=? AND livemode=? AND currency=? AND day>=? GROUP BY day ORDER BY day', floorId, live, currency, since).map((r) => ({ day: r.day, grossCents: r.grossCents, orders: r.orders }));
  const activeSubs = get(db, "SELECT COUNT(*) n FROM pay_orders WHERE floor_id=? AND livemode=? AND kind='subscription' AND status='active'", floorId, live).n;
  return { currency, grossCents: sum.gross, refundsCents: sum.refunds, orders: sum.orders, activeSubs, byDay };
}

export function payStatusRow(db, floor) {
  const a = get(db, 'SELECT * FROM pay_accounts WHERE floor_id=? ORDER BY livemode DESC, updated_at DESC LIMIT 1', floor.id);
  return a;
}

export function installPay(ext) {
  const { db, cfg, engine, log, now, hooks, GET, POST, json, requireOwner, HttpError } = ext;
  const key = cfg.stripeSecretKey || '';
  const mode = keyMode(key);
  const ready = payReady(cfg);
  const LIVE = mode === 'live' ? 1 : 0;
  // The mode, for code that has only the database (salesSummary, the admin script). Test and live rows are kept apart everywhere by livemode.
  run(db, "INSERT INTO pay_settings (k,v) VALUES ('mode',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", ready ? mode : '');
  if (key && !mode) log('warn', 'pay_bad_key', { why: 'STRIPE_SECRET_KEY does not look like a Stripe secret key, so payments stay off' });
  if (key && mode && !cfg.stripeWebhookSecret) log('warn', 'pay_no_webhook_secret', { why: 'STRIPE_WEBHOOK_SECRET is missing, so payments stay off' });
  const stripe = ready ? createStripe({ apiKey: key, base: cfg.stripeApiBase, fetchImpl: ext.payFetch || fetch, sleep: ext.paySleep }) : null;

  const lapse = (order, status) => run(db, 'UPDATE pay_orders SET status=?, ended_at=COALESCE(ended_at,?), updated_at=? WHERE id=?', status, now(), now(), order.id);
  const accountRow = (floorId) => get(db, 'SELECT * FROM pay_accounts WHERE floor_id=? AND livemode=?', floorId, LIVE);
  const accountByStripe = (account) => get(db, 'SELECT * FROM pay_accounts WHERE account=? AND livemode=?', account, LIVE);
  const orderByToken = (token) => (token ? get(db, 'SELECT * FROM pay_orders WHERE token=?', token) : null);
  const liveProducts = (F, p) => all(db, "SELECT * FROM pay_products WHERE floor_id=? AND project=? AND livemode=? AND status='live' ORDER BY id", F, p, LIVE);
  const productView = (r) => ({ key: r.key, name: r.name, description: r.description, amountCents: r.amount_cents, currency: r.currency, interval: r.interval || null, ships: !!r.ships });

  // ---- the boss's Stripe account ----
  const applyAccount = (account, a) => {
    const due = [...new Set([...(a.requirements?.currently_due || []), ...(a.requirements?.past_due || [])])];
    run(db, 'UPDATE pay_accounts SET charges_enabled=?, payouts_enabled=?, details_submitted=?, missing=?, disabled_reason=?, currency=?, country=?, updated_at=? WHERE account=? AND livemode=?',
      a.charges_enabled ? 1 : 0, a.payouts_enabled ? 1 : 0, a.details_submitted ? 1 : 0, JSON.stringify(due.slice(0, 40)), clean(a.requirements?.disabled_reason, 80), clean(a.default_currency, 8), clean(a.country, 8), now(), account, LIVE);
  };
  function accountView(a) {
    if (!a || a.disconnected_at) return { state: 'none', summary: 'Not connected yet.', missing: [] };
    const missing = friendlyMissing(JSON.parse(a.missing || '[]'));
    const view = { connected: true, chargesEnabled: !!a.charges_enabled, payoutsEnabled: !!a.payouts_enabled, detailsSubmitted: !!a.details_submitted, currency: a.currency || 'usd', country: a.country, missing };
    if (a.charges_enabled && !missing.length) return { ...view, state: 'ready', summary: 'Connected. You can take payments.' };
    if (a.charges_enabled) return { ...view, state: 'action', summary: 'Connected. Stripe needs a little more soon so it doesn\'t have to pause your payouts.' };
    if (a.details_submitted) return { ...view, state: 'review', summary: missing.length ? 'Stripe needs a little more before you can take payments.' : 'Stripe is checking your details. This usually takes a few minutes.' };
    return { ...view, state: 'incomplete', summary: 'Almost there: finish the Stripe form.' };
  }
  async function connect(f, req) {
    if (!ready) throw new HttpError(503, 'not_ready', 'Payments are being set up.');
    let a = accountRow(f.id), generation = '';
    // Once a boss has cut the link from their side, that account can't be used again: a fresh one, and the old record goes.
    if (a?.disabled_reason === 'deauthorized') { generation = `-after-${a.account}`; run(db, 'DELETE FROM pay_accounts WHERE floor_id=? AND livemode=?', f.id, LIVE); a = null; }
    if (!a) {
      // Accounts v2, the only way Stripe still makes a new account on this platform. The boss still has their own full Stripe account and Stripe still collects fees and losses from them.
      // v2 wants the country before the merchant part can be added, and the boss can't change it on Stripe's form, so it comes from STRIPE_ACCOUNT_COUNTRY (docs/PAYMENTS.md).
      const params = {
        display_name: clean(f.name, 80) || undefined, dashboard: 'full', identity: { country: cfg.stripeCountry },
        configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
        defaults: { responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' } },
        metadata: { office_floor: String(f.id) },
      };
      const created = await stripe.createAccount(params, `office-account-${f.id}-${mode}${generation}`);
      run(db, 'INSERT OR IGNORE INTO pay_accounts (floor_id,livemode,account,created_at,updated_at) VALUES (?,?,?,?,?)', f.id, LIVE, created.id, now(), now());
      // Everything else here reads v1 accounts; a failure now is picked up by the panel's next refresh.
      try { applyAccount(created.id, await stripe.getAccount(created.id)); } catch (e) { log('warn', 'pay_status_refresh', { err: hideKeys(e?.message) }); }
      a = accountRow(f.id);
    } else if (a.disconnected_at) { run(db, 'UPDATE pay_accounts SET disconnected_at=NULL, updated_at=? WHERE floor_id=? AND livemode=?', now(), f.id, LIVE); }
    const back = `${cfg.publicOrigin || `${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`}/theoffice/floor/${f.slug}`;
    const link = await stripe.createAccountLink({ account: a.account, refresh_url: `${back}?pay=refresh`, return_url: `${back}?pay=return`, type: 'account_onboarding' });
    return { url: link.url };
  }

  // ---- what visitors of a published app can see and do ----
  const hasAccess = (F, p, who, product) => !!who?.key && payHas(db, F, p, who.key, product);
  const confirmed = new Map();
  /** A buyer coming back from Checkout can beat the webhook. Ask Stripe about their open order directly, so the feature unlocks the moment they land. */
  async function confirmOpen(F, p, who, productKey) {
    return confirmOrder(get(db, "SELECT * FROM pay_orders WHERE floor_id=? AND project=? AND livemode=? AND owner=? AND product_key=? AND status='open' AND session_id!='' AND created_at>=? ORDER BY id DESC LIMIT 1", F, p, LIVE, who.key, productKey, now() - OPEN_ORDER_MS));
  }
  async function confirmOrder(order) {
    if (!order || !ready || order.status !== 'open' || !order.session_id) return;
    const last = confirmed.get(order.id) || 0;
    if (now() - last < CONFIRM_EVERY_MS) return;
    confirmed.set(order.id, now());
    if (confirmed.size > 5000) for (const k of [...confirmed.keys()].slice(0, 1000)) confirmed.delete(k);
    try {
      const s = await stripe.getCheckoutSession(order.account, order.session_id);
      const sub = s.subscription ? await stripe.getSubscription(order.account, idOf(s.subscription)) : null;
      tx(db, () => applySession(order.account, s, sub));
      tellPaid();
    } catch (e) { log('warn', 'pay_confirm_failed', { err: hideKeys(e?.message) }); }
  }
  const safePath = (raw) => {
    const s = String(raw ?? '/').split('#')[0];
    return s.length <= 512 && /^\/(?!\/)[^\\\r\n]*$/.test(s) ? s : '/';
  };
  const urlWith = (origin, path, flag, token) => `${origin}${path}${path.includes('?') ? '&' : '?'}office_pay=${flag}${token ? `&office_order=${token}` : ''}`;

  /** What is being bought: one product (the older call), or a basket of several with how many of each. */
  function linesOf(F, p, body) {
    if (body.items === undefined || body.items === null) {
      const productKey = String(body.product ?? '');
      if (!PRODUCT_KEY.test(productKey)) throw new CloudError(400, 'bad_product', 'That is not a product.');
      return { basket: false, lines: [{ key: productKey, quantity: 1 }] };
    }
    if (!Array.isArray(body.items) || !body.items.length || body.items.length > CART_LINES) throw new CloudError(400, 'bad_items', `A basket holds 1 to ${CART_LINES} different things.`);
    const seen = new Map();
    for (const it of body.items) {
      const key = String(it?.product ?? it?.key ?? '');
      const quantity = it?.quantity === undefined ? 1 : Number(it.quantity);
      if (!PRODUCT_KEY.test(key)) throw new CloudError(400, 'bad_product', 'That is not a product.');
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > CART_QTY) throw new CloudError(400, 'bad_quantity', `How many is a whole number from 1 to ${CART_QTY}.`);
      seen.set(key, Math.min(CART_QTY, (seen.get(key) || 0) + quantity));
    }
    return { basket: true, lines: [...seen].map(([key, quantity]) => ({ key, quantity })) };
  }
  async function checkout({ F, p, who, origin, body }) {
    if (!ready) return NOT_READY;
    const { basket, lines } = linesOf(F, p, body);
    const account = accountRow(F);
    if (!account || account.disconnected_at || !account.charges_enabled) return notOpen('This site isn\'t ready to take payments yet.');
    const prods = [];
    for (const l of lines) {
      const prod = get(db, "SELECT * FROM pay_products WHERE floor_id=? AND project=? AND livemode=? AND key=? AND status='live'", F, p, LIVE, l.key);
      if (!prod) return { ok: false, ready: true, code: 'no_product', product: l.key, message: basket ? 'Something in your basket isn\'t on sale right now.' : 'That isn\'t on sale right now.' };
      prods.push(prod);
    }
    const first = prods[0], productKey = first.key;
    // An account is what lets a purchase follow someone to another device, so anything that unlocks or renews needs one, and so does the single-product call apps use for an upgrade. A shop's basket, or something that is posted, doesn't.
    const needsAccount = prods.some((x) => x.interval || x.gates !== '[]') || (!basket && !first.ships);
    if (basket && needsAccount && prods.length > 1) throw new CloudError(400, 'bad_items', 'A subscription or an unlock is bought on its own, not in a basket.');
    if (needsAccount && who?.kind !== 'user') throw new CloudError(401, 'signed_out', 'Log in first, so your purchase stays with your account.');
    if (!who?.key) throw new CloudError(401, 'signed_out', 'Log in first, so your purchase stays with your account.');
    // Something you can only hold once is never sold to the same person twice. Things that are posted, and baskets, can be bought again.
    const once = !basket && !first.ships;
    if (once && hasAccess(F, p, who, productKey)) return { ok: false, ready: true, code: 'already_owned', message: 'You already have this.' };
    if (once) {
      const open = get(db, "SELECT * FROM pay_orders WHERE floor_id=? AND project=? AND livemode=? AND owner=? AND product_key=? AND items='' AND status='open' AND session_url!='' AND created_at>=? ORDER BY id DESC LIMIT 1", F, p, LIVE, who.key, productKey, now() - OPEN_ORDER_MS);
      if (open) return { ok: true, ready: true, url: open.session_url };
    }
    const token = newToken('ord');
    const path = safePath(body.returnPath);
    const meta = { office_order: token, office_floor: String(F), office_project: p, office_product: productKey };
    const email = who.user?.email || undefined;
    const ships = prods.some((x) => x.ships);
    const country = String(account.country || cfg.stripeCountry || 'us').toUpperCase();
    const amount = prods.reduce((n, x, i) => n + x.amount_cents * lines[i].quantity, 0);
    const items = basket || ships ? prods.map((x, i) => ({ key: x.key, name: x.name, quantity: lines[i].quantity, amountCents: x.amount_cents })) : null;
    const params = {
      mode: first.interval ? 'subscription' : 'payment', line_items: prods.map((x, i) => ({ price: x.stripe_price, quantity: lines[i].quantity })), client_reference_id: token, metadata: meta,
      success_url: urlWith(origin, path, 'success', token), cancel_url: urlWith(origin, path, 'cancelled'), customer_email: email,
      // Stripe's own page asks where to send it; the address never passes through the site.
      ...(ships && SHIP_COUNTRIES.test(country) ? { shipping_address_collection: { allowed_countries: [country] } } : {}),
      // Direct charges: the charge is the boss's, on their account, and no application fee is set anywhere. Stripe emails the receipt.
      ...(first.interval ? { subscription_data: { metadata: meta } } : { customer_creation: 'always', payment_intent_data: { metadata: meta, receipt_email: email } }),
    };
    run(db, 'INSERT INTO pay_orders (token,floor_id,project,livemode,account,product_id,product_key,owner,owner_name,kind,status,amount_cents,currency,items,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      token, F, p, LIVE, account.account, first.id, productKey, who.key, who.name || '', first.interval ? 'subscription' : 'one_off', 'open', amount, first.currency, items ? JSON.stringify(items) : '', now(), now());
    let s;
    try { s = await stripe.createCheckoutSession(account.account, params, `office-checkout-${token}`); } catch (e) {
      run(db, "UPDATE pay_orders SET status='failed', updated_at=? WHERE token=?", now(), token);
      log('error', 'pay_checkout_failed', { err: hideKeys(e?.message) });
      return { ok: false, ready: true, code: 'unavailable', message: 'Checkout isn\'t available right now. Try again in a moment.' };
    }
    run(db, 'UPDATE pay_orders SET session_id=?, session_url=?, updated_at=? WHERE token=?', s.id, s.url, now(), token);
    return { ok: true, ready: true, url: s.url, order: token };
  }

  /** What a buyer sees of their own order when they land back on the site. The token in their return address is what lets them read it; it carries no address and no card. */
  function orderView(o) {
    const lines = itemsOf(o);
    const items = lines.length ? lines.map((i) => ({ key: i.key, name: i.name, quantity: i.quantity, amountCents: i.amountCents })) : [{ key: o.product_key, name: get(db, 'SELECT name FROM pay_products WHERE id=?', o.product_id)?.name || o.product_key, quantity: 1, amountCents: o.amount_cents }];
    const paid = o.status === 'active' || (!!o.paid_at && o.status !== 'open');
    return { ok: true, number: orderNumber(o.token), status: o.status === 'active' ? 'paid' : o.status === 'open' ? 'pending' : o.status, paid, items, totalCents: o.amount_cents, currency: o.currency, emailed: !!o.told_buyer, posted: !!o.ship_to, sentAt: o.fulfilled_at || null, testMode: mode === 'test', createdAt: o.created_at };
  }
  async function orderRoute(F, p, who, q) {
    const token = String(q.get('token') ?? '');
    let o = null;
    if (token) { if (/^ord_[A-Za-z0-9_-]{10,40}$/.test(token)) o = get(db, 'SELECT * FROM pay_orders WHERE token=? AND floor_id=? AND project=? AND livemode=?', token, F, p, LIVE); } else if (who?.key) o = get(db, "SELECT * FROM pay_orders WHERE floor_id=? AND project=? AND livemode=? AND owner=? AND status NOT IN ('failed','expired') AND created_at>=? ORDER BY id DESC LIMIT 1", F, p, LIVE, who.key, now() - 86400000);
    if (!o) return { ok: false, code: 'no_order', message: 'There is no order to show.' };
    if (o.status === 'open') { await confirmOrder(o); o = get(db, 'SELECT * FROM pay_orders WHERE id=?', o.id); }
    return orderView(o);
  }

  async function manage({ F, p, who, origin, body }) {
    if (!ready) return NOT_READY;
    if (who?.kind !== 'user') throw new CloudError(401, 'signed_out', 'Log in first.');
    const order = get(db, "SELECT * FROM pay_orders WHERE floor_id=? AND project=? AND livemode=? AND owner=? AND customer!='' ORDER BY (status='active') DESC, id DESC LIMIT 1", F, p, LIVE, who.key);
    if (!order) return { ok: false, ready: true, code: 'nothing_to_manage', message: 'There is nothing to manage yet.' };
    const account = accountByStripe(order.account);
    try {
      let config = account?.portal_config;
      if (!config) {
        const c = await stripe.createPortalConfiguration(order.account, { features: { customer_update: { enabled: true, allowed_updates: ['email', 'name', 'address'] }, invoice_history: { enabled: true }, payment_method_update: { enabled: true }, subscription_cancel: { enabled: true, mode: 'at_period_end' } } }, `office-portal-${order.account}`);
        config = c.id;
        run(db, 'UPDATE pay_accounts SET portal_config=?, updated_at=? WHERE account=?', config, now(), order.account);
      }
      const s = await stripe.createPortalSession(order.account, { customer: order.customer, configuration: config, return_url: `${origin}${safePath(body.returnPath)}` });
      return { ok: true, ready: true, url: s.url };
    } catch (e) {
      log('error', 'pay_portal_failed', { err: hideKeys(e?.message) });
      return { ok: false, ready: true, code: 'unavailable', message: 'That isn\'t available right now. Try again in a moment.' };
    }
  }

  /** The routes under /_office/cloud/pay/ on a project's own origin. */
  async function cloudRoute({ F, p, pk, ip, m, b, q, origin, who, limit, readBody }) {
    if (b === 'status' && m === 'GET') {
      if (!ready) return { ready: false, testMode: false, message: NOT_READY.message, products: [] };
      const account = accountRow(F);
      const on = !!account && !account.disconnected_at && !!account.charges_enabled;
      return { ready: on, testMode: mode === 'test', message: on ? '' : 'This site isn\'t ready to take payments yet.', products: on ? liveProducts(F, p).map(productView) : [] };
    }
    if (b === 'has' && m === 'GET') {
      limit('payHas', `${pk}:${ip}`);
      const productKey = String(q.get('product') ?? '');
      if (!PRODUCT_KEY.test(productKey)) throw new CloudError(400, 'bad_product', 'That is not a product.');
      const w = who();
      if (w?.key && !hasAccess(F, p, w, productKey)) await confirmOpen(F, p, w, productKey);
      return { product: productKey, has: !!hasAccess(F, p, w, productKey) };
    }
    if (b === 'order' && m === 'GET') {
      limit('payHas', `${pk}:${ip}`);
      return orderRoute(F, p, who(), q);
    }
    if (b === 'checkout' && m === 'POST') {
      limit('payCheckoutIp', `${pk}:${ip}`); limit('payCheckoutProject', pk);
      const w = who();
      if (w) limit('payCheckoutAccount', `${pk}:${w.key}`);
      return checkout({ F, p, who: w, origin, body: await readBody() });
    }
    if (b === 'manage' && m === 'POST') {
      limit('payCheckoutIp', `${pk}:${ip}`);
      return manage({ F, p, who: who(), origin, body: await readBody() });
    }
    return null;
  }

  /** Server-side enforcement: a gated collection stays shut, whatever the page claims, unless this person holds a product that opens it. */
  function guard(F, p, coll, who) {
    const gates = all(db, "SELECT key, gates FROM pay_products WHERE floor_id=? AND project=? AND status IN ('live','archived') AND gates!='[]'", F, p).filter((r) => JSON.parse(r.gates).includes(coll));
    if (!gates.length) return;
    if (who?.kind === 'user' && gates.some((r) => hasAccess(F, p, who, r.key))) return;
    throw new CloudError(402, 'payment_required', 'This part is for paying customers.');
  }
  const assertCanDelete = (F, p, who) => {
    if (who?.kind === 'user' && get(db, "SELECT 1 x FROM pay_orders WHERE floor_id=? AND project=? AND owner=? AND kind='subscription' AND status='active' LIMIT 1", F, p, who.key)) throw new CloudError(409, 'active_subscription', 'Cancel your subscription first, so you aren\'t charged for an account that\'s gone.');
  };

  // ---- applying what Stripe says happened: from a webhook, or from asking directly. Called inside a transaction. ----
  function applySession(account, s, sub) {
    const order = orderByToken(s.metadata?.office_order || s.client_reference_id);
    if (!order || order.account !== account) return;
    if (s.status !== 'complete' || !['paid', 'no_payment_required'].includes(s.payment_status)) return;
    if (order.kind === 'one_off') {
      if (order.status !== 'open') return;
      // Who bought it and where it goes, as Stripe's page collected them: for the boss alone, so they can send it.
      const d = s.customer_details || {};
      const ship = s.collected_information?.shipping_details || s.shipping_details || null;
      const shipTo = ship?.address ? JSON.stringify({ name: clean(ship.name, 120), ...Object.fromEntries(['line1', 'line2', 'city', 'state', 'postal_code', 'country'].map((k) => [k, clean(ship.address[k], 120)])) }) : '';
      run(db, "UPDATE pay_orders SET status='active', customer=?, payment_intent=?, amount_cents=?, currency=?, email=?, buyer_name=?, ship_to=?, paid_at=?, updated_at=? WHERE id=?", idOf(s.customer), idOf(s.payment_intent), s.amount_total ?? order.amount_cents, s.currency || order.currency, clean(d.email || s.customer_email, 254), clean(d.name, 120), shipTo, now(), now(), order.id);
      sale(order, s.id, idOf(s.payment_intent), s.amount_total ?? order.amount_cents, s.currency || order.currency);
      justPaid.push(order.id);
    } else {
      run(db, "UPDATE pay_orders SET customer=?, subscription=?, email=?, buyer_name=?, paid_at=COALESCE(paid_at,?), updated_at=? WHERE id=?", idOf(s.customer), idOf(s.subscription), clean(s.customer_details?.email || s.customer_email, 254), clean(s.customer_details?.name, 120), now(), now(), order.id);
      if (sub) applySubscription(account, sub, order.token);
      justPaid.push(order.id);
    }
  }
  function sale(order, ref, paymentIntent, amount, currency) {
    if (amount <= 0) return;
    run(db, 'INSERT OR IGNORE INTO pay_sales (order_id,floor_id,livemode,ref,payment_intent,amount_cents,currency,day,created_at) VALUES (?,?,?,?,?,?,?,?,?)', order.id, order.floor_id, order.livemode, ref, paymentIntent || '', amount, currency || order.currency, new Date(now()).toISOString().slice(0, 10), now());
  }
  function orderForSub(account, sub, token) {
    return orderByToken(token || sub.metadata?.office_order) || get(db, 'SELECT * FROM pay_orders WHERE account=? AND subscription=?', account, sub.id);
  }
  function applySubscription(account, sub, token) {
    const order = orderForSub(account, sub, token);
    if (!order || order.account !== account || order.kind !== 'subscription') return;
    const status = String(sub.status || '');
    const patch = { sub: status, customer: idOf(sub.customer) || order.customer };
    run(db, 'UPDATE pay_orders SET sub_status=?, subscription=?, customer=?, updated_at=? WHERE id=?', patch.sub, sub.id, patch.customer, now(), order.id);
    if (REVOKED.has(order.status)) return;
    if (ACCESS.has(status)) { if (order.status !== 'active') run(db, "UPDATE pay_orders SET status='active', paid_at=COALESCE(paid_at,?), ended_at=NULL, updated_at=? WHERE id=?", now(), now(), order.id); } else if (status && status !== 'incomplete') lapse(order, 'lapsed');
  }
  function applyInvoice(account, inv, paymentIntent, sub) {
    const d = inv.parent?.subscription_details;
    if (!d?.subscription) return;
    const order = orderByToken(d.metadata?.office_order) || get(db, 'SELECT * FROM pay_orders WHERE account=? AND subscription=?', account, idOf(d.subscription));
    if (!order || order.account !== account) return;
    run(db, 'UPDATE pay_orders SET subscription=?, customer=?, amount_cents=?, currency=?, updated_at=? WHERE id=?', idOf(d.subscription), idOf(inv.customer) || order.customer, inv.amount_paid ?? order.amount_cents, inv.currency || order.currency, now(), order.id);
    const fresh = !get(db, 'SELECT 1 x FROM pay_sales WHERE ref=?', inv.id);
    sale(order, inv.id, paymentIntent, inv.amount_paid ?? 0, inv.currency);
    // A refunded or disputed order comes back only on a later period's real payment, and only if the subscription is still alive.
    if (fresh && (inv.amount_paid ?? 0) > 0 && REVOKED.has(order.status) && ACCESS.has(String(sub?.status))) run(db, "UPDATE pay_orders SET status='active', ended_at=NULL, updated_at=? WHERE id=?", now(), order.id);
    if (sub) applySubscription(account, sub, order.token);
  }
  const saleByPi = (pi) => (pi ? get(db, 'SELECT * FROM pay_sales WHERE payment_intent=? ORDER BY id DESC LIMIT 1', pi) : null);
  function applyRefund(account, c) {
    const s = saleByPi(idOf(c.payment_intent));
    if (!s) {
      // Stripe doesn't promise order: if the refund beats the purchase, the order is closed and the later "completed" finds nothing to open.
      const early = orderByToken(c.metadata?.office_order);
      if (early && early.account === account && c.refunded && early.status === 'open') run(db, "UPDATE pay_orders SET status='refunded', ended_at=?, updated_at=? WHERE id=?", now(), now(), early.id);
      return;
    }
    const order = get(db, 'SELECT * FROM pay_orders WHERE id=?', s.order_id);
    if (!order || order.account !== account) return;
    const refunded = Math.max(s.refunded_cents, Number(c.amount_refunded) || 0);
    run(db, 'UPDATE pay_sales SET refunded_cents=? WHERE id=?', refunded, s.id);
    if (!(c.refunded || refunded >= s.amount_cents)) return;
    const latest = get(db, 'SELECT id FROM pay_sales WHERE order_id=? ORDER BY id DESC LIMIT 1', order.id)?.id === s.id;
    if (latest && order.status !== 'disputed') lapse(order, 'refunded');
  }
  function applyDispute(account, d, closed) {
    const s = saleByPi(idOf(d.payment_intent));
    if (!s) return;
    const order = get(db, 'SELECT * FROM pay_orders WHERE id=?', s.order_id);
    if (!order || order.account !== account) return;
    if (!closed) { if (order.status === 'active') lapse(order, 'disputed'); return; }
    if (d.status === 'won') { if (order.status === 'disputed') run(db, "UPDATE pay_orders SET status='active', ended_at=NULL, updated_at=? WHERE id=?", now(), order.id); return; }
    if (d.status === 'lost') run(db, 'UPDATE pay_sales SET refunded_cents=? WHERE id=?', Math.max(s.refunded_cents, s.amount_cents), s.id);
  }


  // ---- a sale reaches both ends: the buyer gets a confirmation, the boss gets the order ----
  const justPaid = [];
  const money = (cents, currency) => { try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: String(currency || 'usd').toUpperCase() }).format((cents || 0) / 100); } catch { return `${((cents || 0) / 100).toFixed(2)} ${String(currency || '').toUpperCase()}`; } };
  const addressLines = (o) => { try { const a = JSON.parse(o.ship_to || 'null'); return a ? [a.name, a.line1, a.line2, [a.city, a.state, a.postal_code].filter(Boolean).join(', '), a.country].filter(Boolean) : []; } catch { return []; } };
  const linesText = (o) => { const v = orderView(o); return v.items.map((i) => `${i.quantity} x ${i.name}  ${money(i.amountCents * i.quantity, o.currency)}`).join('\n'); };
  /** After the transaction that marked them paid. Each order is told once, whichever of the webhook and the buyer's return got there first. */
  function tellPaid() {
    for (const id of justPaid.splice(0)) {
      try {
        if (!run(db, "UPDATE pay_orders SET told=1 WHERE id=? AND told=0 AND status='active'", id).changes) continue;
        const o = get(db, 'SELECT * FROM pay_orders WHERE id=?', id);
        const f = get(db, 'SELECT * FROM floors WHERE id=?', o.floor_id);
        if (!f) continue;
        const pr = get(db, 'SELECT title, slug FROM projects WHERE floor_id=? AND slug=?', o.floor_id, o.project);
        const site = clean(pr?.title || f.name || o.project, 80);
        const number = orderNumber(o.token);
        const test = !o.livemode;
        const to = addressLines(o);
        // The boss's copy: in the company inbox, on the Payments tab, and a nudge to an open floor. Never to a visitor, the feed or the tower.
        const bossText = [`Order ${number} on ${site}${test ? ' (a test payment: no money moved)' : ''}.`, '', linesText(o), `Total paid: ${money(o.amount_cents, o.currency)}`, '',
          o.buyer_name || o.email ? `Buyer: ${[o.buyer_name, o.email].filter(Boolean).join(', ')}` : '', to.length ? `Send to:\n${to.join('\n')}` : '', '', 'The money goes to your Stripe account. This order is on your Payments tab, where you can mark it sent or refund it.'].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n');
        try { engine.mail?.orderToInbox?.(f, { project: o.project, number, subject: `New order ${number} on ${site}`, text: bossText, email: o.email, name: o.buyer_name }); } catch (e) { log('warn', 'pay_order_inbox', { err: hideKeys(e?.message) }); }
        try { engine.emit(f.id, 'pay', { sale: true, number }, { persist: false, ownerOnly: true }); } catch { /* no one watching */ }
        // The manager hears there was a sale, with no figure in it, so they can say so when the boss next asks.
        try { engine.addMessage(f.id, 'note', null, `A customer just bought on ${o.project}: order ${number}${test ? ', a test payment' : ''}. The boss has it on the Payments tab and in the company inbox${to.length ? ', with the address to send it to' : ''}. Nobody on the team can see amounts, refund or change it.`); } catch { /* the sale stands either way */ }
        // The buyer's copy, from the company's own address. Stripe's receipt is separate and only goes out on live payments.
        if (o.email && engine.mail?.ready?.()) {
          const text = [`Thank you${o.buyer_name ? `, ${o.buyer_name.split(' ')[0]}` : ''}. Your order with ${site} is confirmed.`, '', `Order ${number}`, linesText(o), `Total paid: ${money(o.amount_cents, o.currency)}`, '',
            to.length ? `Sending to:\n${to.join('\n')}\n` : '', test ? 'This was a test payment: no money moved and nothing will be sent.\n' : '', 'You paid by card on Stripe\'s secure page. If anything is wrong with your order, just reply to this email.'].filter(Boolean).join('\n');
          engine.mail.send(f, { to: [o.email], subject: `Your order from ${site} (${number})`, text, by: 'app' })
            .then((r) => { if (['sent', 'queued', 'sending'].includes(r.status)) run(db, 'UPDATE pay_orders SET told_buyer=1 WHERE id=?', id); else log('warn', 'pay_confirm_mail', { status: r.status }); })
            .catch((e) => log('warn', 'pay_confirm_mail', { err: hideKeys(e?.message) }));
        }
      } catch (e) { log('error', 'pay_tell_failed', { err: hideKeys(e?.message) }); }
    }
  }

  async function handle(ev, a) {
    const o = ev.data.object || {};
    const account = a.account;
    let apply = () => {};
    switch (ev.type) {
      case 'account.updated': if (o.id === account) apply = () => applyAccount(account, o); break;
      case 'account.application.deauthorized': apply = () => run(db, "UPDATE pay_accounts SET disconnected_at=?, disabled_reason='deauthorized', updated_at=? WHERE account=?", now(), now(), account); break;
      case 'checkout.session.completed': case 'checkout.session.async_payment_succeeded': {
        if (!orderByToken(o.metadata?.office_order || o.client_reference_id)) break;
        // Subscriptions are read fresh, so a late or reordered event can't put back a state Stripe has moved on from.
        const sub = o.subscription ? await stripe.getSubscription(account, idOf(o.subscription)) : null;
        apply = () => applySession(account, o, sub);
        break;
      }
      case 'checkout.session.async_payment_failed': case 'checkout.session.expired': {
        const order = orderByToken(o.metadata?.office_order || o.client_reference_id);
        if (order && order.account === account && order.status === 'open') apply = () => run(db, 'UPDATE pay_orders SET status=?, updated_at=? WHERE id=? AND status=\'open\'', ev.type.endsWith('expired') ? 'expired' : 'failed', now(), order.id);
        break;
      }
      case 'invoice.paid': {
        const subId = o.parent?.subscription_details?.subscription;
        if (subId && (o.parent?.subscription_details?.metadata?.office_order || get(db, 'SELECT 1 x FROM pay_orders WHERE account=? AND subscription=?', account, idOf(subId)))) {
          const inv = await stripe.getInvoice(account, o.id);
          const pi = inv.payments?.data?.find((x) => x.status === 'paid' || x.is_default)?.payment?.payment_intent || '';
          const sub = await stripe.getSubscription(account, idOf(subId));
          apply = () => applyInvoice(account, inv, idOf(pi), sub);
        }
        break;
      }
      case 'customer.subscription.created': case 'customer.subscription.updated': case 'customer.subscription.deleted': {
        // A connected account is the boss's whole Stripe business, so most subscriptions on it may have nothing to do with us. Only ours cost a call.
        if (!o.metadata?.office_order && !get(db, 'SELECT 1 x FROM pay_orders WHERE account=? AND subscription=?', account, o.id)) break;
        const sub = await stripe.getSubscription(account, o.id);
        apply = () => applySubscription(account, sub);
        break;
      }
      case 'charge.refunded': apply = () => applyRefund(account, o); break;
      case 'charge.dispute.created': case 'charge.dispute.closed': apply = () => applyDispute(account, o, ev.type.endsWith('closed')); break;
      default: break;
    }
    // Marked handled in the same transaction as what it brings, so a crash can't lose an event or do one twice.
    const done = tx(db, () => {
      if (!run(db, 'INSERT OR IGNORE INTO pay_events (id,type,account,created_at) VALUES (?,?,?,?)', ev.id, clean(ev.type, 60), account, now()).changes) return false;
      apply();
      return true;
    });
    tellPaid();
    return done;
  }

  async function readRaw(req, max) {
    if (Number(req.headers['content-length'] || 0) > max) throw new CloudError(413, 'too_large', 'too big');
    const chunks = []; let size = 0;
    for await (const c of req) { size += c.length; if (size > max) throw new CloudError(413, 'too_large', 'too big'); chunks.push(c); }
    return Buffer.concat(chunks);
  }
  const hookRates = new ext.RateLimiter(cfg.cloudRateScale ?? cfg.rateScale, now);
  /** POST /theoffice/api/pay/webhook, from Stripe. The signature is checked over the raw bytes before they are ever parsed. */
  async function webhook(req, res, ip) {
    const reply = (status, obj) => json(res, status, obj);
    try {
      if (!hookRates.allow(`pay-hook:${ip}`, 600, 60000)) return reply(429, { error: 'rate_limited' });
      const raw = await readRaw(req, RAW_MAX);
      if (!ready) return reply(503, { error: 'not_ready' });
      const v = verifyStripeSignature({ secret: cfg.stripeWebhookSecret, header: req.headers['stripe-signature'], body: raw, now: now() });
      if (!v.ok) { log('warn', 'pay_hook_refused', { why: v.reason }); return reply(400, { error: 'bad_signature' }); }
      let ev;
      try { ev = JSON.parse(raw.toString('utf8')); } catch { return reply(400, { error: 'bad_json' }); }
      if (!ev || typeof ev !== 'object' || typeof ev.id !== 'string' || typeof ev.type !== 'string' || !ev.data || typeof ev.data !== 'object' || !/^evt_[A-Za-z0-9_]{8,100}$/.test(ev.id)) return reply(400, { error: 'bad_event' });
      if (get(db, 'SELECT 1 x FROM pay_events WHERE id=?', ev.id)) return reply(200, { received: true, duplicate: true });
      // Live and test events share one production endpoint: only the kind this key speaks counts.
      if (Boolean(ev.livemode) !== Boolean(LIVE)) return reply(200, { received: true, ignored: 'mode' });
      const account = typeof ev.account === 'string' ? accountByStripe(ev.account) : null;
      if (!account) return reply(200, { received: true, ignored: 'account' });
      const done = await handle(ev, account);
      if (done && ev.type === 'account.updated') notifyAccount(account);  // the only event that changes what a boss's open page shows; a sale can wait for the next look
      return reply(200, { received: true, duplicate: !done });
    } catch (e) {
      if (e instanceof CloudError) return reply(e.status, { error: e.code });
      log('error', 'pay_hook_failed', { err: hideKeys(e instanceof PayProviderError ? e.message : e?.message) });
      return reply(500, { error: 'failed' });
    }
  }
  const notifyAccount = (a) => { try { engine.emit(a.floor_id, 'pay', {}, { persist: false, ownerOnly: true }); } catch { /* no one watching */ } };

  // ---- the team proposes, the boss decides ----
  /** The only thing a bot can do with money: put a plan in front of the boss. Nothing is created on Stripe, nothing changes for visitors, until the boss taps. */
  function propose(floor, agentName, a) {
    if (!ready) throw new CloudError(503, 'not_ready', NOT_READY.message);
    const key = String(a.key ?? '').toLowerCase().trim();
    if (!PRODUCT_KEY.test(key)) throw new CloudError(400, 'bad_key', 'key is a short name for the product, like pro or supporter: lowercase letters, digits, - and _.');
    const name = clean(a.name, 80);
    if (!name) throw new CloudError(400, 'bad_name', 'name is required.');
    const amount = Number(a.priceCents);
    if (!Number.isInteger(amount) || amount < MIN_CENTS || amount > MAX_CENTS) throw new CloudError(400, 'bad_price', `price_cents is a whole number of cents between ${MIN_CENTS} and ${MAX_CENTS}.`);
    const interval = a.billing === undefined || a.billing === null ? '' : INTERVAL[a.billing];
    if (interval === undefined) throw new CloudError(400, 'bad_billing', 'billing is one_off, monthly or yearly.');
    const project = String(a.project ?? '');
    if (!slugPattern.test(project) || !get(db, 'SELECT 1 x FROM projects WHERE floor_id=? AND slug=?', floor.id, project)) throw new CloudError(400, 'bad_project', 'That project does not exist on this floor.');
    const gates = a.unlocks === undefined || a.unlocks === null ? null : (Array.isArray(a.unlocks) ? a.unlocks.map(String) : null);
    if (gates === null && a.unlocks !== undefined && a.unlocks !== null) throw new CloudError(400, 'bad_unlocks', 'unlocks is a list of collection names.');
    if (gates && (gates.length > 10 || !gates.every((c) => COLL.test(c)))) throw new CloudError(400, 'bad_unlocks', 'unlocks is up to 10 collection names.');
    if (get(db, "SELECT COUNT(*) n FROM pay_products WHERE floor_id=? AND status='proposed'", floor.id).n >= OPEN_PROPOSALS) throw new CloudError(429, 'too_many', 'The boss already has a lot of products to look at. Wait for an answer.');
    const description = clean(a.description, 300);
    const why = clean(a.why, 400);
    if (a.ships !== undefined && a.ships !== null && typeof a.ships !== 'boolean') throw new CloudError(400, 'bad_ships', 'ships is true or false.');
    const account = accountRow(floor.id);
    const currency = account?.currency || 'usd';
    const prior = get(db, "SELECT * FROM pay_products WHERE floor_id=? AND project=? AND livemode=? AND key=? AND status='live'", floor.id, project, LIVE, key);
    const useGates = gates ?? (prior ? JSON.parse(prior.gates) : []);
    const ships = (a.ships ?? !!prior?.ships) ? 1 : 0;
    if (ships && (interval || useGates.length)) throw new CloudError(400, 'bad_ships', 'Something that is posted is a one-off with nothing to unlock.');
    const same = get(db, "SELECT id FROM pay_products WHERE floor_id=? AND project=? AND livemode=? AND key=? AND status='proposed' AND amount_cents=? AND interval=? AND ships=?", floor.id, project, LIVE, key, amount, interval, ships);
    if (same) return { id: same.id, already: true, status: 'proposed' };
    if (prior && prior.amount_cents === amount && prior.interval === interval && prior.name === name && prior.gates === JSON.stringify(useGates) && !!prior.ships === !!ships) return { id: prior.id, already: true, status: 'live' };
    // A newer proposal for the same thing replaces an older one the boss hasn't answered, so they never see two prices for one product.
    run(db, "UPDATE pay_products SET status='withdrawn', updated_at=? WHERE floor_id=? AND project=? AND livemode=? AND key=? AND status='proposed'", now(), floor.id, project, LIVE, key);
    const r = run(db, "INSERT INTO pay_products (floor_id,project,livemode,key,name,description,amount_cents,currency,interval,gates,ships,status,agent_name,why,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,'proposed',?,?,?,?)",
      floor.id, project, LIVE, key, name, description, amount, currency, interval, JSON.stringify(useGates), ships, clean(agentName, 40), why, now(), now());
    engine.emit(floor.id, 'pay', {}, { persist: false, ownerOnly: true });
    return { id: Number(r.lastInsertRowid), status: 'proposed' };
  }


  /** A shop's own catalogue (shop.json in the project) is its proposal: every product in it that isn't already on sale at that price goes in front of
   * the boss, exactly as propose_product would put it. It runs when the shop is published, so a team can't ship a shop and forget to ask. Nothing is
   * created on Stripe and nothing is on sale until the boss taps. Never throws: what it couldn't propose comes back as words. */
  function proposeCatalogue(floor, project, catalogue, agentName) {
    const out = { proposed: [], already: [], problems: [] };
    if (!ready) return { ...out, off: true };
    const list = Array.isArray(catalogue?.products) ? catalogue.products.slice(0, OPEN_PROPOSALS) : [];
    for (const it of list) {
      const key = String(it?.key ?? '').toLowerCase().trim();
      try {
        const priceCents = Number.isInteger(it?.priceCents) ? it.priceCents : Math.round(Number(it?.price) * 100);
        const r = propose(floor, agentName, { project, key, name: it?.name, description: it?.description, priceCents, billing: it?.billing || 'one_off', ships: typeof it?.ships === 'boolean' ? it.ships : undefined,
          why: clean(it?.why, 300) || (it?.priceFrom === 'boss' ? 'The price you gave.' : 'A proposed price: change it by telling your manager.') });
        (r.already ? out.already : out.proposed).push(key);
      } catch (e) { out.problems.push(`${key || 'a product'}: ${e instanceof CloudError ? e.message : 'could not be proposed'}`); }
    }
    return out;
  }

  async function approve(f, id) {
    if (!ready) throw new HttpError(503, 'not_ready', 'Payments are being set up.');
    const account = accountRow(f.id);
    if (!account || account.disconnected_at) throw new HttpError(409, 'not_connected', 'Connect your Stripe account first.');
    const row = get(db, 'SELECT * FROM pay_products WHERE id=? AND floor_id=? AND livemode=?', id, f.id, LIVE);
    if (!row) throw new HttpError(404, 'not_found');
    if (row.status === 'live') return productView(row);
    if (row.status !== 'proposed' && !(row.status === 'approving' && row.updated_at < now() - 120000)) throw new HttpError(409, 'decided', 'That has already been decided.');
    if (!run(db, "UPDATE pay_products SET status='approving', updated_at=? WHERE id=? AND status=?", now(), id, row.status).changes) throw new HttpError(409, 'decided', 'That has already been decided.');
    try {
      const prior = get(db, "SELECT * FROM pay_products WHERE floor_id=? AND project=? AND livemode=? AND key=? AND status='live'", f.id, row.project, LIVE, row.key);
      const product = prior?.stripe_product || (await stripe.createProduct(account.account, { name: row.name, description: row.description || undefined, metadata: { office_floor: String(f.id), office_project: row.project, office_product: row.key } }, `office-product-${row.id}`)).id;
      if (prior && (prior.name !== row.name || prior.description !== row.description)) { try { await stripe.updateProduct(account.account, product, { name: row.name, description: row.description }); } catch (e) { log('warn', 'pay_product_rename', { err: hideKeys(e?.message) }); } }
      const price = await stripe.createPrice(account.account, { product, unit_amount: row.amount_cents, currency: row.currency, ...(row.interval ? { recurring: { interval: row.interval } } : {}), metadata: { office_product: row.key } }, `office-price-${row.id}`);
      tx(db, () => {
        if (prior) run(db, "UPDATE pay_products SET status='superseded', updated_at=? WHERE id=?", now(), prior.id);
        run(db, "UPDATE pay_products SET status='live', stripe_product=?, stripe_price=?, decided_at=?, updated_at=? WHERE id=?", product, price.id, now(), now(), id);
      });
      if (prior) { try { await stripe.updatePrice(account.account, prior.stripe_price, { active: false }); } catch (e) { log('warn', 'pay_old_price', { err: hideKeys(e?.message) }); } }
      engine.addMessage(f.id, 'note', null, `The boss approved "${row.name}" (product key ${row.key}) for ${row.project}. Pages can now sell it with office.pay.checkout({ product: '${row.key}' }).`);
      engine.emit(f.id, 'pay', {}, { persist: false, ownerOnly: true });
      return productView({ ...row, status: 'live' });
    } catch (e) {
      run(db, "UPDATE pay_products SET status='proposed', updated_at=? WHERE id=? AND status='approving'", now(), id);
      log('error', 'pay_approve_failed', { err: hideKeys(e?.message) });
      throw new HttpError(502, 'stripe_failed', 'Stripe didn\'t take that. Nothing changed; try again in a moment.');
    }
  }
  function decline(f, id) {
    if (!run(db, "UPDATE pay_products SET status='declined', decided_at=?, updated_at=? WHERE id=? AND floor_id=? AND status='proposed'", now(), now(), id, f.id).changes) throw new HttpError(404, 'not_found');
    const row = get(db, 'SELECT * FROM pay_products WHERE id=?', id);
    engine.addMessage(f.id, 'note', null, `The boss said no to "${row.name}" for ${row.project}. Don't put it on the site.`);
  }
  async function archive(f, id) {
    const row = get(db, "SELECT * FROM pay_products WHERE id=? AND floor_id=? AND livemode=? AND status='live'", id, f.id, LIVE);
    if (!row) throw new HttpError(404, 'not_found');
    const account = accountRow(f.id);
    try {
      if (account && row.stripe_price) await stripe.updatePrice(account.account, row.stripe_price, { active: false });
      if (account && row.stripe_product) await stripe.updateProduct(account.account, row.stripe_product, { active: false });
    } catch (e) {
      log('error', 'pay_archive_failed', { err: hideKeys(e?.message) });
      throw new HttpError(502, 'stripe_failed', 'Stripe didn\'t take that. Nothing changed; try again in a moment.');
    }
    run(db, "UPDATE pay_products SET status='archived', decided_at=?, updated_at=? WHERE id=?", now(), now(), id);
    engine.addMessage(f.id, 'note', null, `The boss took "${row.name}" off sale for ${row.project}. People who already bought it keep it.`);
  }
  async function refund(f, token) {
    if (!ready) throw new HttpError(503, 'not_ready', 'Payments are being set up.');
    const order = get(db, 'SELECT * FROM pay_orders WHERE token=? AND floor_id=? AND livemode=?', token, f.id, LIVE);
    if (!order) throw new HttpError(404, 'not_found');
    const s = get(db, 'SELECT * FROM pay_sales WHERE order_id=? AND refunded_cents<amount_cents ORDER BY id DESC LIMIT 1', order.id);
    if (!s || !s.payment_intent) throw new HttpError(409, 'nothing_to_refund', 'There is nothing left to refund on this order.');
    const left = s.amount_cents - s.refunded_cents;
    try {
      // The subscription goes first, so a card can't be charged again after its refund.
      if (order.kind === 'subscription' && order.subscription && order.sub_status !== 'canceled') await stripe.cancelSubscription(order.account, order.subscription, `office-cancel-${order.subscription}`);
      await stripe.createRefund(order.account, { payment_intent: s.payment_intent, amount: left, metadata: { office_order: order.token } }, `office-refund-${s.id}-${left}`);
    } catch (e) {
      log('error', 'pay_refund_failed', { err: hideKeys(e?.message) });
      throw new HttpError(502, 'stripe_failed', 'Stripe didn\'t take that. Nothing was refunded; try again in a moment.');
    }
    // The webhook says the same thing a moment later; doing it here means the button is honest straight away. It keeps the higher figure either way.
    tx(db, () => {
      run(db, 'UPDATE pay_sales SET refunded_cents=amount_cents WHERE id=?', s.id);
      if (order.status !== 'disputed') lapse(order, 'refunded');
    });
    return { ok: true, refundedCents: left, currency: s.currency };
  }

  // ---- the boss's panel ----
  async function ownerView(f, { refresh = false } = {}) {
    const notReadyView = { ready: false, testMode: false, message: NOT_READY.message, account: accountView(null), products: [], proposals: [], sales: salesSummary(db, f.id, { days: 30, now: now() }), orders: [] };
    if (!ready) return notReadyView;
    let a = accountRow(f.id);
    if (a && !a.disconnected_at && (refresh || now() - a.updated_at > 60000)) {
      try { const fresh = await stripe.getAccount(a.account); applyAccount(a.account, fresh); a = accountRow(f.id); } catch (e) { log('warn', 'pay_status_refresh', { err: hideKeys(e?.message) }); }
    }
    const rows = all(db, "SELECT * FROM pay_products WHERE floor_id=? AND livemode=? AND status IN ('proposed','approving','live','archived') ORDER BY id DESC LIMIT 200", f.id, LIVE);
    const productCard = (r) => ({ id: r.id, project: r.project, key: r.key, name: r.name, description: r.description, amountCents: r.amount_cents, currency: r.currency, interval: r.interval || null, ships: !!r.ships, unlocks: JSON.parse(r.gates), status: r.status, why: r.why, agentName: r.agent_name, createdAt: r.created_at });
    const orders = all(db, "SELECT o.*, (SELECT MAX(s.refunded_cents<s.amount_cents) FROM pay_sales s WHERE s.order_id=o.id AND s.payment_intent!='') refundable FROM pay_orders o WHERE o.floor_id=? AND o.livemode=? AND o.status!='open' AND o.status!='expired' AND o.status!='failed' ORDER BY o.id DESC LIMIT 50", f.id, LIVE)
      .map((o) => ({ token: o.token, number: orderNumber(o.token), project: o.project, product: o.product_key, buyer: o.buyer_name || o.owner_name || 'A customer', email: o.email || '', items: itemsOf(o).map((i) => ({ name: i.name, quantity: i.quantity })), shipTo: addressLines(o), sentAt: o.fulfilled_at || null,
        kind: o.kind, status: o.status, subStatus: o.sub_status, amountCents: o.amount_cents, currency: o.currency, paidAt: o.paid_at, createdAt: o.created_at, refundable: !!o.refundable }));
    return {
      ready: true, testMode: mode === 'test', account: accountView(a), products: rows.filter((r) => r.status === 'live' || r.status === 'archived').map(productCard), proposals: rows.filter((r) => r.status === 'proposed').map(productCard),
      sales: salesSummary(db, f.id, { days: 30, now: now() }), orders,
    };
  }
  hooks.snapshot.push((f, viewer, out) => {
    if (!viewer.owner) return;
    if (!ready) { out.pay = { ready: false, waiting: [], testMode: false }; return; }
    const waiting = all(db, "SELECT * FROM pay_products WHERE floor_id=? AND livemode=? AND status='proposed' ORDER BY id LIMIT 50", f.id, LIVE)
      .map((r) => ({ id: r.id, project: r.project, key: r.key, name: r.name, description: r.description, amountCents: r.amount_cents, currency: r.currency, interval: r.interval || null, ships: !!r.ships, why: r.why, agentName: r.agent_name, unlocks: JSON.parse(r.gates), replaces: !!get(db, "SELECT 1 x FROM pay_products WHERE floor_id=? AND project=? AND livemode=? AND key=? AND status='live'", f.id, r.project, LIVE, r.key) }));
    const a = accountRow(f.id);
    out.pay = { ready: true, testMode: mode === 'test', connected: !!a && !a.disconnected_at, taking: !!a && !a.disconnected_at && !!a.charges_enabled, waiting };
  });
  const stateLine = (f) => {
    if (!ready) return 'Payments: being set up for the whole building. Don\'t build a pricing flow around it yet: office.pay answers "not ready" and the page should say so.';
    const a = accountRow(f.id);
    const waitingN = get(db, "SELECT COUNT(*) n FROM pay_products WHERE floor_id=? AND livemode=? AND status='proposed'", f.id, LIVE).n;
    if (!a || a.disconnected_at) return `Payments: the boss has not connected Stripe yet${waitingN ? `, and ${waitingN} product${waitingN > 1 ? 's are' : ' is'} waiting for their approval` : ''}. Nothing can be sold until they do both, and a shop says so honestly until then. Walk them through it in plain words whenever selling comes up: open the Payments tab on their floor, tap Connect Stripe, fill in Stripe's own form (a few minutes; the money goes straight to them), then approve each product under Requests.`;
    const rows = all(db, "SELECT project, key, name, status, interval FROM pay_products WHERE floor_id=? AND livemode=? AND status IN ('proposed','live') ORDER BY id DESC LIMIT 20", f.id, LIVE);
    return `Payments: ${a.charges_enabled ? 'Stripe connected and taking payments' : 'Stripe connected, the boss has not finished its form'}.${rows.length ? ` Products: ${rows.map((r) => `${r.project}/${r.key} "${r.name}" (${r.status === 'live' ? 'live' : 'waiting for the boss'}, ${r.interval ? `${r.interval}ly` : 'one-off'})`).join(' | ')}.` : ''} Only the boss's tap makes a product real. Sales figures are the boss's alone.`;
  };

  // ---- boss routes ----
  const idParam = (s) => { const n = Number(s); if (!Number.isInteger(n) || n <= 0) throw new HttpError(404, 'not_found'); return n; };
  GET('/api/floors/:slug/pay', async ({ req, res, p, url }) => {
    const f = requireOwner(req, p.slug);
    json(res, 200, await ownerView(f, { refresh: url.searchParams.get('refresh') === '1' }));
  });
  POST('/api/floors/:slug/pay/connect', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug);
    ext.limit('mutate', ip);
    try { json(res, 200, await connect(f, req)); } catch (e) {
      if (e instanceof HttpError) throw e;
      log('error', 'pay_connect_failed', { err: hideKeys(e?.message) });
      throw new HttpError(502, 'stripe_failed', 'Stripe didn\'t answer. Try again in a moment.');
    }
  });
  POST('/api/floors/:slug/pay/products/:id/approve', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug);
    ext.limit('mutate', ip);
    json(res, 200, { ok: true, product: await approve(f, idParam(p.id)) });
  });
  POST('/api/floors/:slug/pay/products/:id/decline', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug);
    ext.limit('mutate', ip);
    decline(f, idParam(p.id));
    json(res, 200, { ok: true });
  });
  POST('/api/floors/:slug/pay/products/:id/archive', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug);
    ext.limit('mutate', ip);
    await archive(f, idParam(p.id));
    json(res, 200, { ok: true });
  });
  POST('/api/floors/:slug/pay/products/approve-all', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug);
    ext.limit('mutate', ip);
    // The boss's own tap, once for everything waiting: each one is still made on Stripe with its own idempotency key.
    const ids = all(db, "SELECT id FROM pay_products WHERE floor_id=? AND livemode=? AND status='proposed' ORDER BY id LIMIT ?", f.id, LIVE, OPEN_PROPOSALS).map((r) => r.id);
    const approved = [];
    for (const id of ids) approved.push(await approve(f, id));
    json(res, 200, { ok: true, approved: approved.length });
  });
  POST('/api/floors/:slug/pay/orders/:token/sent', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug);
    ext.limit('mutate', ip);
    if (!/^ord_[A-Za-z0-9_-]{10,40}$/.test(p.token)) throw new HttpError(404, 'not_found');
    const o = get(db, 'SELECT id, fulfilled_at FROM pay_orders WHERE token=? AND floor_id=? AND livemode=?', p.token, f.id, LIVE);
    if (!o) throw new HttpError(404, 'not_found');
    run(db, 'UPDATE pay_orders SET fulfilled_at=?, updated_at=? WHERE id=?', o.fulfilled_at ? null : now(), now(), o.id);
    json(res, 200, { ok: true, sent: !o.fulfilled_at });
  });
  POST('/api/floors/:slug/pay/orders/:token/refund', async ({ req, res, p, ip }) => {
    const f = requireOwner(req, p.slug);
    ext.limit('mutate', ip);
    if (!/^ord_[A-Za-z0-9_-]{10,40}$/.test(p.token)) throw new HttpError(404, 'not_found');
    json(res, 200, await refund(f, p.token));
  });

  let sweepTimer = null;
  const pay = {
    ready, mode, webhook, cloudRoute, guard, assertCanDelete, propose, proposeCatalogue, stateLine,
    has: (floorId, project, ownerKey, product) => payHas(db, floorId, project, ownerKey, product),
    start() { sweepTimer = setInterval(() => { try { run(db, 'DELETE FROM pay_events WHERE created_at<?', now() - EVENT_DAYS * 86400e3); run(db, "DELETE FROM pay_orders WHERE status='open' AND session_id='' AND created_at<?", now() - 3 * 86400e3); } catch { /* next time */ } }, 3600000); sweepTimer.unref?.(); },
    stop() { clearInterval(sweepTimer); hookRates.close?.(); },
  };
  engine.pay = pay;
  return pay;
}
