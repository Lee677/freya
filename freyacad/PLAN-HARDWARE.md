# Unlocking the hardware under the browser

freyacad runs everything — the OCCT kernel, the solver, three.js — in one tab,
and until now has treated the browser as a fixed-size box. The box got bigger:
as of mid-2026 every major browser ships WebGPU (Safari joined with Safari 26
in September 2025), WebAssembly threads + SIMD are universal behind one pair of
HTTP headers, and Wasm Memory64 has landed in Chrome and Firefox. This is the
plan for what freyacad should actually take, in what order, and what each step
costs. It was written after the loft / rendered-view / lighting work shipped;
nothing here is started yet.

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

A `_headers` file in the deploy turns on isolation:

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
| 2. Isolation + threads/SIMD | Medium | Header side-effects, self-hosting | Verify timings ÷ cores; fallback path probe |
| 3. three r184 / WebGPU | Large | Every visual pin re-derived | Screenshot suites, re-pinned once |
| 4. Memory64 | Small–medium | Perf tax, Safari gap | A model that needs it |
| 5. OPFS library | Small | Migration | library.js suite |
