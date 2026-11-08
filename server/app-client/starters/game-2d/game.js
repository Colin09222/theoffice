// {{TITLE}}: the 2D starter's demo game, on Phaser 3 and the Office game kit. An arena with waves, three enemy kinds, upgrades between
// waves and a win at wave 10. Replace the theme, the art and the rules with the design doc's; keep the shape: boot, start, update, render, state.
import { run, input, juice, audio, addScore, gameOver, choose, settings } from './kit.js';

const W = () => innerWidth, H = () => innerHeight;
const rand = (a, b) => a + Math.random() * (b - a);
const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const PALETTE = { player: 0x44e2ff, chaser: 0xff5d8f, dasher: 0xffc94d, splitter: 0x9b7bff, shooter: 0x7dffa8, gem: 0xfff07a, shot: 0xffffff, enemyShot: 0xff8a5c };
const UPGRADES = [
  { id: 'rate', label: 'Rapid fire', text: 'Shoot 30% faster', apply: (p) => { p.fireEvery *= 0.7; } },
  { id: 'twin', label: 'Twin shot', text: 'One more bullet each shot', apply: (p) => { p.shots += 1; } },
  { id: 'swift', label: 'Swift', text: 'Move 20% faster', apply: (p) => { p.speed *= 1.2; } },
  { id: 'magnet', label: 'Magnet', text: 'Gems fly to you from further', apply: (p) => { p.magnet *= 1.6; } },
  { id: 'heal', label: 'Patch up', text: 'Get a heart back', apply: (p) => { p.hp = Math.min(p.maxHp, p.hp + 1); } },
  { id: 'heart', label: 'Big heart', text: 'One more heart, and heal it', apply: (p) => { p.maxHp += 1; p.hp += 1; } },
  { id: 'pierce', label: 'Pierce', text: 'Bullets go through one more enemy', apply: (p) => { p.pierce += 1; } },
];
// Three kinds of enemy that each ask something different of the player, and a fourth from wave 4.
const KINDS = {
  chaser: { r: 13, hp: 1, speed: 95, score: 10 },
  dasher: { r: 15, hp: 2, speed: 60, score: 25 },
  splitter: { r: 20, hp: 3, speed: 50, score: 30 },
  shooter: { r: 14, hp: 2, speed: 70, score: 35 },
};

let scene, gfx, emitter, hud, trail, stars = [], world = null;

