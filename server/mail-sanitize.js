// What an email from outside may look like once it is in the building. The HTML is cut down to an allowlist of tags and attributes, and the
// page that shows it adds a CSP sandbox on top, so this is the first of two walls, not the only one. Plain helpers for addresses and headers too.

const KEEP = new Set(['a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'center', 'code', 'col', 'colgroup', 'dd', 'del', 'div', 'dl', 'dt', 'em', 'font',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins', 'li', 'ol', 'p', 'pre', 'q', 's', 'small', 'span', 'strike', 'strong', 'sub', 'sup',
  'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul', 'style']);
// Dropped with everything inside them.
const DROP = new Set(['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'noscript', 'template', 'svg', 'math', 'textarea', 'select', 'button', 'head', 'title', 'xml', 'audio', 'video', 'canvas', 'noembed', 'noframes', 'plaintext', 'xmp', 'portal']);
const VOID = new Set(['br', 'hr', 'img', 'col']);
const ATTRS = new Set(['href', 'src', 'alt', 'title', 'width', 'height', 'style', 'align', 'valign', 'bgcolor', 'color', 'border', 'cellpadding', 'cellspacing', 'colspan', 'rowspan', 'dir', 'lang', 'face', 'size', 'start', 'type']);

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', bull: '•', middot: '·', zwnj: '', zwj: '', shy: '' };
export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});?/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 && !(n >= 0xd800 && n < 0xe000) ? String.fromCodePoint(n) : ''; }
    const v = ENTITIES[e.toLowerCase()]; return v === undefined ? m : v;
  });
}
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** CSS with nothing that fetches or runs: no url(), @import, expression(), behaviours or bindings. */
export function cleanCss(css) {
  let s = decodeEntities(String(css)).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\\/g, '');
  if (/expression\s*\(|javascript:|vbscript:|-moz-binding|behavior\s*:|@import|@font-face|@charset|@namespace/i.test(s)) s = s.replace(/expression\s*\(|javascript:|vbscript:|-moz-binding|behavior\s*:|@import[^;]*;?|@font-face\s*\{[^}]*\}|@charset[^;]*;?|@namespace[^;]*;?/gi, '');
  return s.replace(/url\s*\(\s*(['"]?)(?!data:image\/(?:png|gif|jpe?g|webp);base64,)[^)]*\)/gi, 'none').replace(/[<>]/g, '');
}
function cleanUrl(v, tag) {
  const u = decodeEntities(v).replace(/[\u0000- \u007f]+/g, '');
  if (tag === 'a') return /^(https?:|mailto:)/i.test(u) ? u : null;
  if (/^https?:/i.test(u)) return u;  // shown only when the boss asks: the frame's CSP blocks remote pictures until then
  if (/^cid:/i.test(u)) return u;
  if (/^data:image\/(png|gif|jpe?g|webp);base64,[a-z0-9+/=\s]+$/i.test(u) && u.length < 400000) return u;
  return null;
}

/** Allowlisted HTML: kept tags with kept attributes, links that open outside, everything else reduced to its text or dropped. */
export function sanitizeHtml(input, { maxBytes = 512 * 1024 } = {}) {
  let html = String(input ?? '');
  if (html.length > maxBytes * 2) html = html.slice(0, maxBytes * 2);
  html = html.replace(/<!--[\s\S]*?(-->|$)/g, '').replace(/<!\[CDATA\[[\s\S]*?(\]\]>|$)/gi, '').replace(/<!doctype[^>]*>/gi, '').replace(/<\?[\s\S]*?(\?>|$)/g, '');
  const out = []; const open = [];
  let i = 0; let dropping = null; let inStyle = false;
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/y;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    const textEnd = lt < 0 ? html.length : lt;
    if (textEnd > i) {
      const text = html.slice(i, textEnd);
      if (!dropping) out.push(inStyle ? cleanCss(text) : escText(decodeEntities(text)));
      i = textEnd;
      continue;
    }
    tagRe.lastIndex = i;
    const m = tagRe.exec(html);
    if (!m) { if (!dropping) out.push('&lt;'); i += 1; continue; }
    i = tagRe.lastIndex;
    const closing = m[0][1] === '/';
    const name = m[1].toLowerCase();
    if (dropping) { if (closing && name === dropping) dropping = null; continue; }
    if (DROP.has(name)) { if (!closing && !/\/>$/.test(m[0]) && !VOID.has(name)) dropping = name; continue; }
    if (!KEEP.has(name)) continue;
    if (closing) {
      const at = open.lastIndexOf(name);
      if (at < 0) continue;
      while (open.length > at) { const t = open.pop(); out.push(`</${t}>`); if (t === 'style') inStyle = false; }
      continue;
    }
    const attrs = [];
    const attrRe = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let a;
    while ((a = attrRe.exec(m[2] || ''))) {
      const key = a[1].toLowerCase();
      const val = a[2] ?? a[3] ?? a[4] ?? '';
      if (!ATTRS.has(key) || key.startsWith('on')) continue;
      if (key === 'href' || key === 'src') {
        if ((key === 'href') !== (name === 'a') || (key === 'src' && name !== 'img')) continue;
        const u = cleanUrl(val, name);
        if (u) attrs.push(`${key}="${escAttr(u)}"`);
        continue;
      }
      if (key === 'style') { const c = cleanCss(val).replace(/"/g, "'"); if (c.trim()) attrs.push(`style="${escAttr(c)}"`); continue; }
      attrs.push(`${key}="${escAttr(decodeEntities(val).slice(0, 200))}"`);
    }
    if (name === 'a') attrs.push('target="_blank"', 'rel="noopener noreferrer nofollow"');
    out.push(`<${name}${attrs.length ? ` ${attrs.join(' ')}` : ''}>`);
    if (!VOID.has(name)) { open.push(name); if (name === 'style') inStyle = true; }
    if (open.length > 400) break;
  }
  while (open.length) out.push(`</${open.pop()}>`);
  let s = out.join('');
  if (Buffer.byteLength(s) > maxBytes) s = '';
  return s;
}

/** Readable text from HTML, for an email that came without a text part. */
export function htmlToText(html, max = 100000) {
  const s = String(html ?? '').slice(0, max * 4)
    .replace(/<(script|style|head|title|template|svg)[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h[1-6]|blockquote|table|pre)\s*>/gi, '\n').replace(/<li[^>]*>/gi, '• ')
    .replace(/<a\s[^>]*href\s*=\s*["']?(https?:[^"'\s>]+)[^>]*>([\s\S]*?)<\/a>/gi, (m0, href, label) => `${label} (${href})`)
    .replace(/<[^>]*>/g, ' ');
  return decodeEntities(s).replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}

/** Printable text only: control characters out, lines kept. */
export const cleanText = (s, max) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]+/g, '').slice(0, max);
export const oneLine = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029‪-‮⁦-⁩]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

const ADDR = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
export const isAddress = (s) => typeof s === 'string' && s.length <= 254 && ADDR.test(s) && !/\.\./.test(s);
/** "Sam <sam@x.co>" or sam@x.co, to { address, name }. The address is lowercased; a name never carries a newline or a bracket. */
export function parseAddress(raw) {
  const s = String(raw ?? '').trim().slice(0, 400);
  const m = s.match(/^(.*?)<([^<>]+)>\s*$/);
  const address = (m ? m[2] : s).trim().replace(/^mailto:/i, '').toLowerCase();
  const name = m ? oneLine(m[1].replace(/^"|"$/g, ''), 80).replace(/[<>"]/g, '') : '';
  return isAddress(address) ? { address, name } : null;
}
export const addressList = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(parseAddress).filter(Boolean);

const MACHINE = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|mailer[-_.]?daemon|postmaster|bounces?|bounce[-+].*|notifications?|auto[-_.]?(reply|responder)|listserv|majordomo|.*-request|.*-owner|owner-.*)$/i;
/** Mail that must never get an automatic answer: anything a machine or a list sent. Reasons, so the boss and the tests can see why. */
export function machineMail({ from, headers = {} }) {
  const h = Object.fromEntries(Object.entries(headers || {}).map(([k, v]) => [String(k).toLowerCase(), String(Array.isArray(v) ? v.join(',') : v ?? '')]));
  const local = String(from || '').split('@')[0];
  const why = [];
  if (h['auto-submitted'] && !/^\s*no\b/i.test(h['auto-submitted'])) why.push('auto-submitted');
  if (/\b(bulk|list|junk|auto_reply)\b/i.test(h.precedence || '')) why.push('bulk');
  if (h['list-id'] || h['list-unsubscribe'] || h['list-post']) why.push('mailing-list');
  if (h['x-autoreply'] || h['x-autorespond'] || h['x-autoreply-from']) why.push('auto-reply');
  if (MACHINE.test(local)) why.push(/daemon|postmaster|bounce/i.test(local) ? 'mailer-daemon' : 'no-reply');
  return why;
}
