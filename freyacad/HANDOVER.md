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
with a one-off localStorage layout migration in `loadMenu`; a second migration there
merged the four sketch entries into ONE pick-driven **Sketch** tool at the head of
Features (`startSketchPick` — the origin planes show for the pick, a face or plane
click starts the sketch, and the nearest hit wins so a plane behind the solid cannot
steal a face click). That work also added the persistent top-right **pick card**
(`showPickCard`/`hidePickCard`), shared by every click-something-next arm — sketch,
text face and axis picks — because the fading bottom hint left armed states looking
dead. Saved files are **.part / .assembly / .drawing** now (the old .sketchcad /
.asmcad still open), and they save under the document's name (`docName`, set by
open/demo/new — `bracket.part` reopens and re-saves as `bracket.part`). A
**.drawing references its model SolidWorks-style** (owner's explicit ask, replacing
one window of embedded-model format): `docFile()` serializes
`{type:'drawing',ref:{name,kind},draw}` with NO features/asm; opening one
auto-attaches over a matching open model (base-name match), otherwise
`resolveDrawingRef` raises a dialog — pick the file (a part loads as `drawModel`,
the side-build that never disturbs the open document; an assembly loads for real)
or use the open model. Legacy embedded .drawing files still open whole. Guard
dialogs ("Save, then …") call `saveProject('model')` so they protect features,
not sheets. **Appearance** (2026-08): `appearance={part,bodies:{idx:hex},faces:[{sig,color}]}`
is display-only doc state (never in geomSignature) applied by `applyAppearance()` in the
rebuild tail and the overlays-only path (guarded by `appearanceRev` vs `mesh.userData.appRev`).
Face colours are signature-matched (`faceSig`/`sigMatch`: kind+centroid+direction+radius+area
in world coords) because faces have no stable ids — edit elsewhere and the colour re-finds its
face; change the painted face itself and the colour goes dormant (by design, tell the user to
re-apply, don't "fix" it into guessing). A part with any colour saves as
`{type:'part',appearance,features}`; a bare array still means an uncoloured part, and every
part-file reader goes through `partFileData()`. Body colours key by resultShapes INDEX (bodies
mostly append; a deleted body-creating feature can shift them — known, accepted).
`comp.color` tints assembly components (`matFor` shared material cache), drawing shaded
views tint per body via `drawSourceGeoms()` `{geoms,cols}` and `tri.c`, and `drawViewsStale`
re-projects the sheet on entry after colour edits. `setRenderedView` (btn-render, persisted
`fcad-render`) is a material/edge-visibility swap only. **The document library** (owner's
ask, 2026-08): Save writes to IndexedDB (`fcad-library`/`docs`, keyPath name WITH extension)
instead of downloading; Open (`openLibrary`) lists records with the icons/*.png file icons —
row click opens, ⭳ downloads the real file, × deletes (confirmed). `saveProject` serializes
synchronously via `docFile` BEFORE the async put (guard dialogs mutate state right after),
and falls back to a plain download if IndexedDB is refused (private mode). `resolveDrawingRef`
checks the library for `ref.name` before raising its dialog — references self-resolve like a
SolidWorks search path. Real files still come in through "Open from this computer…"
(#file-load). **The viewport speaks B-rep now** (owner report: the lamp's swept spout was
"thousands of little lines" and its flat end unclickable): `OCK.edgeMesh(shape)` returns one
polyline per real TopoDS edge (48 samples, colinear runs collapsed) — that is what the green
overlay draws and what `buildPickEdges` picks, every chord tagged `edgeId` so hover/selection
paint the WHOLE edge (`redrawEdgeSel` wholeEdge; the hover compare keys on edge, not chord).
`OCK.mesh` records `geo.userData.faceRanges` (one triangle range per TopoDS FACE, explorer
order) and `faceRegion` returns the real face when >1 range exists — the 38° crease flood
remains only for mesh imports (their single wrapped face gives 1 range) and as fallback.
**Faces hover and select too** (owner report: the spout's end edge was pickable, its end
FACE was not): `hoveredFace`/`selectedFace` are `{body,ids,seed,fit}` or null —
display-session state, never saved, never in the rebuild signature — `body` indexes
resultMeshes, `ids` is the region's triangle list and `seed` is the region's LOWEST triangle
id, so one face keeps one identity however the ray struck it (and the region/fit caches land
one key per face, not per facet). `faceAtPointer` resolves a pointer event to that shape
(`docMode==='part'` + `mode==='model'` only, nothing while `armedPick()` is true or a fillet
draft is collecting edges — a highlight must promise what the click would take);
`drawFaceHl` scrap-and-syncs at most two tint meshes (hover `0x35d4e6` 0.25, selected
`0x4285F4` 0.4, two session materials, `faceTriGeom` positions, polygonOffset below the
colour overlays' -1.5) added as CHILDREN of the body mesh and tagged `userData.faceHl` —
NEVER `faceCol`, which is what `applyAppearance` sweeps; `setRenderedView` only touches
`isLineSegments` children, so both sweeps leave highlights alone, and `pickBody`'s
non-recursive raycast cannot pick them. An edge inside its pick tolerance beats the face for
both hover and click; selection is mutually exclusive (a face click empties `selectedEdges`,
`toggleEdge` nulls `selectedFace`). Face state clears wherever `hoveredEdge` is nulled
(loadDemo, startSketch, applyState, commitEdgeFeature, new part) and in `buildPickEdges` —
the one place every FULL rebuild passes, since new meshes make triangle ids meaningless;
`rebuildOverlaysOnly` keeps its meshes and deliberately keeps the selection. The right-click
**Face** section (`openModelMenu`, absorbing the old flat-only "This face" pair) acts
through the existing flows only: `makeFaceSketch`/`startTextOnFace` get a synthesized hit
from `faceHit` (object + faceIndex + `face.normal` from the seed triangle + `point` from the
fit centre — part bodies carry no transform, so body space IS world space), `openFaceColor`
is the `pendingFaceColor` consumption body extracted so both routes store one signature per
face, `axisFromFace` writes the daxis fields `consumeAxisPick` writes (method `circ`), and
`viewNormalToFace` aims `flyOrbit` at the face normal from whichever side the camera is
already on. **The kernel names the surface, the mesh no longer guesses** (owner report: "all
round surfaces unselectable"): `OCK.mesh` records `geo.userData.faceInfo` beside faceRanges —
one `{k,p,d,r}` per RANGE, same order, from `BRepAdaptor_Surface_2().GetType()` (plane / cyl /
cone / sphere / torus / rev / other; the adaptor bakes in the face location so it is already
world-space, every face in a try/catch, a throw records 'other'). `fitFace` returns the exact
fit whenever the seed resolves through a range with `k!=='other'` — the mesh fit stays for
imports and BSplines (the swept spout honestly stays 'other'). Two things stay MESH-derived
on purpose: `p` is the face's own centroid for a plane and the axis point NEAREST that
centroid otherwise (never the infinite surface's anchor — `faceSig` keys colours on `p`, and
two coaxial cylinders must not sign alike), and a plane's normal SENSE is flipped to agree
with the triangles, since consumers rely on outward. Cone/torus/rev all report `kind:'rev'`,
so `axisKind(k)` (`cyl`|`rev`) is what anything wanting an axis asks: `consumeAxisPick`, the
Face menu's Add axis, and `kindFits` for the concentric-mate pick (the mate SOLVER is
untouched — it only ever read p/d). `sigMatch` now compares round kinds by name-free rules
(flat still never matches round): a colour saved before this carried 'other' for every round
face, and a wall the mesh called a cylinder is honestly a revolution — same face, better
name; centroid/direction/radius still gate the match. **Small flat faces forgive a near
miss** (`rescuePlanarFace`, RESCUE=12 px): the Ø3 mm spout cap is a few pixels with the tube
right beside it, so the flows that REQUIRE a plane — armed Sketch pick, `pendingFaceSketch`,
armed Text pick, and a cold right-click — take the planar face whose projected centroid is
nearest the click when a confirming raycast at that centroid really lands inside it (that ray
is what stops a hidden plane being rescued). `planarFaceFor(e,hit)` is the "what a
flat-requiring click meant" wrapper. Hover never rescues and neither does a plain selection
click — a highlight has to be the truth. **`pickEdge` is occlusion-aware**, which is what
lets a plain click on that cap take the FACE: the pick lines are drawn `depthTest:false` and
a raycast is pure geometry, so the ray carried on through the solid and passed within the
threshold of edges BEHIND it (on the lamp's cap it was finding a seam 16 units deeper). It
now takes the nearest `resultMeshes` hit first and accepts the first line hit within
`surf.distance + thr*1.5 + 0.05` — an edge on the visible face measures the same within
tessellation sag, a silhouette edge measures shorter, hidden ones are skipped; with NO
surface under the cursor (a silhouette clicked from the sky) the nearest line wins as
before. Note this also means a test that clicks a chord must click a VISIBLE one (brepsel's
target picker was taking the middle chord of the lamp's base rim, which is under the body).
The only routing rule left on the right-click is that a right-click back on the SELECTED
face offers its commands rather than a nearby edge's; an edge already selected still keeps
the edge menu. **Feature-tree hover cross-highlights** (owner ask): `setFeatHover` on every
`makeFeatRow` row lights the thing the row made in one `treeHoverGroup` — sketch rows glow
EVERY entity through `entityDisplayPath` + `sketchData[id].frame`, never `entityLoops`,
which yields closed profiles only: a sweep's path sketch is one open spline with no loops at
all, and a consumed, hidden path sketch is exactly the one worth glowing (construction
geometry draws too). dplane/daxis rows redraw their reference geometry, and a solid feature ghosts
the tool shapes `featTools` kept for it, meshed lazily and cached in `treeGhostCache` (dropped
in `resetFeatTools` — the shapes' own lifetime; a tool freed with a checkpoint throws and
falls through). The fallback for a feature with no separable tool (a fillet, a
checkpoint-restored rebuild) is a slight emissive tint on every body material, stored and put
back exactly on leave: without face naming, which faces a feature made is unknowable. The
origin rows already did this through `setTreeHover`/`updateDatumVis`, which stays the only
thing allowed to decide datum visibility. Cleared on leave, on `refreshTree` (the rows are
replaced, so no mouseleave arrives), on `setMode` and on doc-mode change.
Angular deflection is the scale-free quality knob: 0.22 rad (was 0.35), linear diag*0.003.
`featureEdges` (crease detector) still serves the DRAWING views — crease lines double as
silhouettes on sheets, real edges alone would lose a cylinder's side profile — and the
manual-fillet machinery. Fillet seeds ({mid,dir} chords) still match real kernel edges via
`OCK.matchEdges`, unchanged file format. `manifest.webmanifest` + `icons/` make freyacad
installable as a PWA whose `file_handlers` give those extensions freyacad icons in
the OS file explorer and route double-clicks into the app (`launchQueue` consumer
at the foot of the script waits for the kernel before loading). The full /grid tracer toolset
is ported into the trace dialog (colour pick, brush, scale line, finger holes,
straighten, ROI, search box — everything but the printable fit-check template, by
choice). Newest: **Text on a face** (raised or sunk, same or separate body for
multi-colour 3MF, five system-font faces, B/I/U, repositionable — the letters go through
an offscreen-canvas raster → boundary trace → RDP pipeline in `textLoops`, cached in
`textLoopCache`), concentric mates accepting **circular edges and arcs** (`edgeCircAt`),
and the axis tool's **centre-of-a-circle** pick (`consumeAxisPick`; traps 49–51 came out
of this trio).

**The engine job** remains closing the gap to SolidWorks and FreeCAD, working through
`FEATURE-MATRIX.html` **cheapest first**. The matrix carries a token estimate per gap and
`dev/matrix_done.py` ticks a row and recomputes the tallies. As of this writing: **41 ✅ ·
3 ◐ · 32 ✗**, 34 gaps, ~7.27M tokens (the tablet row is a deliberate ❌ — see below).

**Tablets and phones are blocked, by the owner's decision** (2026-08). Tablet support was
built and shipped, then the owner asked for it to be removed: the gate in `<head>` now
stops anything mobile — including iPads, which call themselves Macs (the maxTouchPoints
test catches them) — with no screen-size exemption. The touch machinery inside the app
(touch orbit/pan/pinch, long-press menus, the coarse-pointer Delete button, autosave) is
still there and still serves touch-screen laptops; only the gate and the manual changed.
Don't resurrect tablet support without asking. The working agreement has been: one item at a time,
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

**Performance is done for now.** Pillow block 0.6 s cold, the magic lamp and print test boat
a few seconds each, warm edits near the top of a tree under a second. See "Where the
remaining time goes" at the foot of this file for the one lever left, which is not a kernel
change at all. (The old lantern 5.5 s / jet engine 10.5 s numbers went with those demos.)

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
    old jet engine demo was about a minute of kernel work; its loader set the hint and
    deferred the build by a `setTimeout` so the message reached the screen first. The demo
    (and the assembly-demo path with it) is gone — replaced by the print test boat — but
    anything that can run long still needs the same two-step, and note that timing it from
    the caller lies if the work is behind a `FileReader` — that was how the engine first
    appeared to build in 376 ms.

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

43. **Hand-authoring a sweep (learned rebuilding the demos).** Two rules. The path must
    START AT or CROSS the profile's plane (`checkPierce` refuses otherwise) — so a spout
    that visibly starts at x=7 still needs its path drawn from x=0, with the extra run
    buried inside the body. And the profile is swept FROM WHERE IT IS DRAWN: the tube is
    the path's shape carried at the profile's perpendicular offset from the path's start
    tangent line. Draw the profile centred on that line (both demos: circle at Right-plane
    (0, y0) with the path's first two control points flat at y0) and the offset is zero, so
    the tube follows the drawn path exactly. The demos are also the pattern for a revolve
    away from the origin: there isn't one — the boat's funnel stands at x=0 because `axis:
    'v'` spins about the sketch's own vertical axis and nothing can move the result.

44. **STL import skipped the inverse of the export mapping.** Exports write printer
    coordinates via `printPt=(x,-z,y)` (trap 39); the importer read file numbers straight
    into world coordinates, so every import lay on its side and every export→import round
    trip rotated the body 90° about X (caught by the test sweep's files lane, reproduced
    twice: worldImp equalled file coords, `idempotent:false`). The importer now applies the
    exact inverse — `(x,y,z)file → (x, z, -y)world` — so slicer-world STLs stand upright and
    the round trip is the identity. Old saved projects that embedded an STL import replay
    through the same code and will stand up differently on next rebuild; that is the fix
    working, not a regression.

45. **Dimensions on an isometric view measured the projection.** The manual promises the
    number is "measured off the model", but view geometry kept only (u·w, v·w) — a 40 edge
    dimensioned on the iso read 28.28 (the sweep's drawings lane caught it). Projected
    points now carry their depth along the view normal (`d = n·w`; u,v,n orthonormal, so
    (x,y,d) IS the model point), iso dimensions are forced to `aligned`, and `dimValue`
    measures the true 3D corner-to-corner distance — the probe's plate now labels that edge
    40. Flat views still measure in the view plane, as every drawing standard expects;
    where two corners project to one dot, the snap keeps the one nearer the eye.

46. **The global `canvas{position:absolute;inset:0}` rule eats dialog canvases.** It exists
    for the viewport, but it applies to EVERY canvas: the trace dialog's preview canvas
    stretched to the whole viewport, and its opaque background became a dark sheet hiding
    the dialog — the owner saw "screen goes dark, says Insert outline" (the footer buttons,
    later in the DOM, still painted above it). `#navcube` fought the same rule earlier
    (its comment at the `#navcube` styles). Any canvas that ever goes inside a dialog needs
    `position:static` in its inline style. The fix is on `#tr-cv`; this note is so the
    NEXT dialog with a canvas doesn't rediscover it.

47. **The scene fog was tuned for 15 mm parts, and real-size parts sat inside it.** The
    depth-cueing fog (`Fog(0x0a0e12, 55, 150)`) fades to opaque background by 150 units
    from the camera. A Gridfinity bin is 42 mm a cell, so fitting one puts the camera 90+
    units out and the far half of the bin was fogged; a baseplate went fully dark — the
    owner read it as broken lighting ("the bins are in the dark"), and the first debugging
    instinct (sewn-face normals) was wrong: winding, normals and materials all measured
    clean. The render loop now scales fog.near/far with the camera-to-target distance
    (floors at the old 55/150, so small parts render pixel-identical). Any future "model
    goes dark at distance" report: check the fog before the lighting.

48. **Same era, same disease: the zoom cap was an absolute 300.** The wheel, the pinch AND
    `fitAll` all clamp to `controls.maxR`, so a 4×4 baseplate (fit distance ~322) could
    never be framed — Fit hit the ceiling too. `syncZoomRange()` now derives maxR from the
    model's own fit distance (×1.6 — the owner's spec: "see a bit more than an entire
    model but not much further"), floored at 80, run after every rebuild and component
    change and before every fit; it also pulls the camera in when the model shrinks.
    Anything else in the codebase still holding a bare distance constant should be
    presumed guilty of the same 15 mm-era assumption until measured. And indeed: the
    sketch editor had two more of the same. The zoom envelope measured only the SOLIDS
    (`partBox`), so a sketch bigger than the part — every traced outline on an empty
    part — could not be zoomed out to; `sketchBox()` now unions the live sketch overlay
    into `syncZoomRange` and `fitAll` while sketching. And `startSketch` flew to a
    constant radius 18, framing one corner of a big sketch on entry; it now flies to
    the sketch's own fit distance (18 stays the floor for an empty one). When testing
    the entry flight headlessly, wait ~2.5 s: `controls.sph.radius` is only written by
    the flight's finish(), and rAF starts late under SwiftShader — a mid-flight read
    shows the stale pre-flight radius and looks exactly like the bug.

49. **A circle fit whose tolerance scales with its own radius accepts its own garbage.**
    The circular-edge pickers (`fitEdgeCircleAround`, feeding the axis tool's
    centre-of-a-circle pick and the concentric mate's edge picks) chain tessellation
    segments into a run and fit a window of points around the clicked segment. The first
    version put the window at a fixed offset (`seedAt−3..seedAt+4`): click two segments
    from the arc's end and the window straddles the tangent junction, catching seven arc
    points plus one straight endpoint 30 mm away. Kåsa then fits a HUGE circle (r≈26 for
    an r=5 corner arc) — and the acceptance test `rms < 0.02·r` passes, because the bogus
    radius inflated its own tolerance. Growth (also toleranced on r) then swallowed the
    whole rounded-rectangle outline and returned its inscribed-ish circle as "the arc".
    The fix: try EVERY window shift that still contains the clicked segment, over several
    window sizes, and keep the lowest RELATIVE residual (rms/r) — the pure-arc shift
    always wins that contest, after which radius-relative growth is safe because the
    radius is real. The near-miss version "worked" whenever the click landed mid-arc,
    which is exactly why the first probe passed and the real-mouse test failed.

50. **`applyCompTransform(comp)` reads `comp.t`; it takes no transform argument.** A test
    called `applyCompTransform(comp, {x:-35,...})` and the second argument was silently
    ignored — the pin stayed where auto-placement put it and the mate test's first click
    hit empty space. Set the fields on `comp.t` first (`Object.assign(comp2.t,{...})`),
    then call `applyCompTransform(comp2)`. Nothing warns; the position is just stale.

51. **`defaults('sketch')` does not exist.** The `defaults()` switch covers solid/datum
    features only — sketches are constructed literally everywhere (`{id, type:'sketch',
    plane:{kind:'datum',name:'Top'}, entities:[…], dims:[], cons:[], fillet:0, chamfer:0,
    suppressed:false}`). A probe that asks `defaults('sketch')` gets `undefined` and
    fails a few lines later on `.id`.

52. **`SIG_SKIP` skipped `frame` for every feature — and the text feature's frame is its
    authored anchor.** The skip exists because sketches get `frame` written DURING the
    build (derived from `plane`), so keying it made every checkpoint self-invalidating.
    But the text feature stores its face placement in `f.frame` as plain arrays, and the
    blanket skip meant a "move to a different face" changed NOTHING in the geometry
    signature or the checkpoint keys: rebuild() early-returned, and worse, a checkpoint
    holding the text at its OLD placement still key-matched, so the text kept building
    where it used to be. The owner's report read as "duplicated text" and "deleted the
    feature but the cut remained": the app looking frozen invites invoking the tool
    again, which minted a SECOND text feature — delete one and the other stays.
    Two fixes: `sigStr(f)` keeps `frame` when `f.type==='text'` (both the signature and
    the checkpoint keys go through it), and invoking the text tool while a text panel is
    open re-arms the face pick for THAT text instead of creating a twin. If a future
    feature stores authored placement under `frame`, it needs the same exception —
    better, name the field something else.
    A tail to this one: parts SAVED (or autosaved) by the buggy build carry the twin as
    an ordinary second Text feature, and the fix cannot remove what is already data —
    a later "it duplicated again" report on an old part is likely the stowaway showing
    itself when the twin above it is edited. The tree shows both; delete the spare.
    Also mind the ghost variant: a drag that releases where it started rebuilds through
    the overlays-only path, which must still clear the mid-drag outline preview —
    `rebuildOverlaysOnly` calls `drawTextHandle()` for exactly that.

53. **A pick preference has to know what the pick is FOR.** `mateEndAt` preferred a
    circular EDGE whenever one was near the cursor — right for concentric mates (that is
    why the preference exists), fatal for coincident ones: an edge end is kind `cyl`, a
    coincident mate wants `plane`, and on a bolt or a nut every flat face is a narrow
    annulus with a rim millimetres away. The owner's "error mating them coincident" was
    the pick reading "That is not a flat face" on faces that plainly were. The edge
    branch now only runs when the active mate wants a cylinder. Related UX finding from
    the same session: after a concentric mate the moving part often lands OVERLAPPING
    the fixed one (the solver moves it minimally onto the axis, leaving it at its old
    height), and then every click near the joint hits a curved wall — the concentric
    success hint now says to drag along the axis or add a coincident mate to seat it.

54. **Polygon corners are live point references now.** A polygon stores (c, r, rot) and
    its corners are derived — but `pointRefs`/`resolvePt` expose corner k as ref idx k+1,
    where reads compute the corner and WRITES solve r and rot about the centre
    (`polyCornerRef`/`setPolyCorner`). That one mechanism gives coincident-to-a-corner,
    dims to corners, drag-time joins on corners, and "snapped lines ride the polygon"
    when it spins or stretches. Three companion rules earned their keep: the H/V tools
    accept a polygon EDGE and solve rot (`applyHVPolygonEdge`, enforced in `applyCons`);
    coincident enforcement lets the POLYGON side lead a plain point (one corner write
    reshapes the whole shape, so the point is the follower); and `pinsOn` now grounds a
    partner only via `anchoredSetSans` — anchored WITHOUT the pinned entity — because a
    dangling line glued to a corner used to read as "anchored" through the polygon
    itself and locked the polygon against the very drag that should carry the line.
    Also from that session: `relaxDims` runs for grab-time joins even in a sketch with
    no dims and no stored constraints, and a successful H/V apply settles stored
    coincidences immediately (`relaxDims(editing,3)`).

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

Cold builds: pillow block 0.6 s, the sweep-heavy magic lamp and the print test boat a few
seconds each (the retired lantern was 5.5 s, the retired jet engine 10.5 s). Warm edits
near the top of a tree are under a second (trap 29). What is left is the per-boolean cost of
a spline surface — about 600 ms, flat — and the boolean count is already minimal, so there is
no more to win by rearranging them.

The remaining lever is therefore **not building at all**: ship the demo models' built B-rep
beside the recipe so opening one displays immediately and the kernel only runs if you edit
something. That is the whole of the "opening the lantern on a slow laptop" complaint, which
checkpoints do nothing for — a cold load has no cache to hit. Keep the stored shape honest
with a hash of the feature JSON.

## Magic lamp reshaped to the owner's reference photo

The demo was a teapot with a stick on it. It is now the ornate genie lamp in the
owner's photo: a **long low boat hull** (25.9 wide, 8 deep — the reference is
3.4:1 and so is this), a **slender stem** down to a **trumpet foot**, a **spout**
that leaves the bow and rises to a beaked tip, a **big open scrolled handle**
whose tail closes the scroll's eye and dives back into the hull, and a new
**stepped pagoda lid** with three eaved tiers, a spire and a ball finial. ~41 mm
long, 22.2 tall. Ten features now, not eight — `Lid profile` + `Lid` were added;
`Body` / `Spout` / `Handle` keep their names, the revolve keeps its +Y axis, the
spout still ends in a small flat cap and it is still one merged body.

Three things are worth keeping if the shape is ever edited again:

- **The bow joins the hull because the two are tangent.** The hull's rim is a
  half-round nose of radius 1.05 centred at (11.93, 14.1) in the body profile,
  and the spout tube has the *same* radius and runs LEVEL through that centre.
  Their silhouettes therefore share a tangent where the tube leaves the solid and
  the prow grows out of the body with no step. Move the spout path off 14.1 at
  x≈12 and a lip appears round the tube immediately.
- **Consecutive spline entities in a profile fuse into one kernel face.** Four
  splines in a row (neck, hull, nose, sheer) came back as a single 1193 mm² face,
  which is no use when you want to paint only the belly. A one-line entity
  between them splits them — hence the "knop" at the stem and the "rim moulding"
  at the widest point. Both are in the reference photo anyway.
- **Two swept tubes that interpenetrate cost the union about a second.** The
  handle path used to start at y 13.4, inside the spout's tube; starting it at
  11.0 and climbing costs nothing visually (that stretch is buried) and took the
  cold build from 7.7 s to 6.7 s. Face count is the other lever — the boolean
  pays per face pair, so every profile here is as few segments as the shape can
  stand.

**Per-demo appearance.** `DEMOS` entries may now carry an `app` field; `loadDemo`
resets the appearance as before and then applies `normApp(d.app)` if one is
there, so a demo can ship colours and a demo without them still loads bare. The
lamp ships `DEMO_LAMP_APP`: part **#e7bb45** gold, with **#17909f** teal on five
signature-matched faces — the belly, the trumpet foot and the lid's three tiers.
The gold/teal split is the reference's, done with the only tool the kernel gives
us: whole faces. The `models/magic-lamp.sketchcad` twin now saves in the
`{type:'part',appearance,features}` form and is byte-identical to the inline
data; `dev/verify.js` unwraps either shape when it fetches a demo model.

**Numbers that moved.** `dev/verify.js` lamp pin: 4070.494 → **2886.44** (21f 95e
1b) — the shape changed, so the volume did; the BOAT pin and all eighteen A/B
cases are untouched and still exact. `scratchpad/newdemos/brepsel.js`: 26 real
edges → **47**, 10 faces → **21**, planes still **2** (the foot's base disc and
the spout's cap), and the circular edge it clicks is still a **48**-chord circle.
`facesel.js` finds its targets dynamically and still passes 14/14.

Cold build of the reshaped lamp: **6.7–6.9 s** headless (it was 4.2 s), of which
the construction is only ~1.6 s — the rest is the one batched fuse of hull +
spout + handle + lid and the mesh that follows it.

## Loft

`loft` and `loftcut` are real features, and the pair is shaped like `extrude`/`cut` rather
than like `sweep`/`swcut`: two distinct `type`s, no operation toggle in the panel.

```
{type:'loft'|'loftcut', name, profiles:[sketchId, ...], ruled:false,
 merge:true (loft only), suppressed:false}
```

`OCK.loft(sections, {ruled})` is `BRepOffsetAPI_ThruSections(isSolid=true, ruled, 1e-6)`
over one wire per section. Sections are plain sketch objects — the same
`{entities,fillet,chamfer,corners,frame}` shape `applyFeature` hands to `OCK.sweep` — and each
one's wire comes from `OCK.regions(sk,0)[0].outer.mk(false)`, so the loft, the sweep, the
extrude and the contour picker are all reading the same builder.

**One closed contour per section, and the biggest one.** `OCK.regions` sorts by area, so
`regs[0]` is the outer region of the sketch; holes and any further region are left out. A loft
pairs its sections up wire by wire and a sketch with two loops gives no answer to which loop
pairs with which. Two loops that both want lofting are two lofts. The panel says so.

**The winding correction is not there, and that was measured.** Every outer wire this app
builds runs CCW about its own sketch normal, so a section on a plane that faces *back* down
the run arrives wound the opposite way to its neighbours — the classic square-to-circle
bowtie input. ThruSections' compatibility pass (on by default, and what also lets a four-edge
square meet a one-edge circle at all) reverses such a wire before pairing anything up.
Seventeen configurations were built with a normals-vs-travel-direction correction in place and
again with it removed — square to circle, square to square, circle to circle, a flipped middle
section of three, sections on tilted planes along a rising curve, ruled and smooth — and every
volume agreed to the last digit. `$SP/newdemos/loftwind.js` and `lofttilt.js` are those two
probes; `newdemos/loft.js` keeps the flipped-plane case (`sqcircFlipped`) as the standing pin.

**Failure modes ThruSections actually has.** `IsDone()` returns true on a shape with no
volume, exactly as `MakePipeShell` does — two sections on the same plane skin to nothing —
so the volume is measured before the shape is returned. The kernel also throws (an emscripten
number, no `.message`) rather than returning a bad status on some inputs, so the Build is
wrapped and the throw becomes a sentence. Errors reach the feature's `error` field through the
usual `markFeatureError`, one per cause: fewer than two profiles, a profile not picked, a
deleted sketch, the same sketch twice in a row, an open contour, a kernel throw, an empty
result.

**Ruled and smooth are the same solid for two sections** — there is nothing to smooth
between. The difference is real from three up: circle 3 → 6 → 3 over 12 mm measures 791.681
ruled (exactly two cone frusta) and 972.637 smooth.

**Ordered list in the panel.** `fieldOrderedList` is a new field builder beside
`fieldSeg`/`fieldCheck`: one `<select>` per row, ↑ / ↓ / × per row, and an add button. The
order is the shape, not housekeeping — reordering `[1,2,3]` to `[1,3,2]` on the three-circle
case takes it from 972.637 to 199.944.

**`consumedIds(f)`** is new and now answers "which sketches does this feature own" in one
place: `f.sketchId`, then a sweep's `pathId`, then a loft's whole `profiles` run.
`refreshTree`'s `nested`/`kidsOf`, `parentsWithSketches` and `sketchConsumedBy` all go through
it. That last one closed a standing gap: a sweep's PATH sketch nested under its feature in the
tree but was still drawn in the viewport, which both the tree section's own comment and
help.html ("consumed and hidden") already claimed it was not. Consumed sketches of every kind
are now hidden unless shown from the tree. `lastSketchId` was deliberately left alone —
excluding consumed sketches from it would stop a sketch being used for a second feature, and
every sketch in the lamp is consumed.

**Not special-cased anywhere else.** Features serialise wholesale into `geomSignature` and the
checkpoint keys, so edit, rebuild and rollback across a loft need no work; `scopeFloor` is
about scoped patterns only and is untouched. `loft`/`loftcut` are in `SCOPEABLE`, so a mirror
or pattern can copy one. `NEEDS_SKETCH` replaces the two hand-kept lists of "tools that need a
sketch" (the Add menu's disabled set and `addFeature`'s guard), which had to agree and now
cannot disagree.

Tests: `$SP/newdemos/loft.js`, thirteen cases through `loadDocData` — cylinder against
πr²h, square→circle bracketed by the two prism volumes, the flipped-plane repeat, three
sections against two analytic frusta, a loftcut through a plate, a profile-sketch edit, a
real mouse drag of the rollback bar across the loft and back, the refusals, the tree/panel,
and the reorder. `adoptNewCommands` is pinned too: the harness seeds a pre-loft
`fcad-model-layout` before the app script runs and checks both ids arrive in Features.

## Rendered view: gold that glimmers

The rendered view was `roughness 0.42 / metalness 0.06` under a single
hemisphere light, and the demo lamp's gold came out as flat yellow plastic.
Metal is almost entirely what it reflects, and this scene had nothing to
reflect. So the rendered view now brings a room with it.

**A procedural studio, generated in code.** `studioPanorama()` paints an
equirectangular room into a 1024×512 canvas — graded sky, dark floor, a low
ceiling, and seven lights: six tall strips standing round the subject plus one
wider key panel. `studioEnvTexture()` reads it back through
`pow(byte/255, STUDIO_CURVE) * STUDIO_GAIN` (2.35 and 5.0) into a `FloatType`
`DataTexture`, because a canvas is 8-bit and a studio is not — without that
curve PMREM clamps the lights flat and the metal goes back to looking painted.
`studioEnvMap()` runs it through `PMREMGenerator` on the first trip into the
rendered view and hangs the result on `scene.environment`. Nothing is fetched.

The lights' placement is not decoration. An azimuth with no light in it shows up
as a lid that has gone dull from one particular orbit angle, which is how the
seventh strip earned its place — `scratchpad/newdemos/reflmap.js` mirrors rays
off the lid and prints the panorama u,v they land on, which beats guessing.

Two things that bit us here:

- **Do not call `PMREMGenerator.dispose()` in r128.** It disposes the shared,
  module-level lod planes, so the *next* generator anyone builds comes up with
  broken geometry. The generator is kept in `studioPMREM` and reused; the source
  texture is what gets disposed.
- **r128 never notices that `renderer.toneMapping` changed.** The curve is a
  `#define` compiled into every shader, and `setProgram`'s change detection
  checks encoding, envMap, fog and clipping — not tone mapping. So
  `setRenderedView` marks every material in the scene `needsUpdate` on the
  toggle. Without it the grid and the overlays keep their old programs and the
  frame comes out half tone-mapped.

**The materials.** `applyRenderLook` is still the only place the two looks are
decided. Rendered view: `envMapIntensity 1`, and one rule splits plate from
enamel on Rec.601 luma — brighter than `ENAMEL_LUMA` (0.5) gets
`roughness 0.18 / metalness 0.96`, darker gets `0.44 / 0.70`. The lamp's gold
`#e7bb45` is luma 0.73 and turns to plate; its teal `#17909f` is 0.43 and stays
enamelled, which is what stopped the teal washing out to pale blue when the
whole part first went full metal. Workshop view: unchanged `0.9 / 0.0`, plus
`envMapIntensity 0` so the studio cannot reach it once it exists. That last part
is load-bearing and was checked rather than assumed — same lamp, same pose, the
build before this change against the build after: **0 of 315,000 pixels differ**,
both cold and after a round trip through the rendered view. Shadows are
untouched (`shadowMap` still on; the scene's only light is still the hemisphere
one, which casts none).

**Exposure is the seam for the lighting tool.** `setExposure(v)` is the only
thing that writes `renderer.toneMappingExposure`; `renderExposure` starts at
1.15 and clamps to 0.2–3. It is deliberately not on `__C` yet — add it there
when the slider is wired, and drive it through the function, not the renderer.
Note r128's ACES opens with `color *= toneMappingExposure / 0.6`, so 1.15 is a
gain of about 1.9, and the panorama was balanced against that. The clamp is a
fence, not a cliff: across 0.2–3 the lamp's gold median runs 84 → 174 and the
filmic curve holds the hue at both ends, so the whole span is safe to expose
(`scratchpad/newdemos/expo.js` walks it and prints the numbers).

**Highlights over metal.** `faceHovMat` / `faceSelMat` gained `toneMapped:false`
— they are UI, not surfaces, and the filmic curve was pulling the cyan and the
blue back towards the metal they have to stand out against.

Shots and harness: `scratchpad/lamp/glim-1..4.png` (four orbit angles),
`glim-workshop.png` (the matte control) and `pano.png` (the room itself), driven
by `scratchpad/newdemos/glim.js` and `pano.js`. Suites after the change: verify
12/12, verify-live allOk, `facesel-lane.js` 14/14, `brepsel-lane.js` pins
unchanged, no page errors.

## The Lighting tool

The rendered view came with a fixed exposure and a fixed environment, and the
workshop view came with a hemisphere lamp nobody could reach. All three are now
under a small panel — the sun beside the Render button, `Lighting…` in the
right-click **View** section, `__C.openLighting()` from a test.

**The state is one object and one key.**

```js
const LIGHT_KEY='fcad-lighting';
const LIGHT_DEF={brightness:1.45, env:1.00, workshop:0.40};
const LIGHT_LIM={brightness:[0.2,3], env:[0,2], workshop:[0.1,1.2]};
const lighting=Object.assign({},LIGHT_DEF);        // the whole of it
```

`localStorage['fcad-lighting']` is that object as JSON and nothing else —
`{"brightness":1.45,"env":1,"workshop":0.4}`. Every value clamps through
`lightClamp` on the way in, so a hand-edited or out-of-date key cannot put the
renderer somewhere it cannot come back from. It is display-only: not in the
part file, not in the rebuild signature, not sent anywhere.

**Everything goes through `setLighting(partial, quiet)`.** It clamps, calls
`applyLighting()`, re-syncs the panel and writes the key. `quiet` skips the
write, which is what `loadLighting()` on boot uses — a session that never opens
the tool leaves **no key**, so "no stored key" stays a state that means
something (the byte-identical test below depends on it). `resetLighting()` puts
the defaults back and `removeItem`s the key.

**`applyLighting` is deliberately three uniform writes.**

```js
hemiLight.intensity = lighting.workshop;
setExposure(lighting.brightness);                     // the seam, unchanged
if(renderedView) eachBodyMaterial(m=>{ m.envMapIntensity = lighting.env; });
```

In r128 all three are plain uniforms refreshed from the material every frame,
so dragging a slider costs one redraw — no `needsUpdate`, no shader rebuild
and above all no PMREM pass. The expensive change is the tone-mapping *type*,
and that is still only `setRenderedView`'s business. Do not add a
`needsUpdate` here "for safety": it turns a smooth drag into a recompile
storm across every cached material.

`setExposure` stays the only writer of `renderer.toneMappingExposure` and is
now also the only writer of `lighting.brightness` — the old `renderExposure`
variable is gone rather than mirrored, because a mirror of a slider drifts.
`eachBodyMaterial(fn)` is new and is the single list of what the two looks are
applied to (`solidMat`, both material caches, `resultMeshes`, `asmMeshes`);
`setRenderedView` was rewritten to walk it too, so the live sliders and the
view toggle can never reach different sets.

**The hemisphere is the honest one.** It is still the scene's only real light,
so `workshop` changes the matte view AND fills the rendered one (the enamel
rule leaves 30% diffuse on dark colours). That is the point: a user who finds
the workshop dim now has the slider for it. Measured on the lamp, the workshop
frame mean runs 6.3 → 54.7 across 0.1–1.2, with 0.4 (19.8) unchanged as the
default.

**Presets** are conveniences, not modes — a preset writes all three and then
gets out of the way, and moving a slider afterwards just unlights the button.

| | brightness | env | workshop |
|---|---|---|---|
| **Studio** (default) | 1.45 | 1.00 | 0.40 |
| **Bright** | 2.00 | 1.40 | 0.80 |
| **Soft** | 1.20 | 0.65 | 0.75 |
| **Moody** | 0.85 | 1.20 | 0.15 |

**The default exposure was raised, and it was measured first.**
`scratchpad/newdemos/lightprobe.js` walks exposure at four orbit poses and
prints the gold's median, p99, and the share that has gone cream (r and g both
past 235):

```
 exp   p50   p99   cream   clipped
 1.00  105   235   0.018   0
 1.15  113   237   0.049   0        <- what the studio shipped with
 1.45  126   240   0.053   0.0001   <- now
 1.85  140   240   0.043   0.0001
 2.20  150   240   0.055   0.0001
```

The filmic curve pins p99 at ~240 across the whole span, so nothing here is a
clipping decision — it is taste, and the taste is that past about 1.7 the
lid's gradient flattens to pale yellow (`scratchpad/lamp/expcmp-*.png` are the
four candidates side by side). 1.45 is a ~12% lift on the mid-tones for free.
The top of the range is left to the slider.

**The workshop view is untouched, and that is tested rather than asserted.**
`scratchpad/newdemos/lighttool.js` check 8 asks git for `HEAD:freyacad/index.html`
(read-only, `git show` of a blob), serves those bytes in place of the file on a
second port, loads the lamp in both, and compares the workshop frame: **0 of
315,000 pixels differ, max channel delta 0**, with no stored key present. That
check is the one to keep green — it is what lets the next person change the
lighting defaults without wondering whether they moved somebody's baseline.

**Three sliders, not four.** A warm/cool tint was considered and dropped: the
only thing that could carry it is the panorama, and tinting that means a PMREM
rebuild on every drag — the one cost this design is built to avoid. A
directional key light would have been the other candidate, but at the intensity
0 it would need to ship at (to keep the workshop view identical) it is a slider
that does nothing until you touch it, and shadows on top. The probe shows all
three shipped sliders move the picture monotonically and independently, which
is the bar a fourth would have had to clear.

**The top bar.** Measured before the button went in: at 1400px the bar is
already 41px wider than the window — the spacer is collapsed to 0 and
Print/Export loses letters. So Lighting is **icon-only** (33px, the width of
Undo/Redo), and `.tb-gap` — the decorative 26px before Save/Print — was made
shrinkable (`flex:0 1 auto;min-width:6px`) so it gives that space back only
when the bar is over budget and looks unchanged when it isn't. Net cost at
1400px is about 20px. The bar being over budget at all is older than this
change and still wants solving.

**`__C` gained** `setExposure`, `setLighting`, `resetLighting`, `openLighting`,
`closeLighting`, `lighting` (a copy, settable), `lightDefaults`, `lightLimits`,
`lightPresets` and `hemiLight`.

Suites after the change: verify 12/12 (identical to `ver-lamp2.json` ignoring
ms), verify-live allOk, `facesel-lane.js` 14/14, `brepsel-lane.js` pins
unchanged (47/21/2, 48/48), `lighttool.js` 10/10, no page errors. The only
thing that moved anywhere is the model menu's entry count — 29→30 and 28→29 in
facesel's two menu assertions — which is `v_light` arriving. Shots:
`scratchpad/lamp/light-default.png`, `light-bright.png`, `light-moody.png`,
`light-workshop.png`, `light-dialog.png`.
