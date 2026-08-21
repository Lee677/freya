# PLAN — trace dimensions, snap sizes, drag snapping

Handoff plan for `freyacad/index.html` (single file, ~5,000 lines, no build step).
Read `HANDOVER.md` first — it holds the standing rules and the traps that already bit us.
Line numbers below are as of commit `5ba8cbd` — re-grep, don't trust them blindly.

## Why (user-reported bug)

User drew a line from the origin, dimensioned its length, then tried to dimension its
angle "from the horizontal plane". The dim tool's second click only recognises sketch
entities (`dimHit`), so the click on the plane trace fell through to the "clicked clear
space" branch and stored the line's own length a second time — which `ensureDimStored`'s
dedupe silently dropped. Net: 4 vars − 2 (origin pin) − 1 (length) = 1 DOF (rotation),
so the endpoint still drags and the sketch never reports fully defined. The angle dim
they thought they placed never existed. Plane traces must become real dimension
references.

## A. Plane traces as dimension references (the bulk)

Reference shape: `{trace:'Top'|'Front'|'Right'}` — resolved against `traceSnapUV`
(each entry `{u0,v0,du,dv,t0,t1,name}` in sketch UV; confirm the `name` field exists,
add it if the builder doesn't store one). A trace is **ground**: dims against it cost
only the sketch entity's DOF — no double-count.

New dim kinds:

1. **Angle to trace** — `{kind:'angle', a:{ent,seg}, b:{trace:name}}`.
   Pick flow: line first, trace second (and trace first, line second should also work).
   `dimApply`: rotate the line about its anchored point (a point at the origin, else a
   point shared with an anchored entity, else its first point) so its absolute angle to
   the trace direction equals the value. Reuse the existing angle rotate-and-flip-check
   logic.
2. **Point to trace (perpendicular distance)** — `{kind:'ptrace', ref:{ent,idx}, trace:name}`.
   Pick flow: point first, trace second (or reverse). `dimApply`: move the point along
   the trace's normal to the given distance. This is FreeCAD's DistanceX/DistanceY —
   the correct way to pin a point with two dims (a single diagonal distance leaves it
   free on a circle; see HANDOVER trap 7).

Touch points — grep for each, all in `index.html`:

- `dimHit` (~line 3115): if no entity hit, test the traces (perpendicular distance to
  each `traceSnapUV` segment, tol `Math.max(0.35, R*0.022)` like the draw-snap line
  tol). Return e.g. `{kind:'trace', name}`.
- Dim-tool click handler (~line 3050–3076): wire the four pick orders
  (line→trace, trace→line, point→trace, trace→point). Update the hint strings.
- `dimResolve` (~line 3266): resolve trace refs to a direction/line in UV. Angle arc
  between line dir and trace dir; ptrace as a linear dim perpendicular to the trace,
  witness lines from the point to the trace foot. Anchor label geometry near the foot
  of the perpendicular / arc so it lands close to the sketch, not at infinity — traces
  are infinite in sketch mode.
- `buildDimGeom` / `emitDimGeom`: should mostly Just Work once dimResolve emits the
  same seg/tri primitives. Pending (greyed) rendering must work too — `openDimInput`
  calls `dimResolve` on the pending dim before it's stored.
- `dimApply` (~line 3440s): the two behaviours above. After applying, `rebuild()`.
- `dimKey` (~line 3474): add stable keys, e.g. `ang:1.0:trace.Front`,
  `ptr:1.2:trace.Front`.
- `dimsOn` (~line 1215): count angle-to-trace on `d.a.ent` only; count ptrace on
  `d.ref.ent`. **Guard the existing `d.a.ent===i||d.b.ent===i` line** — `d.b.ent` is
  undefined for trace refs; don't let it throw or miscount.
- `dropDimsFor` (~line 3100): trace refs have no entity index — skip them when
  filtering/reindexing (only shift `.ent`/`.entIdx`/`.ref.ent` fields that exist).
- `eraseAt` / `dimNear`: erasing a trace dim must work like any other dim.
- Acceptance for the user's exact case: line from origin + length dim + angle-to-trace
  → `defineState` reports 0 DOF, chip says fully defined, endpoint drag is refused
  with the "change a dimension" hint.

## B. Marker sizes while drawing (small)

The pointer-tool handles (0.06 sphere, `redrawHandles`) are the size the user likes.
While drawing, everything is bigger and some of it zoom-scaled:

- Draft endpoint dots (`vmesh` in `redrawDraft`, ~line 3006): 0.12 → **0.06**.
- Hover snap marker (`drawSnapMark`, ~line 2805): currently
  `SphereGeometry((point?0.24:0.13)*s)` with `s=max(0.6, R/18)` — zoom-scaled and
  huge. Make it fixed: **0.10** for point snaps, **0.07** for line snaps. Delete `s`.
- Inference guide dots (~line 2817): 0.1 → **0.06**.
- Leave the dim-preview amber dot (0.07) and the handle sizes alone.

## C. Drag snapping — unify with draw snapping (moderate)

`applyDrawSnap` (~line 2822) builds the full candidate set (origin, trace crossings,
handles, draft points, H/V inference, trace lines) but early-returns unless a DRAW tool
is active. The pointer-drag path (`pointermove` handler, ~line 4230s) instead calls
`nearestSnap` — other vertices only, 1mm join radius. So dragging can never reach the
origin or a trace.

- Extract the candidate building from `applyDrawSnap` into `snapCandidates()`
  returning `{pts, lines}`; both callers use it.
- In the drag path: hard-snap the dragged point to any candidate point (origin, trace
  crossings, other vertices) within `tolP=max(0.5, R*0.035)`; else slide onto a trace
  line within `tolL`. Exclude the dragged point itself (and for polygon-corner drags,
  the polygon's own synthetic corner points).
- Keep the existing 1mm release-to-join behaviour and the `dragSnapPt` green marker —
  reuse that marker for all drag snaps.
- Snapping a dragged point onto the origin pins it (`pinsOn` sees it next
  `defineState`), so drag-to-origin can *define* geometry. That's intended.

## Verification recipe (measure, don't look)

Environment quirks (HANDOVER traps 1 and the /grid handover): **screenshots do not
composite** in the hidden browser pane, and **rAF is starved** — verify by
measurement through the page's own state, never by eye.

- Dev server: `python -m http.server 8777 --bind 127.0.0.1` from `Freya/`, app at
  `http://localhost:8777/freyacad/`. A tab (tab-1) is likely already open — reuse it;
  reload after edits.
- Test hooks on `window.__C`: `insertFeature`, `rebuild`, `editSketch(f)`,
  `finishSketch`, `defineState(sk)`, `lockedEnts(sk)`, `sketchHandles()`,
  `get editing`, `get/set tool` (setter runs dockSel), `nextId()`, `camera`,
  `controls`, `renderer`, `scene`, `features`.
- Synthetic drag recipe (worked last session): project a sketch-UV point to screen via
  `frame.o + u*fr.u + v*fr.v`, `.project(C.camera)`, canvas rect; dispatch
  `PointerEvent` down/move/up with `bubbles:true, button:0, pointerId:1` on
  `C.renderer.domElement`.
- Minimum checks:
  1. Line `{poly, pts:[(0,0),(8,5)]}` + seg length dim + angle-to-trace dim →
     `defineState` = 0 DOF; synthetic drag on the free end refused ("Fully defined…"
     hint), endpoint unmoved.
  2. Point-to-trace: point + two ptrace dims (to the two traces) → 0 DOF for a
     2-pt line also pinned appropriately; values drive position (change value →
     point moves to match).
  3. Erase the trace dim → DOF comes back; undo/redo round-trips a trace dim.
  4. Drag an un-dimmed endpoint near the origin → it lands exactly on (0,0) and the
     entity's DOF drops by 2.
  5. Marker sizes: after edits, assert the draft/snap sphere geometry radii via a
     scene traverse (SphereGeometry parameters.radius).

## Rules for this handoff

- Update `help.html` in the same batch: the Dimensions table gains "angle / distance
  to a plane trace" rows, Known limits loses the "can't dimension to datum planes"
  bullet, and the "last revised" date changes in BOTH `#stamp` and the footer
  (see HANDOVER.md — stale caveats are worse than none).
- **Do not commit, push, or deploy.** The orchestrating session reviews the diff
  first and handles git + `npm run deploy` after review.
- Don't refactor beyond the plan; match the file's existing idiom (dense, commented
  where a decision needs defending).
