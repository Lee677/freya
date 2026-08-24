# dev tools

Not shipped to users, not loaded by the app — these are the things used to verify
changes and keep the feature matrix honest.

| file | what it is |
|---|---|
| `verify.js` | The geometry regression suite. Paste into the browser console with freyacad open, read `window.__VER`. Eleven models covering fillets, a merge/cut ordering trap, multi-body, mirror, both patterns, three scoped mirror/pattern cases and the spline demo. The scoped three carry their analytic volume and report `ok`, so they are right-or-wrong rather than only comparable. |
| `verify-live.js` | The half `verify.js` cannot reach. It builds through the real document — `insertFeature`, `openProps`, `rebuild` — so it sees the geometry cache and the checkpoints, which `buildPartShapes` switches off. Read `window.__VERLIVE`. Its invariant is that a checkpointed rebuild equals a cold one. It also covers the drawing (circle and axis detection, centre marks, centrelines), for the same reason: a view is built from the live document. |
| `headless.js` | Runs either suite in a headless browser instead of a console. `node dev/headless.js --script dev/verify.js`. It serves the site itself and prints the result global as JSON, so an A/B is a `diff` of two files. `--occt <dir>` answers the kernel request from a local `opencascade.js` install, which is what makes any of this work behind an egress policy that blocks the CDN. |
| `pappus-hull-volume.js` | `node pappus-hull-volume.js` — the analytic volume of the lantern hull (10942.7983 mm³) by Pappus over the centripetal Catmull-Rom profile. Ground truth when OCCT's own volume figure is in doubt. |
| `matrix_done.py` | `python dev/matrix_done.py "Row name" "note"` — ticks a row in FEATURE-MATRIX.html and recomputes the tallies from the table. |
| `gen_models.py` | Regenerates `models/lantern-rocket.sketchcad` and `models/jet-engine.asmcad`. The same JSON is also inlined in `index.html` so the Demo menu works off a `file://` open. |

## How to check a change did not move the geometry

The suite is only useful as an A/B against the previous commit. Headless, which is
the version that does not depend on anyone watching a browser:

```bash
git stash push -- freyacad/index.html                        # back to HEAD
node dev/headless.js --script dev/verify.js > /tmp/base.json
git stash pop
node dev/headless.js --script dev/verify.js > /tmp/new.json
diff /tmp/base.json /tmp/new.json
```

By hand it is the same thing: stash, reload the page (hard — see HANDOVER trap 10),
paste `verify.js`, save the JSON, unstash, reload, paste again, diff the two.

Ten of the eleven cases are exact to the last digit; only the lantern needs judgement,
and `verify.js` explains why at the top.

This is what caught every regression in the boolean-batching and checkpoint work,
and it is also what proved the lantern's geometry had *not* changed when OCCT's
`VolumeProperties` claimed it had.

## Clicking things for real

`headless.js` runs a script *inside* the page, which is enough for geometry and
for anything reachable through `window.__C`. It is not enough for the UI. Drive
Playwright directly for that — a 1400×900 viewport gives a real canvas and real
hit-tested clicks, and that is how the drawing dock was found to be sitting
underneath the sheet (HANDOVER trap 35). A synthetic `element.click()` would
have passed: it ignores what is on top.

## Measuring build time

There is no permanent instrumentation. Wrap the kernel entry points from the
console:

```js
const T={}; ['fuse','cut','fuseAll','cutAll','unionAll','subtractAllFrom','extrude','revolve','mesh']
  .forEach(k=>{ const f=__C.OCK[k]; if(!f) return; T[k]={n:0,ms:0};
    __C.OCK[k]=function(){ const t=performance.now();
      try{ return f.apply(this,arguments); } finally { T[k].n++; T[k].ms+=performance.now()-t; } }; });
```

then force a real rebuild past the geometry cache by touching a feature:

```js
__C.features[0].__bust=1; __C.rebuild(); delete __C.features[0].__bust;
```

Note the `javascript_tool` timeout in a headless/hidden pane is not a slowness
signal — the pane never composites, so trivial probes can time out too. Stash
results on `window` and read them in a separate call.
