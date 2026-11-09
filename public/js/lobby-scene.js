// The lobby: a harbour city at golden hour, built procedurally, with one tall tower you can turn and ride. No external models or textures.
// Everything is instanced or merged, lit by one low sun with a real shadow map, and melts into warm haze with distance. The look is
// the last good hour of the day: a glowing horizon, warm stone, deep teal water with a path of light on it, long soft violet shadows.
import * as THREE from '../vendor/three/three.module.min.js';
import { mergeMeshes } from './batch.js';
import { stage } from './stage.js';

export const FLOOR_H = 1.0, TOWER_W = 8.6, GROUND = 3.6;
// A low sun off to one side: long shadows down the streets, one lit face and one shaded face on every block.
const SUN = new THREE.Vector3(0.72, 0.30, -0.36).normalize();
const SUN_GLSL = `vec3(${SUN.x.toFixed(4)}, ${SUN.y.toFixed(4)}, ${SUN.z.toFixed(4)})`;
const GRID = 9, LOT = 3.3, CELLS = 36;

function rng(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// The haze colour for a world direction: rosy away from the sun, hot gold toward it. Distant land, the far sea and the bottom of the
// sky all take this one colour, which is what makes the horizon glow with no seam between sea and sky.
const HAZE_GLSL = `
  vec3 hazeTint(vec3 d) {
    vec2 h = normalize(d.xz + 1e-4), sh = normalize(${SUN_GLSL}.xz);
    float a = dot(h, sh) * 0.5 + 0.5;
    return mix(vec3(1.0, 0.75, 0.57), vec3(1.26, 0.86, 0.50), a * a);
  }`;
// Fog is linear in distance as usual, but tinted per pixel by direction and a little thinner high up. The scene's fog colour multiplies
// it, so each view can still shift it. Built-in materials and our own shaders share this through the chunks.
THREE.ShaderChunk.fog_pars_vertex = '#ifdef USE_FOG\nvarying float vFogDepth; varying vec3 vFogDir;\n#endif';
THREE.ShaderChunk.fog_vertex = '#ifdef USE_FOG\nvFogDepth = -mvPosition.z; vFogDir = transpose(mat3(viewMatrix)) * mvPosition.xyz;\n#endif';
THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor; varying float vFogDepth; varying vec3 vFogDir;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear; uniform float fogFar;
  #endif
  ${HAZE_GLSL}
  #endif`;
THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  fogFactor *= mix(1.0, 0.78, smoothstep(14.0, 70.0, cameraPosition.y + vFogDir.y));
  vec3 hazeNow = hazeTint(normalize(vFogDir));
  // Drawing straight to the screen, built-in materials reach this point already tone mapped and encoded, so the haze has to be too. In a render target, or in our own shaders, everything here is still linear.
  #if defined(TONE_MAPPING) && !defined(FOG_IN_LINEAR)
    hazeNow = linearToOutputTexel(vec4(toneMapping(hazeNow), 1.0)).rgb;
  #endif
  gl_FragColor.rgb = mix(gl_FragColor.rgb, hazeNow * fogColor, fogFactor);
  #endif`;

const GLSL_COMMON = `
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  vec3 s2l(vec3 c){ return pow(c, vec3(2.2)); }
  float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
  // Cut stone, drawn from position with no texture: running-bond courses with a shade per block, thin joints, grain and
  // faint rain streaks. p is (along, up) in world units; fw its screen-space derivative, so it all melts away with distance.
  vec3 stone(vec3 base, vec2 p, float fw, float strength) {
    vec2 c = vec2(p.x / 1.15, p.y / 0.46);
    float row = floor(c.y); c.x += 0.5 * mod(row, 2.0);
    vec2 id = floor(c), f = fract(c);
    float far = smoothstep(0.06, 0.3, fw);
    float shade = mix(1.0 - 0.07 * strength + 0.14 * strength * hash(id * 1.7 + 0.37), 1.0, far);
    float j = min(min(f.x, 1.0 - f.x) * 2.5, min(f.y, 1.0 - f.y) * 6.0);
    float joint = (1.0 - smoothstep(0.03, 0.1 + fw * 2.0, j)) * (1.0 - far);
    float grain = 1.0 - 0.05 * strength + 0.1 * strength * vnoise(p * 9.0);
    float streak = smoothstep(0.55, 0.95, vnoise(vec2(p.x * 2.5, p.y * 0.12))) * 0.1 * strength * (1.0 - far);
    return base * shade * grain * (1.0 - 0.16 * strength * joint) * (1.0 - streak);
  }`;
// The sky as a function, for the dome and for anything that reflects it: haze at the horizon, apricot just above it, powder blue higher up.
const SKY_GLSL = `
  vec3 skyColor(vec3 d) {
    float y = max(d.y, 0.0);
    vec3 c = mix(skyHaze(d), s2l(vec3(1.0, 0.88, 0.74)), smoothstep(0.0, 0.05, y));
    c = mix(c, s2l(vec3(0.74, 0.82, 0.90)), smoothstep(0.04, 0.2, y));
    c = mix(c, s2l(vec3(0.38, 0.58, 0.86)), smoothstep(0.16, 0.72, y));
    float s = max(dot(d, ${SUN_GLSL}), 0.0);
    c += vec3(1.0, 0.66, 0.36) * (pow(s, 5.0) * 0.36 + pow(s, 36.0) * 0.6);
    return c;
  }`;
const SKY_HAZE = HAZE_GLSL.replace('hazeTint', 'skyHaze');

/** Adds world position, object-space normal and instance size varyings to a built-in material, then lets a callback patch the shaders. */
function patch(material, { attributes = '', vertex = '', fragmentHead = '', color = '', emissive = '' }) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${attributes}\nvarying vec3 vWp; varying vec3 vMp; varying vec3 vNrm; varying vec3 vLocal; varying vec3 vSize;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 _wp = vec4(transformed, 1.0);
        vSize = vec3(1.0);
        #ifdef USE_INSTANCING
          _wp = instanceMatrix * _wp;
          vSize = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        #endif
        vMp = _wp.xyz; _wp = modelMatrix * _wp; vWp = _wp.xyz; vNrm = normal; vLocal = position;
        ${vertex}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWp; varying vec3 vMp; varying vec3 vNrm; varying vec3 vLocal; varying vec3 vSize; ${GLSL_COMMON} ${fragmentHead}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${color}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${emissive}`);
  };
  const key = `patched-${++patchCount}`;
  material.customProgramCacheKey = () => key;
  return material;
}
let patchCount = 0;

// ---------- sky, water, land ----------

function makeSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { uTime: { value: 0 } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0); gl_Position = p.xyww; }',
    fragmentShader: `varying vec3 vDir; uniform float uTime; ${GLSL_COMMON} ${SKY_HAZE} ${SKY_GLSL}
      void main(){
        vec3 d = normalize(vDir); float y = clamp(d.y, -0.02, 1.0);
        vec3 c = skyColor(d);
        float s = max(dot(d, ${SUN_GLSL}), 0.0);
        c += vec3(2.6, 2.1, 1.5) * smoothstep(0.9988, 0.9994, s);
        // Long thin bands low down and soft cumulus above them, both lit from below by the sun, drifting very slowly.
        vec2 uv = d.xz / (d.y + 0.07);
        float bands = vnoise(vec2(uv.x * 0.5, uv.y * 2.6) + vec2(uTime * 0.004, 0.0)) * 0.65 + vnoise(vec2(uv.x * 1.4, uv.y * 7.0) - uTime * 0.006) * 0.35;
        bands = smoothstep(0.52, 0.8, bands) * smoothstep(0.012, 0.05, y) * smoothstep(0.34, 0.1, y);
        float cum = vnoise(uv * 0.9 + 7.0 + uTime * 0.003) * 0.55 + vnoise(uv * 2.6 + 3.0) * 0.3 + vnoise(uv * 7.0) * 0.15;
        cum = smoothstep(0.58, 0.74, cum) * smoothstep(0.06, 0.16, y) * smoothstep(0.52, 0.2, y);
        vec3 lit = mix(s2l(vec3(0.98, 0.72, 0.60)), s2l(vec3(1.0, 0.92, 0.80)), s * s);
        c = mix(c, lit, bands * 0.55 + cum * 0.7);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 20), mat);
  mesh.frustumCulled = false; mesh.renderOrder = -10;
  return mesh;
}

