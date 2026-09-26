// Face landmarks and the geometry that turns them into a morph mesh.
// Detection runs MediaPipe's Face Landmarker (478 points) in the browser; it is
// only loaded when someone adds their own photo.

const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

// Outline of the face, in order around the jaw and forehead.
const OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377,
  152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
// Rings pushed out from the face outline so hair, ears and shoulders travel with the head.
const RINGS = [1.35, 1.8, 2.5];
const BORDER_STEPS = 6;

let landmarker;

async function createLandmarker(delegate) {
  const { FaceLandmarker, FilesetResolver } = await import(`${MP}/vision_bundle.mjs`);
  const fileset = await FilesetResolver.forVisionTasks(`${MP}/wasm`);
  return FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL, delegate },
    runningMode: 'IMAGE',
    numFaces: 1,
  });
}

function getLandmarker() {
  landmarker ??= createLandmarker('GPU').catch(() => createLandmarker('CPU'));
  return landmarker;
}

/** Returns a Float32Array of [x0, y0, x1, y1, …] normalized to the image, or null. */
export async function detectFace(bitmap) {
  const lm = await getLandmarker();
  const face = lm.detect(bitmap).faceLandmarks?.[0];
  if (!face) return null;
  return Float32Array.from(face.flatMap((p) => [p.x, p.y]));
}

function eyes(face, iw, ih) {
  const pt = (i) => [face[2 * i] * iw, face[2 * i + 1] * ih];
  const avg = (i, j) => { const a = pt(i), b = pt(j); return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; };
  // Iris centers when the model provides them (478 points), otherwise eye corners.
  const [p, q] = face.length >= 478 * 2 ? [pt(468), pt(473)] : [avg(33, 133), avg(362, 263)];
  return p[0] < q[0] ? [p, q] : [q, p];
}

/**
 * Similarity transform that puts the eyes on a fixed line in the canvas, so every
 * face lands in the same spot, like a line-up of portraits shot on one set.
 */
export function alignment(face, iw, ih, W, H) {
  const [[ax, ay], [bx, by]] = eyes(face, iw, ih);
  const s = (0.23 * Math.min(W, H)) / Math.hypot(bx - ax, by - ay);
  const ang = -Math.atan2(by - ay, bx - ax);
  const a = Math.cos(ang) * s, c = Math.sin(ang) * s;
  const m = { a, b: -c, c, d: a, mx: (ax + bx) / 2, my: (ay + by) / 2, tx: W / 2, ty: H * 0.42 };
  m.forward = (x, y) => [m.a * (x - m.mx) + m.b * (y - m.my) + m.tx, m.c * (x - m.mx) + m.d * (y - m.my) + m.ty];
  m.inverse = (X, Y) => {
    const dx = X - m.tx, dy = Y - m.ty, det = m.a * m.d - m.b * m.c;
    return [m.mx + (m.d * dx - m.b * dy) / det, m.my + (-m.c * dx + m.a * dy) / det];
  };
  return m;
}

/** Landmarks plus the extrapolated head rings, in image pixels. */
function controlPoints(face, iw, ih) {
  const pts = [];
  for (let i = 0; i < face.length; i += 2) pts.push([face[i] * iw, face[i + 1] * ih]);
  let cx = 0, cy = 0;
  for (const i of OVAL) { cx += pts[i][0]; cy += pts[i][1]; }
  cx /= OVAL.length; cy /= OVAL.length;
  for (const k of RINGS) {
    for (const i of OVAL) pts.push([cx + (pts[i][0] - cx) * k, cy + (pts[i][1] - cy) * k]);
  }
  return pts;
}

function borderPoints() {
  const out = [];
  for (let i = 0; i < BORDER_STEPS; i++) {
    const t = i / BORDER_STEPS;
    out.push([t, 0], [1, t], [1 - t, 1], [0, 1 - t]);
  }
  return out;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Build the morph mesh between two faces for a W×H canvas.
 * Each vertex carries its canvas position in A and in B plus where to sample each image,
 * so the GPU only has to interpolate positions and blend.
 * Returns { vertices: Float32Array (pa.xy, pb.xy, ua.xy, ub.xy), triangles, edges }.
 */
export function buildMesh(Delaunator, A, B, W, H) {
  const sideA = { m: alignment(A.face, A.width, A.height, W, H), pts: controlPoints(A.face, A.width, A.height), w: A.width, h: A.height };
  const sideB = { m: alignment(B.face, B.width, B.height, W, H), pts: controlPoints(B.face, B.width, B.height), w: B.width, h: B.height };
  const n = Math.min(sideA.pts.length, sideB.pts.length);
  const border = borderPoints();
  const total = n + border.length;
  const verts = new Float32Array(total * 8);
  const mid = new Float64Array(total * 2);

  for (let i = 0; i < n; i++) {
    const [ax, ay] = sideA.m.forward(...sideA.pts[i]);
    const [bx, by] = sideB.m.forward(...sideB.pts[i]);
    const o = i * 8;
    verts[o] = clamp(ax / W, -0.25, 1.25); verts[o + 1] = clamp(ay / H, -0.25, 1.25);
    verts[o + 2] = clamp(bx / W, -0.25, 1.25); verts[o + 3] = clamp(by / H, -0.25, 1.25);
    verts[o + 4] = sideA.pts[i][0] / sideA.w; verts[o + 5] = sideA.pts[i][1] / sideA.h;
    verts[o + 6] = sideB.pts[i][0] / sideB.w; verts[o + 7] = sideB.pts[i][1] / sideB.h;
  }
  border.forEach(([x, y], k) => {
    const i = n + k, o = i * 8;
    const [ux, uy] = sideA.m.inverse(x * W, y * H);
    const [vx, vy] = sideB.m.inverse(x * W, y * H);
    verts.set([x, y, x, y, ux / sideA.w, uy / sideA.h, vx / sideB.w, vy / sideB.h], o);
  });
  for (let i = 0; i < total; i++) {
    mid[2 * i] = ((verts[i * 8] + verts[i * 8 + 2]) / 2) * W;
    mid[2 * i + 1] = ((verts[i * 8 + 1] + verts[i * 8 + 3]) / 2) * H;
  }

  const triangles = Uint16Array.from(new Delaunator(mid).triangles);
  const seen = new Set();
  const edges = [];
  for (let t = 0; t < triangles.length; t += 3) {
    for (const [p, q] of [[0, 1], [1, 2], [2, 0]]) {
      const i = triangles[t + p], j = triangles[t + q];
      const key = i < j ? i * 65536 + j : j * 65536 + i;
      if (!seen.has(key)) { seen.add(key); edges.push(i, j); }
    }
  }
  return { vertices: verts, triangles, edges: Uint16Array.from(edges) };
}
