// Link previews (Facebook, LinkedIn, Slack, iMessage, X) need an absolute og:image, and a page written before it knew its address has a relative one.
// The live address is only known when the page is served, so it is filled in then. Anything already absolute is left alone.
const KEYS = /^(og:image|og:image:url|og:image:secure_url|og:url|twitter:image|twitter:image:src)$/i;
const attr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** html with relative preview URLs made absolute against pageUrl, the address the page is served at. */
export function absoluteMeta(html, pageUrl) {
  if (typeof html !== 'string' || !/og:|twitter:/i.test(html)) return html;
  return html.replace(/<meta\b[^>]{0,2000}>/gi, (tag) => {
    const key = /\b(?:property|name)\s*=\s*["']([^"']{1,60})["']/i.exec(tag)?.[1];
    if (!key || !KEYS.test(key.trim())) return tag;
    return tag.replace(/(\bcontent\s*=\s*)(["'])([^"']{0,2000})\2/i, (m, pre, q, val) => {
      const v = val.trim().replace(/&amp;/g, '&');
      if (!v || /^[a-z][a-z0-9+.-]*:/i.test(v) || v.startsWith('//')) return m;
      let abs; try { abs = new URL(v, pageUrl).href; } catch { return m; }
      return `${pre}"${attr(abs)}"`;
    });
  });
}
