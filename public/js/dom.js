// Small DOM and API helpers. All text goes in through textContent, so names and agent output can never become markup.
export const BASE = '/theoffice';

export function h(tag, props = {}, ...kids) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = `${el.className} ${v}`.trim();
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
    else if (k === 'css') for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
    else el.setAttribute(k, v === true ? '' : v);
  }
  add(el, kids);
  return el;
}
function add(el, kids) {
  for (const kid of kids) {
    if (kid === null || kid === undefined || kid === false) continue;
    if (Array.isArray(kid)) add(el, kid);
    else el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
}
/** Like el.append, but null and false mean nothing, as they do in h(). */
export const put = (el, ...kids) => { add(el, kids); return el; };
export const clear = (el) => { el.replaceChildren(); return el; };
export const $ = (s, root = document) => root.querySelector(s);

const session = { csrf: null, adminCsrf: null, floor: null, admin: false };
export { session };

export class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
export async function api(path, { method = 'GET', body, admin = false } = {}) {
  const headers = {};
  if (method !== 'GET') {
    headers['content-type'] = 'application/json';
    const token = admin ? session.adminCsrf : session.csrf;
    if (token) headers['x-office-csrf'] = token;
  }
  let res;
  try { res = await fetch(`${BASE}/api${path}`, { method, headers, credentials: 'same-origin', body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) }); } catch { throw new ApiError(0, 'network', 'Can\'t reach the building. Check your connection.'); }
  let data = null;
  try { data = await res.json(); } catch { /* an empty or plain body */ }
  if (!res.ok) throw new ApiError(res.status, data?.error || 'error', data?.message && data.message !== data.error ? data.message : friendly(res.status));
  return data;
}
const friendly = (s) => ({ 401: 'Please sign in first.', 403: 'That isn\'t yours to change.', 404: 'Not found.', 413: 'That is too long.', 423: 'This floor is closed.', 429: 'Too many tries. Give it a minute.' }[s] || 'Something went wrong. Try again.');
export async function refreshMe() {
  const me = await api('/me');
  session.csrf = me.csrf; session.adminCsrf = me.adminCsrf; session.floor = me.floor; session.admin = me.admin; session.aiMode = me.aiMode;
  return me;
}

export function toast(text, kind = '') {
  const el = h(`div.toast${kind ? `.${kind}` : ''}`, {}, text);
  $('#toasts').append(el);
  setTimeout(() => { el.classList.add('gone'); setTimeout(() => el.remove(), 400); }, 3800);
}

/** Modal dialog. Returns { el, close }. Escape and backdrop clicks close it. */
export function modal(title, build, { wide = false, onClose, locked = false } = {}) {
  const prev = document.activeElement;
  const card = h(`div.modal${wide ? '.wide' : ''}`, { role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  const back = h('div.modal-back', {}, card);
  let closed = false;
  const close = (v) => {
    if (closed) return; closed = true;
    document.removeEventListener('keydown', onKey);
    back.remove(); onClose?.(v); prev?.focus?.();
  };
  const onKey = (e) => { if (e.key === 'Escape' && !locked) close(); };
  document.addEventListener('keydown', onKey);
  if (!locked) back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
  card.append(h('header.modal-head', {}, h('h2', {}, title), !locked && h('button.icon-btn', { type: 'button', 'aria-label': 'Close', onclick: () => close() }, '×')));
  const body = h('div.modal-body');
  card.append(body);
  build(body, close);
  document.body.append(back);
  (body.querySelector('[autofocus]') || body.querySelector('input,textarea,button'))?.focus?.();
  return { el: card, close };
}

export const money = (n) => `$${Number(n || 0).toFixed(n >= 10 ? 2 : n >= 0.1 ? 2 : 3)}`;
export function timeAgo(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 50) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
export const isPhone = () => window.matchMedia('(max-width: 760px)').matches;
