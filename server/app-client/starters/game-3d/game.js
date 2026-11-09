// {{TITLE}}: the 3D starter's demo game, on three.js and the Office game kit. A floating arena with waves, three enemy kinds, strikes that
// land where the player stands, gems, upgrades between waves and a win at wave 8. Replace the theme, the models and the rules with the design doc's; keep the shape.
import * as THREE from './_office/three.module.min.js';
import { run, input, juice, audio, addScore, gameOver, choose, playerHurt } from './kit.js';

const ARENA = 14, rand = (a, b) => a + Math.random() * (b - a);
const COLORS = { player: 0x44e2ff, chaser: 0xff5d8f, dasher: 0xffc94d, splitter: 0x9b7bff, gem: 0xfff07a };
const KINDS = { chaser: { r: 0.5, hp: 1, speed: 3.2, score: 10 }, dasher: { r: 0.6, hp: 2, speed: 2.2, score: 25 }, splitter: { r: 0.85, hp: 3, speed: 1.7, score: 30 } };
const UPGRADES = [
  { label: 'Rapid fire', apply: (p) => { p.fireEvery *= 0.7; } }, { label: 'Twin shot', apply: (p) => { p.shots++; } },
  { label: 'Swift', apply: (p) => { p.speed *= 1.2; } }, { label: 'Patch up', apply: (p) => { p.hp = Math.min(p.maxHp, p.hp + 1); } },
  { label: 'Magnet', apply: (p) => { p.magnet *= 1.6; } }, { label: 'Big heart', apply: (p) => { p.maxHp++; p.hp++; } },
];
// Strikes keep the pressure on from the start: a ring marks where the player stands, and a strike lands there a moment later. Moving at
// all dodges it, and it clears enemies it catches. A player who does nothing is hurt at about 12 s and out at about 22 s; the Tester's
// playtest times exactly that, so re-time it whenever these numbers or the enemies change.
const STRIKE = { first: 11, warn: 1.1, r: 1.7, every: (wave) => Math.max(2.4, 5.5 - wave * 0.3), color: 0xff8a5c };

let renderer, scene, camera, world = null, sparks;
const mats = {}, geo = {};

