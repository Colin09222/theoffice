// Real New York light in a floor's room (round 2, r2-j35; docs/redesign/OFFICE-ANSWERS-2.md, Q2). Lane B's side of the room hook: once a minute
// it reads the New York clock and calls the room's setRoomLights(on) (office-scene.js, the one small method lane B adds there), so from 23:00 to
// 08:00 the room lights and desk lamps are off on every floor. The sky outside the windows is the shared world's, tinted by the same clock.
import { lightClock } from './nylight.js';
import { SKY_TINT, ROOM_LIGHTS } from './lobby-scene.js';

export function roomLight(view) {
  return lightClock({ now: () => globalThis.window?.__officeNow?.() ?? Date.now(), apply: (l, look) => {
    view.setRoomLights(l.lightsOn, look);
    // A room on its own owns the sky; a room hosted in the tower leaves it to the tower.
    if (!view.host) { SKY_TINT.value.setRGB(look.sky[0], look.sky[1], look.sky[2]); ROOM_LIGHTS.value = l.lightsOn ? 1 : 0; }
  } });
}
