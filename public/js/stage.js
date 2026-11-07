// One renderer for the whole app. Views swap in and out; the loop sleeps when the tab is hidden and quality adapts to the device.
// Quality comes in three tiers. A capable machine gets screen-space ambient occlusion, a soft bloom, soft shadows from a big
// map, FXAA and a dense city; a phone gets half-resolution occlusion, a smaller shadow map and fewer pixels; a weak or
// software-rendered device gets no shadows and no post at all. If frames still drop, the stage first thins the occlusion,
// then the pixels, then the tier, for the rest of the visit, and tells the current view.
import * as THREE from '../vendor/three/three.module.min.js';
import { loadAddons } from './addons.js';

const TIERS = {
  high: { dpr: 2, shadow: 4096, soft: true, post: true, ao: 'full', bloom: 1, density: 1 },
  mid: { dpr: 1.5, shadow: 2048, soft: true, post: true, ao: 'half', bloom: 0.5, density: 0.7 },
  low: { dpr: 1, shadow: 0, soft: false, post: false, ao: 'off', bloom: 0, density: 0.45 },
};
const AO_STEPS = ['full', 'half', 'off'];

/**
 * A tilt-shift lens: sharp across most of the picture, softening toward the bottom. It is what makes a city read as a model
 * on a table, and the softer foreground also sits quietly behind the interface. A single 12-tap disc, so it costs little.
 * This pass always runs, because it is also the guard: one NaN or infinite pixel from any shader, on any driver, would otherwise
 * be smeared by the bloom's blur across the whole frame, and the picture would go black. Here that pixel just goes dark.
 */
