// Morph engine: a WebGL renderer that flows one image into the next.
// Each transition warps both frames through a shared noise field while a
// noise-shaped mask decides which frame shows through, so edges melt rather
// than crossfade.

const VERT = `
attribute vec2 p;
varying vec2 uv;
void main() {
  uv = p * 0.5 + 0.5;
  uv.y = 1.0 - uv.y;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
varying vec2 uv;
uniform sampler2D texA, texB;
uniform vec4 fitA, fitB;   // xy = scale, zw = offset (object-fit: cover)
uniform float progress, time, strength, mono, grain;
uniform int mode;          // 0 liquid, 1 swirl, 2 luma, 3 shatter

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
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
  return texture2D(t, clamp((q - 0.5) * fit.xy + 0.5 + fit.zw, 0.001, 0.999)).rgb;
}
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec2 rot(vec2 q, float a) {
  vec2 d = q - 0.5; float s = sin(a), c = cos(a);
  return vec2(c * d.x - s * d.y, s * d.x + c * d.y) + 0.5;
}

void main() {
  float t = progress;
  float bell = sin(3.14159265 * t);          // 0 at ends, 1 mid-morph
  vec2 flow = vec2(fbm(uv * 3.0 + time * 0.15), fbm(uv * 3.0 + 7.3 - time * 0.15)) - 0.5;
  vec2 qa = uv, qb = uv;
  float mask;

  if (mode == 1) {
    float r = distance(uv, vec2(0.5));
    float ang = strength * 7.0 * bell * (1.0 - smoothstep(0.0, 0.75, r));
    qa = rot(uv, ang); qb = rot(uv, -ang * 0.6);
    mask = smoothstep(t - 0.15, t + 0.15, r * 0.9 + fbm(uv * 4.0) * 0.25);
    mask = 1.0 - mask;
  } else if (mode == 2) {
    qa = uv + flow * strength * 0.25 * t;
    qb = uv - flow * strength * 0.25 * (1.0 - t);
    float l = luma(sampleFit(texA, fitA, qa));
    float edge = t * 1.4 - 0.2;
    mask = smoothstep(edge + 0.2, edge - 0.2, 1.0 - l);
  } else if (mode == 3) {
    vec2 cell = floor(uv * 14.0 + flow * 3.0);
    float h = hash(cell);
    vec2 kick = (vec2(hash(cell + 3.1), hash(cell + 8.7)) - 0.5) * strength * 0.3 * bell;
    qa = uv + kick; qb = uv - kick;
    mask = step(h, t);
  } else {
    qa = uv + flow * strength * 0.45 * t;
    qb = uv - flow * strength * 0.45 * (1.0 - t);
    float n = fbm(uv * 2.5 + flow * 2.0 + time * 0.05);
    float edge = t * 1.5 - 0.25;
    mask = smoothstep(edge + 0.12, edge - 0.12, n);
  }

  vec3 a = sampleFit(texA, fitA, qa);
  vec3 b = sampleFit(texB, fitB, qb);
  vec3 col = mix(a, b, mask);

  if (mono > 0.5) {
    float g = luma(col);
    g = smoothstep(0.02, 0.98, g);          // push toward silver-gelatin contrast
    col = vec3(g);
  }
  col += (hash(uv * 900.0 + fract(time) * 50.0) - 0.5) * grain;
  float vig = smoothstep(1.1, 0.35, distance(uv, vec2(0.5)));
  gl_FragColor = vec4(col * mix(0.7, 1.0, vig), 1.0);
}`;

export const MODES = { liquid: 0, swirl: 1, luma: 2, shatter: 3 };

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

export class Morph {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error('WebGL is not available in this browser.');
    this.gl = gl;
    this.program = this.#link(VERT, FRAG);
    gl.useProgram(this.program);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.program, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.u = {};
    for (const name of ['texA', 'texB', 'fitA', 'fitB', 'progress', 'time', 'strength', 'mono', 'grain', 'mode']) {
      this.u[name] = gl.getUniformLocation(this.program, name);
    }
    gl.uniform1i(this.u.texA, 0);
    gl.uniform1i(this.u.texB, 1);

    this.frames = [];   // { bitmap, texture }
    this.settings = { mode: 'liquid', strength: 0.6, mono: true, grain: 0.06, hold: 0.8, morph: 2.2, loop: true };
  }

  #link(vs, fs) {
    const gl = this.gl;
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
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

  addFrame(bitmap) {
    this.frames.push({ bitmap, texture: this.#texture(bitmap) });
  }

  removeFrame(i) {
    const [f] = this.frames.splice(i, 1);
    if (!f) return;
    this.gl.deleteTexture(f.texture);
    f.bitmap.close?.();
  }

  moveFrame(from, to) {
    const [f] = this.frames.splice(from, 1);
    this.frames.splice(to, 0, f);
  }

  /** Seconds for one full pass through every frame. */
  get duration() {
    const n = this.frames.length;
    if (n < 2) return 0;
    const segments = this.settings.loop ? n : n - 1;
    return segments * (this.settings.hold + this.settings.morph) + (this.settings.loop ? 0 : this.settings.hold);
  }

  /** Map a timeline position to (fromIndex, toIndex, progress). */
  locate(t) {
    const n = this.frames.length;
    const { hold, morph, loop } = this.settings;
    const seg = hold + morph;
    const segments = loop ? n : n - 1;
    let i = Math.floor(t / seg);
    if (i >= segments) return { a: loop ? 0 : n - 1, b: loop ? 0 : n - 1, p: 0 };
    const local = t - i * seg;
    const p = local < hold ? 0 : (local - hold) / morph;
    const ease = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    return { a: i, b: (i + 1) % n, p: ease };
  }

  #fit(bitmap) {
    const cw = this.canvas.width, ch = this.canvas.height;
    const ia = bitmap.width / bitmap.height, ca = cw / ch;
    return ia > ca ? [ca / ia, 1, 0, 0] : [1, ia / ca, 0, 0];
  }

  render(t) {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    if (this.frames.length === 0) {
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }
    const { a, b, p } = this.frames.length === 1 ? { a: 0, b: 0, p: 0 } : this.locate(t);
    const A = this.frames[a], B = this.frames[b];
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, A.texture);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, B.texture);
    gl.uniform4fv(this.u.fitA, this.#fit(A.bitmap));
    gl.uniform4fv(this.u.fitB, this.#fit(B.bitmap));
    gl.uniform1f(this.u.progress, p);
    gl.uniform1f(this.u.time, t);
    gl.uniform1f(this.u.strength, this.settings.strength);
    gl.uniform1f(this.u.mono, this.settings.mono ? 1 : 0);
    gl.uniform1f(this.u.grain, this.settings.grain);
    gl.uniform1i(this.u.mode, MODES[this.settings.mode] ?? 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
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
