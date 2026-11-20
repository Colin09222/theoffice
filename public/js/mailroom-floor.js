// The floor's end of buddehbot's tube (round 2, r2-j51; docs/redesign/OFFICE-ANSWERS-2.md, Q17, Q18 and section 3 animations 2, 3 and 6). Lane B's
// side of a small hook in the room: once the room is open it reads /api/mailroom every 4 s, and for this floor's own items only:
//   - a purchase request appears: a bean walks a folder (the paper they already carry) to the floor's tube point (about 4 s), where it drops in;
//   - Colon presses Send out on a job: the manager carries the folder to the tube point (its COLON APPROVED stamp is r2-j55's);
//   - an item closes: the folder pops out at the tube point and a bean collects it;
//   - a help question needs nothing new here: the manager's phone call to buddehbot already shows.
// The first reading plays nothing (a visitor who comes in late sees the current state only). Every event has its record type and number, or it
// does not play. It READS the feed; it sends nothing anywhere.
import * as THREE from '../vendor/three/three.module.min.js';
import { api } from './dom.js';
import { ROOM_W, ROOM_D } from './layouts.js';
import { diffFeed, playable, WALK_S, LIFT_S } from './mailroom-events.js';
import { makeRobot } from './robot.js';

export const POLL_MS = 4000;  // 4 s, so a folder is in a bean's hand within 10 s even on a slow frame
/** Where the tube comes into a floor: the back corner of the room, where the main tube runs up the side of the tower. */
export const TUBE_POINT = [-ROOM_W / 2 + 0.9, -ROOM_D / 2 + 0.9];

export function mailroomFloor(view, { read = () => api('/mailroom'), now = () => performance.now() } = {}) {
  const number = Number(String(view.root?.name || '').replace('floor-', '')) || null;
  let prev = null, last = -Infinity, busy = false;
  const played = [];
  // The tube point itself: a short brass pipe and its mouth, standing in the corner.
  if (view.root && !view.root.getObjectByName('tube-point')) {
    const brass = new THREE.MeshStandardMaterial({ color: '#c9a86a', roughness: 0.3, metalness: 0.8 });
    const g = new THREE.Group(); g.name = 'tube-point';
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.6, 10), brass); pipe.position.y = 1.3; g.add(pipe);
    const mouth = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.24, 12, 1, true), brass); mouth.position.y = 1.0; mouth.rotation.x = Math.PI / 2.4; g.add(mouth);
    g.position.set(TUBE_POINT[0] - 0.45, 0, TUBE_POINT[1] - 0.45); view.root.add(g);
  }
  const actors = () => [...(view.actors?.values?.() || [])].filter((a) => !a.isBoss && !a.extra);
  const manager = () => actors().find((a) => a.info?.role === 'manager');
  const someone = () => actors().find((a) => a.info?.role !== 'manager') || manager();
  // r2-j55: a contractor job handed back: buddehbot rides the lift up with a box, sets it at the Builder's desk and rides back, 8 s, once.
  let ride = null;
  function deliver(ev) {
    if (ride) return false;
    const builder = actors().find((a) => a.info?.role === 'builder') || manager();
    const to = builder?.seat?.at || [0, 0];
    const bot = makeRobot(); bot.group.scale.setScalar(0.6);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.26, 0.3), new THREE.MeshStandardMaterial({ color: '#b98a55', roughness: 0.9 }));
    box.position.set(0, 0.95, 0.28); bot.group.add(box);
    bot.group.position.set(TUBE_POINT[0], 0, TUBE_POINT[1]); view.root.add(bot.group);
    ride = { start: now(), from: TUBE_POINT, to: [to[0] + 0.8, to[1] + 0.8], bot, box, dropped: false };
    played.push({ ...ev, who: builder?.id ?? null, ride: LIFT_S, at: Date.now() });
    return true;
  }
  /** Moves the ride on, by the clock: out of the lift to the desk (3 s), sets the box down (2 s), back into the lift (3 s). */
  function moveRide() {
    if (!ride) return;
    const s = (now() - ride.start) / 1000, g = ride.bot.group, [ax, az] = ride.from, [bx, bz] = ride.to;
    const at = (k) => g.position.set(ax + (bx - ax) * k, 0, az + (bz - az) * k);
    g.rotation.y = Math.atan2(bx - ax, bz - az) + (s > 5 ? Math.PI : 0);
    if (s < 3) at(s / 3);
    else if (s < 5) { at(1); if (!ride.dropped) { ride.dropped = true; ride.box.removeFromParent(); ride.box.position.set(bx, 0.13, bz); view.root.add(ride.box); } }
    else if (s < LIFT_S) at(1 - (s - 5) / 3);
    else { g.removeFromParent(); const left = ride.box; setTimeout(() => left.removeFromParent(), 60000); ride = null; }
  }
  /** One event on this floor. Returns whether it played. */
  function carry(ev) {
    if (!playable(ev) || ev.floor !== number) return false;
    if (ev.event === 'handback') return deliver(ev);
    const who = ev.event === 'arrive' && ev.kind === 'contractor' ? manager() : ev.event === 'arrive' && ev.kind === 'purchase' ? someone() : ev.event === 'close' ? someone() : null;
    if (!who?.perform) return false;
    if (ev.event === 'arrive') who.perform([{ anim: 'stand', hold: 0.1, paper: true }, { walk: TUBE_POINT }, { anim: 'stand', hold: 0.6, paper: false }], { scene: true });
    else who.perform([{ walk: TUBE_POINT }, { anim: 'stand', hold: 0.5, paper: true }, { walk: who.seat?.at || TUBE_POINT }, { anim: 'stand', hold: 0.3, paper: false }], { scene: true });
    played.push({ ...ev, who: who.id, walk: WALK_S, at: Date.now() });
    return true;
  }
  const hook = {
    played,
    carry,
    get riding() { return !!ride; },
    /** Called every frame by the room; reads the feed at most every 4 s, and never while the tab is hidden. */
    tick() {
      moveRide();
      const t = now();
      if (busy || t - last < POLL_MS - 250 || globalThis.document?.hidden) return;
      last = t; busy = true;
      Promise.resolve(read()).then((d) => { const evs = diffFeed(prev, d); prev = d; for (const e of evs) carry(e); }).catch(() => {}).finally(() => { busy = false; });
    },
  };
  // In the page, its own 4 s timer as well: a room that draws few frames (a slow device, or the stage idling) must not slow the folders down.
  // It stops once the floor page is gone.
  if (globalThis.document && globalThis.setInterval) {
    const timer = setInterval(() => { if (document.body?.dataset.page !== 'floor' || view.disposed) { clearInterval(timer); return; } hook.tick(); }, POLL_MS);
  }
  // r2-j68: on a Friday evening, one cheer when someone opens the featured floor's room. Once per visit, and only if that floor is featured.
  if (globalThis.document) Promise.resolve(api('/building/friday')).then((d) => { if (d?.on && d.floor?.number === number && !view.disposed) { view.cheer?.(); hook.fridayCheer = true; } }).catch(() => {});
  return hook;
}
