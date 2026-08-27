# Unlocking the hardware under the browser

freyacad runs everything — the OCCT kernel, the solver, three.js — in one tab,
and until now has treated the browser as a fixed-size box. The box got bigger:
as of mid-2026 every major browser ships WebGPU (Safari joined with Safari 26
in September 2025), WebAssembly threads + SIMD are universal behind one pair of
HTTP headers, and Wasm Memory64 has landed in Chrome and Firefox. This is the
plan for what freyacad should actually take, in what order, and what each step
costs. It was written after the loft / rendered-view / lighting work shipped.
One piece of it — true offline — has since shipped ahead of schedule, for a
reason worth reading in stage 2: the argument for deferring it was simply
wrong. Everything else here is still unstarted.

## Where the ceilings are today

- **The kernel runs on the UI thread.** The lamp demo's cold rebuild is ~6.9 s,
  and the page is frozen for all of it — no orbit, no hover, no typing. Every
  feature edit freezes the tab for the length of the rebuild. This is the
  ceiling users actually feel.
- **The kernel is single-threaded.** OCCT's booleans and meshing use one core.
  The one batched fuse + mesh is ~5 s of the lamp's 6.9 s; `BRepMesh` has a
  parallel flag we deliberately pass `false` because there are no threads to
  give it.
- **32-bit heap.** The stock opencascade.js build lives under emscripten's
  default 2 GB ceiling. Nobody has hit it with native models; a big imported
  STEP assembly could.
- **three.js r128 (2021), WebGL.** Fine at demo scale; it predates five years
  of renderer work, and there is no WebGPU path from r128.
- **Hosting quirk that shapes everything:** Cloudflare Pages caps single files
  at 25 MiB, which is why the ~40 MB kernel wasm loads from jsDelivr/unpkg
  rather than our own origin. Any custom kernel build needs somewhere to live
  (R2 behind the same domain is the obvious answer).

## What the platform now offers (checked August 2026)

| Capability | Status | Catch |
|---|---|---|
| WebGPU | All major browsers; ~95 % of users; three.js falls back to WebGL 2 for the rest | Needs a modern three.js — r171+ made WebGPURenderer production-ready, r184 is current |
| Wasm threads + SIMD | Universal | Requires cross-origin isolation (COOP/COEP headers) and a rebuilt kernel |
| Wasm Memory64 (>4 GB) | Chrome 133+, Firefox 143+; Safari uncommitted | 10–20 % perf tax from 64-bit pointers; pointless unless a model actually needs >4 GB |
| OPFS (origin-private file system) | Universal | None that matters here |

## The plan, in shipping order

Each stage ships on its own with the full regression battery green; none blocks
the ones after it.

### 1. Move the kernel off the UI thread (no new tech, biggest felt win)

Put OCCT and the rebuild loop in a Web Worker. The main thread keeps three.js,
input and the sketcher; the worker owns `OCK` and ships meshes back as
transferable buffers. The tab stays alive during rebuilds — orbiting a
half-built model, a real progress bar, a Cancel that actually cancels.
Works in every browser with no headers, no custom kernel, no hosting changes.

The honest cost: `OCK` and `rebuild` are entangled with page state, and the
refactor must keep the `OCK` surface identical so the battery still means
something. Add one new probe: "the viewport answers input while the lamp
rebuilds". This is the largest single refactor in the plan and still the right
first move — every later stage benefits from the seam it cuts.

### 2. Cross-origin isolation + a threaded, SIMD kernel

The deploy already ships a `_headers` file (cache policy for three.js, manifold
and the icons). Isolation is four more lines in it:

```
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: credentialless
```

(`credentialless` keeps the Cloudflare analytics beacon working; if a target
browser lacks it, the strict fallback is `require-corp` plus `crossorigin`
attributes on the CDN script tags. Both paths need checking against the PWA
shelf worker and the trace-a-photo file flow — local files are unaffected by
COEP, so the risk is confined to the two external scripts.)