function setup() {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight); renderer.shadowMap.enabled = true;
  document.getElementById('game').append(renderer.domElement);
  scene = new THREE.Scene(); scene.background = new THREE.Color(0x1a1438); scene.fog = new THREE.Fog(0x1a1438, 22, 48);
  camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 100);
  scene.add(new THREE.HemisphereLight(0xb8c7ff, 0x2a1a40, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(6, 14, 4); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16 }); scene.add(sun);
  // The arena: a floating disc with an edge you can see, and rocks drifting below.
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(ARENA, ARENA * 0.8, 1.2, 48), new THREE.MeshStandardMaterial({ color: 0x3b2f6e, roughness: 0.85 }));
  floor.position.y = -0.6; floor.receiveShadow = true; scene.add(floor);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(ARENA, 0.12, 8, 64), new THREE.MeshBasicMaterial({ color: 0xff5d8f })); rim.rotation.x = Math.PI / 2; scene.add(rim);
  for (let i = 0; i < 18; i++) { const r = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(0.4, 1.4)), new THREE.MeshStandardMaterial({ color: 0x2a2150, flatShading: true })); const a = rand(0, Math.PI * 2), d = rand(ARENA + 3, ARENA + 12); r.position.set(Math.cos(a) * d, rand(-8, -2), Math.sin(a) * d); scene.add(r); }
  for (const [k, c] of Object.entries(COLORS)) mats[k] = new THREE.MeshStandardMaterial({ color: c, roughness: 0.4, emissive: c, emissiveIntensity: 0.15 });
  mats.shot = new THREE.MeshBasicMaterial({ color: 0xffffff }); mats.flash = new THREE.MeshBasicMaterial({ color: 0xffffff });
  geo.player = new THREE.CapsuleGeometry(0.45, 0.6, 4, 12); geo.ball = new THREE.SphereGeometry(1, 20, 14); geo.cone = new THREE.ConeGeometry(0.7, 1.4, 12); geo.shot = new THREE.SphereGeometry(0.14, 8, 6); geo.gem = new THREE.OctahedronGeometry(0.25);
  geo.ring = new THREE.RingGeometry(0.9, 1, 48); geo.disc = new THREE.CircleGeometry(1, 40);
  mats.ring = new THREE.MeshBasicMaterial({ color: STRIKE.color, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthWrite: false }); mats.disc = new THREE.MeshBasicMaterial({ color: STRIKE.color, side: THREE.DoubleSide, transparent: true, opacity: 0.35, depthWrite: false });
  // Particles: one pooled cloud of points, so a burst costs nothing to make.
  const N = 600, pos = new Float32Array(N * 3).fill(-999), col = new Float32Array(N * 3);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  sparks = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.22, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  sparks.frustumCulled = false; sparks.userData = { vel: new Float32Array(N * 3), life: new Float32Array(N), next: 0, N }; scene.add(sparks);
  addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
}
function burst(p, color, n = 24) {
  const u = sparks.userData, pos = sparks.geometry.attributes.position.array, col = sparks.geometry.attributes.color.array, c = new THREE.Color(color);
  for (let i = 0; i < n; i++) { const k = u.next = (u.next + 1) % u.N; pos.set([p.x, (p.y || 0) + 0.5, p.z], k * 3); col.set([c.r, c.g, c.b], k * 3); u.vel.set([rand(-6, 6), rand(1, 7), rand(-6, 6)], k * 3); u.life[k] = rand(0.3, 0.7); }
  sparks.geometry.attributes.color.needsUpdate = true;
}
function stepSparks(dt) {
  const u = sparks.userData, pos = sparks.geometry.attributes.position.array;
  for (let k = 0; k < u.N; k++) { if (u.life[k] <= 0) continue; u.life[k] -= dt; u.vel[k * 3 + 1] -= 14 * dt; for (let a = 0; a < 3; a++) pos[k * 3 + a] += u.vel[k * 3 + a] * dt; if (u.life[k] <= 0) pos[k * 3 + 1] = -999; }
  sparks.geometry.attributes.position.needsUpdate = true;
}
const mesh = (g, m, s = 1) => { const x = new THREE.Mesh(g, m); x.scale.setScalar(s); x.castShadow = true; scene.add(x); return x; };
const drop = (o) => { scene.remove(o.mesh); };
function spawn(kind, x, z, r) {
  const k = KINDS[kind], e = { kind, x, z, r: r || k.r, hp: k.hp + Math.floor(world.wave / 4), t: rand(0, 1), state: 'move', vx: 0, vz: 0 };
  e.mesh = mesh(kind === 'dasher' ? geo.cone : geo.ball, mats[kind], e.r); e.mesh.scale.setScalar(0.01);
  juice.tween(e.mesh.scale, { x: e.r, y: e.r, z: e.r }, 300);
  world.enemies.push(e);
}
function startWave() { world.wave++; world.queue = []; for (let i = 0; i < 4 + world.wave * 2; i++) world.queue.push(world.wave >= 3 && i % 4 === 3 ? 'splitter' : world.wave >= 2 && i % 3 === 2 ? 'dasher' : 'chaser'); world.spawnIn = 0.5; audio.sfx('power'); }
function hurt() { const p = world.player; if (p.inv > 0) return; p.hp--; p.inv = 1.2; playerHurt(); audio.sfx('hurt'); juice.shake(0.7); juice.hitStop(90); burst(p, COLORS.player, 40); if (p.hp <= 0) end(false); }
function kill(e, i) {
  world.enemies.splice(i, 1); drop(e); addScore(KINDS[e.kind].score); burst(e, COLORS[e.kind], 30); audio.sfx('explode'); juice.shake(0.25); juice.hitStop(35);
  for (let n = 0; n < (e.kind === 'splitter' ? 3 : 1); n++) { const g = { x: e.x + rand(-0.4, 0.4), z: e.z + rand(-0.4, 0.4) }; g.mesh = mesh(geo.gem, mats.gem); world.gems.push(g); }
  if (e.kind === 'splitter' && e.r > 0.6) for (let n = 0; n < 2; n++) spawn('chaser', e.x + rand(-0.5, 0.5), e.z + rand(-0.5, 0.5), 0.4);
}
function mark(x, z) {
  const m = { x, z, t: STRIKE.warn, mesh: new THREE.Group() }, ring = new THREE.Mesh(geo.ring, mats.ring); m.fill = new THREE.Mesh(geo.disc, mats.disc);
  ring.scale.setScalar(STRIKE.r); m.fill.scale.setScalar(0.01); m.mesh.add(ring, m.fill); m.mesh.rotation.x = -Math.PI / 2; m.mesh.position.set(x, 0.04, z); scene.add(m.mesh);
  world.marks.push(m);
}
function clear(w) { for (const o of [...w.enemies, ...w.shots, ...w.gems, ...w.marks]) drop(o); drop(w.player); }
async function end(won) { const w = world; world = null; clear(w); await gameOver({ won, stats: { Wave: w.wave } }); }

