# freyacad — handover

Browser CAD at `/freyacad`. One ~10,300-line `index.html`, no build step, no framework.
Open CASCADE compiled to WASM (CDN, 50 MB raw / 13 MB brotli over the wire) does the
geometry; three.js r128 draws it.

## The one standing rule

**`help.html` is part of the feature, not a chore afterwards.** Anything that changes what
the user sees or does — a new tool, a shortcut, a menu entry, a changed default, a limit
that gets lifted — updates the manual in the same commit. Also bump the "last revised"
date in two places: `#stamp` near the top and the `<footer>`.

The manual states its own limits (no constraint solver, no datum-plane dimensions, params
outside undo). When one of those gets fixed, delete the note — a stale caveat is worse
than none, because it teaches people to work around a problem that no longer exists.

Same applies to the repo: every change gets committed and pushed.

## Run it

```bash
python -m http.server 8777 --bind 127.0.0.1     # from Freya/, then /freyacad/
npm run deploy                                  # deploys the whole site
```

Unlike `/grid`, freyacad has no `?v=` problem — everything is inline in `index.html`,
which is never cached. `help.html` is a separate file but is only ever loaded fresh into
the overlay iframe.

Note Cloudflare Pages 308-redirects `/freyacad/help.html` to `/freyacad/help`, so check the
live manual with `curl -sL`, not plain `curl` — without `-L` you get an empty body and it
looks like the deploy failed when it did not.

## Where to pick up

**The direction changed on 24 August 2026: freyacad is becoming a 3D-printing tool.**
Read `PRINT-PIVOT.md` — it is the product plan of record (trimmed default toolset,
/grid integration, printing demos, the export pipeline). The feature matrix below is
still the engine roadmap and continues underneath, but the pivot work takes priority.
Already done from that plan: the Print/Export dialog with 3MF export, the unit fix
(trap 39) and print orientation; the one-click Bambu shelf (a Pages Function — see
`functions/api/shelf.js` and trap 40; needs the owner to create the KV namespace in
`wrangler.toml` once before it goes live); the Gridfinity bin and baseplate as native
B-rep features (trap 40); photo-trace into any sketch (vision.js shared from /grid); and
the /grid ⇄ freyacad hand-over (`?gf=WxDxH` deep link, "Edit in freyacad" on /grid). The
menus lost their Transform heading — mirror and the patterns live under Features now,
with a one-off localStorage layout migration in `loadMenu`.

**The engine job** remains closing the gap to SolidWorks and FreeCAD, working through
`FEATURE-MATRIX.html` **cheapest first**. The matrix carries a token estimate per gap and
`dev/matrix_done.py` ticks a row and recomputes the tallies. As of this writing: **42 ✅ ·
3 ◐ · 31 ✗**, 34 gaps, ~7.27M tokens (the 42nd row is tablet support, added done).

**freyacad also runs on an iPad now.** Phones still get the gate; anything with a ≥600 px
short side gets the app, with one finger orbiting, two fingers panning and pinch-zooming, a
long press for the right-click menus, a Delete button on coarse-pointer devices, and an
Apple Pencil as a precision pointer. The document autosaves to localStorage against
iPadOS tab eviction (trap 37). Tested with emulated touch in Chromium; a real iPad has not
touched it yet, so the first hands-on session is worth watching. The working agreement has been: one item at a time,
each committed, deployed and reported before starting the next.

The three scope rows — Mirror, linear pattern, circular pattern — were taken together as one
job, because they were one bug (trap 22). All three are ticked.

Next up, in cost order (IGES was on this list at 40k and was explicitly dropped):

| | |
|---|---|
| 60k | Distance & angle mates |
| 70k | Shell · Interference detection |
| 80k | Draft · Bill of materials |
| 90k | Geometric constraints (the rest) · Variable-radius fillet · Exploded views · Diameter/radius/angular drawing dims · Notes, leaders & balloons |
| 110k+ | Detail views · control-point splines · curve-driven patterns · DXF/DWG · trim/offset/extend · lofted boss |

(IGES sits at 40k and would be the cheapest row left, but it was dropped on purpose and stays
dropped unless someone asks for it.)

**Performance is done for now.** Lantern 5.5 s cold, pillow block 0.6 s, jet engine 10.5 s,
warm edits near the top of a tree under a second. See "Where the remaining time goes" at the
foot of this file for the one lever left, which is not a kernel change at all.

**Verify with `dev/verify.js`.** Read `dev/README.md` first — the A/B-against-the-previous-
commit routine is what caught every regression in this work, and it is cheap. `dev/headless.js`
now runs any of the suites without a browser window, so verification no longer depends on
having a visible pane to paste into.

## Shape of the thing

- **Features are plain JSON** replayed through `rebuild()`. That is the whole parametric
  model — there is no scene graph to keep in sync, you re-run the recipe.
- **Sketch UV ↔ world** via `worldFromSketch(frame,u,v)`; a frame is `{o,u,v,n}` of
  THREE.Vector3.
- **Undo is snapshot-based** — structural clone plus Vector3 rehydration (`reviveFrames`),
  60 deep. Property-panel edits are deliberately *not* captured.
- **DOF is counted, not guessed**: `entVarCount` per entity minus dimensions and pins
  (`defineState`). This replaced a heuristic that cheerfully reported "fully defined"
  while points could still move.
- **Two cameras, one orbit.** `camera` is a live binding reassigned by `setProjection`;
  the ortho frustum is derived each frame from the orbit radius and the perspective fov
  (`syncOrtho`), because an orthographic camera ignores distance and the wheel only
  changes distance.

## Traps that already bit us

1. **rAF is starved in background/hidden tabs.** Any camera animation needs a `setTimeout`
   fallback that lands the final value, or the view freezes part-way. Both `animateToFrame`
   and `flyOrbit` carry one. This looked exactly like a dead click handler for a while.
2. **`canvas{inset:0}` beats `right`/`bottom`.** `left` wins when both are set, so the view
   cube rendered at 0,0 behind the tree. Overlays on the canvas need `left:auto;top:auto`.