const TiltShader = {
  uniforms: { tDiffuse: { value: null }, uCenter: { value: 0.55 }, uWidth: { value: 0.3 }, uAmount: { value: 0.005 }, uAspect: { value: 1.6 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `varying vec2 vUv; uniform sampler2D tDiffuse; uniform float uCenter; uniform float uWidth; uniform float uAmount; uniform float uAspect;
    const vec2 DISC[12] = vec2[12](vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621), vec2(0.962, -0.195), vec2(0.473, -0.480), vec2(0.519, 0.767), vec2(0.185, -0.893), vec2(0.507, 0.064), vec2(0.896, 0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598));
    vec3 safe(vec3 c){ return all(lessThan(abs(c), vec3(1e4))) ? c : vec3(0.0); }
    void main(){
      // Only below the band: the crown of the tower up against the sky stays crisp.
      float off = uCenter - vUv.y;
      float k = uAmount > 0.0 ? smoothstep(uWidth * 0.5, uWidth * 0.5 + 0.34, off) : 0.0;
      vec3 c = safe(texture2D(tDiffuse, vUv).rgb);
      if (k > 0.004) {
        vec2 r = vec2(uAmount * k / uAspect, uAmount * k);
        for (int i = 0; i < 12; i++) c += safe(texture2D(tDiffuse, vUv + DISC[i] * r).rgb);
        c /= 13.0;
      }
      gl_FragColor = vec4(c, 1.0);
    }`,
};

/** The final grade, after tone mapping: a soft vignette and fine grain, so the image reads as a photograph rather than a render. */
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uVignette: { value: 0.3 }, uGrain: { value: 0.024 }, uTime: { value: 0 }, uWarm: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `varying vec2 vUv; uniform sampler2D tDiffuse; uniform float uVignette; uniform float uGrain; uniform float uTime; uniform float uWarm;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)) + uTime) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      // Golden hour: gold into the highlights, a little violet-teal into the shadows, then a gentle contrast curve and a touch of saturation.
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      vec3 graded = c.rgb * mix(vec3(0.97, 0.985, 1.03), vec3(1.035, 1.0, 0.945), smoothstep(0.08, 0.72, l));
      graded = mix(graded, graded * graded * (3.0 - 2.0 * graded), 0.34);
      float l2 = dot(graded, vec3(0.2126, 0.7152, 0.0722));
      graded = clamp(mix(vec3(l2), graded, 1.1), 0.0, 1.0);
      c.rgb = mix(c.rgb, graded, uWarm);
      vec2 q = vUv - 0.5;
      float v = 1.0 - uVignette * smoothstep(0.25, 1.1, dot(q, q) * 2.2);
      c.rgb *= v;
      c.rgb += (hash(gl_FragCoord.xy) - 0.5) * uGrain;
      gl_FragColor = vec4(c.rgb, 1.0);
    }`,
};

/**
 * The post chain, on three's own EffectComposer: N8AO draws the scene and its ambient occlusion, a low bloom lifts the sun
 * glints and the lit windows, OutputPass applies the neutral tone map and the sRGB transfer, FXAA cleans the edges where the
 * pixel ratio is low, and the grade finishes. Everything before OutputPass is linear HDR.
 */
class Post {
  constructor(renderer, A) {
    this.renderer = renderer; this.A = A;
    this.composer = new A.EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false }));
    this.ao = new A.N8AOPass(new THREE.Scene(), new THREE.PerspectiveCamera(), 1, 1);
    this.ao.configuration.gammaCorrection = false;  // OutputPass does that, once
    this.ao.configuration.autoRenderBeauty = true;
    this.bloom = new A.UnrealBloomPass(new THREE.Vector2(1, 1), 0.18, 0.45, 0.92);
    this.output = new A.OutputPass();
    this.fxaa = new A.FXAAPass();
    this.grade = new A.ShaderPass(GradeShader);
    this.tilt = new A.ShaderPass(TiltShader);
    for (const p of [this.ao, this.tilt, this.bloom, this.output, this.fxaa, this.grade]) this.composer.addPass(p);
  }
  setSize(w, h, dpr) {
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.tilt.uniforms.uAspect.value = w / Math.max(1, h);
    this.fxaa.enabled = this.fxaaWanted && dpr < 1.75;
  }
  /** Point every pass at the view's scene and camera, and take the view's occlusion and grade settings. */
  setView(view, q) {
    const ao = this.ao;
    ao.scene = view.scene; ao.camera = view.camera;
    const c = view.ao || {};
    ao.configuration.aoRadius = c.radius ?? 1.6;
    ao.configuration.distanceFalloff = c.falloff ?? 1.0;
    this.wantIntensity = c.intensity ?? 2.0;
    ao.configuration.color = new THREE.Color(c.color || '#1d130b');
    this.setAO(q.ao);
    this.bloom.strength = (view.bloom ?? 0.18) * (q.bloom || 0);
    this.bloom.enabled = this.bloom.strength > 0.001;
    this.grade.uniforms.uVignette.value = view.grade?.vignette ?? 0.3;
    this.grade.uniforms.uGrain.value = view.grade?.grain ?? 0.024;
    this.grade.uniforms.uWarm.value = view.grade?.warm ?? 0;
    this.tilt.uniforms.uAmount.value = view.tilt?.amount ?? 0;
    if (view.tilt) { this.tilt.uniforms.uCenter.value = view.tilt.center; this.tilt.uniforms.uWidth.value = view.tilt.width; }
    this.fxaaWanted = view.fxaa !== false;
  }
  setAO(level) {
    const ao = this.ao;
    ao.configuration.halfRes = level !== 'full';
    // Off still renders the beauty pass (the composer needs it); the occlusion itself drops to its cheapest setting and zero weight.
    ao.setQualityMode(level === 'full' ? 'Medium' : level === 'half' ? 'Low' : 'Performance');
    ao.configuration.intensity = level === 'off' ? 0 : this.wantIntensity ?? 2;
    this.level = level;
  }
  render(dt, time) {
    this.grade.uniforms.uTime.value = time % 100;
    this.composer.render(dt);
  }
  dispose() { this.composer.dispose(); this.ao.dispose?.(); this.bloom.dispose(); this.output.dispose(); this.fxaa.dispose(); this.grade.dispose(); this.tilt.dispose(); }
}

