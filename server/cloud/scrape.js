// Reading a web page without running it: its title, meta tags, links and readable text. One pass, always forwards, so a hostile page can only ever cost
// its own length. Nothing here runs a script or follows anything.
const SKIP = new Set(['script', 'style', 'noscript', 'svg', 'iframe', 'template', 'object', 'canvas', 'textarea', 'select']);
const BLOCK = new Set(['p', 'div', 'br', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'table', 'section', 'article', 'main', 'header', 'footer', 'nav', 'aside', 'form', 'blockquote', 'pre', 'hr', 'figure', 'dd', 'dt']);
const BOILERPLATE = new Set(['nav', 'header', 'footer', 'aside', 'form']);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™', mdash: '—', ndash: '–', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  bull: '•', middot: '·', laquo: '«', raquo: '»', euro: '€', pound: '£', yen: '¥', cent: '¢', sect: '§', deg: '°', times: '×', divide: '÷', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç', uuml: 'ü', ouml: 'ö', auml: 'ä', ntilde: 'ñ', szlig: 'ß',
};
const NAME_CHAR = /[a-z0-9:_-]/;
const SPACE = /[\s/]/;
// Once only, so &amp;lt; stays the text &lt;.
export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]{1,31});?/gi, (whole, body) => {
    if (body[0] !== '#') return Object.hasOwn(NAMED, body) ? NAMED[body] : whole;
    const n = /^#x/i.test(body) ? parseInt(body.slice(2), 16) : Number(body.slice(1));
    if (!Number.isInteger(n) || n < 1 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return whole;
    return String.fromCodePoint(n);
  });
}
const tidyInline = (s) => decodeEntities(s).replace(/[\s ]+/g, ' ').trim();

/** A lowercase copy the same length as the page. String.toLowerCase can change the length of some characters, which would misplace every later index. */
function asciiLower(s) {
  const out = Buffer.from(s, 'utf16le');
  for (let i = 0; i < out.length; i += 2) if (out[i + 1] === 0 && out[i] >= 65 && out[i] <= 90) out[i] += 32;
  return out.toString('utf16le');
}

