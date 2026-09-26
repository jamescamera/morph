import { Morph, loadImage, record, recorderMime } from './morph.mjs';

const $ = (sel) => document.querySelector(sel);
const DEMO_DIR = 'assets/faces/';
const ASPECTS = { '1:1': [1080, 1080], '9:16': [1080, 1920], '16:9': [1920, 1080] };
const HINTS = {
  face: 'Matches eyes, nose, mouth and jaw, then warps one face into the next.',
  liquid: 'Ink in water: for images without faces.',
  swirl: 'Twists the center open and pulls the next frame through.',
  luma: 'Highlights change first, shadows last.',
  shatter: 'Cracks the frame into shards that flip one by one.',
};

function showError(msg) {
  const el = $('#error');
  el.textContent = msg;
  el.hidden = false;
}

/* ---------- players: one per canvas, paused while off screen ---------- */
class Player {
  constructor(canvas, settings = {}) {
    this.morph = new Morph(canvas);
    Object.assign(this.morph.settings, settings);
    this.clock = 0;
    this.playing = true;
    this.visible = true;
    new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; }).observe(canvas);
  }

  tick(dt) {
    if (!this.visible) return;
    const total = this.morph.duration;
    if (this.playing && total > 0) this.clock = (this.clock + dt) % total;
    this.morph.render(this.clock);
  }
}

let hero, studio;
try {
  hero = new Player($('#hero-canvas'), { hold: 0.35, morph: 1.5, grain: 0.05 });
  studio = new Player($('#stage'));
} catch (err) {
  showError(err.message);
}

let recording = false;
let last = performance.now();

function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  hero?.tick(dt);
  if (studio && !recording) {
    studio.tick(dt);
    if (studio.visible) syncTimeline();
  }
  requestAnimationFrame(loop);
}

/* ---------- studio timeline ---------- */
function syncTimeline() {
  const { morph, clock } = studio;
  const total = morph.duration;
  $('#scrub').value = total ? Math.round((clock / total) * 1000) : 0;
  $('#clock').textContent = `${clock.toFixed(1)} / ${total.toFixed(1)}s`;
  const { a, b, p } = morph.locate(clock);
  const active = p > 0.5 ? b : a;
  document.querySelectorAll('#frames li').forEach((li, i) => li.classList.toggle('active', i === active));
}

function setPlaying(on) {
  studio.playing = on;
  const btn = $('#play');
  btn.textContent = on ? '❚❚' : '▶';
  btn.setAttribute('aria-label', on ? 'Pause' : 'Play');
}

/* ---------- frames list ---------- */
function renderFrames() {
  const list = $('#frames');
  list.replaceChildren();
  studio.morph.frames.forEach(({ bitmap, face }, i) => {
    const li = document.createElement('li');
    li.draggable = true;
    li.dataset.index = i;

    const thumb = document.createElement('canvas');
    const side = 140;
    thumb.width = thumb.height = side;
    const s = Math.max(side / bitmap.width, side / bitmap.height);
    thumb.getContext('2d').drawImage(bitmap, (side - bitmap.width * s) / 2, (side - bitmap.height * s) / 2, bitmap.width * s, bitmap.height * s);

    const del = document.createElement('button');
    del.textContent = '✕';
    del.setAttribute('aria-label', `Remove frame ${i + 1}`);
    del.addEventListener('click', () => {
      studio.morph.removeFrame(i);
      studio.clock = 0;
      renderFrames();
    });

    const idx = document.createElement('span');
    idx.className = 'idx';
    idx.textContent = String(i + 1).padStart(2, '0');
    li.append(thumb, del, idx);

    if (!face) {
      const tag = document.createElement('span');
      tag.className = 'noface';
      tag.textContent = 'melt';
      tag.title = 'No face found: this frame melts instead of morphing';
      li.append(tag);
    }
    list.append(li);
  });
  $('#frame-count').textContent = studio.morph.frames.length;
  $('#export').disabled = studio.morph.frames.length < 2;
}

async function addFiles(files) {
  const images = [...files].filter((f) => f.type.startsWith('image/'));
  if (!images.length) return;
  const label = $('#drop-text');
  const { detectFace } = await import('./faces.mjs');
  for (const [k, file] of images.entries()) {
    label.textContent = `Finding face ${k + 1} of ${images.length}…`;
    try {
      const bitmap = await loadImage(file);
      const face = await detectFace(bitmap).catch((err) => {
        console.warn('Face detection unavailable:', err);
        return null;
      });
      studio.morph.addFrame(bitmap, face);
      renderFrames();
    } catch {
      showError(`Couldn't read ${file.name}.`);
    }
  }
  label.innerHTML = 'Drop portraits or <u>browse</u>';
}

/* ---------- controls ---------- */
function bindSlider(id, key, format) {
  const input = $(`#${id}`);
  const out = input.nextElementSibling;
  const update = () => {
    studio.morph.settings[key] = Number(input.value);
    out.textContent = format(Number(input.value));
    studio.clock = Math.min(studio.clock, Math.max(0, studio.morph.duration - 0.001));
  };
  input.addEventListener('input', update);
  update();
}

