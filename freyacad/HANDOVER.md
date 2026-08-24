# freyacad — handover

Browser CAD at `/freyacad`. One ~9,500-line `index.html`, no build step, no framework.
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
    outline has to fall through to selection — going back through `sketchClick` isn't
    enough there, because `dimHit` measures a polygon to its circumcircle and a click on
    the flat of an edge finds nothing.

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

22. **`cpattern` and `lpattern` copy the whole body, not the feature above them.** Both
    take `resultShapes.slice()` as their base, so a circular pattern placed after one flute
    clones the hull, the flute and everything else built so far — and with `merge:true`
    that is a boolean union per copy. An early lantern demo chained a 7-, a 3- and a
    5-count pattern and produced 105 bodies to fuse; the page never came back, and the
    symptom read as "the app hangs on this model" rather than "this model is wrong". Where
    the pattern is really a ring of identical features, prefer several loops in one sketch:
    both demo models get four-fold symmetry from two mirrored profiles on Front repeated on
    Right, and each engine rotor is one sketch of a dozen curved blades extruded in a single
    feature. Neither uses a pattern at all.
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
