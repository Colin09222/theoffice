// A floor's room passing between the 3D tower and its floor page, so neither side builds it again: 'in' when the camera has flown into
// a floor, 'out' when Back flies out of one. Only one is ever held, and one nobody collects is thrown away after a few seconds.
let held = null, timer = null;

export function handOver(kind, slug, payload) {
  drop();
  held = { kind, slug, ...payload };
  timer = setTimeout(drop, 6000);
}
export function peekHandoff(kind, slug) { return !!held && held.kind === kind && (!slug || held.slug === slug); }
export function takeHandoff(kind, slug) {
  if (!peekHandoff(kind, slug)) return null;
  const h = held; held = null; clearTimeout(timer);
  return h;
}
function drop() {
  clearTimeout(timer);
  if (held?.view && !held.view.dead) held.view.destroy();
  held = null;
}
