// One skin (docs/redesign/OFFICE-ANSWERS-1.md, section 3): 8 colours, 2 fonts, self-hosted, and every text pair readable at 4.5 to 1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../server/config.js';

const PUB = join(ROOT, 'public');
const skin = readFileSync(join(PUB, 'css/skin.css'), 'utf8');
const PALETTE = { paper: '#F6F1E7', card: '#FFFDF8', ink: '#1F2430', red: '#C93A24', amber: '#F2A33A', teal: '#17766F', slate: '#5B6270', line: '#E3DBCB' };
const WHITE = '#FFFFFF';

const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = (hex) => { const n = Number.parseInt(hex.slice(1), 16); return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
export const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('the palette is the spec\'s 8 colours, as CSS variables', () => {
  for (const [name, hex] of Object.entries(PALETTE)) assert.match(skin, new RegExp(`--c-${name}: ${hex};`, 'i'), name);
});

test('the skin uses no colour outside the palette (white text on the main button aside)', () => {
  const allowed = new Set([...Object.values(PALETTE), WHITE, '#FFF'].map((c) => c.toUpperCase()));
  // Inside declarations only, so a selector like #fade is not read as a colour.
  const decls = [...skin.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/{([^{}]*)}/g)].map((m) => m[1]).join(';');
  const used = [...decls.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((m) => m[0].toUpperCase());
  assert.ok(used.length >= 8);
  for (const c of used) assert.ok(allowed.has(c), `${c} is not in the palette`);
});

test('every text and background pair the skin uses is at least 4.5 to 1', () => {
  // [text, background, where]
  const pairs = [
    [PALETTE.ink, PALETTE.paper, 'body text on the page'],
    [PALETTE.ink, PALETTE.card, 'text on a card'],
    [PALETTE.slate, PALETTE.card, 'labels on a card'],
    [PALETTE.slate, PALETTE.paper, 'labels on the page'],
    [PALETTE.teal, PALETTE.card, 'links on a card'],
    [PALETTE.teal, PALETTE.paper, 'links on the page'],
    [WHITE, PALETTE.red, 'the main button, Waiting on boss'],
    [PALETTE.red, PALETTE.card, 'an outlined warning button'],
    [PALETTE.ink, PALETTE.amber, 'Working badge, ticker label'],
    [WHITE, PALETTE.slate, 'Paused badge'],
    [PALETTE.card, PALETTE.ink, 'the dark ticker, toasts'],
    [PALETTE.amber, PALETTE.ink, 'launches on the ticker'],
    [PALETTE.line, PALETTE.ink, 'small talk on the ticker'],
    [PALETTE.ink, PALETTE.line, 'the demo tag'],
    [WHITE, PALETTE.teal, 'white on teal'],
  ];
  for (const [fg, bg, where] of pairs) {
    const r = contrast(fg, bg);
    assert.ok(r >= 4.5, `${where}: ${fg} on ${bg} is ${r.toFixed(2)}:1`);
  }
});

test('two families, self-hosted woff2, and no font fetched from Google at run time', () => {
  const faces = new Set([...skin.matchAll(/@font-face\s*{\s*font-family:\s*"?([^";]+)"?;\s*src:\s*url\(([^)]+)\)/g)].map((m) => { assert.match(m[2], /^\/theoffice\/assets\/fonts\/[a-z0-9-]+\.woff2$/); return m[2]; }));
  assert.deepEqual([...faces].sort(), ['/theoffice/assets/fonts/bricolage-grotesque-latin-wght.woff2', '/theoffice/assets/fonts/dm-sans-latin-wght.woff2']);
  assert.deepEqual(readdirSync(join(PUB, 'assets/fonts')).sort(), ['bricolage-grotesque-latin-wght.woff2', 'dm-sans-latin-wght.woff2']);
  for (const f of readdirSync(join(PUB, 'css'))) assert.doesNotMatch(readFileSync(join(PUB, 'css', f), 'utf8'), /fonts\.(googleapis|gstatic)\.com/, f);
  const page = readFileSync(join(PUB, 'index.html'), 'utf8');
  assert.doesNotMatch(page, /fonts\.(googleapis|gstatic)\.com/);
  assert.match(page, /css\/skin\.css/);
  // Loaded last, so its look wins over every older sheet.
  const sheets = [...page.matchAll(/href="\/theoffice\/css\/([a-z0-9-]+)\.css"/g)].map((m) => m[1]);
  assert.equal(sheets.at(-1), 'skin');
});

test('one card, one button, one badge with the four states', () => {
  assert.match(skin, /--card-r: 14px/);
  assert.match(skin, /border: 1px solid var\(--c-line\); border-radius: var\(--card-r\); box-shadow: var\(--card-shadow\)/);
  for (const s of ['working', 'waiting', 'idle', 'paused']) assert.match(skin, new RegExp(`\\.badge\\[data-state="${s}"\\]`));
  assert.match(skin, /\.btn\.primary[^{]*{[^}]*background: var\(--c-red\); color: #fff/);
});