function makeWater() {
  const mat = new THREE.ShaderMaterial({
    defines: { FOG_IN_LINEAR: 1 },
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]), fog: true,
    vertexShader: `varying vec3 vW;
      #include <fog_pars_vertex>
      void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: `varying vec3 vW; uniform float uTime; ${GLSL_COMMON} ${SKY_HAZE} ${SKY_GLSL}
      #include <fog_pars_fragment>
      // Each wave adds its slope only while it is wider than a pixel, so the far water can't break into scan lines.
      vec2 wv(vec2 p, vec2 k, float w, float a, float fw){ float att = 1.0 - smoothstep(0.35, 1.3, length(k) * fw); return k * cos(dot(k, p) + uTime * w) * a * att; }
      vec2 slope(vec2 p, float fw){
        vec2 q = p + 3.2 * vec2(sin(p.y * 0.083 + uTime * 0.05) + 0.5 * sin(p.y * 0.21 + p.x * 0.13), sin(p.x * 0.071 - uTime * 0.04) + 0.5 * sin(p.x * 0.19 - p.y * 0.11));
        return wv(q, vec2(0.83, 0.31), 0.8, 0.8, fw) + wv(q, vec2(-0.47, 0.97), -0.6, 0.8, fw) + wv(q, vec2(1.71, -1.23), 1.2, 0.42, fw) + wv(q, vec2(0.61, 2.93), -1.4, 0.24, fw) + wv(q, vec2(-3.1, 2.3), 1.7, 0.16, fw);
      }
      // The same shoreline as coast() in the script, so the shallows follow the land instead of a circle.
      float coastR(float a){ return 118.0 + sin(a*3.0+1.0)*12.0 + sin(a*7.0)*6.0 + sin(a*13.0+2.0)*2.5 - pow(max(0.0, cos(a-3.9)), 1.6)*84.0; }
      void main(){
        vec2 p = vW.xz;
        vec3 toCam = cameraPosition - vW; float dist = length(toCam);
        float far = smoothstep(120.0, 420.0, dist);
        float fw = max(fwidth(p.x), fwidth(p.y));
        // Calm at a distance, where a tiny tilt shows the whole gradient of the sky, and busier in patches of wind.
        float wind = vnoise(p * 0.035 + vec2(uTime * 0.012, 0.0));
        vec2 sl = slope(p, fw) * 0.2 * mix(1.0, 0.3, far) * (0.45 + wind);
        vec3 n = normalize(vec3(-sl.x, 10.0, -sl.y));
        vec3 v = toCam / dist;
        vec3 r = reflect(-v, n); r.y = abs(r.y);
        float fres = 0.05 + 0.95 * pow(clamp(1.0 - dot(v, n), 0.0, 1.0), 3.6);
        float off = length(p) - coastR(atan(p.y, p.x));
        // Clear turquoise over the shallows, deep teal beyond, with a long slow swell moving through it.
        float swell = vnoise(p * 0.06 + vec2(uTime * 0.02, -uTime * 0.013)) * 0.65 + vnoise(p * 0.17 - vec2(uTime * 0.03, 0.0)) * 0.35;
        vec3 water = mix(s2l(vec3(0.20, 0.56, 0.58)), s2l(vec3(0.075, 0.27, 0.36)), smoothstep(0.0, 30.0, off)) * (0.88 + 0.22 * swell);
        vec3 c = mix(water, skyColor(r), clamp(fres, 0.0, 1.0));
        // The path of light toward the sun: a wide soft lobe, broken into glitter close to, smooth far away.
        float sd = max(dot(r, ${SUN_GLSL}), 0.0);
        float near = 1.0 - smoothstep(0.1, 0.5, fw);
        float glitter = smoothstep(0.42, 0.9, vnoise(p * 2.4 + vec2(uTime * 0.7, -uTime * 0.5)) * 0.6 + vnoise(p * 6.1 - uTime * 0.9) * 0.4);
        c += vec3(1.0, 0.72, 0.42) * (pow(sd, 60.0) * mix(1.0, 0.25 + glitter * 2.6, near) + pow(sd, 500.0) * 2.4);
        // A line of foam along the quay.
        float foam = smoothstep(1.9, 0.1, off + (vnoise(p * 0.9 + uTime * 0.25) - 0.5) * 1.6);
        c = mix(c, vec3(0.86, 0.80, 0.70), foam * 0.42 * (1.0 - far));
        gl_FragColor = vec4(c, 1.0);
        #include <fog_fragment>
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2200, 2200), mat);
  m.rotation.x = -Math.PI / 2; m.position.y = -0.9;
  return m;
}

/** Depth in the distance: islands in the bay, then layers of hills along the far shore, each one fainter in the haze. Open water is left toward the sun. */
function makeFarShore() {
  const r = rng(3141);
  const pos = [], col = [];
  const tint = new THREE.Color();
  const tri = (a, b, c, ca, cb, cc) => { for (const v of [a, b, c]) pos.push(v[0], v[1], v[2]); for (const k of [ca, cb, cc]) col.push(k.r, k.g, k.b); };
  const sunAz = Math.atan2(SUN.z, SUN.x);
  const ridge = (radius, spread, height, palette, step) => {
    let prev = null;
    for (let a = 0; a <= Math.PI * 2 + 0.0001; a += step) {
      const off = Math.abs(Math.atan2(Math.sin(a - sunAz), Math.cos(a - sunAz)));
      const open = Math.min(1, Math.max(0, (off - 0.55) / 0.5));
      const n = Math.sin(a * 5.3 + radius) * 0.45 + Math.sin(a * 13.1 + radius * 0.7) * 0.3 + Math.sin(a * 31.0 + radius * 1.3) * 0.15 + 0.6;
      const h = Math.max(0.05, n) * height * open;
      const rad = radius + Math.sin(a * 7.0 + radius) * spread;
      const top = [Math.cos(a) * rad, h - 1, Math.sin(a) * rad], base = [Math.cos(a) * (rad - spread * 0.9), -2, Math.sin(a) * (rad - spread * 0.9)];
      if (prev && (prev.h > 0.2 || h > 0.2)) {
        const c1 = tint.set(palette[0]).clone(), c2 = tint.set(palette[1]).clone();
        tri(prev.base, base, prev.top, c1, c1, c2); tri(base, top, prev.top, c1, c2, c2);
      }
      prev = { top, base, h };
    }
  };
  ridge(980, 90, 46, ['#6f6a78', '#8a7f8c'], 0.03);
  ridge(840, 70, 26, ['#5f6a6a', '#7a7f78'], 0.035);
  ridge(700, 50, 12, ['#4f6a58', '#7d8a68'], 0.04);
  // Islands: low, sunlit cones, far enough out to take the haze.
  for (const [ang, dist, w, hh] of [[2.5, 430, 24, 3.2], [3.0, 540, 30, 4.2], [0.85, 540, 36, 5], [1.75, 400, 14, 2.2], [5.6, 560, 28, 3.6]]) {
    const cx = Math.cos(ang) * dist, cz = Math.sin(ang) * dist, seg = 14;
    const ring = []; for (let i = 0; i < seg; i++) { const t = (i / seg) * Math.PI * 2; const k = 0.74 + r() * 0.5; ring.push([cx + Math.cos(t) * w * k, -1, cz + Math.sin(t) * w * k * 0.7]); }
    const mid = []; for (let i = 0; i < seg; i++) { const t = (i / seg) * Math.PI * 2; const k = 0.3 + r() * 0.26; mid.push([cx + Math.cos(t) * w * k, hh * (0.55 + r() * 0.4), cz + Math.sin(t) * w * k * 0.7]); }
    const peak = [cx, hh * 1.15, cz];
    const green = tint.set('#6a8450').clone(), dry = tint.set('#b09b6a').clone(), rock = tint.set('#8a7a66').clone();
    for (let i = 0; i < seg; i++) { const j = (i + 1) % seg; tri(ring[i], ring[j], mid[i], dry, dry, green); tri(ring[j], mid[j], mid[i], dry, green, green); tri(mid[i], mid[j], peak, green, green, rock); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.98, side: THREE.DoubleSide }));
  m.frustumCulled = false;
  return m;
}

const coast = (a) => 118 + Math.sin(a * 3 + 1) * 12 + Math.sin(a * 7) * 6 + Math.sin(a * 13 + 2) * 2.5 - Math.pow(Math.max(0, Math.cos(a - 3.9)), 1.6) * 84;

/** The cell map tells the ground shader what each block is: 0 built, 1 park, 2 plaza, 3 waterfront promenade. */
function cellMap(spots) {
  const data = new Uint8Array(CELLS * CELLS * 4);
  for (const s of spots) {
    const gx = s.gx + CELLS / 2, gz = s.gz + CELLS / 2;
    if (gx < 0 || gz < 0 || gx >= CELLS || gz >= CELLS) continue;
    data[(gz * CELLS + gx) * 4] = s.kind;
    data[(gz * CELLS + gx) * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, CELLS, CELLS, THREE.RGBAFormat);
  t.magFilter = t.minFilter = THREE.NearestFilter; t.needsUpdate = true;
  return t;
}

/**
 * For the tier with no shadow map: every block's long shadow, and the tower's, drawn once onto a canvas and laid over the ground. Sampled
 * once per ground pixel, so it costs a weak phone almost nothing, and the streets still get the evening's long shadows.
 */
const BAKE_SPAN = 150;
let bakeFloors = 10;  // how tall a tower the baked shadows draw; the lobby knows the real number, and sets it before anything is baked
function bakeGroundShadows(blocks) {
  const size = 1024, c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, size, size);
  x.fillStyle = '#fff';
  const px = (v) => ((v + BAKE_SPAN) / (BAKE_SPAN * 2)) * size;
  const drop = (cx, cz, w, d, h) => {
    const ox = -(SUN.x / SUN.y) * h, oz = -(SUN.z / SUN.y) * h;
    const corners = [[cx - w / 2, cz - d / 2], [cx + w / 2, cz - d / 2], [cx + w / 2, cz + d / 2], [cx - w / 2, cz + d / 2]];
    x.beginPath();
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i], [bx, bz] = corners[(i + 1) % 4];
      x.moveTo(px(ax), px(az)); x.lineTo(px(bx), px(bz)); x.lineTo(px(bx + ox), px(bz + oz)); x.lineTo(px(ax + ox), px(az + oz)); x.closePath();
    }
    x.fill('nonzero');
    x.fillRect(px(cx - w / 2 + ox), px(cz - d / 2 + oz), (w / (BAKE_SPAN * 2)) * size, (d / (BAKE_SPAN * 2)) * size);
  };
  for (const b of blocks) drop(b.x, b.z, b.w, b.d, b.height);
  drop(0, 0, TOWER_W + 1, TOWER_W + 1, GROUND + bakeFloors * FLOOR_H);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; t.magFilter = t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.flipY = false;
  return t;
}

