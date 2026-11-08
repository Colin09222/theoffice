// office.fetch and office.scrape: public web pages for a published project, fetched by the server through safefetch. See docs/OFFICE-CLOUD.md.
// It says who it is, asks each site's robots.txt, leaves a gap between visits to one site (across the whole building), and remembers a page for a few minutes.
// What comes back is only ever text, and a page's own words go nowhere but the project that asked for them.
import { all } from '../db.js';
import { safeFetch, checkUrl, FetchBlocked } from '../safefetch.js';
import { CloudError } from './store.js';
import { parseRobots, robotsAllows } from './robots.js';
import { scrapeHtml } from './scrape.js';

export const USER_AGENT = 'TheOfficeBot/1.0 (+https://iscolinfree.com/theoffice/; fetching a public page for a site built at The Office)';
// HTML, JSON, XML and plain text, and nothing else: no scripts, no images, no files.
const READABLE = /^(text\/(html|plain|xml)|application\/(json|xml|xhtml\+xml|rss\+xml|atom\+xml|ld\+json|[a-z0-9.-]+\+(json|xml)))$/i;
const HTML = /html/i;
const OFF = () => new CloudError(403, 'fetch_off', 'Fetching web pages isn\'t switched on for this site right now.');
const NO_ALLOWANCE = () => new CloudError(429, 'fetch_limit', 'This site has fetched all the pages it can for today. It comes back tomorrow.');
const HOST_BUSY = () => new CloudError(429, 'host_busy', 'That site needs a moment between visits. Try again shortly.');
const ROBOTS = () => new CloudError(403, 'robots_denied', 'That site\'s robots.txt asks not to have this page read.');
const BLOCKED = () => new CloudError(403, 'fetch_blocked', 'That address can\'t be fetched from here.');
const UNREACHABLE = () => new CloudError(502, 'fetch_failed', 'That site didn\'t answer. Try again in a bit.');
const BAD_URL = () => new CloudError(400, 'bad_url', 'Give a full web address, starting with http:// or https://.');
const NOT_TEXT = () => new CloudError(415, 'fetch_type', 'That isn\'t a page of text. Only HTML, JSON, XML and plain text can be fetched.');
const TIMED_OUT = () => new CloudError(504, 'fetch_timeout', 'That site took too long to answer.');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** What each refusal looks like to a visitor. Every private or forbidden address gets the same words, so the answer can't be used to map what is behind the building. */
function friendly(e) {
  if (e instanceof CloudError) return e;
  if (e instanceof FetchBlocked) {
    if (/timed out/.test(e.message)) return TIMED_OUT();
    if (/non-text/.test(e.message)) return NOT_TEXT();
    if (/compressed|too many redirects/.test(e.message)) return UNREACHABLE();
    return BLOCKED();
  }
  return UNREACHABLE();
}

