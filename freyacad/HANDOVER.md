# freyacad — handover

Browser CAD at `/freyacad`. One ~10,300-line `index.html`, no build step, no framework.
Open CASCADE compiled to WASM (CDN, 50 MB raw / 13 MB brotli over the wire) does the
geometry; three.js r128 draws it.

## The one standing rule

**`help.html` is part of the feature, not a chore afterwards.** Anything that changes what
the user sees or does — a new tool, a shortcut, a menu entry, a changed default, a limit
that gets lifted — updates the manual in the same commit. Also bump the "last revised"
date in two places: `#stamp` near the top and the `<footer>`.

The manual states its own limits (no arc tool, no datum-plane dimensions, params outside
undo). When one of those gets fixed, delete the note — a stale caveat is worse than none,
because it teaches people to work around a problem that no longer exists. The "no
constraint solver" caveat went that way when phase 2 wired PlaneGCS up, and the "no
perpendicular/tangent/symmetric constraint tool" one went when the five relationship tools
landed; do the same with the next one.

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
`comp.color` tints assembly components (`matFor` shared material cache), and a component may
now ALSO carry `appearance` (the same `{part,bodies,faces}` record, painted by the shared
`paintBodies`) and `look:{opacity,emissive}` (which rides in the material cache key) — see
*The Magic lamp as an assembly*. Drawing shaded
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

**A real constraint solver *for sketches*** was this entry for a long time. It is done:
PlaneGCS is ported (`planegcs.js`) and wired into the DOF readout, dimension edits, drags
and constraint entry — see "A real constraint solver: PlaneGCS, ported" and "The solver
driving the sketcher (phase 2)" below. The two coverage gaps that used to sit here are
closed as far as the solver goes: **arcs are constrainable geometry** (upstream's `Arc`,
`Curve::Value` and `ConstraintCurveValue` are ported and wired into the variable model),
and **all five missing constraint tools** — perpendicular, tangent, symmetric, midpoint,
collinear — are in the dock. What is left of the arc half is the *sketcher*, not the
solver: there is no arc drawing tool, no arc rendering and no arc in the kernel path, so
nothing produces one yet. See "Arcs the solver can hold" at the end of this file. Note the
assembly mate solver (trap 17) is still a separate thing: it projects rigid bodies in 3D,
and sketch entities are neither rigid nor 3D.

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

## The Magic lamp as an assembly (the genie demo)

The lamp demo was one merged solid: a revolved hull, two swept tubes and a revolved
lid, all fused together. It is now **three parts and two mates**, and it is drawn the
way the object on the owner's reference photograph is actually made rather than the
way a revolve wants it to be. The old model has not been touched — see *the hidden
fixture* below.

### What is in the file

`DEMO_GENIE` is one `{components,mates}` record, ~70 KB inline beside `DEMO_LAMP`, and
`DEMOS` gains `{key:'genie', kind:'assembly', …}`. 212 features across three components:

| part | features | bodies | how it is built |
|---|---|---|---|
| Lamp | 176 | 19 | revolve + loft + loft + **lofted scroll** + revolve + two lofted medallions, a lofted cut and a cut — then eighteen ornament bodies that touch no boolean |
| Lid | 2 | 1 | one revolved spline profile |
| Genie | 34 | 1 | two ruled lofts, one sweep, one cut |

**The hull is a loft, not a revolve.** Six horizontal sections on six offset `dplane`s
based on Top, each a closed spline round a *superellipse* — `|x/a|^n + |y/b|^n = 1` at
n = 1.45, fourteen points. n < 2 is what pinches the ends into a boat's lens; n = 2 is
an ellipse and the hull reads as a barrel. The sections grow from 1.65 × 1.60 at the
stem to 12.70 × 5.00 at the shoulder (y = 11.6) and close to 2.60 × 2.20 under the
collar. Smooth, not ruled.

**The spout is a loft up a chain of tilted planes**, and this is the case lofts were
built for. `Spout base` stands off Top at y = 11; `Spout plane 1` is based on it, turned
**84°** about the base's `v` so its normal points out along +X and 6° up, and floated
8.547 along that new normal. Every plane after it is based on the one before, turns
another 6° (5° at the lip) and floats about 3 mm further — which composes into a discretised
arc, because `planeFrame` tilts first and *then* offsets along the tilted normal. The
sections are circles: Ø4.0 buried in the hull, tapering to Ø1.7 at the neck, then
flaring back out to Ø2.6 at the lip. **A sweep cannot make that**: `MakePipeShell`
carries one constant profile. The handle used to be a sweep, because it used to be a
constant tube; it is a run of tilted planes now too — see *the ornament* below.

**The genie is faceted on purpose.** Every section is a hexagon (`polygon`, 6 sides) and
both of its lofts are `ruled:true`, so the whole figure is flat panels and reads as
machined rather than drawn — which is the joke the owner asked for ("AGI genie"). The
plume starts in the spout's mouth, leans back over the lamp, swells into a chest and
finishes in a head with **eye sockets and a mouth cut clean through** (one `cut` with
`through:true` on a Front-plane sketch holding two circles and a rectangle — one sketch,
one boolean). The arms are ONE hexagonal bar swept hand-to-hand across the shoulders on
a single spline path: two arms for the price of one sweep.

### Numbers, if you change it and want to know what moved

Volumes from the meshes: **lamp 1442.4 over nineteen bodies (1388.3 of it the merged
one), lid 71.9, genie 230.6**; 26 k triangles for the lamp. Lamp box x −21.26…21.76,
y 0…19.04, z ±7.54 (the foot's scallops are the widest thing on it). Cold build of the
whole assembly, headless with swiftshader: **22.0 s**, and 21.7–24.9 s over a dozen runs
on a box whose own load moves it about ±1.5 s (it was 14–17 s before the ornament; the
old single-solid lamp was 6.7–6.9 s). Of that 22 s the lamp is **15.8**: 12.7 s of
construction, 2.8 s to mesh nineteen bodies, 0.3 s of edge meshes and 0.1 s of face
painting — measured with `$SP/ornate/phases.js`. Both mates solve to **0.0
exactly** on load — the components ship in their solved positions, so the first
`solveMates` has nothing to do.

### The ornament: a scrolled handle and gold relief (owner's ask, 2026-09)

*"the handle especially is way too simple — look at the photos again, make the handle and
the body more ornate."* The photograph is a cast brass lamp with teal enamel: a thick
**scroll** handle that leaves the top of the body as a broad ribbon, sweeps up into a big
open C and curls inward into a spiral, with a counter-curl where it meets the body; and a
hull covered in raised gold — a cartouche each side, swirls, beaded rims round the collar
and the foot, a scalloped foot and small red cabochons.

**The handle is a ribbon lofted up a run of tilted planes**, the spout's trick turned
sideways. The spout's chain leans on `Top` and turns about `v`, so its normal sweeps the
XZ plane; the handle's chain leans on **`Right`** and turns about `u`, so its normal stays
in **XY** and the section's own x runs across the lamp. One anchor plane reaches the first
station in polar form (`angle` = the bearing, `offset` = the distance), and every plane
after it stands square to the step that arrives at it — so **the run of planes IS the
centreline**, and the sums of `angle` and `offset` are the turn and the length of the
ribbon's path. That is what check 22 reads. A sweep could not do this: `MakePipeShell`
carries one constant profile, and the whole point is that the ribbon **tapers**, 4.0 × 2.1
where it leaves the hull down to 0.2 at the tip of the spiral.

It is three lofts, not one:

| piece | stations | merge | why |
|---|---|---|---|
| Handle arm | 14 | **true** | the C: buried in the hull's shoulder, up over the top, round the back and under. Fused, so the lamp is one solid where a hand would hold it |
| Handle scroll | 13 | false | the inward spiral, 476° of turning into a 3.1 mm footprint. Its own body |
| Handle leaf | 6 | false | the counter-curl at the root, turning the other way |

**Every loft in the handle is `ruled`, and that is load-bearing.** A smooth loft fits one
B-spline down the whole run; through sections a fifth of a turn apart it swings wide of
them — measured **1.9 mm past the arm's own first section** — and the solid then crosses
itself. Nothing complains: `IsDone` is true, the body meshes, the volume looks plausible.
Then the batched fuse eats half the hull, silently (1300 mm³ in, 701 out). `ruled`
skins section to section and lands exactly on the stations, and the fuse is then clean.
`--sabotage smooth` in `genie.js` puts the smooth version back and check 21 goes red on
the volume; that is the whole reason check 21 exists.

**Everything else is a separate body, and that is a price, not a preference.** Fusing a
tool into the hull costs about **0.3 s per lateral face** that crosses the hull's one
B-spline surface — measured, not guessed:

| tool | faces crossing the hull | cost |
|---|---|---|
| medallion, an 8-sided ellipse lofted | 8 | 1.2 s each side |
| the flank relief as it was first drawn, nine outlines of ~18 segments | ~162 | **40–73 s** each side |

So the medallions are merged (they are the volume-monotonic proof, and a cartouche wants
to be part of the casting) and everything else is `merge:false`: the relief, six bead
rings, the foot's scallops, three sets of jewels, the handle's scroll and leaf. Eighteen
bodies, **zero booleans**, 0.5 s for the lot. A body costs a mesh; a fuse costs a boolean,
and what bills is the number of booleans (trap 26).

**The relief sits the same height proud everywhere, and that took the skin's own
numbers.** The flank is a dome in both directions — 4.89 mm out at (−1, 11.4) and 3.5 at
its corners — so a flat outline extruded at one z stands anything from flush to a
millimetre proud, which is what makes ornament read as slabs stuck on rather than as
chasing. The hull's skin was raycast on a 17 × 13 grid (`$SP/ornate/surf.js`), the grid
lives in the generator, and every element is BANDED by the skin height under its own
outline: three bands a side, each with its own plane at `skin + 0.28`. Nothing on the
lamp stands less than 0.28 or more than 0.76 proud.

Three measured facts about the ornament's cost, all of them counter-intuitive:

- **A round bead costs 228 triangles.** The mesher's angular deflection is scale-free
  (0.22 rad, ≥28 chords a turn) so a 0.4 mm bead is tessellated as finely as a 40 mm boss.
  Ninety-eight beads were 22 k triangles on their own. They are **polygons** now — eight
  sides, circumradius corrected so the flats sit where the circle was — and the lamp went
  from 57 k triangles to 26 k for a difference nobody can see at 0.4 mm.
- **One long prism is worse than two short ones.** The hull is symmetric about Front, so
  each relief band could be ONE body extruded symmetrically through the lamp instead of
  two. It halves the bodies — and BRepMesh answers a 9.6 mm long thin planar face with a
  grid, 2 700 triangles an element against 150. It measured 2 s *slower*. Two bodies.
- **Bodies are cheaper than they look.** Meshing nineteen of them is 2.8 s, their edge
  meshes 0.3 s and the face painter 0.1 s. The build's 12.7 s of construction is where the
  money goes, and 4.6 s of that is the ONE fuse that carries the handle's arm into the
  hull. Dropping the arm's section from a 16-point superellipse to a 12-point one, and the
  medallion from five sections to four, took 1.9 s off without changing either shape.

Two rules follow from that, and both are easy to break by accident:

1. **A ring of small things is ONE feature, not N.** `OCK.extrude` builds one prism per
   closed region of the sketch and `unionOne`s them, and `unionAll` groups by bounding box
   first — so twenty polygons whose boxes do not touch come back as one compound of twenty
   solids with **no boolean at all**. Every bead ring is one sketch on one datum plane.
   The corollary is that overlapping outlines in one sketch DO cost a fuse: the first
   version of the flank relief had five overlapping palmette leaves and two crossing
   strokes, and paid 2.7 s a side for it. They are laid out bbox-disjoint now (the shell
   sits where the strokes are not, the strokes are split above and below) and it costs
   0.05 s.
2. **Every merge:true feature must come BEFORE every merge:false one.** `applyPending`
   fuses its tools against *all* of `resultShapes`, and `unionAll` groups by bounding box —
   so a merge that runs after a separate body has been pushed drags that body into the
   fuse with it. Interleaving the two flanks (medallion, scrollwork, medallion,
   scrollwork) cost **24 s** for exactly that reason: the near flank's relief, already a
   body, was swept into the far medallion's fuse. The tree is ordered merges → cuts →
   bodies, and the comment in the demo says so.

What the ornament is, body by body: the handle's **scroll** and **leaf**; **gold relief**
on each flank in three bands — a framed oval cartouche (an outer and an inner ellipse in
one sketch, so `regions` reads the inner one as a hole and the boss comes out as a frame),
six tapering arc-band strokes, six florets, two pointed leaves and a six-lobed scallop
shell; **six bead rings** (stem, collar, collar rim, foot, and two on
the spout — the spout's ride on the spout's own tilted planes, so they sit square to it);
the **foot's scallops**, twelve half-buried lobes round the rim; and **three sets of red
cabochons**, three a side on the hull plus one on the spout, coloured through
`appearance.bodies` by body index. The medallion each side is merged. Gold needs no
paint at all: the component's colour IS gold and the hull's teal is painted per face, so
every raised body reads as relief over enamel exactly as the photograph does.

**The enamel's face signature had to be re-pinned.** Merging the medallions re-fits the
hull's one big surface, and its fitted direction moved from `[-0.346,-0.938,0]` to
`[-0.172,-0.985,0]` — a dot of 0.977 against `sigMatch`'s 0.985 floor, so the teal fell
off the hull and the count in check 13 went 5 → 4. The stored signature in
`appearance.faces[0]` is re-measured off the built model (`$SP/ornate/faces.json` is how,
and `build.js` writes it in); the other four were untouched. If you change the hull or
what is fused into it, expect to do this again — and check 13 is what tells you.

**Cost of the whole thing.** The lamp's construction is 12.7 s of the assembly's 22 s:
3.2 s foot + hull + spout, **4.6 s for the ONE fuse that carries the arm into the hull**,
0.8 s collar, 2.4 s for the two medallions, 1 s for the two bores and 0.5 s for all
eighteen bodies. The rest is meshing (26 k triangles, 2.8 s), the lid, the genie, the
first solve and the tree. The budget was 25 s and it measures **21.6–23.4 s** cold on the
headless box, which moves about ±1.5 s with the box's own load.

**Left out on purpose.** The spout's enamel panels edged in gold (the photograph has them;
they need either a per-face paint the loft cannot give — the spout is one face — or a
dozen more merged tools at 0.3 s a face). The rope moulding that runs along the real
handle's spine, for the same reason. And the beads are extruded polygons rather than
hemispheres — a ring of spheres cannot be one feature in this kernel (a revolve turns
about one axis), and 20 revolves would be 20 bodies for a detail 0.3 mm across.

**One thing the rendered view will always do.** Metal at `metalness 0.96` has no diffuse
term: what you see is the studio panorama reflected in it. A big FLAT face pointing
sideways reflects the panorama's dark horizon and goes black, which is why the first cut
of this ornament — one 5 mm oval slab and three thick crescents — read as holes in the
rendered view while the workshop view (roughness 0.9, metalness 0) showed them gold. The
normals were never wrong: they measure `[0,0,1]` and the materials are DoubleSide either
way (`$SP/ornate/normals.js`). The answer is geometric, and it is the same answer as
"make it finer": no flat face bigger than a millimetre or so. The cartouche is a lofted
dome that comes almost to a point, the strokes are 0.3 mm wide, and the florets are
polygons whose walls always catch the light somewhere.

### Job A: what the plumbing had to learn

1. **`loadDemo` handles `kind:'assembly'`** by going *through* `loadDocData`'s assembly
   branch rather than round it: that branch reissues component ids, remaps the mates onto
   them and runs the first solve, and a second copy of all three in `loadDemo` would be a
   second thing to keep in step. It clears the part document on the way in, and the part
   branch already clears an assembly coming back, so both directions work. `loadDocData`
   is a *file* path and files are not demos, so it sets `demoActive=false`; `loadDemo`
   sets it again afterwards, or the Demo button goes dark on its own demo.
2. **Hidden demos.** `{hidden:true}` keeps an entry loadable by key but off the menu
   (`openDemoMenu` filters), and `replaces` names the demo that took its place —
   `demoPref()` maps a stored preference for a hidden key to that heir, so a visitor
   whose last pick was the old lamp gets the new one rather than a ghost.
3. **Per-component appearance.** The face painter is now `paintBodies(meshes, app, base,
   mat, fmat)` and `applyAppearance()` is a one-line caller of it. `buildComponent` is the
   other caller, so `comp.appearance` — the same `{part,bodies,faces}` record a part has —
   paints a component face by face. `base` is what a body wears when the appearance names
   no colour: null in a part, `comp.color` in an assembly, so `comp.color` behaves exactly
   as it did and `appearance.part` simply outranks it. The demo exercises **both** routes
   on purpose: the lamp carries `comp.color` and no `appearance.part`, the lid carries
   `appearance.part` and `color:null`.
4. **Per-component look.** `comp.look = {opacity, emissive}` goes into the **material
   cache key** (`matFor(hex, look)` / `faceMatFor(hex, look)` via `lookKey`), not onto a
   material after the fact — so two components in the same hex with different looks are
   two materials, `eachBodyMaterial` still reaches both, and the rendered-view toggle and
   the lighting sliders keep working over a ghost. `applyRenderLook` writes roughness,
   metalness and envMapIntensity and **nothing else**, which is what keeps a ghost a ghost
   across the toggle; there is now a comment there saying so.

Three things about a translucent component that are not obvious:

- `depthWrite:false` **and** `side:FrontSide`. A DoubleSide ghost sorts its own back faces
  against its front ones and the lamp inside it disappears.
- `mesh.renderOrder = 10` so it is drawn after everything opaque. Without it the ghost
  sorts against whatever happens to precede it in the component list.
- `refreshAsmSel` writes the selection highlight into `material.emissive`. It now restores
  `comp.look.emissive` on deselect instead of 0 — otherwise picking the genie once would
  put its glow out for good.

### The hidden fixture

`DEMO_LAMP` and `DEMO_LAMP_APP` are **byte-identical** to what they were, and the entry is
`{key:'lamp', hidden:true, replaces:'genie', …unchanged…}`. That is deliberate and it is
load-bearing: `brepsel.js` pins 47 real edges / 21 faces / 2 planes / 14765 triangles /
48-of-48 whole-edge on that exact solid, and `lights.js` check 9 and `lighttool-main`
compare the lamp's rendered and workshop **frames byte for byte against a pre-lights
build**. Anything that changes that model, or how its painted faces shade, breaks a
pixel contract in another suite. `loadDemo('lamp')` still works, which is all those
suites ask for.

