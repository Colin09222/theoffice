// Name pills and speech bubbles when people bunch up. The solver is plain layout with no DOM, so a test can run it: nearer people keep
// their name where it is and farther names lift clear; bubbles go in by importance, on whichever side has room, and one with no room
// waits its turn rather than cover someone else's. The caller eases the lifts and runs this a few times a second, not every frame.

const hit = (a, b, pad = 1) => a.x0 < b.x1 + pad && a.x1 > b.x0 - pad && a.y0 < b.y1 + pad && a.y1 > b.y0 - pad;
const NAME_GAP = 2, BUBBLE_GAP = 5;

export function layoutLabels(items, { width = Infinity, top = 0, maxLift = 60 } = {}) {
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
    out.set(it.id, { lift, side: it.side, bubble: false });
  }
  const wanted = near.filter((it) => it.bubbleW > 0).sort((a, b) => b.priority - a.priority);
  for (const it of wanted) {
    const o = out.get(it.id);
    const y1 = it.y - o.lift - it.nameH - BUBBLE_GAP, y0 = y1 - it.bubbleH;
    const fit = (side) => {
      const left = it.x - it.nameW / 2;
      const b = side === 'right' ? { x0: left + it.nameW * 0.58, x1: left + it.nameW * 0.58 + it.bubbleW, y0, y1 } : { x0: left + it.nameW * 0.42 - it.bubbleW, x1: left + it.nameW * 0.42, y0, y1 };
      return b.x0 >= 2 && b.x1 <= width - 2 && y0 >= top && !boxes.some((p) => hit(b, p)) ? b : null;
    };
    const other = it.side === 'left' ? 'right' : 'left';
    const b1 = fit(it.side), b2 = b1 ? null : fit(other);
    if (b1 || b2) { boxes.push(b1 || b2); o.bubble = true; o.side = b1 ? it.side : other; }
  }
  return out;
}

const RANK = { talking: 3, typing: 2, browsing: 2 };
let ticks = 0;
/** Reads each actor's label, solves, and writes back lifts, sides and which bubbles have room. */
export function tidyLabels(actors, viewWidth) {
  if (++ticks % 10) return;
  const now = performance.now();
  const panel = document.querySelector('.floor-panel')?.getBoundingClientRect();
  const width = panel && panel.top < 200 ? panel.left : viewWidth;
  const items = [];
  for (const a of actors.values()) {
    if (a.tagX === undefined) continue;
    const showing = !a.bubble.hidden;
    a.nameW ||= a.nameEl.offsetWidth; a.nameH ||= a.nameEl.offsetHeight;
    // A bubble set aside has no size of its own to measure, so its width is estimated from its words. Either way this reads layout only a few times a second.
    const bw = showing ? a.bubble.offsetWidth || Math.min(150, 26 + a.bubble.textContent.length * 5.6) : 0;
    items.push({ id: a, x: a.tagX, y: a.tagY, nameW: a.nameW, nameH: a.nameH, bubbleW: bw, bubbleH: showing ? a.bubble.offsetHeight || 22 : 0, z: a.tagZ || 0, side: a.tag.dataset.side || 'right', priority: RANK[a.state] || 1 });
  }
  const solved = layoutLabels(items, { width });
  for (const [a, o] of solved) {
    a.lift = o.lift;
    if (o.side !== a.tag.dataset.side) a.tag.dataset.side = o.side;
    // A bubble that has been shown stays a moment, so two people passing don't make it flicker.
    if (o.bubble) a.bubbleSince = now;
    const crowded = !o.bubble && !a.bubble.hidden && now - (a.bubbleSince || 0) > 900;
    if (crowded !== a.tag.classList.contains('crowded')) a.tag.classList.toggle('crowded', crowded);
  }
}