function makeLand(cells) {
  const shape = new THREE.Shape();
  const n = 160;
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2; const r = coast(a); const x = Math.cos(a) * r, y = -Math.sin(a) * r; if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y); }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 1.4, bevelEnabled: false, curveSegments: 1 });
  const mat = patch(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.96, metalness: 0 }), {
    fragmentHead: 'uniform sampler2D uCells; uniform sampler2D uBaked; uniform float uBakedOn;',
    color: `
      vec3 base; vec3 wp = vec3(vMp.x, vMp.z - 1.4, -vMp.y);
      if (wp.y < -0.05) {
        // The quay wall: dark stone with a tide line.
        base = s2l(vec3(0.46, 0.44, 0.42)) * (0.8 + 0.2 * smoothstep(-1.2, -0.2, wp.y));
      } else {
        vec2 g = wp.xz / ${GRID.toFixed(1)}; vec2 cell = floor(g + 0.5); vec2 c = (g + 0.5 - cell) * ${GRID.toFixed(1)} - ${(GRID / 2).toFixed(1)};
        float kind = texture2D(uCells, (cell + ${(CELLS / 2).toFixed(1)} + 0.5) / ${CELLS.toFixed(1)}).r * 255.0;
        float m = max(abs(c.x), abs(c.y));
        float fw = fwidth(c.x) + fwidth(c.y);
        float road = smoothstep(3.75, 3.75 + fw, m);
        float walk = smoothstep(${LOT.toFixed(2)}, ${LOT.toFixed(2)} + fw, m) * (1.0 - road);
        vec3 asphalt = s2l(vec3(0.35, 0.33, 0.33)), paving = s2l(vec3(0.80, 0.72, 0.60)), lot = s2l(vec3(0.60, 0.53, 0.44));
        vec3 grass = s2l(vec3(0.46, 0.58, 0.26)), plaza = s2l(vec3(0.88, 0.79, 0.65));
        // Lane line down the middle of each street, dashed.
        float ns = step(3.75, abs(c.x)) * step(abs(c.y), 3.75), ew = step(3.75, abs(c.y)) * step(abs(c.x), 3.75);
        float along = ns > 0.5 ? c.y : c.x, across = ns > 0.5 ? abs(c.x) : abs(c.y);
        float dash = step(0.5, fract(along * 0.55));
        float line = (1.0 - smoothstep(0.05, 0.05 + fw, abs(across - 4.5))) * dash * max(ns, ew);
        // Zebra crossings where the pavement meets the road.
        float zebra = max(ns, ew) * step(2.3, abs(along)) * step(abs(along), 3.3) * step(0.5, fract((ns > 0.5 ? c.x : c.y) * 1.6));
        vec3 inner = lot;
        if (kind > 0.5 && kind < 1.5) {
          float path = 1.0 - smoothstep(0.5, 0.5 + fw, min(abs(c.x), abs(c.y)));
          inner = mix(grass * (0.9 + 0.2 * vnoise(wp.xz * 1.3)), paving, path);
        } else if (kind > 1.5 && kind < 2.5) {
          vec2 t = mod(wp.xz, 2.0); float chk = step(1.0, t.x) + step(1.0, t.y) - 2.0 * step(1.0, t.x) * step(1.0, t.y);
          inner = plaza * (0.94 + 0.06 * chk);
          float ring = 1.0 - smoothstep(0.12, 0.12 + fw, abs(length(wp.xz) - 12.0));
          inner = mix(inner, lot, ring * 0.6);
        } else {
          // Contact shadow where the building meets the pavement.
          inner *= 0.72 + 0.28 * smoothstep(2.4, ${LOT.toFixed(2)}, m);
        }
        float kerbAO = 1.0 - 0.22 * (1.0 - smoothstep(${LOT.toFixed(2)}, ${(LOT + 0.35).toFixed(2)}, m)) * step(kind, 0.5);
        base = mix(inner, paving * kerbAO, walk);
        base = mix(base, asphalt, road);
        base = mix(base, s2l(vec3(0.85, 0.80, 0.55)), line * 0.7);
        base = mix(base, s2l(vec3(0.86, 0.86, 0.84)), zebra * road * 0.75);
        base *= 0.96 + 0.08 * vnoise(wp.xz * 0.35);
        // No shadow map on this tier: the long shadows come from the baked sheet, soft by its own low resolution, cool against the warm stone.
        if (uBakedOn > 0.5) base *= mix(vec3(1.0), vec3(0.42, 0.44, 0.56), texture2D(uBaked, wp.xz / ${(BAKE_SPAN * 2).toFixed(1)} + 0.5).r);
      }
      diffuseColor.rgb = base;`,
  });
  const baked = { uBaked: { value: null }, uBakedOn: { value: 0 } };
  mat.onBeforeCompile = ((orig) => (shader) => { Object.assign(shader.uniforms, { uCells: { value: cells } }, baked); orig(shader); })(mat.onBeforeCompile);
  const m = new THREE.Mesh(geo, mat);
  m.userData.baked = baked;
  // The extrusion runs along +z, which the rotation turns into +y, so the cap lands at y=0 and the quay wall drops to the water.
  m.rotation.x = -Math.PI / 2; m.position.y = -1.4; m.receiveShadow = true;
  return m;
}

// ---------- the city ----------

const FACADE_GLSL = `
  vec3 _nn = normalize(vNrm); vec3 base = diffuseColor.rgb;
  float style = floor(vSeed * 3.999);
  if (abs(_nn.y) < 0.5) {
    float u = (abs(_nn.x) > 0.5 ? vLocal.z * vSize.z : vLocal.x * vSize.x);
    float yv = vLocal.y * vSize.y;
    float bay = style < 0.5 ? 1.0 : style < 1.5 ? 1.35 : style < 2.5 ? 0.9 : 1.6;
    vec2 p = vec2(u / bay, yv);
    vec2 f = fract(p);
    float wx = fwidth(p.x), wy = fwidth(p.y), fw = wx + wy;
    // Filtered edges. A window only a pixel or two wide, stepped hard, comes out as speckle wherever there is no MSAA to hide it (the low tier, most of all).
    #define EDGE(a, v, w) smoothstep((a) - (w), (a) + (w), (v))
    float ex = min(wx, 0.25), ey = min(wy, 0.25);
    float win;
    if (style < 0.5) win = EDGE(0.3, f.x, ex) * (1.0 - EDGE(0.7, f.x, ex)) * EDGE(0.3, f.y, ey) * (1.0 - EDGE(0.82, f.y, ey));
    else if (style < 1.5) win = EDGE(0.06, f.x, ex) * EDGE(0.3, f.y, ey) * (1.0 - EDGE(0.9, f.y, ey));
    else if (style < 2.5) win = EDGE(0.05, f.x, ex) * EDGE(0.1, f.y, ey);
    else win = EDGE(0.26, f.x, ex) * (1.0 - EDGE(0.74, f.x, ex)) * EDGE(0.22, f.y, ey) * (1.0 - EDGE(0.86, f.y, ey));
    float avg = style < 0.5 ? 0.21 : style < 1.5 ? 0.56 : style < 2.5 ? 0.85 : 0.31;
    // Further off, every window and every per-window detail melts into its average rather than sparkling.
    float far = smoothstep(0.18, 0.6, fw);
    win = mix(win, avg, far);
    float shade = mix(f.y * 0.8, 0.4, far);
    // Dark glass with the sky in it: warm on the faces toward the sun, cooler on the others. Low contrast, so a facade reads as a wall with windows, not as stripes.
    float toSun = max(dot(_nn, ${SUN_GLSL}), 0.0);
    vec3 glass = mix(s2l(vec3(0.15, 0.17, 0.20)), s2l(vec3(0.27, 0.30, 0.34)), shade) + mix(vec3(0.015, 0.022, 0.034), vec3(0.11, 0.07, 0.034), toSun);
    // The seed is interpolated, so it wobbles in its last bits, and this hash magnifies that into holes in a lit window: the speckle on the facades. Whole numbers don't wobble.
    float lit = step(0.965, hash(floor(p) + floor(vSeed * 977.0 + 0.5))) * (1.0 - far);
    glass = mix(glass, s2l(vec3(0.98, 0.80, 0.55)), lit * 0.5);
    if (style > 1.5 && style < 2.5) {
      // Curtain wall: a darker spandrel band between the glass rows.
      float band = EDGE(0.1, f.y, ey) * (1.0 - EDGE(0.3, f.y, ey));
      glass = mix(glass, base * 0.55, mix(band, 0.2, far));
    }
    // The wall between the windows is cut stone or rendered block, course by course, from world position.
    vec3 wallc = stone(base, vec2(u + vSeed * 37.0, yv), fw, 1.0);
    base = mix(wallc, glass, win * 0.92);
    float parapet = step(vSize.y - 0.3, yv);
    base = mix(base, diffuseColor.rgb * 1.06, parapet);
    base *= 0.76 + 0.24 * smoothstep(0.0, 3.5, yv);
  } else if (_nn.y > 0.5) {
    vec2 rim = abs(vLocal.xz) * 2.0;
    float edge = smoothstep(0.84, 0.9, max(rim.x, rim.y));
    base = mix(base * 0.72 * (0.94 + 0.12 * vnoise(vMp.xz * 2.0)), base * 1.05, edge);
  }
  diffuseColor.rgb = base;`;

function buildingMaterial() {
  return patch(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.92, metalness: 0 }), {
    attributes: 'attribute float aSeed; varying float vSeed;', vertex: 'vSeed = aSeed;', fragmentHead: 'varying float vSeed;', color: FACADE_GLSL,
  });
}