3. **Animation eaten by the rebuild.** `animateToFrame` used to start before a ~900 ms
   synchronous OCCT rebuild, so the whole fly happened during the freeze. Start the clock
   on the first rendered frame.
4. **HTML labels lag one frame.** `renderer.render()` is what refreshes
   `matrixWorldInverse`; positioning labels before it uses last frame's matrices, which
   reads on screen as the dimension numbers shaking while you orbit. Update camera
   matrices first, then place labels, then render.
5. **CSS specificity.** `input[type=number]` (0,1,1) outranks `.dim-input` (0,1,0) — the
   dimension box came out as a huge blue-ringed control until the selector was qualified.
6. **Emoji don't work as small icons.** The visibility eye was a 9 px `👁` and was an
   unreadable smudge; it's a drawn SVG now. Anything under ~16 px should be vector.
7. **A diagonal distance doesn't lock a point** — it leaves it free on a circle. Locking a
   point takes two dimensions, which is why FreeCAD has DistanceX/DistanceY.
8. **The WASM build's binary STL reader is broken** (its OSD file layer is only partly
   compiled in — `RWStl.ReadFile_*` returns null for valid binary files; ASCII works).
   STL import therefore parses both flavours in JS and builds a `Poly_Triangulation`
   directly. When attaching it: `BRep_Builder.UpdateFace_2(face, handle, true)` — with
   `theToReset=false` the triangulation is appended but never marked active and
   `BRep_Tool.Triangulation` comes back null.
9. **Mesh-only bodies kill exact-geometry code paths.** `BRepBndLib.Add(s, box, false)`
   and `BRepMesh_IncrementalMesh` both throw raw C++ exceptions (a bare number in JS) on
   a face with no surface. `OCK.bounds`/`OCK.mesh` carry fallbacks; STEP export filters
   mesh bodies out via `OCK.hasSurfaces` and says so in the hint.
10. **The dev server serves stale HTML often enough to burn you.** Symptoms look exactly
    like "my new click handler is dead" while other new code visibly works. Between an
    edit and a browser test, always `location.reload(true)` — plain reload trusted the
    cache at least once in a way that cost half an hour of phantom debugging.
11. **Drags must never rewrite a dimension — but refusing every dimensioned drag is also
    wrong.** Both mistakes were made in turn. An angle dim between two floating lines
    fixes only their *relative* angle: the pair must still drag as a pair. The model is
    constrained dragging: dims store their typed value (`d.v`, backfilled from
    measurement for older files) and `relaxDims` re-applies every dim a few times per
    pointermove, so geometry follows the cursor while the numbers hold. Only fully
    grounded entities (`lockedEnts`) refuse outright. A new dim kind needs a `dimApply`
    branch and nothing else — relaxation picks it up automatically. Two follow-up traps:
    `dimApply` restores two-ref dims by moving the *b* side, so `relaxDims` swaps a/b
    when the dragged handle is on b — without that, one of an angle-dimmed pair drags
    and the other only stretches. And the `d.v` backfill for old files must run at grab
    time (`ensureDimValues` on pointerdown), not lazily mid-drag — a lazy fill measures
    geometry the pointer has already moved and blesses a broken value.
12. **H/V and coincident are stored constraints (`sk.cons`), not one-shot nudges.**
    One-shot was the original sin: nothing remembered the constraint, so drags and dims
    turned "constrained" lines freely. `applyCons` enforces them at the end of every
    relaxation pass (so they win ties against dims), `consOn` charges them to the DOF
    count, badges render beside dim labels, and `dropDimsFor` reindexes them. Parallel /
    equal / concentric are still one-shot — promote them the same way when asked.
13. **Angle dims must rotate about a point on the segment itself.** Two earlier pivots
    both failed observably: the two lines' *intersection* (near-parallel pairs intersect
    far away — rotation reads as teleportation), and a chain segment's *outer tip* (the
    elbow then swings, dragging the sibling segment, and relaxation chases its tail).
    `segPivot` prefers origin, then a cross-entity shared point, then a chain-interior
    point, then the first end. The a/b swap in `relaxDims` is segment-level, not
    entity-level — two lines drawn as one chain are segs of one entity.
14. **Only origin/planes are ground; internal rigidity ≠ defined.** `defineState` floors
    an unanchored entity's DOF at its remaining rigid-body freedoms (translation 2 minus
    `groundInfo().pos`, +1 rotation for orientable shapes without H/V or angle-to-plane).
    Without the floor, a fully-dimensioned floating quad read "fully defined" and its
    corners refused to drag. Snaps auto-store ground constraints (`storeGround` — ⊕
    coincident-to-origin, ∈ `ontrace`) at draw time (`_g` tags riding through
    `applyDrawSnap` into draft points), and drag-release stores origin/trace/vertex-join
    constraints via `refOfHandle`. Plane-name labels are edge-pinned HTML
    (`.trace-label`, `updateTraceLabels` in the render loop), not sprites.

15. **Assembly faces are recovered from the mesh, not from OCCT.** `asmMeshes` holds one
    merged `BufferGeometry` per solid with no face groups, so `meshTopo` welds the
    vertices (1e-4 quantised key), `faceRegion` floods across shared *edges* while the
    crease stays under 38°, and `fitFace` decides what it got: normals all parallel is a
    plane; normals all perpendicular to one direction is a cylinder, whose axis is the
    smallest eigenvector of Σ w·nnᵀ (power-iterated on `tr·I − M`) and whose centre comes
    from a Kåsa circle fit. Fit the circle on the **welded vertices, not the triangle
    centroids** — a centroid sits inside its chord, and that bias reported Ø5.98 for a
    Ø6 pin. Region and fit are memoised on `geom.userData._topo`, which is why hover
    highlighting can afford to run per pointermove. Both caches die with the geometry, so
    a rebuild invalidates them for free.
