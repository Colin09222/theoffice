// {{TITLE}}: the app starter. A landing page and a signed-in app on Office Cloud accounts and the database: create, edit and delete
// with empty, loading and error states, and settings saved to the account. Hash routes: #/ #/signup #/signin #/forgot #/app #/settings.
// A forgotten password: #/forgot mails a link to the built-in reset page at /_office/reset.
// The data-office attributes are what the Tester's end-to-end check uses (sign up, create, reload, sign out and in): keep them.
const office = Office.connect();
const items = office.db.collection('items');
const $ = (s) => document.querySelector(s);
const view = (name) => { for (const v of document.querySelectorAll('[data-view]')) v.hidden = v.dataset.view !== name; $('#main').focus({ preventScroll: true }); };
// A document comes back as {id, data, ...}; the page works with {id, ...data}.
const flat = (doc) => ({ ...(doc?.data || doc || {}), id: doc?.id });
const say = (el, text, bad = false) => { el.textContent = text; el.classList.toggle('bad', bad); };

function nav() { const inn = !!office.auth.user; for (const n of document.querySelectorAll('[data-when]')) n.hidden = (n.dataset.when === 'in') !== inn; }
function route() {
  const r = location.hash.replace(/^#\/?/, '') || '';
  const inn = !!office.auth.user;
  nav();
  if ((r === 'app' || r === 'settings') && !inn) { location.hash = '#/signin'; return; }
  if ((r === 'signup' || r === 'signin' || r === 'forgot') && inn) { location.hash = '#/app'; return; }
  if (r === 'forgot') { view('forgot'); say($('[data-office="forgot-status"]'), ''); return; }
  if (r === 'signup' || r === 'signin') return showAuth(r);
  if (r === 'app') { view('app'); return load(); }
  if (r === 'settings') { view('settings'); loadSettings(); return loadPlan(); }
  view('landing');
}

// ---- accounts ----
let mode = 'signup';
function showAuth(m) {
  mode = m; view('auth');
  $('[data-office="auth-title"]').textContent = m === 'signup' ? 'Create your account' : 'Welcome back';
  $('[data-office="auth-submit"]').textContent = m === 'signup' ? 'Create account' : 'Sign in';
  $('[data-office="login-label"]').textContent = m === 'signup' ? 'Username' : 'Username or email';
  for (const n of document.querySelectorAll('[data-only]')) n.hidden = n.dataset.only !== m;
  say($('[data-office="auth-error"]'), '');
}
$('[data-office="auth-form"]').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target), btn = $('[data-office="auth-submit"]'), err = $('[data-office="auth-error"]');
  const username = String(f.get('username') || '').trim(), password = String(f.get('password') || ''), email = String(f.get('email') || '').trim();
  if (username.length < 3) return say(err, 'Pick a username of at least 3 characters.', true);
  if (password.length < 8) return say(err, 'Use a password of at least 8 characters.', true);
  if (mode === 'signup' && email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return say(err, 'That email address does not look right.', true);
  btn.disabled = true; say(err, mode === 'signup' ? 'Creating your account...' : 'Signing in...');
  try {
    if (mode === 'signup') await office.auth.signUp({ username, email: email || undefined, password, name: String(f.get('name') || '').trim() || username });
    else await office.auth.logIn({ login: username, password });
    e.target.reset(); location.hash = '#/app';
  } catch (x) { say(err, x.message || 'That did not work. Try again.', true); } finally { btn.disabled = false; }
});
$('[data-office="forgot-form"]').addEventListener('submit', async (e) => {
  e.preventDefault();
  const st = $('[data-office="forgot-status"]'), btn = $('[data-office="forgot-submit"]'), email = $('[data-office="forgot-email"]').value.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return say(st, 'Give the email address on your account.', true);
  btn.disabled = true; say(st, 'Sending...');
  // The answer is the same whether or not the address has an account: show it as it is.
  try { const r = await office.auth.forgotPassword(email); say(st, r.message, !r.ok); } catch (x) { say(st, x.message || 'That did not work. Try again.', true); } finally { btn.disabled = false; }
});
$('[data-office="signout"]').addEventListener('click', async () => { await office.auth.logOut().catch(() => {}); location.hash = '#/'; });
office.auth.onChange(() => route());

// ---- the list: create, edit, delete ----
const list = $('[data-office="list"]'), status = $('[data-office="list-status"]');
function row(doc) {
  const li = document.createElement('li'); li.dataset.id = doc.id; li.dataset.office = 'item';
  const title = document.createElement('span'); title.className = 'title'; title.textContent = doc.title;
  const done = document.createElement('input'); done.type = 'checkbox'; done.checked = !!doc.done; done.setAttribute('aria-label', `Done: ${doc.title}`);
  done.addEventListener('change', () => save(doc.id, { done: done.checked }, li));
  const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'ghost'; edit.textContent = 'Edit';
  edit.addEventListener('click', async () => { const t = prompt('Edit', doc.title); if (t == null || !t.trim()) return; if (await save(doc.id, { title: t.trim().slice(0, 120) }, li)) { doc.title = t.trim().slice(0, 120); title.textContent = doc.title; } });
  const del = document.createElement('button'); del.type = 'button'; del.className = 'ghost danger'; del.textContent = 'Delete'; del.dataset.office = 'delete';
  del.addEventListener('click', async () => { li.classList.add('busy'); try { await items.remove(doc.id); li.remove(); if (!list.children.length) say(status, 'Nothing here yet. Add your first one above.'); } catch (x) { li.classList.remove('busy'); say(status, x.message, true); } });
  li.classList.toggle('done', !!doc.done);
  li.append(done, title, edit, del);
  return li;
}
async function save(id, changes, li) { li.classList.add('busy'); try { await items.update(id, changes); li.classList.toggle('done', !!changes.done); return true; } catch (x) { say(status, x.message, true); return false; } finally { li.classList.remove('busy'); } }
async function load() {
  list.replaceChildren(); say(status, 'Loading...'); list.setAttribute('aria-busy', 'true');
  try {
    const docs = await items.find({ mine: true, sort: '-createdAt', limit: 100 });
    const arr = (Array.isArray(docs) ? docs : docs?.docs || docs?.items || []).map(flat);
    list.replaceChildren(...arr.map(row));
    say(status, arr.length ? '' : 'Nothing here yet. Add your first one above.');
  } catch (x) { say(status, `Couldn't load your list: ${x.message}. Check your connection and reload.`, true); } finally { list.removeAttribute('aria-busy'); }
}
$('[data-office="create-form"]').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('[data-office="create-input"]'), title = input.value.trim(); if (!title) return;
  const btn = $('[data-office="create-submit"]'); btn.disabled = true;
  try { const doc = await items.add({ title: title.slice(0, 120), done: false }, { private: true }); input.value = ''; list.prepend(row({ title, done: false, ...flat(doc) })); say(status, ''); }
  catch (x) { say(status, x.message || 'Could not add that.', true); } finally { btn.disabled = false; input.focus(); }
});

