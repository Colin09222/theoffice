// The lobby: a dusk harbour city built procedurally, with one tall tower you can turn and ride. No external models or textures.
import * as THREE from '../vendor/three/three.module.min.js';
import { mergeMeshes } from './batch.js';

const FLOOR_H = 1.0, TOWER_W = 8.6, GROUND = 3.2;
const SUN = new THREE.Vector3(-0.72, 0.13, -0.68).normalize();
const FOG_GLSL = `
  vec3 applyFog(vec3 c, vec3 world) {
    float d = length(world - cameraPosition);
    float f = 1.0 - exp(-pow(d * 0.0026, 2.0));
    vec3 viewDir = normalize(world - cameraPosition);
    float toSun = pow(max(dot(viewDir, normalize(vec3(-0.72, 0.065, -0.68))), 0.0), 3.0);
    vec3 fogCol = mix(vec3(0.62, 0.50, 0.60), vec3(1.0, 0.70, 0.52), toSun);
    return mix(c, fogCol, clamp(f, 0.0, 1.0));
  }`;
const HASH = 'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }';

function rng(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

function makeSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, uniforms: { uTime: { value: 0 } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0); gl_Position = p.xyww; }',
    fragmentShader: `varying vec3 vDir; uniform float uTime; ${HASH}
      void main(){
        vec3 d = normalize(vDir); float y = clamp(d.y, -0.05, 1.0);
        vec3 horizon = vec3(1.0, 0.70, 0.50), low = vec3(0.86, 0.50, 0.55), mid = vec3(0.38, 0.33, 0.56), top = vec3(0.09, 0.11, 0.27);
        vec3 c = mix(horizon, low, smoothstep(0.0, 0.09, y));
        c = mix(c, mid, smoothstep(0.07, 0.30, y));
        c = mix(c, top, smoothstep(0.26, 0.75, y));
        float s = max(dot(d, normalize(vec3(-0.72, 0.065, -0.68))), 0.0);
        c = mix(c, vec3(1.0, 0.68, 0.46), pow(s, 7.0) * 0.75);
        c = mix(c, vec3(1.0, 0.84, 0.62), pow(s, 90.0) * 0.6);
        c = mix(c, vec3(1.0, 0.95, 0.82), smoothstep(0.9996, 0.99985, s));
        float bands = sin(d.y * 60.0 + d.x * 5.0) * 0.5 + 0.5;
        c += vec3(0.32, 0.14, 0.10) * smoothstep(0.03, 0.08, y) * smoothstep(0.26, 0.10, y) * bands * bands * 0.32;
        vec2 g = floor(vec2(atan(d.z, d.x) * 90.0, y * 170.0));
        float star = step(0.9965, hash(g)) * smoothstep(0.3, 0.72, y);
        c += star * (0.55 + 0.45 * sin(uTime * 1.4 + hash(g + 3.0) * 30.0));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 20), mat);
  mesh.frustumCulled = false; mesh.renderOrder = -10;
  return mesh;
}

function makeWater() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `varying vec3 vW; uniform float uTime; ${FOG_GLSL}
      float wave(vec2 p){ return sin(p.x*0.7+uTime*0.7)+sin(p.y*0.9-uTime*0.5)+sin((p.x+p.y)*1.7+uTime*1.1)*0.5+sin((p.x-p.y)*3.1-uTime*1.6)*0.25; }
      void main(){
        vec2 p = vW.xz; float e = 0.25;
        float far = smoothstep(90.0, 300.0, length(vW - cameraPosition));
        vec3 n = normalize(mix(vec3(wave(p+vec2(e,0.))-wave(p), 8.0, wave(p+vec2(0.,e))-wave(p)), vec3(0.0, 8.0, 0.0), far));
        vec3 v = normalize(cameraPosition - vW);
        vec3 r = reflect(-v, n);
        float s = pow(max(dot(r, normalize(vec3(-0.72, 0.065, -0.68))), 0.0), 90.0);
        float fres = pow(1.0 - max(dot(v, n), 0.0), 3.0);
        vec3 deep = vec3(0.14, 0.24, 0.42), sky = vec3(0.90, 0.58, 0.58);
        vec3 c = mix(deep, sky, fres * 0.42) + vec3(1.0, 0.72, 0.46) * s * 1.6;
        gl_FragColor = vec4(applyFog(c, vW), 1.0);
      }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), mat);
  m.rotation.x = -Math.PI / 2; m.position.y = -0.7;
  return m;
}

