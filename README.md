# MORPH

A black-and-white face-morphing site and in-browser studio, a tribute to the face-morph sequence in the 1991 "Black or White" video. Line up portraits and Morph finds 478 landmarks on each face (MediaPipe, on-device), aligns them by the eyes, triangulates a mesh, and warps plus cross-dissolves one face into the next in WebGL. Export the result as MP4 or WebM. Nothing is uploaded.

Live: https://jamescamera.github.io/morph/

## Run

```sh
node server.mjs          # → http://localhost:5173
```

There are no dependencies and no build step. It's plain HTML, CSS and ES modules (`.mjs`). Any static host works too, for example GitHub Pages, Netlify or `python3 -m http.server`.

## Structure

| Path | What |
| --- | --- |
| `index.html` | Landing page with the studio embedded |
| `src/morph.mjs` | Morph engine: face-mesh warp + dissolve, noise melts (liquid / swirl / luma / shatter), timeline, recorder |
| `src/faces.mjs` | Face landmark detection (MediaPipe, loaded on demand), eye alignment, mesh triangulation |
| `src/app.mjs` | Studio UI: frame list, drag-to-reorder, controls, export |
| `src/styles.css` | Monochrome design |
| `server.mjs` | Zero-dependency static server with range requests for video |
| `assets/faces/` | Demo portraits ([Unsplash License](https://unsplash.com/license)) and their precomputed landmarks |
| `assets/hero.mp4` | Grayscale room video used to showcase the melt styles |

## Studio controls

- **Faces**: drop or browse for portraits. Drag thumbnails to reorder and hover to remove one. Images without a detectable face get a "melt" tag and use a melt style for their transitions.
- **Style**: Face (landmark morph), or Liquid, Swirl, Luma and Shatter for images without faces.
- **Morph / Hold / Grain / Intensity**: transition length, how long each face holds, film grain, and warp strength for the melt styles.
- **Black & white**, **Show mesh** (overlays the morph triangulation), **Loop**, and aspect ratio **1:1 · 9:16 · 16:9**.
- **Export** records the timeline in real time using `MediaRecorder`. It writes MP4 where the browser supports it and WebM otherwise.
