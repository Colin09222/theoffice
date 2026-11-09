// The shop. shop.json is the catalogue: what is for sale, its picture and its price. The page shows it at once, then asks Office Cloud what can really
// be bought right now (office.pay.status): a product the boss has approved shows the approved price and a working "Add to basket"; until the boss has
// connected Stripe and approved, the shop says so plainly and takes an order request by email instead, so it is never a dead end.
// Card details never touch this page: "Pay by card" goes to Stripe's own checkout, and the buyer lands back here on a thank-you with their order number.
const office = Office.connect();
const $ = (name, root = document) => root.querySelector(`[data-office="${name}"]`);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
let catalogue = { currency: 'usd', products: [] }, pay = { ready: false, message: '', products: [], testMode: false }, basket = {};
const money = (cents, currency) => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: String(currency || catalogue.currency || 'usd').toUpperCase() }).format(cents / 100); } catch (e) { return (cents / 100).toFixed(2); } };
const liveOf = (key) => pay.products.find((p) => p.key === key) || null;
// The approved price wins: what Stripe will charge is the only price a buyer is ever shown next to a working button.
const centsOf = (p) => (liveOf(p.key) ? liveOf(p.key).amountCents : Math.round(Number(p.price) * 100));
const currencyOf = (p) => (liveOf(p.key) ? liveOf(p.key).currency : catalogue.currency);
const saveBasket = () => { try { localStorage.setItem('basket', JSON.stringify(basket)); } catch (e) { /* a private window: the basket lasts for this visit */ } };
const lines = () => catalogue.products.filter((p) => basket[p.key] > 0).map((p) => ({ p, quantity: basket[p.key] }));
const count = () => lines().reduce((n, l) => n + l.quantity, 0);

function renderProducts() {
  const grid = $('products'); grid.textContent = '';
  for (const p of catalogue.products) {
    const card = el('article', 'card'); card.dataset.office = 'product'; card.dataset.key = p.key;
    const img = el('img'); img.src = p.image; img.alt = p.imageAlt || p.name; img.loading = 'lazy'; img.width = 400; img.height = 400;
    const body = el('div', 'body');
    body.append(el('h3', '', p.name));
    if (p.description) body.append(el('p', 'desc', p.description));
    if (p.imageKind === 'illustration') body.append(el('p', 'tag', 'Picture: an illustration, not a photo of the product.'));
    const buy = el('div', 'buy');
    const price = el('p', 'price', money(centsOf(p), currencyOf(p))); price.dataset.office = 'price';
    // A price the boss hasn't set or approved yet is a proposal, and says so.
    if (!liveOf(p.key) && p.priceFrom !== 'boss') price.append(el('small', '', 'proposed price'));
    const add = el('button', 'btn', pay.ready && !liveOf(p.key) ? 'Not on sale yet' : 'Add to basket'); add.type = 'button'; add.dataset.office = 'add';
    add.disabled = pay.ready && !liveOf(p.key);
    add.addEventListener('click', () => { basket[p.key] = Math.min(20, (basket[p.key] || 0) + 1); saveBasket(); renderBasket(); openBasket(); });
    buy.append(price, add); card.append(img, body, buy); grid.append(card);
  }
  const note = $('shop-status');
  note.textContent = pay.ready ? (pay.testMode ? 'Test mode: checkout works, but no real money moves.' : '') : 'Card payments aren\'t switched on here yet. You can still send an order request from your basket, and we\'ll email you to arrange it.';
  const d = $('delivery'); d.hidden = !catalogue.delivery; d.textContent = catalogue.delivery || '';
}

function renderBasket() {
  const list = $('cart-lines'); list.textContent = '';
  let total = 0;
  for (const { p, quantity } of lines()) {
    total += centsOf(p) * quantity;
    const li = el('li'); li.dataset.key = p.key;
    const qty = el('span', 'qty');
    const less = el('button', '', '-'); less.type = 'button'; less.setAttribute('aria-label', `One fewer ${p.name}`);
    const more = el('button', '', '+'); more.type = 'button'; more.setAttribute('aria-label', `One more ${p.name}`);
    less.addEventListener('click', () => { basket[p.key] = quantity - 1; if (basket[p.key] <= 0) delete basket[p.key]; saveBasket(); renderBasket(); });
    more.addEventListener('click', () => { basket[p.key] = Math.min(20, quantity + 1); saveBasket(); renderBasket(); });
    qty.append(less, el('b', '', String(quantity)), more);
    li.append(el('span', '', p.name), el('span', '', money(centsOf(p) * quantity, currencyOf(p))), qty);
    list.append(li);
  }
  const any = count() > 0;
  $('cart-count').textContent = String(count());
  $('cart-empty').hidden = any; $('cart-sum').hidden = !any;
  $('cart-total').textContent = money(total);
  // Stripe can take it: one button. It can't yet: an honest line and a way to ask for the order anyway.
  $('checkout').hidden = !any || !pay.ready;
  $('order-request').hidden = !any || pay.ready;
  $('order-request-why').textContent = pay.message && office.mode === 'local' ? pay.message : 'We can\'t take card payments here yet. Send this as an order request and we\'ll email you to arrange payment and delivery. Nothing is charged now.';
}
const openBasket = () => { $('cart').hidden = false; $('cart-scrim').hidden = false; $('cart-close').focus(); };
const closeBasket = () => { $('cart').hidden = true; $('cart-scrim').hidden = true; };

