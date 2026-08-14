/* ============================================================================
 * exporters.js — mesh extraction, binary STL, AP214 STEP, ZIP, SVG
 *
 * STEP export is a real boundary representation: coplanar triangles are merged
 * back into planar faces with proper outer/inner loops, so a flat wall arrives
 * in CAD as one face, not 400 triangles. Curved surfaces stay faceted (each
 * facet is its own planar face) — set a higher arc resolution if you need it.
 * ==========================================================================*/
(function (global) {
  'use strict';

  const EX = {};

  /* ------------------------------------------------------------------ */
  /* mesh extraction                                                     */
  /* ------------------------------------------------------------------ */
  /* Manifold occasionally leaves two vertices at identical coordinates with a
   * zero-area sliver between them. Weld on the way out so the shell is clean
   * for both STL and the STEP face stitcher. */
  EX.toMesh = function (manifold) {
    const m = manifold.getMesh();
    const np = m.numProp || 3;
    const nvIn = m.vertProperties.length / np;
    const map = new Int32Array(nvIn);
    const seen = new Map();
    const vx = [];
    for (let i = 0; i < nvIn; i++) {
      const x = m.vertProperties[i * np], y = m.vertProperties[i * np + 1], z = m.vertProperties[i * np + 2];
      const k = x.toFixed(4) + ',' + y.toFixed(4) + ',' + z.toFixed(4);
      let j = seen.get(k);
      if (j === undefined) { j = vx.length / 3; seen.set(k, j); vx.push(x, y, z); }
      map[i] = j;
    }
    const tin = m.triVerts, tri = [];
    for (let i = 0; i < tin.length; i += 3) {
      const a = map[tin[i]], b = map[tin[i + 1]], c = map[tin[i + 2]];
      if (a === b || b === c || a === c) continue;   // collapsed by the weld
      tri.push(a, b, c);
    }
    return {
      verts: new Float64Array(vx), tris: new Uint32Array(tri),
      nv: vx.length / 3, nt: tri.length / 3, welded: nvIn - vx.length / 3
    };
  };

  EX.meshStats = function (mesh) {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    const v = mesh.verts;
    for (let i = 0; i < v.length; i += 3) {
      if (v[i] < x0) x0 = v[i]; if (v[i] > x1) x1 = v[i];
      if (v[i + 1] < y0) y0 = v[i + 1]; if (v[i + 1] > y1) y1 = v[i + 1];
      if (v[i + 2] < z0) z0 = v[i + 2]; if (v[i + 2] > z1) z1 = v[i + 2];
    }
    // signed volume
    let vol = 0;
    for (let t = 0; t < mesh.tris.length; t += 3) {
      const a = mesh.tris[t] * 3, b = mesh.tris[t + 1] * 3, c = mesh.tris[t + 2] * 3;
      vol += (v[a] * (v[b + 1] * v[c + 2] - v[c + 1] * v[b + 2])
        - v[a + 1] * (v[b] * v[c + 2] - v[c] * v[b + 2])
        + v[a + 2] * (v[b] * v[c + 1] - v[c] * v[b + 1])) / 6;
    }
    return {
      x: x1 - x0, y: y1 - y0, z: z1 - z0,
      min: [x0, y0, z0], max: [x1, y1, z1],
      tris: mesh.nt, verts: mesh.nv,
      volume: Math.abs(vol), grams: Math.abs(vol) / 1000 * 1.24
    };
  };

  /* ------------------------------------------------------------------ */
  /* binary STL                                                          */
  /* ------------------------------------------------------------------ */
  EX.stl = function (mesh, name) {
    const nt = mesh.nt, v = mesh.verts, t = mesh.tris;
    const buf = new ArrayBuffer(84 + nt * 50);
    const dv = new DataView(buf);
    const head = 'Freya Gridfinity — ' + (name || 'part');
    for (let i = 0; i < 80; i++) dv.setUint8(i, i < head.length ? head.charCodeAt(i) & 0x7f : 32);
    dv.setUint32(80, nt, true);
    let o = 84;
    for (let i = 0; i < nt; i++) {
      const a = t[i * 3] * 3, b = t[i * 3 + 1] * 3, c = t[i * 3 + 2] * 3;
      const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2];
      const wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
      let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true);
      dv.setFloat32(o + 12, v[a], true); dv.setFloat32(o + 16, v[a + 1], true); dv.setFloat32(o + 20, v[a + 2], true);
      dv.setFloat32(o + 24, v[b], true); dv.setFloat32(o + 28, v[b + 1], true); dv.setFloat32(o + 32, v[b + 2], true);
      dv.setFloat32(o + 36, v[c], true); dv.setFloat32(o + 40, v[c + 1], true); dv.setFloat32(o + 44, v[c + 2], true);
      dv.setUint16(o + 48, 0, true);
      o += 50;
    }
    return new Blob([buf], { type: 'model/stl' });
  };

  /* ------------------------------------------------------------------ */
  /* coplanar face merge                                                 */
  /* ------------------------------------------------------------------ */
  function triNormal(v, a, b, c) {
    const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2];
    const wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-14) return null;
    return [nx / l, ny / l, nz / l];
  }

  // Groups of coplanar, edge-connected triangles -> planar faces with loops.
  EX.faces = function (mesh, opt) {
    opt = opt || {};
    const angTol = opt.angTol == null ? 1e-6 : opt.angTol;   // 1 - cos(theta)
    const distTol = opt.distTol == null ? 2e-3 : opt.distTol;
    const v = mesh.verts, t = mesh.tris, nt = mesh.nt;

    // triangle adjacency via shared edges
    const edgeMap = new Map();
    for (let i = 0; i < nt; i++) {
      for (let e = 0; e < 3; e++) {
        const a = t[i * 3 + e], b = t[i * 3 + (e + 1) % 3];
        const k = a < b ? a + ':' + b : b + ':' + a;
        let l = edgeMap.get(k);
        if (!l) { l = []; edgeMap.set(k, l); }
        l.push(i);
      }
    }
    const normals = new Array(nt);
    for (let i = 0; i < nt; i++) normals[i] = triNormal(v, t[i * 3] * 3, t[i * 3 + 1] * 3, t[i * 3 + 2] * 3);

    const group = new Int32Array(nt).fill(-1);
    const faces = [];
    for (let s = 0; s < nt; s++) {
      if (group[s] >= 0 || !normals[s]) continue;
      const n = normals[s];
      const p0 = t[s * 3] * 3;
      const d = n[0] * v[p0] + n[1] * v[p0 + 1] + n[2] * v[p0 + 2];
      const gi = faces.length;
      const members = [s];
      group[s] = gi;
      const stack = [s];
      while (stack.length) {
        const cur = stack.pop();
        for (let e = 0; e < 3; e++) {
          const a = t[cur * 3 + e], b = t[cur * 3 + (e + 1) % 3];
          const k = a < b ? a + ':' + b : b + ':' + a;
          const nb = edgeMap.get(k);
          if (!nb) continue;
          for (const j of nb) {
            if (group[j] >= 0 || !normals[j]) continue;
            const nj = normals[j];
            if (1 - (n[0] * nj[0] + n[1] * nj[1] + n[2] * nj[2]) > angTol) continue;
            const q = t[j * 3] * 3;
            if (Math.abs(n[0] * v[q] + n[1] * v[q + 1] + n[2] * v[q + 2] - d) > distTol) continue;
            group[j] = gi; members.push(j); stack.push(j);
          }
        }
      }
      faces.push({ n: n, d: d, tris: members, loops: null });
    }

    // Slivers with no usable normal never seeded a group; hand each one to a
    // neighbour so its edges still take part in the boundary bookkeeping.
    for (let pass = 0; pass < 4; pass++) {
      let moved = 0;
      for (let i = 0; i < nt; i++) {
        if (group[i] >= 0) continue;
        for (let e = 0; e < 3 && group[i] < 0; e++) {
          const a = t[i * 3 + e], b = t[i * 3 + (e + 1) % 3];
          const nb = edgeMap.get(a < b ? a + ':' + b : b + ':' + a);
          if (!nb) continue;
          for (const j of nb) {
            if (j !== i && group[j] >= 0) { group[i] = group[j]; faces[group[j]].tris.push(i); moved++; break; }
          }
        }
      }
      if (!moved) break;
    }

    // boundary loops per group
    for (const f of faces) {
      // directed edge counts, then cancel the interior pairs
      const cnt = new Map();
      for (const i of f.tris) {
        for (let e = 0; e < 3; e++) {
          const a = t[i * 3 + e], b = t[i * 3 + (e + 1) % 3];
          if (a === b) continue;
          const k = a + ':' + b;
          cnt.set(k, (cnt.get(k) || 0) + 1);
        }
      }
      for (const k of Array.from(cnt.keys())) {
        const c = cnt.get(k);
        if (!c) continue;
        const p = k.indexOf(':');
        const rev = k.slice(p + 1) + ':' + k.slice(0, p);
        const r = cnt.get(rev);
        if (!r) continue;
        const n = Math.min(c, r);
        cnt.set(k, c - n); cnt.set(rev, r - n);
      }
      const next = new Map();
      let total = 0;
      for (const [k, c] of cnt) {
        if (c <= 0) continue;
        const p = k.indexOf(':');
        const a = +k.slice(0, p), b = +k.slice(p + 1);
        let l = next.get(a);
        if (!l) { l = []; next.set(a, l); }
        for (let i = 0; i < c; i++) { l.push(b); total++; }
      }
      const loops = [];
      let used = 0, ok = true, guard = 0;
      while (next.size && ok) {
        const start = next.keys().next().value;
        const loop = [start];
        let cur = start;
        for (; ;) {
          const l = next.get(cur);
          if (!l || !l.length) { ok = false; break; }
          const nx = l.shift(); used++;
          if (!l.length) next.delete(cur);
          if (nx === start) break;
          loop.push(nx);
          cur = nx;
          if (++guard > 400000) { ok = false; break; }
        }
        if (!ok) break;
        if (loop.length >= 3) loops.push(loop);
      }
      // every boundary edge must have been consumed exactly once, or we do not
      // trust the stitch and fall back to raw triangles for this group
      f.loops = (ok && used === total && loops.length) ? loops : null;
    }
    return faces;
  };

  /* A vertex is only safe to drop from a loop when exactly two face loops in
   * the whole shell touch it — otherwise removing it leaves a T-junction and
   * the neighbouring face keeps an edge that no longer has a partner. */
  function dropCollinear(loop, v, tol, degree) {
    if (loop.length < 4) return loop;
    const out = [];
    const n = loop.length;
    for (let i = 0; i < n; i++) {
      if (degree && degree.get(loop[i]) !== 2) { out.push(loop[i]); continue; }
      const a = loop[(i - 1 + n) % n] * 3, b = loop[i] * 3, c = loop[(i + 1) % n] * 3;
      const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2];
      const wx = v[c] - v[b], wy = v[c + 1] - v[b + 1], wz = v[c + 2] - v[b + 2];
      const cx = uy * wz - uz * wy, cy = uz * wx - ux * wz, cz = ux * wy - uy * wx;
      const lu = Math.hypot(ux, uy, uz), lw = Math.hypot(wx, wy, wz);
      if (lu < 1e-9 || lw < 1e-9) continue;
      if (Math.hypot(cx, cy, cz) / (lu * lw) > (tol || 1e-5)) out.push(loop[i]);
    }
    return out.length >= 3 ? out : loop;
  }

  function loopArea(loop, v, n) {
    let ax = 0, ay = 0, az = 0;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i] * 3, b = loop[(i + 1) % loop.length] * 3;
      ax += v[a + 1] * v[b + 2] - v[a + 2] * v[b + 1];
      ay += v[a + 2] * v[b] - v[a] * v[b + 2];
      az += v[a] * v[b + 1] - v[a + 1] * v[b];
    }
    return (ax * n[0] + ay * n[1] + az * n[2]) / 2;
  }

  /* Topology check: every directed edge of the finished face set must appear
   * exactly once, and its reverse exactly once. Used by the test harness. */
  EX.checkShell = function (mesh, opt) {
    opt = opt || {};
    const v = mesh.verts;
    const faces = EX.faces(mesh, opt);
    const degree = new Map();
    for (const f of faces) {
      if (!f.loops) continue;
      for (const l of f.loops) for (const i of l) degree.set(i, (degree.get(i) || 0) + 1);
    }
    const dir = new Map();
    let raw = 0, stitched = 0;
    for (const f of faces) {
      if (!f.loops) {
        raw++;
        for (const ti of f.tris) {
          const l = [mesh.tris[ti * 3], mesh.tris[ti * 3 + 1], mesh.tris[ti * 3 + 2]];
          for (let i = 0; i < 3; i++) { const k = l[i] + ':' + l[(i + 1) % 3]; dir.set(k, (dir.get(k) || 0) + 1); }
        }
        continue;
      }
      stitched++;
      for (const l0 of f.loops) {
        const l = dropCollinear(l0, v, opt.collinearTol, degree);
        for (let i = 0; i < l.length; i++) { const k = l[i] + ':' + l[(i + 1) % l.length]; dir.set(k, (dir.get(k) || 0) + 1); }
      }
    }
    let bad = 0, dup = 0;
    for (const [k, c] of dir) {
      if (c !== 1) dup++;
      const p = k.indexOf(':');
      if (dir.get(k.slice(p + 1) + ':' + k.slice(0, p)) !== 1) bad++;
    }
    return { faces: faces.length, stitched: stitched, rawGroups: raw, edges: dir.size, unpaired: bad, repeated: dup };
  };

  /* ------------------------------------------------------------------ */
  /* STEP AP214                                                          */
  /* ------------------------------------------------------------------ */
  function num(x) {
    if (!isFinite(x)) x = 0;
    if (Math.abs(x) < 1e-11) return '0.';
    let s = x.toFixed(7).replace(/0+$/, '');
    if (s.endsWith('.')) s += '0';
    return s;
  }

  EX.step = function (mesh, name, opt) {
    opt = opt || {};
    const v = mesh.verts;
    const faces = EX.faces(mesh, opt);
    const lines = [];
    let id = 0;
    function put(s) { lines.push('#' + (++id) + '=' + s + ';'); return id; }

    // --- product / context boilerplate ---
    const appCtx = put("APPLICATION_CONTEXT('automotive design')");
    put("APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#" + appCtx + ")");
    const pdc = put("PRODUCT_CONTEXT('',#" + appCtx + ",'mechanical')");
    const prod = put("PRODUCT('" + name + "','" + name + "','',(#" + pdc + "))");
    const pdf = put("PRODUCT_DEFINITION_FORMATION('','',#" + prod + ")");
    const pdCtx = put("PRODUCT_DEFINITION_CONTEXT('part definition',#" + appCtx + ",'design')");
    const pd = put("PRODUCT_DEFINITION('design','',#" + pdf + ",#" + pdCtx + ")");
    const pds = put("PRODUCT_DEFINITION_SHAPE('','',#" + pd + ")");
    const lenU = put("(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))");
    const angU = put("(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))");
    const solU = put("(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())");
    const unc = put("UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-06),#" + lenU + ",'distance_accuracy_value','')");
    const ctx = put("(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#" + unc +
      "))GLOBAL_UNIT_ASSIGNED_CONTEXT((#" + lenU + ",#" + angU + ",#" + solU + "))REPRESENTATION_CONTEXT('',''))");

    // --- shared geometry pools ---
    const ptId = new Map(), vtxId = new Map(), dirId = new Map(), vecId = new Map(), edgeId = new Map();
    function point(i) {
      let p = ptId.get(i);
      if (p) return p;
      p = put("CARTESIAN_POINT('',(" + num(v[i * 3]) + ',' + num(v[i * 3 + 1]) + ',' + num(v[i * 3 + 2]) + '))');
      ptId.set(i, p); return p;
    }
    function rawPoint(x, y, z) { return put("CARTESIAN_POINT('',(" + num(x) + ',' + num(y) + ',' + num(z) + '))'); }
    function vertex(i) {
      let p = vtxId.get(i);
      if (p) return p;
      p = put("VERTEX_POINT('',#" + point(i) + ')');
      vtxId.set(i, p); return p;
    }
    function direction(x, y, z) {
      const k = x.toFixed(6) + ',' + y.toFixed(6) + ',' + z.toFixed(6);
      let p = dirId.get(k);
      if (p) return p;
      p = put("DIRECTION('',(" + num(x) + ',' + num(y) + ',' + num(z) + '))');
      dirId.set(k, p); return p;
    }
    function vector(x, y, z) {
      const k = x.toFixed(6) + ',' + y.toFixed(6) + ',' + z.toFixed(6);
      let p = vecId.get(k);
      if (p) return p;
      p = put("VECTOR('',#" + direction(x, y, z) + ",1.0)");
      vecId.set(k, p); return p;
    }
    function edge(a, b) {
      const k = a < b ? a + ':' + b : b + ':' + a;
      let e = edgeId.get(k);
      if (e) return e;
      const lo = a < b ? a : b, hi = a < b ? b : a;
      let dx = v[hi * 3] - v[lo * 3], dy = v[hi * 3 + 1] - v[lo * 3 + 1], dz = v[hi * 3 + 2] - v[lo * 3 + 2];
      const L = Math.hypot(dx, dy, dz) || 1; dx /= L; dy /= L; dz /= L;
      const line = put("LINE('',#" + point(lo) + ',#' + vector(dx, dy, dz) + ')');
      e = put("EDGE_CURVE('',#" + vertex(lo) + ',#' + vertex(hi) + ',#' + line + ',.T.)');
      edgeId.set(k, e); return e;
    }

    // how many face loops touch each vertex — see dropCollinear()
    const degree = new Map();
    for (const f of faces) {
      if (!f.loops) continue;
      for (const l of f.loops) for (const i of l) degree.set(i, (degree.get(i) || 0) + 1);
    }

    const faceIds = [];
    for (const f of faces) {
      if (!f.loops || !f.loops.length) {
        // fall back to raw triangles for a group we could not stitch
        for (const ti of f.tris) faceIds.push(emitLoopFace([mesh.tris[ti * 3], mesh.tris[ti * 3 + 1], mesh.tris[ti * 3 + 2]], [], f.n));
        continue;
      }
      const cleaned = f.loops.map(function (l) { return dropCollinear(l, v, opt.collinearTol, degree); })
        .filter(function (l) { return l.length >= 3; });
      if (!cleaned.length) continue;
      let outer = cleaned[0], oa = loopArea(outer, v, f.n);
      for (const l of cleaned) { const a = loopArea(l, v, f.n); if (a > oa) { oa = a; outer = l; } }
      const holes = cleaned.filter(function (l) { return l !== outer; });
      faceIds.push(emitLoopFace(outer, holes, f.n));
    }

    function emitLoop(loop) {
      const oes = [];
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i], b = loop[(i + 1) % loop.length];
        oes.push('#' + put("ORIENTED_EDGE('',*,*,#" + edge(a, b) + ',.' + (a < b ? 'T' : 'F') + '.)'));
      }
      return put("EDGE_LOOP('',(" + oes.join(',') + '))');
    }
    function emitLoopFace(outer, holes, n) {
      const bounds = ['#' + put("FACE_OUTER_BOUND('',#" + emitLoop(outer) + ',.T.)')];
      for (const h of holes) bounds.push('#' + put("FACE_BOUND('',#" + emitLoop(h) + ',.T.)'));
      // plane placement
      let rx = Math.abs(n[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0];
      let ax = [rx[1] * n[2] - rx[2] * n[1], rx[2] * n[0] - rx[0] * n[2], rx[0] * n[1] - rx[1] * n[0]];
      const L = Math.hypot(ax[0], ax[1], ax[2]) || 1;
      ax = [ax[0] / L, ax[1] / L, ax[2] / L];
      const o = outer[0];
      const pl = put("AXIS2_PLACEMENT_3D('',#" + rawPoint(v[o * 3], v[o * 3 + 1], v[o * 3 + 2]) +
        ',#' + direction(n[0], n[1], n[2]) + ',#' + direction(ax[0], ax[1], ax[2]) + ')');
      const plane = put("PLANE('',#" + pl + ')');
      return put("ADVANCED_FACE('',(" + bounds.join(',') + '),#' + plane + ',.T.)');
    }

    const shell = put("CLOSED_SHELL('',(" + faceIds.map(function (i) { return '#' + i; }).join(',') + '))');
    const brep = put("MANIFOLD_SOLID_BREP('" + name + "',#" + shell + ')');
    const origin = rawPoint(0, 0, 0);
    const axZ = direction(0, 0, 1), axX = direction(1, 0, 0);
    const place = put("AXIS2_PLACEMENT_3D('',#" + origin + ',#' + axZ + ',#' + axX + ')');
    const rep = put("ADVANCED_BREP_SHAPE_REPRESENTATION('" + name + "',(#" + place + ',#' + brep + '),#' + ctx + ')');
    put("SHAPE_DEFINITION_REPRESENTATION(#" + pds + ',#' + rep + ')');

    const stamp = new Date().toISOString().replace(/\.\d+Z$/, '');
    const head =
      'ISO-10303-21;\nHEADER;\n' +
      "FILE_DESCRIPTION(('Gridfinity part generated by freya.co.nz/grid'),'2;1');\n" +
      "FILE_NAME('" + name + ".step','" + stamp + "',('Freya Gridfinity'),(''),'freya.co.nz/grid','','');\n" +
      "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));\nENDSEC;\nDATA;\n";
    return {
      blob: new Blob([head + lines.join('\n') + '\nENDSEC;\nEND-ISO-10303-21;\n'], { type: 'model/step' }),
      faces: faceIds.length,
      entities: id
    };
  };

  /* ------------------------------------------------------------------ */
  /* ZIP (store, no compression)                                         */
  /* ------------------------------------------------------------------ */
  const CRC = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  EX.zip = async function (files) {
    const chunks = [], central = [];
    let offset = 0;
    const enc = new TextEncoder();
    for (const f of files) {
      const data = new Uint8Array(await f.blob.arrayBuffer());
      const nameBuf = enc.encode(f.name);
      const crc = crc32(data);
      const local = new Uint8Array(30 + nameBuf.length);
      const dv = new DataView(local.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true); dv.setUint16(6, 0, true); dv.setUint16(8, 0, true);
      dv.setUint16(10, 0, true); dv.setUint16(12, 0x21, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, data.length, true); dv.setUint32(22, data.length, true);
      dv.setUint16(26, nameBuf.length, true); dv.setUint16(28, 0, true);
      local.set(nameBuf, 30);
      chunks.push(local, data);

      const cd = new Uint8Array(46 + nameBuf.length);
      const cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
      cv.setUint16(8, 0, true); cv.setUint16(10, 0, true);
      cv.setUint16(12, 0, true); cv.setUint16(14, 0x21, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBuf.length, true);
      cv.setUint32(42, offset, true);
      cd.set(nameBuf, 46);
      central.push(cd);
      offset += local.length + data.length;
    }
    let cdSize = 0;
    for (const c of central) cdSize += c.length;
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
    return new Blob(chunks.concat(central, [end]), { type: 'application/zip' });
  };

  /* ------------------------------------------------------------------ */
  /* SVG                                                                 */
  /* ------------------------------------------------------------------ */
  EX.outlineSVG = function (poly, title) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of poly) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    const pad = 5, w = x1 - x0 + pad * 2, h = y1 - y0 + pad * 2;
    const d = poly.map(function (p, i) {
      return (i ? 'L' : 'M') + (p[0] - x0 + pad).toFixed(3) + ' ' + (y1 - p[1] + pad).toFixed(3);
    }).join(' ') + ' Z';
    return new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="' + w + 'mm" height="' + h +
      'mm" viewBox="0 0 ' + w.toFixed(3) + ' ' + h.toFixed(3) + '">\n<title>' + (title || 'outline') +
      '</title>\n<path d="' + d + '" fill="none" stroke="#000" stroke-width="0.3"/>\n</svg>'],
      { type: 'image/svg+xml' });
  };

  // Printable paper calibration target (exact mm when printed at 100%).
  EX.targetSVG = function (innerW, innerD, pageW, pageH) {
    pageW = pageW || 210; pageH = pageH || 297;
    const cx = pageW / 2, cy = pageH / 2;
    const x0 = cx - innerW / 2, y0 = cy - innerD / 2;
    const mark = 14, s = [];
    s.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + pageW + 'mm" height="' + pageH +
      'mm" viewBox="0 0 ' + pageW + ' ' + pageH + '">');
    s.push('<rect width="100%" height="100%" fill="#fff"/>');
    // corner L-marks; the inner corner of each L is the reference point
    for (let i = 0; i < 4; i++) {
      const sx = i & 1 ? 1 : -1, sy = i & 2 ? 1 : -1;
      const px = i & 1 ? x0 + innerW : x0, py = i & 2 ? y0 + innerD : y0;
      s.push('<path d="M' + (px - sx * mark) + ' ' + py + ' L' + px + ' ' + py + ' L' + px + ' ' + (py - sy * mark) +
        '" fill="none" stroke="#000" stroke-width="1.2"/>');
      s.push('<circle cx="' + px + '" cy="' + py + '" r="1.1" fill="#000"/>');
    }
    s.push('<rect x="' + x0 + '" y="' + y0 + '" width="' + innerW + '" height="' + innerD +
      '" fill="none" stroke="#bbb" stroke-width="0.25" stroke-dasharray="3 3"/>');
    // 100 mm verification ruler
    const rx = cx - 50, ry = y0 + innerD + 16;
    s.push('<path d="M' + rx + ' ' + ry + ' h100" stroke="#000" stroke-width="0.6" fill="none"/>');
    for (let i = 0; i <= 100; i += 10) {
      s.push('<path d="M' + (rx + i) + ' ' + ry + ' v' + (i % 50 === 0 ? 5 : 3) + '" stroke="#000" stroke-width="0.4"/>');
    }
    s.push('<text x="' + cx + '" y="' + (ry + 12) + '" font-family="sans-serif" font-size="4" text-anchor="middle">' +
      'this bar must measure exactly 100 mm — print at 100%, no page scaling</text>');
    s.push('<text x="' + cx + '" y="' + (y0 - 8) + '" font-family="sans-serif" font-size="4.5" text-anchor="middle">' +
      'Freya Gridfinity target &#183; inner corners ' + innerW + ' &#215; ' + innerD + ' mm</text>');
    s.push('</svg>');
    return new Blob([s.join('\n')], { type: 'image/svg+xml' });
  };

  EX.save = function (blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  };

  global.EX = EX;
})(window);