### What is still wrong

- **A loft through closed splines is ONE face.** The whole hull skin signs as a single
  `k:'other'` surface of 476 mm², so the enamel can paint it as one panel and cannot paint
  the several the photograph has. If per-panel colour on a lofted body ever matters, the
  answer is more features (separate lofts, or cut grooves), not a cleverer painter.
- **Painted faces shade flat.** `faceTriGeom` un-indexes the face's triangles and calls
  `computeVertexNormals()`, which gives flat normals, so the teal hull and foot look
  faceted next to the smooth gold beside them. Copying the source geometry's normals
  would fix it in one line — **and would break `lights.js` check 9**, which requires the
  old lamp's frames to be byte-identical to a pre-lights build. Do it in the same commit
  as a deliberate rebaseline of those two suites, or not at all.
- **A self-intersecting merged tool is silently poisonous**, and this cost an hour. The
  first handle looped back so tightly that its return arm ran through its outbound arm.
  `OCK.sweep` was happy — `IsDone`, `MakeSolid` and the volume check all passed, and the
  tube alone measured and drew correctly. But the batched fuse that followed **dropped the
  hull entirely** and reported no error: 1320 mm³ of foot + hull + spout went in and 443
  mm³ of foot + handle came out, `comp.error` null, no page error. If a merged feature
  makes an earlier one vanish, suspect an invalid *argument*, not the boolean.
  Two things are known about it now (2026-09). A **swept tube** on a self-crossing path no
  longer reproduces it on this build: seven paths were tried against the ornate lamp —
  crossing, doubling back, retracing itself exactly, closing into a loop, turning tighter
  than the tube is wide — and every one of them fused correctly, volume rising by the
  tube's own volume each time. A **coarse smooth loft** reproduces it perfectly: five
  sections a fifth of a turn apart, skinned smooth, swings 1.9 mm wide of its own end
  section and the fuse then deletes half the hull (1300.5 → 701.1 mm³, no error).
  That is what `--sabotage smooth` does and what check 21 catches. The rule stands
  whatever the kernel version does with a given shape: **after every merged feature the
  volume must go up**, and the suite now asserts it step by step.
- The build is slow: **~22 s cold**, against ~15 s before the ornament and 6.7 s for the
  old single-solid lamp. Seven lofts, two cuts, one batched fuse over a spline hull and
  fifteen meshes. It is a demo you choose rather than the boot default (that is still
  `pillow`), so it is tolerable — but the budget is 25 s and there is now only about 3 s
  of room. Anything else that has to be *merged* costs ~0.3 s per face it crosses the hull
  with; anything that can be its own body costs a mesh and nothing else.
- The genie is placed with `fixed:true` and a transform rather than a mate to the spout's
  mouth. A coincident mate there would be nicer and would survive the spout being edited;
  it was left out because the demo's contract is "two mates", both of them the lid's.

### Tests

`$SP/newdemos/genie.js`, 23 checks: the registry (hidden/offered, and the *rendered* menu
opened with a real click), `demoPref`'s mapping, the load (3 components, 2 mates, no
lights, every component `error===null`), **the bodies and features each part ships with**
(19/176, 1/2, 1/34 — losing a body silently is what a bad merge looks like), the volumes,
both mate errors, **the lid measured in world** (the collar's rim plane and the lid's
underside plane recovered from the built faces through each component's world matrix and
compared as planes and axes — not read back off the mate), the bore/spigot fit, the look
and its cache key, the painted overlay counts, the rendered-view round trip, the hidden
lamp's shape counts as a canary, the round trip out to a part demo and back, and two that
came with the ornament:

- **21, every merged feature makes the lamp bigger.** The lamp is rebuilt through
  `buildPartShapes` at each `merge:true` solid feature and the total mesh volume must rise
  every time: 427.0 → 1253.6 → 1300.5 → 1371.4 → 1419.3 → 1423.8 → 1425.4 mm³. Seven
  builds, ~10 s. This is the check that catches a self-intersecting tool, which OCCT
  answers by deleting a *different* argument without an error.
- **22, the handle is a tapered scroll.** Read off the run of tilted planes, which is the
  centreline: the arm turns 281° and the coil 476°, the coil's path is 6.09 mm long and
  its whole footprint is 3.12 mm, and the coil weighs 6.6 mm³ against the 13.1 a ribbon of
  its starting section would weigh over that length (6.6 against 12.9) — so it turns, it
  coils, and it tapers. Then the coil is built on its own and matched by volume against one of the
  lamp's shipped bodies, so the check is about the model and not about the numbers in it.

It also writes `$SP/ornate-workshop.png` and `$SP/ornate-rendered.png`, the two pictures
the ornament is judged by, and reports `summary.coldBuildMs`.

**Verified able to fail.** `--sabotage mate` drops a mate (checks 4 and 7 go red);
`--sabotage opacity` makes the genie solid (11 and 15); `--sabotage enamel` strips the
overlays (13); `--sabotage lid` shoves the lid 3 up and 2 across (7, 9 and 10);
`--sabotage handle` puts the old constant swept tube back in place of the scroll (22);
`--sabotage smooth` draws the arm the way it was first drawn, a smooth skin through every
third section, and the fuse eats the hull (21 goes red naming `Handle arm`, 1300.5 →
701.1 mm³ with no error anywhere).

Three of the twenty-one are about the autosave, because `restoreAutosave` had to change:
`asmSig` must ignore the build's bookkeeping and not the user's edits; an assembly demo left
untouched must boot as the demo rather than as "restored your unsaved work"; and an EDITED
one must come back, with its look and its enamel. The last of those is not optional — without
it the middle one would pass on a `restoreAutosave` that simply never restores an assembly,
which is exactly what the code used to do.

One thing that is NOT this lane's fault, found while running the battery: **`boltnut.js` is
flaky**, about one run in three, on unmodified HEAD as well as on this branch. It fails on
its second click ("That is not a flat face"), which is a screen-coordinate click taken 300 ms
after `controls.update()` — under swiftshader that is a handful of frames and the camera can
still be moving when the point is projected. Re-running passes and the output then matches
`$SP/bat-boltnut.json` exactly. A longer settle before that click would fix it.

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

## The Detail slider

`meshDetail` (module scope, beside the lighting state) divides both of
`OCK.mesh`'s deflections — linear and the 0.22 rad angular — so ×3 draws
curved faces in ≈4° steps. ×1 is bit-identical to the pre-slider
tessellation, which is why every mesh-derived pin (brepsel counts, chord
counts, sig areas) holds: suites boot with clean storage and never move the
slider. The slider lives at the bottom of the Lighting panel under a MODEL
DETAIL heading, range ×1–×3 step 0.25, and deliberately cannot go below ×1:
`resultGeoms` feeds Print/Export as well as the viewport, so a coarser
setting would quietly degrade prints. It applies on `change`, not `input` —
a rebuild takes seconds — with a hint while it runs; Reset in the panel
also returns it to ×1 (its own handler, `resetLighting()` itself is
untouched). Stored under its own `fcad-detail` key, removed at ×1 so an
untouched session leaves no key; loaded at parse so the first build of a
returning session is already fine. `__C.setMeshDetail` / `__C.meshDetail`
drive it in tests; `$SP/newdemos/detail.js` is the probe.

## Kernel preload: the 2.4 seconds that were doing nothing

The kernel loader is a `<script type="module">` whose import is *dynamic*
(`await import(base + 'opencascade.full.js')`), so its request was not issued
when the document was parsed — it was issued when `go()` actually ran, which is
after `three.min.js` (a blocking classic script) had been fetched, parsed and
executed, and after the whole document had been parsed. Measured cold with a
180 ms CDN latency simulated (`$SP/newdemos/loadseq.js`):

```
index.html request      37 ms
three.js request       112 ms
kernel JS request     2488 ms   <- 13 MB, and the connection was idle until here
kernel WASM request   2755 ms
```

`<head>` now declares `window.__OCCT_SOURCES` and injects `preconnect` +
`modulepreload` + `preload as=fetch` for the first source, before the blocking
three.js tag. Same fetch, started at parse time: the kernel request moves to
**47–81 ms** across runs. End-to-end "kernel ready" also improves, but that
number is noisy in the harness (software rasteriser, local mirror), so the
request-start figure is the one to trust and the one to re-measure after any
change to the head.

Two things this depends on, both easy to break:

- **One source of truth.** The loader reads `window.__OCCT_SOURCES`; the hints
  are built from the same array. Hard-coding the version in either place again
  would let them drift, and a preload of the wrong version is a wasted 13 MB
  rather than a saving.
- **Anonymous CORS on both hints.** A module script is always fetched with
  CORS, and emscripten requests the `.wasm` with `credentials:'same-origin'`,
  which sends none cross-origin. If a hint's credentials mode stops matching
  the real fetch, the preload lands in a different cache entry and the file is
  downloaded **twice**. `loadseq.js` reports `requestCounts` for exactly this;
  it must stay `{kernelJS: 1, kernelWASM: 1}`.

The hints are skipped when `__MOBILE_GATE` is set — a phone must not pull 13 MB
for an app it is not going to run.

Worth being clear about what this is *not*: it is not caching. jsDelivr already
serves these version-pinned URLs as immutable, so a repeat visit was always a
cache hit, and browsers keep a compiled-wasm code cache keyed by URL on top of
that. There was no speed left in caching the CDN harder — the loss was purely
scheduling. Caching work (a service worker) buys resilience and offline
instead, and is stage 2 of PLAN-HARDWARE.md.

## Offline (sw.js)

freyacad works with the network off: `freyacad/sw.js` precaches the app shell
and holds the CDN kernel, so a reload with no connection boots the app and
builds the same geometry. Proof is `$SP/newdemos/offline.js` — 9/9, ending on
the lamp building to the same 14,765 triangles offline as online.

Why this was possible now rather than only after self-hosting (PLAN-HARDWARE.md
said the latter, and was wrong): a service worker genuinely cannot make useful
offline out of an **opaque** cross-origin response, but the kernel's responses
are not opaque. jsDelivr sends `Access-Control-Allow-Origin` — it has to, or the
cross-origin `import()` in the loader could not work at all — so what reaches
the worker is a real, inspectable, cacheable response. **If the kernel ever
moves to a host that does not send CORS, offline dies with it.**

Shape of it:

- **Navigations are network-first**, cache as fallback. index.html *is* the
  app, so this is what keeps a deploy from being shadowed by a stale cache.
  Same-origin statics are stale-while-revalidate; the kernel is cache-first
  (its URL is version-pinned and immutable).
- **The kernel is matched by FILENAME** (`opencascade.full.js` / `.wasm`), not
  by hostname. An allowlist of CDN hosts would silently stop caching the day
  the kernel moves — to the unpkg fallback, or to our own origin in stage 2 —
  and offline would vanish with nothing failing to say so.
- **The page hands the worker the base it actually used**, once the kernel is
  up (`freyacad-cache-kernel`), and the worker answers with what it managed to
  hold (`window.__OFFLINE_READY = {stored, error}`). Two reasons for the
  hand-off rather than a constant in sw.js: on a first visit the worker is not
  yet controlling the page, so it never sees the kernel fetch and offline would
  not start working until the *third* visit; and only the page knows whether
  the primary CDN or the fallback actually answered.
- **Never intercepted**: non-GET (the shelf POSTs), `/api/*`, and any
  cross-origin request that is not one of those two kernel files.
- **No skipWaiting, no clients.claim.** This is a CAD app; swapping assets
  under someone with unsaved work to save them one reload is a bad trade. A new
  worker installs, waits, and takes over on the next load.
- **`?nosw` unregisters it and drops every cache.** A broken service worker is
  the one class of bug that can outlive the deploy that fixes it, so there is
  always a way out. `_headers` also serves `sw.js` as `no-cache`, so a fix can
  always reach the browsers running the broken version.

Testing note that cost an hour: **a service worker's own fetches do not go
through Playwright's request routing.** The first version of `offline.js`
mocked the CDN with `context.route` and the worker never saw it — "Failed to
fetch", which looked exactly like an app bug. The suite now runs a second local
http server as a real, reachable, genuinely cross-origin CORS host (different
port = different origin) and serves index.html with its kernel sources
rewritten to point at it, so page and worker see identical content. Do not
"simplify" that back into a route mock.

### The worker stays out of the way until it holds the kernel

`sw.js` only calls `respondWith` for a kernel file once it is **actually
holding** that file (`kernelHave`, a synchronous Set scanned at worker
start — `fetch` handlers must decide before anything can be awaited; `null`
means "not scanned yet", and then we intercept, because falling back to the
network is safe and being wrong the other way is not).

This started as a test failure and turned into a real improvement. Every suite
that reloads a page — `lighttool` first — began timing out waiting for the
kernel, because once the worker controlled the page it re-fetched the kernel
*from inside the worker*, and **a service worker's own fetches bypass
Playwright's request routing**, so the harness's mocked CDN was invisible to
it. The fix is not a test accommodation: on a first visit the worker has
nothing to offer, and interposing there only adds another place for a 13 MB
download to fail while buying nothing. First-visit caching still happens, via
the explicit `freyacad-cache-kernel` message from the page.

## Lights you place (per document)

The owner's ask, verbatim: *"add as many lights as the user would like that they
can move around in 3d space to light up the model"*, settled as — **per
document**, **the model is the only shadow caster and the shadow has to cover
the whole model**, **drag in x/y/z with the mouse**, **aim anywhere on the full
sphere with a handle**.

Before this, `hemiLight` was the scene's only light. A hemisphere light casts no
shadows, so **nothing in freyacad had ever cast one** — the 600×600
`ShadowMaterial` floor had been sitting there waiting since the beginning. These
lamps are the first things to use it.

### The record

Plain JSON, flat, nothing derived:

```js
{ id, name,
  type: 'point' | 'spot' | 'directional',
  pos:  [x, y, z],          // where the lamp is
  dir:  [x, y, z],          // unit vector: the way it SHINES
  color: '#rrggbb', intensity,
  distance,                 // "Reach"; 0 = never fades
  angle, penumbra,          // spot only
  shadow: true, on: true }
```

`dir` is a direction, not a target point, so **moving a lamp never changes where
it aims** — which is what makes the translate and aim handles independent. A
point light has no aim; its `dir` is kept (so a type swap and back does not lose
it) but neither used nor shown. Everything that reaches the app goes through
`normLight`, which clamps and falls back rather than throwing, so a hand-edited
file opens with a dull light in it rather than a blank page.

Defaults for a new lamp: spot, intensity 0.9, white, Reach 0 (no falloff —
`decay 1` with `distance 0` is three.js's "no attenuation", so dragging a lamp
across a 300 mm baseplate keeps the brightness you set), cone 0.6 rad, penumbra
0.35, shadow on.

### File format

`{type:'part', appearance, lights, features}`. Both middle keys are optional and
**a part with neither still writes the bare array** every earlier build wrote and
reads, so adding this feature churns not one document that never used it —
including `models/magic-lamp.sketchcad`, which is byte-identical. `partFileData`
stays the single reader for all three shapes (bare array, `{appearance}`,
`{appearance,lights}`); `loadDocData` the single loader. Lights also ride in the
autosave payload, next to `appearance`.

Lamps belong to a **part** document. `doNewPart`, `loadDemo`, loading an
assembly, and stepping into assembly mode all clear them; a drawing keeps its
model — and its lamps — alive underneath, so only `asm` clears. **No demo ships
lamps**, deliberately: the shipped models have to render exactly as they did.

### Fitting the shadow to the model

This is the part that is easy to get wrong and the owner called out. A shadow
map records the **casters**, but the shader only darkens a **receiver** whose
position falls inside that same map. Size the frustum to the model's bounding
box and the shadow on the floor is cut off at the model's own footprint, with a
hard straight edge where the frustum ended. So the set of points the camera has
to contain is the model's eight corners **and where each of them lands on the
ground under this particular lamp** (`lightCover`).

- **Directional** — replicate exactly what `DirectionalLightShadow.updateMatrices`
  will do at draw time (camera at the light, `lookAt` the target, r128's default
  up), then measure the cover points in *that* camera's space and set
  left/right/top/bottom/near/far from the extents. Sizing from a bounding sphere
  about the model centre instead leaves the frustum off-axis and clips one side.
- **Spot** — three.js sets `fov` from `light.angle`, so the frustum *is* the
  cone and it cannot clip laterally; only the depth range is ours, taken along
  the spot axis.
- **Point** — a cube camera, so only near/far.

Nothing is hardcoded. Measured on the lamp (26.7 mm model radius) the sun's
ortho frustum comes out 51 units wide; on a 5×4 Gridfinity baseplate (134 mm
radius) the same lamp gets 285 — a **5.6× frustum for a 5× model**, and every
cover point inside the unit cube in both. `lightRefit()` runs from the rebuild
tail, so a rollback, a detail change or a new demo re-fits every lamp.

One deliberate limit: a lamp near the horizon throws the shadow towards
infinity, and a frustum that wide has no resolution left for the model. Past
`LIGHT_SHADOW_SPAN` (6) model-radii from the centre the ground points are
clamped, so the shadow fades out rather than being drawn as mush.

`normalBias` scales with the model (`max(0.008, r*0.02)`) — a 400 mm plate and a
3 mm boss cannot share one acne constant.

### The floor, and why it changes when you add a lamp

The first working version cast correct shadows that **nobody could see**: the
floor is a `ShadowMaterial` at opacity 0.3 over a near-black backdrop, so a
shadow on it moved the pixels by about four levels. Raising the opacity, and
then lifting the plane above the grid so the wires darkened too, both helped and
neither was enough.

So the floor now has two states. With **no lamps** it is the `ShadowMaterial` it
has always been — invisible, only ever a darkening, and byte-identical to every
earlier build. The moment there is a lamp, it becomes a real matte
`MeshStandardMaterial` (0x171f28, roughness 0.97, `envMapIntensity` 0.15) that
the lamps light, and the shadow is the part of it they do not reach. That single
change is the difference between "the shadow is technically there" and a
viewport that looks like a CAD app.

### The gizmo — hand-rolled, and why

r128 core has no `TransformControls`, and vendoring one is off the table: a
strict offline service worker and preload hints would both have to learn about a
new file. So:

**Translate.** For axis `a`, the drag plane is the one that *contains* the axis
and faces the camera most squarely — take the camera's look direction and strip
the component along `a`; what is left is the plane normal. Intersect the pointer
ray with that plane through the lamp, take `(hit − origin)·a`, and subtract the
same quantity captured at grab time. Edge on (camera staring down the axis) the
normal vanishes, so fall back to any perpendicular rather than hand out a NaN
position.