class Arena extends Phaser.Scene {
  constructor() { super('arena'); }
  create() {
    scene = this;
    // Every sprite is drawn here in code, with a soft glow, a shape of its own and eyes, so the game has character before any art exists.
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    const sprite = (key, color, r, body, eyes = true) => {
      const pad = Math.ceil(r * 0.7), c = r + pad; g.clear();
      for (let i = 4; i >= 1; i--) { g.fillStyle(color, 0.06 * (5 - i)); g.fillCircle(c, c, r + pad * (i / 4)); }
      g.fillStyle(color, 1); body(c, r); g.fillStyle(0xffffff, 0.35); g.fillCircle(c - r * 0.35, c - r * 0.4, r * 0.28);
      if (eyes) { for (const s of [-1, 1]) { g.fillStyle(0xffffff, 1); g.fillCircle(c + s * r * 0.34, c - r * 0.05, r * 0.26); g.fillStyle(0x120e24, 1); g.fillCircle(c + s * r * 0.34 + r * 0.06, c, r * 0.13); } }
      g.generateTexture(key, c * 2, c * 2);
    };
    const circle = (c, r) => g.fillCircle(c, c, r);
    sprite('player', PALETTE.player, 14, (c, r) => { circle(c, r); g.lineStyle(3, 0xffffff, 0.95); g.strokeCircle(c, c, r - 1.5); });
    sprite('chaser', PALETTE.chaser, 13, (c, r) => { circle(c, r); g.fillTriangle(c - r, c - r * 0.2, c - r * 0.55, c - r * 1.15, c - r * 0.15, c - r * 0.7); g.fillTriangle(c + r, c - r * 0.2, c + r * 0.55, c - r * 1.15, c + r * 0.15, c - r * 0.7); });
    sprite('dasher', PALETTE.dasher, 15, (c, r) => g.fillPoints([{ x: c, y: c - r * 1.15 }, { x: c + r, y: c }, { x: c, y: c + r * 1.15 }, { x: c - r, y: c }], true));
    sprite('splitter', PALETTE.splitter, 20, (c, r) => { circle(c, r); g.fillStyle(0xd6c8ff, 0.55); g.fillCircle(c + r * 0.3, c + r * 0.35, r * 0.32); g.fillCircle(c - r * 0.4, c + r * 0.45, r * 0.2); });
    sprite('shooter', PALETTE.shooter, 14, (c, r) => { g.fillRoundedRect(c - r, c - r, r * 2, r * 2, r * 0.45); g.lineStyle(3, 0x120e24, 0.5); g.strokeCircle(c, c + r * 0.45, r * 0.3); });
    sprite('gem', PALETTE.gem, 6, (c, r) => g.fillPoints([{ x: c, y: c - r * 1.3 }, { x: c + r, y: c }, { x: c, y: c + r * 1.3 }, { x: c - r, y: c }], true), false);
    sprite('shot', PALETTE.shot, 4, circle, false); sprite('eshot', PALETTE.enemyShot, 5, circle, false); sprite('spark', 0xffffff, 4, circle, false);
    // A night sky: a soft gradient and stars that twinkle.
    const sky = this.textures.createCanvas('sky', 512, 512), ctx = sky.getContext(), grd = ctx.createRadialGradient(256, 230, 30, 256, 256, 380);
    grd.addColorStop(0, '#2c2063'); grd.addColorStop(0.6, '#160f36'); grd.addColorStop(1, '#08061a'); ctx.fillStyle = grd; ctx.fillRect(0, 0, 512, 512); sky.refresh();
    this.sky = this.add.image(0, 0, 'sky').setOrigin(0).setDepth(-10);
    stars = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 1.6 + 0.4, p: Math.random() * 6 }));
    gfx = this.add.graphics();
    emitter = this.add.particles(0, 0, 'spark', { speed: { min: 60, max: 260 }, lifespan: { min: 250, max: 600 }, scale: { start: 1, end: 0 }, alpha: { start: 1, end: 0 }, emitting: false, blendMode: 'ADD' });
    hud = this.add.text(12, 10, '', { fontFamily: 'Trebuchet MS, system-ui', fontSize: '20px', color: '#f4f1ff', stroke: '#120e24', strokeThickness: 5 }).setDepth(10).setScrollFactor(0);
    this.scale.on('resize', () => { if (world) { world.player.x = Math.min(world.player.x, W() - 20); world.player.y = Math.min(world.player.y, H() - 20); } });
  }
}

function burst(x, y, color, n = 14) { emitter.setParticleTint(color); emitter.explode(n, x, y); }
function sprite(key, x, y) { return scene.add.image(x, y, key); }
function spawn(kind, x, y) {
  const k = KINDS[kind], e = { kind, x, y, vx: 0, vy: 0, r: k.r, hp: k.hp + Math.floor(world.wave / 5), t: rand(0, 1), state: 'move', img: sprite(kind, x, y) };
  e.img.setScale(0); scene.tweens.add({ targets: e.img, scale: 1, duration: 260, ease: 'Back.Out' });
  world.enemies.push(e);
}
function edgePoint() { const s = Math.floor(rand(0, 4)), m = 30; return s === 0 ? { x: rand(0, W()), y: -m } : s === 1 ? { x: W() + m, y: rand(0, H()) } : s === 2 ? { x: rand(0, W()), y: H() + m } : { x: -m, y: rand(0, H()) }; }
function waveMix(n) {
  const list = [], count = 4 + n * 2;
  for (let i = 0; i < count; i++) list.push(n >= 4 && i % 5 === 4 ? 'shooter' : n >= 3 && i % 4 === 3 ? 'splitter' : n >= 2 && i % 3 === 2 ? 'dasher' : 'chaser');
  return list;
}
function startWave() {
  world.wave++; world.queue = waveMix(world.wave); world.spawnIn = 0.4;
  world.banner = { text: world.wave === 10 ? 'Final wave' : `Wave ${world.wave}`, t: 1.6 };
  audio.sfx('power');
}

