// Attachments for the manager chat: a paperclip, drag and drop, and paste. Each file uploads on its own with a progress bar,
// then its id goes along with the next message. Images show a thumbnail (a data: URL, since the CSP has no blob: for images).
import { h, BASE, session } from './dom.js';
import { icon } from './icons.js';

export const MAX_BYTES = 15 * 1024 * 1024;
const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', zip: 'application/zip' };
export const ACCEPT = Object.keys(TYPES).map((e) => `.${e}`).join(',') + ',.heic,.heif,image/*';
const ext = (name) => (name.split('.').pop() || '').toLowerCase();
export const sizeText = (n) => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`;
const isImage = (type) => /^image\//.test(type || '');
const isHeic = (file) => /^image\/hei[cf]/.test(file.type || '') || /^hei[cf]$/.test(ext(file.name || ''));

export function checkFile(file) {
  const e = ext(file.name || '');
  if (isHeic(file)) return `${file.name} is a HEIC photo, and this browser can't open one. Save it as a JPEG and send that.`;
  if (!TYPES[e]) return `${file.name || 'That file'} can't be sent. Allowed: png, jpg, webp, gif, pdf, txt, md, csv, json, zip.`;
  if (file.size > MAX_BYTES) return `${file.name} is ${sizeText(file.size)}. The limit is 15 MB.`;
  return '';
}

// A photo goes up small: over 1.5 MB, or over 2400 px on its long edge, it is redrawn at most 2400 px and sent as a JPEG
// at 0.85. A big file can run past the server's time limit, and Claude only looks at a picture under 5 MB. A PNG with
// transparency under 4 MB stays as it is, and so does a GIF, which may move. An iPhone's HEIC always becomes a JPEG,
// since the server takes none, when this browser can open it.
const SHRINK_OVER = 1.5 * 1024 * 1024;
const LONG_EDGE = 2400;
const KEEP_CLEAR_PNG_UNDER = 4 * 1024 * 1024;
const shrinkable = (file) => isHeic(file) || /^image\/(png|jpeg|webp)$/.test(file.type);
const seeThrough = (g, w, hgt) => { const px = g.getImageData(0, 0, w, hgt).data; for (let i = 3; i < px.length; i += 4) if (px[i] < 255) return true; return false; };
export async function shrink(file) {
  const heic = isHeic(file);
  if (!shrinkable(file)) return file;
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { return file; }
  try {
    const long = Math.max(bmp.width, bmp.height);
    if (!heic && file.size <= SHRINK_OVER && long <= LONG_EDGE) return file;
    const k = Math.min(1, LONG_EDGE / long);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bmp.width * k)); canvas.height = Math.max(1, Math.round(bmp.height * k));
    const g = canvas.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    if (file.type === 'image/png' && file.size < KEEP_CLEAR_PNG_UNDER && seeThrough(g, canvas.width, canvas.height)) return file;
    // A JPEG has no transparency, so anything see-through goes white rather than black.
    g.globalCompositeOperation = 'destination-over'; g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height);
    const blob = await new Promise((done) => canvas.toBlob(done, 'image/jpeg', 0.85));
    if (!blob || (!heic && k === 1 && blob.size >= file.size)) return file;
    return new File([blob], `${(file.name || 'photo').replace(/\.[^.]*$/, '') || 'photo'}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified });
  } finally { bmp.close(); }
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
  const add = (raw) => {
    // A photo is checked once it has been made small, on what actually goes up; anything else straight away.
    const early = shrinkable(raw) ? '' : checkFile(raw);
    if (early) { onError(early); return; }
    const bar = h('i.attach-bar');
    const item = { file: raw, id: null, failed: false };
    const thumb = isImage(raw.type) ? h('img.attach-thumb', { alt: '' }) : h('span.attach-icon', {}, icon('file-text'));
    const name = h('span.attach-name', {}, raw.name), size = h('small', {}, sizeText(raw.size));
    const remove = () => { const i = items.indexOf(item); if (i >= 0) items.splice(i, 1); item.el.remove(); sync(); };
    item.el = h('div.attach-chip.uploading', { title: raw.name }, thumb, name, size, bar,
      h('button.attach-x', { type: 'button', 'aria-label': `Remove ${raw.name}`, onclick: remove }, icon('x')));
    items.push(item); tray.append(item.el); sync();
    item.done = shrink(raw).then((file) => {
      const bad = checkFile(file);
      if (bad) throw new Error(bad);
      item.file = file;
      if (file !== raw) { name.textContent = file.name; size.textContent = sizeText(file.size); item.el.title = file.name; }
      if (thumb.tagName === 'IMG') { const r = new FileReader(); r.onload = () => { thumb.src = r.result; }; r.readAsDataURL(file); }
      return upload(slug, file, (p) => { bar.style.width = `${Math.round(p * 100)}%`; });
    })
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
