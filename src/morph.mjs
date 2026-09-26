// Morph engine.
//
// "Face" mode is a classic feature-based morph, the technique behind the famous
// 1991 face-morph music video: matching landmarks on two faces are triangulated,
// every triangle slides from face A's shape to face B's, and the pixels
// cross-dissolve at the same time.
//
// The other modes (liquid, swirl, luma, shatter) are noise-driven melts for
// images without faces.

import Delaunator from 'https://cdn.jsdelivr.net/npm/delaunator@5.0.1/+esm';
import { buildMesh } from './faces.mjs';

// Shared finishing pass: monochrome, film grain, vignette.
const FINISH = `
uniform float mono, grain, time;
uniform vec2 res;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 finish(vec3 col) {
  vec2 q = gl_FragCoord.xy / res;
  if (mono > 0.5) col = vec3(smoothstep(0.02, 0.98, luma(col)));
  col += (hash(q * 900.0 + fract(time) * 50.0) - 0.5) * grain;
  float vig = smoothstep(1.1, 0.35, distance(q, vec2(0.5)));
  return col * mix(0.72, 1.0, vig);
}`;

const MESH_VERT = `
attribute vec2 pa, pb, ua, ub;
uniform float warp;
varying vec2 vua, vub;
void main() {
  vec2 p = mix(pa, pb, warp);
  vua = ua; vub = ub;
  gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0);
}`;

const MESH_FRAG = `
precision highp float;
varying vec2 vua, vub;
uniform sampler2D texA, texB;
uniform float dissolve, wire;
${FINISH}
// Past the photo's edge, mirror it (no smeared edge pixels) and darken gently.
vec3 pick(sampler2D t, vec2 u) {
  vec2 mirrored = 1.0 - abs(1.0 - mod(u, 2.0));
  float outside = length(u - clamp(u, 0.0, 1.0));
  return texture2D(t, mirrored).rgb * (1.0 - 0.55 * smoothstep(0.0, 0.3, outside));
}
void main() {
  if (wire > 0.5) { gl_FragColor = vec4(1.0, 1.0, 1.0, 0.28); return; }
  vec3 col = mix(pick(texA, vua), pick(texB, vub), dissolve);
  gl_FragColor = vec4(finish(col), 1.0);
}`;

const MELT_VERT = `
attribute vec2 p;
varying vec2 uv;
void main() {
  uv = p * 0.5 + 0.5;
  uv.y = 1.0 - uv.y;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const MELT_FRAG = `
