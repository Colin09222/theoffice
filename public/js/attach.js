// Attachments for the manager chat: a paperclip, drag and drop, and paste. Each file uploads on its own with a progress bar,
// then its id goes along with the next message. Images show a thumbnail (a data: URL, since the CSP has no blob: for images).
import { h, BASE, session } from './dom.js';
import { icon } from './icons.js';

export const MAX_BYTES = 15 * 1024 * 1024;
const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', zip: 'application/zip' };
export const ACCEPT = Object.keys(TYPES).map((e) => `.${e}`).join(',') + ',image/*';
const ext = (name) => (name.split('.').pop() || '').toLowerCase();
export const sizeText = (n) => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`;
const isImage = (type) => /^image\//.test(type || '');

export function checkFile(file) {
  const e = ext(file.name || '');
  if (!TYPES[e]) return `${file.name || 'That file'} can't be sent. Allowed: png, jpg, webp, gif, pdf, txt, md, csv, json, zip.`;
  if (file.size > MAX_BYTES) return `${file.name} is ${sizeText(file.size)}. The limit is 15 MB.`;
  return '';
}

function upload(slug, file, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', `${BASE}/api/floors/${slug}/attachments`);
    x.withCredentials = true;
    x.setRequestHeader('content-type', file.type || TYPES[ext(file.name)] || 'application/octet-stream');
    x.setRequestHeader('x-filename', encodeURIComponent(file.name || 'file'));
    if (session.csrf) x.setRequestHeader('x-office-csrf', session.csrf);
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    x.onload = () => {
      let data = null; try { data = JSON.parse(x.responseText); } catch { /* plain body */ }
      if (x.status >= 200 && x.status < 300 && data?.id) resolve(data);
      else reject(new Error((/\s/.test(data?.message || '') && data.message) || (x.status === 413 ? 'That file is over 15 MB.' : x.status === 415 ? 'That kind of file can\'t be sent.' : 'The upload didn\'t go through.')));
    };
    x.onerror = () => reject(new Error('The upload didn\'t go through. Check your connection.'));
    x.send(file);
  });
}

// The tray above the input. ids() gives the uploaded ids; busy() is true while any file is still going up.
export function attachTray(slug, { onError }) {
  const items = [];
  const tray = h('div.attach-tray', { hidden: true });
  const sync = () => { tray.hidden = !items.length; };
  const add = (file) => {
    const bad = checkFile(file);
    if (bad) { onError(bad); return; }
    const bar = h('i.attach-bar');
    const item = { file, id: null, failed: false };
    const thumb = isImage(file.type) ? h('img.attach-thumb', { alt: '' }) : h('span.attach-icon', {}, icon('file-text'));
    if (thumb.tagName === 'IMG') { const r = new FileReader(); r.onload = () => { thumb.src = r.result; }; r.readAsDataURL(file); }
    const remove = () => { items.splice(items.indexOf(item), 1); item.el.remove(); sync(); };
    item.el = h('div.attach-chip.uploading', { title: file.name }, thumb,
      h('span.attach-name', {}, file.name), h('small', {}, sizeText(file.size)), bar,
      h('button.attach-x', { type: 'button', 'aria-label': `Remove ${file.name}`, onclick: remove }, icon('x')));
    items.push(item); tray.append(item.el); sync();
    item.done = upload(slug, file, (p) => { bar.style.width = `${Math.round(p * 100)}%`; })
      .then((r) => { item.id = r.id; item.el.classList.remove('uploading'); })
      .catch((e) => { item.failed = true; onError(e.message); remove(); });
  };
  return {
    el: tray,
    add: (files) => { for (const f of files) add(f); },
    busy: () => items.some((i) => !i.id && !i.failed),
    wait: () => Promise.all(items.map((i) => i.done)),
    ids: () => items.filter((i) => i.id).map((i) => i.id),
    clear: () => { items.length = 0; tray.replaceChildren(); sync(); },
  };
}

// An attachment in the chat history. The file itself is served back at /attachments/:id.
export function attachmentEl(slug, a) {
  const url = `${BASE}/api/floors/${slug}/attachments/${encodeURIComponent(a.id)}`;
  if (isImage(a.type)) return h('a.msg-attach.image', { href: url, target: '_blank', rel: 'noopener' }, h('img', { src: url, alt: a.name, loading: 'lazy' }));
  return h('a.msg-attach.file', { href: url, target: '_blank', rel: 'noopener', download: a.name }, icon('file-text'), h('span', {}, a.name), h('small', {}, sizeText(a.size || 0)));
}