16. **A drag handle you have to *find* is a bad handle.** The circle rim started as a
    single dot at 3 o'clock; it is now the whole outline (`perimeterHit`, `kind:'rim'`),
    with `ratio` recording where along the radius you took hold so a polygon grabbed on a
    flat doesn't jump out to its circumradius. Two things this must not break: a corner
    handle still wins the pick (corners spin, flats only resize), and a *tap* on the
    outline has to fall through to selection.
    (`dimHit` used to measure a polygon to its circumcircle, so a click on the flat of an
    edge found nothing at all; it measures to the sides now — see trap 31.)

17. **Assembly mates are relations; a solver keeps them true.** Each mate stores its two
    faces in the *components' own* coordinates (`{comp,p,d,r}`), never in world — that is
    what survives the parts moving, the file round-tripping and the component rebuilding.
    `solveMates` is Gauss-Seidel projection: `mateStep` works out the rigid correction one
    mate wants and splits it between the ends, `moveComp` applies it as a rotation about a
    world pivot plus a shift. Two rules make it behave: **the two shares must sum to one**
    (that is what makes a single pass close one mate exactly, however it is split), and
    fixed parts take share zero. `prefer` hands the part under the cursor the small share
    so dragging tows its neighbours instead of being dragged back by them. Convergence is
    geometric at roughly 0.3 per pass with `relax` 0.7; the early-out is what keeps 300
    iterations cheap. On load, component ids are reissued, so the mates' `comp` refs must
    be remapped or every relation in the file points at nothing — and the remap must skip
    origin ends, which carry no id (that bug silently ate every datum mate in a file).
18. **The origin is ground in an assembly too.** A mate end is either `{comp,p,d,r}` or
    `{datum:'Top'|…|'Z'}`; `endWorld` turns the datum name into a world point/direction at
    the origin with `comp: null`, and null-comp is exactly what `mateStep` already treats
    as immovable — so nothing else in the solver needed to know. An origin plane reads as
    a flat face, an origin axis as a round face of no radius, which is what lets the pick
    flow and `wantKind` stay unchanged. `updateDatumVis` shows only the sort of datum the
    live mate can use, and only while it's picking; `mateEndAt` picks part face vs datum
    by ray distance, because "a part always beats a plane" would put the Right plane out
    of reach the moment anything sat on it.

19. **A spline is a `poly` with `spline` set, not a new entity type.** That one decision is
    why spline points take dimensions, constraints, snapping, the drag-holds-dimensions
    rule, DOF accounting, box select, mirror and construction for free — roughly thirty
    `e.type==='poly'` sites needed no change at all. Only four things care: rendering and
    `entityLoops`/`OCK.sketchLoops` take the tessellated curve (and skip `applyCorner` —
    a spline has no corners to round), `dimHit` measures to the curve and maps the hit
    back to its span, and Delete removes the whole curve rather than a span. The fit is
    centripetal Catmull-Rom (α=0.5) converted per span to a Bezier; uniform overshoots and
    self-intersects on unevenly spaced points. `e.tan[i]` overrides the fitted tangent on
    both sides of a point — that's the SolidWorks handle. **`tanFit` before any splice**:
    a sparse `tan` array splices at its end when the index is past its length, which
    silently moves one point's handle onto another.

20. **A drawing is SVG, not the 3D scene.** `docMode==='draw'` swaps the WebGL canvas for
    `#sheet`, an SVG sheet in millimetres (`viewBox` = the paper size), because a drawing
    has to print at true size and export as vectors, and a screenshot of a WebGL canvas
    does neither. The model stays loaded underneath — `drawReturn` remembers whether it
    came from a part or an assembly, and re-entering the drawing calls `rebuildDrawViews`,
    which is what makes views track the model.
    **Hidden-line removal is done by asking the geometry.** `buildView` projects deduped
    `EdgesGeometry` segments onto the view basis, then samples each one and raycasts from
    the sample back toward the eye: a hit means the solid is in the way. Runs of samples
    become solid or dashed polylines. Two traps: lift the ray origin off the surface by
    ~2e-4 of the model diagonal or every sample hits its own face, and drop zero-length
    runs — with `stroke-linecap: round` a degenerate run renders as a *dot*, scattering
    pinpricks over the sheet. It runs once per view, ~110 ms for a small part.
    Note that a bore's front and back rims legitimately project to the same 2D circle;
    those overlapping strokes are correct, not duplicates.
    Three things the mode has to get right or it reads as broken: the sheet needs a
    `z-index` above the WebGL canvas AND the canvas hidden (`display:none`) — half-covering
    it left a rotatable grid floating over the drawing; the view keys (arrows, F, Ctrl+5/7/8)
    must be refused in draw mode, because they drive a scene nobody can see; and the
    sheet-level pointer handler must be bound ONCE, not inside `renderSheet` — the `<svg>`
    element outlives every redraw, so binding it there stacked a handler per redraw and one
    click walked the dimension pick two or three steps at a time.
21. **Drawing dimensions are stored in view coordinates, which are model millimetres.**
    The projection is orthographic and unscaled, so a distance measured in a view's own
    coordinates IS the distance on the part. That is why changing the sheet scale to 1:2
    halves the drawing and leaves the number reading 40, and why dimensions travel with a
    view when it is dragged. Everything is *drawn* in sheet millimetres though (`toSheet`),
    not inside the view's `scale(s,-s)` group — put text in there and it comes out
    mirrored and scaled.

