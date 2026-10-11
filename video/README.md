# NEO//KYOTO — social video

A 53.6 s, 1920×1080 60 fps cut for X/Twitter: a 7.6 s retention hook plus a 46 s body. Every
shot is a separate clip script, so you can change, re-render and re-approve one part without
touching the others.

```bash
cd video && npm i                       # puppeteer-core (uses your installed Chrome)
node lib/render.mjs 03_chase            # one clip  -> out/03_chase.mp4
node lib/render.mjs 03_chase --preview  # 960x540 30 fps draft, fast
node lib/render.mjs 03_chase --stills --every 0.5   # JPEG every 0.5 s -> out/03_chase_stills/
sh lib/sheet.sh 03_chase                # contact sheet of those stills
node lib/master.mjs                     # composite + concat -> out/00_split.mp4, hook.mp4, body.mp4, neo-kyoto.mp4
node lib/master.mjs --render            # re-render everything first (~40 min on the iGPU)
node lib/master.mjs --music track.mp3   # put a soundtrack under the full cut
```

## Timeline

| | clip | time | what |
|---|---|---|---|
| hook | `00a_seeds_panel` + `00b_dive` → `00_split` | 0.00–4.60 | split screen: left, **ONE SLIDER. A NEW CITY.** (the Seed slider regenerates 6 cities in 3.3 s); right, the dive onto the grid (**THIS CITY NEVER ENDS**), lens-shifted into the right half. At 3.5–4.0 s the panel slides out on its neon edge while the dive's lens glides back to centre as the camera pulls out behind the car. `master.mjs` composites the two with ffmpeg on the same curve as `K.SPLIT` |
| hook | `01b_flyby` | 4.60–5.85 | parked camera in the canyon, the car screams past · **ZERO BUILDINGS MODELED BY HAND** |
| hook | `01c_blender` | 5.85–7.60 | real Blender UI, Seed slider ticking and the GN city regenerating → punch into the viewport → neon wipe to the browser render of the same camera and seed, now endless · **BUILT IN BLENDER → RUNS LIVE IN YOUR BROWSER** |
| body | `02_title` | 5 s | high drone chase, 新京都 / NEO//KYOTO lockup |
| body | `03_chase` | 10 s | chase / low / head-on / side shots, flight HUD, 4 feature captions |
| body | `04_cockpit` | 8 s | driver's-eye cockpit, look out of the window, VR pitch |
| (off) | `05_seeds` | 9 s | full-screen seed regeneration; left out of `BODY` in master.mjs since the opening covers it |
| body | `06_holo` | 8 s | giant dancing robot hologram, then a high glide among koi/whales/fox |
| body | `07_scale` | 9 s | lets go of the car, rises to 1.1 km over the infinite grid, live stats |
| body | `08_outro` | 6 s | logo, stack, call to action, dip to black |

`01a_dive` is the older 2 s full-screen dive, kept for reference (not in the cut).

## How it renders

`lib/render.mjs` starts a private Vite server (no HMR, so edits in the repo can't reload the
page mid-render), opens the app in headless Chrome on WebGPU, and installs a **virtual clock**
(`performance.now`, seeded `Math.random`). It then steps the real app one frame at a time:
shaders, traffic, rain and hologram animation all advance exactly 1/60 s per frame, and video
textures are seeked to the virtual time. The full post stack renders at 1.5× (2880×1620) and
the page downsamples it to 1080p. The 2D overlay is painted on top, and each frame is piped to
ffmpeg (x264 CRF 15). GPU speed only affects how long a render takes. The output is identical
on every run.

A clip is one `window.CLIP = { … }` file in `clips/`:

* `setup(app, K)`: once (look, city radius, camera mode)
* `frame(app, t, K)`: before each simulation step (boost, seed changes, director shots)
* `camera(app, t, K)`: after the car moved, before the render (no lag between car and camera)
* `overlay(g, t, K)`: Canvas 2D on top, in 1920×1080 coordinates

`lib/kit.js` (`K`) holds the camera rigs (`K.path(ds)` = a point on the autopilot's street
centreline, so cameras can't clip buildings) and the overlay style. It draws only with the
project's fonts and palette (Orbitron, Rajdhani, Noto Sans JP, cyan → magenta): `headline`
(RGB-split slam with glitch slices), `kicker` (type-on), `jpVertical`, `rule`, `frame`
(viewfinder corners + the NEO//KYOTO bug), `hud`, `readout`, `glitch`, `flash`,
`speedLines`.

## Blender footage

`blender/capture_ui.py` drives the real Blender UI (it opens a window for about a minute):

```bash
"C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --window-geometry 0 0 1920 1080 \
  blender/cybercity.blend --python video/blender/capture_ui.py -- video/assets/blender
```

It opens the Geometry Nodes workspace on `CC_City` with a rendered EEVEE viewport through an
aerial camera. It steps the Seed slider (7 → 21 → 33 → 58 → 90 → 7) and screenshots the
window after each regeneration. Then it maximises the viewport and writes `cam.json` with the
camera frame's on-screen rect. `01c_blender` uses the same camera, converted from Z-up to
Y-up, so the wipe lines up building for building. The .blend is never saved.
