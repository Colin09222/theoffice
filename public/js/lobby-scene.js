// The lobby: a daylight harbour city built procedurally, with one tall tower you can turn and ride. No external models or textures.
// Everything is instanced or merged, lit by one sun with a real shadow map, and softened by distance haze. The look is a calm,
// slightly hazy afternoon: pale sky, warm stone, blue-green water, long soft shadows.
import * as THREE from '../vendor/three/three.module.min.js';
import { mergeMeshes } from './batch.js';
import { stage } from './stage.js';

export const FLOOR_H = 1.0, TOWER_W = 8.6, GROUND = 3.6;
const SUN = new THREE.Vector3(0.78, 0.58, -0.26).normalize();
const FOG = '#cfdde8';
const GRID = 9, LOT = 3.3, CELLS = 36;

function rng(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const GLSL_COMMON = `
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  vec3 s2l(vec3 c){ return pow(c, vec3(2.2)); }
  float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }`;

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
    side: THREE.BackSide, depthWrite: false, uniforms: { uTime: { value: 0 } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0); gl_Position = p.xyww; }',
    fragmentShader: `varying vec3 vDir; uniform float uTime; ${GLSL_COMMON}
      void main(){
        vec3 d = normalize(vDir); float y = clamp(d.y, -0.02, 1.0);
        vec3 zen = s2l(vec3(0.34, 0.58, 0.90)), mid = s2l(vec3(0.62, 0.78, 0.93)), hor = s2l(vec3(0.84, 0.89, 0.93));
        vec3 c = mix(hor, mid, smoothstep(0.0, 0.12, y));
        c = mix(c, zen, smoothstep(0.10, 0.6, y));
        vec3 sunDir = normalize(vec3(${SUN.x.toFixed(3)}, ${SUN.y.toFixed(3)}, ${SUN.z.toFixed(3)}));
        float s = max(dot(d, sunDir), 0.0);
        c += s2l(vec3(1.0, 0.86, 0.66)) * pow(s, 6.0) * 0.22;
        c += s2l(vec3(1.0, 0.95, 0.85)) * pow(s, 60.0) * 0.5;
        c += vec3(2.4, 2.2, 1.9) * smoothstep(0.9988, 0.9994, s);
        // Thin cirrus and a few soft cumulus, drifting very slowly.
        vec2 uv = d.xz / (d.y + 0.08);
        float cir = vnoise(uv * 1.6 + vec2(uTime * 0.004, 0.0)) * 0.6 + vnoise(uv * 4.2 - uTime * 0.006) * 0.4;
        cir = smoothstep(0.55, 0.85, cir) * smoothstep(0.03, 0.2, y) * smoothstep(0.75, 0.3, y);
        float cum = vnoise(uv * 0.9 + 7.0 + uTime * 0.003) * 0.55 + vnoise(uv * 2.6 + 3.0) * 0.3 + vnoise(uv * 7.0) * 0.15;
        cum = smoothstep(0.58, 0.72, cum) * smoothstep(0.04, 0.14, y) * smoothstep(0.5, 0.18, y);
        c = mix(c, vec3(0.92, 0.93, 0.95), cir * 0.35 + cum * 0.75);
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
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]), fog: true,
    vertexShader: `varying vec3 vW;
      #include <fog_pars_vertex>
      void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: `varying vec3 vW; uniform float uTime; ${GLSL_COMMON}
      #include <fog_pars_fragment>
      float wave(vec2 p){ return sin(p.x*0.9+uTime*0.8)+sin(p.y*1.1-uTime*0.6)+sin((p.x+p.y)*2.1+uTime*1.2)*0.5+sin((p.x-p.y)*3.7-uTime*1.7)*0.25; }
      void main(){
        vec2 p = vW.xz; float e = 0.22;
        float far = smoothstep(80.0, 320.0, length(vW - cameraPosition));
        vec3 n = normalize(mix(vec3(wave(p+vec2(e,0.))-wave(p), 10.0, wave(p+vec2(0.,e))-wave(p)), vec3(0.0, 10.0, 0.0), far));
        vec3 v = normalize(cameraPosition - vW);
        vec3 r = reflect(-v, n);
        vec3 sunDir = normalize(vec3(${SUN.x.toFixed(3)}, ${SUN.y.toFixed(3)}, ${SUN.z.toFixed(3)}));
        float s = pow(max(dot(r, sunDir), 0.0), 120.0);
        float fres = pow(1.0 - max(dot(v, n), 0.0), 3.0);
        vec3 deep = s2l(vec3(0.16, 0.40, 0.52)), shallow = s2l(vec3(0.30, 0.56, 0.64)), sky = s2l(vec3(0.80, 0.88, 0.93));
        float shore = smoothstep(150.0, 105.0, length(vW.xz));
        vec3 c = mix(mix(deep, shallow, shore), sky, 0.18 + fres * 0.6) + vec3(1.0, 0.95, 0.85) * s * 1.4;
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

function makeLand(cells) {
  const shape = new THREE.Shape();
  const n = 160;
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2; const r = coast(a); const x = Math.cos(a) * r, y = -Math.sin(a) * r; if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y); }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 1.4, bevelEnabled: false, curveSegments: 1 });
  const mat = patch(new THREE.MeshLambertMaterial({ color: '#ffffff' }), {
    fragmentHead: 'uniform sampler2D uCells;',
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
        vec3 asphalt = s2l(vec3(0.30, 0.31, 0.33)), paving = s2l(vec3(0.72, 0.69, 0.64)), lot = s2l(vec3(0.55, 0.52, 0.48));
        vec3 grass = s2l(vec3(0.46, 0.60, 0.32)), plaza = s2l(vec3(0.82, 0.78, 0.71));
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
      }
      diffuseColor.rgb = base;`,
  });
  mat.onBeforeCompile = ((orig) => (shader) => { shader.uniforms.uCells = { value: cells }; orig(shader); })(mat.onBeforeCompile);
  const m = new THREE.Mesh(geo, mat);
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
    float fw = fwidth(p.x) + fwidth(p.y);
    float win;
    if (style < 0.5) win = step(0.3, f.x) * step(f.x, 0.7) * step(0.3, f.y) * step(f.y, 0.82);
    else if (style < 1.5) win = step(0.06, f.x) * step(0.3, f.y) * step(f.y, 0.9);
    else if (style < 2.5) win = step(0.05, f.x) * step(0.1, f.y);
    else win = step(0.26, f.x) * step(f.x, 0.74) * step(0.22, f.y) * step(f.y, 0.86);
    float avg = style < 0.5 ? 0.2 : style < 2.5 ? 0.4 : 0.3;
    win = mix(win, avg, smoothstep(0.3, 1.0, fw));
    float sky = clamp(_nn.y * 0.5 + 0.5 + f.y * 0.5, 0.0, 1.0);
    vec3 glass = mix(s2l(vec3(0.20, 0.27, 0.36)), s2l(vec3(0.56, 0.68, 0.80)), f.y * 0.8);
    float lit = step(0.94, hash(floor(p) + vSeed * 77.0));
    glass = mix(glass, s2l(vec3(0.95, 0.85, 0.65)), lit * 0.6);
    if (style > 1.5 && style < 2.5) {
      // Curtain wall: a darker spandrel band between the glass rows.
      float band = step(0.1, f.y) * step(f.y, 0.3);
      glass = mix(glass, base * 0.55, band);
    }
    base = mix(base, glass, win * 0.92);
    float parapet = step(vSize.y - 0.3, yv);
    base = mix(base, diffuseColor.rgb * 1.06, parapet);
    base *= 0.70 + 0.30 * smoothstep(0.0, 3.5, yv);
  } else if (_nn.y > 0.5) {
    vec2 rim = abs(vLocal.xz) * 2.0;
    float edge = smoothstep(0.84, 0.9, max(rim.x, rim.y));
    base = mix(base * 0.72 * (0.94 + 0.12 * vnoise(vMp.xz * 2.0)), base * 1.05, edge);
  }
  diffuseColor.rgb = base;`;

function buildingMaterial() {
  return patch(new THREE.MeshLambertMaterial({ color: '#ffffff' }), {
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
  const palette = ['#e3d3bc', '#cdb896', '#b89a7c', '#ece2d2', '#a99680', '#d6cbbc', '#8e9aa6', '#c48f6e', '#dcbb9b', '#7f8c99', '#c9a37e', '#dcd6cc', '#a07f66', '#b8ab96', '#b3573f', '#d9a86c', '#6f7d8c', '#c7c0b4'];
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
  const roofs = new THREE.InstancedMesh(roofGeo, new THREE.MeshLambertMaterial({ color: '#ffffff' }), low.length);
  const roofCols = ['#b8604a', '#c47a58', '#a9584a', '#8f6a5c', '#b97b5e'];
  low.forEach((b, i) => { m.makeScale(b.w * 1.04, 0.9 + b.w * 0.22, b.d * 1.04); m.setPosition(b.x, b.height, b.z); roofs.setMatrixAt(i, m); roofs.setColorAt(i, col.set(roofCols[i % roofCols.length])); });
  roofs.frustumCulled = false; roofs.castShadow = true; roofs.receiveShadow = true;

  const tall = blocks.filter((b) => b.height > 6 && !b.top);
  for (const b of tall) { units.push([b.x + b.w * 0.18, b.height, b.z - b.d * 0.12, b.w * 0.36, 0.7, b.d * 0.3]); if (b.w > 3) units.push([b.x - b.w * 0.25, b.height, b.z + b.d * 0.2, b.w * 0.2, 0.45, b.d * 0.2]); }
  const unitMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshLambertMaterial({ color: '#8d8a8c' }), units.length);
  units.forEach((u, i) => { m.makeScale(u[3], u[4], u[5]); m.setPosition(u[0], u[1], u[2]); unitMesh.setMatrixAt(i, m); });
  unitMesh.frustumCulled = false; unitMesh.castShadow = true;

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
  const balMesh = new THREE.InstancedMesh(balGeo, new THREE.MeshLambertMaterial({ color: '#efe9df' }), Math.max(1, balconies.length));
  balconies.forEach((b, i) => { m.makeScale(b[3], 0.1, b[4]); m.setPosition(b[0], b[1], b[2]); balMesh.setMatrixAt(i, m); });
  const railMesh = new THREE.InstancedMesh(balGeo, new THREE.MeshLambertMaterial({ color: '#4c5560' }), Math.max(1, balconies.length));
  balconies.forEach((b, i) => { const [, , , w, d, fx, fz] = b; m.makeScale(fz ? w : 0.04, 0.42, fz ? 0.04 : d); m.setPosition(b[0] + fx * 0.2, b[1] + 0.1, b[2] + fz * 0.2); railMesh.setMatrixAt(i, m); });
  balMesh.frustumCulled = railMesh.frustumCulled = false; balMesh.castShadow = true; balMesh.count = railMesh.count = balconies.length;

  // Trees: trunks and low-poly canopies in two instanced draws.
  const trunkGeo = new THREE.CylinderGeometry(0.07, 0.1, 1, 5, 1, true); trunkGeo.translate(0, 0.5, 0);
  const canopyGeo = new THREE.IcosahedronGeometry(0.66, 0); canopyGeo.translate(0, 1.42, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: '#6b5443' }), trees.length);
  const canopies = new THREE.InstancedMesh(canopyGeo, new THREE.MeshLambertMaterial({ color: '#ffffff' }), trees.length);
  const leaf = ['#5f8a4a', '#6f9a52', '#4f7a46', '#7c9c4c', '#587f58', '#8aa24f'];
  trees.forEach((t, i) => {
    m.makeScale(t[2], t[2] * 1.05, t[2]); m.setPosition(t[0], 0, t[1]); trunks.setMatrixAt(i, m);
    m.makeScale(t[2] * (0.9 + (i % 3) * 0.1), t[2] * (1.0 + (i % 4) * 0.12), t[2]); m.setPosition(t[0], 0, t[1]); canopies.setMatrixAt(i, m);
    canopies.setColorAt(i, col.set(leaf[i % leaf.length]));
  });
  trunks.frustumCulled = canopies.frustumCulled = false; canopies.castShadow = true; trunks.castShadow = true; canopies.receiveShadow = true;

  const group = new THREE.Group().add(mesh, roofs, unitMesh, balMesh, railMesh, trunks, canopies);
  return { group, city: mesh, cells: cellMap(spots), detail: [balMesh, railMesh, unitMesh], stats: { buildings: blocks.length, trees: trees.length, balconies: balconies.length } };
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
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aState; varying vec3 vState; varying vec3 vLocal; varying vec3 vNrm; varying float vY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvState = aState; vLocal = position; vNrm = normal; vY = (instanceMatrix * vec4(position, 1.0)).y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uTime; varying vec3 vState; varying vec3 vLocal; varying vec3 vNrm; varying float vY; ${GLSL_COMMON}`)
      .replace('#include <color_fragment>', `
        vec3 _nn = normalize(vNrm);
        vec3 brand = vColor.rgb;
        float u = (abs(_nn.x) > 0.5 ? vLocal.z : vLocal.x) + ${(TOWER_W / 2).toFixed(2)};
        float bays = 8.0;
        float cell = fract(u / ${TOWER_W.toFixed(2)} * bays);
        float fw = fwidth(u / ${TOWER_W.toFixed(2)} * bays);
        float frame = smoothstep(0.02, 0.05, cell) * smoothstep(0.98, 0.95, cell);
        frame = mix(frame, 0.92, smoothstep(0.35, 1.1, fw));
        float yv = vLocal.y / ${(FLOOR_H * 0.86).toFixed(2)} + 0.5;
        float band = smoothstep(0.08, 0.14, yv) * smoothstep(0.995, 0.96, yv);
        float id = floor(u / ${TOWER_W.toFixed(2)} * bays) + floor(vY) * 13.0 + (abs(_nn.x) > 0.5 ? 40.0 : 0.0) + sign(_nn.x + _nn.z) * 7.0;
        float rnd = hash(vec2(id, 3.0));
        float flicker = vState.y * (0.5 + 0.5 * sin(uTime * (1.5 + rnd * 3.0) + rnd * 40.0));
        float on = clamp(vState.x * (0.7 + 0.3 * step(0.25, rnd)) + flicker * 0.3, 0.0, 1.0);
        vec3 glass = mix(s2l(vec3(0.30, 0.44, 0.58)), s2l(vec3(0.58, 0.70, 0.80)), yv * 0.7);
        vec3 blinds = mix(s2l(vec3(0.86, 0.84, 0.80)), brand, 0.72 + 0.28 * step(0.5, rnd));
        vec3 tint = mix(glass, blinds, on);
        vec3 spandrel = s2l(vec3(0.78, 0.74, 0.68));
        vec3 mullion = s2l(vec3(0.62, 0.64, 0.66));
        vec3 c = mix(spandrel, tint, band);
        c = mix(mullion, c, frame);
        if (abs(_nn.y) > 0.5) c = s2l(vec3(0.6, 0.58, 0.56));
        diffuseColor.rgb = c;
        roughnessFactor = mix(0.6, 0.22, band * frame * (1.0 - on * 0.5));
        metalnessFactor = mix(0.0, 0.25, band * frame);
        float hover = vState.z;
        vec3 _emis = brand * on * 0.18 * band * frame + vec3(1.0, 0.93, 0.7) * hover * 0.42 * band + brand * hover * 0.2;`)
      .replace('#include <roughnessmap_fragment>', '')
      .replace('#include <metalnessmap_fragment>', '')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += _emis;');
    // roughnessFactor and metalnessFactor are declared by the chunks we removed, so declare them before use.
    shader.fragmentShader = shader.fragmentShader.replace('vec3 _nn = normalize(vNrm);', 'float roughnessFactor; float metalnessFactor;\nvec3 _nn = normalize(vNrm);');
    mat.userData.shader = shader;
  };
  mat.customProgramCacheKey = () => 'towerglass';
  return mat;
}

function signTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 180;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 1024, 180);
  x.font = '500 118px Fraunces, Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = 'rgba(30,34,52,.95)';
  x.fillText('The Office', 512, 96);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export function makeTower(floorCount, { stub = false, env = null } = {}) {
  const group = new THREE.Group();
  const H = GROUND + floorCount * FLOOR_H;
  const stone = new THREE.MeshLambertMaterial({ color: '#efe4d2' });
  const stoneDark = new THREE.MeshLambertMaterial({ color: '#d9d1c3' });
  const dark = new THREE.MeshLambertMaterial({ color: '#3c4150' });
  const brass = new THREE.MeshStandardMaterial({ color: '#c9a86a', roughness: 0.35, metalness: 0.8, envMap: env });
  const green = new THREE.MeshLambertMaterial({ color: '#6c9452' });
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

  // Balconies alternate faces floor by floor, with a planter of greenery on each.
  const balGeo = new THREE.BoxGeometry(1, 1, 1); balGeo.translate(0, 0.5, 0);
  const nBal = floorCount * 2;
  const balSlab = new THREE.InstancedMesh(balGeo, stone, nBal), balRail = new THREE.InstancedMesh(balGeo, new THREE.MeshStandardMaterial({ color: '#cfdbe4', roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.55, envMap: env }), nBal), balPlant = new THREE.InstancedMesh(balGeo, green, nBal);
  for (let i = 0; i < floorCount; i++) {
    const y = GROUND + i * FLOOR_H + 0.07;
    const faces = i % 2 ? [[1, 0], [-1, 0]] : [[0, 1], [0, -1]];
    faces.forEach(([fx, fz], k) => {
      const idx = i * 2 + k;
      const off = (((i * 7 + k * 3) % 3) - 1) * 2.2;
      const x = fx * (half + 0.3 + 0.45) + fz * off, z = fz * (half + 0.3 + 0.45) + fx * off;
      const w = fz ? 2.6 : 0.9, d = fz ? 0.9 : 2.6;
      m.makeScale(w, 0.1, d); m.setPosition(x, y, z); balSlab.setMatrixAt(idx, m);
      const rx = fx * (half + 0.3 + 0.9 - 0.03) + fz * off, rz = fz * (half + 0.3 + 0.9 - 0.03) + fx * off;
      m.makeScale(fz ? 2.6 : 0.05, 0.46, fz ? 0.05 : 2.6); m.setPosition(rx, y + 0.1, rz); balRail.setMatrixAt(idx, m);
      m.makeScale(fz ? 2.0 : 0.3, 0.3, fz ? 0.3 : 2.0); m.setPosition(rx - fx * 0.2, y + 0.1, rz - fz * 0.2); balPlant.setMatrixAt(idx, m);
    });
  }
  for (const b of [balSlab, balRail, balPlant]) { b.frustumCulled = false; b.castShadow = b !== balRail; b.receiveShadow = true; group.add(b); }

  // Corner piers and vertical fins give the shaft its lines; a pale stone frame rather than a dark one.
  const ph = floorCount * FLOOR_H;
  // No shaft at all for a ground-floor stub: a zero-height box would only contribute degenerate triangles.
  if (ph > 0) for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(stone, 0.9, ph + 0.2, 0.9, sx * (half + 0.12), GROUND, sz * (half + 0.12));
  if (ph > 0) for (let side = 0; side < 4; side++) {
    for (const o of [-half * 0.5, 0, half * 0.5]) {
      const [x, z, w, d] = side === 0 ? [o, half + 0.22, 0.16, 0.5] : side === 1 ? [o, -half - 0.22, 0.16, 0.5] : side === 2 ? [half + 0.22, o, 0.5, 0.16] : [-half - 0.22, o, 0.5, 0.16];
      add(stone, w, ph, d, x, GROUND, z);
    }
  }

  // Podium: a plaza plinth, steps, a double-height glass lobby behind a colonnade, and a wide canopy.
  add(stoneDark, TOWER_W + 9, 0.3, TOWER_W + 9, 0, 0, 0, false);
  add(stone, TOWER_W + 6.2, 0.22, TOWER_W + 6.2, 0, 0.3, 0, false);
  const lobbyGlass = new THREE.MeshStandardMaterial({ color: '#8fb0c8', roughness: 0.15, metalness: 0.3, envMapIntensity: 1.2, envMap: env });
  add(lobbyGlass, TOWER_W - 0.2, GROUND - 0.9, TOWER_W - 0.2, 0, 0.52, 0);
  add(new THREE.MeshLambertMaterial({ color: '#fff1d2', emissive: '#ffd79a', emissiveIntensity: 0.35 }), TOWER_W - 0.6, 0.5, TOWER_W - 0.6, 0, 0.52, 0, false);
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
        const s = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 0.98), signMat);
        const ang = (a * Math.PI) / 2;
        s.position.set(Math.sin(ang) * (w / 2 + 0.02), y + hh / 2, Math.cos(ang) * (w / 2 + 0.02));
        s.rotation.y = ang; group.add(s);
      }
    }
    add(brass, w + 0.24, 0.1, w + 0.24, 0, y + hh, 0, false);
    y += hh + 0.1;
  });
  const mast = new THREE.Mesh(new THREE.ConeGeometry(0.34, 6.4, 8), brass); mast.position.set(0, y + 3.2, 0); mast.castShadow = true; group.add(mast);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ color: '#ff6a52' })); beacon.position.set(0, y + 6.55, 0); group.add(beacon);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: radial('#ff7a5a'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.6 }));
  glow.scale.setScalar(2.4); glow.position.copy(beacon.position); group.add(glow);
  mergeMeshes(group, (o) => o === beacon);
  return { group, floors, state, beacon, glow, glass, height: y + 7, signTex };
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
  const white = new THREE.MeshLambertMaterial({ color: '#f4f1ea' }), cabin = new THREE.MeshLambertMaterial({ color: '#4d6b86' });
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
  group.add(sky, water, land, city.group, traffic, boats.group);
  worldCache = {
    group, sky, water, land, city: city.city, detail: city.detail, stats: city.stats, boats: boats.boats, env: null,
    update(dt, time) {
      sky.material.uniforms.uTime.value = time;
      water.material.uniforms.uTime.value = time;
      traffic.material.uniforms.uTime.value = time;
      for (const b of boats.boats) {
        b.a += b.s * dt; const x = Math.cos(b.a) * b.r, z = Math.sin(b.a) * b.r;
        b.mesh.position.set(x, -0.75 + Math.sin(time * 1.3 + b.r) * 0.04, z); b.mesh.rotation.y = -b.a + Math.PI / 2; b.mesh.rotation.z = Math.sin(time * 0.9 + b.r) * 0.02;
      }
    },
    setDetail(on) { for (const d of city.detail) d.visible = on; },
    /** Reflections for glass come from the sky itself, baked once into a small environment map. */
    environment() {
      if (this.env || !stage.renderer) return this.env;
      const pm = new THREE.PMREMGenerator(stage.renderer);
      const skyScene = new THREE.Scene(); skyScene.add(sky);
      this.env = pm.fromScene(skyScene, 0.04).texture;
      group.add(sky);
      pm.dispose();
      return this.env;
    },
  };
  return worldCache;
}