function makeCity(density) {
  const r = rng(90210);
  const spots = []; const blocks = []; const parks = []; const trees = []; const balconies = []; const units = [];
  const half = CELLS / 2;
  for (let gx = -half; gx < half; gx++) for (let gz = -half; gz < half; gz++) {
    const cx = gx * GRID, cz = gz * GRID;
    const dist = Math.hypot(cx, cz);
    if (dist > coast(Math.atan2(cz, cx)) - 7) continue;
    if (Math.max(Math.abs(cx), Math.abs(cz)) < 14) { spots.push({ gx, gz, kind: 2 }); continue; }
    const park = r() < 0.08 || (dist > 95 && r() < 0.3);
    if (park) { spots.push({ gx, gz, kind: 1 }); parks.push([cx, cz]); continue; }
    spots.push({ gx, gz, kind: 0 });
    // Taller downtown off to one side, so the skyline reads as a city rather than a ring, and low around the tower so it always stands clear.
    const downtown = Math.max(0, 1 - Math.hypot(cx - 52, cz + 30) / 60);
    const near = Math.max(0, 1 - dist / 32);
    const split = r();
    const sub = split < 0.26 ? 1 : split < 0.7 ? 2 : 3;
    const cell = (LOT * 2) / sub;
    for (let i = 0; i < sub; i++) for (let j = 0; j < sub; j++) {
      if (sub === 3 && r() < 0.16) continue;
      const x = cx - LOT + cell * (i + 0.5), z = cz - LOT + cell * (j + 0.5);
      let height = 2.2 + r() * 2.8 + Math.pow(r(), 3) * 7 + downtown * (6 + r() * 18) * (sub === 1 ? 1 : 0.4);
      height *= 1 - near * 0.55;
      const w = cell * (0.74 + r() * 0.2), d = cell * (0.74 + r() * 0.2);
      const seed = r();
      blocks.push({ x, z, w, d, height, seed, sub });
      if (height > 9 && sub < 3 && r() < 0.7) blocks.push({ x: x + (r() - 0.5) * 0.4, z: z + (r() - 0.5) * 0.4, w: w * 0.68, d: d * 0.68, height: height * (1.18 + r() * 0.3), seed, sub, top: true });
    }
    // Street trees on the pavements, alternating sides so the streets read as avenues.
    if (dist < 80 * density + 30 && r() < 0.7) {
      for (const side of [-1, 1]) {
        if (r() < 0.45) continue;
        const along = r() < 0.5;
        for (let t = -2.4; t <= 2.4; t += 2.4) trees.push(along ? [cx + t, cz + side * 3.65, 0.75 + r() * 0.45] : [cx + side * 3.65, cz + t, 0.75 + r() * 0.45]);
      }
    }
  }
  for (const [px, pz] of parks) for (let i = 0; i < 9 * density + 3; i++) trees.push([px + (r() - 0.5) * 6.2, pz + (r() - 0.5) * 6.2, 0.8 + r() * 0.9]);
  // The plaza: an avenue of trees around the tower, and a few groves at its corners.
  for (let i = -11; i <= 11; i += 2.75) for (const s of [-12.6, 12.6]) { trees.push([i, s, 1.05]); trees.push([s, i, 1.05]); }
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) for (let i = 0; i < 4; i++) trees.push([sx * (8.5 + r() * 2.5), sz * (8.5 + r() * 2.5), 0.8 + r() * 0.4]);

  const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, 0.5, 0);
  const seeds = new Float32Array(blocks.length);
  const mesh = new THREE.InstancedMesh(geo, buildingMaterial(), blocks.length);
  const m = new THREE.Matrix4(), col = new THREE.Color();
  // Warm sand, limestone and terracotta, with a few cooler rendered blocks so the skyline doesn't read as one colour.
  const palette = ['#ead8b9', '#dcc199', '#c9a885', '#f1e4cf', '#b99b7f', '#e4d3bd', '#8d8782', '#cf9570', '#e6c6a2', '#6e6a6c', '#d4ab80', '#e8dfd0', '#ae8a6c', '#c8b596', '#bf6a4e', '#e0b377', '#a59a8e', '#d6c9b5'];
  blocks.forEach((b, i) => {
    m.makeScale(b.w, b.height, b.d); m.setPosition(b.x, 0, b.z);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, col.set(palette[Math.floor(b.seed * palette.length)]));
    seeds[i] = b.seed;
  });
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true;

  // Pitched terracotta roofs on the small buildings, rooftop plant on the tall ones.
  const low = blocks.filter((b) => b.height < 5 && !b.top && b.seed < 0.55);
  const roofGeo = new THREE.ConeGeometry(0.72, 0.5, 4); roofGeo.rotateY(Math.PI / 4); roofGeo.translate(0, 0.25, 0);
  const roofs = new THREE.InstancedMesh(roofGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95 }), low.length);
  const roofCols = ['#c3624a', '#cc7a55', '#b05a46', '#9c6e58', '#c6805c', '#b86b4c'];
  low.forEach((b, i) => { m.makeScale(b.w * 1.04, 0.9 + b.w * 0.22, b.d * 1.04); m.setPosition(b.x, b.height, b.z); roofs.setMatrixAt(i, m); roofs.setColorAt(i, col.set(roofCols[i % roofCols.length])); });
  roofs.frustumCulled = false; roofs.castShadow = true; roofs.receiveShadow = true;

  const tall = blocks.filter((b) => b.height > 6 && !b.top);
  for (const b of tall) { units.push([b.x + b.w * 0.18, b.height, b.z - b.d * 0.12, b.w * 0.36, 0.7, b.d * 0.3]); if (b.w > 3) units.push([b.x - b.w * 0.25, b.height, b.z + b.d * 0.2, b.w * 0.2, 0.45, b.d * 0.2]); }
  const unitMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: '#9a9598', roughness: 0.7 }), units.length);
  units.forEach((u, i) => { m.makeScale(u[3], u[4], u[5]); m.setPosition(u[0], u[1], u[2]); unitMesh.setMatrixAt(i, m); });
  unitMesh.frustumCulled = false; unitMesh.castShadow = true;

  // Rooftop pools on the wider mid-rise blocks, and planted terraces on others: what a city looks like from a tower.
  const pools = [], terraces = [];
  for (const b of blocks) {
    if (b.top || b.height < 5 || b.height > 15 || b.w < 2.4) continue;
    if (b.seed > 0.42 && b.seed < 0.5) pools.push([b.x + b.w * 0.1, b.height + 0.02, b.z - b.d * 0.08, b.w * 0.42, b.d * 0.3]);
    else if (b.seed > 0.74 && b.seed < 0.86) terraces.push([b.x - b.w * 0.15, b.height + 0.02, b.z + b.d * 0.15, b.w * 0.5, b.d * 0.45]);
  }
  const poolMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: '#4fb6d6', roughness: 0.15, metalness: 0.1 }), Math.max(1, pools.length));
  pools.forEach((p, i) => { m.makeScale(p[3], 0.08, p[4]); m.setPosition(p[0], p[1], p[2]); poolMesh.setMatrixAt(i, m); });
  const terraceMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: '#6f9a4e', roughness: 0.95 }), Math.max(1, terraces.length));
  terraces.forEach((p, i) => { m.makeScale(p[3], 0.3, p[4]); m.setPosition(p[0], p[1], p[2]); terraceMesh.setMatrixAt(i, m); });
  poolMesh.count = pools.length; terraceMesh.count = terraces.length; poolMesh.frustumCulled = terraceMesh.frustumCulled = false; terraceMesh.castShadow = true;

  // Tower cranes over the tallest downtown blocks: a mast, a jib with its counterweight, and a hook line.
  const craneGroup = new THREE.Group();
  const craneMat = new THREE.MeshStandardMaterial({ color: '#e0a23a', roughness: 0.6 });
  const cableMat = new THREE.MeshStandardMaterial({ color: '#3a3a3a', roughness: 0.8 });
  const tallest = blocks.filter((b) => !b.top && b.height > 14).sort((a, b) => b.height - a.height).slice(0, 3);
  tallest.forEach((b, i) => {
    const h = b.height + 6 + i * 1.5, x = b.x + b.w * 0.45, z = b.z - b.d * 0.4, ang = i * 2.1;
    const add = (mat, w, hh, d, px, py, pz, ry = 0) => { const mm = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), mat); mm.position.set(px, py, pz); mm.rotation.y = ry; mm.castShadow = true; craneGroup.add(mm); };
    add(craneMat, 0.5, h, 0.5, x, h / 2, z);
    const jib = 9 + i * 2;
    add(craneMat, jib, 0.35, 0.4, x + Math.cos(ang) * jib * 0.3, h + 0.3, z + Math.sin(ang) * jib * 0.3, -ang);
    add(craneMat, 0.6, 1.2, 0.6, x - Math.cos(ang) * 2.2, h + 0.1, z - Math.sin(ang) * 2.2);
    add(cableMat, 0.05, h * 0.45, 0.05, x + Math.cos(ang) * jib * 0.7, h - h * 0.225, z + Math.sin(ang) * jib * 0.7);
    add(cableMat, 0.5, 0.5, 0.5, x + Math.cos(ang) * jib * 0.7, h * 0.55 - 0.2, z + Math.sin(ang) * jib * 0.7);
  });
  mergeMeshes(craneGroup);

  // Balconies on the mid-rise blocks near the tower: the detail that makes a block read as homes rather than boxes.
  for (const b of blocks) {
    if (b.top || b.height < 5 || b.height > 16 || Math.hypot(b.x, b.z) > 60 * density + 20 || b.seed > 0.6) continue;
    const faces = b.seed < 0.3 ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];
    for (let f = 2; f < b.height - 1; f += 1) for (const [fx, fz] of faces) {
      const slide = ((f % 3) - 1) * 0.15;
      balconies.push([b.x + fx * (b.w / 2 + 0.22) + fz * slide * b.w, f + 0.02, b.z + fz * (b.d / 2 + 0.22) + fx * slide * b.d, fz ? Math.min(2.4, b.w * 0.42) : 0.44, fz ? 0.44 : Math.min(2.4, b.d * 0.42), fx, fz]);
    }
  }
  const balGeo = new THREE.BoxGeometry(1, 1, 1); balGeo.translate(0, 0.5, 0);
  const balMesh = new THREE.InstancedMesh(balGeo, new THREE.MeshStandardMaterial({ color: '#f1e9dc', roughness: 0.9 }), Math.max(1, balconies.length));
  balconies.forEach((b, i) => { m.makeScale(b[3], 0.1, b[4]); m.setPosition(b[0], b[1], b[2]); balMesh.setMatrixAt(i, m); });
  const railMesh = new THREE.InstancedMesh(balGeo, new THREE.MeshStandardMaterial({ color: '#8d8176', roughness: 0.7 }), Math.max(1, balconies.length));
  balconies.forEach((b, i) => { const [, , , w, d, fx, fz] = b; m.makeScale(fz ? w : 0.04, 0.42, fz ? 0.04 : d); m.setPosition(b[0] + fx * 0.2, b[1] + 0.1, b[2] + fz * 0.2); railMesh.setMatrixAt(i, m); });
  balMesh.frustumCulled = railMesh.frustumCulled = false; balMesh.castShadow = true; balMesh.count = railMesh.count = balconies.length;

  // Trees: round-crowned street trees and stone pines (a tall trunk under a flat umbrella), each a pair of instanced draws.
  const round = trees.filter((t, i) => i % 7 !== 3), pines = trees.filter((t, i) => i % 7 === 3);
  const trunkGeo = new THREE.CylinderGeometry(0.07, 0.1, 1, 5, 1, true); trunkGeo.translate(0, 0.5, 0);
  const canopyGeo = new THREE.IcosahedronGeometry(0.66, 0); canopyGeo.translate(0, 1.42, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: '#6b5443', roughness: 0.95 }), round.length);
  const canopies = new THREE.InstancedMesh(canopyGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95 }), round.length);
  const leaf = ['#5f8a4a', '#6f9a52', '#4f7a46', '#7c9c4c', '#587f58', '#8aa24f'];
  round.forEach((t, i) => {
    m.makeScale(t[2], t[2] * 1.05, t[2]); m.setPosition(t[0], 0, t[1]); trunks.setMatrixAt(i, m);
    m.makeScale(t[2] * (0.9 + (i % 3) * 0.1), t[2] * (1.0 + (i % 4) * 0.12), t[2]); m.setPosition(t[0], 0, t[1]); canopies.setMatrixAt(i, m);
    canopies.setColorAt(i, col.set(leaf[i % leaf.length]));
  });
  const pineTrunkGeo = new THREE.CylinderGeometry(0.06, 0.11, 2.1, 5, 1, true); pineTrunkGeo.translate(0, 1.05, 0);
  const pineCanopyGeo = new THREE.IcosahedronGeometry(1.0, 1); pineCanopyGeo.scale(1, 0.42, 1); pineCanopyGeo.translate(0, 2.25, 0);
  const pineTrunks = new THREE.InstancedMesh(pineTrunkGeo, new THREE.MeshStandardMaterial({ color: '#5e4636', roughness: 0.95 }), Math.max(1, pines.length));
  const pineCanopies = new THREE.InstancedMesh(pineCanopyGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95 }), Math.max(1, pines.length));
  const needle = ['#3f6b3c', '#4a7a44', '#36603a', '#55804a'];
  pines.forEach((t, i) => {
    m.makeScale(t[2], t[2], t[2]); m.setPosition(t[0], 0, t[1]); pineTrunks.setMatrixAt(i, m);
    m.makeScale(t[2] * (1.0 + (i % 3) * 0.12), t[2], t[2] * (0.9 + (i % 2) * 0.15)); m.setPosition(t[0], 0, t[1]); pineCanopies.setMatrixAt(i, m);
    pineCanopies.setColorAt(i, col.set(needle[i % needle.length]));
  });
  pineTrunks.count = pineCanopies.count = pines.length;
  for (const t of [trunks, canopies, pineTrunks, pineCanopies]) { t.frustumCulled = false; t.castShadow = true; t.receiveShadow = true; }

  const group = new THREE.Group().add(mesh, roofs, unitMesh, balMesh, railMesh, trunks, canopies, pineTrunks, pineCanopies, poolMesh, terraceMesh, craneGroup);
  return { group, city: mesh, blocks, cells: cellMap(spots), detail: [balMesh, railMesh, unitMesh, poolMesh, terraceMesh, craneGroup], stats: { buildings: blocks.length, trees: trees.length, balconies: balconies.length, pools: pools.length, cranes: tallest.length } };
}

