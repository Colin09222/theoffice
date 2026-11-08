// Resend, the building's email provider: sending through its REST API and receiving on MAIL_DOMAIN, built to resend.com/docs
// (POST /emails, GET /emails/receiving/:id, GET /emails/receiving/:id/attachments, /domains and /webhooks).
// The key goes in one header to the API and nowhere else: not in a log, an error, or a download from Resend's CDN.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const RESEND_API = 'https://api.resend.com';
export class MailProviderError extends Error {
  constructor(message, { status = 0, retryable = false } = {}) { super(message); this.status = status; this.retryable = retryable; }
}

/** Svix-style webhook check, as Resend signs them: HMAC-SHA256 over "id.timestamp.body" keyed with the base64 after whsec_. Any v1 entry may match. */
export function verifySvix({ secret, id, timestamp, signature, body, now = Date.now(), toleranceSec = 300 }) {
  if (!secret || !id || !timestamp || !signature) return { ok: false, reason: 'missing_headers' };
  if (!/^\d{1,12}$/.test(String(timestamp))) return { ok: false, reason: 'bad_timestamp' };
  if (Math.abs(now / 1000 - Number(timestamp)) > toleranceSec) return { ok: false, reason: 'stale_timestamp' };
  const key = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64');
  if (!key.length) return { ok: false, reason: 'bad_secret' };
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.`).update(body).digest();
  for (const part of String(signature).split(' ')) {
    const [version, sig] = part.split(',');
    if (version !== 'v1' || !sig) continue;
    const got = Buffer.from(sig, 'base64');
    if (got.length === expected.length && timingSafeEqual(got, expected)) return { ok: true };
  }
  return { ok: false, reason: 'bad_signature' };
}
/** The other side of verifySvix, for the mock provider and the tests. */
export function signSvix({ secret, id, timestamp, body }) {
  const key = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64');
  return `v1,${createHmac('sha256', key).update(`${id}.${timestamp}.`).update(body).digest('base64')}`;
}

/** A download link from Resend's CDN is only fetched from Resend (or the API base itself, which is the mock in tests), never with the key. */
export function downloadAllowed(url, base = RESEND_API) {
  let u, b;
  try { u = new URL(url); b = new URL(base); } catch { return false; }
  if (u.username || u.password) return false;
  if (u.origin === b.origin) return true;
  return u.protocol === 'https:' && (u.hostname === 'resend.com' || u.hostname.endsWith('.resend.com'));
}

export function createResend({ apiKey, base = RESEND_API, fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  const hide = (s) => (apiKey ? String(s).split(apiKey).join('[redacted]') : String(s));
  async function call(method, path, body, { idempotencyKey } = {}) {
    const headers = { authorization: `Bearer ${apiKey}`, 'user-agent': 'theoffice-mail/1.0', accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
    let res;
    try {
      res = await fetchImpl(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    } catch { throw new MailProviderError('The email provider could not be reached.', { retryable: true }); }
    const text = await res.text().catch(() => '');
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (!res.ok) {
      const why = hide(json?.message || json?.name || 'no detail').replace(/[\u0000-\u001f]+/g, ' ').slice(0, 200);
      throw new MailProviderError(`The email provider said ${res.status}: ${why}`, { status: res.status, retryable: res.status === 429 || res.status >= 500 });
    }
    return json;
  }
  const id = (v) => encodeURIComponent(String(v));
  return {
    name: 'resend',
    send: (message, { idempotencyKey } = {}) => call('POST', '/emails', message, { idempotencyKey }),
    // cid keeps inline pictures as references to the attachments instead of inlining them as data: URIs.
    getReceived: (emailId) => call('GET', `/emails/receiving/${id(emailId)}?html_format=cid`),
    listReceivedAttachments: (emailId) => call('GET', `/emails/receiving/${id(emailId)}/attachments?limit=20`),
    async download(url, maxBytes) {
      if (!downloadAllowed(url, base)) throw new MailProviderError('That attachment link is not from the email provider.');
      let res;
      try { res = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'theoffice-mail/1.0' } }); } catch { throw new MailProviderError('The attachment could not be downloaded.', { retryable: true }); }
      if (!res.ok) throw new MailProviderError(`The attachment download said ${res.status}.`, { status: res.status, retryable: res.status >= 500 });
      if (Number(res.headers.get('content-length') || 0) > maxBytes) throw new MailProviderError('too_big');
      const chunks = []; let size = 0;
      for await (const c of res.body) {
        size += c.length;
        if (size > maxBytes) throw new MailProviderError('too_big');
        chunks.push(c);
      }
      return Buffer.concat(chunks.map((c) => Buffer.from(c)));
    },
    listDomains: () => call('GET', '/domains'),
    createDomain: (body) => call('POST', '/domains', body),
    getDomain: (domainId) => call('GET', `/domains/${id(domainId)}`),
    updateDomain: (domainId, body) => call('PATCH', `/domains/${id(domainId)}`, body),
    verifyDomain: (domainId) => call('POST', `/domains/${id(domainId)}/verify`),
    listWebhooks: () => call('GET', '/webhooks'),
    createWebhook: (body) => call('POST', '/webhooks', body),
    getWebhook: (webhookId) => call('GET', `/webhooks/${id(webhookId)}`),
    updateWebhook: (webhookId, body) => call('PATCH', `/webhooks/${id(webhookId)}`, body),
  };
}