22. **Mirror and both patterns take a scope; without one they still copy the whole body.**
    They used to have no choice about it: all three took `resultShapes.slice()` as their
    base, so a circular pattern placed after one flute cloned the hull, the flute and
    everything else built so far — and with `merge:true` that is a boolean union per copy.
    An early lantern demo chained a 7-, a 3- and a 5-count pattern and produced 105 bodies
    to fuse; the page never came back, and the symptom read as "the app hangs on this model"
    rather than "this model is wrong".

    `f.scope` is now a list of feature ids. Absent or empty still means the whole body, which
    is what every part saved before this expects, so the old behaviour had to stay reachable
    rather than be replaced. With a scope, the copies are the scoped features' **tool**
    shapes — the prism an extrude fused in, the prism a cut removed — transformed and applied
    again with the operation their source used. That is the whole trick: patterning a hole
    cuts more holes because the hole's tool is a cutting prism, not a lump.

    Five things hold it together, and each one is load-bearing:

    * **`featTools` only lives for one rebuild.** `noteTool` files each tool under its
      feature's id as it is built. Nothing owns those shapes — booleans run
      non-destructive (trap 29), so a tool outlives the boolean that consumed it.
    * **A checkpoint may not skip a scoped source.** The tool exists only if the feature
      actually ran, so `rebuild` refuses any checkpoint at or above the shallowest feature a
      scope points at (`scopeFloor`). Take that guard out and `dev/verify-live.js` case
      `patternPanel` reads 894.272 instead of 745.832 — the pattern silently drops every
      copy, and worse, the wrong body gets pinned into a checkpoint. It fails exactly when
      you open the pattern's own panel, which bars the checkpoint taken AT the pattern and
      sends the search down to the flush just below it.
    * **Tools are resolved in tree order, not tick order.** Scope a boss and a cut together
      and the boss has to be fused before the cut is cut, or the boss fills the hole back
      in. `scopeTools` walks `features`, not `f.scope`.
    * **Copies are grouped tool-major**, so all N instances of one boss are a single fuse.
      Trap 26 again: what bills is the number of booleans.
    * **`deleteFeature` strips the id from every scope.** Ids get reissued, so a dangling
      reference would eventually point at something unrelated rather than at nothing.

    A fillet cannot be scoped and this is not an oversight: it reshapes the body's edges
    rather than contributing a shape, so there is no tool to copy. Put the pattern before the
    fillet. `SCOPEABLE` is the list; the manual states the limit.

    The demo models still use mirrored loops in one sketch rather than patterns — that was
    the right call for other reasons (one sketch, one extrude, no booleans at all) and it was
    not revisited. Rebuilding them on patterns is now possible, and would be a fair test.
23. **Loops in one sketch must not overlap each other.** The first jet-engine rotor set the
    blade half-thickness as an arc *length*, so the angular half-width was `half/r` — at the
    root radius that made each blade wider than the gap between blades, and the profiles
    intersected. OCCT did not error; it ground. Blades that do not touch build a 12-blade
    rotor in 59 ms. `rotor()` in the generator now asserts `2*half_arc < gap*0.55`.
24. **A synchronous OCCT build blocks the paint, so a slow model looks like a crash.** The
    jet engine is about a minute of kernel work. `loadDemoAsm` sets the hint and defers the
    build by a `setTimeout` so the message reaches the screen first. Anything else that can
    run long needs the same two-step, and note that timing it from the caller lies if the
    work is behind a `FileReader` — that was how the engine first appeared to build in
    376 ms.

25. **`rebuild()` is called from ~60 places and most change no geometry.** Selecting a
    feature, opening a sketch, moving the selection and closing a panel all called it, and
    every one replayed the whole feature stack through Open CASCADE. On the lantern demo
    that is **20.6 seconds** — measured, not estimated — which is why clicking a feature
    "took forever". There is now a fingerprint of everything the built geometry depends on
    (doc mode, rollback index, the active features with `error`/`_previewGeoms` stripped,
    the panel feature, the edge selection); when it is unchanged the shapes, meshes and
    pick edges are reused and only overlays and UI are redone: **1.4 ms**. Two traps if you
    touch it: the reuse test must require `resultGeoms.length > 0`, because an empty result
    satisfies `0 === 0` and pins the emptiness in place for good; and anything that can
    change geometry without changing a feature's JSON must go into the fingerprint.
26. **Boolean cost is the NUMBER of booleans, not the size of the shapes.** This took three
    attempts and two wrong theories to pin down, so the measurements are worth keeping.

    Splines used to reach the kernel as polylines — `BRepBuilderAPI_MakePolygon`, sixteen
    chords per span — giving the lantern demo 946 faces and 5,382 edges. Of a **20.6 s**
    rebuild, 11.8 s was five `unionInto` calls and 6.4 s two `subtractFrom` calls: 88% in
    seven booleans. The obvious theory was "boolean cost climbs with face count, so build
    real curved edges". Done, one `Geom_BezierCurve` per span: faces 946 → **80**, edges
    5,382 → 452, and the rebuild went to **15.5 s**. Only 25%, and `unionInto` did not move
    at all (11.8 s → 12.3 s). Fewer, curved faces are not cheaper to boolean than many flat
    ones.

    Second theory: 80 faces is still 22 separate surfaces of revolution because there was
    one edge per span, so join the spans into one curve. `GeomConvert_CompCurveToBSplineCurve`
    does that exactly — it reparameterises, it does not refit, and it picks interior knot
    multiplicity 3 when the spans are only G1 (a centripetal Catmull-Rom is), so the
    concatenation is the same curve. Faces 80 → **32**, edges 452 → 164, rebuild **11.5 s**.
    Better, still not the order of magnitude.

    What it actually is: **a fuse against a spline surface costs ~600 ms whether the spline
    has 2 spans or 24.** Measured directly — a revolved-spline hull fused with one block:
    598 ms at 2 spans, 874 ms at 24. It is a fixed cost per boolean. Chaining four blocks in
    one at a time took 2,991 ms; one BOP with all four tools took **1,375 ms** for the same
    24 faces out. So: batch. `OCK.fuseAll`/`cutAll` take argument and tool *lists*, and
    consecutive features that all add (or all remove) material are collected and applied in
    a single boolean — see the deferred-booleans block above `applyFeature`. Lantern
    **6.2 s**, circular pattern 1,004 → 710 ms, linear pattern 203 → 73 ms. 20.6 s → 6.2 s
    overall, 3.3×.

    Things that measured as worthless, so don't spend time on them again: `SetUseOBB`,
    `SimplifyResult`, and `SetRunParallel` (the WASM build is single-threaded — 1,395 ms vs
    1,389 ms). `BRepBuilderAPI_NurbsConvert` on the hull gave ~15% and costs shape identity,
    so it was not taken.

