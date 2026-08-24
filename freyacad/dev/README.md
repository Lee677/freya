# dev tools

Not shipped to users, not loaded by the app — these are the things used to verify
changes and keep the feature matrix honest.

| file | what it is |
|---|---|
| `verify.js` | The geometry regression suite. Paste into the browser console with freyacad open, read `window.__VER`. Eight models covering fillets, a merge/cut ordering trap, multi-body, mirror, both patterns and the spline demo. |
| `pappus-hull-volume.js` | `node pappus-hull-volume.js` — the analytic volume of the lantern hull (10942.7983 mm³) by Pappus over the centripetal Catmull-Rom profile. Ground truth when OCCT's own volume figure is in doubt. |
| `matrix_done.py` | `python dev/matrix_done.py "Row name" "note"` — ticks a row in FEATURE-MATRIX.html and recomputes the tallies from the table. |
| `gen_models.py` | Regenerates `models/lantern-rocket.sketchcad` and `models/jet-engine.asmcad`. The same JSON is also inlined in `index.html` so the Demo menu works off a `file://` open. |

## How to check a change did not move the geometry

The suite is only useful as an A/B against the previous commit:

```bash
git stash push -- freyacad/index.html     # back to HEAD
```

Reload the page (hard — see HANDOVER trap 10), paste `verify.js`, save the JSON.
Then:

```bash
git stash pop
```

Reload, paste again, diff the two. Seven of the eight cases are exact to the last
digit; only the lantern needs judgement, and `verify.js` explains why at the top.

This is what caught every regression in the boolean-batching and checkpoint work,
and it is also what proved the lantern's geometry had *not* changed when OCCT's
`VolumeProperties` claimed it had.

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