export class LobbyView {
  constructor({ floorCount = 40, onHover, onPick } = {}) {
    Object.assign(this, { floorCount, onHover, onPick });
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(FOG, 0.0024);
    this.grade = { vignette: 0.3, grain: 0.022 };
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.5, 1400);
    this.hemi = new THREE.HemisphereLight('#bcd6f2', '#bfae98', 1.05); this.scene.add(this.hemi);
    const sun = new THREE.DirectionalLight('#fff0d8', 3.5); sun.position.copy(SUN).multiplyScalar(160); sun.target.position.set(0, 0, 0);
    Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 80, bottom: -60, near: 20, far: 340 });
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.08; sun.shadow.camera.updateProjectionMatrix();
    this.sun = sun; this.scene.add(sun, sun.target);
    this.world = getWorld(); this.scene.add(this.world.group); this.stats = this.world.stats;
    this.tower = makeTower(floorCount, { env: this.world.environment() }); this.scene.add(this.tower.group);
    this.startTheta = 0.72; this.theta = 0.72; this.targetTheta = 0.72; this.rideY = 26; this.targetRide = 26;
    this.dist = 96; this.targetDist = 96; this.time = 0; this.spin = 0.016; this.hover = -1; this.flying = null; this.shiftX = 0;
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
    this.scene.fog.density = sh > 0 ? 0.0024 : 0.0028;
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
        const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
        this.drag.x = e.clientX; this.drag.y = e.clientY;
        if (Math.hypot(e.clientX - this.drag.sx, e.clientY - this.drag.sy) > 7) this.drag.moved = true;
        this.targetTheta -= dx * 0.0058;
        this.targetRide += dy * 0.06;
        this.lastTouch = performance.now();
        this.clampRide();
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
    this.onWheel = (e) => {
      if (!this.active || e.target !== el) return;
      e.preventDefault();
      this.targetRide -= e.deltaY * 0.022;
      this.lastTouch = performance.now();
      this.clampRide();
    };
    el.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
  }
  clampRide() { this.targetRide = Math.min(GROUND + this.floorCount * FLOOR_H + 6, Math.max(6, this.targetRide)); }
  rideTo(n) { this.targetRide = GROUND + (n - 0.5) * FLOOR_H; this.lastTouch = performance.now(); this.clampRide(); }
  enter() {
    this.active = true; this.flying = null; this.camera.clearViewOffset();
    this.scene.add(this.world.group); this.world.group.position.set(0, 0, 0); this.world.group.scale.setScalar(1);
    const r = stage.renderer; r.shadowMap.enabled = this.sun.castShadow; r.shadowMap.autoUpdate = true; r.shadowMap.needsUpdate = true;
    r.toneMappingExposure = 1.08;
  }
  leave() { this.active = false; this.setHover(-1); }
  resize(w, h) {
    this.w = w; this.h = h;
    this.camera.aspect = w / h;
    const phone = w <= 760;
    // Frame the tower in the clear area: left of the desktop panel, above the phone's sheet.
    this.shiftX = phone ? 0 : -w * 0.055;
    this.shiftY = phone ? h * 0.07 : 0;
    this.targetDist = phone ? 132 : 96;
    this.camera.setViewOffset(w, h, this.shiftX, this.shiftY, w, h);
    this.camera.updateProjectionMatrix();
  }
  setFloors(cards) {
    this.floorData = new Map(cards.map((c) => [c.number, c]));
    const col = new THREE.Color(); const f = this.tower.floors; const st = this.tower.state;
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
      const f = this.flying; f.t = Math.min(1, f.t + dt / 1.15);
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
    this.rideY += (this.targetRide - this.rideY) * k;
    this.dist += (this.targetDist - this.dist) * k;
    const lookY = this.rideY;
    // A raised, slightly oblique view: high enough to read the streets, low enough to look a floor in the eye.
    const camY = lookY + 24 + (this.floorCount - lookY) * 0.12;
    this.camera.position.set(Math.sin(this.theta) * this.dist, camY, Math.cos(this.theta) * this.dist);
    this.camera.lookAt(0, lookY - 1, 0);
  }
}