27. **`BRepGProp::VolumeProperties` lies about multi-span surfaces — don't use it to check a
    refactor.** It picks Gauss points from the surface *degree* and ignores the knot count,
    so one 8-span BSpline surface of revolution integrates far worse than the same geometry
    as 8 faces. On the lantern hull it reported 10782.8 against a true 10942.8 — **1.46%
    low** — and reported the same figure for every `Eps` from 1e-3 to 1e-8, which makes it
    look converged when it is not. That nearly sent a correct change back for rework.
    `VolumePropertiesGK` is the adaptive one but it hung the renderer at tight tolerances.
    What to use instead: mesh with `BRepMesh_IncrementalMesh` at a few deflections and sum
    signed tetrahedra — that converged to the analytic Pappus volume (10942.7983) from both
    the old and new code, which is what proved the geometry unchanged. For a revolved
    profile the analytic value is free: `V = 2π ∮ (x²/2) dy` round the closed loop, exact
    per polygon edge as `(y₁−y₀)(x₀²+x₀x₁+x₁²)/6`.

28. **Deferring a boolean is only safe while nothing reads the body.** `pendOp` collects
    tools and `flushPending` applies them; the flush has to happen before anything that
    consumes `resultShapes` — fillet, mirror, both patterns, an import, and a change of
    direction between adding and removing — and at the end of the loop. Sketches
    deliberately do *not* flush, which is the whole point: that is what lets the usual
    sketch-extrude-sketch-extrude run collapse into one boolean. Two things this must keep
    doing: each pending tool remembers its feature, so a failed batch is retried one at a
    time and the error still lands on the feature at fault rather than on the whole run; and
    `buildPartShapes` (the assembly path) has to reset and flush around its own loop and
    save/restore the pending state, because it swaps `resultShapes` out from under it.
    Regression cover for all of this is a volume/centre-of-mass/face-count comparison against
    the previous commit over pillow, mirror, both patterns, a multi-body part, a
    fillet-and-cut run, a deliberate merge-cut-merge ordering case, and the lantern; seven of
    the eight match to the last digit, and the lantern is the one to check by mesh volume.

29. **Checkpoints: the body is kept wherever it is whole, and three things nearly broke it.**
    Trap 25 answers "has anything changed"; this answers "how much". After each point where
    nothing is owed, `resultShapes` is kept with a key describing every feature at or below
    it; next rebuild the deepest still-matching checkpoint is restored and the loop starts
    after it. Lantern: editing the last feature **5.8 s → 0.9 s**, editing a cut → 1.7 s,
    editing inside the merge batch unchanged at 5.7 s (correct — the batch has to redo).

    * **Checkpoints can only be taken at a flush, not at the end of a feature.** The first
      version checked `!pendOps.length` after each `applyFeature` and recorded nothing useful
      at all, because batching keeps a tool pending across the whole run — features 3–15 of
      the lantern never have a materialised body between them. `flushPending` is the only
      moment the body is whole, and it records at `ckptCurIdx-1`.
    * **Anything the build writes back onto a feature poisons the key.** `applyFeature` sets
      `f.frame` on sketches *during* the build, so a key taken before the build lacked it and
      the next one had it — two different keys for identical geometry, and not one checkpoint
      ever matched. It is in `SIG_SKIP` now (it is derived from `plane`, which is keyed
      already). Any new derived field written onto a feature has to go there too, and note
      `geomSignature` had the same latent bug, silently costing full rebuilds.
    * **Dropping checkpoints and then not rebuilding loses them for good.** `loadDemo` used
      to call `dropAllCheckpoints()` before `rebuild()`; once the frame fix made the signature
      stable, reloading the model you already had short-circuited on trap 25 and returned
      before recording anything, so the first edit after any load was always a full rebuild.
      Checkpoints are keyed on content and capped at 8, so a stale one can neither match
      wrongly nor grow without bound — the drop was never needed on the part paths.

    Two standing requirements. **Booleans must run non-destructive** (`runBop` sets it):
    OCCT may otherwise write p-curves and inflated tolerances back into its arguments, and a
    checkpoint shape is handed in as an argument over and over, so the creep would surface
    much later as a model that used to build and stopped. And **shapes are owned by
    checkpoints** — nothing else may `delete()` them; `unionAll` passes untouched bodies
    through by reference, so two checkpoints routinely share one shape, and freeing is done
    against the set of shapes the survivors still hold. A checkpoint at or above the feature
    the panel is editing is never reused, because its preview geometry only exists if that
    feature actually runs.

30. **`BRepAlgoAPI_Fuse_3(a, b, range)` performs the operation in its constructor.** The old
    `OCK.fuse` then called `Build()` again, so every single-shape boolean ran twice. Removing
    it took the lantern 6.2 s → 5.5 s, the pillow block 899 ms → 621 ms and the jet engine
    16.5 s → 10.5 s, for nothing. Everything goes through `runBop` on the default constructor
    now, which builds once.

31. **A regular polygon is dimensioned by one side, not across its corners.** That is what
    SolidWorks does and it is the number you can measure on the part. `dimHit` measures to
    the sides and returns `{kind:'pedge', seg}`; `dimApply` converts back through
    `r = L / (2·sin(π/n))`, which resizes about the centre and leaves the rotation alone.
    Three things ride on the kind name and were easy to miss: the old `'pdia'` branches in
    `dimResolve`/`dimApply` must stay so sketches saved before this still read right (nothing
    creates one now); the concentric tool resolves a click on an outline to the shape's centre
    by matching the dim kind, so `'pedge'` had to be added there or clicking a polygon stopped
    finding its centre; and `dimsOn` needs a staleness guard, because reducing the side count
    leaves a dim pointing at a side that no longer exists and it would otherwise go on
    spending a degree of freedom.