function hurtPlayer() {
  const p = world.player; if (p.inv > 0) return;
  p.hp--; p.inv = 1.2; audio.sfx('hurt'); juice.shake(0.6); juice.hitStop(90); burst(p.x, p.y, PALETTE.player, 22);
  scene.cameras.main.flash(120, 255, 80, 120);
  if (p.hp <= 0) end(false);
}
function kill(e, i) {
  world.enemies.splice(i, 1); e.img.destroy(); addScore(KINDS[e.kind].score * (1 + Math.floor(world.combo / 5)));
  world.combo++; world.comboT = 2; burst(e.x, e.y, PALETTE[e.kind], 18); audio.sfx('explode'); juice.shake(0.22); juice.hitStop(35);
  const gems = e.kind === 'splitter' ? 3 : 1 + (Math.random() < 0.3 ? 1 : 0);
  for (let n = 0; n < gems; n++) world.gems.push({ x: e.x + rand(-10, 10), y: e.y + rand(-10, 10), img: sprite('gem', e.x, e.y) });
  if (e.kind === 'splitter' && e.r > 12) for (let n = 0; n < 2; n++) { spawn('chaser', e.x + rand(-12, 12), e.y + rand(-12, 12)); world.enemies[world.enemies.length - 1].r = 10; world.enemies[world.enemies.length - 1].img.setScale(0.75); }
}
async function end(won) {
  const w = world; world = null; trail?.destroy(); trail = null;
  for (const e of w.enemies) e.img.destroy(); for (const b of [...w.shots, ...w.eshots, ...w.gems]) b.img.destroy(); w.player.img.destroy();
  gfx.clear(); hud.setText('');
  await gameOver({ won, stats: { Wave: w.wave, Gems: w.gemsGot } });
}

