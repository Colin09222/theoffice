// The pre-publish checklist. Pure and dependency-free on purpose: the server runs it at publish time, and the same file goes into a computer's box, so the Tester sees exactly what the gate will see.
const HTML = /\.html?$/i, TEXTY = /\.(html?|js|mjs|css|json|webmanifest|svg|txt|md)$/i;
const text = (d) => (typeof d === 'string' ? d : Buffer.from(d).toString('utf8'));
const squeeze = (s) => String(s).toLowerCase().replace(/[^a-z0-9@+]+/g, ' ').trim();
// Hard limits on what gets read. This runs on the server's only thread, and agents write these pages.
const MAX_PAGE = 512 * 1024, MAX_PAGES_TOTAL = 1536 * 1024, MAX_SCAN = 2 * 1024 * 1024;
// A single forward walk. Regexes that look for a closing tag from every opening one take quadratic time on a page written to exploit that.
function stripTags(h) {
  const low = h.toLowerCase(); const out = []; let i = 0;
  while (i < h.length) {
    const lt = h.indexOf('<', i);
    if (lt < 0) { out.push(h.slice(i)); break; }
    out.push(h.slice(i, lt), ' ');
    let end;
    if (low.startsWith('<!--', lt)) { end = h.indexOf('-->', lt + 4); end = end < 0 ? h.length : end + 3; }
    else if (low.startsWith('<script', lt)) { end = low.indexOf('</script', lt + 7); end = end < 0 ? h.length : h.indexOf('>', end) + 1 || h.length; }
    else if (low.startsWith('<style', lt)) { end = low.indexOf('</style', lt + 6); end = end < 0 ? h.length : h.indexOf('>', end) + 1 || h.length; }
    else { end = h.indexOf('>', lt + 1); end = end < 0 ? h.length : end + 1; }
    i = end;
  }
  return out.join('').replace(/&[a-z#0-9]{1,12};/gi, ' ');
}
const hostOf = (u) => u.replace(/^https?:\/\//i, '').split(/[/:?#]/)[0];
// Matched to its own kind of quote, so an apostrophe in a description doesn't end it.
const metaOf = (h, attr, name) => { const m = new RegExp(`<meta\\b[^>]{0,600}\\b${attr}\\s*=\\s*["']${name}["'][^>]{0,600}>`, 'i').exec(h)?.[0]?.match(/\bcontent\s*=\s*(?:"([^"]{0,2000})"|'([^']{0,2000})')/i); return m?.[1] ?? m?.[2] ?? ''; };

const CLAIMS = [
  [/testimonial|what\s+(our\s+)?(people|customers|clients|users|parents|guests|members|readers)\s+(say|are\s+saying|think)|customer\s+(stories|reviews)|success\s+stories|hear\s+from\s+our/i, 'testimonials or customer quotes'],
  [/★{3,}|⭐{3,}|\b[1-5](\.\d)?\s{0,3}(\/\s{0,3}5|out\s{1,3}of\s{1,3}5)\b|\b[1-5](\.\d)?[- ]stars?\b/i, 'a star rating'],
  [/\b(trusted|loved|used|chosen)\s+by\s+(over\s{1,3}|more\s{1,3}than\s{1,3})?[\d,.]{1,15}\s{0,3}k?\+?/i, 'a customer count'],
  [/\b[\d,.]{1,15}\s{0,3}k?\+?\s{1,3}(happy|satisfied|delighted|paying)\s{1,3}\w{1,30}|\b[\d,.]{1,15}\s{0,3}k?\+?\s{1,3}(reviews|customers|clients|subscribers)\b/i, 'a customer count'],
  [/\bas\s+(seen|featured)\s+(in|on)\b|\baward[- ]winning\b|#\s*1\s+rated|\bindustry[- ]leading\b|\bguaranteed\s+results\b/i, 'a press mention or award'],
  [/["“][^"”\n]{20,220}["”]\s{0,3}(<[^>]{1,300}>\s{0,3}){0,4}[—–-]\s{0,3}[A-Z][a-z]+(\s+[A-Z][a-z.]*)?/, 'a quote attributed to a person'],
];
const CONTACT = [
  [/[a-z0-9._%+-]{1,64}@[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63}){0,4}\.[a-z]{2,24}/gi, 'an email address'],
  [/(?<![\d.-])(\+?\d{1,3}[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?![\d-])/g, 'a phone number'],
  [/\b\d{1,5}\s{1,3}[A-Z][a-z]{1,30}(\s{1,3}[A-Z][a-z]{1,30}){0,3}\s{1,3}(Street|St\.|Avenue|Ave\.|Road|Rd\.|Boulevard|Blvd\.?|Lane|Drive|Suite)\b/g, 'a street address'],
];
const PAYMENT_HOSTS = /https?:\/\/(buy\.stripe\.com|donate\.stripe\.com|checkout\.stripe\.com|paypal\.me|www\.paypal\.com|paypal\.com|venmo\.com|cash\.app|ko-fi\.com|buymeacoffee\.com|www\.buymeacoffee\.com|gumroad\.com|[a-z0-9-]+\.gumroad\.com)[^\s"'<>)]{0,500}/gi;
const SECRETS = /\b(sk_live_[A-Za-z0-9]{8,}|rk_live_[A-Za-z0-9]{8,}|whsec_[A-Za-z0-9]{8,}|sk-ant-[A-Za-z0-9_-]{8,}|sk-or-[A-Za-z0-9_-]{8,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,})\b/;
const CARD_FIELD = /autocomplete\s*=\s*["']cc-|name\s*=\s*["'](card[-_ ]?number|cc[-_ ]?number|cardnumber|cvv|cvc)["']/i;
const PLACEHOLDER = /lorem ipsum|\bTODO\b|\bFIXME\b|your company name|your tagline here|placeholder text|example\.com/;

/**
 * files: [{path, data}] of what is about to go live. bossText: what the boss has actually said, the only source a claim can come from.
 * Returns errors (never publishable), claims (need a stated reason), warnings and the list of what passed.
 */
export function checkSite({ files, bossText = '', paymentLink = false, kind = 'site' }) {
  const errors = [], claims = [], warnings = [], passed = [];
  const map = new Map(files.map((f) => [f.path, f.data]));
  const said = squeeze(bossText);
  const fromBoss = (s) => { const q = squeeze(s); return q.length >= 3 && said.includes(q); };
  const pages = files.filter((f) => HTML.test(f.path));
  const isDoc = kind === 'doc' || kind === 'research';
  const seen = new Set();
  const flag = (what, where, sample) => { const k = `${what}|${sample}`; if (seen.has(k)) return; seen.add(k); claims.push(`${where}: ${what}: "${String(sample).replace(/\s+/g, ' ').trim().slice(0, 90)}"`); };

  let scanned = 0;
  for (const f of files) {
    const size = f.data?.length ?? 0;
    if (!TEXTY.test(f.path) || !size) continue;
    if (scanned + size > MAX_SCAN) { warnings.push(`${f.path}: past what the checklist reads for secrets and payment links.`); continue; }
    scanned += size;
    const t = text(f.data);
    if (SECRETS.test(t)) errors.push(`${f.path}: holds what looks like a secret key. Remove it; nothing published may carry one.`);
    if (HTML.test(f.path) && CARD_FIELD.test(t)) errors.push(`${f.path}: has card-number fields. Never collect card details on a site; link to the boss's Stripe Payment Link with _office/pay.`);
    for (const m of t.matchAll(PAYMENT_HOSTS)) errors.push(`${f.path}: links to a payment page directly (${hostOf(m[0])}). The only way to take money here is a link to _office/pay, which goes to the Stripe link the boss pasted.`);
  }
  if (!isDoc && !map.has('index.html')) errors.push('index.html is missing.');
  // Every page counts, whatever the project calls itself: a "doc" with an index.html is still a web page.
  let pageBytes = 0;
  {
    for (const f of pages) {
      pageBytes += f.data?.length ?? 0;
      if (pageBytes > MAX_PAGES_TOTAL) { warnings.push(`${f.path}: past how much the checklist reads in one go, so it was not checked.`); continue; }
      if ((f.data?.length ?? 0) > MAX_PAGE) { warnings.push(`${f.path}: too large for the full check. Keep a page under 512 KB, and put big things in their own files.`); continue; }
      const h = text(f.data); const visible = stripTags(h);
      for (const [re, what] of CLAIMS) { const m = visible.match(re) || (what.startsWith('a quote') ? h.match(re) : null); if (m && !fromBoss(m[0])) flag(what, f.path, m[0]); }
      for (const [re, what] of CONTACT) for (const m of visible.matchAll(re)) if (!fromBoss(m[0])) flag(what, f.path, m[0]);
      if (/"@type"\s*:\s*"(AggregateRating|Review)"|aggregateRating/i.test(h)) flag('review data for search engines', f.path, 'aggregateRating');
      if (PLACEHOLDER.test(visible)) warnings.push(`${f.path}: still has placeholder text.`);
      // The page can only load from itself, so anything off-site is simply broken once published.
      for (const m of h.matchAll(/<(script|link|img|iframe|video|audio|source)\b[^>]{0,600}\b(?:src|href)\s*=\s*["'](?:https?:)?\/\/([^"'/]+)[^"']{0,2000}["'][^>]{0,600}>/gi)) {
        if (m[1].toLowerCase() === 'link' && !/rel\s*=\s*["'](stylesheet|preload|modulepreload|icon)/i.test(m[0])) continue;
        errors.push(`${f.path}: loads ${m[1]} from ${m[2]}. Published pages can only load from their own origin; bundle it.`);
      }
      if (/<form\b[^>]{0,600}\baction\s*=\s*["'](https?:)?\/\//i.test(h)) errors.push(`${f.path}: a form posts off-site, which the browser will block. Use Office.submitForm.`);
      for (const m of h.matchAll(/<(?:script|img|link|source|a|iframe)\b[^>]{0,600}\b(?:src|href)\s*=\s*["']([^"'#?]+)/gi)) {
        const ref = m[1];
        if (/^(https?:|mailto:|tel:|data:|blob:|javascript:|\/\/|_office\/)/i.test(ref)) continue;
        const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/') + 1) : '';
        const parts = []; for (const seg of (ref.startsWith('/') ? ref.slice(1) : dir + ref).split('/')) { if (seg === '..') parts.pop(); else if (seg && seg !== '.') parts.push(seg); }
        const target = parts.join('/');
        if (!target || map.has(target) || map.has(`${target}/index.html`) || !target.includes('.')) continue;
        errors.push(`${f.path}: points at ${ref}, which isn't in what's being published.`);
      }
      for (const m of h.matchAll(/<img\b[^>]{0,600}>/gi)) if (!/\balt\s*=/i.test(m[0])) { warnings.push(`${f.path}: an image has no alt text.`); break; }
    }
    for (const f of files) {
      if (!/\.m?js$/i.test(f.path) || /three\.|vendor|chunk-vendors/i.test(f.path) || (f.data?.length ?? 0) > 400 * 1024) continue;
      const t = text(f.data);
      for (const [re, what] of CLAIMS.slice(0, 2)) { const m = t.match(re); if (m && !fromBoss(m[0])) flag(what, f.path, m[0]); }
    }
    const home = map.has('index.html') ? text(map.get('index.html')).slice(0, MAX_PAGE) : '';
    const need = (ok, good, bad) => { if (isDoc) return; if (ok) passed.push(good); else warnings.push(bad); };
    need(/<title>[^<]{3,}<\/title>/i.test(home), 'page title', 'index.html has no real <title>.');
    const desc = metaOf(home, 'name', 'description');
    need(desc.length >= 30, 'search description', 'index.html needs a <meta name="description"> of a sentence or two.');
    need(/<meta\b[^>]{0,600}name\s*=\s*["']viewport["']/i.test(home), 'works on phones (viewport)', 'index.html has no viewport tag, so phones will show it zoomed out.');
    need(/<html\b[^>]{0,600}\blang\s*=/i.test(home), 'language set', '<html> has no lang.');
    need(!!metaOf(home, 'property', 'og:title') && !!metaOf(home, 'property', 'og:description'), 'social preview text', 'index.html needs og:title and og:description for link previews.');
    const og = metaOf(home, 'property', 'og:image');
    need(!!og, 'social preview image', 'index.html needs an og:image for link previews.');
    need(/<link\b[^>]{0,600}rel\s*=\s*["'][^"']{0,2000}icon[^"']{0,2000}["']/i.test(home) || map.has('favicon.ico'), 'favicon', 'index.html has no favicon.');
    if (/_office\/pay/.test(home) && !paymentLink) warnings.push('A button goes to _office/pay, but the boss has not pasted a Stripe Payment Link yet, so it leads nowhere.');
    if (!errors.length && !claims.length) passed.push('no invented claims or contact details found');
  }
  return { errors: [...new Set(errors)].slice(0, 30), claims: claims.slice(0, 30), warnings: [...new Set(warnings)].slice(0, 30), passed };
}

export function formatReport(r) {
  const lines = [];
  if (r.errors.length) lines.push('MUST FIX (it will not publish):', ...r.errors.map((x) => `- ${x}`));
  if (r.claims.length) lines.push('POSSIBLY INVENTED (only the boss can be the source of these; remove them, or ask_boss):', ...r.claims.map((x) => `- ${x}`));
  if (r.warnings.length) lines.push('SHOULD FIX:', ...r.warnings.map((x) => `- ${x}`));
  if (r.passed.length) lines.push(`OK: ${r.passed.join(', ')}.`);
  return lines.join('\n') || 'Nothing to report.';
}