precision highp float;
varying vec2 uv;
uniform sampler2D texA, texB;
uniform vec4 fitA, fitB;   // xy = scale (object-fit: cover)
uniform float progress, strength;
uniform int mode;          // 1 liquid, 2 swirl, 3 luma, 4 shatter
${FINISH}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}
vec3 sampleFit(sampler2D t, vec4 fit, vec2 q) {
  return texture2D(t, clamp((q - 0.5) * fit.xy + 0.5, 0.001, 0.999)).rgb;
}
vec2 rot(vec2 q, float a) {
  vec2 d = q - 0.5; float s = sin(a), c = cos(a);
  return vec2(c * d.x - s * d.y, s * d.x + c * d.y) + 0.5;
}
void main() {
  float t = progress;
  float bell = sin(3.14159265 * t);
  vec2 flow = vec2(fbm(uv * 3.0 + time * 0.15), fbm(uv * 3.0 + 7.3 - time * 0.15)) - 0.5;
  vec2 qa = uv, qb = uv;
  float mask;
  if (mode == 2) {
    float r = distance(uv, vec2(0.5));
    float ang = strength * 7.0 * bell * (1.0 - smoothstep(0.0, 0.75, r));
    qa = rot(uv, ang); qb = rot(uv, -ang * 0.6);
    mask = 1.0 - smoothstep(t - 0.15, t + 0.15, r * 0.9 + fbm(uv * 4.0) * 0.25);
  } else if (mode == 3) {
    qa = uv + flow * strength * 0.25 * t;
    qb = uv - flow * strength * 0.25 * (1.0 - t);
    float l = luma(sampleFit(texA, fitA, qa));
    float edge = t * 1.4 - 0.2;
    mask = smoothstep(edge + 0.2, edge - 0.2, 1.0 - l);
  } else if (mode == 4) {
    vec2 cell = floor(uv * 14.0 + flow * 3.0);
    vec2 kick = (vec2(hash(cell + 3.1), hash(cell + 8.7)) - 0.5) * strength * 0.3 * bell;
    qa = uv + kick; qb = uv - kick;
    mask = step(hash(cell), t);
  } else {
    qa = uv + flow * strength * 0.45 * t;
    qb = uv - flow * strength * 0.45 * (1.0 - t);
    float n = fbm(uv * 2.5 + flow * 2.0 + time * 0.05);
    float edge = t * 1.5 - 0.25;
    mask = smoothstep(edge + 0.12, edge - 0.12, n);
  }
  vec3 col = mix(sampleFit(texA, fitA, qa), sampleFit(texB, fitB, qb), mask);
  gl_FragColor = vec4(finish(col), 1.0);
}`;

export const MODES = { face: 0, liquid: 1, swirl: 2, luma: 3, shatter: 4 };

const MAX_SIDE = 1600;

/** Decode any image source into a bitmap no larger than MAX_SIDE. */
export async function loadImage(src) {
  let blob = src;
  if (typeof src === 'string') blob = await (await fetch(src)).blob();
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  if (k === 1) return bmp;
  const scaled = await createImageBitmap(bmp, {
    resizeWidth: Math.round(bmp.width * k),
    resizeHeight: Math.round(bmp.height * k),
    resizeQuality: 'high',
  });
  bmp.close();
  return scaled;
}

const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

let nextId = 1;

export class Morph {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, antialias: true });
    if (!gl) throw new Error('WebGL is not available in this browser.');
    this.gl = gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    this.mesh = this.#program(MESH_VERT, MESH_FRAG,
      ['texA', 'texB', 'warp', 'dissolve', 'wire', 'mono', 'grain', 'time', 'res'], ['pa', 'pb', 'ua', 'ub']);
    this.melt = this.#program(MELT_VERT, MELT_FRAG,
      ['texA', 'texB', 'fitA', 'fitB', 'progress', 'strength', 'mode', 'mono', 'grain', 'time', 'res'], ['p']);

    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.meshVbo = gl.createBuffer();
    this.meshTris = gl.createBuffer();
    this.meshEdges = gl.createBuffer();
    this.meshKey = '';
    this.meshCache = new Map();

    this.frames = [];   // { id, bitmap, width, height, face, texture }
    this.settings = { mode: 'face', strength: 0.6, mono: true, grain: 0.05, hold: 0.7, morph: 1.8, loop: true, wire: false };
  }

  #program(vs, fs, uniforms, attribs) {
    const gl = this.gl;
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    const u = {}, a = {};
    for (const name of uniforms) u[name] = gl.getUniformLocation(program, name);
    for (const name of attribs) a[name] = gl.getAttribLocation(program, name);
    gl.useProgram(program);
    gl.uniform1i(u.texA, 0);
    gl.uniform1i(u.texB, 1);
    return { program, u, a };
  }

  #texture(bitmap) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, bitmap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  /** face: landmark array from detectFace(), or null for images without a face. */
  addFrame(bitmap, face = null) {
    this.frames.push({ id: nextId++, bitmap, width: bitmap.width, height: bitmap.height, face, texture: this.#texture(bitmap) });
  }

  removeFrame(i) {
    const [f] = this.frames.splice(i, 1);
    if (f) this.gl.deleteTexture(f.texture);
    return f;
  }

  moveFrame(from, to) {
    const [f] = this.frames.splice(from, 1);
    this.frames.splice(to, 0, f);
  }

  /** Seconds for one full pass through every frame. */
  get duration() {
    const n = this.frames.length;
    if (n < 2) return 0;
    const { hold, morph, loop } = this.settings;
    return (loop ? n : n - 1) * (hold + morph) + (loop ? 0 : hold);
  }

  /** Map a timeline position to (fromIndex, toIndex, progress 0..1 linear). */
  locate(t) {
    const n = this.frames.length;
    if (n < 2) return { a: 0, b: 0, p: 0 };
    const { hold, morph, loop } = this.settings;
    const seg = hold + morph;
    const segments = loop ? n : n - 1;
    const i = Math.floor(t / seg);
    if (i >= segments) return { a: loop ? 0 : n - 1, b: loop ? 0 : n - 1, p: 0 };
    const local = t - i * seg;
    return { a: i, b: (i + 1) % n, p: local < hold ? 0 : (local - hold) / morph };
  }

  #fit(f) {
    const cw = this.canvas.width, ch = this.canvas.height;
    const ia = f.width / f.height, ca = cw / ch;
    return ia > ca ? [ca / ia, 1, 0, 0] : [1, ia / ca, 0, 0];
  }

  #useMesh(A, B) {
    const gl = this.gl;
    const W = this.canvas.width, H = this.canvas.height;
    const key = `${A.id}:${B.id}:${W}x${H}`;
    let mesh = this.meshCache.get(key);
    if (!mesh) {
      mesh = buildMesh(Delaunator, A, B, W, H);
      if (this.meshCache.size > 24) this.meshCache.clear();
      this.meshCache.set(key, mesh);
    }
    if (this.meshKey !== key) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.meshVbo);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.meshTris);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.triangles, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.meshEdges);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.edges, gl.DYNAMIC_DRAW);
      this.meshKey = key;
    }
    return mesh;
  }

  #common(prog, t) {
    const gl = this.gl;
    gl.uniform1f(prog.u.mono, this.settings.mono ? 1 : 0);
    gl.uniform1f(prog.u.grain, this.settings.grain);
    gl.uniform1f(prog.u.time, t);
    gl.uniform2f(prog.u.res, this.canvas.width, this.canvas.height);
  }

  render(t) {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (this.frames.length === 0) return;

    const { a, b, p } = this.locate(t);
    const A = this.frames[a], B = this.frames[b];
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, A.texture);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, B.texture);

    if (this.settings.mode === 'face' && A.face && B.face) this.#drawFaces(A, B, p, t);
    else this.#drawMelt(A, B, p, t);
  }

  #drawFaces(A, B, p, t) {
    const gl = this.gl;
    const prog = this.mesh;
    gl.useProgram(prog.program);
    const mesh = this.#useMesh(A, B);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.meshVbo);
    ['pa', 'pb', 'ua', 'ub'].forEach((name, k) => {
      gl.enableVertexAttribArray(prog.a[name]);
      gl.vertexAttribPointer(prog.a[name], 2, gl.FLOAT, false, 32, k * 8);
    });
    this.#common(prog, t);
    gl.uniform1f(prog.u.warp, ease(p));
    gl.uniform1f(prog.u.dissolve, smooth(0.2, 0.8, p));
    gl.uniform1f(prog.u.wire, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.meshTris);
    gl.drawElements(gl.TRIANGLES, mesh.triangles.length, gl.UNSIGNED_SHORT, 0);
    if (this.settings.wire) {
      gl.uniform1f(prog.u.wire, 1);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.meshEdges);
      gl.drawElements(gl.LINES, mesh.edges.length, gl.UNSIGNED_SHORT, 0);
    }
    ['pa', 'pb', 'ua', 'ub'].forEach((name) => gl.disableVertexAttribArray(prog.a[name]));
  }

  #drawMelt(A, B, p, t) {
    const gl = this.gl;
    const prog = this.melt;
    gl.useProgram(prog.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(prog.a.p);
    gl.vertexAttribPointer(prog.a.p, 2, gl.FLOAT, false, 0, 0);
    this.#common(prog, t);
    gl.uniform4fv(prog.u.fitA, this.#fit(A));
    gl.uniform4fv(prog.u.fitB, this.#fit(B));
    gl.uniform1f(prog.u.progress, ease(p));
    gl.uniform1f(prog.u.strength, this.settings.strength);
    gl.uniform1i(prog.u.mode, MODES[this.settings.mode] || 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disableVertexAttribArray(prog.a.p);
  }
}

/** Pick the best container the browser's MediaRecorder can write. */
export function recorderMime() {
  const options = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
  return options.find((m) => window.MediaRecorder?.isTypeSupported(m)) ?? '';
}

/**
 * Play the timeline once in real time while recording the canvas.
 * Resolves with the finished video Blob.
 */
export function record(morph, { fps = 30, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const mime = recorderMime();
    if (!mime) return reject(new Error('Video recording is not supported in this browser.'));
    const stream = morph.canvas.captureStream(fps);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => resolve(new Blob(chunks, { type: mime.split(';')[0] }));
    rec.onerror = (e) => reject(e.error ?? e);

    const total = morph.duration;
    const start = performance.now();
    rec.start(250);
    const tick = () => {
      const t = (performance.now() - start) / 1000;
      morph.render(Math.min(t, total));
      onProgress?.(Math.min(1, t / total));
      if (t < total) requestAnimationFrame(tick);
      else setTimeout(() => rec.stop(), 120);
    };
    requestAnimationFrame(tick);
  });
}