const coast = (a) => 112 + Math.sin(a * 3 + 1) * 11 + Math.sin(a * 7) * 6 + Math.sin(a * 13 + 2) * 2.5 - Math.max(0, Math.cos(a - 3.9)) * 58;

function makeLand() {
  const shape = new THREE.Shape();
  const n = 140;
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2; const r = coast(a); const x = Math.cos(a) * r, y = -Math.sin(a) * r; if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y); }
  const geo = new THREE.ShapeGeometry(shape, 1);
  const mat = new THREE.ShaderMaterial({
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `varying vec3 vW; ${FOG_GLSL}
      void main(){
        vec2 c = mod(vW.xz + 4.5, 9.0);
        float fw = fwidth(vW.x) + fwidth(vW.z);
        float road = 1.0 - smoothstep(1.3, 1.4 + fw, min(c.x, c.y));
        vec3 base = mix(vec3(0.26, 0.25, 0.30), vec3(0.14, 0.14, 0.19), road);
        float dash = step(0.5, fract(max(vW.x, vW.z) * 0.5));
        base += vec3(0.3, 0.27, 0.2) * (1.0 - smoothstep(0.03, 0.08 + fw, abs(min(c.x, c.y) - 0.65))) * dash * 0.45;
        float plaza = 1.0 - smoothstep(14.0, 15.0, max(abs(vW.x), abs(vW.z)));
        vec2 t = mod(vW.xz, 2.0);
        vec3 stone = vec3(0.60, 0.53, 0.50) * (0.92 + 0.08 * step(1.0, t.x + t.y - floor((t.x + t.y) / 2.0) * 2.0));
        base = mix(base, stone, plaza);
        gl_FragColor = vec4(applyFog(base, vW), 1.0);
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = -Math.PI / 2; m.position.y = -0.02;
  return m;
}

function cityMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `attribute float aSeed; varying vec3 vW; varying vec3 vN; varying vec3 vC; varying float vS; varying vec3 vLocal; varying vec3 vSize;
      void main(){
        vec4 w = modelMatrix * instanceMatrix * vec4(position,1.0);
        vW = w.xyz; vN = normalize(mat3(instanceMatrix) * normal); vC = instanceColor; vS = aSeed;
        vLocal = position; vSize = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `varying vec3 vW; varying vec3 vN; varying vec3 vC; varying float vS; varying vec3 vLocal; varying vec3 vSize; uniform float uTime; ${HASH} ${FOG_GLSL}
      void main(){
        vec3 n = normalize(vN); vec3 sun = normalize(vec3(-0.72, 0.30, -0.68));
        float lit = max(dot(n, sun), 0.0);
        vec3 c = vC * (0.58 + lit * vec3(1.05, 0.78, 0.58) * 0.9 + max(n.y, 0.0) * vec3(0.30, 0.27, 0.36));
        if (abs(n.y) < 0.5) {
          float u = abs(n.x) > 0.5 ? vW.z : vW.x;
          vec2 size = vec2(1.15, 1.25);
          vec2 p = vec2(u, vW.y) / size;
          vec2 id = floor(p) + floor(vS * 97.0 + 0.5) * 7.0;
          vec2 f = fract(p);
          float fw = fwidth(p.x) + fwidth(p.y);
          float w = smoothstep(0.17, 0.2, f.x) * smoothstep(0.83, 0.8, f.x) * smoothstep(0.24, 0.27, f.y) * smoothstep(0.82, 0.79, f.y);
          w = mix(w, 0.42, smoothstep(0.35, 0.9, fw));
          float on = step(0.60, hash(id));
          float warmth = hash(id + 5.0);
          vec3 glow = mix(vec3(1.0, 0.76, 0.42), vec3(0.98, 0.90, 0.72), warmth);
          vec3 glass = mix(vec3(0.20, 0.23, 0.36), vec3(0.95, 0.60, 0.42), lit * 0.65);
          c = mix(c, glass, w * 0.82);
          c += glow * w * mix(on, 0.3, smoothstep(0.35, 0.9, fw)) * 0.85;
          c *= 0.70 + 0.30 * smoothstep(0.0, 7.0, vW.y);
        } else {
          vec2 rim = abs(vLocal.xz) * 2.0;
          float edge = smoothstep(0.86, 0.9, max(rim.x, rim.y));
          c = mix(c * 0.72, c * 1.12, edge);
        }
        gl_FragColor = vec4(applyFog(c, vW), 1.0);
      }`,
  });
}