export function scrapeHtml(html, baseUrl, { textChars = 64000, links: maxLinks = 200, metas: maxMetas = 64 } = {}) {
  const lower = asciiLower(html), n = html.length;
  let i = 0, title = '', titled = false, boiler = 0, base = baseUrl, baseSet = false;
  const all = [], main = [];
  let allLen = 0, mainLen = 0;
  const limit = textChars * 2;   // room for whitespace that collapses later; past this nothing more is kept
  const meta = Object.create(null);
  let metaCount = 0, hrefsTried = 0;
  const seen = new Set(), links = [];
  let open = null;   // the link whose words are being read
  const add = (s) => {
    if (open && open.text.length < 200) open.text += s;
    if (allLen < limit) { all.push(s); allLen += s.length; }
    if (!boiler && mainLen < limit) { main.push(s); mainLen += s.length; }
  };
  const addText = (s) => { if (s) add(decodeEntities(s)); };
  const closeLink = () => { if (open) { open.text = tidyInline(open.text).slice(0, 200); open = null; } };
  const nameAt = (p) => { let e = p; while (e < n && e - p < 64 && NAME_CHAR.test(lower[e])) e++; return lower.slice(p, e); };

  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt < 0) { addText(html.slice(i)); break; }
    addText(html.slice(i, lt));
    if (lower.startsWith('<!--', lt)) { const c = lower.indexOf('-->', lt + 4); i = c < 0 ? n : c + 3; continue; }
    const next = lower[lt + 1];
    if (next === '!' || next === '?') { const c = html.indexOf('>', lt + 2); i = c < 0 ? n : c + 1; continue; }
    if (next === '/') {
      const name = nameAt(lt + 2);
      const c = html.indexOf('>', lt + 2);
      i = c < 0 ? n : c + 1;
      if (name === 'a') closeLink();
      if (BOILERPLATE.has(name) && boiler > 0) boiler--;
      if (BLOCK.has(name)) add('\n');
      continue;
    }
    if (!next || next < 'a' || next > 'z') { add('<'); i = lt + 1; continue; }

    // An opening tag: its name, then attributes up to the first > outside quotes.
    const name = nameAt(lt + 1);
    let p = lt + 1 + name.length;
    const attrs = Object.create(null);
    let keep = name === 'a' || name === 'meta' || name === 'base';
    let selfClosed = false, count = 0;
    for (;;) {
      while (p < n && SPACE.test(html[p])) { if (html[p] === '/') selfClosed = true; else selfClosed = false; p++; }
      if (p >= n || html[p] === '>') break;
      selfClosed = false;
      const ks = p;
      while (p < n && html[p] !== '=' && html[p] !== '>' && !SPACE.test(html[p])) p++;
      const key = lower.slice(ks, Math.min(p, ks + 40));
      if (p === ks) { p++; continue; }
      while (p < n && /\s/.test(html[p])) p++;
      let value = '';
      if (html[p] === '=') {
        p++;
        while (p < n && /\s/.test(html[p])) p++;
        const q = html[p];
        if (q === '"' || q === "'") {
          const end = html.indexOf(q, p + 1);
          if (end < 0) { p = n; break; }
          value = keep ? html.slice(p + 1, Math.min(end, p + 4097)) : '';
          p = end + 1;
        } else {
          const vs = p;
          while (p < n && html[p] !== '>' && !/\s/.test(html[p])) p++;
          value = keep ? html.slice(vs, Math.min(p, vs + 4096)) : '';
        }
      }
      if (keep && !(key in attrs) && count++ < 32) attrs[key] = value;
    }
    i = p >= n ? n : p + 1;

    if (name === 'title' && !titled) {
      const c = lower.indexOf('</title', i);
      title = tidyInline(html.slice(i, c < 0 ? n : c)).slice(0, 500); titled = true;
      if (c < 0) { i = n; continue; }
      const gt = html.indexOf('>', c); i = gt < 0 ? n : gt + 1;
      continue;
    }
    if (SKIP.has(name) && !selfClosed) {
      const c = lower.indexOf(`</${name}`, i);
      if (c < 0) { i = n; continue; }
      const gt = html.indexOf('>', c); i = gt < 0 ? n : gt + 1;
      continue;
    }
    if (name === 'meta') {
      const k = String(attrs.name ?? attrs.property ?? '').trim().toLowerCase().slice(0, 64);
      if (k && attrs.content !== undefined && !(k in meta) && metaCount < maxMetas) { meta[k] = tidyInline(attrs.content).slice(0, 1024); metaCount++; }
      continue;
    }
    if (name === 'base' && !baseSet && attrs.href) {
      baseSet = true;
      try { const u = new URL(decodeEntities(attrs.href), baseUrl); if (u.protocol === 'http:' || u.protocol === 'https:') base = u.href; } catch { /* a bad base is ignored */ }
      continue;
    }
    if (name === 'a') {
      closeLink();
      const href = attrs.href && decodeEntities(attrs.href).trim();
      if (href && hrefsTried < 2000 && links.length < maxLinks) {
        hrefsTried++;
        let u = null; try { u = new URL(href, base); } catch { /* not a link */ }
        if (u && (u.protocol === 'http:' || u.protocol === 'https:') && u.href.length <= 2048) {
          u.hash = ''; u.username = ''; u.password = '';
          if (!seen.has(u.href)) { seen.add(u.href); open = { url: u.href, text: '' }; links.push(open); }
        }
      }
    }
    if (BLOCK.has(name)) add('\n');
    if (BOILERPLATE.has(name) && !selfClosed && !VOID.has(name)) boiler++;
  }
  closeLink();

  const tidy = (parts) => parts.join('').replace(/[ \t\r\f\v ]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const everything = tidy(all), body = tidy(main);
  // Navigation and footers are left out unless that leaves next to nothing, as it does on a page with an unclosed <nav> wrapped round everything.
  const chosen = body.length >= 200 || body.length >= everything.length * 0.3 ? body : everything;
  return {
    title, description: meta.description ?? meta['og:description'] ?? '', meta, links,
    text: chosen.slice(0, textChars), truncated: chosen.length > textChars || allLen >= limit,
  };
}
