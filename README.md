# Fadi Lab

A static, tabbed creative-tools hub. Pure static site (HTML + CSS + vanilla JS),
deployed on Vercel. Add a new tool = add a tab + a `*.js` module.

## Tabs

### 1 · Animation Review

Rate, trash, and comment on the 100 Fadi overlay animations (built with the
`fadishoot-overlays` kit + a Claude agent swarm).

- **Grid** + **Focus** (one-at-a-time) views; every clip loops.
- 5-star ratings, 🗑 trash, per-item comments.
- Auto-hides what you've reviewed (default "To review" filter).
- Filter by stars / category / commented, sort, search.
- **Ratings persist in your browser** (localStorage). Use **⬇ Export** to download
  `ratings.json` and **⬆ Import** to load one — hand the JSON back to Claude to
  prune the trashed/low-star ones and apply your comments.
- Focus keys: `1`–`5` rate · `0` clear · `T` trash · `←/→` navigate (auto-advances).

Data lives in `catalog.json`; clips in `clips/`.

### 2 · Composition Lab

Live full-frame composition playground for the FadiFiles shoot clips — mirror,
squeeze-duplicate, 180° flip pairs, water reflection, triptych, quad grid,
kaleidoscope, and matte silhouette comps.

- **Load a clip** (file picker or drag-drop). Browser-playable mp4/webm — use the
  `_previews/*.mp4` versions of the Cinema Cam clips, not the ProRes `.mov`.
- **+ Matte** (optional): load the RVM grayscale matte for clean silhouette comps.
  Without one, silhouette presets fall back to a corner chroma-key (tune _auto-key tol_).
- Pick a preset, tweak params (aspect, fit, zoom/shift, per-preset controls), scrub/play.
- **Every geometric preset emits the exact ffmpeg filtergraph** (`copy` / `save .json`)
  so a winning comp drops straight into `render_song.py` on the cut/fx layer.
  Silhouette comps map to the pipeline's matte `states` vocabulary (`me_on_white`,
  `white_me_rainbow_bg`, `echo_offset`, …) — generate `matte.mov` with `make_matte.py`.
- **⤓ PNG** saves a frame; **● REC** records the canvas to webm (use this for
  canvas-only presets like Kaleidoscope that have no native ffmpeg filter).

Module: `complab.js`. Add new presets to the `PRESETS` array.

### 3 · Micrographics · soon

Stubbed tab for the next tool.

## Files

- `index.html` — shell + tab router + per-tab markup
- `styles.css` — shared shell + per-tab styles
- `review.js` — Animation Review tab
- `complab.js` — Composition Lab tab