const game = {
  title: '{{TITLE}}',
  pitch: 'Survive ten waves in the arena. Grab gems, pick upgrades, keep the combo going.',
  howTo: 'Move to dodge. You shoot the nearest enemy on your own. A (Space) dashes through danger; B (Shift) fires a pulse that clears the space round you once your gem meter is full. Upgrades come between waves.',
  boot(progress) {
    return new Promise((resolve) => {
      new Phaser.Game({ type: Phaser.AUTO, parent: 'game', backgroundColor: '#120e24', scale: { mode: Phaser.Scale.RESIZE, width: W(), height: H() }, scene: [Arena], audio: { noAudio: true }, banner: false,
        callbacks: { postBoot: () => { progress(1); resolve(); } } });
    });
  },
  start() {
    if (world) this.quit();
    world = { wave: 0, queue: [], spawnIn: 0, enemies: [], shots: [], eshots: [], gems: [], gemsGot: 0, meter: 0, combo: 0, comboT: 0, banner: null, picking: false,
      player: { x: W() / 2, y: H() / 2, r: 14, hp: 3, maxHp: 3, speed: 230, fireEvery: 0.32, fireT: 0, shots: 1, pierce: 0, magnet: 90, inv: 0, dashT: 0, dashCd: 0, img: sprite('player', W() / 2, H() / 2) } };
    trail?.destroy(); trail = scene.add.particles(0, 0, 'spark', { follow: world.player.img, frequency: 35, lifespan: 320, speed: 0, scale: { start: 0.9, end: 0 }, alpha: { start: 0.45, end: 0 }, tint: PALETTE.player, blendMode: 'ADD' }).setDepth(-1);
    startWave();
  },
  quit() {
    trail?.destroy(); trail = null; if (world) { const w = world; world = null; for (const e of w.enemies) e.img.destroy(); for (const b of [...w.shots, ...w.eshots, ...w.gems]) b.img.destroy(); w.player.img.destroy(); gfx.clear(); hud.setText(''); } },
  update(dt) {
    const w = world; if (!w || w.picking) return;
    const p = w.player, a = input.axis();
    // Dash: a burst of speed with a moment of safety.
    p.dashCd -= dt; p.dashT -= dt; p.inv -= dt;
    if (input.pressed('action') && p.dashCd <= 0) { p.dashT = 0.16; p.dashCd = 0.7; p.inv = Math.max(p.inv, 0.25); audio.sfx('dash'); burst(p.x, p.y, PALETTE.player, 8); }
    const sp = p.speed * (p.dashT > 0 ? 3.2 : 1);
    p.x = Phaser.Math.Clamp(p.x + a.x * sp * dt, p.r, W() - p.r); p.y = Phaser.Math.Clamp(p.y + a.y * sp * dt, p.r + 30, H() - p.r);
    // Pulse: the gem meter's payoff.
    if (input.pressed('alt') && w.meter >= 1) { w.meter = 0; audio.sfx('explode'); juice.shake(0.7); juice.hitStop(80); burst(p.x, p.y, 0xffffff, 40); for (let i = w.enemies.length - 1; i >= 0; i--) if (dist2(w.enemies[i], p) < 160 ** 2) kill(w.enemies[i], i); }
    // Auto-fire at the nearest enemy.
    p.fireT -= dt;
    const target = w.enemies.reduce((best, e) => (!best || dist2(e, p) < dist2(best, p) ? e : best), null);
    if (target && p.fireT <= 0) {
      p.fireT = p.fireEvery; const ang = Math.atan2(target.y - p.y, target.x - p.x);
      for (let s = 0; s < p.shots; s++) { const o = (s - (p.shots - 1) / 2) * 0.16; w.shots.push({ x: p.x, y: p.y, vx: Math.cos(ang + o) * 520, vy: Math.sin(ang + o) * 520, life: 1.2, pierce: p.pierce, img: sprite('shot', p.x, p.y) }); }
      audio.sfx('shoot');
    }
    // Spawning.
    w.spawnIn -= dt;
    if (w.queue.length && w.spawnIn <= 0) { const at = edgePoint(); spawn(w.queue.shift(), at.x, at.y); w.spawnIn = Math.max(0.25, 0.9 - w.wave * 0.06); }
    // Enemies: each kind moves its own way.
    for (const e of w.enemies) {
      const k = KINDS[e.kind], ang = Math.atan2(p.y - e.y, p.x - e.x); e.t += dt;
      if (e.kind === 'dasher') {
        if (e.state === 'move' && e.t > 2.2) { e.state = 'aim'; e.t = 0; e.aim = ang; }
        else if (e.state === 'aim' && e.t > 0.6) { e.state = 'dash'; e.t = 0; e.vx = Math.cos(e.aim) * 520; e.vy = Math.sin(e.aim) * 520; audio.sfx('dash'); }
        else if (e.state === 'dash' && e.t > 0.45) { e.state = 'move'; e.t = 0; }
        if (e.state === 'move') { e.vx = Math.cos(ang) * k.speed; e.vy = Math.sin(ang) * k.speed; } else if (e.state === 'aim') { e.vx *= 0.9; e.vy *= 0.9; }
      } else if (e.kind === 'shooter') {
        const d = Math.sqrt(dist2(e, p)), away = d < 220 ? -1 : d > 300 ? 1 : 0;
        e.vx = Math.cos(ang) * k.speed * away + Math.cos(ang + Math.PI / 2) * 40; e.vy = Math.sin(ang) * k.speed * away + Math.sin(ang + Math.PI / 2) * 40;
        if (e.t > 1.8) { e.t = 0; w.eshots.push({ x: e.x, y: e.y, vx: Math.cos(ang) * 200, vy: Math.sin(ang) * 200, life: 4, img: sprite('eshot', e.x, e.y) }); }
      } else { const s = k.speed * (1 + w.wave * 0.05); e.vx = Math.cos(ang) * s; e.vy = Math.sin(ang) * s; }
      e.x += e.vx * dt; e.y += e.vy * dt; e.img.setPosition(e.x, e.y);
      if (e.kind === 'dasher' && e.state !== 'move') e.img.setScale(e.state === 'aim' ? 1 + Math.sin(e.t * 40) * 0.08 : 1.15, e.state === 'aim' ? 1 - Math.sin(e.t * 40) * 0.08 : 0.85); else if (e.kind === 'dasher') e.img.setScale(1);
      if (dist2(e, p) < (e.r + p.r - 4) ** 2) hurtPlayer();
      if (!world) return;
    }
    // Shots.
    for (let i = w.shots.length - 1; i >= 0; i--) {
      const b = w.shots[i]; b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt; b.img.setPosition(b.x, b.y);
      let gone = b.life <= 0;
      for (let j = w.enemies.length - 1; j >= 0 && !gone; j--) {
        const e = w.enemies[j];
        if (dist2(b, e) < (e.r + 4) ** 2 && b.hit !== e) {
          b.hit = e; e.hp--; e.img.setTintFill(0xffffff); scene.time.delayedCall(60, () => e.img.clearTint?.()); burst(b.x, b.y, 0xffffff, 4); audio.sfx('hit');
          if (e.hp <= 0) kill(e, j);
          if (b.pierce-- <= 0) gone = true;
        }
      }
      if (gone) { b.img.destroy(); w.shots.splice(i, 1); }
    }
    for (let i = w.eshots.length - 1; i >= 0; i--) {
      const b = w.eshots[i]; b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt; b.img.setPosition(b.x, b.y);
      if (dist2(b, p) < (p.r + 3) ** 2) { hurtPlayer(); b.life = 0; if (!world) return; }
      if (b.life <= 0) { b.img.destroy(); w.eshots.splice(i, 1); }
    }
    // Gems drift to the player inside the magnet.
    for (let i = w.gems.length - 1; i >= 0; i--) {
      const g = w.gems[i], d2 = dist2(g, p);
      if (d2 < p.magnet ** 2) { const ang = Math.atan2(p.y - g.y, p.x - g.x); g.x += Math.cos(ang) * 420 * dt; g.y += Math.sin(ang) * 420 * dt; }
      g.img.setPosition(g.x, g.y);
      if (d2 < (p.r + 6) ** 2) { g.img.destroy(); w.gems.splice(i, 1); w.gemsGot++; w.meter = Math.min(1, w.meter + 0.12); addScore(2); audio.sfx('pickup'); }
    }
    w.comboT -= dt; if (w.comboT <= 0) w.combo = 0;
    if (w.banner) { w.banner.t -= dt; if (w.banner.t <= 0) w.banner = null; }
    // The wave is over: win at ten, otherwise pick an upgrade and go again.
    if (!w.queue.length && !w.enemies.length) {
      if (w.wave >= 10) { end(true); return; }
      w.picking = true;
      const picks = Phaser.Utils.Array.Shuffle([...UPGRADES]).slice(0, 3);
      choose(`Wave ${w.wave} cleared. Pick one`, picks.map((u) => ({ label: u.label, text: u.text }))).then((i) => { if (world !== w) return; picks[i].apply(w.player); w.picking = false; audio.sfx('power'); startWave(); });
    }
  },
  render() {
    const w = world, cam = scene?.cameras?.main; if (!cam) return;
    cam.setScroll(-juice.offset.x, -juice.offset.y);
    gfx.clear(); scene.sky?.setDisplaySize(W(), H());
    // A background with some depth: twinkling stars and a soft grid that drifts.
    const t = performance.now() / 1000;
    for (const s of stars) { gfx.fillStyle(0xffffff, 0.25 + 0.35 * Math.sin(t * 1.7 + s.p) ** 2); gfx.fillCircle(s.x * W(), s.y * H(), s.r); }
    gfx.lineStyle(1, 0x3a2f6e, 0.35);
    for (let x = (t * 12) % 48; x < W(); x += 48) gfx.lineBetween(x, 0, x, H());
    for (let y = (t * 8) % 48; y < H(); y += 48) gfx.lineBetween(0, y, W(), y);
    if (!w) return;
    const p = w.player; p.img.setPosition(p.x, p.y).setAlpha(p.inv > 0 && Math.floor(p.inv * 20) % 2 ? 0.35 : 1);
    for (const e of w.enemies) if (e.kind === 'dasher' && e.state === 'aim') { gfx.lineStyle(2, PALETTE.dasher, 0.7); gfx.lineBetween(e.x, e.y, e.x + Math.cos(e.aim) * 240, e.y + Math.sin(e.aim) * 240); }
    gfx.fillStyle(0x000000, 0.35).fillRoundedRect(W() - 170, 52, 150, 12, 6); gfx.fillStyle(PALETTE.gem, 1).fillRoundedRect(W() - 170, 52, 150 * w.meter, 12, 6);
    hud.setText(`${'♥'.repeat(Math.max(0, p.hp))}${'♡'.repeat(Math.max(0, p.maxHp - p.hp))}   Wave ${w.wave}   ${window.officeGame?.state().score ?? 0}${w.combo >= 5 ? `   x${1 + Math.floor(w.combo / 5)}` : ''}${w.banner ? `\n${w.banner.text}` : ''}`);
  },
  state() { const w = world; return w ? { wave: w.wave, level: w.wave, lives: w.player.hp, enemies: w.enemies.length, player: { x: Math.round(w.player.x), y: Math.round(w.player.y) }, meter: Math.round(w.meter * 100) } : {}; },
};
void settings;
run(game);
