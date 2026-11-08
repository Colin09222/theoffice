// Name pills and speech bubbles when people bunch up. The solver is plain layout with no DOM, so a test can run it: nearer people keep
// their name where it is and farther names lift clear; bubbles go in by importance, on whichever side has room, and one with no room
// waits its turn rather than cover someone else's or the page's own controls. The caller eases the lifts and runs this a few times a second, not every frame.

const hit = (a, b, pad = 1) => a.x0 < b.x1 + pad && a.x1 > b.x0 - pad && a.y0 < b.y1 + pad && a.y1 > b.y0 - pad;
const NAME_GAP = 2, BUBBLE_GAP = 5, RISE = [0, 18, 36, 54, 72, 96], SLIDE = [0, 28, 56, 84, 112];

/**
 * `calm` is the phone's rule: no towers of lifted names, so a name with no room of its own just doesn't show, unless its owner is talking or was tapped (`full`).
 * `blocks` are rectangles of the page (the header, the lift, a banner) that nothing here may touch, `top` and `bottom` limit the room labels have,
 * and `maxBubbles` says how many bubbles can be up at once. Returns for each item its lift, side, whether its bubble and name show, and where the bubble goes.
 */
export function layoutLabels(items, { width = Infinity, minX = 0, top = 0, bottom = Infinity, maxLift = 60, blocks = [], calm = false, maxBubbles = Infinity } = {}) {
  const out = new Map(), boxes = [];
  const inside = (b) => b.x0 >= minX && b.x1 <= width && b.y0 >= top && b.y1 <= bottom;
  const near = [...items].sort((a, b) => (b.full ? 1 : 0) - (a.full ? 1 : 0) || b.z - a.z);
  for (const it of near) {
    const box = (lift) => ({ x0: it.x - it.nameW / 2, x1: it.x + it.nameW / 2, y0: it.y - it.nameH - lift, y1: it.y - lift });
    let lift = 0, name = true;
    if (calm && !it.full) {
      const b = box(0);
      name = inside(b) && !boxes.some((p) => hit(b, p)) && !blocks.some((p) => hit(b, p));
    } else {
      for (let guard = 0; guard < items.length + 2; guard++) {
        const b = box(lift), block = boxes.find((p) => hit(b, p));
        if (!block) break;
        lift = it.y - block.y0 + NAME_GAP;
      }
      if (lift > maxLift) { lift = maxLift; if (!it.full && boxes.some((p) => hit(box(lift), p))) name = false; }
      if (name && !it.full && blocks.some((p) => hit(box(lift), p))) name = false;  // never tucked under the card or the lift
    }
    if (name) boxes.push(box(lift));
    out.set(it.id, { lift, side: it.side, name, bubble: false, bx: 0, by: 0 });
  }
  const wanted = near.filter((it) => it.bubbleW > 0).sort((a, b) => b.priority - a.priority || (b.sticky ? 1 : 0) - (a.sticky ? 1 : 0) || b.z - a.z);
  let shown = 0;
  for (const it of wanted) {
    if (shown >= maxBubbles) break;
    if (it.x < minX || it.x > width || it.y < top || it.y > bottom) continue;  // someone off the edge of the room says it in the Talk tab
    const o = out.get(it.id);
    const left = it.x - it.nameW / 2, base = it.y - o.lift - it.nameH - BUBBLE_GAP;
    const other = it.side === 'left' ? 'right' : 'left';
    // Least movement first: where it belongs, then the other side, then edging out and up past whoever is in the way.
    const tries = [];
    for (const side of [it.side, other]) for (const dy of RISE) for (const dx of SLIDE) tries.push({ side, dx, dy, cost: dx + dy + (side === it.side ? 0 : 1) });
    tries.sort((a, b) => a.cost - b.cost);
    for (const t of tries) {
      const y1 = base - t.dy, y0 = y1 - it.bubbleH;
      const b = t.side === 'right'
        ? { x0: left + it.nameW * 0.58 + t.dx, x1: left + it.nameW * 0.58 + t.dx + it.bubbleW, y0, y1 }
        : { x0: left + it.nameW * 0.42 - t.dx - it.bubbleW, x1: left + it.nameW * 0.42 - t.dx, y0, y1 };
      if (b.x0 < minX + 2 || b.x1 > width - 2 || y0 < top || y1 > bottom || boxes.some((p) => hit(b, p)) || blocks.some((p) => hit(b, p))) continue;
      boxes.push(b); o.bubble = true; o.side = t.side; o.bx = t.side === 'right' ? t.dx : -t.dx; o.by = t.dy; shown++;
      break;
    }
  }
  return out;
}