export function createWebFetcher({ db, cfg, powers, gate, net = {}, now = Date.now, log = () => {} }) {
  const L = powers.WEB;
  const cache = new Map();      // url -> {url, status, type, body, truncated, expires, size}, oldest first
  const robots = new Map();     // origin -> {rules, delay, unreachable, expires}, oldest first
  const robotsPending = new Map();
  const pending = new Map();    // url -> the fetch already running for it
  const slots = new Map();      // host -> when its next visit may start
  const running = new Map();    // project -> pages being fetched now
  let cachedBytes = 0;

  function denyHosts() {
    const d = [...(cfg.fetchDenyHosts || [])];
    if (cfg.publicOrigin) { try { d.push(new URL(cfg.publicOrigin).hostname.toLowerCase()); } catch { /* unset */ } }
    if (cfg.appsBaseDomain) d.push(cfg.appsBaseDomain.split(':')[0]);
    // A bought domain is a project origin too, and gets the same distance.
    for (const r of all(db, "SELECT domain FROM domain_orders WHERE status='live'")) d.push(r.domain);
    return d;
  }
  /** The page's address, checked before anything is spent on it. The checks are repeated by safeFetch on every hop. */
  function parseUrl(raw) {
    if (typeof raw !== 'string' || !raw || raw.length > L.urlChars) throw BAD_URL();
    let u;
    if (net.allowAnyPort) { try { u = new URL(raw); } catch { throw BAD_URL(); } if (u.protocol !== 'http:' && u.protocol !== 'https:') throw BAD_URL(); } else {
      try { u = checkUrl(raw, { denyHosts: denyHosts() }).url; } catch (e) { throw (e instanceof FetchBlocked && /not a valid|only http|credentials/.test(e.message) ? BAD_URL() : BLOCKED()); }
    }
    u.hash = '';
    return u;
  }

  // ---- robots.txt ----
  const originOf = (u) => `${u.protocol}//${u.host}`;
  function remember(map, key, value, cap) {
    map.delete(key); map.set(key, value);
    if (map.size > cap) map.delete(map.keys().next().value);
  }
  async function loadRobots(origin) {
    let entry;
    try {
      const r = await safeFetch(`${origin}/robots.txt`, { ...net, denyHosts: denyHosts(), maxBytes: L.robotsMaxBytes, timeoutMs: L.robotsTimeoutMs, maxRedirects: L.maxRedirects, userAgent: USER_AGENT, keepHtml: true });
      if (r.status >= 200 && r.status < 300) entry = { ...parseRobots(r.text), expires: now() + L.robotsTtlMs };
      else if (r.status >= 400 && r.status < 500) entry = { rules: [], delay: null, expires: now() + L.robotsTtlMs };  // no robots.txt: anything goes
      else entry = { unreachable: true, expires: now() + L.robotsRetryMs };
    } catch (e) {
      // A robots.txt that isn't text says nothing. Any other failure leaves the site's wishes unknown, and RFC 9309 says to assume no.
      if (e instanceof FetchBlocked && /non-text/.test(e.message)) entry = { rules: [], delay: null, expires: now() + L.robotsTtlMs };
      else entry = { unreachable: true, expires: now() + L.robotsRetryMs };
    }
    remember(robots, origin, entry, L.robotsHosts);
    return entry;
  }
  function robotsFor(origin) {
    const hit = robots.get(origin);
    if (hit && hit.expires > now()) return hit;
    let p = robotsPending.get(origin);
    if (!p) { p = loadRobots(origin).finally(() => robotsPending.delete(origin)); robotsPending.set(origin, p); }
    return p;
  }

  // ---- one visit to a site at a time ----
  /** Claims the next visit to this host. Returns how long to wait for it, or says the site is too busy to wait for. */
  function takeSlot(host, gapMs) {
    const t = now(), free = Math.max(t, slots.get(host) || 0);
    if (free - t > L.maxWaitMs) throw HOST_BUSY();
    slots.set(host, free + gapMs);
    if (slots.size > 5000) for (const [h, at] of slots) if (at <= t) slots.delete(h);
    return free - t;
  }

  /** Fetches a page for real: robots.txt and a polite gap before every hop, redirects included. */
  async function fetchNow(u, F, p) {
    let visited = false;
    try {
      const r = await safeFetch(u.href, {
        ...net, denyHosts: denyHosts(), maxBytes: L.maxBytes, timeoutMs: L.timeoutMs, maxRedirects: L.maxRedirects, userAgent: USER_AGENT, keepHtml: true, types: READABLE,
        beforeHop: async (url) => {
          const rules = await robotsFor(originOf(url));
          if (rules.unreachable) throw UNREACHABLE();
          if (!robotsAllows(rules, url.pathname + url.search)) throw ROBOTS();
          const wait = takeSlot(url.hostname, Math.max(L.hostDelayMs, Math.min((rules.delay || 0) * 1000, L.maxDelayMs)));
          visited = true;
          if (wait > 0) await sleep(wait);
        },
      });
      const entry = { url: r.url, status: r.status, type: r.type, body: r.text, truncated: r.truncated, size: r.text.length };
      // A server error is short-lived, and it's worth asking again.
      if (r.status < 500 && L.cacheTtlMs > 0 && entry.size <= L.maxBytes) {
        entry.expires = now() + L.cacheTtlMs;
        const old = cache.get(u.href); if (old) cachedBytes -= old.size;
        remember(cache, u.href, entry, Infinity);
        cachedBytes += entry.size;
        while (cachedBytes > L.cacheBytes && cache.size) { const k = cache.keys().next().value; cachedBytes -= cache.get(k).size; cache.delete(k); }
      }
      return entry;
    } finally {
      // A visit counts once it was really made, whatever came of it. A page turned away by robots.txt or by the safety checks never left the building.
      if (visited) powers.add(F, p, { fetches: 1 });
    }
  }
  function fromCache(key) {
    const e = cache.get(key);
    if (!e) return null;
    if (e.expires <= now()) { cache.delete(key); cachedBytes -= e.size; return null; }
    remember(cache, key, e, Infinity);
    return e;
  }

  async function page({ F, p, pk, url: raw }) {
    if (powers.blocked('fetch', F, p)) throw OFF();
    const u = parseUrl(raw);
    const hit = fromCache(u.href);
    if (hit) return { page: hit, cached: true };
    // Already being fetched for somebody: wait for that one rather than visiting twice. Waiting costs this project nothing.
    const joining = pending.get(u.href);
    if (joining) return { page: await joining, cached: true };
    if (powers.counts(F, p).fetches + (running.get(pk) || 0) >= L.dayProject) throw NO_ALLOWANCE();
    running.set(pk, (running.get(pk) || 0) + 1);
    const work = gate(() => fetchNow(u, F, p));
    pending.set(u.href, work);
    try { return { page: await work, cached: false }; } finally {
      pending.delete(u.href);
      const n = running.get(pk) - 1; if (n > 0) running.set(pk, n); else running.delete(pk);
    }
  }
  const safely = (fn) => async (args) => { try { return await fn(args); } catch (e) { const out = friendly(e); if (out.status >= 500) log('warn', 'office web fetch failed', { code: out.code }); throw out; } };

  /** office.fetch: {url, status, type, text, truncated, cached}. */
  const fetchPage = safely(async (args) => {
    const { page: r, cached } = await page(args);
    return { url: r.url, status: r.status, type: r.type, text: r.body, truncated: r.truncated, cached };
  });
  /** office.scrape: the text, title, meta tags and links of a page. */
  const scrape = safely(async (args) => {
    const { page: r, cached } = await page(args);
    const parsed = HTML.test(r.type) ? scrapeHtml(r.body, r.url, L) : { title: '', description: '', meta: {}, links: [], text: r.body.slice(0, L.textChars), truncated: r.body.length > L.textChars };
    return { url: r.url, status: r.status, type: r.type, ...parsed, truncated: r.truncated || parsed.truncated, cached };
  });
  return { fetch: fetchPage, scrape };
}