function makeTraffic(count) {
  const r = rng(4242);
  const geo = new THREE.BoxGeometry(0.3, 0.16, 0.66); geo.translate(0, 0.1, 0);
  const a = new Float32Array(count * 4), range = new Float32Array(count * 2);
  const cols = new Float32Array(count * 3); const col = new THREE.Color();
  const onLand = (x, z) => Math.hypot(x, z) < coast(Math.atan2(z, x)) - 3;
  // Each car runs back and forth along the longest stretch of its street that is actually on land.
  const span = (ns, line) => { let best = [0, 0], cur = null; for (let t = -110; t <= 110; t += 2) { const ok = ns ? onLand(line, t) : onLand(t, line); if (ok) { cur = cur ? [cur[0], t] : [t, t]; if (cur[1] - cur[0] > best[1] - best[0]) best = cur; } else cur = null; } return best; };
  const bodies = ['#e8e4dc', '#d8d3c9', '#2d3340', '#b03a30', '#5b6f8a', '#f0c75e', '#8b8f96', '#3f5f3e'];
  for (let i = 0; i < count; i++) {
    const ns = r() < 0.5; let line = (Math.floor(r() * 24) - 12) * GRID - 4.5; if (Math.abs(line) < 13) line = line < 0 ? -13.5 : 13.5;  // no traffic through the plaza
    line += r() < 0.5 ? 0.35 : -0.35;
    const [lo, hi] = span(ns, line);
    a[i * 4] = ns ? 1 : 0; a[i * 4 + 1] = line; a[i * 4 + 2] = r() * 220; a[i * 4 + 3] = (r() < 0.5 ? -1 : 1) * (2.2 + r() * 2.4);
    range[i * 2] = lo; range[i * 2 + 1] = Math.max(hi, lo + 4);
    col.set(bodies[Math.floor(r() * bodies.length)]); cols[i * 3] = col.r; cols[i * 3 + 1] = col.g; cols[i * 3 + 2] = col.b;
  }
  geo.setAttribute('aCar', new THREE.InstancedBufferAttribute(a, 4));
  geo.setAttribute('aRange', new THREE.InstancedBufferAttribute(range, 2));
  geo.setAttribute('aCol', new THREE.InstancedBufferAttribute(cols, 3));
  const mat = new THREE.ShaderMaterial({
    defines: { FOG_IN_LINEAR: 1 },
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]), fog: true,
    vertexShader: `attribute vec4 aCar; attribute vec2 aRange; attribute vec3 aCol; uniform float uTime; varying vec3 vCol; varying vec3 vN; varying float vFront;
      #include <fog_pars_vertex>
      void main(){
        float t = aRange.x + mod(aCar.z + uTime * aCar.w, aRange.y - aRange.x);
        vec3 p = position; float ns = aCar.x;
        if (aCar.w < 0.0) p.z = -p.z;
        vFront = position.z / 0.33;
        vec3 w = ns > 0.5 ? vec3(aCar.y + p.x, p.y, t + p.z) : vec3(t + p.z, p.y, aCar.y + p.x);
        vN = mat3(modelMatrix) * (ns > 0.5 ? normal : normal.zyx);
        vCol = aCol;
        vec4 mvPosition = viewMatrix * modelMatrix * vec4(w, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `varying vec3 vCol; varying vec3 vN; varying float vFront;
      #include <fog_pars_fragment>
      void main(){
        vec3 sunDir = normalize(vec3(${SUN.x.toFixed(3)}, ${SUN.y.toFixed(3)}, ${SUN.z.toFixed(3)}));
        float lit = 0.45 + 0.55 * max(dot(normalize(vN), sunDir), 0.0);
        vec3 c = vCol * lit;
        if (abs(vFront) > 0.95 && abs(vN.y) < 0.5) c = vFront > 0.0 ? vec3(0.9, 0.9, 0.8) : vec3(0.6, 0.08, 0.05);
        gl_FragColor = vec4(c, 1.0);
        #include <fog_fragment>
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const inst = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4(); for (let i = 0; i < count; i++) inst.setMatrixAt(i, m);
  inst.frustumCulled = false;
  return inst;
}

// ---------- the tower ----------

function towerGlass() {
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.28, metalness: 0.2, envMapIntensity: 1.1 });
  const bays = 6;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aState; varying vec3 vState; varying vec3 vLocal; varying vec3 vNrm; varying float vY; varying vec3 vWorldP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvState = aState; vLocal = position; vNrm = normal; vec4 _ip = instanceMatrix * vec4(position, 1.0); vY = _ip.y; vWorldP = (modelMatrix * _ip).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uTime; varying vec3 vState; varying vec3 vLocal; varying vec3 vNrm; varying float vY; varying vec3 vWorldP; ${GLSL_COMMON} ${SKY_HAZE} ${SKY_GLSL}`)
      .replace('#include <color_fragment>', `
        float roughnessFactor; float metalnessFactor;
        vec3 _nn = normalize(vNrm);
        vec3 brand = vColor.rgb;
        bool sideX = abs(_nn.x) > 0.5;
        // Pane coordinates: broad bays with slim mullions, one row of glass per floor. Everything fades to its average once a line would be thinner than a pixel.
        float along = ((sideX ? vLocal.z : vLocal.x) + ${(TOWER_W / 2).toFixed(2)}) / ${TOWER_W.toFixed(2)} * ${bays.toFixed(1)};
        float cell = fract(along), fw = fwidth(along);
        float frame = smoothstep(0.012, 0.012 + fw * 1.4, cell) * smoothstep(0.988, 0.988 - fw * 1.4, cell);
        frame = mix(frame, 0.95, smoothstep(0.3, 0.9, fw));
        float yv = vLocal.y / ${(FLOOR_H * 0.86).toFixed(2)} + 0.5;
        float sill = mix(0.1, 0.32, clamp(vState.x, 0.0, 1.0));
        float band = smoothstep(sill, sill + 0.03, yv) * smoothstep(0.995, 0.975, yv);
        float faceId = sideX ? 40.0 + sign(_nn.x) * 7.0 : sign(_nn.z) * 7.0;
        float rnd = hash(vec2(floor(along) + faceId, floor(vY)));
        float busy = vState.y * (0.5 + 0.5 * sin(uTime * 0.9 + floor(vY) * 1.7));
        float on = clamp(vState.x, 0.0, 1.0);
        // Depth: every pane looks into a real little room. The ray from the camera is traced into a box behind the glass and shaded by the wall it hits.
        vec3 V = normalize(vWorldP - cameraPosition);
        vec3 T = sideX ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
        vec3 rd = vec3(dot(V, T), V.y, -dot(V, _nn)) / vec3(${(TOWER_W / bays).toFixed(3)}, ${(FLOOR_H * 0.76).toFixed(3)}, 1.5);
        vec3 ro = vec3(cell, clamp((yv - 0.12) / 0.87, 0.0, 1.0), 0.0);
        vec3 rd2 = rd + vec3(1e-5);
        vec3 tt = (step(vec3(0.0), rd2) - ro) / rd2;
        float tm = min(tt.x, min(tt.y, tt.z));
        vec3 hit = ro + rd2 * tm;
        float lamp = on > 0.5 ? (rnd > 0.12 ? 0.92 : 0.4) + busy * 0.25 : (rnd > 0.95 ? 0.4 : 0.05);
        vec3 wallTint = mix(vec3(0.20, 0.19, 0.21), mix(vec3(1.0, 0.60, 0.24), brand * 1.4 + 0.04, 0.38), on);
        vec3 room;
        if (tm == tt.z) room = wallTint * (0.72 + 0.28 * hit.y);
        else if (tm == tt.y) room = rd2.y > 0.0 ? vec3(0.62, 0.53, 0.42) * (0.55 + 0.45 * hit.z) : wallTint * vec3(0.68) * (0.5 + 0.5 * hit.z);
        else room = wallTint * 0.62 * (0.5 + 0.5 * hit.z);
        room = (room + wallTint * on * 0.5) * lamp;
        // Melt the room into its average once a pane is only a few pixels wide.
        room = mix(room, wallTint * lamp * 0.72, smoothstep(0.12, 0.42, fw));
        // Reflection: the sky and the skyline, with each pane a hair out of true as real curtain wall is. The ray is bent upward so the glass always holds the glow.
        vec3 N2 = normalize(_nn + T * (rnd - 0.5) * 0.022);
        vec3 R = reflect(V, N2); R.y = abs(R.y) * 0.5 + 0.1;
        float az = atan(R.z, R.x);
        float line = 0.11 + 0.05 * vnoise(vec2(az * 11.0, 2.0)) * vnoise(vec2(az * 31.0, 5.0));
        // Curtain wall is cool against the warm stone and the evening: deep sea-green low down where it holds the city, clear sky blue toward the crown, and gold on the faces the sun is on.
        float up = smoothstep(2.0, 30.0, vY);
        float sunSide = clamp(dot(_nn, ${SUN_GLSL}) * 1.5, 0.0, 1.0);
        vec3 tint = mix(vec3(0.22, 0.40, 0.52), vec3(0.50, 0.72, 0.92), up);
        vec3 refl = mix(s2l(vec3(0.30, 0.29, 0.34)) * tint * 2.0, skyColor(normalize(R)) * tint, smoothstep(line - 0.006, line + 0.03, R.y));
        refl += vec3(1.0, 0.66, 0.36) * sunSide * (0.05 + 0.13 * up) * (0.7 + 0.6 * rnd);
        float F = (0.5 + 0.45 * pow(clamp(1.0 + dot(V, _nn), 0.0, 1.0), 2.5)) * (1.0 - on * 0.62);
        vec3 glassLight = mix(room, refl, F);
        // The strip under the glass: bronze on an empty floor, the company's own colour on a taken one, so taken floors read as ribbons round the shaft.
        vec3 spandrel = mix(s2l(vec3(0.34, 0.30, 0.27)), brand, on);
        vec3 mullion = s2l(vec3(0.44, 0.40, 0.36));
        vec3 c = mix(spandrel, vec3(0.012), band);
        c = mix(mullion, c, frame);
        if (abs(_nn.y) > 0.5) c = s2l(vec3(0.6, 0.58, 0.56));
        diffuseColor.rgb = c;
        float paneOn = band * frame * step(abs(_nn.y), 0.5);
        roughnessFactor = mix(0.65, 0.18, paneOn);
        metalnessFactor = 0.0;
        float hover = vState.z;
        vec3 _emis = glassLight * paneOn + brand * on * 0.5 * (1.0 - band) * frame + vec3(1.0, 0.86, 0.6) * hover * 0.5 * band + brand * hover * 0.25;`)
      .replace('#include <roughnessmap_fragment>', '')
      .replace('#include <metalnessmap_fragment>', '')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += _emis;');
    mat.userData.shader = shader;
  };
  mat.customProgramCacheKey = () => 'towerglass3';
  return mat;
}

function signTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 180;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 1024, 180);
  x.fillStyle = '#23242e'; x.fillRect(0, 0, 1024, 180);
  x.strokeStyle = '#c9a86a'; x.lineWidth = 8; x.strokeRect(8, 8, 1008, 164);
  x.font = '600 124px Fraunces, Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.shadowColor = 'rgba(255,190,110,.9)'; x.shadowBlur = 18;
  x.fillStyle = '#fff0cf';
  x.fillText('The Office', 512, 96);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export function makeTower(floorCount, { stub = false, env = null } = {}) {
  const group = new THREE.Group();
  const H = GROUND + floorCount * FLOOR_H;
  // Pale limestone, cut in courses: the same stone shader as the city, so the tower belongs to it.
  const stoneCourses = { color: 'diffuseColor.rgb = stone(diffuseColor.rgb, vec2(vWp.x + vWp.z * 0.7, vWp.y), fwidth(vWp.x + vWp.z * 0.7) + fwidth(vWp.y), 0.45);' };
  const stone = patch(new THREE.MeshStandardMaterial({ color: '#e7e1d6', roughness: 0.9, metalness: 0 }), stoneCourses);
  const stoneDark = patch(new THREE.MeshStandardMaterial({ color: '#d6cfc3', roughness: 0.92, metalness: 0 }), stoneCourses);
  const dark = new THREE.MeshStandardMaterial({ color: '#3c4150', roughness: 0.6, metalness: 0.1 });
  const brass = new THREE.MeshStandardMaterial({ color: '#c9a86a', roughness: 0.35, metalness: 0.8, envMap: env });
  const green = new THREE.MeshStandardMaterial({ color: '#6c9452', roughness: 0.95 });
  const box = new THREE.BoxGeometry(1, 1, 1);
  const add = (mat, w, hh, d, x, y, z, shadow = true) => { const m = new THREE.Mesh(box, mat); m.scale.set(w, hh, d); m.position.set(x, y + hh / 2, z); m.castShadow = shadow; m.receiveShadow = true; group.add(m); return m; };
  const half = TOWER_W / 2;

  // The floors themselves: glass boxes, one instance per floor, which is also what the pointer picks.
  const floorGeo = new THREE.BoxGeometry(TOWER_W, FLOOR_H * 0.86, TOWER_W);
  const state = new Float32Array(floorCount * 3);
  floorGeo.setAttribute('aState', new THREE.InstancedBufferAttribute(state, 3));
  const glass = towerGlass(); glass.envMap = env;
  const floors = new THREE.InstancedMesh(floorGeo, glass, floorCount);
  const m = new THREE.Matrix4(), col = new THREE.Color('#9fb1c4');
  floors.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, floorCount) * 3), 3);  // allocated even for an empty stub, so the shader always has vColor
  for (let i = 0; i < floorCount; i++) { m.makeTranslation(0, GROUND + i * FLOOR_H + FLOOR_H * 0.5, 0); floors.setMatrixAt(i, m); floors.setColorAt(i, col); }
  floors.frustumCulled = false; floors.castShadow = true; floors.receiveShadow = true;
  group.add(floors);

  // Floor slabs step out past the glass, which gives every floor a shadow line.
  const slabGeo = new THREE.BoxGeometry(TOWER_W + 0.6, FLOOR_H * 0.14, TOWER_W + 0.6);
  const slabs = new THREE.InstancedMesh(slabGeo, stone, floorCount + 1);
  for (let i = 0; i <= floorCount; i++) { m.makeTranslation(0, GROUND + i * FLOOR_H, 0); slabs.setMatrixAt(i, m); }
  slabs.frustumCulled = false; slabs.castShadow = true; slabs.receiveShadow = true;
  group.add(slabs);

  // Planted terraces on every eighth floor, stacked in the same two bays on each face: a rhythm the eye can read, not scatter.
  const balGeo = new THREE.BoxGeometry(1, 1, 1); balGeo.translate(0, 0.5, 0);
  const terraces = [];
  for (let i = 3; i < floorCount; i += 8) for (const [fx, fz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const off of [-half * 0.75, half * 0.75]) terraces.push([i, fx, fz, off]);
  const nBal = Math.max(1, terraces.length);
  const balSlab = new THREE.InstancedMesh(balGeo, stone, nBal), balRail = new THREE.InstancedMesh(balGeo, new THREE.MeshStandardMaterial({ color: '#b9b4a8', roughness: 0.3, metalness: 0.2, transparent: true, opacity: 0.25, envMap: env }), nBal), balPlant = new THREE.InstancedMesh(balGeo, green, nBal);
  terraces.forEach(([i, fx, fz, off], idx) => {
    const y = GROUND + i * FLOOR_H + 0.07;
    const w = fz ? 2.0 : 0.3, d = fz ? 0.3 : 2.0;
    const x = fx * (half + 0.3 + 0.15) + fz * off, z = fz * (half + 0.3 + 0.15) + fx * off;
    m.makeScale(w, 0.08, d); m.setPosition(x, y, z); balSlab.setMatrixAt(idx, m);
    const rx = fx * (half + 0.3 + 0.28) + fz * off, rz = fz * (half + 0.3 + 0.28) + fx * off;
    m.makeScale(fz ? 2.0 : 0.03, 0.26, fz ? 0.03 : 2.0); m.setPosition(rx, y + 0.08, rz); balRail.setMatrixAt(idx, m);
    m.makeScale(fz ? 1.8 : 0.2, 0.26, fz ? 0.2 : 1.8); m.setPosition(rx - fx * 0.14, y + 0.08, rz - fz * 0.14); balPlant.setMatrixAt(idx, m);
  });
  for (const b of [balSlab, balRail, balPlant]) { b.count = terraces.length; b.frustumCulled = false; b.castShadow = b !== balRail; b.receiveShadow = true; group.add(b); }

  // Corner piers and vertical fins give the shaft its lines; a pale stone frame rather than a dark one.
  const ph = floorCount * FLOOR_H;
  // No shaft at all for a ground-floor stub: a zero-height box would only contribute degenerate triangles.
  if (ph > 0) for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(stone, 0.9, ph + 0.2, 0.9, sx * (half + 0.12), GROUND, sz * (half + 0.12));
  if (ph > 0) for (let side = 0; side < 4; side++) {
    for (const o of [-half * 0.5, 0, half * 0.5]) {
      const [x, z, w, d] = side === 0 ? [o, half + 0.16, 0.11, 0.36] : side === 1 ? [o, -half - 0.16, 0.11, 0.36] : side === 2 ? [half + 0.16, o, 0.36, 0.11] : [-half - 0.16, o, 0.36, 0.11];
      add(stone, w, ph, d, x, GROUND, z);
    }
  }

  // Podium: a plaza plinth, steps, a double-height glass lobby behind a colonnade, and a wide canopy.
  add(stoneDark, TOWER_W + 9, 0.3, TOWER_W + 9, 0, 0, 0, false);
  add(stone, TOWER_W + 6.2, 0.22, TOWER_W + 6.2, 0, 0.3, 0, false);
  const lobbyGlass = new THREE.MeshStandardMaterial({ color: '#6d6a68', roughness: 0.12, metalness: 0.45, envMapIntensity: 1.3, envMap: env });
  add(lobbyGlass, TOWER_W - 0.2, GROUND - 0.9, TOWER_W - 0.2, 0, 0.52, 0);
  add(new THREE.MeshStandardMaterial({ color: '#fff1d2', emissive: '#ffd79a', emissiveIntensity: 0.35, roughness: 0.9 }), TOWER_W - 0.6, 0.5, TOWER_W - 0.6, 0, 0.52, 0, false);
  const colGeo = new THREE.CylinderGeometry(0.24, 0.24, GROUND - 0.5, 10);
  for (let i = -2; i <= 2; i++) for (const s of [-1, 1]) {
    for (const [x, z] of [[i * 2.1, s * (half + 1.6)], [s * (half + 1.6), i * 2.1]]) {
      const c = new THREE.Mesh(colGeo, stone); c.position.set(x, 0.52 + (GROUND - 0.5) / 2, z); c.castShadow = true; c.receiveShadow = true; group.add(c);
    }
  }
  add(stone, TOWER_W + 4.4, 0.34, TOWER_W + 4.4, 0, GROUND - 0.34, 0);
  add(brass, TOWER_W + 4.6, 0.06, TOWER_W + 4.6, 0, GROUND - 0.4, 0, false);
  // Entrance: a dark portal with brass trim on the front face, and planters flanking the steps.
  add(dark, 2.4, 2.2, 0.3, 0, 0.52, half - 0.05);
  add(brass, 2.6, 0.08, 0.36, 0, 2.72, half - 0.05, false);
  for (const s of [-1, 1]) { add(stoneDark, 1.6, 0.5, 0.9, s * 4.6, 0.52, half + 2.4); add(green, 1.3, 0.4, 0.6, s * 4.6, 1.02, half + 2.4); }
  for (let i = 0; i < 3; i++) add(stone, 7, 0.1, 0.5, 0, 0.3 + i * 0.07, half + 3.2 + i * 0.45, false);

  if (stub) { mergeMeshes(group); return { group, floors, state, glass, height: H }; }
  // A small TO LET board on each face of an empty floor. setFloors shows the ones that are really free.
  const boards = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.26, 0.4), new THREE.MeshBasicMaterial({ map: toLetTexture(), color: '#e9e2d4' }), Math.max(1, floorCount * 4));
  boards.count = 0; boards.frustumCulled = false; group.add(boards);
  const bay = TOWER_W / 6;
  const boardAt = (i, a) => { const ang = (a * Math.PI) / 2, r = half + 0.02, off = ([-2.5, 1.5, -0.5, 2.5, -1.5, 0.5][(i * 5 + a * 2) % 6]) * bay; m.makeRotationY(ang); m.setPosition(Math.sin(ang) * r + Math.cos(ang) * off, GROUND + i * FLOOR_H + FLOOR_H * 0.42, Math.cos(ang) * r - Math.sin(ang) * off); return m; };
  // The crown: stepped terraces with greenery, a louvred plant screen, brass trim, the sign and a mast.
  let y = H;
  add(stone, TOWER_W + 0.6, 0.3, TOWER_W + 0.6, 0, y, 0); y += 0.3;
  for (const s of [-1, 1]) { add(green, 1.1, 0.35, TOWER_W - 1.2, s * (half - 0.6), y, 0, false); add(green, TOWER_W - 1.2, 0.35, 1.1, 0, y, s * (half - 0.6), false); }
  const steps = [[TOWER_W - 1.6, 1.5], [TOWER_W - 3.2, 1.3], [TOWER_W - 4.8, 1.1]];
  const signTex = signTexture();
  const signMat = new THREE.MeshBasicMaterial({ map: signTex, transparent: true, depthWrite: false });
  steps.forEach(([w, hh], i) => {
    add(stone, w, hh, w, 0, y, 0);
    if (i === 0) {
      for (let a = 0; a < 4; a++) {
        const s = new THREE.Mesh(new THREE.PlaneGeometry(6.6, 1.16), signMat);
        const ang = (a * Math.PI) / 2;
        s.position.set(Math.sin(ang) * (w / 2 + 0.02), y + hh / 2, Math.cos(ang) * (w / 2 + 0.02));
        s.rotation.y = ang; group.add(s);
      }
    }
    add(brass, w + 0.24, 0.1, w + 0.24, 0, y + hh, 0, false);
    y += hh + 0.1;
  });
  // The mast keeps its proportion to the building: a tall one would dwarf a short tower.
  const mastH = Math.min(6.4, Math.max(2.8, ph * 0.32));
  const mast = new THREE.Mesh(new THREE.ConeGeometry(0.34, mastH, 8), brass); mast.position.set(0, y + mastH / 2, 0); mast.castShadow = true; group.add(mast);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ color: '#ff6a52' })); beacon.position.set(0, y + mastH + 0.15, 0); group.add(beacon);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: radial('#ff7a5a'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.6 }));
  glow.scale.setScalar(2.4); glow.position.copy(beacon.position); group.add(glow);
  mergeMeshes(group, (o) => o === beacon);
  return { group, floors, state, beacon, glow, glass, height: y + mastH + 0.6, signTex, boards, boardAt };
}

function toLetTexture() {
  const c = document.createElement('canvas'); c.width = 280; c.height = 64; const x = c.getContext('2d');
  x.fillStyle = '#f6efdf'; x.fillRect(0, 0, 280, 64);
  x.strokeStyle = '#a93322'; x.lineWidth = 5; x.strokeRect(5, 5, 270, 54);
  x.fillStyle = '#a93322'; x.font = '700 40px Fraunces, Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('TO LET', 140, 35);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function radial(color) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 2, 64, 64, 64); g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function makeBoats() {
  const group = new THREE.Group();
  const hull = new THREE.BoxGeometry(2.6, 0.5, 0.9), top = new THREE.BoxGeometry(1.1, 0.5, 0.6), bow = new THREE.ConeGeometry(0.45, 0.9, 4);
  const white = new THREE.MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.7 }), cabin = new THREE.MeshStandardMaterial({ color: '#4d6b86', roughness: 0.6 });
  const boats = [];
  for (let i = 0; i < 6; i++) {
    const b = new THREE.Group(); b.add(new THREE.Mesh(hull, white));
    const t = new THREE.Mesh(top, cabin); t.position.set(-0.3, 0.45, 0); b.add(t);
    const n = new THREE.Mesh(bow, white); n.rotation.z = -Math.PI / 2; n.rotation.y = Math.PI / 4; n.position.x = 1.65; b.add(n);
    b.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    boats.push({ mesh: b, r: 128 + i * 16, a: -2.2 - i * 0.25, s: 0.005 + i * 0.0012 });
    group.add(b);
  }
  return { group, boats };
}

/** The world outside the tower, built once and shared: the lobby orbits it, and an office floor sits on top of it. */
let worldCache = null;
export function getWorld() {
  if (worldCache) return worldCache;
  const density = stage.q?.density ?? 1;
  const group = new THREE.Group();
  const sky = makeSky(), water = makeWater();
  const city = makeCity(density);
  const land = makeLand(city.cells);
  const traffic = makeTraffic(Math.round(160 * density + 40));
  const boats = makeBoats();
  const shore = makeFarShore();
  group.add(sky, water, shore, land, city.group, traffic, boats.group);
  worldCache = {
    group, sky, water, land, city: city.city, blocks: city.blocks, detail: city.detail, stats: city.stats, boats: boats.boats, env: null,
    update(dt, time) {
      sky.material.uniforms.uTime.value = time;
      water.material.uniforms.uTime.value = time;
      traffic.material.uniforms.uTime.value = time;
      for (const b of boats.boats) {
        b.a += b.s * dt; const x = Math.cos(b.a) * b.r, z = Math.sin(b.a) * b.r;
        b.mesh.position.set(x, -0.75 + Math.sin(time * 1.3 + b.r) * 0.04, z); b.mesh.rotation.y = -b.a + Math.PI / 2; b.mesh.rotation.z = Math.sin(time * 0.9 + b.r) * 0.02;
      }
    },
    setDetail(on) {
      for (const d of city.detail) d.visible = on;
      // Detail goes with the tier that also loses its shadow map, so that is when the baked shadows come in.
      const baked = land.userData.baked;
      if (!on && !baked.uBaked.value) baked.uBaked.value = bakeGroundShadows(city.blocks);
      baked.uBakedOn.value = on ? 0 : 1;
    },
    /** Reflections for glass come from the sky itself, baked once into a small environment map. Null where half-float targets can't be drawn into. */
    environment() {
      if (this.env || !stage.renderer || !stage.floatTargets) return this.env;
      const pm = new THREE.PMREMGenerator(stage.renderer);
      const skyScene = new THREE.Scene(); skyScene.add(sky);
      this.env = pm.fromScene(skyScene, 0.04).texture;
      group.add(sky);
      pm.dispose();
      return this.env;
    },
    /** The baked sky lived only on the GPU. Bake it again and hand the new one to everything holding the old. */
    rebake() {
      const old = this.env; this.env = null;
      const env = this.environment();
      if (!old || !env) return;
      for (const scene of new Set([stage.view?.scene, this.group.parent].filter(Boolean))) {
        if (scene.environment === old) scene.environment = env;
        scene.traverse((o) => { for (const m of [].concat(o.material || [])) if (m.envMap === old) m.envMap = env; });
      }
    },
  };
  stage.onRestored.add(() => worldCache.rebake());
  return worldCache;
}

const PHONE_TOP = 70, PHONE_BOTTOM = 200;  // what the lobby's own sign and its bottom stack (news strip, To Let board, the directory's edge) cover on a phone
export class LobbyView {
  constructor({ floorCount = 10, onHover, onPick } = {}) {
    Object.assign(this, { floorCount, onHover, onPick });
    if (bakeFloors !== floorCount) {  // the shadows on the ground are the height of this building, whoever baked them first
      bakeFloors = floorCount;
      const baked = worldCache?.land.userData.baked; if (baked?.uBaked.value) { baked.uBaked.value.dispose(); baked.uBaked.value = null; if (baked.uBakedOn.value) baked.uBaked.value = bakeGroundShadows(worldCache.blocks); }
    }
    this.scene = new THREE.Scene();
    // Fog with a long start, so the near city keeps its full colour and everything far melts into the warm haze (see the fog chunks above).
    this.scene.fog = new THREE.Fog('#ffffff', 170, 1040);
    this.grade = { vignette: 0.26, grain: 0.018, warm: 1 };
    this.ao = { radius: 1.6, intensity: 2.5, color: '#21131c', falloff: 1 };
    this.bloom = 0.24;
    // Nothing that casts a shadow moves here, so the big shadow map is drawn once and kept.
    this.staticShadows = true;
    this.tilt = { center: 0.62, width: 0.62, amount: 0.0042 };
    // A long lens from far back: the miniature, tilt-shift feel of a model city, with the whole tower and the glowing horizon in frame.
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.5, 1800);
    // A soft lilac sky over warm bounce from the ground, a low gold sun, and a cool violet fill from the opposite side, so the shadows have colour against the light.
    this.hemi = new THREE.HemisphereLight('#b9bfd8', '#cf9f70', 0.6); this.scene.add(this.hemi);
    const sun = new THREE.DirectionalLight('#ffc087', 4.5); sun.position.copy(SUN).multiplyScalar(240); sun.target.position.set(0, 0, 0);
    Object.assign(sun.shadow.camera, { left: -140, right: 140, top: 120, bottom: -110, near: 30, far: 520 });
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.08; sun.shadow.camera.updateProjectionMatrix();
    this.sun = sun; this.scene.add(sun, sun.target);
    const fill = new THREE.DirectionalLight('#8f94d8', 0.5); fill.position.set(-SUN.x * 120, 50, -SUN.z * 120); this.scene.add(fill);
    this.world = getWorld(); this.scene.add(this.world.group); this.stats = this.world.stats;
    const env = this.world.environment();
    this.scene.environment = env; this.scene.environmentIntensity = 0.42;
    this.tower = makeTower(floorCount, { env }); this.scene.add(this.tower.group);
    this.startTheta = 0.72; this.theta = 0.72; this.targetTheta = 0.72;
    this.dist = this.frame(false); this.targetDist = this.dist; this.time = 0; this.spin = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 0.016; this.hover = -1; this.flying = null; this.shiftX = 0;
    this.ray = new THREE.Raycaster(); this.ptr = new THREE.Vector2();
    this.floorData = new Map();
    this.setTier(stage.q || { shadow: 2048, density: 1 });
    this.bind();
  }
  setTier(q) {
    const sh = q.shadow || 0;
    this.sun.castShadow = sh > 0;
    if (sh > 0) { this.sun.shadow.mapSize.set(sh, sh); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null; }
    this.world.setDetail(q.density >= 0.6);
    if (this.active) { const r = stage.renderer; r.shadowMap.enabled = sh > 0; r.shadowMap.autoUpdate = false; r.shadowMap.needsUpdate = sh > 0; }
  }
  bind() {
    const el = document.getElementById('scene');
    this.pointers = new Map();
    this.onDown = (e) => {
      if (!this.active || e.target !== el) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: false, axis: null };
      el.setPointerCapture?.(e.pointerId);
    };
    this.onMove = (e) => {
      if (!this.active) return;
      if (this.drag && this.pointers.has(e.pointerId)) {
        const dx = e.clientX - this.drag.x;
        this.drag.x = e.clientX; this.drag.y = e.clientY;
        if (Math.hypot(e.clientX - this.drag.sx, e.clientY - this.drag.sy) > 7) this.drag.moved = true;
        this.targetTheta -= dx * 0.0058;
        this.lastTouch = performance.now();
        return;
      }
      if (e.pointerType === 'mouse') this.pick(e.clientX, e.clientY, false);
    };
    this.onUp = (e) => {
      if (!this.active) return;
      const d = this.drag; this.pointers.delete(e.pointerId);
      this.drag = null;
      if (d && !d.moved && performance.now() - d.t < 500) this.pick(e.clientX, e.clientY, true);
    };
    el.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
  }
  /** The whole building in frame, ground to mast, whatever its height: the same picture as a taller tower, brought closer. */
  frame(phone) {
    this.lookY = this.tower.height * 0.47;
    if (!phone) return this.tower.height * ((this.h || 800) <= 520 ? 2.12 : 2.26);
    // A phone gives the tower what its sign and its bottom stack leave: nearly all of a tall screen, less of a short one.
    const free = Math.min(0.72, Math.max(0.5, ((this.h || 800) - PHONE_TOP - PHONE_BOTTOM) / (this.h || 800)));
    return this.tower.height * (1.66 / free);
  }
  enter() {
    this.active = true; this.flying = null; this.camera.clearViewOffset();
    this.scene.add(this.world.group); this.world.group.position.set(0, 0, 0); this.world.group.scale.setScalar(1);
    const r = stage.renderer; r.shadowMap.enabled = this.sun.castShadow; r.shadowMap.autoUpdate = false; r.shadowMap.needsUpdate = true;  // the stage redraws it every other frame
    r.toneMappingExposure = 0.92;
  }
  leave() { this.active = false; this.setHover(-1); }
  resize(w, h) {
    this.w = w; this.h = h;
    this.camera.aspect = w / h;
    const phone = w <= 760;
    // Frame the tower in the clear area: left of the desktop panel, above the phone's sheet.
    // On a wide screen the tower stands in the gap between the sign on the left and the directory on the right. A phone on its side has the directory folded to its
    // search row, and stands the same way, clear of the buttons beside it.
    const short = h <= 520, heroRight = short ? Math.min(w * 0.3, 250) + 12 : Math.min(w * 0.3, 372) + 24, panelLeft = short ? w - 314 : w - 404;
    this.shiftX = phone ? 0 : Math.round(w / 2 - (heroRight + panelLeft) / 2);
    this.shiftY = phone ? (PHONE_BOTTOM - PHONE_TOP) / 2 - h * 0.012 : 0;
    this.targetDist = this.frame(phone);
    if (!this.framed) { this.dist = this.targetDist; this.framed = true; }  // the first picture is the right one, with no zoom into place
    this.camera.setViewOffset(w, h, this.shiftX, this.shiftY, w, h);
    this.camera.updateProjectionMatrix();
  }
  setFloors(cards, toLet = []) {
    this.floorData = new Map(cards.map((c) => [c.number, c]));
    const col = new THREE.Color(); const f = this.tower.floors; const st = this.tower.state;
    const free = new Set(toLet), { boards, boardAt } = this.tower;
    let shown = 0;
    for (let i = 0; i < this.floorCount; i++) if (free.has(i + 1)) for (let a = 0; a < 4; a++) boards.setMatrixAt(shown++, boardAt(i, a));
    boards.count = shown; boards.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < this.floorCount; i++) {
      const c = this.floorData.get(i + 1);
      col.set(c ? c.colors.primary : '#9fb1c4');
      f.setColorAt(i, col);
      st[i * 3] = c && c.status === 'active' ? 1 : 0;
      st[i * 3 + 1] = c?.busy ? 1 : 0;
    }
    f.instanceColor.needsUpdate = true;
    f.geometry.getAttribute('aState').needsUpdate = true;
  }
  pick(x, y, click) {
    if (this.flying) return;
    this.ptr.set((x / this.w) * 2 - 1, -(y / this.h) * 2 + 1);
    this.ray.setFromCamera(this.ptr, this.camera);
    const hit = this.ray.intersectObject(this.tower.floors, false)[0];
    const n = hit ? hit.instanceId + 1 : -1;
    this.setHover(n);
    if (click) this.onPick?.(n);
    else this.onHover?.(n, x, y);
    document.getElementById('scene').style.cursor = n > 0 ? 'pointer' : 'grab';
  }
  setHover(n) {
    if (n === this.hover) return;
    const st = this.tower.state;
    if (this.hover > 0) st[(this.hover - 1) * 3 + 2] = 0;
    if (n > 0) st[(n - 1) * 3 + 2] = 1;
    this.hover = n;
    this.tower.floors.geometry.getAttribute('aState').needsUpdate = true;
  }
  /** Fly the camera to a floor's glass, resolving once it fills the view. */
  flyTo(n) {
    this.setHover(n);
    return new Promise((resolve) => {
      this.flying = { n, t: 0, from: this.camera.position.clone(), resolve, y: GROUND + (n - 0.5) * FLOOR_H };
    });
  }
  update(dt) {
    this.time += dt;
    this.world.update(dt, this.time);
    if (this.tower.glass.userData.shader) this.tower.glass.userData.shader.uniforms.uTime.value = this.time;
    this.tower.beacon.visible = this.tower.glow.visible = (this.time % 2.4) < 1.3;
    if (this.flying) {
      const f = this.flying; f.t = Math.min(1, f.t + dt / 0.55);
      const e = f.t * f.t * (3 - 2 * f.t);
      const dir = new THREE.Vector3(Math.sin(this.theta), 0, Math.cos(this.theta));
      const to = dir.clone().multiplyScalar(TOWER_W / 2 + 1.4).setY(f.y);
      this.camera.position.lerpVectors(f.from, to, e);
      this.camera.lookAt(0, f.y + (1 - e) * 2, 0);
      if (f.t >= 1) { const r = f.resolve; this.flying = null; r(); }
      return;
    }
    // Idle: the tower turns itself, slowly. Interaction pauses that for a while.
    if (!this.drag && (!this.lastTouch || performance.now() - this.lastTouch > 3500)) this.targetTheta += this.spin * dt;
    const k = 1 - Math.exp(-dt * 6);
    this.theta += (this.targetTheta - this.theta) * k;
    this.dist += (this.targetDist - this.dist) * k;
    // A raised, slightly oblique view: high enough to read the streets, low enough to look a floor in the eye.
    this.camera.position.set(Math.sin(this.theta) * this.dist, this.lookY + this.dist * 0.2, Math.cos(this.theta) * this.dist);
    this.camera.lookAt(0, this.lookY, 0);
  }
}