const RANK = { talking: 3, typing: 2, browsing: 2 };
/** A bubble that isn't drawn has no size to measure, so it is estimated from its words: wider up to the bubble's limit, then taller. */
const estimate = (a, calm) => {
  const n = a.bubble.textContent.length, most = a.speech ? (calm ? 190 : 240) : (calm ? 132 : 176), per = a.speech ? (calm ? 6.6 : 7.2) : 5.8;
  const w = Math.min(most, 24 + n * per), lines = Math.max(1, Math.ceil((n * per) / (most - 22)));
  return [w, 14 + Math.min(calm ? 3 : 5, lines) * (calm ? 16 : 18)];
};
let solvedAt = 0;
/** Reads each actor's label, solves, and writes back lifts, sides and which bubbles have room. Paced on the clock, so a slow device tidies as often as a fast one. */
export function tidyLabels(actors, viewWidth) {
  const now = performance.now();
  if (now - solvedAt < 160) return;
  solvedAt = now;
  const calm = viewWidth <= 760;
  // A docked panel and the company card take their share of the screen. A closed panel has no size, and a phone's sheet is out of the way below.
  const panel = document.querySelector('.floor-panel')?.getBoundingClientRect();
  const card = document.querySelector('.floor-top')?.getBoundingClientRect();
  const width = panel?.width && panel.top < 200 && !calm ? panel.left : viewWidth;
  const left = !calm && card?.width && card.width < viewWidth * 0.5 ? card.right : 0;
  const bottom = calm && panel?.height ? panel.top : Infinity;
  // Nothing goes over the page's own pieces: the header card, the lift and any banner. The labels draw under them, so a label there would be cut off.
  const blocks = [];
  for (const sel of ['.floor-top', '.floor-scrubber', '.visitor-note', '.talk-pill:not([hidden])', '.journey-slot > *']) {
    const r = document.querySelector(sel)?.getBoundingClientRect();
    if (r?.width && r.height) blocks.push({ x0: r.left - 4, y0: r.top - 4, x1: r.right + 4, y1: r.bottom + 4 });
  }
  const items = [];
  for (const a of actors.values()) {
    if (a.tagX === undefined) continue;
    const showing = !a.bubble.hidden;
    // Their job and full name are for whoever is talking or tapped; a phone would otherwise be a wall of badges.
    const full = !!a.speech || a.view.selected === a.id;
    if (full !== a.full) { a.full = full; a.tag.classList.toggle('full', full); a.nameW = 0; a.nameH = 0; a.renderBubble?.(); }
    a.nameW ||= a.tag.offsetWidth; a.nameH ||= a.tag.offsetHeight;
    const drawn = showing && !a.tag.classList.contains('crowded');
    const [bw, bh] = showing ? (drawn && a.bubble.offsetWidth ? [a.bubble.offsetWidth, a.bubble.offsetHeight] : estimate(a, calm)) : [0, 0];
    items.push({ id: a, x: a.tagX, y: a.tagY, nameW: a.nameW, nameH: a.nameH, bubbleW: bw, bubbleH: bh, z: a.tagZ || 0, side: a.tag.dataset.side || 'right', priority: a.speech ? 9 : RANK[a.state] || 1, full, sticky: drawn });
  }
  const solved = layoutLabels(items, { width, minX: left, top: 4, bottom, blocks, calm, maxBubbles: calm ? 2 : 6 });
  for (const [a, o] of solved) {
    a.lift = o.lift;
    if (o.side !== a.tag.dataset.side) a.tag.dataset.side = o.side;
    if (!a.speech && a.bx !== a.solvedX) { a.bx = a.solvedX; a.bubble.style.setProperty('--bx', `${a.bx || 0}px`); }  // the nudge below is only for as long as the line lasts
    if (o.bubble && (o.bx !== a.solvedX || o.by !== a.by)) { a.solvedX = a.bx = o.bx; a.by = o.by; a.bubble.style.setProperty('--bx', `${o.bx}px`); a.bubble.style.setProperty('--by', `${-o.by}px`); }
    const crowded = !o.bubble && !a.bubble.hidden;
    if (crowded !== a.tag.classList.contains('crowded')) a.tag.classList.toggle('crowded', crowded);
    const noName = !o.name;
    if (noName !== a.tag.classList.contains('no-name')) a.tag.classList.toggle('no-name', noName);
  }
}
