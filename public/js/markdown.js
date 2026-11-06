// Minimal sanitising markdown renderer, shared by server and browser. Every character of input is HTML-escaped
// before any tag is produced, so raw HTML can never pass through. Only http(s), mailto and same-page links survive.
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

export function safeUrl(raw) {
  // Browsers ignore tabs, newlines and control characters inside schemes, so strip them before judging.
  const u = String(raw).replace(/[\u0000- \u007f-\u009f]+/g, '').trim();
  if (/^(https?:\/\/|mailto:)/i.test(u)) return u;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return null;  // any other scheme
  if (u.startsWith('//') || u.startsWith('\\')) return null;
  return u || null;
}

function inline(text) {
  const codes = []; const links = [];
  let s = String(text).replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return `\u0001${codes.length - 1}\u0001`; });
  s = esc(s);
  // [label](url): the url arrives entity-escaped, which also keeps quotes out of the attribute.
  s = s.replace(/\[([^\]\n]{1,300})\]\(([^()\s]{1,1000})\)/g, (m, label, href) => {
    const un = href.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    const u = safeUrl(un);
    if (!u) return label;
    links.push(`<a href="${esc(u)}" rel="noopener noreferrer nofollow" target="_blank">${label}</a>`); // parked so emphasis rules never touch the href
    return `\u0002${links.length - 1}\u0002`;
  });
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>').replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>');
  s = s.replace(/\u0002(\d+)\u0002/g, (_, i) => links[Number(i)] ?? '');
  s = s.replace(/\u0001(\d+)\u0001/g, (_, i) => `<code>${esc(codes[Number(i)] ?? '')}</code>`);
  return s;
}

export function renderMarkdown(src) {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').replace(/[\u0001\u0002]/g, '').split('\n');
  const out = []; let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*$/.test(l)) { i++; continue; }
    const fence = l.match(/^```/);
    if (fence) {
      const buf = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++; out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`); continue;
    }
    const h = l.match(/^(#{1,4})\s+(.*)$/);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
    if (/^>\s?/.test(l)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`); continue;
    }
    if (/^\s*([-*+]|\d+\.)\s+/.test(l)) {
      const ordered = /^\s*\d+\./.test(l); const buf = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) buf.push(lines[i++].replace(/^\s*([-*+]|\d+\.)\s+/, ''));
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${buf.map((b) => `<li>${inline(b)}</li>`).join('')}</${tag}>`); continue;
    }
    if (/\|/.test(l) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && /-/.test(lines[i + 1])) {
      const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim()));
      const head = cells(l); i += 2; const rows = [];
      while (i < lines.length && /\|/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push(`<table><thead><tr>${head.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>\s?|\s*([-*+]|\d+\.)\s)/.test(lines[i])) buf.push(lines[i++]);
    if (!buf.length) { buf.push(lines[i++]); }
    out.push(`<p>${buf.map(inline).join('<br>')}</p>`);
  }
  return out.join('\n');
}
