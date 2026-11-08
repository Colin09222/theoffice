// The check right after Launch. The Tester can only reach Office Cloud on the live origin, so the server itself goes to the live link and uses
// it the way a player's browser would: the page, the Office library, a save written and read back, a score posted to a board nobody sees.
// A real failure comes back as { ok: false, problem } and goes to the team as a major bug. If the link can't be reached at all, that's
// { ok: null, why }: not something the team could fix. Nothing here spends model tokens, and every request has its own time limit.
import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

const TIMEOUT_MS = 12000;
const SAVE_KEY = '_office_check', BOARD = '_office-check';

/** One request to the live origin, the way a browser sends it: same-origin, with the Origin header Office Cloud checks. *.localhost resolves to this machine. */
function send(method, url, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lookup = u.hostname.endsWith('.localhost') ? (h, opts, cb) => (opts.all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4)) : undefined;
    const req = (u.protocol === 'https:' ? httpsRequest : httpRequest)(u, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, lookup, timeout: TIMEOUT_MS }, (res) => {
      const chunks = []; let size = 0;
      res.on('data', (c) => { size += c.length; if (size <= 2 * 1024 * 1024) chunks.push(c); });
      res.on('end', () => resolve({ status: res.statusCode, type: String(res.headers['content-type'] || ''), text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}
const parse = (t) => { try { return JSON.parse(t); } catch { return null; } };

/**
 * type: 'game', 'app' or 'website'. files: the shipped files, so a game that never calls saves or the leaderboard is caught too.
 * Never throws. Network trouble is retried a few times (a brand-new name is waiting for its certificate) before it counts as "couldn't check".
 */
export async function checkLive({ url, type, files = [], tries = 5, waitMs = 4000 }) {
  let origin;
  try { origin = new URL(url).origin; } catch { return { ok: null, why: 'no live address yet' }; }
  const fail = (problem) => ({ ok: false, problem });
  let lastErr = '';
  for (let i = 0; i < tries; i++) {
    if (i) await new Promise((r) => setTimeout(r, waitMs));
    let page;
    try { page = await send('GET', `${origin}/`); } catch (e) { lastErr = e.message; continue; }
    if (page.status !== 200 || !/html/i.test(page.type)) return fail(`the live page answered ${page.status} instead of the site`);
    if (type === 'website') return { ok: true, checked: ['page'] };
    let lib, ping;
    try { lib = await send('GET', `${origin}/_office/office.js`); ping = await send('GET', `${origin}/_office/cloud/ping`); } catch (e) { lastErr = e.message; continue; }
    if (lib.status !== 200) return fail(`/_office/office.js answered ${lib.status} on the live link, so the page can't reach Office Cloud`);
    if (ping.status !== 200) return fail(`Office Cloud answered ${ping.status} on the live link`);
    const player = randomBytes(24).toString('base64url');
    const headers = { origin, 'x-office-player': player };
    try {
      const marker = randomBytes(6).toString('hex');
      const put = await send('PUT', `${origin}/_office/cloud/saves/${SAVE_KEY}`, { headers, body: { value: { marker } } });
      if (put.status !== 200) return fail(`saving progress failed on the live link (${put.status})`);
      const got = await send('GET', `${origin}/_office/cloud/saves/${SAVE_KEY}`, { headers });
      if (got.status !== 200 || parse(got.text)?.value?.marker !== marker) return fail('a save written on the live link did not come back');
      await send('DELETE', `${origin}/_office/cloud/saves/${SAVE_KEY}`, { headers });
      if (type === 'game') {
        const post = await send('POST', `${origin}/_office/cloud/boards/${BOARD}`, { headers, body: { score: 1, name: 'Office check' } });
        if (post.status !== 200) return fail(`posting a score failed on the live link (${post.status})`);
        const top = await send('GET', `${origin}/_office/cloud/boards/${BOARD}?limit=5`, { headers });
        const entries = parse(top.text)?.entries;
        if (top.status !== 200 || !Array.isArray(entries) || !entries.some((e) => e.score === 1)) return fail('a score posted on the live link did not reach the leaderboard');
      }
    } catch (e) { lastErr = e.message; continue; }
    if (type === 'game') {
      const code = files.filter((f) => /\.(m?js|html?)$/i.test(f.path)).map((f) => String(f.data ?? f.content ?? '')).join('\n');
      if (!/saves\s*\.\s*(set|get)/.test(code)) return fail('the shipped game never saves through Office Cloud');
      if (!/leaderboard\s*\.\s*(submit|top)/.test(code)) return fail('the shipped game never posts to the leaderboard');
    }
    return { ok: true, checked: type === 'game' ? ['page', 'saves', 'leaderboard'] : ['page', 'saves'] };
  }
  return { ok: null, why: `the live link couldn't be reached (${String(lastErr).slice(0, 120)})` };
}
