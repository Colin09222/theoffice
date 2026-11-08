// Run inside the page. Everything a person can see in the UI layers, and what's wrong with it.
export const AUDIT = (name, { portrait }) => `(() => {
  const vw = innerWidth, vh = innerHeight, bad = [];
  const say = (el) => (el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/).slice(0, 3).join('.') : '') + ' "' + (el.value || el.textContent || '').trim().slice(0, 28) + '"');
  const visible = (el) => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const s = getComputedStyle(el); if (s.visibility === 'hidden' || s.display === 'none' || +s.opacity === 0) return false; return !el.closest('[hidden]'); };
  // A dialog covers the page on purpose: then it's the dialog that's being checked.
  const dialog = document.querySelector('.modal-back, [data-setup-flow]');
  const more = document.querySelector('.tabs.more-open .more-pop');
  const roots = dialog ? [dialog] : more ? [more] : [document.querySelector('#ui'), ...document.querySelectorAll('#toasts')].filter(Boolean);
  const all = roots.flatMap((r) => [r, ...r.querySelectorAll('*')]).filter((el) => !(el instanceof SVGElement) && visible(el));
  if (document.documentElement.scrollWidth > vw + 1 || document.body.scrollWidth > vw + 1) bad.push('the page scrolls sideways: ' + document.documentElement.scrollWidth);
  // Past the right edge, unless it scrolls with its row, like the buttons over the room.
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 || r.left < -1) {
      const s = el.closest('.controls, .ticker-rail, .ticker, .staff-strip');
      if (!s) bad.push('past the edge: ' + say(el) + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
    }
  }
  // Sideways scrolling inside the page: a list that wants a finger dragged sideways.
  for (const el of all) { const s = getComputedStyle(el); if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1 && !el.matches('.controls, pre, .table-wrap, .ticker-rail')) bad.push('sideways scroller: ' + say(el) + ' ' + el.scrollWidth + '>' + el.clientWidth); }
  // Text cut off inside a control.
  for (const el of all) {
    if (!el.matches('button, .btn, .chip, .tab, a.btn, input[type=submit]')) continue;
    const s = getComputedStyle(el);
    if ((s.overflowX !== 'visible' || s.textOverflow === 'ellipsis') && el.scrollWidth > el.clientWidth + 1) bad.push('clipped text: ' + say(el) + ' ' + el.scrollWidth + '>' + el.clientWidth);
    if (s.overflowY !== 'visible' && el.scrollHeight > el.clientHeight + 2 && el.childElementCount < 4) bad.push('clipped text (lines): ' + say(el) + ' ' + el.scrollHeight + '>' + el.clientHeight);
  }
  // Primary controls: big enough for a thumb, and a scroll away at most.
  const primary = all.filter((el) => el.matches('.setup-choice, .floor-panel > .tabs .tab, .btn:not(.small):not(.link), .send, .attach, .sheet-step, .launch-type, .launch-card, .icon-btn, .scrub-btn:not(:disabled)'));
  for (const el of primary) {
    const r = el.getBoundingClientRect();
    if (${portrait ? 'true' : 'false'} && Math.min(r.width, r.height) < 43.5) bad.push('tap target ' + Math.round(r.width) + 'x' + Math.round(r.height) + ': ' + say(el));
  }
  const sheetScroll = [...document.querySelectorAll('.floor-panel')].map((e) => e.scrollTop).join();
  const scrollers = [...document.querySelectorAll('.chat-list, .talk-list, .feed, .board, .gallery, .requests, .orders, .modal-body')].map((e) => [e, e.scrollTop]);
  for (const el of primary) {
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x < 0 || x > vw || y < 0 || y > vh) { bad.push('cannot be reached: ' + say(el) + ' at ' + Math.round(x) + ',' + Math.round(y)); continue; }
    const hit = document.elementFromPoint(x, y);
    if (hit && !(el === hit || el.contains(hit) || hit.contains(el))) bad.push('covered: ' + say(el) + ' by ' + say(hit));
  }
  for (const [e, top] of scrollers) e.scrollTop = top;
  if ([...document.querySelectorAll('.floor-panel')].map((e) => e.scrollTop).join() !== sheetScroll) { bad.push('the sheet itself got scrolled: ' + [...document.querySelectorAll('.floor-panel')].map((e) => e.className + ' ' + e.scrollTop + ' sh ' + e.scrollHeight + ' ch ' + e.clientHeight).join(' / ')); for (const e of document.querySelectorAll('.floor-panel')) e.scrollTop = 0; }
  return bad.slice(0, 14);
})()`;

