// One renderer for the whole app. Views swap in and out; the loop sleeps when the tab is hidden and quality adapts to the device.
// Quality comes in three tiers. A capable machine gets soft shadows, MSAA, tone mapping through a post pass and a dense city;
// a phone gets smaller shadow maps and fewer pixels; a weak or software-rendered device gets no shadows and no post at all.
// If frames still drop, the stage steps the tier down for the rest of the visit and tells the current view.
import * as THREE from '../vendor/three/three.module.min.js';

const TIERS = {
  high: { dpr: 2, shadow: 2048, soft: true, post: true, msaa: 4, density: 1 },
  mid: { dpr: 1.5, shadow: 1024, soft: true, post: true, msaa: 0, density: 0.7 },
  low: { dpr: 1, shadow: 0, soft: false, post: false, msaa: 0, density: 0.45 },
};

/** A fullscreen grade pass: the scene renders in linear HDR to a texture, then this applies ACES tone mapping, a soft vignette and fine grain. */
class Post {
  constructor(renderer, samples) {
    this.renderer = renderer;
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples, depthBuffer: true, stencilBuffer: false });
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tScene: { value: this.target.texture }, uVignette: { value: 0.32 }, uGrain: { value: 0.028 }, uTime: { value: 0 }, uLift: { value: new THREE.Vector3(0, 0, 0) } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `varying vec2 vUv; uniform sampler2D tScene; uniform float uVignette; uniform float uGrain; uniform float uTime; uniform vec3 uLift;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)) + uTime) * 43758.5453); }
        void main(){
          vec4 c = texture2D(tScene, vUv);
          vec2 q = vUv - 0.5;
          float v = 1.0 - uVignette * smoothstep(0.25, 1.1, dot(q, q) * 2.2);
          c.rgb = c.rgb * v + uLift;
          gl_FragColor = vec4(c.rgb, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          gl_FragColor.rgb += (hash(gl_FragCoord.xy) - 0.5) * uGrain;
        }`,
      depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.scene = new THREE.Scene(); this.scene.add(this.quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  setSize(w, h, dpr) { this.target.setSize(Math.floor(w * dpr), Math.floor(h * dpr)); }
  render(scene, camera, time) {
    const r = this.renderer;
    r.setRenderTarget(this.target);
    r.render(scene, camera);
    r.setRenderTarget(null);
    this.mat.uniforms.uTime.value = time % 100;
    r.render(this.scene, this.cam);
  }
  dispose() { this.target.dispose(); this.mat.dispose(); this.quad.geometry.dispose(); }
}

class Stage {
  constructor() { this.view = null; this.clock = new THREE.Clock(); this.ok = false; this.frameMs = 16; this.slow = 0; this.fps = 0; this.time = 0; this.tier = 'high'; }
  init(canvas) {
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    } catch { document.body.classList.add('no-webgl'); return false; }
    this.ok = true;
    this.renderer.info.autoReset = false;  // counted per frame below, so the post pass doesn't hide the scene's draw calls
    this.detect();
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = false;
    this.renderer.shadowMap.type = this.q.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { this.clock.getDelta(); this.loop(); } });
    this.loop();
    return true;
  }
  /** Pick a starting tier from what the device admits to. Software renderers and small phones start low; everything else can still step down. */
  detect() {
    const gl = this.renderer.getContext();
    let gpu = '';
    try { const ext = gl.getExtension('WEBGL_debug_renderer_info'); gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : ''; } catch { /* hidden */ }
    const cores = navigator.hardwareConcurrency || 4, mem = navigator.deviceMemory || 4;
    const mobile = /Mobi|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 900);
    const software = /SwiftShader|llvmpipe|Software|Basic Render/i.test(gpu);
    const saveData = navigator.connection?.saveData === true;
    this.gpu = gpu;
    this.lowEnd = mobile || cores <= 4;
    this.tier = software || saveData || (mobile && (cores <= 4 || mem <= 3)) ? 'low' : mobile || cores <= 6 || mem <= 4 ? 'mid' : 'high';
    const forced = new URLSearchParams(location.search).get('q');  // ?q=high|mid|low, for testing a look on any machine
    if (TIERS[forced]) this.tier = forced;
    this.q = { ...TIERS[this.tier] };
    this.dprCap = this.q.dpr;
  }
  get dpr() { return Math.min(window.devicePixelRatio || 1, this.dprCap); }
  resize() {
    if (!this.ok) return;
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(w, h, false);
    this.post?.setSize(w, h, this.dpr);
    this.view?.resize?.(w, h);
  }
  setView(view) {
    this.view?.leave?.();
    this.view = view;
    this.renderer.shadowMap.enabled = false;
    this.applyPost();
    if (view) { view.enter?.(); view.resize?.(window.innerWidth, window.innerHeight); }
  }
  applyPost() {
    const want = this.q.post && this.view?.post !== false;
    if (want && !this.post) { this.post = new Post(this.renderer, this.q.msaa); this.post.setSize(window.innerWidth, window.innerHeight, this.dpr); }
    if (!want && this.post) { this.post.dispose(); this.post = null; }
    if (this.post && this.view?.grade) Object.assign(this.post.mat.uniforms.uVignette, { value: this.view.grade.vignette ?? 0.32 }), Object.assign(this.post.mat.uniforms.uGrain, { value: this.view.grade.grain ?? 0.028 });
  }
  loop() {
    if (this.running || !this.ok) return;
    this.running = true;
    const tick = () => {
      if (document.hidden) { this.running = false; return; }
      requestAnimationFrame(tick);
      const dt = Math.min(this.clock.getDelta(), 0.1);
      this.time += dt;
      this.frameMs += (dt * 1000 - this.frameMs) * 0.05;
      this.fps = 1000 / this.frameMs;
      this.adapt();
      this.renderer.info.reset();
      if (this.view?.scene) {
        this.view.update?.(dt);
        if (this.post) this.post.render(this.view.scene, this.view.camera, this.time);
        else this.renderer.render(this.view.scene, this.view.camera);
      }
    };
    requestAnimationFrame(tick);
  }
  // A device that keeps missing 30fps first loses pixels, then shadows and post. Each step is permanent for the visit, so nothing flickers between looks.
  adapt() {
    if (this.frameMs > 34) this.slow++; else this.slow = Math.max(0, this.slow - 1);
    if (this.slow < 150) return;
    this.slow = 0;
    if (this.dprCap > 1) { this.dprCap = Math.max(1, this.dprCap - 0.35); this.resize(); return; }
    if (this.tier === 'high') this.setTier('mid'); else if (this.tier === 'mid') this.setTier('low');
  }
  setTier(tier) {
    this.tier = tier; this.q = { ...TIERS[tier] }; this.dprCap = Math.min(this.dprCap, this.q.dpr);
    this.renderer.shadowMap.type = this.q.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.applyPost();
    this.resize();
    this.view?.setTier?.(this.q);
  }
}
export const stage = new Stage();
window.__stage = stage;  // read by the browser e2e tests
