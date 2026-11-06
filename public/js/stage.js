// One renderer for the whole app. Views swap in and out; the loop sleeps when the tab is hidden and quality adapts to the device.
import * as THREE from '../vendor/three/three.module.min.js';

class Stage {
  constructor() { this.view = null; this.clock = new THREE.Clock(); this.ok = false; this.frameMs = 16; this.dprCap = 2; this.slow = 0; this.fps = 0; }
  init(canvas) {
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    } catch { document.body.classList.add('no-webgl'); return false; }
    this.ok = true;
    this.lowEnd = /Mobi|Android/i.test(navigator.userAgent) || (navigator.hardwareConcurrency || 8) <= 4;
    this.dprCap = this.lowEnd ? 1.6 : 2;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { this.clock.getDelta(); this.loop(); } });
    this.loop();
    return true;
  }
  resize() {
    if (!this.ok) return;
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.dprCap));
    this.renderer.setSize(w, h, false);
    this.view?.resize?.(w, h);
  }
  setView(view) {
    this.view?.leave?.();
    this.view = view;
    if (view) { view.enter?.(); view.resize?.(window.innerWidth, window.innerHeight); }
  }
  loop() {
    if (this.running || !this.ok) return;
    this.running = true;
    const tick = () => {
      if (document.hidden) { this.running = false; return; }
      requestAnimationFrame(tick);
      const dt = Math.min(this.clock.getDelta(), 0.1);
      this.frameMs += (dt * 1000 - this.frameMs) * 0.05;
      this.fps = 1000 / this.frameMs;
      this.adapt();
      if (this.view?.scene) {
        this.view.update?.(dt);
        this.renderer.render(this.view.scene, this.view.camera);
      }
    };
    requestAnimationFrame(tick);
  }
  // A real phone struggling gets fewer pixels, rather than a stutter. Each step is permanent for the visit.
  adapt() {
    if (this.frameMs > 34) this.slow++; else this.slow = Math.max(0, this.slow - 1);
    if (this.slow > 150 && this.dprCap > 1) { this.dprCap = Math.max(1, this.dprCap - 0.35); this.slow = 0; this.resize(); }
  }
}
export const stage = new Stage();
