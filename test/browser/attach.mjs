// The boss's files in a real browser: the paperclip takes a picture, it goes up, the boss sends it, and the chat shows it
// as a thumbnail served back to the boss alone, live and again after a reload. A visitor asking for it gets nothing.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { launch } from './cdp.mjs';
import { boot, Client } from '../helpers.js';
import { get } from '../../server/db.js';
import { imageSize } from '../../server/attachments.js';

// A real 8x8 picture, so the browser has to decode it, not just accept the bytes.
const chunk = (type, data) => { const td = Buffer.concat([Buffer.from(type), data]); const n = Buffer.alloc(8); n.writeUInt32BE(data.length, 0); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([n.subarray(0, 4), td, c]); };
const ihdr = Buffer.from([0, 0, 0, 8, 0, 0, 0, 8, 8, 2, 0, 0, 0]);
const rows = Buffer.concat(Array.from({ length: 8 }, () => Buffer.from([0, ...Array.from({ length: 8 }, () => [200, 60, 20]).flat()])));
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
// Any size of picture, RGB or RGBA, with each pixel set by px(bytes, at, x, y).
const picture = (w, hgt, alpha, px) => {
  const ch = alpha ? 4 : 3, stride = 1 + w * ch, raw = Buffer.alloc(stride * hgt);
  for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) px(raw, y * stride + 1 + x * ch, x, y);
  const head = Buffer.alloc(13); head.writeUInt32BE(w, 0); head.writeUInt32BE(hgt, 4); head[8] = 8; head[9] = alpha ? 6 : 2;
  return Buffer.concat([PNG.subarray(0, 8), chunk('IHDR', head), chunk('IDAT', deflateSync(raw, { level: 1 })), chunk('IEND', Buffer.alloc(0))]);
};
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); if (!ok) failures++; };
const step = async (name, fn) => { try { await fn(); check(name, true); } catch (e) { check(name, false, e.message); } };
const q = (s) => JSON.stringify(s);

