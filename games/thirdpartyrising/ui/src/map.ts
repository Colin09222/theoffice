// WebGL map: filled regions coloured per feature, outlines, town markers, pan/zoom and picking.
// Geometry arrives as MultiPolygons with flat [lon, lat, ...] rings (see tools/data/build.mjs).

import earcut from "earcut";

export type MultiPoly = number[][][];
export type Proj = (lon: number, lat: number, feat: number) => [number, number];

export interface Mesh {
  n: number;
  pos: Float32Array; // triangle vertices, projected
  feat: Uint32Array; // feature index per triangle vertex
  col: Float32Array; // rgb per triangle vertex
  line: Float32Array; // outline segments, projected
  lineStart: Uint32Array; // first outline vertex per feature
  lineCount: Uint32Array;
  rings: Float32Array[][]; // projected outer+hole rings per feature, for picking
  bbox: Float32Array; // minx, miny, maxx, maxy per feature
  bounds: [number, number, number, number];
  posBuf?: WebGLBuffer;
  colBuf?: WebGLBuffer;
  lineBuf?: WebGLBuffer;
}

export interface Marker { x: number; y: number; size: number; rgb: [number, number, number]; label?: string; rank: number; }

export function buildMesh(feats: MultiPoly[], proj: Proj): Mesh {
  const pos: number[] = [], feat: number[] = [], line: number[] = [];
  const lineStart = new Uint32Array(feats.length), lineCount = new Uint32Array(feats.length);
  const rings: Float32Array[][] = [];
  const bbox = new Float32Array(feats.length * 4);
  const B: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  feats.forEach((mp, fi) => {
    lineStart[fi] = line.length / 2;
    const fr: Float32Array[] = [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const poly of mp) {
      const flat: number[] = [], holes: number[] = [];
      poly.forEach((ring, ri) => {
        if (ri > 0) holes.push(flat.length / 2);
        const pr = new Float32Array(ring.length);
        for (let i = 0; i < ring.length; i += 2) {
          const [x, y] = proj(ring[i], ring[i + 1], fi);
          pr[i] = x; pr[i + 1] = y; flat.push(x, y);
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
        for (let i = 0; i < pr.length; i += 2) {
          const j = (i + 2) % pr.length;
          line.push(pr[i], pr[i + 1], pr[j], pr[j + 1]);
        }
        fr.push(pr);
      });
      const tris = earcut(flat, holes, 2);
      for (const t of tris) { pos.push(flat[t * 2], flat[t * 2 + 1]); feat.push(fi); }
    }
    rings.push(fr);
    lineCount[fi] = line.length / 2 - lineStart[fi];
    bbox.set([x0, y0, x1, y1], fi * 4);
    if (x0 < B[0]) B[0] = x0; if (y0 < B[1]) B[1] = y0; if (x1 > B[2]) B[2] = x1; if (y1 > B[3]) B[3] = y1;
  });
  return { n: feats.length, pos: new Float32Array(pos), feat: new Uint32Array(feat), col: new Float32Array(pos.length / 2 * 3), line: new Float32Array(line), lineStart, lineCount, rings, bbox, bounds: B };
}

const VS = `attribute vec2 a_pos; attribute vec3 a_col; attribute float a_size;
uniform vec2 u_c; uniform vec2 u_s; uniform float u_flat; uniform vec4 u_color; varying vec4 v_col;
void main(){ gl_Position = vec4((a_pos - u_c) * u_s, 0.0, 1.0); gl_PointSize = a_size; v_col = mix(vec4(a_col, 1.0), u_color, u_flat); }`;
const FS = `precision mediump float; varying vec4 v_col; uniform float u_round;
void main(){ if (u_round > 0.5) { vec2 d = gl_PointCoord - 0.5; float r = dot(d, d); if (r > 0.25) discard; if (r > 0.16) { gl_FragColor = vec4(0.05, 0.07, 0.1, 1.0); return; } } gl_FragColor = v_col; }`;

export class GLMap {
  gl: WebGLRenderingContext;
  labels: CanvasRenderingContext2D;
  prog: WebGLProgram;
  loc: Record<string, any> = {};
  fill: Mesh | null = null;
  under: Mesh | null = null; // faint reference outlines (counties under a district view)
  markers: Marker[] = [];
  markerBuf: WebGLBuffer;
  cx = 0; cy = 0; scale = 1;
  hover = -1; selected = -1;
  onHover: (feat: number, ev: MouseEvent) => void = () => {};
  onClick: (feat: number) => void = () => {};
  private dirty = true;
  private dpr = Math.min(window.devicePixelRatio || 1, 2);

  constructor(public canvas: HTMLCanvasElement, public overlay: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl", { antialias: true, alpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error("WebGL is not available");
    this.gl = gl;
    this.labels = overlay.getContext("2d")!;
    const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader"); return s; };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
    gl.useProgram(p);
    this.prog = p;
    for (const a of ["a_pos", "a_col", "a_size"]) this.loc[a] = gl.getAttribLocation(p, a);
    for (const u of ["u_c", "u_s", "u_flat", "u_color", "u_round"]) this.loc[u] = gl.getUniformLocation(p, u);
    this.markerBuf = gl.createBuffer()!;
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.bind();
    const loop = () => { if (this.dirty) this.draw(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement!);
  }

  private bind() {
    const c = this.overlay;
    let drag: { x: number; y: number; moved: boolean } | null = null;
    c.addEventListener("mousedown", (e) => { drag = { x: e.clientX, y: e.clientY, moved: false }; });
    window.addEventListener("mouseup", (e) => {
      if (drag && !drag.moved && e.target === c) this.onClick(this.pick(e));
      drag = null;
    });
    c.addEventListener("mousemove", (e) => {
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        if (drag.moved) { this.cx -= dx / this.scale; this.cy += dy / this.scale; drag.x = e.clientX; drag.y = e.clientY; this.dirty = true; }
        return;
      }
      const f = this.pick(e);
      if (f !== this.hover) { this.hover = f; this.dirty = true; }
      this.onHover(f, e);
    });
    c.addEventListener("mouseleave", (e) => { this.hover = -1; this.dirty = true; this.onHover(-1, e); });
    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      const [wx, wy] = this.toWorld(e);
      const k = Math.exp(-e.deltaY * 0.0015);
      const ns = Math.max(this.minScale * 0.7, Math.min(this.minScale * 60, this.scale * k));
      const r = c.getBoundingClientRect();
      this.cx = wx - (e.clientX - r.left - r.width / 2) / ns;
      this.cy = wy + (e.clientY - r.top - r.height / 2) / ns;
      this.scale = ns; this.dirty = true;
    }, { passive: false });
  }
  private minScale = 1;

  toWorld(e: MouseEvent): [number, number] {
    const r = this.overlay.getBoundingClientRect();
    return [this.cx + (e.clientX - r.left - r.width / 2) / this.scale, this.cy - (e.clientY - r.top - r.height / 2) / this.scale];
  }
  toScreen(x: number, y: number): [number, number] {
    const r = this.overlay.getBoundingClientRect();
    return [(x - this.cx) * this.scale + r.width / 2, -(y - this.cy) * this.scale + r.height / 2];
  }

  pick(e: MouseEvent): number {
    const m = this.fill;
    if (!m) return -1;
    const [x, y] = this.toWorld(e);
    for (let f = 0; f < m.n; f++) {
      if (x < m.bbox[f * 4] || y < m.bbox[f * 4 + 1] || x > m.bbox[f * 4 + 2] || y > m.bbox[f * 4 + 3]) continue;
      let inside = false;
      for (const r of m.rings[f]) {
        for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
          if ((r[i + 1] > y) !== (r[j + 1] > y) && x < ((r[j] - r[i]) * (y - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) inside = !inside;
        }
      }
      if (inside) return f;
    }
    return -1;
  }

  resize() {
    const p = this.canvas.parentElement!;
    const w = Math.max(50, p.clientWidth), h = Math.max(50, p.clientHeight);
    for (const c of [this.canvas, this.overlay]) { c.width = Math.round(w * this.dpr); c.height = Math.round(h * this.dpr); c.style.width = w + "px"; c.style.height = h + "px"; }
    this.dirty = true;
  }

  fit(b: [number, number, number, number], pad = 0.06) {
    const p = this.canvas.parentElement!;
    const w = p.clientWidth || 800, h = p.clientHeight || 600;
    this.cx = (b[0] + b[2]) / 2; this.cy = (b[1] + b[3]) / 2;
    this.scale = Math.min(w / ((b[2] - b[0]) * (1 + pad * 2)), h / ((b[3] - b[1]) * (1 + pad * 2)));
    this.minScale = this.scale;
    this.dirty = true;
  }

  private upload(m: Mesh) {
    const gl = this.gl;
    if (!m.posBuf) {
      m.posBuf = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, m.posBuf); gl.bufferData(gl.ARRAY_BUFFER, m.pos, gl.STATIC_DRAW);
      m.lineBuf = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, m.lineBuf); gl.bufferData(gl.ARRAY_BUFFER, m.line, gl.STATIC_DRAW);
      m.colBuf = gl.createBuffer()!;
    }
  }

  setMesh(fill: Mesh, under: Mesh | null = null) {
    this.fill = fill; this.under = under; this.upload(fill); if (under) this.upload(under);
    this.hover = -1; this.dirty = true;
  }

  /** rgb is 3 floats (0..1) per feature. */
  setColors(rgb: Float32Array) {
    const m = this.fill; if (!m) return;
    const { feat, col } = m;
    for (let i = 0; i < feat.length; i++) { const f = feat[i] * 3; col[i * 3] = rgb[f]; col[i * 3 + 1] = rgb[f + 1]; col[i * 3 + 2] = rgb[f + 2]; }
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, m.colBuf!); gl.bufferData(gl.ARRAY_BUFFER, col, gl.DYNAMIC_DRAW);
    this.dirty = true;
  }

  setMarkers(ms: Marker[]) { this.markers = ms; this.dirty = true; }
  redraw() { this.dirty = true; }

  private lines(m: Mesh, color: [number, number, number, number], start = 0, count = -1) {
    const gl = this.gl, L = this.loc;
    gl.bindBuffer(gl.ARRAY_BUFFER, m.lineBuf!); gl.enableVertexAttribArray(L.a_pos); gl.vertexAttribPointer(L.a_pos, 2, gl.FLOAT, false, 0, 0);
    gl.disableVertexAttribArray(L.a_col); gl.vertexAttrib3f(L.a_col, 0, 0, 0);
    gl.uniform1f(L.u_flat, 1); gl.uniform4fv(L.u_color, color);
    gl.drawArrays(gl.LINES, start, count < 0 ? m.line.length / 2 : count);
  }

  draw() {
    this.dirty = false;
    const gl = this.gl, L = this.loc, m = this.fill;
    const W = this.canvas.width, H = this.canvas.height;
    gl.viewport(0, 0, W, H);
    gl.clearColor(0.055, 0.075, 0.105, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    const ctx = this.labels;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
    if (!m) return;
    const cw = W / this.dpr, ch = H / this.dpr;
    gl.uniform2f(L.u_c, this.cx, this.cy); gl.uniform2f(L.u_s, (2 * this.scale) / cw, (2 * this.scale) / ch);
    gl.uniform1f(L.u_round, 0); gl.disableVertexAttribArray(L.a_size); gl.vertexAttrib1f(L.a_size, 1);
    // fills
    gl.bindBuffer(gl.ARRAY_BUFFER, m.posBuf!); gl.enableVertexAttribArray(L.a_pos); gl.vertexAttribPointer(L.a_pos, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, m.colBuf!); gl.enableVertexAttribArray(L.a_col); gl.vertexAttribPointer(L.a_col, 3, gl.FLOAT, false, 0, 0);
    gl.uniform1f(L.u_flat, 0);
    gl.drawArrays(gl.TRIANGLES, 0, m.pos.length / 2);
    if (this.under) this.lines(this.under, [0.04, 0.06, 0.09, 0.28]);
    this.lines(m, [0.04, 0.06, 0.09, this.under ? 0.85 : 0.6]);
    if (this.selected >= 0 && this.selected < m.n) { for (let k = 0; k < 2; k++) this.lines(m, [1, 0.86, 0.45, 1], m.lineStart[this.selected], m.lineCount[this.selected]); }
    if (this.hover >= 0 && this.hover < m.n && this.hover !== this.selected) this.lines(m, [1, 1, 1, 0.9], m.lineStart[this.hover], m.lineCount[this.hover]);
    // town markers
    if (this.markers.length) {
      const data = new Float32Array(this.markers.length * 6);
      this.markers.forEach((k, i) => data.set([k.x, k.y, k.rgb[0], k.rgb[1], k.rgb[2], k.size * this.dpr], i * 6));
      gl.bindBuffer(gl.ARRAY_BUFFER, this.markerBuf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(L.a_pos); gl.vertexAttribPointer(L.a_pos, 2, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(L.a_col); gl.vertexAttribPointer(L.a_col, 3, gl.FLOAT, false, 24, 8);
      gl.enableVertexAttribArray(L.a_size); gl.vertexAttribPointer(L.a_size, 1, gl.FLOAT, false, 24, 20);
      gl.uniform1f(L.u_flat, 0); gl.uniform1f(L.u_round, 1);
      gl.drawArrays(gl.POINTS, 0, this.markers.length);
      gl.disableVertexAttribArray(L.a_size);
      // labels, most important first, skipping any that would overlap
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.font = "600 11.5px system-ui, sans-serif"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
      const taken: [number, number, number, number][] = [];
      const zoom = this.scale / this.minScale;
      const sorted = this.markers.filter((k) => k.label).sort((a, b) => a.rank - b.rank);
      let shown = 0;
      for (const k of sorted) {
        if (shown >= 10 + zoom * 8) break;
        const sx = (k.x - this.cx) * this.scale + cw / 2, sy = -(k.y - this.cy) * this.scale + ch / 2;
        if (sx < 0 || sy < 0 || sx > cw || sy > ch) continue;
        const tw = ctx.measureText(k.label!).width;
        const box: [number, number, number, number] = [sx + 6, sy - 8, sx + 10 + tw, sy + 8];
        if (taken.some((t) => box[0] < t[2] && box[2] > t[0] && box[1] < t[3] && box[3] > t[1])) continue;
        taken.push(box); shown++;
        ctx.strokeStyle = "rgba(10,14,20,0.85)"; ctx.lineWidth = 3; ctx.strokeText(k.label!, sx + 8, sy);
        ctx.fillStyle = k.rank < 0 ? "#ffdc73" : "#eef2f6"; ctx.fillText(k.label!, sx + 8, sy);
      }
    }
  }
}
