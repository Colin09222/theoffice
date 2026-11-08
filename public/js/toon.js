// The inside of a floor, drawn like a cartoon to suit the vinyl-toy staff: light that comes in a few flat steps instead of a smooth roll-off, colours
// lifted bright and warm, and shadows that stay soft and pale. Cheaper than the physical material it replaces, so a phone gets it for free. Every
// material here is patched with cutaway.js afterwards, so the walls still cut away. The terrace and the city keep their own materials and light.
import * as THREE from '../vendor/three/three.module.min.js';

// How much of the sun each step lets through, by how squarely a face meets it: deep shade, shade, lit, full sun. Nearest-filtered, so curves band crisply.
const STEPS = 16, RAMP = new Uint8Array(STEPS);
for (let i = 0; i < STEPS; i++) { const t = (i + 0.5) / STEPS; RAMP[i] = Math.round(255 * (t < 0.28 ? 0.2 : t < 0.56 ? 0.36 : t < 0.8 ? 0.62 : 0.7)); }
export const TOON_RAMP = new THREE.DataTexture(RAMP, STEPS, 1, THREE.RedFormat);
TOON_RAMP.minFilter = TOON_RAMP.magFilter = THREE.NearestFilter; TOON_RAMP.generateMipmaps = false; TOON_RAMP.needsUpdate = true;
const LIFT = 0.16;           // a little light that reaches everything, so a shaded corner is still a colour and never a dark
const SHADOW = 0.5;          // how much of the sun a cast shadow takes away: half, so shadows read as soft pale shapes

/**
 * The shared toon patch: the ramp, the lift and the pale cast shadows. `key` keeps programs apart if a caller patches further.
 * Pass the same options as MeshToonMaterial; vertexColors and map both work.
 */
export function toonMaterial(opts = {}) {
  const m = new THREE.MeshToonMaterial({ gradientMap: TOON_RAMP, ...opts });
  m.userData.toon = true;
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replaceAll('directionalLightShadow.shadowIntensity', `min(directionalLightShadow.shadowIntensity, ${SHADOW.toFixed(2)})`))
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\nreflectedLight.indirectDiffuse += ${LIFT.toFixed(3)} * material.diffuseColor;`);
  };
  m.customProgramCacheKey = () => 'toon-room';
  return m;
}

/** A colour for the room's bright flat palette: dark and muddy tones lifted, greys warmed a touch, colours given more saturation. The hue stays, so a company's colours still read as theirs. */
export function warmFlat(color) {
  const c = new THREE.Color(color), h = { h: 0, s: 0, l: 0 };
  c.getHSL(h, THREE.SRGBColorSpace);
  const grey = h.s < 0.06;
  c.setHSL(grey ? 0.09 : h.h, grey ? 0.12 : Math.min(0.95, h.s * 1.08 + 0.1), Math.min(0.96, 0.13 + 0.87 * h.l ** 0.92), THREE.SRGBColorSpace);
  return c;
}
