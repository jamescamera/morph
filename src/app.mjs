import { Morph, loadImage, record, recorderMime } from './morph.mjs';

const $ = (sel) => document.querySelector(sel);
const DEMO = [1, 2, 3, 4].map((i) => `assets/demo/frame-${i}.jpg`);
const ASPECTS = { '1:1': [1080, 1080], '9:16': [1080, 1920], '16:9': [1920, 1080] };

const canvas = $('#stage');
let morph;
try {
  morph = new Morph(canvas);
} catch (err) {
  showError(err.message);
}

let clock = 0;          // timeline position in seconds
let playing = true;
let recording = false;
let last = performance.now();

function showError(msg) {
  const el = $('#error');
  el.textContent = msg;
  el.hidden = false;
}

/* ---------- playback loop ---------- */
function frame(now) {
  const dt = (now - last) / 1000;
  last = now;
  if (morph && !recording) {
    const total = morph.duration;
    if (playing && total > 0) clock = (clock + dt) % total;
    morph.render(clock);
    syncTimeline();
  }
  requestAnimationFrame(frame);
}

function syncTimeline() {
  const total = morph.duration;
  $('#scrub').value = total ? Math.round((clock / total) * 1000) : 0;
  $('#clock').textContent = `${clock.toFixed(1)} / ${total.toFixed(1)}s`;
  const current = morph.frames.length > 1 ? morph.locate(clock) : { a: 0, p: 0 };
  const active = current.p > 0.5 ? current.b : current.a;
  document.querySelectorAll('#frames li').forEach((li, i) => li.classList.toggle('active', i === active));
}

function setPlaying(on) {
  playing = on;
  const btn = $('#play');
  btn.textContent = on ? '❚❚' : '▶';
  btn.setAttribute('aria-label', on ? 'Pause' : 'Play');
}

$('#play').addEventListener('click', () => setPlaying(!playing));
$('#scrub').addEventListener('input', (e) => {
  setPlaying(false);
  clock = (e.target.value / 1000) * morph.duration;
});
document.addEventListener('visibilitychange', () => { last = performance.now(); });

/* ---------- frames list ---------- */
function renderFrames() {
  const list = $('#frames');
  list.replaceChildren();
  morph.frames.forEach(({ bitmap }, i) => {
    const li = document.createElement('li');
    li.draggable = true;
    li.dataset.index = i;

    const thumb = document.createElement('canvas');
    const side = 160;
    thumb.width = thumb.height = side;
    const s = Math.max(side / bitmap.width, side / bitmap.height);
    thumb.getContext('2d').drawImage(bitmap, (side - bitmap.width * s) / 2, (side - bitmap.height * s) / 2, bitmap.width * s, bitmap.height * s);

    const del = document.createElement('button');
    del.textContent = '✕';
    del.setAttribute('aria-label', `Remove frame ${i + 1}`);
    del.addEventListener('click', () => {
      morph.removeFrame(i);
      clock = 0;
      renderFrames();
    });

    const idx = document.createElement('span');
    idx.className = 'idx';
    idx.textContent = String(i + 1).padStart(2, '0');

    li.append(thumb, del, idx);
    list.append(li);
  });
  $('#frame-count').textContent = morph.frames.length;
  $('#export').disabled = morph.frames.length < 2;
}

let dragFrom = null;
$('#frames').addEventListener('dragstart', (e) => {
  const li = e.target.closest('li');
  if (!li) return;
  dragFrom = Number(li.dataset.index);
  li.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
});
$('#frames').addEventListener('dragover', (e) => { if (dragFrom !== null) e.preventDefault(); });
$('#frames').addEventListener('drop', (e) => {
  const li = e.target.closest('li');
  if (dragFrom === null || !li) return;
  e.preventDefault();
  morph.moveFrame(dragFrom, Number(li.dataset.index));
  dragFrom = null;
  renderFrames();
});
$('#frames').addEventListener('dragend', () => {
  dragFrom = null;
  document.querySelectorAll('#frames li').forEach((li) => li.classList.remove('dragging'));
});

async function addFiles(files) {
  const images = [...files].filter((f) => f.type.startsWith('image/'));
  for (const file of images) {
    try {
      morph.addFrame(await loadImage(file));
    } catch {
      showError(`Couldn't read ${file.name}.`);
    }
  }
  renderFrames();
}

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

/* ---------- controls ---------- */
function bindSlider(id, key, format) {
  const input = $(`#${id}`);
  const out = input.nextElementSibling;
  const update = () => {
    morph.settings[key] = Number(input.value);
    out.textContent = format(Number(input.value));
    clock = Math.min(clock, Math.max(0, morph.duration - 0.001));
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

if (morph) {
  bindSlider('strength', 'strength', (v) => v.toFixed(2));
  bindSlider('morph', 'morph', (v) => `${v.toFixed(1)}s`);
  bindSlider('hold', 'hold', (v) => `${v.toFixed(1)}s`);
  bindSlider('grain', 'grain', (v) => v.toFixed(2));
  bindSegmented('mode', 'mode', (mode) => { morph.settings.mode = mode; });
  bindSegmented('aspect', 'aspect', (a) => { [canvas.width, canvas.height] = ASPECTS[a]; });
  $('#mono').addEventListener('change', (e) => { morph.settings.mono = e.target.checked; });
  $('#loop').addEventListener('change', (e) => {
    morph.settings.loop = e.target.checked;
    clock = 0;
  });

  /* ---------- export ---------- */
  $('#export').addEventListener('click', async () => {
    const btn = $('#export');
    const link = $('#download');
    if (!recorderMime()) return showError('This browser cannot record video. Try Chrome, Edge, Firefox or Safari 14.1+.');
    recording = true;
    btn.disabled = true;
    link.hidden = true;
    try {
      const blob = await record(morph, {
        onProgress: (p) => {
          btn.textContent = `Recording… ${Math.round(p * 100)}%`;
          clock = p * morph.duration;
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
      btn.disabled = morph.frames.length < 2;
      btn.textContent = 'Export video';
      clock = 0;
      last = performance.now();
    }
  });

  /* ---------- boot with demo frames ---------- */
  Promise.all(DEMO.map(loadImage))
    .then((bitmaps) => { bitmaps.forEach((b) => morph.addFrame(b)); renderFrames(); })
    .catch(() => renderFrames());
  requestAnimationFrame(frame);
}
