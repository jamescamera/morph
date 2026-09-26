# MORPH

A black-and-white website and in-browser app for making morphing videos. Drop in a few stills and Morph melts each one into the next with a WebGL shader, then exports the result as MP4 or WebM. Everything runs on the client, so nothing is uploaded.

## Run

```sh
node server.mjs          # → http://localhost:5173
```

There are no dependencies and no build step. It's plain HTML, CSS and ES modules (`.mjs`). Any static host works too, for example GitHub Pages, Netlify or `python3 -m http.server`.

## Structure

| Path | What |
| --- | --- |
| `index.html` | Landing page with the studio embedded |
| `src/morph.mjs` | Morph engine: WebGL shader (liquid / swirl / luma / shatter), timeline, and recorder |
| `src/app.mjs` | Studio UI: frame list, drag-to-reorder, controls, export |
| `src/styles.css` | Monochrome design |
| `server.mjs` | Zero-dependency static server with range requests for video |
| `assets/` | Hero video (grayscale) and the demo frames |

## Studio controls

- **Frames**: drop or browse for images. Drag thumbnails to reorder and hover to remove one.
- **Style**: Liquid (ink in water), Swirl (a drain twist), Luma (highlights go first), Shatter (shards).
- **Intensity / Morph / Hold / Grain**: how far the warp reaches, how long each transition lasts, how long each still holds, and film grain.
- **Black & white** toggle, **Loop** back to the first frame, and aspect ratio **1:1 · 9:16 · 16:9**.
- **Export** records the timeline in real time using `MediaRecorder`. It writes MP4 where the browser supports it and WebM otherwise.
