// The boss's files in a real browser: the paperclip takes a picture, it goes up, the boss sends it, and the chat shows it
// as a thumbnail served back to the boss alone, live and again after a reload. A visitor asking for it gets nothing.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { launch } from './cdp.mjs';
import { boot, Client } from '../helpers.js';

// A real 8x8 picture, so the browser has to decode it, not just accept the bytes.
const chunk = (type, data) => { const td = Buffer.concat([Buffer.from(type), data]); const n = Buffer.alloc(8); n.writeUInt32BE(data.length, 0); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([n.subarray(0, 4), td, c]); };
const ihdr = Buffer.from([0, 0, 0, 8, 0, 0, 0, 8, 8, 2, 0, 0, 0]);
const rows = Buffer.concat(Array.from({ length: 8 }, () => Buffer.from([0, ...Array.from({ length: 8 }, () => [200, 60, 20]).flat()])));
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
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
  const errors = p.errors.filter((e) => !/favicon\.ico/.test(e));
  check('no page errors', !errors.length, errors.slice(0, 3).join(' | ').slice(0, 300));
} finally {
  p.close(); b.close();
  await t.close();
}
console.log(failures ? `${failures} failed` : 'all passed');
process.exit(failures ? 1 : 0);