32. **Per-corner fillets are a third list beside `dims` and `cons`, and must be reindexed
    like them.** `sk.corners` holds `{ent, idx, kind, r}`; `applyCorner(sk, L, closed, ei)`
    takes the entity index so a record can be found, and `cornerPoly` asks per corner what it
    gets. The sketch-wide `fillet`/`chamfer` is the default and a record overrides it —
    including `kind:'none'`, which is the only way to say "this one stays square" against a
    sketch-wide fillet. Absence of a record means inherit, so a sketch with no exceptions
    carries no `corners` at all.
    Three things to keep true: `dropDimsFor` and `shiftPointRefs` must move corner records the
    same way they move dims, or a record ends up describing whichever entity or point slid
    into the vacated slot; every sketch record handed to the kernel has to copy `corners`
    across (there are three such copies — two in `applyFeature`, one in the contour picker),
    and forgetting one shows up as the preview and the solid disagreeing; and
    `entityDisplayPath` builds a one-entity sketch to draw a rect or polygon, so it has to
    renumber that entity's records to index 0 or they are not found.
    A stitched loop spans several entities and has no single `ei`, so it passes null and takes
    the sketch-wide setting — a real limit, worth lifting if anyone asks.
    Note the rounding arc is still tessellated into ~14 segments, as it always was; now that
    `wireFromSegs` can take real curves, a sketch fillet could become a true arc edge, which
    would be a small, contained improvement.

33. **Shortcuts go through `keyFor(id)`, never a literal key test.** `KEY_DEF` holds the
    defaults, `keyOverrides` (localStorage `fcad-keys`) holds only what the user changed, and
    the handler compares `comboOf(e)` against `keyFor(id)`. Adding a rebindable command means
    adding it to `KEY_CMDS` and matching on `keyFor`, not on `e.key`.
    Three details that are easy to get wrong, and two of them bit:
    * A command with **no** key must map to a sentinel `comboOf` can never return. `''` matches
      comboOf's own empty return when a bare modifier is pressed, and a plain space matches the
      space bar — both were tried, the second shipped briefly in this session's working copy
      and would have made Space fire whichever command had been unbound. It is `'<none>'`.
    * Shift is only part of a combo for **non-character** keys. Include it for letters and
      Shift+D reads as a different key from D, so the dimension shortcut stops working with
      caps lock on.
    * The view keys (iso/normal-to/ortho) are matched on the whole combo *outside* the
      Ctrl-only branch. Left inside it, rebinding one to a plain letter would make it
      unreachable.
    The recorder in the dialog listens in the **capture** phase, or the key being recorded also
    fires the command it is bound to; and its listener must be removed when the dialog closes,
    which is why `close()` does more than `ov.remove()`.
    Taking a key from another command clears that command's override — and if the key taken was
    that command's own default, it is set to "no key" instead, otherwise it would silently take
    the key straight back.

34. **Find a circle in SPACE, not on the sheet.** A centre mark needs a hole's centre and a
    centreline needs its axis, and by the time the model reaches a drawing there are no
    circles left to ask: the solid is tessellated, so a Ø6 bore is a ring of chords, and
    `buildView` projects those chords. Two things went wrong before this landed, and both are
    worth keeping.

    * **Chaining the PROJECTED chords finds nothing at all.** A through hole's near and far
      rims are different edges in space that land on exactly the same circle on the sheet
      (trap 20 says so about the drawn result; it is just as true of the graph underneath).
      Every 2D vertex therefore has four edges at it rather than two, no walk can continue
      past one, and not a single loop closes. Measured, not guessed: the degree histogram of
      a plate with two holes was `{4: 76}` projected and `{2: 144, 3: 8}` in space. Dedupe
      the projected segments and it works — `chainLoops` does, and says why.
    * **A projected circle is only ever a circle you are looking straight at.** That is
      enough for a centre mark and useless for a centreline: a shaft seen from the side has
      no circle on the sheet at all. The first version took "the line midway between two
      parallel edges" instead, which on a shaft picks the two rim projections — and those
      are square across the axis, so the centreline came out at ninety degrees to the truth.
      The fix was to move the whole detector into 3D: `modelCircles` fits plane-and-circle to
      each closed 3D loop, `axisGroups` merges circles that share an axis, and `buildView`
      then asks one question per view — is this axis pointing at the eye or across it.
      Face-on within 12° draws a cross, edge-on within 12° draws a line, and anything between
      is an ellipse on the sheet and gets neither, which is what a draughtsman would do.

    The polygon exclusion is a real limit, not a bug: a regular polygon's corners lie exactly
    on a circle, so the fit alone cannot tell a hexagonal boss from a bore. `CIRC_MIN_SIDES`
    is 12 and the manual states the consequence. `fitCircle3D` also refuses a non-planar loop,
    which is what keeps the round-in-plan top of a fillet from collecting a centre mark.

35. **The drawing dock was underneath the sheet, and had been all along.** `.sheet-wrap` is
    `z-index:14` so a drawing covers the 3D canvas outright (trap 20), and it is `inset:0`, so
    it covers the whole viewport. `.dock` is `z-index:10`. Every button in the drawing's
    floating dock — Dimension included — was therefore sitting under a sheet of paper and
    could not be clicked at all, and the right-click menu was the only way to reach a drawing
    command. Nothing looked wrong, which is why it survived: the dock is drawn, it lights up
    on hover-free redraws, it simply never receives a click. `#dock-draw{z-index:15}` fixes it.
    Found by a real hit-tested click in the headless harness, not by reading the CSS — it
    is exactly the class of thing that only a real click finds.