class Stage {
  constructor() { this.view = null; this.last = 0; this.ok = false; this.frameMs = 16; this.slowFor = 0; this.fps = 0; this.time = 0; this.tier = 'high'; this.frame = 0; this.graceUntil = 0; this.lost = false; this.losses = 0; this.onLost = new Set(); this.onRestored = new Set(); this.notice = null; }
  init(canvas) {
    this.canvas = canvas;
    // No WebGL2 at all (a very old device, or one that has blocked it): everything but the 3D still works, over a painted city.
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    } catch { this.giveUp(); return false; }
    this.ok = true;
    this.renderer.info.autoReset = false;  // counted per frame below, so the post passes don't hide the scene's draw calls
    this.detect();
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Neutral, not ACES: the filmic curves desaturate the warm stone and the sky into one grey haze. Exposure sits a touch under 1.
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 0.84;
    this.renderer.shadowMap.enabled = false;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;  // r186 made this the soft one
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(true), 250));
    canvas.addEventListener('webglcontextlost', (e) => this.contextLost(e));
    canvas.addEventListener('webglcontextrestored', () => this.contextRestored());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { this.last = performance.now(); this.graceUntil = this.last + 1500; this.loop(); } });
    this.last = performance.now();
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
    // The post chain and the sky's reflections draw into half-float targets. Without a renderable one they would come out black, so such a device goes straight to the direct path.
    this.floatTargets = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    this.gpu = gpu;
    this.lowEnd = mobile || cores <= 4;
    this.mobile = mobile;
    this.tier = software || saveData || !this.floatTargets || (mobile && (cores <= 2 || mem <= 3)) ? 'low' : mobile || cores <= 4 || mem <= 4 ? 'mid' : 'high';
    const forced = new URLSearchParams(location.search).get('q');  // ?q=high|mid|low, for testing a look on any machine
    if (TIERS[forced] && (this.floatTargets || forced === 'low')) { this.tier = forced; this.forced = true; }
    this.q = { ...TIERS[this.tier] };
    this.q.shadow = Math.min(this.q.shadow, this.renderer.capabilities.maxTextureSize);
    // A phone starts with half-resolution occlusion; the frame-time watchdog below turns it off if the phone can't keep up.
    if (mobile && this.q.ao === 'full') this.q.ao = 'half';
    this.dprCap = this.q.dpr;
  }
  get dpr() { return Math.min(window.devicePixelRatio || 1, this.dprCap); }
  /**
   * A phone's toolbars and keyboard change the window's height while nothing about the scene should move, so on a phone only a real
   * change of shape redraws at a new size. The canvas keeps its size under the keyboard; the sheet moves, not the world.
   */
  resize(force) {
    if (!this.ok) return;
    const w = window.innerWidth, h = window.innerHeight;
    const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || '');
    if (!force && this.mobile && w === this.w && this.h && (typing || Math.abs(h - this.h) < 130)) return;
    this.w = w; this.h = h;
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(w, h, false);
    this.post?.setSize(w, h, this.dpr);
    // Measured on an M4 at 1440x900 and a pixel ratio of 2: full-resolution occlusion alone halves the frame rate, from about 70fps to 34, and half resolution looks the same at that density.
    if (this.q.ao === 'full' && w * h * this.dpr * this.dpr > 2.6e6) this.setAO('half');
    this.view?.resize?.(w, h);
  }
  setView(view) {
    this.view?.leave?.();
    this.view = view;
    this.renderer.shadowMap.enabled = false;
    this.graceUntil = performance.now() + 2000;  // the first frames of a new view compile shaders, which says nothing about the device
    this.applyPost();
    if (view) { view.enter?.(); view.resize?.(this.w ?? window.innerWidth, this.h ?? window.innerHeight); }
  }
  /** Post-processing is built the first time a tier wants it, once the addons bundle has arrived; until then frames draw directly. */
  applyPost() {
    const want = this.q.post && this.view && this.view.post !== false;
    if (want && !this.post && !this.postLoading) {
      this.postLoading = loadAddons().then((A) => {
        this.postLoading = null;
        if (!this.q.post || this.lost) return;
        this.post = new Post(this.renderer, A);
        this.post.setSize(this.w, this.h, this.dpr);
        if (this.view) this.post.setView(this.view, this.q);
      }).catch((e) => { this.postLoading = null; this.q.post = false; console.warn('post-processing unavailable', e); });
    }
    if (!want && this.post) { this.post.dispose(); this.post = null; }
    if (want && this.post && this.view) { this.post.setView(this.view, this.q); this.post.setSize(this.w, this.h, this.dpr); }
  }
  /** Resolves once a finished picture is on the canvas, post chain included if this tier has one, or after `ms` whatever happens. */
  whenPainted(ms = 2500) {
    const painted = (async () => {
      await this.postLoading;
      const from = this.frame;
      while (this.ok && !this.lost && !document.hidden && this.frame < from + 2) await new Promise((r) => requestAnimationFrame(r));
    })();
    return Promise.race([painted, new Promise((r) => setTimeout(r, ms))]);
  }
  /** One frame of the current view, on demand as well as from the loop. */
  renderOnce(dt = 0) {
    this.renderer.info.reset();
    if (!this.view?.scene) return;
    this.view.update?.(dt);
    // The sun's shadow map is big, so it redraws every other frame, or every third on a phone. Nobody can tell. A view where nothing that casts moves draws it once.
    const r = this.renderer;
    if (r.shadowMap.enabled && !r.shadowMap.autoUpdate && !this.view.staticShadows) r.shadowMap.needsUpdate = r.shadowMap.needsUpdate || this.frame % (this.lowEnd ? 3 : 2) === 0;
    if (this.post && this.post.level && this.view.post !== false) this.post.render(dt, this.time);
    else r.render(this.view.scene, this.view.camera);
  }
  loop() {
    if (this.running || !this.ok || this.lost) return;
    this.running = true;
    const tick = (now) => {
      if (document.hidden || this.lost || !this.ok) { this.running = false; return; }
      requestAnimationFrame(tick);
      const real = Math.max(0, now - this.last); this.last = now;
      const dt = Math.min(real / 1000, 0.1);
      this.time += dt; this.frame++;
      this.frameMs += (dt * 1000 - this.frameMs) * 0.05;
      this.fps = 1000 / this.frameMs;
      this.adapt(dt, now);
      this.renderOnce(dt);
    };
    requestAnimationFrame(tick);
  }
  // A device that keeps missing 30fps first loses occlusion, then pixels, then shadows and post. Each step is permanent for the visit, so
  // nothing flickers between looks. It goes by time, not frames: at 8fps, counting frames would mean twenty seconds of slideshow per step.
  adapt(dt, now) {
    if (this.forced || now < this.graceUntil) return;  // ?q= means someone wants to see exactly that tier
    // A desktop should hold well above 30. A phone is fine at 30: 37ms, not 33, because an iPhone in Low Power Mode caps at a steady 30fps, and that should cost it nothing.
    if (this.frameMs > (this.mobile ? 37 : 24)) this.slowFor += dt; else this.slowFor = Math.max(0, this.slowFor - dt);
    // Far too slow to bother stepping: the lightest look straight away.
    if (this.frameMs > 70 && this.slowFor > 2 && this.tier !== 'low' && !this.forced) { this.slowFor = 0; this.graceUntil = now + 2000; this.setAO('off'); this.setTier('low'); return; }
    if (this.slowFor < 3) return;
    this.slowFor = 0; this.graceUntil = now + 1500;
    if (this.q.ao !== 'off') { this.setAO(AO_STEPS[AO_STEPS.indexOf(this.q.ao) + 1]); return; }
    if (this.dprCap > 1) { this.dprCap = Math.max(1, this.dprCap - 0.35); this.resize(true); return; }
    if (this.tier === 'high') this.setTier('mid'); else if (this.tier === 'mid') this.setTier('low');
  }
  setAO(level) {
    this.q.ao = level;
    this.post?.setAO(level);
  }
  setTier(tier) {
    this.tier = tier; this.q = { ...TIERS[tier] }; this.dprCap = Math.min(this.dprCap, this.q.dpr);
    if (this.mobile && this.q.ao === 'full') this.q.ao = 'half';
    this.applyPost();
    this.resize(true);
    this.view?.setTier?.(this.q);
  }
  // ---- losing the GPU ----
  // Phones take the context away when memory runs short or the tab sits in the background. The page never goes black: the painted city
  // shows through at once, the interface carries on, and the 3D comes back on a lighter tier when the browser allows it.
  contextLost(e) {
    e.preventDefault();  // without this the browser never gives the context back
    this.lost = true;
    if (!document.hidden) this.losses++;
    document.body.classList.add('gl-lost');
    for (const f of this.onLost) f();
    clearTimeout(this.lostTimer);
    this.lostTimer = setTimeout(() => { if (this.lost) this.notice?.('The 3D view dropped out on this device. Everything else still works.'); }, 3000);
  }
  contextRestored() {
    clearTimeout(this.lostTimer);
    this.lost = false;
    if (this.losses >= 3) { this.giveUp(); return; }
    // Three uploads geometry and textures again by itself. Whatever only ever lived in a render target has to be drawn again.
    if (this.post) { try { this.post.dispose(); } catch { /* its context is gone */ } this.post = null; }
    this.postLoading = null;
    if (this.losses > 0 && !this.forced) this.setTier(this.tier === 'high' ? 'mid' : 'low');
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.w, this.h, false);
    for (const f of this.onRestored) f();
    this.applyPost();
    const r = this.renderer;
    if (r.shadowMap.enabled) r.shadowMap.needsUpdate = true;
    document.body.classList.remove('gl-lost');
    this.last = performance.now(); this.graceUntil = this.last + 2500;
    this.loop();
  }
  /** For the rest of the visit there is no 3D, only the painted city under the interface. */
  giveUp() {
    this.ok = false;
    document.body.classList.remove('gl-lost');
    document.body.classList.add('no-webgl');
  }
}
export const stage = new Stage();
window.__stage = stage;  // read by the browser e2e tests
