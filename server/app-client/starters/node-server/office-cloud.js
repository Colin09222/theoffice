// Office Cloud from server code: the same accounts, data, AI and web reading the pages have, under the same limits, for this project only.
const base = (process.env.OFFICE_CLOUD_URL || '').replace(/\/+$/, '');
const token = process.env.OFFICE_TOKEN || '';

async function call(method, path, body, headers = {}) {
  if (!base || !token) throw new Error('No Office token here: this only works once deployed.');
  const res = await fetch(`${base}/${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || `Office Cloud answered ${res.status}`), { code: data.error, status: res.status });
  return data;
}
const seg = (s) => encodeURIComponent(String(s));
export const office = {
  ai: { chat: (options) => call('POST', 'ai/chat', options).then((r) => r.text) },
  fetch: (url) => call('POST', 'fetch', { url }),
  scrape: (url) => call('POST', 'scrape', { url }),
  db: {
    collection: (name) => ({
      list: (q = {}) => call('GET', `db/${seg(name)}?${new URLSearchParams(q)}`),
      get: (id) => call('GET', `db/${seg(name)}/${seg(id)}`),
      add: (data, opts = {}) => call('POST', `db/${seg(name)}`, { data, ...opts }),
      set: (id, data) => call('PUT', `db/${seg(name)}/${seg(id)}`, { data }),
      remove: (id) => call('DELETE', `db/${seg(name)}/${seg(id)}`),
    }),
  },
  /** Who a visitor's Office Cloud session belongs to, or null. */
  asVisitor: (session) => call('GET', 'auth/me', undefined, { 'x-office-session': String(session) }).then((r) => r.user, () => null),
};