**Aim.** The obvious mapping — screen point onto a virtual sphere (Shoemake) —
was written first and is **wrong here, and the suite caught it**: it saturates at
its own silhouette, so one long drag runs out of ball and the aim sticks. It got
`dir.y` to −0.28 and no further. What ships instead is a path-length turntable:
each pointermove contributes a rotation about
`normalize((dy, dx, 0))` in camera space (the axis that carries the near side of
the ball along the drag), by `hypot(dx,dy)/canvasHeight × 2π`, applied to `dir`
and accumulated. It has no edge to run off, and **poles are not special to any
of it** — straight up and straight down are two ordinary points on a great
circle. Measured: one 840 px drag sweeps `dir.y` from −0.99 through +0.9996 and
out the other side, biggest step 5.9°, unit error 7e−7.

**Grabbing.** An arrow thin enough to see past is about ten pixels wide, which
is fiddly. Each handle therefore carries an **invisible fat sleeve** — three.js
raycasts an object handed to it directly whether or not it is `visible`, so it
costs nothing to draw and makes the whole shaft grabbable.

**Scale.** Everything is built at unit size and scaled per frame by
`controls.sph.radius × 0.024`, so a handle is the same size on screen at any
zoom. A gizmo you cannot grab at a baseplate's zoom is no gizmo.

### The two contracts

**A — markers and gizmos exist only while the Lights section is open.** The
group is *added* on open and *removed* (not hidden) on close, and every piece of
it carries `userData.lightGiz` and `castShadow:false`, following the
`userData.faceCol` / `faceHl` pattern. Fourteen suites take screenshots and
count scene objects; a stray helper would break them and would show up in the
user's renders and drawing views. Verified: 22 tagged objects with the panel
open, 0 with it shut, and the body meshes still the only shadow casters.

**B — no lamps + panel shut = the pixels the previous build drew.** Verified at
700×450 in *both* the workshop and the rendered view: 0 of 315,000 pixels
differ, max channel delta 0. Everything the feature touches is gated on
`lights.length`: the floor material, `ground` position/renderOrder (now
unchanged either way), the gizmo group.

**Careful with the baseline.** `lighttool-main.js` pins its equivalent check
against `git show HEAD:freyacad/index.html`, and the lane is checkpointed as it
goes — by the time this suite ran, HEAD already carried the lights, and the
check would have passed for the wrong reason. `lights.js` therefore walks
`git rev-list` back to the last commit whose index.html has no `addLight(` in
it and uses that. **`lighttool-main.js`'s check 8 is now vacuous for the same
reason** and should be given the same treatment next time it is touched.

### What a lamp costs

`renderer.shadowMap.autoUpdate` is **off**, with a single `lightDirty()` called
from every mutation and from the rebuild tail: orbiting the camera does not
change a shadow, and paying four extra depth passes a frame to prove that is
wasteful. Measured on the demo lamp, 1400×900, SwiftShader (the suites'
software rasteriser — an order of magnitude slower than a GPU; read the ratios,
not the milliseconds), `readPixels` after each frame to force the pipeline to
drain:

| lamps | casters | shadows re-rendered every frame | camera-only (the app's policy) |
|---|---|---|---|
| 0 | 0 | 117 ms | 122 ms |
| 1 | 1 | 185 ms | 161 ms |
| 2 | 2 | 245 ms | 216 ms |
| 4 | 4 | 426 ms | 332 ms |
| 6 | 4 (2 capped) | 420 ms | 328 ms |
| 8 | 4 (4 capped) | 449 ms | 351 ms |
| 1 / 4 / 8, shadows **off** | 0 | 135 / 165 / 199 ms | — |

Two things worth knowing. **Most of a shadow's cost is in the main pass, not
the depth pass**: at four lamps, skipping the shadow-map render entirely only
saves ~22%, because the body shader is sampling four PCF-soft maps per
fragment. And **a lamp with shadows off is nearly free** — 8 of them cost 1.7×
the empty frame.

Hence `LIGHT_SHADOW_CAP = 4`. It is a **cap, not a silent drop**: lamps past it
still light the scene, and the panel names them and says why. Each shadow map
also costs a texture unit in the body shader, which is the other reason not to
let it run.

### Suite

`$SP/newdemos/lights.js` — 10/10. Add reaches the panel/scene/`__C`; each of
X, Y and Z moves the lamp along that axis only (to 1e−6) with the pixels
following; the aim handle sweeps both poles without flipping or sticking; every
cover point inside the frustum on a 30 mm part and a 210 mm one; round trip
through `docFile`/`loadDocData` identical; both legacy formats still open with
no lamps; deleting the last lamp returns the bare array; contract A; contract B;
zero page errors.

### Judgement calls and rough edges

- **A directional light's position does nothing to the lighting** — only its aim
  does. Dragging one still moves its handle and re-fits its shadow camera, and
  the panel says "a sun: parallel rays, so only the aim matters, not the
  distance". Left as-is rather than faked.
- **Assemblies have no lamps.** The record lives in the part file; the assembly
  file was left alone. The panel says so in asm mode.
- **The grid is still 24 mm.** On a 250 mm bin it is a postage stamp under the
  model. Pre-existing, but the lit floor makes it more obvious than it was.
- **The 600×600 floor has a visible edge** at the zoom a very large model needs.
  Also pre-existing; the lit floor makes it visible where the `ShadowMaterial`
  hid it.
- The `dragLight` / `dragPlane` scaffold that was already in the pointer
  handlers (declared, never assigned, three dead branches) is gone; the real
  handlers replace it.

## Offset datum planes

Before this, the plane tool only tilted. `planeFrame`'s `dplane` branch cloned
`DATUM[base]`, rotated u/v/n about one of the base's own in-plane axes, and
returned — so **every datum plane in freyacad passed through the world origin**
and there was no offset anywhere in the app. Its own comment said as much
("an angled plane, not a floating one"), while the header comment two lines
above already said "offset datum-plane features" and `planeLabelOf` already fell
back to the string `'offset plane'`. The naming had arrived well before the
maths.

Now the same tool also offsets: a set distance from an origin plane, from
another plane you added, or from a face of the model. The tilt is untouched.

### The record

```
{ id, type:'dplane', name:'Plane1',
  base:'Top'|'Front'|'Right'|'dp:<id>',   // or a plane's NAME; default 'Top'
  about:'u'|'v', angle:30,                // unchanged
  offset:0, flip:false,                   // new
  baseKind:'plane'|'face',                // absent === 'plane'
  faceSig:{k,p,d,r,a},                    // only when baseKind==='face'
  suppressed:false }
```

`base`/`about`/`angle` are exactly what every earlier document carries, and
every new key reads as "no offset, based on an origin plane" when it is absent
(`+pf.offset||0`, `pf.flip?-1:1`, `pf.baseKind==='face'`). A legacy record
therefore resolves through exactly the code path it always did plus one
`if(off)` that is false. The suite proves this against the *last commit that
does not contain `resolveFaceBase`* rather than against HEAD — this lane is
checkpoint-committed as it goes, and diffing against HEAD would compare the
build to itself.

Neither `models/magic-lamp.sketchcad`, `models/print-test-boat.sketchcad` nor
either demo contains a `dplane` at all, so there was nothing in them to
disturb; `verify` stays 12/12 and `brepsel` stays 47/21/14765.

### Composition order: base, then tilt, then offset

`planeFrame` reads top to bottom the way the panel does.

1. **Base** — `dplaneBaseFrame` resolves an origin plane, another `dplane`
   (fully, so its own tilt and offset are already in), or a face frame.
2. **Tilt** — rotate u/v/n about the base's own u or v by `angle`. `o` is left
   alone, which is what keeps an angle-only plane passing through the base's
   origin exactly as before.
3. **Offset** — `o += n * (offset * (flip ? -1 : 1))`, along the **tilted**
   normal.

Tilt first and offset second means the distance you type is measured square to
the plane you end up with, not to the base. Tilt 30° about Top's U and offset 5
lands the origin at `(0, 5cos30, 5sin30)` = `(0, 4.330127, 2.5)`, not at
`(0, 5, 0)`. The panel note says this in words and the suite asserts the
coordinates.

### The cycle guard

Plane A based on B based on A recursed until the tab died. `planeFrame` now
takes a second argument, `seen`: a `Set` of the plane ids already on the
resolution stack, created lazily on the first hop and threaded down. Entering
`dplaneBaseFrame` for a plane already in the set throws
`its base planes run in a circle — a plane cannot be built on itself`.

A visited set rather than a depth cap, because ids are unique so it is exact:
it catches a self-reference at depth 2, a two-plane loop at depth 3 and an
N-plane loop at depth N+1, and it never refuses a legal chain however deep. The
set only grows along the dplane→dplane path; a datum or face base terminates
before touching it.

That error reaches the tree because **`applyFeature` now resolves a `dplane`
instead of returning immediately**. It builds no geometry, as before — but a
plane can still be *wrong*, and resolving it in its own place in the run is what
puts a deleted base, a loop or a missing reference face onto the feature as
`f.error`, with the red `!` and the error dialog every other feature already
has. `drawRefGeometry` still swallows the throw and simply draws nothing, which
is now the right behaviour rather than the only behaviour.

The panel also refuses to *offer* a base that already leans on the plane being
edited, so you cannot build a loop through the UI at all; the resolver guard is
for files, hand-edits and anything that arrives from elsewhere.

### A plane started from a face

Faces carry no permanent name in the kernel. The record keeps the same kind of
signature the **surface colours** keep — `faceSig`: fitted kind, centroid,
direction, radius, area — and hunts for the face that still matches after every
rebuild. Storing a frozen frame (what sketch-on-a-face does) was the cheap
alternative and was rejected: a datum plane is a parametric object and a frozen
one would sit still while the model moved under it.

**Where it is resolved matters.** `resolveFaceBase` runs from `applyFeature`, at
the plane's own position in the tree, against the body as it stands *underneath*
it — `flushPending()` then `OCK.mesh` of each `resultShape`, then `regionsOf` /
`faceSig` / `fitFace`, exactly as `applyAppearance` does. Resolving against
`resultMeshes` instead (which is what colours do, after the rebuild) would have
been one line shorter and **one rebuild behind**: change the block's height and
the sketch built on the face-plane this pass would use last pass's face. The
price is one extra tessellation of the body and a flushed boolean batch, and
only for a model that actually has a face-referenced plane. The geometry is
disposed in a `finally`, and OCCT caches the triangulation on the shape, so the
second mesh at the tail of `rebuild` is nearly free.

**One deliberate deviation from the colour precedent.** `sigMatch` is untouched
— the colours behave exactly as they did — and the plane uses its own
`faceBaseMatch`, which is `sigMatch` with one thing forgiven and one thing
tightened:

* **forgiven**: a planar face may have slid **along its own normal**. Only the
  sideways component of the centroid difference is tested. Under `sigMatch`'s
  full-centroid test, a plane 4 mm above a 20×16 block's top face let go the
  moment the block grew by more than ~1.8 mm (`max(0.6, 0.1·√area)`), which
  breaks the plainest reason to reference a face at all. Measured in the suite:
  a 20×16 block 6 mm tall with a plane 5 mm off its top face sits at y=11; take
  the block to 11 mm and the plane is at y=16. It follows.
* **tightened**: the direction test is **signed** (`dot > 0.985`, not `|dot|`).
  A plane's fitted normal points out of the solid, so signed is what tells the
  top of a block from its bottom — and with the along-normal slide forgiven,
  `|dot|` would happily match one to the other. Round faces are refused
  outright; a plane needs a plane.

Everything else still has to hold: same surface kind, same facing direction, no
sideways move, and area within 0.7–1.43×. When several faces match — parallel
steps of the same size — the nearest centroid wins, the same tie-break
`applyAppearance` uses.

**When it lets go it says so.** No fallback, no frozen frame, no quiet jump:
`its reference face is no longer on the model` (or `no solid here to find its
reference face on` when there is no body at that point at all) lands on the
feature as an error and the plane stops drawing. Pick the face again and it
carries on. The stored signature is never rewritten during a rebuild — that
would churn `sigStr`, the checkpoint keys and the undo diff — so the reference
is always relative to the face as it was picked.

The resolved frame lives in a module-level `Map` (`dplaneFaceFrames`, id →
frame), cleared at the top of each full rebuild and refilled by
`resolveFaceBase`. Deliberately **not** on the record: the feature is
`JSON.stringify`d into the save file, into `sigStr` and into the undo
comparison, and a frame recomputed every rebuild has no business in any of the
three. `rebuildOverlaysOnly` keeps what the last full rebuild found, which is
correct — nothing about the model moved on that path.

### The pick

`pendingPlaneFace` sits beside `pendingAxisPick` and rides the machinery that
was already there: `showPickCard`, `armedPick`, `cancelPicks`, the Escape and
right-click cancels, the `canvas` pointerup dispatcher, and `rescuePlanarFace`
with its 12 px forgiveness for faces that are a few pixels across.
`consumePlaneFacePick` takes `faceAtPointer`, falls back to the rescue when the
ray landed on something curved, and stores `faceSig(geom, seed)` — the canonical
lowest-triangle seed, so sliding across a face never reads as a different one.
The frame is built by `frameFromNormal` from the face's **fitted centre**, not
the click point, using the same u/v recipe `makeFaceSketch` uses — so a plane on
a face and a sketch on that face line their axes up.

### Things that changed beyond "add an offset"

Two of these are bugs that were already there and only became visible because
an offset plane is a thing you actually look at and select.

* **`planeFrame` now prefers the panel's draft.** The panel edits a JSON clone
  (`draftFeat`) and only assigns it on Done, but `planeFrame` looked the plane
  up by id in `features` — so **dragging a plane's angle never previewed**; the
  quad sat still until you pressed Done. The lookup now stands the draft in for
  itself, exactly as `drawRefGeometry` and the checkpoint keys already do, and
  the suite asserts that dragging the offset moves the drawn quad and that
  Cancel puts it back.
* **`selectFeature` now redraws the reference geometry.** It refreshed the tree
  and the sketch overlays but not `refOverlay`, so selecting a plane or an axis
  highlighted the tree row and left the thing itself blue until some unrelated
  edit rebuilt. One line, asserted (`#4285f4` before, `#fbbc05` after).
* **`buildPartShapes` saves and restores `dplaneFaceFrames`.** It swaps
  `features`, `resultShapes`, `sketchData` and the pending-boolean state for a
  component part's list and puts them all back in a `finally` — the face-frame
  map had to join them, because feature ids are per-document and a component's
  plane would otherwise write over the open part's.
* **Switching a plane's base to "A face" zeroes the tilt** — once, on the first
  switch, and only when no face has been picked yet. The tool opens at 30°, and
  a plane 30° off the face you just clicked is a strange default; "parallel to
  this face, this far off" is what people mean. The tilt control is right there
  and still composes on a face base (asserted).
* **A plane may be based on a plane that sits below it in the tree.** The
  resolver reaches forward, and if that plane is face-referenced and has not run
  yet this rebuild, `dplaneBaseFrame` resolves it on demand rather than
  reporting a perfectly present face as missing. Asserted.
* `addSketchOnDPlane` no longer throws out of a menu handler when the plane is
  errored — it sets a hint saying why.

### Costs

One extra tessellation per face-referenced plane per full rebuild, plus the
boolean batch flushed at that point in the run. Zero for every other document:
`resolveFaceBase` is only reached from `baseKind==='face'`. `dplaneFaceFrames`
holds one `{o,u,v,n}` per such plane.

### Suite

`$SP/newdemos/offsetplane.js` — 17/17, and in `runbattery.sh`. Offset N from
each of the three datums, positive, negative and flipped, asserted against the
base normal times the number; a legacy tilt-only record resolving identically to
the pre-offset build (reference quad, sketch frame and extruded volume, all
three compared exactly);
tilt-then-offset against hand-computed coordinates; a three-deep chain by id and
by name plus a 90° bend in the middle; one-, two- and three-plane loops each
erroring with the tab still building afterwards; a face picked through the real
armed pick (panel → "A face" → Pick a face → click the canvas) landing exactly
5 mm along that face's normal; a tilt composing on top of a face base; the face
reference following the face when the block grows and letting go when it is
suppressed; the reference quad's fill AND border both drawn at the offset and
turning amber on select; a sketch on a plane 12 mm up extruding to 288 mm³
between y=12 and y=15 and coming back identical through `docFile`/`loadDocData`
with `offset:12` in the file; the panel carrying all six controls; live preview
and Cancel; the base list refusing to offer a plane that already leans on this
one; `planeOf` handing the axis feature an origin that is no longer (0,0,0);
a plane leaning on a face-plane below it in the tree; zero page errors.

Screenshots in `$SP/lamp/`: `plane-offset.png` (Top, a pad on it, a plane 11 mm
clear of Top and a second built on THAT one, tilted 30° and pushed 6 further),
`plane-offset-face.png` (a plane 8 mm off the pad's top face with the panel
showing where the face reference came from), `plane-offset-panel.png` (every
control), `plane-offset-sketch.png` (a circle drawn on a plane 11 mm up,
extruded into a post).

### Judgement calls and rough edges

- **The along-normal relaxation is a deviation from the surface-colour
  precedent** and the one real design call here. It is what makes the feature
  parametric instead of merely re-findable. The strict `sigMatch` behaviour is
  still one line away if it ever proves wrong.
- **A face reference cannot survive a sideways move.** Move the boss 3 mm in X
  and the plane on its top face lets go. Following that too would mean giving up
  the only thing anchoring the face's identity, so it is refused honestly rather
  than guessed at.
- **`Add plane` still opens at 30°**, which now reads oddly next to an offset
  field sitting at 0. Left alone on purpose: changing it changes what the tool
  does for everyone who already knows it. Worth asking the owner.
- **A datum plane still cannot be clicked in the viewport to sketch on it** —
  only the three origin planes are pickable that way; an added plane is
  right-click → Sketch on this plane in the tree. Unchanged, and out of scope,
  but an offset plane you can see floating is a much more obvious thing to want
  to click than an angled one through the origin was.
- **`planeLabelOf` is dead code.** It is defined at ~2622 and called from
  nowhere — `grep` finds exactly one hit, its own definition. Its fallback
  string `'offset plane'` is half of what put the word "offset" in this part of
  the file in the first place, and it describes the case where the plane feature
  was *deleted*, which was never what those words meant. Left exactly as it is:
  rewording a string nobody reads is churn, and deleting a function somebody may
  be about to wire up is the owner's call, not mine. Worth a decision either
  way.
- **One bug I wrote and then found.** The panel's "which planes may I be based
  on" filter memoised its walk in a set shared across the whole filter pass, so
  a plane it had *passed through* on the way to finding the edited plane was
  then answered "no, it does not lean on you" when asked about directly — and
  would have been offered as a base. One visited set per walk, and a suite check
  that the list is exactly `Top, Front, Right, Free` for a three-deep chain.
- **`FEATURE-MATRIX.html`'s tally wart is fixed, in the script.** The known
  "(of 75) with 76 rows" turned out to be worse than a stale label: the SolidWorks
  and FreeCAD cards were each a whole row light (72/1/**2** and 72/3/**0**
  against a table that says 72/1/3 and 72/3/1), because `matrix_done.py` only
  ever recomputed the freyacad card. It now recomputes all three cards and the
  row count from the table, on the same principle the tallies were taken out of
  hand-editing for. The freyacad numbers are unchanged (42/4/30).

## A real constraint solver: PlaneGCS, ported

freyacad now carries a genuine 2D geometric constraint solver — the same one
FreeCAD's Sketcher uses, PlaneGCS, ported from C++ to JavaScript. **This section
is the port and the adapter: the numerical core, the variable model, and what
each sketch record turns into.** What the sketcher does with it — the DOF chip,
dimension edits, drags, and refusing a constraint that cannot hold — is the
section after this one. It was written when nothing called any of it yet, which
is why it reads as a description of a part rather than of a feature; that is
still the right way to read it.

### The files

- **`freyacad/planegcs.js`** — the port. ~2,000 lines, its own file, its own
  licence. Loaded from `<head>` with a plain `<script src="./planegcs.js">`,
  the way `three.min.js` is. Exposes `window.PlaneGCS`, and `module.exports`
  as well so the node suite can `require()` it.
- **`freyacad/LICENSE-planegcs.txt`** — the LGPL-2.1 text, fetched from
  upstream, not retyped.
- **The adapter**, inside `index.html` between `/* GCS-ADAPTER-BEGIN */` and
  `/* GCS-ADAPTER-END */` (just above `window.__C`). freyacad's own code: it
  maps a sketch onto the solver's parameters and constraints. Reachable as
  `__C.gcs`.
- **`sw.js`** precaches `./planegcs.js`, so offline still boots.
- Suites: `newdemos/solver.js` (plain node, 114 checks) and
  `newdemos/gcsbrowser.js` (Playwright, 9 checks). Both are in `runbattery.sh`.
  The node suite lifts the adapter out of `index.html` between its markers and
  evaluates it with the real `entPoints`/`entVarCount`/`entSeg`/`entSpin`/
  `coupledEnt`/`polyCorners` pulled from the same file, so it tests the code the
  browser runs rather than a copy of it.

### The licence, in practice

PlaneGCS is LGPL-2.1-or-later, Copyright (c) 2011 Konstantinos Poulios, part of
the FreeCAD CAx development system. LGPL is not GPL: an application may use an
LGPL library without becoming LGPL itself. What it requires is that the library
stays replaceable and that its notices survive. That is why the port is a
**separate file**, loaded as a separate script, with the copyright notice, the
SPDX line, the upstream URL and the exact commit it was ported from
(`fda5c1438057ec84fb1d5bd0f45fb29e94e0c8e1`) at the top, and why the licence
text ships beside it. freyacad's own code — the adapter and everything else in
`index.html` — stays proprietary and simply calls in.

**Rules for anyone editing it.** Keep `planegcs.js` a separate file: do not
inline it into `index.html`, and do not move freyacad's own logic into it.
Changes to it are changes to an LGPL work — fine, and they stay LGPL. New
constraint classes belong in `planegcs.js` (they subclass its `Constraint`);
new sketch-mapping logic belongs in the adapter.

### What is ported and what is not

Ported faithfully, structure and mathematics both: `DeriVector2`, `Point`,
`Line`, `Circle`; the `Constraint` hierarchy with its `error()`/`grad()`/
`maxStep()` bodies (Equal, Difference, P2PDistance, P2PAngle, P2LDistance,
PointOnLine, PointOnPerpBisector, Parallel, Perpendicular, L2LAngle,
MidpointOnLine, TangentCircumf, EqualLineLength); `SubSystem` with its
parameter redirection; `System` with `declareUnknowns`, the `addConstraint*`
helpers, `initSolution` (component partitioning + equality reduction), `solve`,
`solve_BFGS`, `solve_LM`, `solve_DL` (DogLeg), the two-subsystem SQP
`solve(A,B)`, `lineSearch`, `applySolution`, and `diagnose()` with the whole
QR rank analysis and the conflicting/redundant/partially-redundant
classification; `qp_eq`.

Not ported: arcs, ellipses, hyperbolas, parabolas, B-splines and every
constraint only they reach (freyacad has none of those as constrainable
geometry); the sparse-QR diagnosis path; Boost's connected-components (a plain
union-find does the same job); the solver-reporting scaffolding.

Written here, not upstream — all inside `planegcs.js`, all LGPL like the rest
of that file:

- **The dense linear algebra**, which upstream gets from Eigen: full-pivoting
  Householder QR (rank, R, column permutation, Q, least-squares solve),
  full-pivoting LU solve, LDL^T solve, and the matrix products the solvers
  reach. The algorithms follow Eigen's so that pivot orders and rank decisions
  agree with upstream's.
- **`ConstraintPolygonCorner`**, described under the variable model below.

Deliberate deviations, each commented at the site:

- `ConstraintEqual.grad` returns `-ratio` for its second parameter where
  upstream returns `-1`. Upstream is only correct for ratio 1; it never bites
  there because the ratio form is used for radius-vs-diameter and the diameter
  is a constant. Ours is the true derivative and the finite-difference check
  insists on it.
- `calcJacobi` walks each constraint's own parameter list rather than every
  parameter of the subsystem. Same matrix, far less work.
- `SubSystem` keeps parameters in the caller's order (upstream sorts by pointer
  address, which is not reproducible), and when a coincidence merges two
  parameters the **kept** one's value seeds the merged variable. Upstream
  leaves that to `std::map` ordering; here it means the second point of a
  coincidence moves onto the first, which is what `applyCoincident` already
  does elsewhere in freyacad.
- `solve_DL` restores the last accepted iterate before returning, so a rejected
  trial step can never be what gets applied.
- The DogLeg Gauss-Newton step defaults to the least-norm LDLT form (upstream
  offers it too, but defaults to a full-pivot LU on the rectangular Jacobian).
  Least-norm is the step that moves the sketch as little as the constraints
  allow, and it only needs square factorisations.
- `diagnose()` runs its two decompositions in sequence (upstream uses a thread),
  and the second one — "which parameters are still free" — is opt-in, because
  it costs as much as the rank itself and the rank is what DOF needs.
- If the SQP refuses a drag (it needs the main subsystem's constraints to be
  independent), the solve falls back to solving the drag constraints alongside
  the real ones rather than doing nothing.

### The variable model — the thing to get right

A sketch becomes a flat vector of parameters. **Every entity contributes
exactly `entVarCount(e)` of them, in entity order.** The points constraints
speak about are *functions* of those parameters, not parameters themselves:

| entity | vars | layout from the entity's base index |
|---|---|---|
| `poly` | `2 * pts.length` | `base+2k` = `pts[k].x`, `base+2k+1` = `pts[k].y` |
| `rect` | 4 | `base+0..3` = `a.x, a.y, b.x, b.y` |
| `circle` | 3 | `base+0..2` = `c.x, c.y, r` |
| `polygon` | 4 | `base+0..3` = `c.x, c.y, r, rot` |

`ctx.ents[i]` holds `{kind, base, count}` plus the parameter objects, and
`gcs.varMap(ctx)` prints the whole vector with names like `2.c.x` or
`0.pt3.y`. The adapter checks its own count against `entVarCount(e)` while
building and records a warning in `ctx.warnings` if they ever disagree — the
node suite fails on that, so the two cannot drift apart silently.

Why the reduced space matters: a rectangle's four corners are pairs drawn from
its four numbers, so `Point(ax, by)` *is* the top-left corner and axis-alignment
costs no equations at all. Expanding every shape to free x,y per point and
bolting rectangle-ness back on with internal constraints would inflate the
system and make the redundancy analysis meaningless.

**The one exception, and the reason for it.** A regular polygon's corners are
transcendental functions of `(c, r, rot)`, and PlaneGCS has no primitive that
says so. A corner that some constraint actually names therefore gets two
auxiliary parameters — appended *after* every entity's own variables — pinned
to the polygon by two internal-alignment equations
(`ConstraintPolygonCorner`, one per coordinate):

```
px - cx - r*cos(rot + k*2*pi/n) = 0
py - cy - r*sin(rot + k*2*pi/n) = 0
```

Two parameters against two always-independent equations, so the polygon still
counts as four degrees of freedom and every ported constraint works on the
corner unchanged. This is exactly the device upstream uses for an ellipse's
focus. The first `ctx.nGeomVars` entries of the vector are the sketch's own
variables and nothing else; anything past that is auxiliary. A corner asked for
after `declareUnknowns` re-declares, so it cannot end up silently constant.

`entSpin(e)`'s "single rotation variable" is exactly the `rot` parameter above:
the adapter does not call `entSpin`, because the polygon's corner equations
already carry that structural fact — aligning one of its edges solves for `rot`
and nothing else about the shape moves, which is what `entSpin` exists to say.
`coupledEnt(e)` is likewise true of precisely the shapes whose points are
functions here rather than parameters.

`ent: -1` is the origin: a point built from two constants, so it costs no
variables and cannot move. A plane trace is a line through two constants, for
the same reason — which is what makes it *ground*.

### What each sketch record turns into

Constraints (`sk.cons`):

| kind | solver constraints |
|---|---|
| `coinc`, `conc` | `Equal(a.x,b.x)` + `Equal(a.y,b.y)` |
| `horiz` / `vert` | `Equal(a.y,b.y)` / `Equal(a.x,b.x)` |
| `paral` | `Parallel` — cross product of the directions, divided by both lengths |
| `perp` | `Perpendicular` — dot product, same scaling |
| `equal` | `EqualLineLength` for two segments, `Equal(r1,r2)` for two circles |
| `ontrace` | `PointOnLine` against the ground line |
| `tangent` | line+circle → `P2LDistance(centre, line, r, ccw)`; circle+circle → `TangentCircumf` |
| `symm` | `Perpendicular` + `MidpointOnLine` about a line; `PointOnPerpBisector` + `PointOnLine` about a point |
| `fix` | `CoordinateX` + `CoordinateY` against constants |
| `radius` / `diameter` / `dist` / `angle` / `pointonline` | the obvious ones; the sketcher does not create these yet |

Dimensions (`sk.dims`, skipped when `driven` or `v == null`):

| kind | solver constraint |
|---|---|
| `p2p`, `seg`, `pedge` | `P2PDistance` between the two points |
| `ptrace` | `P2LDistance` to the trace, with `ccw` fixed from the side the point is on now |
| `width` / `height` | `Difference` on the rectangle's two x's or two y's, in the order the rectangle has now |
| `dia`, `pdia` | `Proportional(r, value, 0.5)` |
| `angle` | `L2LAngle` (see below) |

**Distances use the plain `sqrt` form, as upstream does**, and this is on
purpose. The derivative is `dx/d`, which is only singular when the two points
coincide *exactly*; upstream has lived with that for fifteen years, and the
alternative (a squared residual) changes the least-squares weighting of every
over-constrained sketch. What guards it in practice is `maxStep`, which is
ported: `P2PDistance` refuses a step that would change the distance by more than
the distance itself. If you ever see a NaN out of a distance, that is the place
to look, not the residual form.

**Angles are the one translation with a convention to get wrong.** A dimension
reads the angle between the two legs pointing *away* from where they cross (see
`dimResolve`); `L2LAngle` measures from one stored direction to the other. They
differ by a sign and possibly by half a turn. The adapter works out which from
the **geometry**: for two segments, from where they intersect (each leg points
from there to its far end); against a plane trace, from the pivot end —
`gcsPivotEnd` mirrors `segPivot`'s reading — and the trace's stored direction.
Nothing has to tell it what the label used to say, so a dimension retyped from
30 to 150 goes to 150 instead of folding to its supplement. The browser suite
checks this the only way that really counts: it drives a dimension and asks
`dimResolve` what the label now reads.

Two ways it can still be wrong. If the legs are parallel (no intersection) or
the segment belongs to a shape the dimension tools cannot reach, it falls back
to matching the value the dimension is showing — pass `d.now` if you have a
better one than `d.v`. And a dimension sitting at exactly 90 degrees is
genuinely ambiguous whichever way you look at it; the first match wins,
deterministically. `gcsPivotEnd` also duplicates `segPivot`'s rule rather than
calling it: if `segPivot` ever changes, change both.

### The solve

`initSolution` splits the system into decoupled components and eliminates
`Equal` constraints between unknowns by merging the two parameters. Both matter
more than they sound: twenty-five separate rectangles are twenty-five small
problems, and a coincidence costs a variable rather than an equation.

Then, per component: **DogLeg by default** (Powell's dog-leg: a least-norm
Gauss-Newton step inside the trust region, steepest descent outside, a blend
between), with **Levenberg-Marquardt** and **BFGS** ported and selectable
through `opts.algorithm`. Tolerances are upstream's: `DL_tolf = 1e-10` on the
infinity norm of the residual, `convergence = 1e-10`, `maxIter = 100`. Success
means the residual was driven under `DL_tolf`; `Converged` means it stopped at a
minimum that is not zero; `Failed` means neither.

Everything is deterministic: no randomness, no clock, fixed iteration order,
and — unlike upstream — no dependence on pointer addresses. The suite asserts
bit-identical output from two identical inputs.

`solve()` calls `resetToReference()` first, so every solve starts from the
geometry as it was when `initSolution` ran. During a drag that makes the result
depend only on where the cursor *is*, not on the path it took — deliberate, and
worth knowing before you try to make a drag incremental.

**Minimum norm.** The Gauss-Newton step is the least-norm solution of the
linearised system, so an under-determined sketch — the normal case — moves as
little as the constraints allow. The suite pins this down: stretching a free
segment from 10 to 12 moves *both* ends by 1; adding one coincidence to twenty
loose lines moves exactly one point and leaves the other 36 untouched to the
last bit.

**Pinning (this is how phase 2 drags).** `gcs.pin(ctx, [{ent, idx, x, y}])`
adds `CoordinateX`/`CoordinateY` constraints tagged `-1`. A negative tag puts
them in a *lower-priority* subsystem, and the two-subsystem SQP satisfies the
sketch's own constraints first and gives the pin whatever freedom is left. That
is why a dimensioned edge does not stretch to follow the cursor — asserted in
the suite. `gcs.movePin(ctx, i, x, y)` moves the target without rebuilding
anything, which is the per-frame path.

`pinMode` picks how much that priority costs: `'priority'` is the SQP;
`'merged'` solves pin and constraints together as one least-squares problem, an
order of magnitude cheaper on a big connected sketch but it splits an
impossible drag between the pin and the constraints instead of putting all of
it on the pin; `'auto'` (the default) uses priority while the largest component
is at most 80 unknowns and merged beyond that.

### DOF, redundancy and conflict

`diagnose()` builds the Jacobian of the driving constraints against the
parameters and takes a **full-pivoting QR of its transpose**. Then:

- **`dof = parameters - rank`.** Rank, not equation count: three parallels
  round a rectangle are three equations of rank two, and counting equations
  would report a degree of freedom that is not there.
- If there are more constraints than rank, each dependent column of `R` names a
  **group**: the constraints whose rows it depends on, plus itself. Upstream's
  heuristic picks whom to blame (appears in most groups, then costs the fewest
  solver constraints, then newest), drops them, and **solves the system
  again**. Whatever the dropped constraint's residual is near zero after that
  solve was **redundant but consistent**; whatever is not is **conflicting**.
  That re-solve is the whole difference between "you said the same thing twice"
  and "you asked for two different things", and it is why the answer is
  trustworthy.
- Groups with no redundant member become `conflictingTags`; the adapter turns
  tags back into `{src:'cons'|'dims', index, kind}` so a message can name the
  actual badge the user clicked.

Tags: `1 + i` for `sk.cons[i]`, `1001 + i` for `sk.dims[i]`, `0` for internal
alignment (counted for rank, never blamed), `-1` for drag pins (invisible to
the diagnosis).

Measured on the classic cases: four lines with coincident corners = 8 DOF; plus
one horizontal = 7; plus H,V,H,V on the four sides = 4; plus width and height =
2; plus a corner on the origin = 0, and it solves to the exact rectangle. A
parallel added to that rectangle reads *redundant*, DOF stays 4. Two different
lengths on one segment read *conflict*, with both dimensions named.

### The API phase 2 will call

Everything is on `__C.gcs`:

```js
const ctx = gcs.build(sketch, opts);      // parameters + constraints, nothing solved
gcs.pin(ctx, [{ent, idx, x, y}]);         // optional drag pins (tag -1)
const res = gcs.solve(ctx, opts);         // {ok, status, converged, dof, iterations, residual, ms}
gcs.apply(ctx);                           // write the parameters back onto the sketch
const d = gcs.diagnose(ctx, opts);        // {dof, rank, state, conflicting[], redundant[],
                                          //  partiallyRedundant[], skipped[], warnings[], ms}
const r = gcs.solveSketch(sketch, opts);  // build + pin + solve + apply, plus res.moved
const w = gcs.wouldOverConstrain(sketch, record, opts);  // ask BEFORE committing
gcs.movePin(ctx, 0, x, y);                // per-frame drag
gcs.varMap(ctx);                          // [{index, name, value, geometric}]
gcs.available                             // false if planegcs.js did not load
```

`opts`: `pins`, `pinMode`, `algorithm`, `maxIter`, `reinit`, `apply`,
`diagnose`, `dependentParams`, `extraCons`, `extraDims`, `traceLookup`.

`wouldOverConstrain` returns `verdict: 'ok' | 'redundant' | 'conflict' |
'redundant-elsewhere' | 'conflict-elsewhere'` — the `-elsewhere` cases mean the
sketch was already in that state before the candidate was added, which is a
different message to show.

`ctx.skipped` lists records the adapter could not honour (a stale segment index,
a missing trace). Phase 2 should surface those rather than let a constraint
silently do nothing.

`gcs.apply` **mutates the existing point objects** (`e.pts[k].x = ...`, `e.a`,
`e.c`), it never replaces them — drag handles, `resolvePt` results and anything
else holding a live point keep working across a solve. A polygon's `rot` is
written back unnormalised, so it can wander outside 0..2*pi over many solves;
that is geometrically a no-op and `polyCorners` does not care.

**`help.html` and `FEATURE-MATRIX.html` were deliberately untouched in phase 1**,
because nothing was user-visible yet. Phase 2 made it visible and paid that
debt: the manual's "no constraint solver" caveat is gone, "Constraints &
degrees of freedom" describes what the chip now reads, "When a constraint can't
hold" describes conflict versus redundancy, About credits PlaneGCS and its
licence, and the matrix row is ✅.

Suggested wiring order, easiest first: (1) replace the DOF chip's arithmetic
with `diagnose().dof` — it is a strict improvement and touches nothing else;
(2) run `solveSketch` after a dimension edit instead of `dimApply`'s relaxation;
(3) drag through `pin`/`movePin`; (4) call `wouldOverConstrain` before storing a
new constraint. Each step can ship on its own.

### Measured performance (node 22, this container)

| sketch | vars | constraints | DOF | diagnose | cold solve | warm solve | drag frame |
|---|---|---|---|---|---|---|---|
| 4 entities, 1 quad | 16 | 14 | 2 | 0.3 ms | 0.6 ms | 0.10 ms | 0.16 ms |
| 20 entities, 5 quads | 80 | 70 | 10 | 1.7 ms | 2.5 ms | 0.51 ms | 0.32 ms |
| 100 entities, 25 quads | 400 | 350 | 50 | 152 ms | 166 ms | 1.8 ms | 0.46 ms |
| 100-segment chain, every segment dimensioned | 400 | 300 | 100 | 114 ms | 140 ms | 11.6 ms | 114 ms |

Dense linear algebra is the right choice at this scale, and these are the
numbers that say so: a drag frame on a hundred separate entities is half a
millisecond, because the partitioning solves only the component under the
cursor. The last row is the deliberate worst case — one connected component of
202 unknowns and 102 nonlinear distance constraints — and it is the one place
that misses a frame. `opts.maxIter: 20` brings it to 24.6 ms, which is the lever
to reach for if a real sketch ever gets there. (The same row with `pinMode:
'priority'` costs 419 ms, which is what `'auto'` exists to avoid.) Diagnosis of a hundred entities
is a tenth of a second and runs when a constraint changes, not per frame; asking
for `dependentParams` doubles it.

The single biggest win was making `J * J^T` walk each row's nonzeros instead of
its full width: the chain's warm solve went from 58 ms to 11 ms. A constraint
Jacobian is nearly all zeros, and that one product is the dominant cost of a
solve.

### What is weak, and what phase 2 must be careful of

- **Angles**, as above. The likeliest place to find a real bug.
- **Radius can go negative.** Nothing stops a circle's `r` becoming negative
  under a violent solve; `gcs.apply` writes `Math.abs(r)`, which is a patch, not
  a fix. If a circle ever flips inside out, that is why.
- **Tangency picks a side at build time** (`ccw` from where the centre is now)
  and keeps it. That is what stops it flipping mid-solve, and it also means a
  tangency cannot be solved "round the other side" without rebuilding.
- **`entSeg` does not offer rectangle sides** — the host interface has no
  segments for a rect. The solver accepts them anyway (`{ent, seg: 0..3}`),
  which costs nothing, but the UI has no way to pick one today.
- **Splines are poly points to the solver.** A `spline` entity's control points
  constrain like any polyline points; the curve itself is not constrained.
- ~~**No arcs.**~~ **Done** — `Arc`, the `Curve::Value` contract and
  `ConstraintCurveValue` are ported, and `addConstraintArcRules` builds an
  arc's ends out of them. See "Arcs the solver can hold" at the end of this
  file for the variable model and the one deviation from upstream (an arc's
  ends are materialised one at a time, not both together). Ellipses,
  hyperbolas, parabolas and B-splines are still out.
- **The diagnosis re-solve moves the geometry and puts it back.** It snapshots
  and restores the parameters, but if you interrupt it (you cannot, it is
  synchronous) or if a constraint's `evaluate()` writes somewhere unexpected,
  that is where to look.
- **Nothing called any of this in phase 1, on purpose.** Phase 2 wired it; see
  the next section for what now goes through it and what still does not.

## The solver driving the sketcher (phase 2)

The section above ends with "nothing calls any of this yet". Four things do
now, and all four fall back to the code that was there before the solver
existed if `planegcs.js` is missing — `gcsoff.js` proves that by blocking the
script and running the sketcher without it.

freyacad's own glue lives in `index.html` between `/* GCS-DRIVE-BEGIN */` and
`/* GCS-DRIVE-END */`, immediately below the adapter. The adapter maps a sketch
onto PlaneGCS; the glue is where the sketcher asks it questions. Same rule as
before: nothing of freyacad's moves into `planegcs.js`, which phase 2 did not
touch at all.

Three suites, all in `runbattery.sh`:

- **`newdemos/gcsglue.js`** — plain node, 37 checks, about a second. Lifts BOTH
  marked blocks out of `index.html` and evaluates them with the real
  `entPoints`/`entVarCount`/`entSeg`/`liveRef`/`dimKey`, so it tests the code
  the browser runs. This is the one to extend while working; it catches the
  reasoning, and the browser suite catches the wiring.
- **`newdemos/gcsdrive.js`** — Playwright, 38 checks. Everything through the
  real UI: the chip's own text, a dimension typed into its label, pointer
  drags, tool clicks, and every sketch of both demos and
  `models/magic-lamp.sketchcad` opened one after another.
- **`newdemos/gcsoff.js`** — Playwright, 8 checks, with `planegcs.js` blocked
  by a route before the page loads. Proves the fallbacks.

`gcsdrive.js` calls `fitAll()` before it clicks anything, and checks
`elementFromPoint` for every click it makes. Both are scar tissue: the dock
floats over the top of the drawing area, and a click on an edge that happens to
sit underneath it silently does nothing at all, which reads exactly like a
broken feature.

### 1. The DOF chip, and gold vs blue

`gcsStateOf(sk)` runs `diagnose()` with `dependentParams: true` and returns
`{ents:[{dof,defined}], dof, state, skipped, diag}`. `defineState` returns its
`ents` array when it is there and the old arithmetic when it is not, so **the
chip, the entity colours and `lockedEnts` all read the same number** — which
was already the rule, now with a rank behind it instead of a tally.

Per entity: PlaneGCS's dependent-parameter analysis says which parameters can
still move, and an entity is fully defined exactly when none of its own can.
That is the reading FreeCAD highlights with. It is per-entity *whether*, not
per-entity *how many* — a coupled group's freedoms belong to the group — so
`ents[i].dof` is "how many of my numbers are still free", which is what the
chip's "3/7 still free" tail wants and nothing else uses.

The chip has a third state now: `over-defined`, in red, naming the two records
that fight. `#sk-anchor.bad` is its class.

**Caching, because diagnose is not free.** The overlay redraws every frame of a
drag; `diagnose` costs a QR and a re-solve. `gcsStateOf` caches on a signature
of everything the answer depends on: entity kinds and sizes, every stored
constraint, every dimension **including its value** (a conflict depends on the
number, not just on the record), and the implied joints below. Moving a point
changes none of those, so a drag is one diagnosis, not sixty. `gcsInvalidate()`
drops it; a solve calls that itself.

### The implied joints — read this before changing the DOF count

The sketcher has always believed two things the sketch file does not say:
points of different entities sitting on the same spot are joined
(`collectJoins`, enforced for the whole of a drag), and a point on the origin
is on the origin (`anchoredSet`). Old files — `models/magic-lamp.sketchcad`,
every demo — store no constraints at all and rely entirely on this.

`gcsImplied(sk)` produces those as `coinc` records and every call into the
solver passes them as `extraCons`, so **what the chip counts is what a drag
will hold**. Two rules keep it honest:

- A **union-find** seeded with the stored coincidences emits one join per
  merge. Three points on one spot are two joins, not three; a pair already
  joined by a stored constraint gets none. Without that the diagnosis would
  report our own bookkeeping as redundant, on every sketch.
- A point named by a stored `ontrace` or `fix` is left alone for grounding —
  "and it is on the origin" on top of "it is on the Front plane" would make the
  user's own constraint read as redundant.

**This changed how old sketches read, and it is the honest change.** The lamp's
body profile used to show gold, fully defined, and refuse to be dragged: the
old flood fill saw each two-point line pinned at both ends by neighbours that
were themselves only pinned through it. Four lines joined corner to corner with
nothing else said about them can still flex, and the rank says so — the lamp is
52 degrees of freedom, blue, and every point of it drags again.

### 2. A dimension edit solves the whole sketch

`openDimInput`'s apply path stores the value and calls `gcsSettle(editing)`.
`gcsSettle` snapshots the geometry, runs `gcs.solveSketch` with the implied
joints, and — if the solve did not reach zero residual — **puts the geometry
back exactly as it was** and returns false, at which point `dimApply` plus
`relaxDims(3)` run, which is what always happened. When it does fall back it
also says why, naming the conflicting records out of the failed context.

`guardDims` settles the same way, so Horizontal, Vertical, Parallel and Equal
now settle the whole sketch too, and the Coincident tool does it on its own path
(it has never gone through `guardDims`). The one-shot move (`segAlign`, `applyParallel`,
`applyEqual`) still runs first, deliberately: it picks the branch — which way
the line flips to become horizontal, which orientation of parallel is nearer —
and the solver then makes everything consistent from a configuration that is
already close, which is what keeps the correction small.

For an angle dimension the apply path sets `d.now` to what the label currently
reads before solving and deletes it afterwards. It only matters in the
adapter's fallback branch (parallel legs), and it is scratch: it must never end
up in a saved sketch.

### 3. Dragging

Built once at grab time (`gcsDragStart`), pinned, and only the pin moves after
that (`gcsDragTo` → `movePin` + `solve` + `apply`). Every frame solves from the
geometry as it was at the grab, so where the sketch lands depends on where the
cursor is and not on the path it took. Measured in the browser at 0.3 ms a
frame on the lamp's body profile; `pinMode` stays on `auto`.

Only plain point handles come this way — `kind` `'v'` (a chain point or a
rectangle corner) and `'c'` (a circle or polygon centre). A polygon's corner
handle and a circle's rim are size-and-spin gestures, not "put this point
here", and they keep the direct path they always had; that is also what keeps
`polycon`'s corner drag reading exactly as it did.

At the drop, `gcsDragEnd` then one `gcsSettle`, which also takes in whatever
the drop just snapped into place. The old promise — a drag never changes a
dimension, or the whole drag is taken back — is still there behind it, as a
net rather than as the mechanism.

### 4. Conflict and redundancy, before the constraint is stored

`gcsConCheck(sk, rec, what)` wraps `gcs.wouldOverConstrain`. Three answers, and
they are **not** the same thing:

- `conflict` → refused, with a message naming what it fights
  (`gcsName` turns a tag into "the 20 mm length", "a horizontal", "a coincident
  point").
- `redundant` → **allowed**, with "was already true here — kept, and it costs
  no freedom". A parallel that adds no rank is not an error and must never be
  reported as one.
- anything else, including `*-elsewhere` (the sketch was already in that state
  before this constraint) → silent, because it is not this constraint's fault.

Wired into: the Horizontal/Vertical tools (both the click path and the
selection path), Parallel, Equal, Coincident, and a new dimension in
`openDimInput` (where a conflict still offers "add it as driven" — the same
dialog, now with the reason in it).

**`gcsSkSans` is not optional.** H and V replace each other on a segment, and a
newer parallel or equal replaces the older one on the same follower. Asking
about the new constraint while the record it is about to replace is still in
the list calls every deliberate change of mind a contradiction. The check runs
against the sketch with that one record already dropped.

**`gcsAskAfter` is not optional either, and it took a failing test to see why.**
The question is not "can this constraint hold where the sketch is now" but "can
it hold where the tool is about to put the sketch". Horizontal on a line that is
currently upright and 10 long, asked from where the line is, comes back a
conflict with its own length dimension: the solver eliminates the equality by
merging the two y's onto one value, the line collapses to a point, and a
distance of 10 from a point to itself is unsatisfiable. Asked from where
segAlign is about to put it — flat, still 10 long — it is fine, which is also
what the tool then does. So the check runs the one-shot move on the real
geometry, asks, and puts the geometry back; the caller does the move again for
real. Every constraint tool goes through it (`applyCoincident` does the same by
hand: join, ask, and put the point back if the answer is no).

### Two traps that are worth the words

**An equality between two unknowns is eliminated by MERGING them**, onto the
kept one's value — `initSolution`, and it is why a coincidence costs a variable
instead of an equation. For a coincidence that is exactly right. For a
`horizontal` or `vertical`, which compile to `Equal(y,y)` / `Equal(x,x)`, it is
right only once the segment is already flat: merge the two x's of an upright
line and it becomes a point, where `segAlign` would have swung it flat at its
own length. Everything in the app aligns first, so the solver only ever meets
them true — but `gcsFlatEnough(sk)` checks anyway, and `gcsSettle` and
`gcsDragStart` stand down when it says no, leaving the relaxation to do the
flattening it is good at. If you ever add a constraint that compiles to
`Equal` between two unknowns, ask yourself the same question about it.

**With no driving constraints at all, `diagnose()` returns before working out
which parameters are free**, leaving `pDependentParameters` empty — and an
empty list read literally says "every number is decided". That is a freshly
drawn line: it would have shown gold, fully defined, and refused to be dragged.
`gcsStateOf` checks `sys.emptyDiagnoseMatrix` and treats every parameter as
free when it is set. `gcsglue.js` pins a lone line, circle and rectangle for
exactly this reason.

### Other things worth knowing

- **`ctx.skipped` is surfaced.** A record naming geometry that is no longer
  there shows on the chip as "· 1 not enforced", with what it was in the
  tooltip. Implied joints are ours and are filtered out of that count.
- **A snap the dragged point did not REACH is no longer treated as a snap.**
  The old path always put the point exactly on whatever the cursor was hovering,
  so the coincidence stored at the drop was true by construction. The solver puts
  the point where the sketch allows, which can be short of it — so the release
  checks the distance before storing anything, or it would be storing a rule the
  sketch cannot keep.
- **A solve that turns a circle inside out is treated as a failure.**
  `gcs.apply` writes `Math.abs(r)`, so a radius that crossed zero would come
  back as a mirrored solution rather than as an error. `gcsInsideOut(ctx)`
  checks the parameter itself, on both the settle and the drag path.
- **`__C.gcsStatus()`** returns what the chip is reading and where it came from
  (`source: 'solver' | 'arithmetic'`), and **`__C.gcsStats`** counts diagnoses,
  settles, drag frames and checks with the last timing of each. That is how the
  suites prove the solver did the work rather than the fallback quietly doing
  it, and where the in-browser performance numbers below come from.

### Measured in the browser (Chromium, swiftshader, this container)

Medians of seven, on the lamp's body profile — 12 entities, 39 points, 13
implied joints, 52 degrees of freedom, which is a real sketch and not a toy:

| what | when it runs | cost |
|---|---|---|
| `gcsStateOf` — `diagnose` + dependent params | a constraint or dimension changes | 1.2 ms |
| the same, cache hit | every overlay redraw, every frame of a drag | 0.1 ms |
| `gcsImplied` alone | inside each of the above | <0.05 ms |
| `gcsSettle` | a dimension typed, a constraint added, a drag dropped | 1.3 ms |
| `gcsConCheck` (`wouldOverConstrain`) | per constraint click | 0.9 ms |
| drag frame — `movePin` + `solve` + `apply` | per pointermove | 0.3 ms, worst of 12 was 1.3 ms |

On a four-entity sketch the diagnosis is 0.2–0.3 ms and a settle 1.8–3.0 ms. The
first call in a page is several times the median — JIT, not arithmetic; the
suites print the last of each in `perf`, so a regression of the order that
matters would still show. These are swiftshader numbers; real hardware is
faster.

The node table in the section above still stands for the big cases, and those
are the ones to watch: a hundred-entity sketch diagnoses in about 150 ms, which
is why the cache exists and why `diagnose` runs on a structural change rather
than on a redraw. Nothing here changed the solver's own cost — what the wiring
adds is one `gcsImplied` per call, O(points²), which replaced an O(entities³)
flood fill and is faster than what it replaced.

### What is still weak

- **Everything phase 1 listed is still true**: angles are the shakiest
  translation, tangency picks its side at build time, LM and BFGS are lightly
  tested. Nothing here touched the solver.
- **A drag that starts on a polygon corner or a circle's rim does not solve.**
  It moves `r` and `rot` directly and then relaxes, exactly as before. Pinning a
  corner would be a different gesture (the centre would move), so this is a
  decision, not an oversight — but it does mean a constraint on a polygon edge
  is only enforced by the relaxation during such a drag.
- **`gcsSettle` at the end of a drag rebuilds the system from scratch.** On a
  hundred-entity sketch that is the cold-solve number, not the warm one.
- **The chip asks for `dependentParams`, which doubles the diagnosis**, because
  gold-vs-blue needs to know which numbers are still free and the DOF count does
  not. If the chip is ever the thing that is too slow, the split is there to
  take: `dof` alone is half the price.
- **The conflict check runs a full build and diagnose per constraint click.**
  1.2 ms on a small sketch; it will be the diagnose number on a big one.
- **"Conflict" is the diagnosis's word, and the diagnosis re-solves to say it.**
  That makes it trustworthy about the sketch it was handed and only about that
  one: hand it a degenerate configuration and it will call something a conflict
  that a person would call possible from somewhere else. `gcsAskAfter` exists
  because of one such case. If a refusal ever looks wrong, ask what the geometry
  was at the moment the question went in, before suspecting the rank.
- **`relaxDims` is still the whole story for anything that is not one of the
  four paths above** — corner treatments, mirror, trim, and the drag gestures
  named above. The two mechanisms coexist deliberately; the fallback has to
  keep working anyway, because the solver may be absent.

## Three owner tweaks (defaults, the boat, and the boot credit)

**Add plane opens parallel and 5 mm clear.** `defaults('dplane')` was
`angle:30, offset:0` — a plane tilted through the world origin, which was the
only kind that existed before offsets landed and reads oddly now. It is
`angle:0, offset:5`. The record shape is unchanged, so every saved document
still resolves exactly as before; only what a NEW plane starts as moved.

**The print-test boat is off the demo menu.** Its `DEMOS` entry is gone;
`DEMO_BENCHY` is deliberately still defined above the registry, because
re-adding it is one entry and the boat is meant to be rebuilt (the model is
crude next to the lamp). `demoByKey` already falls through to the first demo,
so a stored preference naming `benchy` boots the pillow block rather than
failing — asserted, not assumed. The centre button's tooltip says two worked
examples, and help.html's demo table lost the boat's row.

**PlaneGCS is credited in the boot sequence**, between the boolean engine and
the line count. One trap worth knowing if you ever add another line: `finish()`
sweeps every row still classed `run` and rewrites its state to `ONLINE`, so a
bare string credit would be erased a second after it appeared. The row survives
because its state is markup (`<span>FREECAD · LGPL</span>`) and the class
picker treats anything starting with `<` as already-final. `$SP/newdemos/tweaks.js`
asserts the credit both before and after the sweep.

That suite also records a mistake worth not repeating: its first version asked
for a `__C.DEMOS` global that does not exist, got `[]`, and *passed* the "the
boat is gone" check on an empty list. It now opens the real demo menu and reads
the labels. A check that cannot fail is worse than no check.

## Pick the plane you mean (and the end of U/V)

Three owner notes, one pass. *"For the add new plane tool, to choose the plane
the new plane will be based off, the user should either click them in the
feature tree or the viewport, not on the right hand side. Also ditch the
reference to the 'u' and 'v' axis. No idea what that is all about and don't
care just ditch it."* — plus a fair question about what the box on the right is
even called.

### The base plane is now pointed at, not chosen from a list

The plane panel used to carry a segmented control listing every plane in the
document. It is gone. In its place the panel **states** the base — one button
reading `Deck`, `Top plane`, or `Missing — click to pick one` — and pressing it
arms a pick. Then you click the plane you mean: **its row in the feature tree,
or its own quad in the viewport**. Both routes land in one function,
`consumePlaneBase(base)`, so there is a single rule about what is allowed.

It is deliberately the SAME machinery as the face pick beside it, not a second
one: `pendingPlaneBase` mirrors `pendingPlaneFace` (held against the panel's
DRAFT feature, cleared by `closeProps`), it goes through `showPickCard` /
`hidePickCard` and `setHint`, it is listed in `armedPick()` so selection stands
aside for it, `cancelPicks` ends it, Escape and right-click cancel it, and when
it lands it calls `openProps(propsFeat)` exactly as `consumePlaneFacePick` does
so the panel redraws from the draft. `helpContext()` gained a case, so the live
help tracks it too.

**The loop walk is the panel's old one, moved, not copied.** `leansOnMe` was a
closure inside `buildPropsBody`; it is now `planeLeansOn(id, targetId, seen)` at
module level with `planeBaseAllowed(f, id)` over it, and the panel, the tree
rows, the drawn quads and the pick itself all ask that one function. Its comment
about **one visited set PER walk** moved with it — that was a real bug once, and
it would come back the moment someone hoists the set out to share it.

A refused pick **says why and stays armed**: *"Upper already leans on Shelf —
basing it there would run in a circle. Pick another."*, or *"A plane cannot be
built on itself"*. Silence would read as a dead click, which is what the list
used to give you by simply omitting the option.

### Borrowing the planes you have to be able to see

A plane you cannot see is a plane you cannot click, and the origin planes are
hidden by default. `updateDatumVis` gained a `bpPick` term beside the `skPick`
one the sketch pick already had, so while a base pick is armed all three origin
planes are drawn — and **`datumShow` is never touched**. That matters: the
comment above `setTreeHover` says `updateDatumVis` is the only thing allowed to
decide datum visibility, and it is right. Nothing is stored and nothing has to
be put back; the moment the pick ends, the same function hands the planes
straight back to whatever the tree had them set to. Pin Top from the tree, arm a
pick, cancel it, and Top is still pinned while Front and Right go back to
hidden. `planepick.js` check 6 asserts exactly that sequence, and it fails if
you "fix" this by writing `datumShow` on the way in (I tried the mutation; it
catches it).

Datum-plane features are drawn by `drawRefGeometry` and are always visible
already, so what they needed was not visibility but **candidacy**: while a pick
is armed each quad is tinted teal if this plane may stand on it, amber if it is
under the cursor, and dimmed almost out of sight if taking it would build a
loop. The same three states appear on the tree rows as `.cand` / `.nocand`, in
the same teal the row hover already uses, so tree and viewport read as one
gesture. With no pick armed not a single pixel of `drawRefGeometry` changed —
`offsetplane.js` check 7 still asserts the old blue/amber exactly.

Three small things worth knowing:

- The quads carry `userData.dplaneId`, so a click on one knows its feature
  without a second search. `planeBaseAt(e)` raycasts the origin quads and those
  together and takes the **nearest**, so a plane behind another cannot steal the
  click — the same rule the sketch pick applies between a plane and the solid.
- `canvas`'s `pointerleave` clears the hover. Without it, moving from the
  viewport to the tree left a plane lit, promising a click that had become the
  tree's.
- **Switching `Start from` now puts down whichever pick was in hand.** It never
  did for the face pick either: arm one, switch to the other kind of base, and
  the armed pick was still there waiting to quietly flip `baseKind` back on the
  next click. Both are dropped on the switch now.

### What replaced "Its U axis" / "Its V axis"

The record is untouched — `about` is still `'u'` or `'v'`, so every saved
document resolves identically. Only the two buttons changed, and they are now
computed from the base frame by `tiltAxisLabels(pf)`:

- **`Along X` / `Along Y` / `Along Z`** when that in-plane direction lies along
  a world axis (|dot| > 0.999). On a plane based on Top the buttons read *Along
  X* and *Along Z*; on Front, *Along X* and *Along Y*; on Right, *Along Z* and
  *Along Y*. This is the overwhelmingly common case and it is exactly true.
- **`Near X`** and friends when it lines up with nothing — a base that is itself
  tilted, or an oblique face. "Near" is the honest word: it names the axis the
  direction comes closest to and does not claim an alignment it has not got. On
  a plane standing on a 30&deg;-tilted base the buttons read *Along X* and
  *Near Z*, which is the truth.
- The axis for each direction is chosen by scoring **both at once** over the six
  orderings, not greedily one after the other. Two perpendicular directions can
  both be nearest the same world axis (40&deg; and 50&deg; off X, say); greedy
  naming would have printed the same label twice.
- If the base frame cannot be resolved at all — a deleted base, a lost reference
  face — the buttons fall back to `One direction` / `The other`. That plane is
  showing a red **!** anyway; at that point there is no truthful axis to name,
  and inventing one would be worse than saying nothing.

`help.html` says the same, and a grep of every string the app displays turned up
no other U/V leakage. The sketch code's internal `u`/`v` is untouched — the text
feature already displays *Slide across* / *Slide up / down*, and the `H`/`V`
constraint badges are horizontal/vertical, nothing to do with this.

### The box on the right is called Feature properties

The owner asked, and the manual genuinely never said. The live help already
called it **Feature properties**; the manual now has a section of that name
(`#props`, under Interface, with a nav entry) and a row in the layout table.
Verified before writing rather than assumed: it opens by itself when a feature
is added, and reopens on **double-click** of a tree row or **Edit feature** /
**Edit plane** from the row's right-click menu — a sketch row is the exception,
because double-clicking a sketch opens the sketch. The section covers the live
rebuild, Done as one undo step, Cancel deleting a feature that was only just
added, and the fact that some panels ask you to point at something instead of
typing. Code, live help and manual now use the one name.

### offsetplane moved, on purpose

`offsetplane.js` check 13 used to read the segmented base list and assert it
offered `Top,Front,Right,Free` — a control that no longer exists. The rule it
was protecting has not changed, only where it is enforced: it is now checked at
the pick. The rewritten check asserts the panel has no list and states the base,
that arming marks Free and the origin rows as candidates and A/B/C as not, and
that clicking A is refused with a reason and leaves the pick armed. Same truth,
new place. Everything else in that suite is untouched and still passes,
including check 10's label list — the field is still labelled `Base plane`, it
just holds a button now instead of a row of them.

### What is still weak

- **The tree row's × still deletes while a pick is armed.** The pick check sits
  after the twist / error / delete guards, so those keep working; it is a
  deliberate order, but a delete during an armed pick is an odd thing to allow.
- **`planeBaseHover` is only updated from the canvas.** Hovering a tree row
  lights the plane through `setFeatHover`'s ghost, which looks right, but the
  two mechanisms are separate and the quad's own candidate tint does not follow
  the tree hover.
- **A pick armed from the panel of a plane that is rolled back** would offer
  planes drawn from `features.slice(0, rollbackIndex)` in the viewport but every
  plane in the tree. Nobody can reach that today (the panel closes on rollback),
  but the two lists are not derived from one source.
- **`tiltAxisLabels` calls `dplaneBaseFrame` on every panel build.** For a face
  base that is a map hit after a rebuild, but the first call of a session can
  resolve the face reference — cheap here, and worth remembering if the panel is
  ever rebuilt per keystroke.

## Add axis and Mirror point at the plane too

*"You should point at the plane you mean, not choose its name from a list in
the properties panel."* — Add plane was fixed last round; **Mirror** and **Add
axis** were left behind, still picking a plane by name from a segmented list.
They now point, through the *same* machinery, generalised rather than copied.

### One armed slot, three callers, one gate

The base pick was hardwired to "the dplane draft awaiting a base": one pending
variable, one target field, one legality rule. It is now a small descriptor:

```js
let planePick=null;   // {feat, field, what, set}
```

`feat` is the feature being edited (the panel's DRAFT, exactly as before),
`field` is the key on it the click writes — `'base'`, `'plane'`, `'pa'` or
`'pb'` — and `what` / `set` are the words the card, the hint and the manual use.
`startPlanePick(f, field)` arms it, `endPlanePick()` puts it down, and
**`consumePlanePick(base)` is the single consume path**: both routes in (a tree
row and a quad in the viewport) and all four fields go through it, so there is
still exactly one rule about what a click does.

What differs between callers lives in **one** place, `planePickRefusal(base)`,
which returns `null` if the pick would take that plane and otherwise the
sentence to say. The tree rows, the drawn quads, the origin-plane dimming, the
cursor, the hover highlight and the click itself all ask it, so a plane that
*looks* refused is refused, and for the reason it then gives.

Nothing was cloned. There is no second pending slot, no second consume, no
second "is it legal" — `planeLeansOn` is still the one loop walk, and
`planesParallel` is now the one parallel test, asked by both the pick and
`axisGeom` so a pick that lands always builds an axis that exists.

The panel side collapsed the same way: `fieldPlanePick(f, field, label,
fallback, id)` builds the one-button "which plane?" field, and all four call
sites use it. The button still carries `id`, `dataset.base` and the `.base-pick`
class the last round's suites read, so `prop-base-pick` is unchanged and
`planepick.js` did not move.

### The three legality rules, and why they genuinely differ

| field | rule | why |
|---|---|---|
| `dplane.base` | not itself, and not a plane that already leans on it (`planeLeansOn`) | a plane **defines** itself in terms of another, so a base that leads back here is a cycle the resolver cannot unwind |
| `mirror.plane` | any plane that still resolves | a mirror **consumes** a plane and defines nothing, so no chain of plane definitions can run through it — no cycle is possible |
| `daxis.pa` / `pb`, method `planes` | not the plane already in the other field, and not parallel to it | the axis **is** the line where the two meet; the same plane twice, or two parallel ones, is not a line |

`daxis` with method `normal` uses one plane and refuses nothing — including
planes parallel to anything, which is the whole point of that method.

### There is no tree-order rule in this app, so the pick did not invent one

The brief asked whether a feature may only reference reference geometry that
sits **above** it in the tree. Checked, and the answer is **no** — the app has
no such rule anywhere:

- `planeOf` / `planeFrame` / `resolveAxis` all look features up with
  `features.find(...)` over the **whole** list, not `features.slice(0,
  rollbackIndex)` and not "everything above me".
- `dplaneBaseFrame` says so in as many words: *"A plane may be based on one that
  sits BELOW it in the tree, and that one has not run yet this rebuild. Resolve
  it on demand rather than calling a face that is perfectly present missing."*
- The `revolve` and `cpattern` axis lists, and the old `daxis` plane list, were
  built from every matching feature with no index filter.
- The only ordering that actually bites is **sketches**, and it is implicit:
  `sketchData` is cleared and refilled as the feature loop runs, so an extrude
  above its sketch fails with "needs a sketch". Nothing equivalent exists for
  planes or axes.

So the pick offers a plane below the feature in the tree, takes it, and builds.
`axmirpick.js` check 13 asserts exactly that with a mirror at index 5 reflecting
about a plane at index 7.

**But it does not FOLLOW that plane** — and that is the app's, not this round's.
The per-feature checkpoint keys are prefix-accumulated (`run += '|' +
sigStr(keyed[i])`), so editing a feature at index 7 leaves the key at index 5
valid, the checkpoint there is restored, and the consumer never re-runs.
Reproduced at `2865c7b` (before any of this) with a **revolve** whose `ax:` axis
feature sits after it: edit the axis's Position X from 0 to 10 and the solid
stays put at x −7..7, while the same document with the axis *above* the revolve
moves correctly to x 4..16. `$SP/stale3.js` is that experiment; `$SP/stale2.js`
is the mirror equivalent on this branch. Fixing it means teaching the checkpoint
key about the reference geometry each feature resolves, which is a change to the
rebuild's core and not this job — but it is the reason `help.html` says *"make
the plane before the mirror"* rather than promising it follows unconditionally.

### A mirror can now reflect about any plane

It could not before: `applyFeature` read `const pl = DATUM[f.plane]`, so the
three origin planes were the only possible answers and the segmented control
listing them was, in a sense, complete. Pointing only makes sense if there is
something to point at, so the mirror now resolves through **`planeOf`**, the
same function `axisGeom` uses. For an origin plane `planeOf` hands back exactly
the point and normal `DATUM` already held — `o` is the same `(0,0,0)`, `n` is
the same unit vector — so every document written before this reflects about
precisely what it always did, `verify`'s two mirror cases included.

`mirror.plane` still holds a **string**. Origin planes still store `'Right'`;
a plane of your own stores `'dp:<id>'`, which is the same shape
`dplane.base` has stored since last round and which every resolver here already
accepted alongside a plain name. Nothing reads `mirror.plane` except the build.

`daxis.pa` / `pb` behave the same way: they always accepted a plane's **name**
(that is what the old list wrote), they still read one, and the pick now writes
`'dp:<id>'` for a plane of your own — robust against a rename, where a name is
not.

### Two things that were quietly wrong and are not any more

- **A cancelled pick left its button lying.** Press *Base plane*, press
  <kbd>Esc</kbd>, and the button still read `Click a plane…` with nothing
  armed. It was true of the base pick from the day it shipped and
  `planepick.js` check 9 did not look. `endPlanePick` and `cancelPicks` now call
  `refreshPropsBody()`, which rebuilds the panel body only — `openProps` would
  have rebuilt the model with it, and nothing about the model changed.
- **The axis panel's picks did not put each other down.** Arming a plane pick
  now clears `pendingAxisPick` and `pendingPlaneFace`, switching *Defined by*
  clears both kinds, and the circular pick clears a plane pick. Otherwise a
  click meant for a plane could land on a face.

### Marking, in the viewport as well as the tree

Datum-plane quads already had three states (teal candidate, amber hover, dimmed
refusal) and they now read `planePickRefusal` instead of `planeBaseAllowed`, so
they mark the right thing for whichever tool is asking. The **origin** planes
gained the missing one: an origin plane an armed pick would refuse is drawn at
opacity 0.05 instead of 0.2, because with the axis rules an origin plane finally
*can* be refused (pick `pb` with `pa` = Top and Top is out). A candidate marked
in the tree and not in the viewport would be two different promises about one
plane. `setPlanePickHover` refuses to light a plane the click would not take,
and the cursor follows it.

### Testing

`$SP/newdemos/axmirpick.js`, 16 checks, added to `$SP/runbattery.sh` before the
run started:

1. the Mirror panel names its plane on a button, no list left
2. arming marks every plane a candidate — tree and viewport (mirror refuses nothing)
3. a tree row mirrors about **that** plane: 272 + 272 − 128 = 416 mm³, x 2.5..15.5
4. the viewport: hovered quad amber, click mirrors about it
5. an origin plane stores the same plain name the record always held
6. the axis panel names both planes, no list
7. same-plane and parallel refusals, with their sentences, pick stays armed
8. `pa` from a row, and the **drawn** axis line follows the shared line (25° slope)
9. `pb` arms its own pick and takes a viewport click
10. *Normal to a plane* picks its one plane and refuses nothing
11. Escape disarms and hands the pinned/unpinned origin planes back exactly
12. a plane that is gone is refused; a document holding one says so on the feature
13. a plane **below** the feature in the tree is offered, taken and built
14. one armed pick at a time
15. cancelling the panel disarms and leaves the plane untouched
16. zero page errors

Geometry is judged from the kernel (`BRepGProp` volume) and the drawn meshes'
bounding box, not from a variable — where a reflection *lands* is the only proof
the plane that was picked is the plane that was used.

**Mutation run**, four deliberate breakages, each restored afterwards:

| mutation | result |
|---|---|
| `planePickRefusal` always returns `null` | 12/16 — 7, 8, 9, 12 red |
| mirror back to `DATUM[f.plane]` | 12/16 — 3, 4, 12, 13 red |
| tree rows stop marking candidates | 10/16 — 2, 7, 9, 10, 11, 13 red |
| `consumePlanePick` writes `f.base` whatever was asked | 9/16 — 3, 4, 5, 8, 9, 10, 13 red |

### What is still weak

- **The out-of-order staleness above.** Reachable: add a Mirror, then add a
  plane, then point the mirror at it. It builds right on load and right on any
  edit at or below the mirror; it does not follow later edits to that plane.
- **`planePickRefusal` is called per row per tree refresh**, and for the axis
  rules it resolves two plane frames each time — O(n²) frames in the number of
  planes while a pick is armed. Tens of planes is nothing; hundreds would show.
- **Hovering a tree row still does not tint that plane's quad.** Same gap the
  last round left: `planePickHover` is only written from the canvas.
- **The refusal sentence is computed twice** for an origin tree row (once for
  the class, once for the title). Cheap, but it is the kind of thing that drifts.
- **A `daxis` can still end up parallel by the back door**: pick two planes that
  cross, then tilt one of them until it is parallel to the other. The pick
  cannot refuse that — it has already happened — and `axisGeom` throws with its
  own message, which is the honest outcome but is not the pick's doing.

### The four-up "Defined by" control

Worth saying because it is a visible change nobody asked for: the Add-axis
method switch has four options with real names, and a `.seg` is one flex row
inside a 230&nbsp;px panel. *Centre of a circle* was being laid out past the
right-hand edge — not truncated, **absent**: unreadable and unclickable. A
scoped class, `.seg.seg-2up`, wraps that one control to a 2&times;2 and every
other segmented control in the app is byte-for-byte as it was. Screenshot
`$SP/lamp/axispick.png` shows the four options.

### Results

- Battery, all pins held: `verify` 12/12 · `brepsel` 47 realEdges / 21 faces /
  14765 tris · `loft` allOk · `offline` 9/9 · `lighttool` 10/10 · `lights` 10/10
  · `offsetplane` 17/17 · **`planepick` 18/18 — it did not move** ·
  **`axmirpick` 16/16 (new)** · `solver` 114/114 · `gcsglue` 37/37 ·
  `gcsbrowser` 9/9 · `gcsdrive` 38/38 · `gcsoff` 8/8 · `textfeat` roundtrip
  match · `colors` / `uicolor` / `library` / `drawref` / `polycon` / `gate` /
  `rollbar` / `boltnut` clean, zero page errors throughout.
- Documents identical (`$SP/docsame.js`, now comparing against **two**
  baselines found by walking `rev-list` for a marker, because HEAD is
  checkpoint-committed and already carries the change): pillow 378.7121 / 1
  body, magic lamp 2882.2725 / 1, `models/magic-lamp.sketchcad` 2882.2725 / 1,
  and a purpose-built three-mirror document 607.3345 / 2 — same volumes, same
  body counts, same per-feature errors and same resolved datum frames at
  `2865c7b` (before this change) and at `993adec` (before the base pick). The
  mirror document was added because neither shipped demo carries a mirror: the
  boat that does is deliberately off the Demo menu, so the mirror resolver would
  otherwise have been compared only by `verify`'s kernel pins.
- `FEATURE-MATRIX.html`: no tally moved — *Mirror feature* and *Custom datum
  planes & axes* were already ✅ ✅ ✅. Both notes were updated through
  `dev/matrix_done.py` (never by hand) so the cards and the token total are
  recomputed from the table; the diff is two `<span class="q">` strings.

## Arcs the solver can hold, and the five tools that were missing

Two jobs, one round. The solver gained **arcs** as real constrainable geometry
(ported from upstream, in `planegcs.js`), and the dock gained the five
relationships the solver had understood since phase 1 but nothing offered:
**perpendicular, tangent, symmetric, midpoint, collinear**.

### First, the thing that was not true

The brief said "freyacad's sketcher can draw arcs, so the solver covers less
than the app produces". **It cannot.** The dock draws lines, construction lines,
four rectangle variants, circles, regular polygons and splines — there is no arc
tool and no `arc` entity in any saved file, demo or model. The curves you see in
a rounded corner are `cornerPts` tessellating a fillet into the poly's own point
list at build time; they are not geometry of their own.

So what landed is **the whole solver-side arc**, tested end to end through the
real adapter, with nothing in the sketcher that can produce one yet. That is
honest infrastructure, not a feature: the next agent who writes an arc tool
should find that DOF, drags, dimensions, coincidence, tangency, concentricity
and the diagnosis all already work on it. What is still missing is the drawing
tool, the overlay rendering, `dimHit`, and the kernel path (`entSegs` /
`stitchLoops` / `pathChain` would have to emit a real arc edge or tessellate
it). None of that was touched, deliberately — it is the part that could break
extrude, loft and the profile stitcher, and it is a feature of its own.

### The arc variable model

**An arc is five numbers: `c.x, c.y, r, a0, a1`** — centre, radius, start angle,
end angle. `entVarCount` says 5, `entPoints` hands out three points (centre = 0,
start = 1 at `a0`, end = 2 at `a1`), and `coupledEnt` therefore reads true,
because 5 < 2×3: an arc's ends are *functions* of its numbers, exactly as a
regular polygon's corners are.

`entSpin` and `entSeg` both say **no** for an arc: it has no straight segments at
all, so every segment-shaped tool (horizontal, vertical, parallel, equal length,
perpendicular, collinear) simply cannot reach it, and a record that names one
lands in `ctx.skipped` where the chip will say so. What *does* reach it are the
point-shaped and circle-shaped rules: coincident on an end, tangent, concentric,
equal radius, a radius or diameter dimension, a distance dimension to an end.

**An end that some constraint names costs two auxiliary parameters**, appended
after every entity's own variables, pinned by a pair of upstream's
`ConstraintCurveValue` equations (`System.addConstraintArcRules`), one per
coordinate:

```
start.x - (c.x + r*cos(a0)) = 0      start.y - (c.y + r*sin(a0)) = 0
```

Two parameters against two always-independent equations, so an arc still counts
as five degrees of freedom. This is upstream's own device and the same one
`ConstraintPolygonCorner` borrows; the difference is that here it is upstream's
primitive rather than one of ours.

**Per end, not both at once, and that is not a saving.** The obvious port —
`addConstraintArcRules` materialises `start` and `end` together, as upstream
does — has a nasty consequence in a minimum-norm solver: an end nobody named
still has parameters, so when the arc's centre or radius moves the least-norm
step happily splits the correction between that end's coordinates and its angle,
and **the arc silently changes how far it goes round every time it is
dimensioned**. Measured: an arc from 0.35 to 1.6 rad, given a radius, came out
0 to 1.516. `gcsArcEnd(ctx, ei, k)` builds one end at a time; an end nothing
refers to has no parameters and cannot absorb anything. The suite pins the angle
of the untouched end to the last bit.

### What was ported, and what was written

Ported from upstream at the **same commit the header already records**,
`fda5c1438057ec84fb1d5bd0f45fb29e94e0c8e1` (re-fetched from
`raw.githubusercontent.com` and md5-identical to the copies phase 1 read), all
inside `planegcs.js`, all LGPL-2.1-or-later with the upstream copyright intact:

- `DeriVector2::multD`, and the **`Curve::Value` contract** — `Line.value`,
  `Circle.value`, `Circle.calculateNormal` — the parametric point and its
  derivative (Geo.h / Geo.cpp).
- **`Arc`**, subclassing `Circle`, with `startAngle`, `endAngle`, `start`, `end`
  and its `pushOwnParams` / `reconstruct` order (Geo.h / Geo.cpp).
- **`ConstraintCurveValue`** with its `errorgrad` and `reconstructGeomPointers`
  (Constraints.cpp) — its `maxStep` returns `lim`, which is the base class's
  behaviour here and so needs no override — including upstream's trick of deciding which
  coordinate it constrains by identity of the `pcoord` pointer — here object
  identity, which survives parameter redirection because both entries redirect
  through the same map.
- The `System` helpers: `addConstraintCurveValue`, `addConstraintArcRules`,
  `addConstraintPointOnArc`, `addConstraintTangentLineArc`,
  `addConstraintArcRadius` (GCS.cpp).

`copy()` is upstream's `Curve::Copy` with the one detail a JS port has to get
right: the clone shares the *parameter objects* and only the `Point` wrappers
around them are new, which is what a C++ copy of a struct-of-`double*` does
anyway. `ConstraintCurveValue` relies on it — it holds its own curve, but the
numbers it reads are the system's.

The header's "WHAT IS NOT PORTED" list lost "arcs" and kept everything else.
`PlaneGCS.version` is 2, and `Arc` / `ConstraintCurveValue` are exported.

Nothing of freyacad's moved into `planegcs.js`, and none of the arc code moved
out of it into `index.html`. The adapter (`gcsBuild` / `gcsArcObj` /
`gcsArcEnd` / `gcsPoint` / `gcsCircleOf` / `gcsApply`) is freyacad's, as before.

### Negative radius, on an arc, is not `Math.abs`

`gcs.apply` writes `Math.abs(r)` for a circle, which is right — a circle with
radius −5 is the same circle. For an **arc** it is wrong: the mirrored arc is on
the opposite side. The arc branch turns the angles with it —
`r = -r; a0 += π; a1 += π` — which is exact. `gcsInsideOut` still treats a solve
that got there as a failure (it looks at every `rec.r`, so it covers arcs with
no change); this only makes the state it leaves behind sane rather than
scrambled. The circle's `Math.abs` is untouched.

### The five tools

Records, all in `sk.cons`, all going through `gcsAskAfter` → `gcsConCheck` →
`guardDims` → `gcsSettle` exactly as Parallel does:

| tool | record | solver |
|---|---|---|
| `perp` | `{kind:'perp', a:{ent,seg}, b:{ent,seg}}` | `Perpendicular` |
| `collin` | `{kind:'collin', a:{ent,seg}, b:{ent,seg}}` | `Parallel` + `PointOnLine` |
| `midpt` | `{kind:'midpt', ref:{ent,idx}, seg:{ent,seg}}` | `PointOnPerpBisector` + `PointOnLine` (upstream's `addConstraintP2PSymmetric(p1,p2,point)`) |
| `symm` | `{kind:'symm', a:{ent,idx}, b:{ent,idx}, about:{ent,seg}}` | `Perpendicular` + `MidpointOnLine` |
| `tangent` | `{kind:'tangent', a, b, flip?}` — a side is `{ent,seg}` for a line, `{ent}` for a circle or arc | `P2LDistance` (line↔round) or `TangentCircumf` (round↔round) |

`perp`, `tangent` and `symm` were already in `gcsAddCon` from phase 1 and needed
no adapter work; `midpt` and `collin` are new mappings. Badges: ⊥, ⌒, ⋈, M, ↔,
with titles, hit-testing and deletion identical to ∥ and =. `gcsName` names all
five, so a refusal can say what it fought. Dock buttons, icons, `CMD` entries and
the Relations section of `DEFAULT_LAYOUT` all gained them —
`adoptNewCommands` puts them into a stored layout on next load, so someone who
had customised the dock gets them too.

Four of the five run a **one-shot move first**, for the same reason Parallel
does: it picks the branch, and it is the configuration the solver is then asked
about.
`applyPerp` swings the follower a quarter turn off the reference (about its
anchored end if it has one, else its midpoint, honouring `heldEnd` like every
other tool); `applyCollinear` is `applyParallel` plus a sideways slide onto the
reference's infinite line; `applyMidpt` puts the point at the middle;
`applySymmetric` reflects the second point onto the first one's mirror image, and
swaps the two if the second is the origin, which cannot move. **Tangent runs no
one-shot** — unlike a horizontal it does not compile to an equality the solver
would collapse, so asking from where the sketch already is asks the right
question.

### Erasing an entity: the list of special cases is gone

`dropDimsFor` renumbered stored constraints through a hand-written list —
`coinc` by its two point refs, `ontrace` by `ref`, "pair" meaning exactly
`paral` or `equal`, everything else by a bare `c.ent`. Five new kinds with
three new shapes between them (`symm` names three things, `midpt` two of
different sorts, `tangent` two that are each either a segment or a whole
entity) would have fallen through to the `c.ent` tail, which they do not have —
so erasing an entity would have left them **pointing at whichever entity slid
into the vacated slot**, silently holding the wrong geometry. That is worse
than losing the record.

It now asks each record which references it owns (`a`, `b`, `ref`, `seg`,
`about`, any of them an object carrying `.ent`) and drops or shifts all of
them; horizontal and vertical are the one shape with no ref object and still
fall through to the tail. A new kind joins the reindex by having refs, not by
being added to a list. `arcs.js` erases entity 0 from a sketch carrying one of
every shape and compares the whole `cons` array afterwards, so this cannot
quietly stop working. `shiftPointRefs` (spline point insert/delete) gained
`bump(c.ref)` in the same spirit, which also fixes `ontrace` on a spline point
— a hole that predates this work.

### The tangent side — the decision, and why

Phase 2 flagged this: tangency fixes its side at build time (upstream's `ccw`)
and cannot re-solve round the other way. Adding a tool makes that user-visible.
What was chosen:

1. **The side is read off the geometry at every build, and never stored.** So a
   tangency follows the arrangement you can see, rather than freezing whichever
   one held when the badge was first added. Drag a circle through a line and the
   next solve keeps it on the side it now sits. The flag still cannot move
   *during* a solve — that is what stops it flipping mid-iteration, and it is
   why upstream has it at all.
2. **The record can ask for the other one**, with `flip`. Nothing about the side
   itself is stored — only the user's wish to have the other one — so `flip`
   survives geometry changes without going stale.
3. **The tool is the flip control.** Name a pair that already has a tangency and
   it turns over instead of stacking a second badge up: `storeTangent` finds the
   existing record (either order, line-or-circle side either way) and inverts
   `flip`. The hint says so both times, and the badge's tooltip reads
   "Tangent (the other side)".

Why not "pick the nearer side at creation and keep it": that is what freezing the
flag *is*, and it is the behaviour that made this worth flagging. Why not "flip
automatically on rebuild": it already does, in the only sense that is safe — the
side is re-read every build, so it follows the geometry; what it must never do is
change under a solve that the user did not ask for. The measurable behaviours are
in the suite: a line above a circle stays above, a line below stays below, `flip`
puts it on the other side, and two circles apart touch outside (centres r1+r2
apart) while flipped they nest (r1−r2).

### The two phase-2 warts

- **`gcsPivotEnd` no longer duplicates `segPivot` when it can help it.** It now
  calls `segPivot` when the host function is reachable and maps the point it gets
  back to an end index; the inline rule is still there because the node suites
  evaluate the adapter block on its own with only the structural interface beside
  it. They can still drift *in the node harness*, but not in the browser, which
  is where it mattered.
- **Negative radius**: addressed for arcs (above), unchanged for circles.

### The suite

`newdemos/arcs.js`, **101 checks**, added to `runbattery.sh` (after `gcsoff`).
Two halves in one run. The first is plain node and lifts the adapter out of
`index.html` between its markers, evaluated with the real `entPoints`,
`entVarCount`, `entSpin`, `entSeg`, `coupledEnt`, `resolvePt`, `arcAngle`,
`setArcEnd` and `arcEndRef` pulled from the same file — so it tests the code the
browser runs, and a drift between the arc's five variables and `entVarCount`
fails a test. The second half is Playwright and drives all five tools through the
real dock button, the real canvas and the real records.

What it covers: the arc's variables and points against the structural interface;
the live end accessor (including its one-coordinate-at-a-time semantics, which it
shares with `polyCornerRef`); every new gradient against finite differences
(worst relative error **4.2e-9**, on `TangentCircumf` — the arc's own
`CurveValue` is 6.1e-10); a constrained arc solving to an exact analytic answer
(centre 0,0, r 5, a0 0) with the untouched end's angle unmoved to the last bit;
a line made tangent to an arc; the negative-radius turn; each of the five records
building, solving and staying out of `ctx.skipped`; a conflicting use of each
being refused *and named*; a redundant use of one being allowed; the tangent side
in all four arrangements; a record naming geometry that is gone landing in
`skipped` (the negative control for all of the above); the five dock buttons
really existing with labels and icons; the perpendicular badge really appearing
with the right glyph and title; and the lamp demo still opening, still reading
from the solver, still skipping nothing.

Every click in the browser half checks `elementFromPoint` first. That caught a
real one: a click at the top of a fitted sketch landed on a **dock button's
label span**, which silently switched the tool — the trap the handover already
warns about, hit again, and the reason the symmetric refusal case uses a sketch
that fits inside the middle of the view.

### Something surprising, worth knowing

**A redundant constraint that the geometry does not already satisfy downgrades a
successful solve to `Converged`, which `gcsSettle` reads as a failure.**
`System.solve` checks every constraint in `this.redundant` after the subsystems
have solved — but the subsystems work on *copies*, and `applySolution` has not
run yet, so those constraints are evaluated against the geometry as it was
**before** the solve. If the redundant one was already true at the start (the
usual case — a parallel on a rectangle that is already parallel) it reads zero
and the status stands. If it was not (a diameter dimension made redundant by a
coincidence, on an arc that has not been resized yet), the solve reports
`Converged` and the settle falls back to `relaxDims` even though the answer was
exact to 1e-19. This is upstream-faithful and predates this work; it is not
arc-specific. It cost half an hour of chasing a "failing" test whose geometry was
perfect, which is why it is written down.

Also worth knowing: **the rank-based conflict test only sees linear dependence,
not infeasibility.** Two lines both constrained horizontal, then asked to be
perpendicular, is *not* reported as a conflict — the two horizontals are
eliminated by merging and the perpendicular equation is satisfiable by collapsing
a line to a point, so the rank is full and nothing is flagged. What it does catch
reliably is a constraint that duplicates a *dimension's* freedom: perpendicular
against a 30° angle dimension, collinear against the same, a midpoint on a line's
own end against that line's length. That is what the refusal tests use, and it is
worth knowing before writing a test that expects "obviously impossible" to be
refused.

### What is still weak

- **No arc tool.** The whole of the above is unreachable from the UI until one
  exists. `dimHit` has no arc branch either, so even an arc placed into
  `editing.entities` by hand cannot be clicked.
- **Perpendicular and parallel are raw dot and cross products**, scaled by a
  constant fixed at construction. That is upstream, and it is why the rank test
  cannot see "parallel and perpendicular at once" as a contradiction.
- **`applyCollinear` slides by the follower's midpoint offset**, so if its
  anchored end was off the reference line, the anchored end moves. The solver
  settles from there; the one-shot only picks the branch.
- **The tangent tool cannot name a rectangle's side** — `dimHit` reports a
  rectangle as `width`/`height`, not as a segment, so `tangPick` returns nothing
  for it. `gcsSeg` would accept `{ent, seg:0..3}` happily.
- **A tangency between two entities that are *both* straight is refused by the
  tool with a hint**, not by the solver; the solver would build `P2LDistance`
  with a nonsense radius if it were asked.
- **`symm` about a plane trace** is in the adapter (`c.trace`) and has no tool —
  the tool always picks a sketch segment.

### Results

- Suites run (only the ones this could break, plus `verify`): **`arcs` 101/101
  (new)** · `solver` 114/114, worst Jacobian relative error still 9.8e-10 ·
  `gcsglue` 37/37 · `gcsbrowser` 9/9 · `gcsdrive` 38/38 · `verify` 12/12 ·
  `polycon` byte-identical to its last run but for `cardOpacity`, which is a
  sample taken mid-fade and differs run to run. Zero page errors anywhere.
  The rest of the battery was deliberately **not** run — nothing here touches
  the kernel, the tree, lighting or the drawing sheet — and `runbattery.sh`
  carries `arcs` for whoever runs the lot at integration.
- `arcs.js`'s own worst gradient error against finite differences: **4.2e-9**
  (`TangentCircumf`, which is pre-existing); the newly ported `CurveValue` is
  1.9e-10 to 6.1e-10 across arcs and lines.
- `FEATURE-MATRIX.html`: **"Geometric constraints" moved ◐ → ✅** through
  `dev/matrix_done.py`, because all five tools landed and all five are tested
  through the real dock. freyacad now reads 44 ✅ · 3 ◐ · 29 ❌ of 76.
- `help.html`: the constraints section gained the five tools and the tangent
  turn-over, the badge paragraph lists every glyph, and the two stale "known
  limits" bullets were replaced — "no perpendicular, tangent or symmetric
  constraint in the dock" is gone, and "sketch arcs are not constrained
  geometry" became the honest "there is no arc tool yet". Both dates bumped.

## Two pixel tripwires that had to be rebaselined

The owner asked for the black between the top-plane grid lines to stop reading as
a solid slab. Two changes did it: the `.viewport` gradient no longer reaches pure
`#000000` (it bottoms out at `#080d14`), and the floor grid now dissolves into the
backdrop instead of stopping at the hard square edge of its own extent. On a dark
ground, blending a line into the backdrop IS a fade — no alpha ramp, no shader, no
second material and nothing new to sort.

**The grid is no longer a `GridHelper`, and it had to stop being one.** The first
attempt kept the helper and scaled its vertex colours down by each vertex's
distance from the middle. That cannot work, and it is worth knowing why before
someone tries it again: `GridHelper` emits each line as ONE segment spanning the
whole grid — `push(-a,0,h, a,0,h)` — so **both** of a line's vertices sit at the
extreme, every vertex reads distance 1, and the scale factor collapses to its floor
everywhere. The result was not a fade at all; it was the whole grid uniformly dimmed
to a tenth, with the square edge still perfectly crisp. A vertex colour can only dim
a line as a whole unless the line has interior vertices.

So the grid is built by hand: every line cut at each division, each vertex coloured
by `1 - d³` of its radial distance, `name='floorGrid'` so a suite that must ignore
the floor can find it. Radial rather than square, so the corners — the part that
most gave the square away — go first.

That tripped **two lighting suites**, and it is worth writing down why, because the
next deliberate visual change will trip them again if nobody does:

- `lighttool-main.js` check 8 — "with no stored key the workshop view is
  byte-identical to HEAD"
- `lights.js` check 9 — "with no lamps and the panel shut, the workshop AND
  rendered frames are byte-identical to the pre-lights build"

Both capture the WebGL canvas and compare every pixel against a build from before
the feature landed. Both reported 8924 (workshop) and 8921 (rendered) pixels of
315000 touched, `maxChannelDelta` 255 — while every piece of lighting state either
side was identical (`lights: 0`, `sceneLights: 1`, ground `opacity 0.3` at
`y −0.002`, exposure 1, tone 0, hemi 0.4). The 255 is not alarming: `frameBytes`
draws the WebGL canvas onto a transparent 2D canvas and reads it back
**unpremultiplied**, so an antialiased grid-line pixel with alpha near zero has its
RGB divided by almost nothing. The whole diff was the grid's rim.

The fix was NOT to re-pin the baselines to a newer commit — that would throw away
the one thing those checks mean, which is *the lighting feature is inert when you
do not use it*. Instead `frameBytes` in both suites now hides every `GridHelper` in
the baseline page and the lane page alike before rendering, and restores it after.
The model, its shadow and the shadow-catching ground stay compared; nothing the
lights feature can touch is hidden, so no coverage is lost. What is lost is the
suites' dependence on floor styling they were never testing.

**If you change how the viewport backdrop or the grid looks, these two checks are
now indifferent to it. If you change the ground, the model or the shadow, they are
not — and that is the point.** Note this is a different fault from the one still
open against `lighttool-main.js` check 8: that check builds its baseline from
`git show HEAD:freyacad/index.html`, so once the lane is committed it compares a
tree against itself and can no longer fail at all. `lights.js` check 9 does it
properly — it walks `git rev-list` back to the last commit whose `index.html`
lacks the feature. Check 8 should learn the same trick.

`gcsSig` also gained `'A'` for an arc. It letters entity types for the solver's
cache key and had no arc branch, so an arc signed as `'?'` — the same as any type
the function has never heard of. Nothing in the sketcher makes an arc yet, so this
was latent rather than live.

## A rectangle is four lines

The owner drew one and found it was not: *"after a square is drawn it should
just be like four separate lines joined at the corners where you can delete
sides one at a time if you wish, same with polygons, just like SW."* Three
separate faults, and they split by variant:

| tool | was | 4 handles? | erase one side? | opposite sides held? |
|---|---|---|---|---|
| Rectangle — two opposite corners | `{type:'rect',a,b}` | no, 2 | no, the whole shape | by construction |
| Centre rectangle | `{type:'rect',a,b}` | no, 2 | no, the whole shape | by construction |
| 3-point rectangle | closed 4-point `poly` | yes | yes | **no** |
| 3-point centre rectangle | closed 4-point `poly` | yes | yes | **no** |

The first two only ever had two handles because `entPoints` builds corners 1
and 3 fresh on every call — `[e.a, {x:e.a.x,y:e.b.y}, e.b, {x:e.b.x,y:e.a.y}]`
— so anything that wrote to them wrote to a throwaway. `liveRef` says so out
loud (`r.idx===0||r.idx===2`). That is not a bug in the branch; it is what
"two stored corners, axis-aligned" means. And the eraser could only take the
whole entity because `dimHit` on a `rect` returns `{kind:'width'}` or
`{kind:'height'}` — never a `seg` — so `removePolySegment` was never reachable.

### What all four tools commit now

`commitRectLines(cor, rotatable, ground)` — four separate two-point `poly`
entities, side k running corner k → corner (k+1)%4, plus the records that make
them a rectangle:

- four `coinc`, corner k joining the end of side k−1 to the start of side k;
- axis-aligned (`rect`, `crect`): `horiz` on sides 0 and 2, `vert` on 1 and 3;
- rotatable (`rect3`, `crect3`): `paral`(0,2), `paral`(1,3), `perp`(0,1).

Side k is corner k → corner k+1 for **all four** tools (`rect3Corners` and
`crect3Corners` already returned their corners in that order), so "opposite" is
k and k+2 and "adjacent" is k and k+1 whichever tool drew the shape. That is
the whole reason the same helper can serve all four.

### The degrees of freedom, which is the number to check

Four lines × two points × two coordinates = **16**.

| | equations | left |
|---|---|---|
| four coincidences | 8 | 8 |
| axis-aligned: H, V, H, V | 4 | **4** — left, right, bottom, top |
| rotatable: ∥02, ∥13, ⊥01 | 3 | **5** — place 2, angle 1, width 1, height 1 |

Measured, not assumed: `rects.js` reads the chip before drawing (the suite's
guide run is 4 on its own) and after, and asserts the difference. It also
proves the set is minimal from the other side — a fourth right angle on the
rotatable one comes back `redundant`, which is what says three was the right
number rather than a lucky one.

**The records go straight into `sk.cons`, not through the constraint tools.**
Two reasons. The geometry is already exactly right at creation, so the one-shot
move every tool runs first has nothing to correct; and `storeSegPair`'s
one-master-per-follower rule ("a newer parallel replaces the older one on the
same follower") would have thrown away the second parallel of the pair.

`dynMirrorAdd` runs for the four indices only **after** all four entities and
every record are stored, so the reflections append past them and the indices
the constraints name stay the ones they were given. `flashLoop` wants one
entity, so it gets a throwaway `{type:'poly',closed:true,pts:cor}`; it is
display-only and never enters the sketch.

### Why four lines rather than one entity that knows it is a rectangle

Because that is what the owner asked for, and it is what SolidWorks stores —
but also because the machinery was already there and the alternative was not.
Four separate runs already stitch into a profile (`stitchLoops`), already erase
a segment at a time (`removePolySegment`), already carry a length dimension per
side, and already drag as one through the coincidence graph. A `rect` that grew
four independent corners would have needed its own version of every one of
those. And the reverse direction is the real prize: delete the perpendicular
badge and the shape is free to be any quadrilateral, which is exactly what a
parametric sketcher is for and what `{type:'rect'}` could never express.

### `type:'rect'` is not going anywhere

Around thirty branches still read it, old saved files carry it, and so do the
demos, the `DEMO_*` fixtures and `drawref.js` / `loft.js`. **Four creation sites
changed; the type did not.** `rects.js` loads a stored `rect`, and checks it
still extrudes to exactly w×h×depth, still shows two handles, still dimensions
by width and height, still offers its derived corners to `cornerAt`, still
resizes when its stored corner is dragged, and still goes as a whole shape
under the eraser.

## A corner that belongs to two lines

Four lines stitching into a profile already worked. What did **not** was a
**per-corner** fillet or bevel on one, and rounded rectangle corners are bread
and butter for 3D printing, so shipping the change above without this would
have been a regression the owner hit on day one.

Three things had to change, and only the first two were in the plan.

**1. `stitchLoops` carries provenance.** It already threads a per-point `segs`
array through the chain walk; it now threads an `own` array the same way, one
`{ent,idx}` per loop point. `applyCorner(sk,L,closed,ei,own)` takes it and
looks each point up on its own, instead of falling back to the sketch-wide
setting because a stitched loop has no single `ei`. Both consumers
(`entityLoops` and `OCK.sketchLoops`) pass it. A curved run's points are
tessellated and index nothing stored, so it carries nulls — and a curved loop
skips corner treatment anyway.

**2. One corner, one name.** At a junction two runs each have an endpoint on
the spot. The record is canonicalised to the **lower** of the two, entity index
first then point index — in `stitchLoops` as the walk steps through the
junction, and in `junctionAt` for the hit test — or a corner rounded from one
line would read as square from the other. `junctionAt` only answers where
**exactly two** ends meet, which is also the only junction `stitchLoops` walks
through: at a fork it stops rather than guess, and a corner there would
describe a profile nobody drew. Construction runs, splines and closed runs are
out of both for the same reason.

**3. The click could not reach the hit test at all, and the brief did not know
it.** The plan said `cornerAt` refused to offer a corner on an open run, which
is true — but fixing that alone changes nothing, because a pointer-down near a
handle *takes the gesture* (`dragVtx=h`) and the pointer-up returns before
`sketchClick` ever runs. A shape's corners are exactly where its handles are,
so **per-corner fillets were unreachable by clicking on anything whose corners
are stored points** — a closed polyline, a regular polygon, and now a
rectangle. On the old `rect` they worked only because corners 1 and 3 are
derived and carry no handle.

So a grab that has not travelled is no longer a drag: `dragMoved` is set in
`pointermove` only once the pointer is more than 2 px from where it went down,
nothing is written before that, and `pointerup` with `!dragMoved` drops the
undo step the grab banked and hands the point to `sketchClick`. The outline
grab next door already read a still tap as a selection and says so in its own
comment; this is the same rule for point handles. It also means a tap on a
circle's centre now selects the circle instead of doing nothing.

**This fixes per-corner fillets on any hand-drawn four-line rectangle too — a
hole that predates all of this** — and makes them reachable on a polygon and on
a closed polyline for the first time.

### The sketch shows the corner the kernel is given

One more thing had to follow, or the fix would have been invisible until you
extruded: `cornerPoly` never touches the ends of an open run, because within
one entity there is no corner there. So the four lines drew square while the
profile came out round. `runDisplayPts` rounds an open run against a **phantom
neighbour** borrowed from whatever its ends join — the partner's far point —
and trims the phantom back off afterwards. Both lines then draw the same arc,
which is what a rounded corner looks like, and every point either of them draws
is on the profile `entityLoops` hands the kernel (the suite checks exactly
that). It costs nothing on a sketch with no corner treatment: one boolean, and
it returns down the old path.

## A polygon gives up a side

A regular `polygon` is parametric — centre, radius, side count, rotation — and
its sides are not stored at all, so there is nothing to take one away from.
Rebuilding it out of N free lines would need an **angle constraint the app has
not got**, so the honest cheap thing is what shipped: the eraser **explodes**
it. `explodePolygon` replaces the entity, in place, with an open chain of the
corners it had minus the clicked side — the same "start just past the erased
span and run right round" that opening a closed chain does — and says so in the
hint. The first side costs the parametrics; every side after that is the
ordinary one-at-a-time removal.

`dropDimsFor(sk,ei,0)` runs for the entity that died: delta 0 because it
survives in place, so nothing after it moves. Everything pinned to the polygon
named its centre or a corner by an index the chain has not got, so it goes with
the parametrics — including its size dimension and its per-corner records.
A construction polygon explodes into a construction chain.

### The suite

`newdemos/rects.js`, **103 checks**, added to `runbattery.sh` after `arcs`, one
run of about 55 seconds. Two halves, the `arcs.js` pattern:

- **plain node, 50 checks** — the corner machinery, the profile stitcher and
  the polygon explode lifted out of `index.html` and evaluated with the real
  code beside them, plus the adapter for the degrees-of-freedom arithmetic.
  The spline branches are stubbed with functions that throw: this half only
  ever hands straight runs, and a stub that throws proves it.
- **Playwright, 53 checks** — all four tools drawn through the real dock and
  the real canvas, a corner dragged in each, a side erased with the eraser, a
  corner filleted by clicking it, the result extruded and its volume measured,
  a polygon exploded through the eraser, and a stored `type:'rect'` put through
  drawing, handles, `dimHit`, `cornerAt`, a drag and the eraser.

**Every check was watched failing.** Nine mutations were applied to
`index.html` one at a time and the suite re-run against each: `applyCorner`
ignoring `own` (4 red), `stitchLoops` dropping it (7), `junctionAt` not
canonicalising (1), `junctionAt` allowing forks (1), the explode dropping no
records (3), the display ignoring junctions (3), the tap-to-click branch
removed (4), the rotatable pair losing its perpendicular (6), and `rect`
committing one entity again (12). None was silent, and none took the run down
with it — two of them did at first, and the checks were rewritten to report a
missing structure rather than throw on it, because a suite that dies on the
first fault hides every fault after it.

### Results

- **`rects` 103/103 (new)** · `solver` 114/114, worst Jacobian relative error
  9.8e-10 · `gcsdrive` 38/38 · `verify` 19 fixtures, zero errors, byte-identical
  to its last run but for the `ms` timings · `brepsel`, `loft`, `drawref` and
  `gate` **byte-identical** to their stored runs (brepsel still 47 realEdges,
  21 faces, 2 planes, 14765 tris, 48-48 wholeEdge; loft still `allOk`) ·
  `polycon` byte-identical but for `cardOpacity`, which is a sample taken
  mid-fade and differs run to run. Zero page errors anywhere.
- The rest of the battery was deliberately **not** run: nothing here touches
  lighting, the drawing sheet, assemblies or the tree.
- `FEATURE-MATRIX.html` is unchanged and `dev/matrix_done.py` was not run —
  no row moved. "Rectangle" and "Round / bevel sketch corners" were both
  already ✅ in the freyacad column; what changed is how well they are true,
  which the matrix has no way to say and should not pretend to.
- `help.html`: the rectangle rows, the eraser row and the "Worth knowing" note
  under the drawing tools were rewritten for the four-line model; "Editing a
  sketch" gained bullets for erasing one side and for clicking a corner; the
  corner section no longer claims the ends of an open run are never offered;
  and the degrees-of-freedom paragraph now walks the rectangle's 16 → 8 → 4.
  Its date was already today's.

## What is still weak

- **`applyCons` has no `perp` branch**, so with `planegcs.js` missing the
  fallback relaxation holds a rotatable rectangle's parallels but not its right
  angle, and a drag can shear it into a parallelogram. `consOn` does not count
  a `perp` either, so the arithmetic DOF fallback reads one too many. Both are
  pre-existing gaps in the no-solver path (`perp` has never been in either),
  not new — but a rectangle is the first thing the sketcher itself creates that
  stores one, so they are reachable now where before they needed the tool.
- **Mirroring a new rectangle gives four loose lines.** `mirrorEntity` reflects
  one entity at a time and knows nothing about the records between them, so the
  reflection stitches and extrudes but is not held square. That is exactly what
  mirroring four hand-drawn lines has always done; making it carry the
  relationships means teaching the mirror about `sk.cons`, which is its own
  piece of work.
- **A corner where three or more runs meet is offered no treatment**, matching
  `stitchLoops`, which will not guess a profile there either. Right, but it
  reads as "nothing happens" rather than as a refusal.
- **`flashLoop` still passes the whole sketch's `corners` array** with a
  throwaway entity at index 0, so the green flash can borrow entity 0's corner
  overrides for its 650 ms. Display-only and pre-existing;
  `entityDisplayPath` next door renumbers them properly and shows how.
- **A rectangle drawn with dynamic mirror armed** gets its reflection from four
  separate `dynMirrorAdd` calls, so the two shapes are independent from the
  moment they are drawn. Same limitation as the point above, same fix.
- `gcsSig` already letters an arc `'A'` — that landed with the arcs round and
  the note at the end of the previous section records it. Nothing to do.

## Perpendicular on the path with no solver

A rotatable rectangle is the first thing **the app itself** stores a `perp` for.
Until now a `perp` only existed if someone added one on purpose, so the sketcher's
fallback — the path taken when `planegcs.js` does not load — had simply never met
one, and `applyCons` had no branch for it. The result was silent and ugly: drag a
corner of a three-point rectangle on such a build and it sheared into a
parallelogram, measured at **130° and 50°** where it should read 90°.

`applyCons` now handles `perp` the same way it handles `paral`, a quarter turn
off: the follower keeps its length and turns about its pivot, and the nearer of
the two square directions wins so it turns the short way rather than flipping end
for end. `consOn` charges a `perp` one freedom against the following line, the way
it already charged `paral` and `equal`, or a rectangle reads one degree looser
than it is.

`gcsoff.js` gained three checks that build a rotatable rectangle at 30°, drag a
corner, and measure all three interior angles plus the corner gaps. **Verified
able to fail**: with the `applyCons` branch removed the "stays square" check goes
red at 129.9° / 50.1°; with it, 90.0° / 90.0° / 89.7°.

### Two things the fixture had to get right, and one of them bit

- **A guard that the drag actually happened.** The first run passed the angle
  checks on a rectangle that had *never moved* — every angle was exactly 90
  because nothing had touched it. The suite now asserts a side's length changed
  before it believes the angles mean anything. Without that assertion this would
  have been another test that cannot fail.
- **Keep the fixture off the origin.** `pinsOn` treats a point at exactly (0,0)
  as held by the origin, so a rectangle with a corner there is ground-anchored,
  `defineState` reads every side as fully defined and the sketcher refuses the
  drag outright with "Fully defined — change a dimension to move this point".
  That is the existing no-solver arithmetic being conservative, not a regression:
  it behaves the same way with the solver absent for any origin-touching shape,
  and with the solver present `gcsStateOf` answers instead and the drag works.
  Still worth knowing that the arithmetic over-counts a ring of coincidences.
