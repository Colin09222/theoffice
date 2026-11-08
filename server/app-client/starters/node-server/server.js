// Change this to do the real job. It must listen on PORT and keep answering /health.
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { office } from './office-cloud.js';

const DATA = process.env.OFFICE_DATA_DIR || '/data';
const ALLOWED = (process.env.OFFICE_SITE_ORIGINS || '').split(',').filter(Boolean);
const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
async function readBody(req) {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 64 * 1024) throw new Error('too big'); }
  return raw ? JSON.parse(raw) : {};
}
const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  // Only this project's own pages get an answer in a browser. It's listed in OFFICE_SITE_ORIGINS, whichever address they are on.
  if (origin && ALLOWED.includes(origin)) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'Origin');
    res.setHeader('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type, authorization');
    res.setHeader('access-control-max-age', '600');
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const { pathname } = new URL(req.url, 'http://x');
  try {
    if (pathname === '/health') return send(res, 200, { ok: true });
    if (pathname === '/api/latest' && req.method === 'GET') {
      const latest = await readFile(`${DATA}/latest.json`, 'utf8').catch(() => 'null');
      return send(res, 200, { latest: JSON.parse(latest) });
    }
    if (pathname === '/api/notes' && req.method === 'POST') {
      const body = await readBody(req);
      const note = String(body.text ?? '').slice(0, 2000);
      if (!note) return send(res, 400, { error: 'text is required' });
      const summary = await office.ai.chat({ prompt: `One short line summing up: ${note}`, maxTokens: 60 }).catch(() => '');
      await writeFile(`${DATA}/latest.json`, JSON.stringify({ note, summary, at: new Date().toISOString() }));
      return send(res, 201, { note, summary });
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error('request failed:', e.message);
    return send(res, 500, { error: 'something went wrong' });
  }
});
server.listen(Number(process.env.PORT || 8080), () => console.log('listening'));