// ---- settings, kept on the account ----
async function loadSettings() {
  const s = await office.saves.get('settings', {}).catch(() => ({}));
  $('[data-office="display"]').value = s.display || office.auth.user?.name || ''; $('[data-office="compact"]').checked = !!s.compact;
  document.body.classList.toggle('compact', !!s.compact);
}
$('[data-office="settings-form"]').addEventListener('submit', async (e) => {
  e.preventDefault(); const st = $('[data-office="settings-status"]');
  const s = { display: $('[data-office="display"]').value.trim().slice(0, 40), compact: $('[data-office="compact"]').checked };
  try { await office.saves.set('settings', s); document.body.classList.toggle('compact', s.compact); say(st, 'Saved.'); } catch (x) { say(st, x.message, true); }
});

// ---- payments: Stripe's own checkout page, and the money goes to the boss. Prices come from office.pay.status(), never hard-coded here. ----
// Set PRODUCT to the key the manager proposed. A real paid feature checks office.pay.has(PRODUCT), and keeps its data in a collection that product unlocks.
const PRODUCT = 'pro';
let pricing = null;
const priceText = (p) => { const a = new Intl.NumberFormat(undefined, { style: 'currency', currency: p.currency.toUpperCase() }).format(p.amountCents / 100); return p.interval ? `${a} a ${p.interval}` : a; };
async function buy(product, btn, note) {
  if (!office.auth.user) { location.hash = '#/signup'; return; }
  btn.disabled = true; say(note, 'Taking you to Stripe...');
  const r = await office.pay.checkout({ product });
  if (!r.ok) { btn.disabled = false; say(note, r.message, true); }
}
async function loadPricing() {
  const box = $('[data-office="payments"]'), status = $('[data-office="pricing-status"]'), list = $('[data-office="plans"]');
  pricing = await office.pay.status();
  box.hidden = false; list.replaceChildren();
  if (!pricing.ready) return say(status, pricing.message || 'Paid plans are coming soon.');
  say(status, pricing.products.length ? (pricing.testMode ? 'Test mode: no real money moves.' : '') : 'Paid plans are coming soon.');
  for (const p of pricing.products) {
    const li = document.createElement('li'); li.className = 'plan';
    const name = document.createElement('b'); name.textContent = p.name;
    const price = document.createElement('span'); price.textContent = priceText(p);
    const about = document.createElement('p'); about.textContent = p.description || '';
    const go = document.createElement('button'); go.className = 'btn'; go.type = 'button'; go.dataset.office = 'buy'; go.textContent = 'Get it';
    const note = document.createElement('p'); note.className = 'status'; note.setAttribute('role', 'status');
    go.addEventListener('click', () => buy(p.key, go, note));
    li.append(name, price, about, go, note);
    list.append(li);
  }
}
async function loadPlan() {
  const st = $('[data-office="plan-status"]'), up = $('[data-office="upgrade"]'), man = $('[data-office="manage"]'), note = $('[data-office="plan-note"]');
  const [s, paid] = await Promise.all([pricing ? pricing : office.pay.status(), office.pay.has(PRODUCT)]);
  const p = s.products.find((x) => x.key === PRODUCT);
  st.textContent = paid ? `You have ${p?.name || 'the paid plan'}.` : s.ready && p ? `You are on the free plan. ${p.name}: ${priceText(p)}.` : 'Free. Paid plans are coming soon.';
  up.hidden = paid || !s.ready || !p; man.hidden = !paid;
  if (!s.ready && s.message) say(note, s.message);
  if (paid && returned === 'success') say(note, 'Thanks. It is yours now.');
  returned = '';
}
$('[data-office="upgrade"]').addEventListener('click', (e) => buy(PRODUCT, e.currentTarget, $('[data-office="plan-note"]')));
$('[data-office="manage"]').addEventListener('click', async (e) => { const note = $('[data-office="plan-note"]'); e.currentTarget.disabled = true; say(note, 'Taking you to Stripe...'); const r = await office.pay.manage(); if (!r.ok) { e.currentTarget.disabled = false; say(note, r.message, true); } });
let returned = new URLSearchParams(location.search).get('office_pay') || '';
if (returned) history.replaceState(null, '', location.pathname + location.hash);
if (returned === 'success') location.hash = '#/settings';
loadPricing();

addEventListener('hashchange', route);
route();
