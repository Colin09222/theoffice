// The cartoon look's shared pieces: a stepped lighting ramp for the people and the rooms, and a cheap dark outline (the same geometry drawn once
// more, grown a little along its normals, back faces only) for people and furniture on the tiers that can afford one more draw call each.
import * as THREE from '../vendor/three/three.module.min.js';

/** Light in four clean steps, with the darkest step kept light: shadows read as colour, not as dirt. */
const ramp = (steps) => {
  const t = new THREE.DataTexture(new Uint8Array(steps), steps.length, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
  return t;
};
export const PEOPLE_RAMP = ramp([120, 172, 225, 255]);
export const ROOM_RAMP = ramp([135, 185, 232, 255]);

/** Grows a material's geometry along its normals by `width` (in the object's own units). */
function grow(m, width) {
  const w = { value: width };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uGrow = w;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uGrow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(normal) * uGrow;');
  };
  m.customProgramCacheKey = () => 'toon-grow';
  return m;
}
export const outlineMaterial = (color, width) => grow(new THREE.MeshBasicMaterial({ color, side: THREE.BackSide, toneMapped: false }), width);

/**
 * A warm, bright version of a material colour: more saturated and a good deal lighter, with the darks lifted so nothing goes muddy,
 * and a nudge of yellow into the mid-tones. The colour's own hue stays, so a green plant is still green and a company's blue still blue.
 */
export function popColor(c) {
  const hsl = { h: 0, s: 0, l: 0 }; c.getHSL(hsl);
  hsl.l = 0.2 + hsl.l * 0.8;
  hsl.s = Math.min(1, hsl.s < 0.15 ? hsl.s * 0.9 : hsl.s * 1.28 + 0.06);
  c.setHSL(hsl.h, hsl.s, hsl.l);
  c.r = Math.min(1, c.r * 1.05);
  return c;
}