function makeCity() {
  const r = rng(90210);
  const spots = [];
  for (let gx = -14; gx <= 14; gx++) for (let gz = -14; gz <= 14; gz++) {
    const cx = gx * 9, cz = gz * 9;
    const dist = Math.hypot(cx, cz);
    if (Math.max(Math.abs(cx), Math.abs(cz)) < 14) continue;
    if (dist > coast(Math.atan2(cz, cx)) - 6) continue;
    const park = r() < 0.07;
    if (park) { spots.push({ park: true, cx, cz }); continue; }
    const split = r();
    const sub = split < 0.3 ? 1 : split < 0.75 ? 2 : 3;
    const cell = 6.4 / sub;
    for (let i = 0; i < sub; i++) for (let j = 0; j < sub; j++) {
      const x = cx - 3.2 + cell * (i + 0.5) + 0.65 - 0.65, z = cz - 3.2 + cell * (j + 0.5);
      if (sub === 3 && r() < 0.14) continue;
      // A low town around the tower, so nothing on the camera's orbit ever stands between you and it.
      let height = 1.5 + r() * 2.6 + Math.pow(r(), 4) * 9;
      if (sub === 1) height += r() * 3.5;
      spots.push({ x, z, w: cell * (0.76 + r() * 0.16), d: cell * (0.76 + r() * 0.16), height });
    }
  }
  const blocks = spots.filter((s) => !s.park);
  const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, 0.5, 0);
  const seeds = new Float32Array(blocks.length);
  const mesh = new THREE.InstancedMesh(geo, cityMaterial(), blocks.length);
  const m = new THREE.Matrix4(), col = new THREE.Color();
  const palette = ['#c9a688', '#b58e78', '#d6bfa3', '#9d8b86', '#7f7f8c', '#a97d6a', '#c2ae9c', '#6e7486', '#d1a282', '#8a6f6d'];
  blocks.forEach((b, i) => {
    m.makeScale(b.w, b.height, b.d); m.setPosition(b.x, 0, b.z);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, col.set(palette[Math.floor(r() * palette.length)]));
    seeds[i] = r();
  });
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  mesh.frustumCulled = false;

  // Pitched roofs on low buildings, and water tanks on tall ones.
  const low = blocks.filter((b) => b.height < 4.2 && r() < 0.5);
  const roofGeo = new THREE.ConeGeometry(0.72, 0.5, 4); roofGeo.rotateY(Math.PI / 4); roofGeo.translate(0, 0.25, 0);
  const roofs = new THREE.InstancedMesh(roofGeo, new THREE.MeshLambertMaterial({ color: '#ffffff' }), low.length);
  const roofCols = ['#b4553a', '#c26a42', '#a24a3a', '#8a5a4a'];
  low.forEach((b, i) => { m.makeScale(b.w * 1.02, 1 + b.w * 0.25, b.d * 1.02); m.setPosition(b.x, b.height, b.z); roofs.setMatrixAt(i, m); roofs.setColorAt(i, col.set(roofCols[i % 4])); });
  roofs.frustumCulled = false;

  const tall = blocks.filter((b) => b.height > 6);
  const tankGeo = new THREE.BoxGeometry(1, 1, 1);
  const tanks = new THREE.InstancedMesh(tankGeo, new THREE.MeshLambertMaterial({ color: '#59555f' }), tall.length);
  tall.forEach((b, i) => { m.makeScale(b.w * 0.42, 0.9, b.d * 0.42); m.setPosition(b.x + b.w * 0.1, b.height + 0.45, b.z - b.d * 0.08); tanks.setMatrixAt(i, m); });
  tanks.frustumCulled = false;

  // Trees: parks plus the avenue around the plaza.
  const trees = [];
  for (const p of spots.filter((s) => s.park)) for (let i = 0; i < 9; i++) trees.push([p.cx + (r() - 0.5) * 6, p.cz + (r() - 0.5) * 6, 0.8 + r() * 0.8]);
  for (let i = -12; i <= 12; i += 3) for (const s of [-13.3, 13.3]) { trees.push([i, s, 1.1]); trees.push([s, i, 1.1]); }
  const treeGeo = new THREE.IcosahedronGeometry(0.72, 0); treeGeo.translate(0, 1.2, 0);
  const treeMesh = new THREE.InstancedMesh(treeGeo, new THREE.MeshLambertMaterial({ color: '#ffffff' }), trees.length);
  const leaf = ['#4d6f4f', '#5f7f4e', '#3f6250', '#74864b'];
  trees.forEach((t, i) => { m.makeScale(t[2], t[2] * 1.15, t[2]); m.setPosition(t[0], 0, t[1]); treeMesh.setMatrixAt(i, m); treeMesh.setColorAt(i, col.set(leaf[i % 4])); });
  treeMesh.frustumCulled = false;
  return { group: new THREE.Group().add(mesh, roofs, tanks, treeMesh), city: mesh };
}

