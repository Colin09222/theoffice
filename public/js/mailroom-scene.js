// The basement mailroom (round 2, r2-j50; docs/redesign/OFFICE-ANSWERS-2.md, section 3 "Home and desk"): a room under the lobby with brick walls,
// one hanging lamp, a wall of pigeonholes with one slot per open floor, a plain desk (in-tray, out-tray, stamp pad, desk phone, a small sign
// stand), a brass tube mouth above the in-tray running up toward the tower, and a charging dock in the corner. buddehbot sits at the desk.
// It is a display only: it draws what /api/mailroom says and nothing else. No model, nothing sent anywhere.
import * as THREE from '../vendor/three/three.module.min.js';
import { makeRobot, COLORS } from './robot.js';
import { pigeonholes, trayView, signFor, TRAY_MAX } from './mailroom-state.js';
import { stage } from './stage.js';
import { EventPlayer, TUBE_S, STAMP_S, BUBBLE_S, stampFor, lineFor } from './mailroom-events.js';

const ROOM_W = 7, ROOM_D = 5, ROOM_H = 3.2;

function brickTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256; const x = c.getContext('2d');
  x.fillStyle = '#7a6a60'; x.fillRect(0, 0, 256, 256);
  for (let row = 0; row < 16; row++) for (let col = -1; col < 5; col++) {
    const off = row % 2 ? 32 : 0, shade = 0.85 + ((row * 7 + col * 13) % 5) * 0.05;
    x.fillStyle = `rgb(${Math.round(150 * shade)},${Math.round(72 * shade)},${Math.round(56 * shade)})`;
    x.fillRect(col * 64 + off + 2, row * 16 + 2, 60, 12);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 1.6); return t;
}
function textSign(text, w = 256, h = 96) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const draw = (s) => {
    x.fillStyle = '#F6F1E7'; x.fillRect(0, 0, w, h); x.strokeStyle = COLORS.ink; x.lineWidth = 6; x.strokeRect(3, 3, w - 6, h - 6);
    x.fillStyle = COLORS.ink; x.font = `600 ${Math.round(h * 0.34)}px "DM Sans", sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(s, w / 2, h / 2 + 2);
    t.needsUpdate = true;
  };
  draw(text);
  return { texture: t, draw };
}

export class MailroomView {
  constructor() {
    this.post = false;  // a small room: no post chain
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color('#1b1a1f');
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 60);
    this.time = 0; this.pageAt = 25; this.items = []; this.state = 'free';
    const s = this.scene;
    this.hemi = new THREE.HemisphereLight('#f3e3cf', '#4a3a33', 0.55); s.add(this.hemi);
    // Brick walls (back and two sides) and a worn concrete floor.
    const brick = new THREE.MeshStandardMaterial({ map: brickTexture(), roughness: 0.95 });
    const wall = (w, x, z, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, ROOM_H), brick); m.position.set(x, ROOM_H / 2, z); m.rotation.y = ry; m.receiveShadow = true; s.add(m); };
    wall(ROOM_W, 0, -ROOM_D / 2, 0); wall(ROOM_D, -ROOM_W / 2, 0, Math.PI / 2); wall(ROOM_D, ROOM_W / 2, 0, -Math.PI / 2);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_D), new THREE.MeshStandardMaterial({ color: '#8d8a84', roughness: 1 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; s.add(floor);
    // One hanging lamp: a cord, a green enamel shade, a bulb, and its light.
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.9, 4), new THREE.MeshBasicMaterial({ color: '#111' })); cord.position.set(0, ROOM_H - 0.45, 0.2); s.add(cord);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.22, 16, 1, true), new THREE.MeshStandardMaterial({ color: '#2f5b45', side: THREE.DoubleSide, roughness: 0.5 })); shade.position.set(0, ROOM_H - 1.0, 0.2); s.add(shade);
    this.bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffe2a8' })); this.bulb.position.set(0, ROOM_H - 1.08, 0.2); s.add(this.bulb);
    this.lamp = new THREE.PointLight('#ffd9a0', 9, 9, 1.6); this.lamp.position.copy(this.bulb.position); this.lamp.castShadow = true; this.lamp.shadow.mapSize.set(512, 512); s.add(this.lamp);
    // The desk, its trays, the stamp pad, the phone and the sign stand.
    const wood = new THREE.MeshStandardMaterial({ color: '#7b5a3c', roughness: 0.8 }), dark = new THREE.MeshStandardMaterial({ color: COLORS.ink, roughness: 0.6 });
    const box = (mat, w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; s.add(m); return m; };
    box(wood, 2.4, 0.08, 1.0, 0, 0.78, -0.9);
    for (const [x, z] of [[-1.1, -1.3], [1.1, -1.3], [-1.1, -0.5], [1.1, -0.5]]) box(wood, 0.07, 0.78, 0.07, x, 0.39, z);
    const trayMat = new THREE.MeshStandardMaterial({ color: '#b9b2a6', roughness: 0.6 });
    this.inTray = box(trayMat, 0.46, 0.06, 0.34, -0.75, 0.85, -1.05);
    box(trayMat, 0.46, 0.06, 0.34, 0.75, 0.85, -1.05);  // the out-tray
    box(new THREE.MeshStandardMaterial({ color: '#3b2f4a', roughness: 0.9 }), 0.22, 0.03, 0.15, 0.3, 0.835, -0.7);  // the stamp pad
    box(dark, 0.26, 0.08, 0.18, -0.25, 0.86, -1.15); box(dark, 0.24, 0.04, 0.06, -0.25, 0.92, -1.15);  // the desk phone and its handset
    this.signText = textSign('');
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.16), new THREE.MeshBasicMaterial({ map: this.signText.texture })); sign.position.set(0.75, 1.0, -0.7); sign.rotation.x = -0.25; s.add(sign); this.sign = sign;
    // Folders in the in-tray: one per open item, up to 8 (Q18), and a "+N" tag beyond that.
    this.folders = new THREE.InstancedMesh(new THREE.BoxGeometry(0.38, 0.018, 0.28), new THREE.MeshStandardMaterial({ color: '#d9b779', roughness: 0.8 }), TRAY_MAX);
    this.folders.count = 0; s.add(this.folders);
    this.moreText = textSign('', 128, 64);
    this.more = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.1), new THREE.MeshBasicMaterial({ map: this.moreText.texture })); this.more.position.set(-0.45, 1.05, -0.88); this.more.visible = false; s.add(this.more);
    // The brass tube: its mouth above the in-tray, the pipe running up the wall toward the tower.
    const brass = new THREE.MeshStandardMaterial({ color: COLORS.brass, roughness: 0.3, metalness: 0.8 });
    const mouth = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.22, 14, 1, true), brass); mouth.position.set(-0.75, 1.45, -1.15); s.add(mouth); this.tubeMouth = mouth;
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, ROOM_H - 1.55, 12), brass); pipe.position.set(-0.75, 1.55 + (ROOM_H - 1.55) / 2, -1.2); s.add(pipe);
    // The pigeonholes: one slot per open floor, numbered.
    this.holes = new THREE.Group(); this.holes.position.set(-2.4, 1.1, -ROOM_D / 2 + 0.2); s.add(this.holes);
    // The charging dock in the corner.
    box(dark, 0.7, 0.06, 0.6, 2.7, 0.03, -1.8); box(new THREE.MeshStandardMaterial({ color: COLORS.slate }), 0.5, 0.5, 0.08, 2.7, 0.3, -2.1);
    this.dockSpot = new THREE.Vector3(2.7, 0.06, -1.75); this.deskSpot = new THREE.Vector3(1.55, 0, -0.62);
    // buddehbot, at the end of its desk, turned toward the room so its eye and name plate show.
    this.deskTurn = -0.45;
    this.robot = makeRobot(); this.robot.group.position.copy(this.deskSpot); this.robot.group.rotation.y = this.deskTurn; s.add(this.robot.group);
    // A paper it reads when there is nothing in the tray (section 3, animation 8).
    this.paper = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.22), new THREE.MeshStandardMaterial({ color: '#efe8da', side: THREE.DoubleSide })); this.paper.position.set(0, 0.84, -0.6); this.paper.rotation.x = -Math.PI / 2; s.add(this.paper);
    this.pagesTurned = 0;
    // r2-j51: folders come down the tube. One folder in flight at a time, each from a real record (the player refuses anything else).
    this.inFlight = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.22), new THREE.MeshStandardMaterial({ color: '#d9b779', roughness: 0.8 })); this.inFlight.visible = false; s.add(this.inFlight);
    this.player = new EventPlayer((ev) => this.playEvent(ev));
  }
  /** One event from a real record. Returns how long it takes, in seconds. */
  playEvent(ev) {
    if (ev.event === 'arrive') { this.drop = { t: 0, ev }; this.inFlight.visible = true; return TUBE_S; }
    // r2-j52: the stamp comes down (0.6 s), one voice line, and the folder goes up the tube.
    if (ev.event === 'close') {
      const word = stampFor(ev), line = lineFor(ev);
      this.stamping = { t: 0 };
      this.onStamp?.(word, ev); if (line) this.onSay?.(line, ev);
      return Math.max(STAMP_S + TUBE_S, line ? BUBBLE_S : 0);
    }
    if (ev.event === 'pickup') { const line = lineFor(ev); if (line) this.onSay?.(line, ev); return line ? BUBBLE_S : 0; }
    return 0;
  }
  /** What /api/mailroom says: items, the robot's state and sign, the tray and the open floors. */
  setData(d) {
    this.items = d.items || [];
    this.state = d.robot?.state || 'free';
    this.robot.setState(this.state);
    // Asleep or away: on its dock (asleep with the lamp off). Otherwise at its desk.
    const docked = this.state === 'asleep' || this.state === 'away';
    this.robot.group.position.copy(docked ? this.dockSpot : this.deskSpot);
    this.robot.group.rotation.y = docked ? -0.3 : this.deskTurn;
    const lampOn = this.state !== 'asleep';
    this.lamp.visible = lampOn; this.bulb.material.color.set(lampOn ? '#ffe2a8' : '#3a3530');
    this.signText.draw(d.robot?.sign ?? signFor(this.state));
    const tray = d.robot?.tray || trayView(this.items);
    const m = new THREE.Matrix4();
    for (let i = 0; i < tray.folders; i++) { m.makeTranslation(-0.75, 0.9 + i * 0.022, -1.05); this.folders.setMatrixAt(i, m); }
    this.folders.count = tray.folders; this.folders.instanceMatrix.needsUpdate = true;
    this.more.visible = !!tray.label; if (tray.label) this.moreText.draw(tray.label);
    this.trayCount = tray.folders; this.trayMore = tray.more;
    this.setHoles(d.floors || []);
  }
  setHoles(numbers) {
    const list = pigeonholes(numbers);
    const key = list.join(','); if (key === this.holesKey) return; this.holesKey = key;
    this.holes.clear();
    const wood = new THREE.MeshStandardMaterial({ color: '#5b4330', roughness: 0.85 });
    const cols = Math.max(1, Math.min(6, list.length));
    list.forEach((n, i) => {
      const x = (i % cols) * 0.34, y = -Math.floor(i / cols) * 0.3;
      const cell = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.28, 0.3), wood); cell.position.set(x, y, 0); this.holes.add(cell);
      const label = textSign(String(n), 64, 48); const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.08), new THREE.MeshBasicMaterial({ map: label.texture })); tag.position.set(x, y - 0.1, 0.16); this.holes.add(tag);
    });
    this.holeCount = list.length;
  }
  enter() { const r = this.renderer(); if (r) { r.shadowMap.enabled = true; r.shadowMap.autoUpdate = true; r.toneMappingExposure = 0.95; } }
  leave() { const r = this.renderer(); if (r) { r.shadowMap.autoUpdate = true; } }
  renderer() { return stage.renderer || null; }
  resize(w, h) {
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    const far = w / h < 1 ? 7.2 : 5.2;
    this.camera.position.set(0.6, 2.3, far); this.camera.lookAt(0, 1.0, -0.9);
  }
  update(dt) {
    this.time += dt;
    this.player.update(dt);
    if (this.stamping) {  // the arm brings the stamp down and up again in 0.6 s
      const st = this.stamping; st.t += dt; const k = Math.min(1, st.t / STAMP_S);
      this.robot.arm.rotation.x = -Math.sin(k * Math.PI) * 0.9;
      if (k >= 1) { this.robot.arm.rotation.x = 0; this.stamping = null; }
    }
    if (this.drop) {  // down the tube (1.5 s) and into the in-tray
      const d = this.drop; d.t += dt; const k = Math.min(1, d.t / TUBE_S);
      const top = 3.0, bottom = 0.9 + (this.trayCount || 0) * 0.022;
      this.inFlight.position.set(-0.75, top + (bottom - top) * k * k, -1.1 + 0.05 * k);
      this.inFlight.rotation.z = (1 - k) * 0.6;
      if (k >= 1) { this.inFlight.visible = false; this.drop = null; }
    }
    // Free, with the heartbeat fresh: it turns a page of its paper every 20 to 40 s (section 3, animation 8). Nothing else moves: no busywork.
    const reading = this.state === 'free';
    this.paper.visible = reading;
    if (reading) {
      this.pageAt -= dt;
      if (this.pageAt <= 0) { this.pageAt = 20 + Math.random() * 20; this.pageTurn = 0.6; this.pagesTurned++; }
      if (this.pageTurn > 0) { this.pageTurn -= dt; this.paper.rotation.z = Math.sin((this.pageTurn / 0.6) * Math.PI) * 0.6; }
    }
  }
}
