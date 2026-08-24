# The print pivot — freyacad becomes a 3D-printing tool

Written 24 August 2026, mid-pivot. This is the plan of record; HANDOVER.md still
holds the standing rules and the traps. The one-line brief from the owner:

> Rebrand freyacad as a 3D printing tool. Easy to use — default tools trimmed
> right back, more complex ones opt-in. Integrate /grid. Demos: an ESP32 +
> screen case, and a Gridfinity bin with a custom tool pocket.

## Positioning

**Design real parts for your printer, in the browser.** Nothing to install, no
account, works on an iPad. Underneath it is a genuine solid-modelling kernel —
the same one FreeCAD uses — so what you export is real geometry: watertight
3MF/STL for the slicer, true STEP for anyone who asks for "the CAD file".

That last sentence is the moat. Browser print-design tools are mesh toys or
code-CAD; desktop parametric CAD is a 2 GB install with a learning cliff. The
gap between Tinkercad and Fusion is real and this sits exactly in it: sketch →
pull → print, with dimensions that mean millimetres and exports the slicer
trusts. (A survey of the field is in this repo's history — 2026-08-24 session —
the short version: nobody else does client-side B-rep + parametric history +
no-account + tablet.)

On being bought or copied: the code is public and one Bambu engineer could lift
any of it in an afternoon — accept that and play the other game: ship the nicest
workflow, own the demos and the search traffic (/grid already ranks for
Gridfinity terms), and be the thing people link. **Decide a licence** — right
now there is none, which is "all rights reserved" by default and scares off
contributors without deterring a company at all. AGPL-3.0 is the usual answer
for "openly readable, commercially annoying to steal" (Chili3D and PartMode both
chose it). An acquirer buys the relicensing right. Owner's call; a LICENSE file
either way.

## The unit problem, fixed first (done in this session)

Until now `exportSTL` multiplied every coordinate by 10 while `exportSTEP`
exported raw — the same part left the app 140 mm in one file and 14 mm in the
other, and neither matched a stated policy. A tool whose whole story is "the
dimension you typed is the part you hold" cannot ship that. As of this pivot:

- **A dimension of 14 is 14 millimetres, in every export.** STL loses the ×10.
- **Exports are print-oriented**: the app's Y-up world maps to the printer's
  Z-up (x, y, z) → (x, −z, y), so a part built on the Top plane lands flat on
  the slicer's bed, the right way up.
- Anyone with an old STL printed at ×10 scale would have noticed; there are no
  known users of that path. The demos get remodelled at true size (a lantern
  25 mm tall is a keyring; make it 100 mm).

## Workstream 1 — the print pipeline

**Done this session:** the `Export STL` / `Export STEP` buttons become one
**Print / Export** button and a dialog:

- **3MF** — the headline format. New exporter (core 3MF: OPC zip + one model
  XML, `unit="millimeter"`, welded vertices, one object per body). It is what
  Bambu Studio, Orca and Prusa all prefer, and it carries units, so "it came in
  at the wrong size" ends.
- **STL** — universal fallback, now honest (above).
- **STEP** — unchanged, for the "send me the CAD" case.
- **Open Bambu Studio** — best-effort `bambustudio://` launch link beside the
  downloads, honestly labelled. The url-scheme can only *fetch a hosted URL*
  (that is how MakerWorld/Printables use it); a purely client-side file cannot
  be handed over directly, so v1 is download + launch.

**Next (opt-in, small server):** a Cloudflare Worker "shelf" — POST the 3MF,
get a 10-minute URL, launch `bambustudio://open?file=<url>` for true one-click.
They already run Cloudflare Pages, a Worker is in-family; make it opt-in per
click since it uploads the model. Also trivially covers Orca
(`orcaslicer://`) and Prusa (`prusaslicer://`). ~60k with tests.

**Later, if demand:** print-readiness hints (thin walls under nozzle width,
unsupported overhang shading at 45°, part bigger than a 256³ bed). Honest
geometry checks, not a slicer.

## Workstream 2 — simple by default

The menu system already supports layouts, hidden tools and localStorage
persistence (HANDOVER: "menu layouts record what you hid") — so this is mostly
configuration plus a first-run choice, not new machinery. ~80k.

- **Maker preset (the new default):** Sketch (line, rect, circle, dims, erase),
  Extrude, Cut, Fillet/Chamfer, Mirror, Gridfinity bin (workstream 3),
  Print/Export, Undo, Help. Everything else — revolve, sweep, patterns,
  splines, constraints, datum geometry, assemblies, drawings — exists but
  starts hidden.
- **Full preset:** everything, exactly today's layout.
- A visible "More tools…" affordance in the dock opens the existing Customise
  dialog scoped to "show me more", so growing out of Maker is one click, not a
  settings hunt. First run asks once: "Keep it simple / Show me everything".
- The manual grows a "Start printing" page ordered for the Maker set; the
  existing reference stays for Full.

## Workstream 3 — /grid inside freyacad

