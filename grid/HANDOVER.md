# /grid — handover

State as of 2026-08-17. Live at https://freya.co.nz/grid

## 2026-08-17 — fit-check template (not yet deployed)

- **`GF.buildTemplate(opts)`** (core.js): the bin in plan at 0.2 mm thick with
  the pocket (outline + clearance + finger holes, all copies) cut clean through.
  Reuses `GF.pocketSolids` with zBot −1 / zTop t+1 / floorZ 0 so every cut is a
  through-cut and finger holes don't dive below a floor that isn't there.
- **UI**: a *Make* select (`bin-output`: full bin / fit-check template) in the
  Tool pocket fieldset on the Bin tab, so it only shows for pocket style.
  Generate builds whichever is selected; STL/STEP export it unchanged. File
  name becomes `gridfinity-tool-template-NxM`.
- Test case `tool_template` added to `test/export-parts.mjs`; 8/8 STEPs read
  back as single closed valid solids. `?v=` bumped to `20260817a`.

## Evening session — scan-tab quality pass (not yet deployed)

- **Trace quality**: after the crack-following contour, the line is resampled
  to 2 px, snapped to the sub-pixel zero crossing of a signed segmentation
  score (`V.refine` — undoes the shift the open/close clean-up introduces),
  then smoothed (`V.smooth`, radius driven by the *Follow the edge closely*
  slider). No more pixel staircase.
- **Drag-to-fix is now a push brush**: each pointermove nudges whatever is
  inside the brush *now* (sub-stepped so fast moves don't tunnel), so one
  stroke swept along the line redoes a whole edge. Touched points get one
  Laplacian relax and the polygon is re-spaced on release.
- **The dashed cut line is real**: outline ∪ clearance offset ∪ finger
  circles, rasterised and re-traced (`buildCutPreview`), exactly matching
  what `GF.pocketSolids` cuts. Rebuilt on trace/release/slider/finger events,
  never per-frame. Finger holes snap onto the outline when placed.
- **Straighten tool**: armed button in *Fix it by dragging*; click each end of
  a wobbly stretch and the shorter perimeter path between the clicks is
  replaced with an evenly spaced straight run. Blue marker + rubber-band show
  the pending first end; Esc or the button disarms; Undo covers it.
- `window.__S` exposes the app state as a test hook — drive the scan tab
  headlessly with synthetic PointerEvents + a DataTransfer drop (see this
  session for the recipe); screenshots still don't composite when the pane
  is hidden, but `sc-canvas.toDataURL()` gets you the rendered canvas.

## Run it

```bash
python -m http.server 8777 --bind 127.0.0.1     # from Freya/, then /grid/
npm run deploy                                  # deploys the whole site
```

**Before any deploy that touches `js/`, bump the `?v=` token on all five script
tags in `index.html`.** `index.html` is never cached but the JS is; a mismatch
silently breaks the page on first click. This has already happened once.

## Architecture

Five plain scripts, no build step, no framework:

| file | job |
|---|---|
| `js/core.js` | geometry. manifold-3d (WASM CSG). Lofts of rounded rects + booleans |
| `js/exporters.js` | binary STL, STEP AP214, ZIP. STEP merges coplanar triangles into real planar faces |
| `js/vision.js` | photo → outline. Otsu / colour segmentation, crack-following contour, RDP |
| `js/viewer.js` | three.js preview, hand-rolled orbit, crease-angle normals |
| `js/app.js` | all UI. ~800 lines and the messiest file |

Four tabs: Baseplate, Bin, Tool scan, Notes.

## Verify any geometry change

```bash
node test/export-parts.mjs                                   # runs the page's own code headlessly
../../.cad-venv/Scripts/python.exe test/check-step.py        # OCCT reads every STEP back
```
Currently 7/7 import as a single closed valid solid. `EX.checkShell(mesh)` is the
in-browser equivalent.

## Known rough edges

- **The Tool scan tab is overloaded.** Five fieldsets and four different things
  the same canvas pointer can do (set scale / drag a search box / reshape the
  outline / sample a colour / place a finger hole), two of them behind
  "armed" toggle buttons. This is the main thing that needs design work.
- **`app.js` has no structure.** One IIFE, module-scoped mutable `S`, event
  wiring interleaved with logic. Worth splitting per tab.
- **I never saw the scan tab rendered.** The browser pane stopped compositing
  screenshots partway through the session, so everything after the outline
  editing work was verified by measurement only, never by eye. Assume visual
  problems I could not see.
- **Mobile is untested** on the scan tab specifically.
- `bin-pclear` exists in two places — the Tool scan slider writes into the Bin
  tab's number field. Synced, but two controls for one value.
- The Notes tab prose was rewritten; the rest of the copy is older and
  inconsistent in tone.

## Traps that already bit us

1. **Cached JS vs fresh HTML** — see the `?v=` note above.
2. **Loft winding.** `GF.loft()` self-orients: a profile written top-down would
   otherwise produce an inverted solid that *adds* material when subtracted.
3. **The stacking-lip relief** must not be applied to solid or pocketed bins, or
   it scoops out the whole top surface.
4. **Crease normals.** manifold shares one vertex between all faces meeting at a
   point, so `computeVertexNormals()` shades a 90° corner as a curve (measured
   98.6° of deviation). `viewer.js` averages only across edges under 35°.
5. **Segmentation polarity** is decided by which blob does *not* touch the edge
   of the search area, not by background brightness.
6. Manifold sometimes emits coincident vertices with a zero-area sliver between
   them; `EX.toMesh` welds on the way out or the STEP stitcher breaks.

## Gridfinity numbers

Pitch 42, height unit 7, foot profile 0.8 + 1.8 + 2.15 = 4.75, bin 41.5 (r 3.75),
foot bottom 35.6 (r 0.8), socket clearance 0.25/side. Magnet-free by design — no
magnet or screw holes anywhere, deliberately.

Bin height = 7 × units for the body, lip on top, nests 4.75 → stack pitch is
exactly 7 × units. Other generators count the lip inside the module; the
*Height counts* toggle matches those.