async function checkout() {
  const btn = $('checkout'), status = $('checkout-status');
  btn.disabled = true; status.classList.remove('bad'); status.textContent = 'Taking you to Stripe\'s secure checkout...';
  const r = await office.pay.checkout({ items: lines().map((l) => ({ product: l.p.key, quantity: l.quantity })), returnPath: location.pathname });
  if (r.ok) return;  // on the way to Stripe; the basket is cleared when they come back paid
  btn.disabled = false; status.classList.add('bad'); status.textContent = r.message || 'Checkout isn\'t available right now. Try again in a moment.';
  if (r.code === 'not_ready' || r.code === 'no_product') { await refresh(); }
}

async function requestOrder(e) {
  e.preventDefault();
  const form = $('order-request'), status = $('order-request-status'), f = new FormData(form);
  const name = String(f.get('name') || '').trim(), email = String(f.get('email') || '').trim();
  status.classList.remove('bad');
  if (!name || !EMAIL.test(email)) { status.textContent = 'Please give your name and a real email address.'; status.classList.add('bad'); return; }
  const btn = form.querySelector('button'); btn.disabled = true; status.textContent = 'Sending...';
  const message = `Order request: ${lines().map((l) => `${l.quantity} x ${l.p.name}`).join(', ')}`;
  try {
    const ok = await office.forms.submit('order-enquiry', { name, email, message, website: String(f.get('website') || '') });
    if (ok === false) { status.textContent = 'This preview has no Office server behind it, so nothing was sent. It works once the shop is live.'; return; }
    basket = {}; saveBasket(); renderBasket(); form.hidden = true;
    $('cart-empty').hidden = false; $('cart-empty').textContent = `Thanks, ${name}. Your order request is in, and you'll hear back by email. Nothing has been charged.`;
  } catch (x) { status.textContent = x.message || 'That did not go through. Please try again.'; status.classList.add('bad'); } finally { btn.disabled = false; }
}

// Back from Stripe: show the order itself, read from the server, not a guess.
async function showReturn() {
  const back = office.pay.returned();
  if (!back) return;
  const box = $('order-confirmation');
  if (back === 'cancelled') { $('shop-status').textContent = 'Checkout was cancelled and nothing was charged. Your basket is still here.'; return; }
  let o = await office.pay.order();
  for (let i = 0; i < 6 && o.ok && !o.paid; i++) { await new Promise((r) => setTimeout(r, 1500)); o = await office.pay.order(); }
  if (!o.ok) return;
  $('order-title').textContent = o.paid ? 'Thank you. Your order is in.' : 'Thank you. Your payment is still going through.';
  $('order-number').textContent = o.number;
  const list = $('order-items'); list.textContent = '';
  for (const i of o.items) { const li = el('li'); li.append(el('span', '', `${i.quantity} x ${i.name}`), el('span', '', money(i.amountCents * i.quantity, o.currency))); list.append(li); }
  $('order-total').textContent = money(o.totalCents, o.currency);
  $('order-note').textContent = `${o.emailed ? 'A confirmation is on its way to the email address you gave at checkout. ' : 'Keep this order number. '}${o.testMode ? 'This was a test payment: no money moved.' : ''}`;
  box.hidden = false; box.scrollIntoView({ block: 'start' });
  if (o.paid) { basket = {}; saveBasket(); renderBasket(); }
}

async function refresh() { pay = await office.pay.status(); renderProducts(); renderBasket(); }

function contactForm() {
  const form = $('contact-form'), status = $('form-status');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form), name = String(f.get('name') || '').trim(), email = String(f.get('email') || '').trim(), message = String(f.get('message') || '').trim();
    status.classList.remove('bad');
    if (!name || !EMAIL.test(email) || !message) { status.textContent = 'Please fill in your name, a real email address and a message.'; status.classList.add('bad'); return; }
    const btn = form.querySelector('button'); btn.disabled = true; status.textContent = 'Sending...';
    try {
      const ok = await office.forms.submit('contact', { name, email, message, website: String(f.get('website') || '') });
      status.textContent = ok === false ? 'This preview has no Office server behind it, so nothing was sent. It works once the shop is live.' : `Thanks, ${name}. Your message is in, and you'll hear back personally.`;
      if (ok !== false) form.reset();
    } catch (x) { status.textContent = x.message || 'That did not go through. Please try again.'; status.classList.add('bad'); } finally { btn.disabled = false; }
  });
}

(async function start() {
  $('cart-open').addEventListener('click', openBasket);
  $('cart-close').addEventListener('click', closeBasket);
  $('cart-scrim').addEventListener('click', closeBasket);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeBasket(); });
  $('checkout').addEventListener('click', checkout);
  $('order-request').addEventListener('submit', requestOrder);
  contactForm();
  try { catalogue = await (await fetch('shop.json', { cache: 'no-cache' })).json(); } catch (e) { $('shop-status').textContent = 'The shop could not load its products. Please refresh the page.'; return; }
  try { basket = JSON.parse(localStorage.getItem('basket') || '{}') || {}; } catch (e) { basket = {}; }
  for (const k of Object.keys(basket)) if (!catalogue.products.some((p) => p.key === k) || !(basket[k] > 0)) delete basket[k];
  renderProducts(); renderBasket();
  await office.ready;
  await refresh();
  await showReturn();
  window.officeShop = { ready: true };  // the Tester's script waits for this
})();
