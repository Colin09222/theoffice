// A stand-in for Resend that speaks its REST API over real HTTP on 127.0.0.1, so tests run the real provider code end to end and nothing ever
// reaches resend.com. It keeps what was sent, serves received emails and their attachments the way the receiving API does, signs webhooks
// the Svix way, and can be told to fail. Shapes follow resend.com/docs as of 2026-11.
import http from 'node:http';
import { randomUUID, randomBytes } from 'node:crypto';
import { signSvix } from './mail-provider.js';

export async function startMockResend({ apiKey = 're_mock_key', webhookSecret = `whsec_${randomBytes(24).toString('base64')}` } = {}) {
  const state = { sent: [], received: new Map(), files: new Map(), domains: [], webhooks: [], requests: [], cdnAuth: 0, failures: [], idem: new Map() };
  let base = '';
  const reply = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;
    state.requests.push({ method: req.method, path, auth: req.headers.authorization === `Bearer ${apiKey}`, ua: req.headers['user-agent'] || '', idem: req.headers['idempotency-key'] || '', query: url.search });
    // The CDN: signed links, no key. Seeing the key here would mean it leaked.
    const cdn = path.match(/^\/cdn\/([^/]+)\/([^/]+)$/);
    if (cdn && req.method === 'GET') {
      if (req.headers.authorization) state.cdnAuth++;
      const f = state.files.get(`${cdn[1]}/${cdn[2]}`);
      if (!f || url.searchParams.get('signature') !== f.sig) return reply(res, 403, { message: 'bad signature' });
      res.writeHead(200, { 'content-type': f.content_type, 'content-length': String(f.bytes.length) }); return res.end(f.bytes);
    }
    if (req.headers.authorization !== `Bearer ${apiKey}`) return reply(res, 401, { statusCode: 401, name: 'missing_api_key', message: 'Missing API key in the authorization header.' });
    const fail = state.failures.findIndex((x) => path.startsWith(x.prefix));
    if (fail >= 0) { const f = state.failures[fail]; if (--f.times <= 0) state.failures.splice(fail, 1); return reply(res, f.status, { statusCode: f.status, name: 'mock_failure', message: 'Mock failure.' }); }
    let body = null;
    if (raw) { try { body = JSON.parse(raw); } catch { return reply(res, 400, { statusCode: 400, name: 'invalid_json', message: 'Invalid JSON.' }); } }
    if (req.method === 'POST' && path === '/emails') {
      const key = req.headers['idempotency-key'];
      if (key && state.idem.has(key)) return reply(res, 200, { id: state.idem.get(key) });
      const list = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
      if (!body?.from || !body?.subject || !list(body.to).length) return reply(res, 422, { statusCode: 422, name: 'validation_error', message: 'Missing `to`, `from` or `subject` field.' });
      if (list(body.to).length > 50) return reply(res, 422, { statusCode: 422, name: 'validation_error', message: 'Too many recipients.' });
      const id = randomUUID();
      state.sent.push({ id, ...body });
      if (key) state.idem.set(key, id);
      return reply(res, 200, { id });
    }
    const got = path.match(/^\/emails\/receiving\/([^/]+)$/);
    if (got && req.method === 'GET') {
      const e = state.received.get(got[1]);
      if (!e) return reply(res, 404, { statusCode: 404, name: 'not_found', message: 'Email not found' });
      const { attachmentBytes: _b, ...pub } = e;
      return reply(res, 200, { object: 'email', ...pub, html_format: url.searchParams.get('html_format') === 'cid' ? 'cid' : 'data_uri' });
    }
    const atts = path.match(/^\/emails\/receiving\/([^/]+)\/attachments$/);
    if (atts && req.method === 'GET') {
      const e = state.received.get(atts[1]);
      if (!e) return reply(res, 404, { statusCode: 404, name: 'not_found', message: 'Email not found' });
      const expires = new Date(Date.now() + 3600e3).toISOString();
      return reply(res, 200, { object: 'list', has_more: false, data: e.attachments.map((a) => ({ ...a, download_url: `${base}/cdn/${e.id}/${a.id}?signature=${state.files.get(`${e.id}/${a.id}`).sig}`, expires_at: expires })) });
    }
    if (path === '/domains' && req.method === 'GET') return reply(res, 200, { object: 'list', has_more: false, data: state.domains.map(({ records: _r, ...d }) => d) });
    if (path === '/domains' && req.method === 'POST') {
      if (!body?.name) return reply(res, 422, { statusCode: 422, name: 'validation_error', message: 'Missing `name` field.' });
      const caps = { sending: body.capabilities?.sending || 'enabled', receiving: body.capabilities?.receiving || 'disabled' };
      const d = { id: randomUUID(), name: body.name, status: 'not_started', created_at: new Date().toISOString(), region: body.region || 'us-east-1', open_tracking: body.open_tracking ?? true, click_tracking: body.click_tracking ?? false, capabilities: caps };
      d.records = mockRecords(d);
      state.domains.push(d);
      return reply(res, 200, d);
    }
    const dom = path.match(/^\/domains\/([^/]+)(\/verify)?$/);
    if (dom) {
      const d = state.domains.find((x) => x.id === dom[1]);
      if (!d) return reply(res, 404, { statusCode: 404, name: 'not_found', message: 'Domain not found' });
      if (dom[2] && req.method === 'POST') return reply(res, 200, { object: 'domain', id: d.id });
      if (req.method === 'GET') return reply(res, 200, { object: 'domain', ...d, records: mockRecords(d) });
      if (req.method === 'PATCH') { if (body?.capabilities) Object.assign(d.capabilities, body.capabilities); for (const k of ['open_tracking', 'click_tracking']) if (k in (body || {})) d[k] = body[k]; return reply(res, 200, { object: 'domain', id: d.id }); }
    }
    if (path === '/webhooks' && req.method === 'GET') return reply(res, 200, { object: 'list', has_more: false, data: state.webhooks.map((w) => ({ ...w })) });
    if (path === '/webhooks' && req.method === 'POST') {
      if (!body?.endpoint || !Array.isArray(body.events) || !body.events.length) return reply(res, 422, { statusCode: 422, name: 'validation_error', message: 'Missing `endpoint` or `events` field.' });
      const w = { id: randomUUID(), created_at: new Date().toISOString(), status: 'enabled', endpoint: body.endpoint, events: body.events, signing_secret: webhookSecret };
      state.webhooks.push(w);
      return reply(res, 200, { object: 'webhook', id: w.id, signing_secret: w.signing_secret });
    }
    const wh = path.match(/^\/webhooks\/([^/]+)$/);
    if (wh) {
      const w = state.webhooks.find((x) => x.id === wh[1]);
      if (!w) return reply(res, 404, { statusCode: 404, name: 'not_found', message: 'Webhook not found' });
      if (req.method === 'GET') return reply(res, 200, { object: 'webhook', ...w });
      if (req.method === 'PATCH') { for (const k of ['endpoint', 'events', 'status']) if (body && k in body) w[k] = body[k]; return reply(res, 200, { object: 'webhook', id: w.id }); }
    }
    return reply(res, 404, { statusCode: 404, name: 'not_found', message: 'Not found' });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;

  /** An email arriving at Resend: stored for the receiving API, and the email.received event that announces it, metadata only. */
  function receive({ from = 'Sam Customer <sam@example.com>', to = [], cc = [], bcc = [], subject = 'Hello', text = 'Hi there', html = null, headers = {}, replyTo = [], messageId, authentication = { spf: 'pass', dkim: 'pass', dmarc: 'pass' }, attachments = [], receivedFor = [] } = {}) {
    const id = randomUUID();
    const mid = messageId || `<${randomUUID()}@mail.example.com>`;
    const atts = attachments.map((a) => {
      const att = { id: randomUUID(), filename: a.filename, content_type: a.contentType || 'application/octet-stream', content_disposition: a.inline ? 'inline' : 'attachment', content_id: a.contentId || null, size: a.bytes.length };
      state.files.set(`${id}/${att.id}`, { bytes: Buffer.from(a.bytes), content_type: att.content_type, sig: randomBytes(8).toString('hex') });
      return att;
    });
    const created = new Date().toISOString();
    state.received.set(id, { id, to, from, created_at: created, subject, html, text, headers: { from, ...headers }, bcc, cc, reply_to: replyTo, received_for: receivedFor, authentication, message_id: mid, raw: null, attachments: atts });
    const event = { type: 'email.received', created_at: created, data: { email_id: id, created_at: created, from, to, bcc, cc, received_for: receivedFor, message_id: mid, subject, attachments: atts.map(({ size: _s, ...a }) => a) } };
    return { id, event };
  }
  /** Posts an event to an endpoint the way Resend's webhooks do: raw JSON body, svix-id, svix-timestamp and svix-signature. */
  async function deliver(endpoint, event, { secret = webhookSecret, id = `msg_${randomBytes(12).toString('hex')}`, timestamp = Math.floor(Date.now() / 1000), signature } = {}) {
    const body = JSON.stringify(event);
    const sig = signature ?? signSvix({ secret, id, timestamp: String(timestamp), body });
    const res = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'svix-id': id, 'svix-timestamp': String(timestamp), 'svix-signature': sig, 'user-agent': 'Svix-Webhooks/1.0' }, body });
    return { status: res.status, body: await res.text(), id };
  }
  const outcome = (type, sent, extra = {}) => ({ type, created_at: new Date().toISOString(), data: { created_at: new Date().toISOString(), email_id: sent.id, from: sent.from, to: Array.isArray(sent.to) ? sent.to : [sent.to], subject: sent.subject, tags: Object.fromEntries((sent.tags || []).map((t) => [t.name, t.value])), ...extra } });
  return {
    base, apiKey, webhookSecret, state,
    receive, deliver,
    bounced: (sent, type = 'Permanent') => outcome('email.bounced', sent, { bounce: { message: 'The recipient address does not exist.', subType: type === 'Permanent' ? 'General' : 'MailboxFull', type } }),
    complained: (sent) => outcome('email.complained', sent),
    failNext(prefix, status = 500, times = 1) { state.failures.push({ prefix, status, times }); },
    close: () => new Promise((r) => server.close(r)),
  };
}

function mockRecords(d) {
  const recs = [
    { record: 'DKIM', name: 'resend._domainkey', type: 'TXT', ttl: 'Auto', status: 'not_started', value: 'p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDmock' },
    { record: 'SPF', name: 'send', type: 'MX', ttl: 'Auto', status: 'not_started', value: `feedback-smtp.${d.region}.amazonses.com`, priority: 10 },
    { record: 'SPF', name: 'send', type: 'TXT', ttl: 'Auto', status: 'not_started', value: 'v=spf1 include:amazonses.com ~all' },
  ];
  if (d.capabilities.receiving === 'enabled') recs.push({ record: 'Receiving', name: '@', type: 'MX', ttl: 'Auto', status: 'not_started', value: `inbound-smtp.${d.region}.amazonaws.com`, priority: 10 });
  return recs;
}