36. **`BRepOffsetAPI_MakePipeShell`: two of its flags will quietly ruin a sweep.** Both were
    found by measuring against volumes that are known exactly, and neither announces itself.

    * **`Add_1(profile, WithContact, WithCorrection)` must take `false, false`.** `WithContact`
      reads as "put the profile on the path", and it does not: it translates the profile until
      it *touches* the spine, which for a centred section moves it off the axis by its own
      half-width. A Ø4 tube swept round a Ø20 ring then sweeps about Ø24. The torus is what
      settles it, because its volume is exactly 2πR·πr²: **947.48 with contact on, 789.568 with
      it off, and 789.568 is the answer.** Every curved path was reading about 10% heavy and it
      looked like a kernel quirk rather than a flag. The profile is swept where it was drawn.
    * **`BRepBuilderAPI_Transformed`, OCCT's DEFAULT transition mode, silently truncates.** On a
      path of a 20 leg and a 15 leg it sweeps the first leg, drops the second, reports `IsDone`,
      returns a solid that `BRepCheck_Analyzer` calls valid, and measures exactly the first 20.
      `RightCorner` is used instead and measures exact on every path shape tried; `RoundCorner`
      is the fallback and differs by about half a percent on a right angle. Transformed is not
      in the list at all.

    A third trap has no flag behind it: **`IsDone()` and `MakeSolid()` both return true for a
    shape with no volume.** A bend whose radius equals the profile's half-width pinches the
    inside of the tube to a line, and OCCT hands back a zero-volume solid rather than refusing.
    That would reach the tree as a feature that silently does nothing, so `runPipe` measures the
    result and treats zero as a failure, which sends it to the next transition mode — and
    `RoundCorner` builds that case correctly.

    Two things about the sweep that are not OCCT's doing. The path is chained by `pathChain`,
    which is `stitchLoops` for OPEN runs — a profile that does not close is not a profile, but a
    path that does not close is the normal case, so it could not simply reuse it. And the path
    honours **sketch fillets** (trap 32): without that, a rounded corner drawn on the path would
    show rounded on screen and sweep square, and rounding the path corner is the right answer to
    a sharp bend anyway.

    Regression cover is four cases in `dev/verify.js`, all analytic rather than baseline:
    a swept solid of section A along a path of length L has volume **A·L exactly**, on a
    straight path and round a mitred corner alike, because the wedge the mitre cuts off one leg
    is the wedge it adds to the other.

37. **Touch is a capture-phase overlay, and three prior decisions made it cheap.** The whole
    tablet grammar — one finger = the pointer, two fingers = pan/pinch, long press =
    right-click — lives in one listener block on `document` in the CAPTURE phase, beside the
    Controls. Ancestor capture listeners run before the target's own even when a drag is
    pointer-captured to the canvas, so the second finger can be swallowed there before any
    sketch handler sees it. Do not try to register the interceptor on the canvas itself: at
    the target element, capture and bubble listeners fire in plain registration order, and
    this block is parsed long after the handlers it must outrank.

    What makes a pinch SAFE rather than merely possible: sketch clicks dispatch on
    **pointerup behind a 5 px movement guard** (a pinch's fingers move, so it can never place
    geometry), and drags **arm on pointerdown but only act on pointermove**, so
    `cancelAppGesture` can take back an armed drag whole — it restores the pushUndo snapshot
    — before anything has moved. Anything that changes either of those invariants breaks
    two-finger navigation silently. The long press dies past 5 px for the same reason the
    canvas contextmenu handler ignores drags past 5 px: the two guards must agree or a slow
    press opens a menu the handler then refuses.

    `lastCoarse` (was the last pointer a finger?) widens pick tolerances by ~1.8× for
    fingers only — a Pencil reports pointerType 'pen' and keeps mouse precision. And
    `touch-action:none` on the canvases is load-bearing: without it the browser answers the
    pinch itself and the pointermoves never arrive.

38. **Autosave exists because iPadOS evicts tabs, and its three rules matter.** The document
    rides in localStorage, debounced 1.2 s off `rebuild()` (every change passes through
    there) and flushed on `visibilitychange`/`pagehide`, because eviction gives no later
    chance. On boot it restores before the demo pref gets a say. The rules: a payload over
    ~4.5 MB is skipped (embedded STEP imports can exceed the quota, and the last good save
    is better than a failed one); a **pristine demo is never restored as "your work"** —
    part demos compare exactly against the registry and boot fresh on a match, assembly
    demos always boot fresh (their stored form differs from the registry form, so edits to a
    demo assembly forfeit the net — rare, documented); and `ckptOff` gates the save so
    `buildPartShapes`' borrowed state is never written. Note `dev/verify-live.js` ends by
    clearing the document, which empties the autosave — run it in a browser you care about
    and your net is gone until the next edit.

39. **The STL export was 10× the modelled size, and nobody had a policy.** `exportSTL`
    multiplied every coordinate by 10 while `exportSTEP` wrote raw — the same part left
    the app 140 mm in one file and 14 mm in the other, and the manual's "stored in mm"
    claim matched only the STEP path. Fixed with the print pivot: a dimension of 14 is
    14 mm in every export (3MF, STL, STEP), and the mesh exports map the app's Y-up world
    to the printer's Z-up as (x,y,z)→(x,−z,y) — determinant +1, so triangle winding
    survives — which lands a Top-plane part flat on the slicer bed. The demo models are
    still modelled small (a 25 mm lantern); remodelling them at true size is on the pivot
    plan. If a user reports an old print at 10× size, this is why.

    The 3MF exporter that shipped alongside writes core 3MF (an OPC zip built by a ~40-line
    stored-entry writer, one welded-vertex object per body, `unit="millimeter"`). The weld
    is what makes a slicer see a closed shell rather than triangle soup, and the sliver
    guard (a!==b&&b!==c&&c!==a after welding) is what keeps a degenerate triangle from
    poisoning it. Verified headlessly: a 20×10×5 box comes out as exactly 8 vertices and
    12 triangles at z 0..5.

