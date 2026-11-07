// Name pills and speech bubbles when people bunch up. The solver is plain layout with no DOM, so a test can run it: nearer people keep
// their name where it is and farther names lift clear; bubbles go in by importance, on whichever side has room, and one with no room
// waits its turn rather than cover someone else's. The caller eases the lifts and runs this a few times a second, not every frame.

const hit = (a, b, pad = 1) => a.x0 < b.x1 + pad && a.x1 > b.x0 - pad && a.y0 < b.y1 + pad && a.y1 > b.y0 - pad;
const NAME_GAP = 2, BUBBLE_GAP = 5, RISE = [0, 18, 36, 54, 72], SLIDE = [0, 28];

export function layoutLabels(items, { width = Infinity, minX = 0, top = 0, maxLift = 60 } = {}) {
  const out = new Map(), boxes = [];
  const near = [...items].sort((a, b) => b.z - a.z);
  for (const it of near) {
    const box = (lift) => ({ x0: it.x - it.nameW / 2, x1: it.x + it.nameW / 2, y0: it.y - it.nameH - lift, y1: it.y - lift });
    let lift = 0;
    for (let guard = 0; guard < items.length + 2; guard++) {
      const b = box(lift), block = boxes.find((p) => hit(b, p));
      if (!block) break;
      lift = it.y - block.y0 + NAME_GAP;
    }
    if (lift > maxLift) lift = maxLift;
    boxes.push(box(lift));
    out.set(it.id, { lift, side: it.side, bubble: false, bx: 0, by: 0 });
  }
  const wanted = near.filter((it) => it.bubbleW > 0).sort((a, b) => b.priority - a.priority);
  for (const it of wanted) {
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
      if (b.x0 < minX + 2 || b.x1 > width - 2 || y0 < top || boxes.some((p) => hit(b, p))) continue;
      boxes.push(b); o.bubble = true; o.side = t.side; o.bx = t.side === 'right' ? t.dx : -t.dx; o.by = t.dy;
      break;
    }
  }
  return out;
}

const RANK = { talking: 3, typing: 2, browsing: 2 };
let ticks = 0;
/** Reads each actor's label, solves, and writes back lifts, sides and which bubbles have room. */
export function tidyLabels(actors, viewWidth) {
  if (++ticks % 10) return;
  const now = performance.now();
  // A docked panel and the company card take their share of the screen. A closed panel has no size, and a phone's sheet is out of the way below.
  const panel = document.querySelector('.floor-panel')?.getBoundingClientRect();
  const card = document.querySelector('.floor-top')?.getBoundingClientRect();
  const width = panel?.width && panel.top < 200 ? panel.left : viewWidth;
  const left = card?.width && card.width < viewWidth * 0.5 ? card.right : 0;
  const items = [];
  for (const a of actors.values()) {
    if (a.tagX === undefined) continue;
    const showing = !a.bubble.hidden;
    a.nameW ||= a.nameEl.offsetWidth; a.nameH ||= a.nameEl.offsetHeight;
    // A bubble set aside has no size of its own to measure, so its width is estimated from its words. Either way this reads layout only a few times a second.
    const bw = showing ? a.bubble.offsetWidth || Math.min(150, 26 + a.bubble.textContent.length * 5.6) : 0;
    items.push({ id: a, x: a.tagX, y: a.tagY, nameW: a.nameW, nameH: a.nameH, bubbleW: bw, bubbleH: showing ? a.bubble.offsetHeight || 22 : 0, z: a.tagZ || 0, side: a.tag.dataset.side || 'right', priority: a.speech ? 9 : RANK[a.state] || 1 });
  }
  const top = viewWidth <= 760 ? 60 : 0;  // a phone's floor title sits at the top with nothing behind it
  const solved = layoutLabels(items, { width, minX: left, top });
  for (const [a, o] of solved) {
    a.lift = o.lift;
    if (o.side !== a.tag.dataset.side) a.tag.dataset.side = o.side;
    // A bubble that has been shown stays a moment, so two people passing don't make it flicker.
    if (o.bubble) a.bubbleSince = now;
    if (!a.speech && a.bx !== a.solvedX) { a.bx = a.solvedX; a.bubble.style.setProperty('--bx', `${a.bx || 0}px`); }  // the nudge below is only for as long as the line lasts
    if (o.bubble && (o.bx !== a.solvedX || o.by !== a.by)) { a.solvedX = a.bx = o.bx; a.by = o.by; a.bubble.style.setProperty('--bx', `${o.bx}px`); a.bubble.style.setProperty('--by', `${-o.by}px`); }
    // Somebody's words are never set aside. If nowhere is clear they still show, opening toward the middle of the screen.
    if (a.speech && !o.bubble) a.placeSide();
    // However the sums came out, a line someone is saying stays on screen in full.
    if (a.speech) {
      const r = a.bubble.getBoundingClientRect();
      const shift = r.left < left + 4 ? left + 4 - r.left : r.right > width - 4 ? width - 4 - r.right : 0;
      if (Math.abs(shift) > 1) { a.bx = (a.bx || 0) + shift; a.bubble.style.setProperty('--bx', `${a.bx}px`); }
    }
    const crowded = !a.speech && !o.bubble && !a.bubble.hidden && now - (a.bubbleSince || 0) > 900;
    if (crowded !== a.tag.classList.contains('crowded')) a.tag.classList.toggle('crowded', crowded);
  }
}
