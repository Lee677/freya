# /grid — Gridfinity generator

Magnet-free Gridfinity, generated entirely in the browser. Nothing is uploaded;
the photograph, the geometry and the exported files never leave the machine.

    /grid
      index.html            markup, styles, boot
      favicon.svg
      js/core.js            spec + solid modelling (manifold-3d)
      js/exporters.js       STL, STEP AP214, ZIP, SVG
      js/vision.js          photo -> real-world outline
      js/viewer.js          three.js preview
      js/app.js             UI
      manifold.js/.wasm     vendored CSG kernel (manifold-3d v3)
      three.min.js          vendored renderer (r128)
      test/                 headless harness + CAD-kernel validation

Deploys as-is with the rest of the site (`wrangler pages deploy`); it is static
files only, no build step and no server.

## What it makes

| Tab | Output |
| --- | --- |
| Baseplate | A plate sized to a drawer, in millimetres or inches. Leftover space becomes a solid skirt, or the plate is trimmed to the grid. Optional solid floor, optional corner relief for radiused drawers. Splits itself into bed-sized tiles that cut on grid lines and reassemble exactly. |
| Bin | Any footprint and height. Stacking lip, compartments, scoop, or a pocket in the shape of a scanned tool, repeated in a row or a grid, with a finger dish. |
| Tool scan | Photo → outline in millimetres. Click two points a known distance apart to set the scale, trace, then drag the line where the trace missed. Shoot square-on: the scale is one distance on a flat plane, so tilt is not corrected. |

## Geometry

Standard Gridfinity, no magnet bores or screw holes:

    grid pitch          42.00
    height unit          7.00
    foot profile         0.80 + 1.80 + 2.15 = 4.75
    bin footprint       41.50 (r 3.75) for one unit
    foot bottom         35.60 (r 0.80)
    socket clearance     0.25 per side

Height convention: the body is `7 mm × units` and the stacking lip sits on top
of it. A bin nests exactly 4.75 mm into the bin below, so a stack grows by
exactly `7 mm × units` per bin. Generators that count the lip *inside* the 7 mm
module produce a bin 4.75 mm shorter — switch *Height counts* to
*total incl. lip* to match those.

All solids are built with manifold-3d, so every export is watertight by
construction. STEP is written as a real B-rep: coplanar triangles are merged
back into planar faces with proper outer and inner loops, so a flat wall arrives
in CAD as one selectable face. Curved corners stay faceted at the chosen arc
quality.

## Tests

    node test/export-parts.mjs                 # writes test/out/*.stl and *.step
    ../../.cad-venv/Scripts/python.exe test/check-step.py

The first runs the page's own geometry and exporter code headlessly. The second
reads every STEP back with OCCT and asserts each one is a single closed, valid
solid. Last run: 7/7 solids valid, closed, correct volume.

`EX.checkShell(mesh)` is the in-browser equivalent — it re-derives the face set
and verifies every directed edge is used exactly once with its reverse.