40. **The Gridfinity port, and what to know before touching it.** `OCK.gfBin`/`OCK.gfPlate`
    are /grid's `core.js` generator re-plumbed onto OCCT: same spec numbers, same profile
    steps, same lip-relief rule (the relief must not apply to a solid bin or it scoops the
    whole top — /grid trap 3, honoured here). Corners are true arcs (one cubic Bezier per
    90°, k=0.5522847) where /grid tessellates 8 chords, so volumes agree to ≤0.083% and
    bounding boxes exactly — measured against /grid's own generator for five bins and a
    plate, and pinned in `dev/verify.js` (gfbin, gfbincut, gfplate). The gfbincut case is
    the point of the whole port: a Ø8 circle cut through the floor removes π·16·5.95 =
    299.08 mm³ exactly, i.e. the bin is a real solid you can cut.

    The engine is **hand-sewn analytic faces**, and that is a second-generation fact worth
    its history: v1 fed rings to ThruSections, which approximates every wall as a B-spline,
    and each boolean against those paid trap 26's fixed cost — a 1x1x3 bin took 10 s and
    ONE cut on a 4x4 baseplate took 22 s. But the walls are not freeform: straight-band
    corners are CYLINDERS, tapered-band corners are CONES (ring corner centres are shared,
    so radius is linear in height), and every flat is a PLANE. `gfLoft` now says so face by
    face (`gfRing`/`gfAddBands`/`gfSewSolid`) and sews; the plate skips booleans entirely
    and is sewn whole, sockets included. Bin 1x1x3: **1.2 s**; plate 4x4: **1.2 s, zero
    booleans**; the loose-bbox artifact v1 had is gone with the B-splines. Volumes were
    re-cross-checked against /grid after the rewrite (≤0.084%, bboxes exact) and re-pinned.

    Three traps the sewn engine will bite someone with:
    * **Top-down profiles.** /grid's loft reversed profiles written top-down (its trap 2);
      the lip cut IS written top-down. Drop that guard and every band gets a negative
      height and MakeFace throws a raw C++ number. The guard is in `gfLoft`.
    * **A sewn shell's orientation is luck.** A solid sewn inside-out MEASURES negative
      volume and booleans wrongly; `gfSewSolid` checks the sign and flips. (The minimal
      repro pot: right orientation 1685.841 = 2000−100π exactly, wrong one 2314.159.)
    * **Holes that touch.** Adjacent baseplate sockets are exactly pitch-wide at the top
      (42.0 on 42.0), so their openings meet at zero gap — the boolean version resolved
      that into knife-edges, but a sewn face cannot hold two touching holes and the solid
      comes out empty and invalid. Every socket is half a micron smaller per side (EPS in
      `gfPlate`): beneath any printer's notice, decisive for the topology.

    The shelf (`functions/api/shelf.js` + `wrangler.toml`): POST bytes → 10-minute KV TTL
    → `bambustudio://open/?file=<url>`. The client fetch is `/api/shelf` — ABSOLUTE —
    because a relative fetch from /freyacad/ resolves to /freyacad/api/shelf and misses
    the Function (that bug shipped for about an hour). Until the owner creates the KV
    namespace, every POST 503s and the dialog quietly falls back to download-then-launch.

41. **Live-testing round one, and what it caught.** Three reports from the owner's first
    real session, all fixed the same day:
    * **The rollback bar was dead whenever the origin was expanded.** The drag mapped "the
      N-th `.feat` row in the tree" to "array index N" — but datum planes and axes are
      `.feat` rows too, nested sketches render out of array order, and so every drop
      clamped to the end and read as a dead control. Rows now carry their group's starting
      array index (`dataset.gs` — a feature plus the sketches it consumes, which sit
      BEFORE it in the array) and both the bar's rendering and its drag go through that
      one mapping, so they cannot disagree. The bar moves in whole features.
    * **A sweep's path sketch floated at top level.** The tree only knew `sketchId`; a
      sweep consumes TWO sketches. `pathId` now nests under the sweep beside the profile.
    * **"Trace a photo" died with `V.loadImage is not a function`.** freyacad's own
      lexical `V` — the Vector3 shorthand at the top of the script — shadows the vision
      library's `window.V` everywhere inside the app. Every tracer call now goes through
      `window.V` explicitly. Anything else that ever loads a global from /grid must
      remember the app's shorthand namespace sits over it.

42. **`document.lastModified` lies on Cloudflare Pages.** It is only the deploy time when
    the server sends a `Last-Modified` header; Pages sends `ETag` instead, and the spec's
    fallback is THE CURRENT TIME — so the boot panel's version line and the corner build
    tag showed every visitor their own tab-load moment and called it the build. Both now
    read `build-stamp.json` ({t, commit}, gitignored), written at deploy time by
    `tools/build-stamp.mjs` — wired into both `npm run deploy` and the GitHub workflow —
    with lastModified kept only as the local-dev fallback (python http.server really does
    send the file's mtime). Two wrinkles: the stamp fetch resolves in tens of ms but the
    boot row it writes into appears at the 260 ms tick, so the value is held and painted
    on each tick (`paintStamp`, same cure as the line-count row); and the boot overlay
    removes itself on any window `error` event, so a headless test that aborts the kernel
    fetch kills the overlay before the row exists — serve the kernel mirror in tests.

## Biggest thing still missing

**A real constraint solver *for sketches*.** Dimensions are applied one at a time, so
satisfying one can disturb another. `@salusoft89/planegcs` is FreeCAD's solver compiled to
WASM and would slot in beside the existing OCCT/manifold WASM. Everything else on the list
— datum-plane dimensions, parallel/perpendicular/equal — is easier and less valuable than
this. Note the assembly mate solver (trap 17) does not help here: it projects rigid bodies
in 3D, and sketch entities are neither rigid nor 3D.

Also open: dimensioning to the datum planes (length and angle to a plane trace; the origin
already works), lines parallel to a datum plane, and property-panel edits inside undo.

## Where the remaining time goes

Cold builds: lantern 5.5 s, pillow block 0.6 s, jet engine's six parts 10.5 s. Warm edits
near the top of a tree are under a second (trap 29). What is left is the per-boolean cost of
a spline surface — about 600 ms, flat — and the boolean count is already minimal, so there is
no more to win by rearranging them.

The remaining lever is therefore **not building at all**: ship the demo models' built B-rep
beside the recipe so opening one displays immediately and the kernel only runs if you edit
something. That is the whole of the "opening the lantern on a slow laptop" complaint, which
checkpoints do nothing for — a cold load has no cache to hit. Keep the stored shape honest
with a hash of the feature JSON.