const t = await boot({ mockDelayMs: 200, rateScale: 50 });
const base = `http://localhost:${t.port}/theoffice`;
const dir = mkdtempSync(join(tmpdir(), 'officeattach-'));
const file = join(dir, 'shop front.png');
writeFileSync(file, PNG);
const b = await launch();
const p = await b.newPage({ width: 1280, height: 860 });
let slug = '', id = '';
const thumbShown = '(() => { const i = document.querySelector(".msg.boss .msg-attachments img"); return !!i && i.complete && i.naturalWidth > 0; })()';
try {
  await step('the boss claims a floor in the browser', async () => {
    await p.goto(`${base}/robots.txt`);
    const made = await p.ev(`fetch('/theoffice/api/claim',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:${q(t.code())},name:'Paper Clip Co',bossName:'Boss',colors:{primary:'#aa3300',accent:'#ffcc00'}})}).then((r) => r.json())`);
    if (!made?.slug) throw new Error(`claim: ${JSON.stringify(made).slice(0, 120)}`);
    slug = made.slug;
    await p.goto(`${base}/floor/${slug}`);
    await p.click('[data-tab=chat]');
    await p.until('!!document.querySelector(".chat-input [data-attach]")', 'the paperclip');
  });
  await step('the paperclip takes a picture and it goes up', async () => {
    const { root } = (await p.send('DOM.getDocument', { depth: 1 })).result;
    const { nodeId } = (await p.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.chat-input input[type=file]' })).result;
    await p.send('DOM.setFileInputFiles', { nodeId, files: [file] });
    await p.until('!!document.querySelector(".attach-chip:not(.uploading)")', 'the upload finishing');
  });
  await step('sending it shows the thumbnail in the chat straight away', async () => {
    await p.type('.chat-input textarea', 'This is the shop');
    await p.click('.send');
    await p.until('[...document.querySelectorAll(".msg.boss")].some((m) => /the shop/.test(m.textContent))', 'the boss message');
    await p.until('!!document.querySelector(".msg.boss .msg-attachments img")', 'an attachment on the live message');
    await p.until(thumbShown, 'the thumbnail loading');
    id = decodeURIComponent((await p.ev('document.querySelector(".msg.boss .msg-attachments img").getAttribute("src")')).split('/').pop());
    if (!/^u[A-Za-z0-9_-]{12}$/.test(id)) throw new Error(`id ${id}`);
    if (!await p.ev('document.querySelector(".attach-tray").hidden')) throw new Error('the tray did not clear');
  });
  await step('the thumbnail comes back from the history after a reload', async () => {
    await p.goto(`${base}/floor/${slug}`);
    await p.click('[data-tab=chat]');
    await p.until(thumbShown, 'the thumbnail, from history');
  });
  await step('a visitor asking for the file gets nothing', async () => {
    const r = await new Client(t).get(`/api/floors/${slug}/attachments/${encodeURIComponent(id)}`);
    if (![401, 403, 404].includes(r.status)) throw new Error(`status ${r.status}`);
  });
  // A photo is made small in the page before it goes up, so these look at what the server actually got.
  const pick = async (name, bytes) => {
    const path = join(dir, name); writeFileSync(path, bytes);
    const before = get(t.db, 'SELECT COUNT(*) n FROM attachments').n;
    const { root } = (await p.send('DOM.getDocument', { depth: 1 })).result;
    const { nodeId } = (await p.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.chat-input input[type=file]' })).result;
    await p.send('DOM.setFileInputFiles', { nodeId, files: [path] });
    for (const end = Date.now() + 20000; get(t.db, 'SELECT COUNT(*) n FROM attachments').n === before;) {
      if (Date.now() > end) throw new Error(`${name} never arrived`);
      await new Promise((r) => setTimeout(r, 100));
    }
    const a = get(t.db, 'SELECT a.name, a.type, a.size, f.content FROM attachments a JOIN files f ON f.floor_id=a.floor_id AND f.path=a.path ORDER BY a.rowid DESC LIMIT 1');
    const { content, ...rest } = a;
    return { ...rest, ...imageSize(content) };
  };
  const said = (a) => JSON.stringify(a).slice(0, 160);
  await step('a wide picture goes up as a JPEG at most 2400 px across', async () => {
    const a = await pick('wide shop.png', picture(3200, 1800, false, (px, i, x, y) => { px[i] = x & 255; px[i + 1] = y & 255; px[i + 2] = 128; }));
    if (a.name !== 'wide shop.jpg' || a.type !== 'image/jpeg' || a.width !== 2400 || a.height !== 1350) throw new Error(said(a));
  });
  await step('a heavy photo is made small even when it is not wide', async () => {
    let s = 7;
    const heavy = picture(2000, 1500, false, (px, i) => { for (let k = 0; k < 3; k++) { s = (Math.imul(s, 1103515245) + 12345) >>> 0; px[i + k] = s >>> 24; } });
    const a = await pick('heavy.png', heavy);
    if (a.name !== 'heavy.jpg' || a.type !== 'image/jpeg' || a.width !== 2000 || a.size >= heavy.length || heavy.length < 1.5 * 1048576) throw new Error(said({ ...a, was: heavy.length }));
  });
  await step('a see-through PNG under 4 MB goes up as it is', async () => {
    const clear = picture(3000, 200, true, (px, i, x) => { px[i] = 200; px[i + 1] = 60; px[i + 2] = 20; px[i + 3] = x < 1500 ? 0 : 255; });
    const a = await pick('logo.png', clear);
    if (a.name !== 'logo.png' || a.type !== 'image/png' || a.size !== clear.length || a.width !== 3000) throw new Error(said(a));
  });
  await step('a HEIC this browser cannot open is refused with a clear message', async () => {
    const before = get(t.db, 'SELECT COUNT(*) n FROM attachments').n;
    const path = join(dir, 'IMG_0001.HEIC'); writeFileSync(path, Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(64)]));
    const { root } = (await p.send('DOM.getDocument', { depth: 1 })).result;
    const { nodeId } = (await p.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.chat-input input[type=file]' })).result;
    await p.send('DOM.setFileInputFiles', { nodeId, files: [path] });
    await p.until('[...document.querySelectorAll(".toast")].some((e) => /HEIC photo/.test(e.textContent))', 'the HEIC message');
    if (get(t.db, 'SELECT COUNT(*) n FROM attachments').n !== before) throw new Error('it was uploaded anyway');
  });
  const errors = p.errors.filter((e) => !/favicon\.ico/.test(e));
  check('no page errors', !errors.length, errors.slice(0, 3).join(' | ').slice(0, 300));
} finally {
  p.close(); b.close();
  await t.close();
}
console.log(failures ? `${failures} failed` : 'all passed');
process.exit(failures ? 1 : 0);
