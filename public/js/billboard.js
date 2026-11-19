// The crown billboard (round 2, r2-j37; docs/redesign/OFFICE-ANSWERS-2.md, Q6): the 3 hero launches on the tower's crown, 6 s each with a 0.6 s
// fade, one 512 by 320 picture each. It is fed from the same list as the home hero (/api/building/hero), so it can never disagree with it.
// Not shown on "low" or on a phone (Q9). The timing is pure, so a node test can run it on a fake clock; the drawing is a canvas texture.

export const W = 512, H = 320, HOLD_MS = 6000, FADE_MS = 600, MAX = 3;

/** Which pictures, in order: the hero list's screenshots (or drawn cards), no repeats, 3 at most. */
export function billboardImages(projects) {
  const out = [];
  for (const pr of projects || []) { const u = pr?.thumb; if (typeof u === 'string' && u && !out.includes(u)) out.push(u); }
  return out.slice(0, MAX);
}

/** What the billboard shows `ms` after it started: picture `index`, fading to `next` by `mix` (0 to 1) in the last 0.6 s of each 6 s. */
export function billboardFrame(ms, count) {
  if (count < 1) return { index: -1, next: -1, mix: 0 };
  if (count === 1) return { index: 0, next: 0, mix: 0 };
  const index = Math.floor(ms / HOLD_MS) % count, into = ms % HOLD_MS;
  const mix = into > HOLD_MS - FADE_MS ? (into - (HOLD_MS - FADE_MS)) / FADE_MS : 0;
  return { index, next: (index + 1) % count, mix };
}

/**
 * The drawing: a 512 x 320 canvas that cross-fades the loaded pictures. `draw(ms)` repaints only while a fade is running or the picture
 * changed, and returns true when the canvas changed (so the texture is re-uploaded only then).
 */
export function makeBillboard(doc = document) {
  const canvas = doc.createElement('canvas'); canvas.width = W; canvas.height = H;
  const x = canvas.getContext('2d');
  let images = [], start = 0, lastKey = '';
  const cover = (img, alpha) => {
    if (!img?.naturalWidth) return;
    const s = Math.max(W / img.naturalWidth, H / img.naturalHeight), w = img.naturalWidth * s, h = img.naturalHeight * s;
    x.globalAlpha = alpha; x.drawImage(img, (W - w) / 2, 0, w, h); x.globalAlpha = 1;  // top of the page, as on the launch cards
  };
  const blank = () => { x.fillStyle = '#23242e'; x.fillRect(0, 0, W, H); x.strokeStyle = '#c9a86a'; x.lineWidth = 8; x.strokeRect(4, 4, W - 8, H - 8); };
  blank();
  return {
    canvas,
    get count() { return images.length; },
    /** New pictures: loaded first, so the board never shows a half-drawn one. Resolves once they are in. */
    async set(urls, now = 0) {
      const loaded = await Promise.all(urls.map((u) => new Promise((res) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = () => res(null); im.src = u; })));
      images = loaded.filter(Boolean); start = now; lastKey = '';
      return images.length;
    },
    draw(now) {
      const f = billboardFrame(now - start, images.length);
      const key = f.index < 0 ? 'none' : f.mix > 0 ? `${f.index}>${f.next}:${f.mix.toFixed(3)}` : `${f.index}`;
      if (key === lastKey) return false;
      lastKey = key;
      blank();
      if (f.index >= 0) { cover(images[f.index], 1); if (f.mix > 0) cover(images[f.next], f.mix); }
      return true;
    },
    frame: (now) => billboardFrame(now - start, images.length),
  };
}