That unlocks `SharedArrayBuffer`, which unlocks opencascade.js's supported
multi-threaded custom build (their `donalffons/opencascade.js:multi-threaded`
Docker path emits `.js` + `.wasm` + `.worker.js`). Host the triple on R2 under
freya.co.nz with CORS + CORP headers — which also ends the jsDelivr dependency.
Then flip `BRepMesh` to parallel and rebuild with SIMD. Realistic win: the
5-second fuse-and-mesh drops by roughly the core count on the meshing side;
booleans gain less (OCCT parallelises them unevenly). Measure with the verify
timings, keep the single-threaded CDN build as the automatic fallback for any
browser that fails isolation.

#### Offline — done, ahead of this stage

Worth stating plainly because the names collide: a **Web Worker** (stage 1) is a
browser thread on the user's own machine and has nothing to do with a
**Cloudflare Worker**, which is server-side edge compute. Stage 1 moves code
between threads inside one tab; it cannot affect offline behaviour either way.

This section used to say offline had to wait until the kernel was same-origin,
because "a service worker cannot cache a cross-origin opaque response usefully".
That reasoning was wrong in a specific and checkable way: the kernel's responses
are **not opaque**. jsDelivr sends `Access-Control-Allow-Origin` — it must, or
the cross-origin `import()` in the loader could not work at all — so the worker
receives a real, inspectable, cacheable response. Offline therefore did not need
self-hosting, and **has shipped**: `freyacad/sw.js`, with `offline.js` proving a
reload with the network genuinely gone still builds the lamp to the same
triangle count as online. See HANDOVER.md for the shape of it.

What stage 2 still adds here is *independence*, not capability: while the kernel
sits on jsDelivr, offline is contingent on a third party continuing to send CORS
headers. Moving it to our own origin makes that guarantee ours.

For the record, freyacad has exactly **one** server-side dependency, and it is
not on the modelling path: `functions/api/shelf.js`, a Pages Function that
parks a just-exported 3MF at an unguessable URL for ten minutes, because a
slicer can only *fetch* a hosted file and never receive one from a page. It
already degrades honestly — with no KV binding every request 503s and the app
falls back to download-then-launch. Sketching, modelling, the library, drawings
and Print/Export all run locally with the network off.

### 3. Modern viewport: three.js r184, WebGPU with WebGL 2 fallback

Two moves, shipped separately:
1. r128 → r184 on WebGL. Color management, geometry API and lighting units all
   changed since 2021, so every visual pin moves once — the screenshot suites
   are re-derived in one honest sweep.
2. Swap in `WebGPURenderer`, which falls back to WebGL 2 by itself. The studio
   environment and Lighting tool map cleanly (TSL replaces the hand-built
   pieces if we want them fancier later).

Payoff is headroom — big imported meshes, dense assemblies, post-effects — not
correctness. That's why it's third, not first.

### 4. Memory64 — only when someone actually hits the wall

The trigger is a real user with a real >2 GB model, not the calendar. When it
happens: raise `MAXIMUM_MEMORY` to 4 GB first (cheap, no Memory64 needed), and
only go 64-bit if that's still not enough — accepting the perf tax and that
Safari (still uncommitted) would need the 32-bit build kept alongside.

### 5. Library on OPFS

Move the in-browser document library from IndexedDB to OPFS (sync access in a
worker, real file semantics, no serialization cost), with one-time migration
and IndexedDB kept as the fallback. Small, self-contained, nice-to-have.

## What we deliberately do not do

- No Memory64 "because it's new" — it makes everything a little slower to make
  impossible models possible, and nobody has an impossible model yet.
- No WebGPU compute for the kernel — the bottleneck is OCCT's C++, which
  threads address; hand-porting B-rep booleans to GPU is a research project.
- No build step. index.html stays the app; workers arrive as sibling files the
  same way three.min.js does.

## Order and effort

| Stage | Effort | Risk | What proves it |
|---|---|---|---|
| 1. Kernel in a worker | Large | UI/kernel seam refactor | Battery + new responsiveness probe |
| 2. Isolation + threads/SIMD | Medium | Header side-effects, self-hosting | Verify timings ÷ cores; fallback probe |
| 3. three r184 / WebGPU | Large | Every visual pin re-derived | Screenshot suites, re-pinned once |
| 4. Memory64 | Small–medium | Perf tax, Safari gap | A model that needs it |
| 5. OPFS library | Small | Migration | library.js suite |