run({
  title: '{{TITLE}}',
  pitch: 'Hold the floating arena for eight waves. Dash through danger, grab gems, pick upgrades.',
  howTo: 'Move to dodge; you fire at the nearest enemy on your own. A (Space) dashes. A ring on the floor means a strike is about to land there: step out of it, or lead it onto enemies. Upgrades come between waves.',
  boot(progress) { setup(); progress(1); },
  start() {
    if (world) { clear(world); world = null; }
    const p = { x: 0, z: 0, r: 0.5, hp: 3, maxHp: 3, speed: 6, fireEvery: 0.3, fireT: 0, shots: 1, magnet: 2.5, inv: 0, dashT: 0, dashCd: 0 };
    p.mesh = mesh(geo.player, mats.player); world = { wave: 0, queue: [], spawnIn: 0, strikeIn: STRIKE.first, marks: [], enemies: [], shots: [], gems: [], picking: false, player: p };
    startWave();
  },
  quit() { if (world) { clear(world); world = null; } },
  update(dt) {
    const w = world; if (!w || w.picking) return;
    const p = w.player, a = input.axis();
    p.dashCd -= dt; p.dashT -= dt; p.inv -= dt; p.fireT -= dt;
    if (input.pressed('action') && p.dashCd <= 0) { p.dashT = 0.16; p.dashCd = 0.7; p.inv = Math.max(p.inv, 0.25); audio.sfx('dash'); burst(p, COLORS.player, 10); }
    const sp = p.speed * (p.dashT > 0 ? 3 : 1); p.x += a.x * sp * dt; p.z += a.y * sp * dt;
    const d = Math.hypot(p.x, p.z); if (d > ARENA - 0.6) { p.x *= (ARENA - 0.6) / d; p.z *= (ARENA - 0.6) / d; }
    const target = w.enemies.reduce((b, e) => (!b || (e.x - p.x) ** 2 + (e.z - p.z) ** 2 < (b.x - p.x) ** 2 + (b.z - p.z) ** 2 ? e : b), null);
    if (target && p.fireT <= 0) {
      p.fireT = p.fireEvery; const ang = Math.atan2(target.z - p.z, target.x - p.x);
      for (let s = 0; s < p.shots; s++) { const o = (s - (p.shots - 1) / 2) * 0.15, b = { x: p.x, z: p.z, vx: Math.cos(ang + o) * 16, vz: Math.sin(ang + o) * 16, life: 1 }; b.mesh = mesh(geo.shot, mats.shot); w.shots.push(b); }
      audio.sfx('shoot');
    }
    w.spawnIn -= dt;
    if (w.queue.length && w.spawnIn <= 0) { const ang = rand(0, Math.PI * 2); spawn(w.queue.shift(), Math.cos(ang) * (ARENA - 1), Math.sin(ang) * (ARENA - 1)); w.spawnIn = Math.max(0.3, 1 - w.wave * 0.08); }
    // Strikes: mark the spot, then land on it. Enemies caught in one go too, so a quick player can lead a strike onto them.
    w.strikeIn -= dt;
    if (w.strikeIn <= 0) { mark(p.x, p.z); w.strikeIn = STRIKE.every(w.wave); audio.sfx('select'); }
    for (let i = w.marks.length - 1; i >= 0; i--) {
      const m = w.marks[i]; m.t -= dt; if (m.t > 0) continue;
      w.marks.splice(i, 1); drop(m); burst(m, STRIKE.color, 50); audio.sfx('explode'); juice.shake(0.35);
      for (let j = w.enemies.length - 1; j >= 0; j--) { const e = w.enemies[j]; if ((e.x - m.x) ** 2 + (e.z - m.z) ** 2 < (STRIKE.r + e.r) ** 2) kill(e, j); }
      if ((p.x - m.x) ** 2 + (p.z - m.z) ** 2 < (STRIKE.r + p.r * 0.5) ** 2) { hurt(); if (!world) return; }
    }
    for (const e of w.enemies) {
      const k = KINDS[e.kind], ang = Math.atan2(p.z - e.z, p.x - e.x); e.t += dt;
      if (e.kind === 'dasher') {
        if (e.state === 'move' && e.t > 2) { e.state = 'aim'; e.t = 0; e.aim = ang; } else if (e.state === 'aim' && e.t > 0.6) { e.state = 'dash'; e.t = 0; e.vx = Math.cos(e.aim) * 14; e.vz = Math.sin(e.aim) * 14; } else if (e.state === 'dash' && e.t > 0.4) { e.state = 'move'; e.t = 0; }
        if (e.state === 'move') { e.vx = Math.cos(ang) * k.speed; e.vz = Math.sin(ang) * k.speed; } else if (e.state === 'aim') { e.vx = e.vz = 0; }
      } else { e.vx = Math.cos(ang) * k.speed * (1 + w.wave * 0.05); e.vz = Math.sin(ang) * k.speed * (1 + w.wave * 0.05); }
      e.x += e.vx * dt; e.z += e.vz * dt;
      if ((e.x - p.x) ** 2 + (e.z - p.z) ** 2 < (e.r + p.r - 0.1) ** 2) { hurt(); if (!world) return; }
    }
    for (let i = w.shots.length - 1; i >= 0; i--) {
      const b = w.shots[i]; b.x += b.vx * dt; b.z += b.vz * dt; b.life -= dt; let gone = b.life <= 0;
      for (let j = w.enemies.length - 1; j >= 0 && !gone; j--) { const e = w.enemies[j]; if ((b.x - e.x) ** 2 + (b.z - e.z) ** 2 < (e.r + 0.15) ** 2) { gone = true; e.hp--; e.flash = 0.06; audio.sfx('hit'); burst(b, 0xffffff, 6); if (e.hp <= 0) kill(e, j); } }
      if (gone) { drop(b); w.shots.splice(i, 1); }
    }
    for (let i = w.gems.length - 1; i >= 0; i--) {
      const g = w.gems[i], d2 = (g.x - p.x) ** 2 + (g.z - p.z) ** 2;
      if (d2 < p.magnet ** 2) { const ang = Math.atan2(p.z - g.z, p.x - g.x); g.x += Math.cos(ang) * 10 * dt; g.z += Math.sin(ang) * 10 * dt; }
      if (d2 < 0.5) { drop(g); w.gems.splice(i, 1); addScore(2); audio.sfx('pickup'); }
    }
    if (!w.queue.length && !w.enemies.length) {
      if (w.wave >= 8) { end(true); return; }
      w.picking = true; const picks = [...UPGRADES].sort(() => Math.random() - 0.5).slice(0, 3);
      choose(`Wave ${w.wave} cleared. Pick one`, picks.map((u) => ({ label: u.label }))).then((i) => { if (world !== w) return; picks[i].apply(w.player); w.picking = false; startWave(); });
    }
  },
  render(dt) {
    if (!renderer) return;
    stepSparks(dt);
    const w = world, t = performance.now() / 1000;
    if (w) {
      const p = w.player; p.mesh.position.set(p.x, 0.75, p.z); p.mesh.visible = !(p.inv > 0 && Math.floor(p.inv * 20) % 2);
      for (const e of w.enemies) { e.mesh.position.set(e.x, e.r, e.z); e.mesh.material = e.flash > 0 ? mats.flash : mats[e.kind]; e.flash -= dt; if (e.kind === 'dasher') { e.mesh.rotation.z = e.state === 'aim' ? Math.sin(t * 40) * 0.2 : 0; } }
      for (const m of w.marks) m.fill.scale.setScalar(Math.max(0.01, STRIKE.r * (1 - Math.max(0, m.t) / STRIKE.warn)));
      for (const b of w.shots) b.mesh.position.set(b.x, 0.6, b.z);
      for (const g of w.gems) { g.mesh.position.set(g.x, 0.4 + Math.sin(t * 4 + g.x) * 0.1, g.z); g.mesh.rotation.y = t * 3; }
    }
    const fx = w ? w.player.x * 0.5 : Math.sin(t * 0.2) * 4, fz = w ? w.player.z * 0.5 : Math.cos(t * 0.2) * 4;
    camera.position.set(fx + juice.offset.x * 0.05, 17, fz + 12 + juice.offset.y * 0.05); camera.lookAt(fx, 0, fz);
    renderer.render(scene, camera);
  },
  state() { const w = world; return w ? { wave: w.wave, level: w.wave, lives: w.player.hp, enemies: w.enemies.length, player: { x: Math.round(w.player.x * 10) / 10, y: Math.round(w.player.z * 10) / 10 } } : {}; },
});