function makeTraffic() {
  const count = 180; const r = rng(4242);
  const geo = new THREE.BoxGeometry(0.28, 0.14, 0.62); geo.translate(0, 0.1, 0);
  const a = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const ns = r() < 0.5; const line = (Math.floor(r() * 25) - 12) * 9 - 3.85 + (r() < 0.5 ? 0.35 : -0.35);
    a[i * 4] = ns ? 1 : 0; a[i * 4 + 1] = line; a[i * 4 + 2] = r() * 220; a[i * 4 + 3] = (r() < 0.5 ? -1 : 1) * (2.4 + r() * 2.6);
  }
  geo.setAttribute('aCar', new THREE.InstancedBufferAttribute(a, 4));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `attribute vec4 aCar; uniform float uTime; varying float vDir; varying vec3 vW; varying float vFront;
      void main(){
        float t = mod(aCar.z + uTime * aCar.w, 220.0) - 110.0;
        vec3 p = position; float ns = aCar.x;
        if (aCar.w < 0.0) p.z = -p.z;
        vFront = position.z / 0.31 * sign(aCar.w) * sign(aCar.w);
        vec3 w = ns > 0.5 ? vec3(aCar.y + p.x, p.y, t + p.z) : vec3(t + p.z, p.y, aCar.y + p.x);
        vDir = aCar.w; vW = w;
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
      }`,
    fragmentShader: `varying float vDir; varying vec3 vW; varying float vFront; ${FOG_GLSL}
      void main(){
        vec3 c = vFront > 0.4 ? vec3(1.0, 0.94, 0.75) * 1.5 : vFront < -0.4 ? vec3(1.0, 0.25, 0.2) : vec3(0.12, 0.12, 0.16);
        gl_FragColor = vec4(applyFog(c, vW), 1.0);
      }`,
  });
  const inst = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4(); for (let i = 0; i < count; i++) inst.setMatrixAt(i, m);
  inst.frustumCulled = false;
  return inst;
}

function towerMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `attribute vec3 aState; varying vec3 vW; varying vec3 vN; varying vec3 vC; varying vec3 vState; varying vec3 vL;
      void main(){
        vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vW = w.xyz; vN = normal; vC = instanceColor; vState = aState; vL = position;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    // aState: x = occupied, y = busy, z = hover
    fragmentShader: `varying vec3 vW; varying vec3 vN; varying vec3 vC; varying vec3 vState; varying vec3 vL; uniform float uTime; ${HASH} ${FOG_GLSL}
      void main(){
        vec3 n = normalize(vN);
        float u = abs(n.x) > 0.5 ? vL.z : vL.x;
        float cols = 9.0;
        float cell = fract(u * cols + 0.5);
        float id = floor(u * cols + 0.5) + floor(vW.y) * 13.0 + (abs(n.x) > 0.5 ? 40.0 : 0.0) + sign(n.x + n.z) * 7.0;
        float fw = fwidth(u * cols);
        float frame = smoothstep(0.03, 0.08, cell) * smoothstep(0.97, 0.92, cell);
        frame = mix(frame, 0.82, smoothstep(0.4, 1.2, fw));
        float rnd = hash(vec2(id, 3.0));
        vec3 sky = vec3(0.62, 0.46, 0.50);
        vec3 sun = normalize(vec3(-0.72, 0.30, -0.68));
        float lit = max(dot(n, sun), 0.0);
        vec3 glassEmpty = mix(vec3(0.17, 0.20, 0.31), sky, 0.34 + lit * 0.5);
        float gradient = smoothstep(-0.5, 0.5, vL.y);
        vec3 room = mix(vC * 0.82, vC * 1.2 + vec3(0.14, 0.11, 0.06), gradient);
        float flicker = vState.y * (0.5 + 0.5 * sin(uTime * (1.5 + rnd * 3.0) + rnd * 40.0));
        float on = vState.x * (0.55 + 0.45 * step(0.2, rnd)) + flicker * 0.25;
        vec3 vacantGlow = vec3(1.0, 0.80, 0.52) * step(0.86, rnd) * 0.75;
        vec3 c = mix(glassEmpty + vacantGlow, room, clamp(on, 0.0, 1.0));
        c = mix(vec3(0.20, 0.18, 0.21) + lit * 0.14, c, frame);
        if (abs(n.y) > 0.5) c = vec3(0.3, 0.27, 0.3);
        c += vState.z * (vec3(1.0, 0.86, 0.6) * 0.55 + vC * 0.25);
        gl_FragColor = vec4(applyFog(c, vW), 1.0);
      }`,
  });
}

function neonSignTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 180;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 1024, 180);
  x.font = '600 128px Fraunces, Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.shadowColor = '#ffb25e'; x.shadowBlur = 34; x.fillStyle = '#fff1d6';
  x.fillText('The Office', 512, 94); x.fillText('The Office', 512, 94);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function makeTower(floorCount) {
  const group = new THREE.Group();
  const H = GROUND + floorCount * FLOOR_H;
  const stone = new THREE.MeshLambertMaterial({ color: '#efe2cc' });
  const dark = new THREE.MeshLambertMaterial({ color: '#3b3640' });
  const gold = new THREE.MeshLambertMaterial({ color: '#d8ae6c' });
  const box = new THREE.BoxGeometry(1, 1, 1);
  const add = (mat, w, hh, d, x, y, z) => { const m = new THREE.Mesh(box, mat); m.scale.set(w, hh, d); m.position.set(x, y + hh / 2, z); group.add(m); return m; };

  const floorGeo = new THREE.BoxGeometry(TOWER_W, FLOOR_H * 0.86, TOWER_W);
  const state = new Float32Array(floorCount * 3);
  floorGeo.setAttribute('aState', new THREE.InstancedBufferAttribute(state, 3));
  const floors = new THREE.InstancedMesh(floorGeo, towerMaterial(), floorCount);
  const m = new THREE.Matrix4(), col = new THREE.Color('#7b86a0');
  for (let i = 0; i < floorCount; i++) { m.makeTranslation(0, GROUND + i * FLOOR_H + FLOOR_H * 0.5, 0); floors.setMatrixAt(i, m); floors.setColorAt(i, col); }
  floors.frustumCulled = false;
  group.add(floors);

  const slabGeo = new THREE.BoxGeometry(TOWER_W + 0.52, FLOOR_H * 0.14, TOWER_W + 0.52);
  const slabs = new THREE.InstancedMesh(slabGeo, stone, floorCount + 1);
  for (let i = 0; i <= floorCount; i++) { m.makeTranslation(0, GROUND + i * FLOOR_H + 0.0, 0); slabs.setMatrixAt(i, m); }
  slabs.frustumCulled = false;
  group.add(slabs);

  // Fins and corner piers give the shaft its vertical lines.
  const ph = floorCount * FLOOR_H;
  const half = TOWER_W / 2;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(stone, 0.8, ph + 0.2, 0.8, sx * half, GROUND, sz * half);
  for (let side = 0; side < 4; side++) {
    for (const o of [-half * 0.5, 0, half * 0.5]) {
      const [x, z, w, d] = side === 0 ? [o, half + 0.1, 0.14, 0.4] : side === 1 ? [o, -half - 0.1, 0.14, 0.4] : side === 2 ? [half + 0.1, o, 0.4, 0.14] : [-half - 0.1, o, 0.4, 0.14];
      add(stone, w, ph, d, x, GROUND, z);
    }
  }
  // Lobby base and plaza plinth, glowing warmly.
  add(new THREE.MeshLambertMaterial({ color: '#b6a891' }), TOWER_W + 7, 0.28, TOWER_W + 7, 0, 0, 0);
  const lobby = new THREE.MeshBasicMaterial({ color: '#ffd9a0' });
  add(lobby, TOWER_W - 0.4, GROUND - 0.5, TOWER_W - 0.4, 0, 0.28, 0);
  add(stone, TOWER_W + 1.3, 0.3, TOWER_W + 1.3, 0, GROUND - 0.3, 0);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(stone, 0.9, GROUND, 0.9, sx * (half + 0.2), 0.1, sz * (half + 0.2));
  for (let i = -1; i <= 1; i += 2) for (let j = -2; j <= 2; j++) {
    add(dark, 0.08, GROUND - 0.9, 0.08, j * 1.5, 0.28, i * (half - 0.15));
    add(dark, 0.08, GROUND - 0.9, 0.08, i * (half - 0.15), 0.28, j * 1.5);
  }
  // A stepped crown, with gold trim and a mast.
  let y = H;
  const steps = [[TOWER_W + 0.2, 1.3], [TOWER_W - 1.5, 1.6], [TOWER_W - 3.4, 1.7], [TOWER_W - 5.2, 1.6]];
  for (const [w, hh] of steps) { add(stone, w, hh, w, 0, y, 0); add(gold, w + 0.22, 0.14, w + 0.22, 0, y + hh, 0); y += hh + 0.14; }
  const mast = new THREE.Mesh(new THREE.ConeGeometry(0.42, 6.6, 8), gold); mast.position.set(0, y + 3.3, 0); group.add(mast);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), new THREE.MeshBasicMaterial({ color: '#ff5a44' })); beacon.position.set(0, y + 6.75, 0); group.add(beacon);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: radial('#ff6a50'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  glow.scale.setScalar(4); glow.position.copy(beacon.position); group.add(glow);
  // The rooftop sign faces all four ways.
  const signTex = neonSignTexture();
  const signMat = new THREE.MeshBasicMaterial({ map: signTex, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  for (let a = 0; a < 4; a++) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.23), signMat);
    const ang = (a * Math.PI) / 2;
    s.position.set(Math.sin(ang) * (TOWER_W / 2 + 0.25), H + 0.65, Math.cos(ang) * (TOWER_W / 2 + 0.25));
    s.rotation.y = ang;
    group.add(s);
  }
  mergeMeshes(group, (o) => o === beacon);
  return { group, floors, state, beacon, glow, height: y + 7, signTex };
}

function radial(color) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 2, 64, 64, 64); g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function makeBoats() {
  const group = new THREE.Group();
  const hull = new THREE.BoxGeometry(2.2, 0.5, 0.8), top = new THREE.BoxGeometry(0.9, 0.5, 0.56);
  const white = new THREE.MeshLambertMaterial({ color: '#efe6da' }), lamp = new THREE.MeshBasicMaterial({ color: '#ffcf8a' });
  const boats = [];
  for (let i = 0; i < 5; i++) {
    const b = new THREE.Group(); b.add(new THREE.Mesh(hull, white));
    const t = new THREE.Mesh(top, lamp); t.position.y = 0.45; b.add(t);
    boats.push({ mesh: b, r: 112 + i * 18, a: -2.3 - i * 0.2, s: 0.006 + i * 0.0014 });
    group.add(b);
  }
  return { group, boats };
}

export class LobbyView {
  constructor({ floorCount = 40, onHover, onPick } = {}) {
    Object.assign(this, { floorCount, onHover, onPick });
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.5, 1200);
    this.scene.add(new THREE.HemisphereLight('#fff0e0', '#6a5a78', 2.5));
    const sun = new THREE.DirectionalLight('#ffb98a', 2.4); sun.position.copy(SUN).multiplyScalar(100).setY(38); this.scene.add(sun);
    this.sky = makeSky(); this.scene.add(this.sky);
    this.water = makeWater(); this.scene.add(this.water);
    this.land = makeLand(); this.scene.add(this.land);
    const city = makeCity(); this.city = city.city; this.scene.add(city.group);
    this.traffic = makeTraffic(); this.scene.add(this.traffic);
    this.tower = makeTower(floorCount); this.scene.add(this.tower.group);
    this.boats = makeBoats(); this.scene.add(this.boats.group);
    this.startTheta = 0.72; this.theta = 0.72; this.targetTheta = 0.72; this.rideY = 26; this.targetRide = 26;
    this.dist = 94; this.targetDist = 94; this.time = 0; this.spin = 0.018; this.hover = -1; this.flying = null; this.shiftX = 0;
    this.ray = new THREE.Raycaster(); this.ptr = new THREE.Vector2();
    this.floorData = new Map();
    this.bind();
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
  enter() { this.active = true; this.flying = null; this.camera.clearViewOffset(); }
  leave() { this.active = false; this.setHover(-1); }
  resize(w, h) {
    this.w = w; this.h = h;
    this.camera.aspect = w / h;
    const phone = w <= 760;
    // Frame the tower in the clear area: left of the desktop panel, above the phone's sheet.
    this.shiftX = phone ? 0 : -w * 0.055;
    this.shiftY = phone ? h * 0.07 : 0;
    this.targetDist = phone ? 128 : 94;
    this.camera.setViewOffset(w, h, this.shiftX, this.shiftY, w, h);
    this.camera.updateProjectionMatrix();
  }
  setFloors(cards) {
    this.floorData = new Map(cards.map((c) => [c.number, c]));
    const col = new THREE.Color(); const f = this.tower.floors; const st = this.tower.state;
    for (let i = 0; i < this.floorCount; i++) {
      const c = this.floorData.get(i + 1);
      col.set(c ? c.colors.primary : '#7b86a0');
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
    for (const u of [this.sky, this.water, this.traffic, this.city]) u.material.uniforms.uTime.value = this.time;
    this.tower.floors.material.uniforms.uTime.value = this.time;
    this.tower.beacon.visible = this.tower.glow.visible = (this.time % 2.4) < 1.3;
    for (const b of this.boats.boats) {
      b.a += b.s * dt; const x = Math.cos(b.a) * b.r, z = Math.sin(b.a) * b.r;
      b.mesh.position.set(x, -0.45, z); b.mesh.rotation.y = -b.a;
    }
    if (this.flying) {
      const f = this.flying; f.t = Math.min(1, f.t + dt / 1.05);
      const e = f.t * f.t * (3 - 2 * f.t);
      const dir = new THREE.Vector3(Math.sin(this.theta), 0, Math.cos(this.theta));
      const to = dir.clone().multiplyScalar(TOWER_W / 2 + 1.6).setY(f.y);
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
    const camY = lookY + 17 + (this.floorCount - lookY) * 0.1;
    this.camera.position.set(Math.sin(this.theta) * this.dist, camY, Math.cos(this.theta) * this.dist);
    this.camera.lookAt(0, lookY, 0);
  }
}
