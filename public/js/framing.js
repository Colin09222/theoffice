// Where a floor's camera starts. Plain sums with no three.js, so a test can run them: as close as the screen allows while the people who
// work here stay in view, and when they are too spread out for that, the biggest group of them, with the rest a drag away.

/** Screen position of a spot on the floor, in floor units: `u` across, `s` down the screen. */
export const onScreen = ([x, z], yaw, pitch) => ({ u: x * Math.cos(yaw) - z * Math.sin(yaw), s: (x * Math.sin(yaw) + z * Math.cos(yaw)) * Math.sin(pitch) });

/** The world spot to aim at so a screen position in floor units lands in the middle of the free area. */
export function aimAt(u, s, yaw, pitch, eye = 0.8) {
  const v = (s + eye * Math.cos(pitch)) / Math.sin(pitch);
  return [u * Math.cos(yaw) + v * Math.sin(yaw), -u * Math.sin(yaw) + v * Math.cos(yaw)];
}

/**
 * The tightest framing for these spots. `tall` is a person's height in floor units; `top` the pixels to keep clear above the topmost head for
 * speech bubbles and `pad` the pixels at the other three edges. `ppuMax` and `ppuMin` bound how many pixels a floor unit can be.
 * Returns the pixels per unit, the aim on the floor, and how many of the spots made it into frame.
 */
export function frameCrew(spots, { yaw, pitch, visW, visH, tall, top = 90, pad = 26, ppuMax, ppuMin }) {
  const pts = spots.map((p) => onScreen(p, yaw, pitch));
  const head = tall * Math.cos(pitch);
  const fits = (list, ppu) => {
    const us = list.map((p) => p.u), ss = list.map((p) => p.s);
    return (Math.max(...us) - Math.min(...us)) * ppu + 2 * pad <= visW && (Math.max(...ss) - Math.min(...ss) + head) * ppu + top + pad <= visH;
  };
  // Everybody, if they can all be in frame at a size worth looking at.
  let ppu = ppuMax;
  while (ppu > ppuMin && !fits(pts, ppu)) ppu = Math.max(ppuMin, ppu * 0.97);
  let chosen = pts;
  if (!fits(pts, ppu)) {
    // Too spread out: the largest group that fits, and of equal groups the tightest. The rest are a drag away, not squeezed in at the edge of the picture.
    const w = (visW - 2 * pad) / ppu, h = (visH - top - pad) / ppu - head;
    const span = (g) => Math.max(...g.map((p) => p.u)) - Math.min(...g.map((p) => p.u)) + (Math.max(...g.map((p) => p.s)) - Math.min(...g.map((p) => p.s)));
    let best = [];
    for (const a of pts) for (const b of pts) {
      const group = pts.filter((p) => p.u >= a.u - 1e-6 && p.u <= a.u + w && p.s >= b.s - 1e-6 && p.s <= b.s + h);
      if (group.length > best.length || (group.length === best.length && group.length && span(group) < span(best))) best = group;
    }
    chosen = best.length ? best : pts.slice(0, 1);
  }
  const us = chosen.map((p) => p.u), ss = chosen.map((p) => p.s);
  const u = (Math.min(...us) + Math.max(...us)) / 2;
  // The group sits a little low in the frame, because their words go above them.
  const s = (Math.min(...ss) - head + Math.max(...ss)) / 2 - (top - pad) / 2 / ppu;
  return { ppu, u, s, framed: chosen.length, of: pts.length };
}