function bindSegmented(id, attr, onPick) {
  const group = $(`#${id}`);
  group.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    group.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    onPick(btn.dataset[attr]);
  });
}

function setMode(mode) {
  studio.morph.settings.mode = mode;
  $('#mode-hint').textContent = HINTS[mode];
  $('#strength-row').classList.toggle('is-off', mode === 'face');
  $('#wire').closest('label').classList.toggle('is-off', mode !== 'face');
}

function bindControls() {
  $('#play').addEventListener('click', () => setPlaying(!studio.playing));
  $('#scrub').addEventListener('input', (e) => {
    setPlaying(false);
    studio.clock = (e.target.value / 1000) * studio.morph.duration;
  });
  document.addEventListener('visibilitychange', () => { last = performance.now(); });

  bindSlider('strength', 'strength', (v) => v.toFixed(2));
  bindSlider('morph', 'morph', (v) => `${v.toFixed(1)}s`);
  bindSlider('hold', 'hold', (v) => `${v.toFixed(1)}s`);
  bindSlider('grain', 'grain', (v) => v.toFixed(2));
  bindSegmented('mode', 'mode', setMode);
  bindSegmented('aspect', 'aspect', (a) => { [$('#stage').width, $('#stage').height] = ASPECTS[a]; });
  $('#mono').addEventListener('change', (e) => { studio.morph.settings.mono = e.target.checked; });
  $('#wire').addEventListener('change', (e) => { studio.morph.settings.wire = e.target.checked; });
  $('#loop').addEventListener('change', (e) => {
    studio.morph.settings.loop = e.target.checked;
    studio.clock = 0;
  });
  $('#clear').addEventListener('click', () => {
    while (studio.morph.frames.length) studio.morph.removeFrame(0);
    studio.clock = 0;
    renderFrames();
  });

  // Drag thumbnails to reorder.
  let dragFrom = null;
  const list = $('#frames');
  list.addEventListener('dragstart', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    dragFrom = Number(li.dataset.index);
    li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  list.addEventListener('dragover', (e) => { if (dragFrom !== null) e.preventDefault(); });
  list.addEventListener('drop', (e) => {
    const li = e.target.closest('li');
    if (dragFrom === null || !li) return;
    e.preventDefault();
    studio.morph.moveFrame(dragFrom, Number(li.dataset.index));
    dragFrom = null;
    renderFrames();
  });
  list.addEventListener('dragend', () => {
    dragFrom = null;
    list.querySelectorAll('li').forEach((li) => li.classList.remove('dragging'));
  });

  // Add images from the picker or by dropping files.
  const drop = $('#drop');
  $('#file').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  for (const type of ['dragenter', 'dragover']) {
    drop.addEventListener(type, (e) => {
      if (!e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      drop.classList.add('over');
    });
  }
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    addFiles(e.dataTransfer.files);
  });

  // Export.
  $('#export').addEventListener('click', async () => {
    const btn = $('#export');
    const link = $('#download');
    if (!recorderMime()) return showError('This browser cannot record video. Try Chrome, Edge, Firefox or Safari 14.1+.');
    recording = true;
    btn.disabled = true;
    link.hidden = true;
    try {
      const blob = await record(studio.morph, {
        onProgress: (p) => {
          btn.textContent = `Recording… ${Math.round(p * 100)}%`;
          studio.clock = p * studio.morph.duration;
          syncTimeline();
        },
      });
      const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
      if (link.href) URL.revokeObjectURL(link.href);
      link.href = URL.createObjectURL(blob);
      link.download = `morph-${Date.now()}.${ext}`;
      link.textContent = `Download .${ext} (${(blob.size / 1e6).toFixed(1)} MB) ↓`;
      link.hidden = false;
      link.click();
    } catch (err) {
      showError(err.message ?? String(err));
    } finally {
      recording = false;
      btn.disabled = studio.morph.frames.length < 2;
      btn.textContent = 'Export video';
      studio.clock = 0;
      last = performance.now();
    }
  });
}

/* ---------- boot: demo portraits with precomputed landmarks ---------- */
async function loadDemo() {
  const landmarks = await (await fetch(`${DEMO_DIR}landmarks.json`)).json();
  const names = Object.keys(landmarks);
  const bitmaps = await Promise.all(names.map((n) => loadImage(DEMO_DIR + n)));
  names.forEach((n, i) => {
    const face = landmarks[n] && Float32Array.from(landmarks[n]);
    hero.morph.addFrame(bitmaps[i], face);
    studio.morph.addFrame(bitmaps[i], face);
  });
  renderFrames();
}

if (hero && studio) {
  bindControls();
  setMode('face');
  loadDemo().catch((err) => showError(`Couldn't load the demo faces: ${err.message}`));
  requestAnimationFrame(loop);
}