What /grid is today: a complete Gridfinity generator (bins, baseplates, the
authoritative 42/7/4.75 numbers in `grid/js/core.js`), STL/STEP exporters, and
— the crown jewel — a **Tool scan tab**: photo → segmentation → crack-following
outline → editable polygon → pocket. It builds meshes with manifold-3d CSG.

Integration is NOT "iframe /grid". Two pieces move in, one stays:

1. **Gridfinity bin as a native feature** (~150k). A `gfbin` feature type:
   panel takes units x·y·z, lip on/off, height-counts mode, scoop, and builds a
   real OCCT B-rep (the foot/lip profiles are lofts of rounded rects —
   `wireFromSegs` + `BRepOffsetAPI_ThruSections`; confirm the binding early,
   it is the one kernel risk). Port the numbers and the profile maths from
   `grid/js/core.js`; port the trap list too (lip relief must not apply to
   solid bins; loft winding). Baseplates second (`gfplate`). Why B-rep and not
   the existing manifold mesh: a mesh body cannot be filleted or cleanly cut
   in freyacad (HANDOVER trap 9), and *cutting the bin* is the whole demo.
   Verification: volumes against /grid's own STL for the same parameters
   (mesh-volume compare, trap 27 method), and /grid's `check-step.py` habit.
2. **Photo-trace into any sketch** (~120k). `grid/js/vision.js` is nearly
   standalone (402 lines, canvas-in, polygon-out). It becomes a lazy-loaded
   module shared by both apps; freyacad's sketch mode gains "Trace a photo…"
   which drops the traced outline in as a closed poly entity — then the normal
   tools take over: cut it into a gfbin floor (the pocket demo), or into any
   part. The scan UI gets rebuilt inside freyacad's idiom (the /grid handover
   itself says that tab is overloaded; don't copy the overload).
3. **/grid the site stays live.** It ranks and it works. It gains a banner —
   "now part of freyacad, with editable bins" — and freyacad gains
   `?gf=WxHxZ` style deep links so /grid can hand a configured bin over.
   Long-term the generator maths lives in one place (freyacad) and /grid
   becomes the landing page for the Gridfinity audience.

## Workstream 4 — the demos ARE the marketing

Replace the lantern/jet front door with two demos a printer-owner recognises,
both built with the Maker toolset only, both saved as walk-through-able trees:

1. **ESP32 + display case** (~60k once parts are measured). Parametric: board
   length/width/hole grid, display window, USB-C slot, lid. The owner is about
   to build exactly this for real hardware — build it WITH them: get the board
   model + display model measurements (or calipers), model it at true size,
   print it, iterate. The demo that fits real hardware is the proof the tool
   works; document the reveal (case fits on first print or what was wrong).
2. **Gridfinity bin + scanned tool pocket** (~40k, after workstreams 3.1/3.2).
   Open a bin, trace a real tool, cut the pocket, print. This is /grid's
   killer feature upgraded with editability.

The lantern and jet engine move behind "More demos" — they showcase the kernel,
just not to this audience.

## Workstream 5 — iPad, properly

Owner verdict on the first pass: "going to need a lot more work". The gesture
layer and autosave shipped, but nothing has been tuned on real glass. This
workstream is fed by hands-on sessions with the owner's iPad:

- A written test script the owner runs on-device (orbit/pinch/long-press/draw/
  dimension/panel/export), findings filed as they come.
- Known-suspect list before anyone even tests: number-input focus and the
  on-screen keyboard covering panels; dock button sizing at --ui-scale 1;
  double-tap zoom leaks outside the canvas; Pencil hover verification; Safari's
  contextmenu behaviour vs the long-press synthesiser; PWA manifest + icon so
  it installs to the home screen; a service worker so the 13 MB kernel loads
  offline after first visit.
- Budget honestly: ~100k+ across several rounds, gated on device feedback.

## Workstream 6 — the rebrand surface

Last, deliberately — rename nothing until the product matches the pitch.
Site landing page copy, freyacad → (name TBD by owner; "freyacad" may survive
as-is), gate copy, help front page, README, the FEATURE-MATRIX reframed around
a printing audience (SolidWorks column matters less than "vs Tinkercad /
Fusion-for-makers"). ~50k of copy and shuffling, zero risk.

## Order and budget

| # | What | Est | Gate |
|---|---|---|---|
| 1 | Print/Export dialog, 3MF, unit fix, Z-up | done | — |
| 2 | Maker default toolset + first-run choice | 80k | — |
| 3 | Gridfinity bin feature (B-rep) | 150k | ThruSections binding check |
| 4 | ESP32 case demo | 60k | owner's part measurements |
| 5 | Photo-trace into sketch | 120k | — |
| 6 | Bin + pocket demo | 40k | 3, 5 |
| 7 | iPad hands-on rounds | 100k+ | owner's device time |
| 8 | Slicer shelf Worker (one-click Bambu) | 60k | owner ok with a worker |
| 9 | Rebrand copy + landing | 50k | name decision |
| — | LICENSE decision | 0k | owner |

Feature-matrix work (constraint solver, drawings…) continues underneath as
capacity allows — the matrix is the engine roadmap, this is the product one.
