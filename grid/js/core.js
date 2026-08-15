/* ============================================================================
 * core.js — Gridfinity geometry engine
 *
 * All solids are built as manifold-3d Manifolds so every result is watertight.
 * Tapered profiles (the gridfinity foot, the stacking lip, baseplate sockets)
 * are lofts between concentric rounded rectangles — those are fed to Manifold
 * as raw meshes; everything else is boolean composition.
 *
 * Units: millimetres. Z is up. Parts are centred in XY with z=0 at the print bed.
 * ==========================================================================*/
(function (global) {
  'use strict';

  const GF = {};

  /* ---------------------------------------------------------------------
   * Spec
   * ------------------------------------------------------------------- */
  const SPEC = GF.SPEC = {
    PITCH: 42,            // grid pitch
    UNIT_H: 7,            // height unit
    BASE_H: 4.75,         // foot / socket profile height
    T1: 0.8,              // lower 45 deg taper
    T2: 1.8,              // vertical land
    T3: 2.15,             // upper 45 deg taper
    BIN_GAP: 0.5,         // total XY clearance of a bin inside its cell
    BIN_R: 3.75,          // outer corner radius at the top of the foot
    SOCKET_CLEAR: 0.25,   // per-side clearance of a baseplate socket
    SEG: 8                // arc segments per 90 deg corner
  };
  SPEC.BIN_W = SPEC.PITCH - SPEC.BIN_GAP;           // 41.5
  SPEC.FOOT_BOTTOM_W = SPEC.BIN_W - 2 * (SPEC.T1 + SPEC.T3); // 35.6
  SPEC.FOOT_BOTTOM_R = SPEC.BIN_R - (SPEC.T1 + SPEC.T3);     // 0.8

  /* ---------------------------------------------------------------------
   * Manifold plumbing
   * ------------------------------------------------------------------- */
  let arena = [];
  function keep(m) { arena.push(m); return m; }
  GF.flush = function () {
    for (const m of arena) { try { m.delete(); } catch (e) { /* already gone */ } }
    arena = [];
  };
  GF.ready = function () { return !!global.MANIFOLD; };
  function MOD() {
    if (!global.MANIFOLD) throw new Error('The 3D engine (manifold-3d) is not loaded yet.');
    return global.MANIFOLD;
  }
  GF.MOD = MOD;

  /* ---------------------------------------------------------------------
   * 2D helpers
   * ------------------------------------------------------------------- */

  // Rounded rectangle, CCW, centred on (cx,cy). Always 4*(seg+1) points so that
  // two rounded rects with the same seg can be lofted point-for-point.
  function roundRect(w, d, r, seg, cx, cy) {
    cx = cx || 0; cy = cy || 0;
    seg = seg || SPEC.SEG;
    r = Math.max(0.02, Math.min(r, Math.min(w, d) / 2 - 1e-4));
    const hx = w / 2 - r, hy = d / 2 - r, out = [];
    const corners = [[hx, hy, 0], [-hx, hy, Math.PI / 2], [-hx, -hy, Math.PI], [hx, -hy, -Math.PI / 2]];
    for (const c of corners) {
      for (let i = 0; i <= seg; i++) {
        const a = c[2] + (Math.PI / 2) * (i / seg);
        out.push([cx + c[0] + r * Math.cos(a), cy + c[1] + r * Math.sin(a)]);
      }
    }
    return out;
  }
  GF.roundRect = roundRect;

  function polyArea(p) {
    let a = 0;
    for (let i = 0, n = p.length, j = n - 1; i < n; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1];
    return a / 2;
  }
  GF.polyArea = polyArea;
  GF.polyBBox = function (p) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of p) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1]; }
    return { x0: x0, y0: y0, x1: x1, y1: y1, w: x1 - x0, d: y1 - y0 };
  };

  /* ---------------------------------------------------------------------
   * Loft: a stack of equal-length rings -> Manifold
   * rings: [{ z, pts:[[x,y],...] }]  (pts CCW, convex, same length)
   * ------------------------------------------------------------------- */
  function loft(ringsIn) {
    const M = MOD();
    // profiles may be written top-down; work bottom-up so the winding is right
    const rings = (ringsIn.length > 1 && ringsIn[ringsIn.length - 1].z < ringsIn[0].z)
      ? ringsIn.slice().reverse() : ringsIn;
    const n = rings[0].pts.length;
    const verts = [], tris = [];
    for (const r of rings) {
      if (r.pts.length !== n) throw new Error('loft: ring length mismatch');
      for (const p of r.pts) verts.push(p[0], p[1], r.z);
    }
    // sides
    for (let k = 0; k < rings.length - 1; k++) {
      const a = k * n, b = (k + 1) * n;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        tris.push(a + i, a + j, b + j);
        tris.push(a + i, b + j, b + i);
      }
    }
    // caps (rings are convex -> fan)
    const top = (rings.length - 1) * n;
    for (let i = 1; i < n - 1; i++) {
      tris.push(0, i + 1, i);              // bottom, normal -Z
      tris.push(top, top + i, top + i + 1); // top, normal +Z
    }
    // orientation guard: a profile written in an odd order must not come out inside-out
    let vol = 0;
    for (let i = 0; i < tris.length; i += 3) {
      const a = tris[i] * 3, b = tris[i + 1] * 3, c = tris[i + 2] * 3;
      vol += (verts[a] * (verts[b + 1] * verts[c + 2] - verts[c + 1] * verts[b + 2])
        - verts[a + 1] * (verts[b] * verts[c + 2] - verts[c] * verts[b + 2])
        + verts[a + 2] * (verts[b] * verts[c + 1] - verts[c] * verts[b + 1]));
    }
    if (vol < 0) for (let i = 0; i < tris.length; i += 3) { const t = tris[i + 1]; tris[i + 1] = tris[i + 2]; tris[i + 2] = t; }

    const mesh = new M.Mesh({
      numProp: 3,
      vertProperties: new Float32Array(verts),
      triVerts: new Uint32Array(tris)
    });
    try { if (typeof mesh.merge === 'function') mesh.merge(); } catch (e) { /* optional */ }
    return keep(M.Manifold.ofMesh(mesh));
  }
  GF.loft = loft;

  // Loft a profile of concentric rounded rects. steps: [{z, off}] where off is
  // the per-side offset from the reference rounded rect (w,d,r).
  function loftProfile(w, d, r, steps, seg, cx, cy) {
    return loft(steps.map(function (s) {
      return { z: s.z, pts: roundRect(w + 2 * s.off, d + 2 * s.off, r + s.off, seg, cx, cy) };
    }));
  }
  GF.loftProfile = loftProfile;

  function box(w, d, h, cx, cy, z0) {
    const M = MOD();
    return keep(M.Manifold.cube([w, d, h], true).translate([cx || 0, cy || 0, (z0 || 0) + h / 2]));
  }
  GF.box = box;

  function roundBox(w, d, h, r, z0, cx, cy, seg) {
    return loftProfile(w, d, r, [{ z: z0, off: 0 }, { z: z0 + h, off: 0 }], seg, cx, cy);
  }
  GF.roundBox = roundBox;

  // Balanced union — much faster than a long left-leaning chain.
  function unionAll(list) {
    if (!list.length) return null;
    let cur = list.slice();
    while (cur.length > 1) {
      const next = [];
      for (let i = 0; i < cur.length; i += 2) {
        next.push(i + 1 < cur.length ? keep(cur[i].add(cur[i + 1])) : cur[i]);
      }
      cur = next;
    }
    return cur[0];
  }
  GF.unionAll = unionAll;

  /* ---------------------------------------------------------------------
   * Gridfinity primitives
   * ------------------------------------------------------------------- */

  // One bin foot, z = 0 .. BASE_H, centred on (cx,cy).
  function foot(cx, cy, seg) {
    const S = SPEC;
    return loftProfile(S.BIN_W, S.BIN_W, S.BIN_R, [
      { z: 0, off: -(S.T1 + S.T3) },
      { z: S.T1, off: -S.T3 },
      { z: S.T1 + S.T2, off: -S.T3 },
      { z: S.BASE_H, off: 0 }
    ], seg, cx, cy);
  }
  GF.foot = foot;

  // Baseplate socket cavity for one cell, top face at z = zTop.
  // Extended above and below so the boolean cut is clean.
  function socket(cx, cy, zTop, over, seg) {
    const S = SPEC, c = S.SOCKET_CLEAR;
    over = over == null ? 4 : over;
    const base = zTop - S.BASE_H;
    return loftProfile(S.BIN_W + 2 * c, S.BIN_W + 2 * c, S.BIN_R + c, [
      { z: base - over, off: -(S.T1 + S.T3) },
      { z: base, off: -(S.T1 + S.T3) },
      { z: base + S.T1, off: -S.T3 },
      { z: base + S.T1 + S.T2, off: -S.T3 },
      { z: zTop, off: 0 },
      { z: zTop + over, off: 0 }
    ], seg, cx, cy);
  }
  GF.socket = socket;

  /* ---------------------------------------------------------------------
   * BASEPLATE
   * ------------------------------------------------------------------- */
  /* opts:
   *   drawerW, drawerD   inner drawer size (mm)
   *   gap                clearance per side (mm)
   *   fill               'skirt' (plate fills the drawer) | 'grid' (grid only)
   *   align              'center' | 'min' | 'max'  (grid position inside plate)
   *   floor              0 = skeleton, else solid floor thickness (mm)
   *   cornerRelief       square notch cut from each outer corner (mm), for
   *                      drawers with radiused corners
   *   nx, ny             optional explicit grid counts
   */
  GF.buildBaseplate = function (opts) {
    const S = SPEC;
    const seg = opts.seg || S.SEG;
    const gap = opts.gap == null ? 0.5 : opts.gap;
    const availW = opts.drawerW - 2 * gap;
    const availD = opts.drawerD - 2 * gap;
    const nx = opts.nx || Math.max(1, Math.floor(availW / S.PITCH));
    const ny = opts.ny || Math.max(1, Math.floor(availD / S.PITCH));
    const gridW = nx * S.PITCH, gridD = ny * S.PITCH;
    const skirt = opts.fill !== 'grid';
    const plateW = skirt ? Math.max(gridW, availW) : gridW;
    const plateD = skirt ? Math.max(gridD, availD) : gridD;
    const floor = Math.max(0, opts.floor || 0);
    const zTop = floor + S.BASE_H;

    // grid origin (centre of the grid block) relative to plate centre
    let ox = 0, oy = 0;
    if (opts.align === 'min') { ox = -(plateW - gridW) / 2; oy = -(plateD - gridD) / 2; }
    else if (opts.align === 'max') { ox = (plateW - gridW) / 2; oy = (plateD - gridD) / 2; }

    let plate = box(plateW, plateD, zTop, 0, 0, 0);

    const relief = Math.max(0, opts.cornerRelief || 0);
    if (relief > 0) {
      const cuts = [];
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        cuts.push(box(relief * 2, relief * 2, zTop + 4,
          sx * (plateW / 2), sy * (plateD / 2), -2));
      }
      plate = keep(plate.subtract(unionAll(cuts)));
    }

    const sockets = [];
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        const cx = ox - gridW / 2 + S.PITCH * (i + 0.5);
        const cy = oy - gridD / 2 + S.PITCH * (j + 0.5);
        sockets.push(socket(cx, cy, zTop, 4, seg));
      }
    }
    plate = keep(plate.subtract(unionAll(sockets)));

    return {
      solid: plate,
      info: {
        nx: nx, ny: ny, plateW: plateW, plateD: plateD, height: zTop,
        gridW: gridW, gridD: gridD, gridOx: ox, gridOy: oy,
        skirtX: (plateW - gridW) / 2, skirtY: (plateD - gridD) / 2,
        leftoverX: opts.drawerW - gridW, leftoverY: opts.drawerD - gridD,
        cells: nx * ny
      }
    };
  };

  /* Split a solid into printable tiles on grid lines.
   * Returns [{solid, ix, iy, w, d, nx, ny}] */
  GF.tileBaseplate = function (plate, info, bedX, bedY, kerf) {
    const S = SPEC;
    kerf = kerf || 0;
    // A tile that sits on the outside of the plate also carries the skirt, so
    // the cell count per tile has to leave room for it.
    function perTile(bed, cells, skirt) {
      let per = Math.max(1, Math.floor(bed / S.PITCH));
      while (per > 1) {
        const n = Math.ceil(cells / per);
        if (per * S.PITCH + (n === 1 ? 2 : 1) * skirt <= bed) break;
        per--;
      }
      return per;
    }
    const perX = perTile(bedX, info.nx, info.skirtX);
    const perY = perTile(bedY, info.ny, info.skirtY);
    const tx = Math.ceil(info.nx / perX), ty = Math.ceil(info.ny / perY);
    if (tx <= 1 && ty <= 1) return null;

    // cut lines in plate coordinates (plate centred at origin)
    const gridLeft = -info.gridW / 2 + (info.gridOx || 0);
    const gridBot = -info.gridD / 2 + (info.gridOy || 0);
    const xs = [-info.plateW / 2], ys = [-info.plateD / 2];
    for (let i = perX; i < info.nx; i += perX) xs.push(gridLeft + i * S.PITCH);
    for (let j = perY; j < info.ny; j += perY) ys.push(gridBot + j * S.PITCH);
    xs.push(info.plateW / 2); ys.push(info.plateD / 2);

    const out = [];
    for (let i = 0; i < xs.length - 1; i++) {
      for (let j = 0; j < ys.length - 1; j++) {
        const w = xs[i + 1] - xs[i] - kerf, d = ys[j + 1] - ys[j] - kerf;
        const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2;
        const cutter = box(w, d, info.height + 10, cx, cy, -5);
        const piece = keep(plate.intersect(cutter));
        out.push({
          solid: piece, ix: i, iy: j, w: w, d: d,
          name: 'tile_' + String.fromCharCode(65 + j) + (i + 1)
        });
      }
    }
    return out;
  };

  /* ---------------------------------------------------------------------
   * BIN
   * ------------------------------------------------------------------- */
  /* opts:
   *   nx, ny            footprint in grid units
   *   uz                height in 7 mm units
   *   lip               stacking lip on/off
   *   heightMode        'add' (total = 7u + lip) | 'total' (lip inside 7u)
   *   wall              side wall thickness
   *   floorT            floor thickness above the foot
   *   divX, divY        compartment counts
   *   divT              divider thickness
   *   scoop             scoop radius (0 = none)
   *   pocket            optional {poly:[[x,y]..], depth, clearance, cols, rows,
   *                               spacing, fingerR} tool pocket instead of a
   *                               plain cavity
   *   solidBody         no cavity at all
   */
  GF.buildBin = function (opts) {
    const S = SPEC;
    const seg = opts.seg || S.SEG;
    const nx = Math.max(1, opts.nx | 0), ny = Math.max(1, opts.ny | 0);
    const uz = Math.max(1, opts.uz | 0);
    const W = nx * S.PITCH - S.BIN_GAP, D = ny * S.PITCH - S.BIN_GAP;
    const lip = !!opts.lip;
    const lipH = S.BASE_H;                       // nesting depth
    const H = (opts.heightMode === 'total' || !lip) ? uz * S.UNIT_H : uz * S.UNIT_H + lipH;
    const wall = Math.max(0.4, opts.wall == null ? 1.2 : opts.wall);
    const floorT = Math.max(0.4, opts.floorT == null ? 1.2 : opts.floorT);
    const floorZ = S.BASE_H + floorT;

    // ---- solid body + feet ----
    let solid = roundBox(W, D, H - S.BASE_H, S.BIN_R, S.BASE_H, 0, 0, seg);
    const feet = [];
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      feet.push(foot(-W / 2 - S.BIN_GAP / 2 + S.PITCH * (i + 0.5),
        -D / 2 - S.BIN_GAP / 2 + S.PITCH * (j + 0.5), seg));
    }
    solid = keep(solid.add(unionAll(feet)));

    const warnings = [];

    // ---- stacking lip (a negative cut from the top) ----
    // Mirror of the foot profile, offset outward by the socket clearance so a
    // bin nests exactly BASE_H into the bin below -> stack pitch = 7 mm * u.
    const hollow = !(opts.pocket || opts.solidBody);
    let lipBottomZ = H, topZ = H;
    if (lip) {
      const c = S.SOCKET_CLEAR;
      const dTaper = S.T3 - c;            // 1.9  depth of the top chamfer
      const dLand = dTaper + S.T2;        // 3.7
      const dBot = dLand + S.T1;          // 4.5
      const innerOff = -wall;             // cavity wall position
      const lipOff = -(S.T1 + S.T3) + c;  // -2.7 : lip throat
      const flare = Math.max(0, innerOff - lipOff); // 45 deg relief under the lip
      const steps = [
        { z: H + 3, off: 3 },
        { z: H, off: 0 },
        { z: H - dTaper, off: -dTaper },
        { z: H - dLand, off: -dTaper },
        { z: H - dBot, off: lipOff }
      ];
      // The relief under the lip only belongs on a bin that is hollow anyway.
      // On a solid or pocketed bin it would scoop out the whole top surface.
      if (hollow) {
        if (flare > 1e-6) steps.push({ z: H - dBot - flare, off: innerOff });
        else if (innerOff < lipOff) steps.push({ z: H - dBot, off: innerOff });
      }
      lipBottomZ = steps[steps.length - 1].z;
      topZ = H - dBot;
      if (hollow && lipBottomZ < floorZ + 0.5) {
        warnings.push('The bin is too short for a full stacking lip — the lip now reaches the floor.');
      }
      const lipCut = loftProfile(W, D, S.BIN_R, steps, seg);
      solid = keep(solid.subtract(lipCut));
    }

    // ---- interior ----
    const cavTop = lip ? lipBottomZ : H + 2;
    const cavW = W - 2 * wall, cavD = D - 2 * wall, cavR = Math.max(0.4, S.BIN_R - wall);

    if (opts.pocket && opts.pocket.poly && opts.pocket.poly.length > 2) {
      const p = opts.pocket;
      const depth = Math.max(1, p.depth || 10);
      const zBot = Math.max(floorZ, topZ - depth);
      const cuts = GF.pocketSolids(p, zBot, H + 2, floorZ);
      if (cuts.length) solid = keep(solid.subtract(unionAll(cuts)));
      if (topZ - zBot < depth - 1e-6) {
        warnings.push('Pocket depth reduced to ' + (topZ - zBot).toFixed(1) +
          ' mm — the bin is not tall enough for ' + depth.toFixed(1) + ' mm.');
      }
    } else if (!opts.solidBody) {
      const divX = Math.max(1, opts.divX | 0 || 1), divY = Math.max(1, opts.divY | 0 || 1);
      const divT = Math.max(0.4, opts.divT || wall);
      let cav = loftProfile(cavW, cavD, cavR, [
        { z: floorZ, off: 0 }, { z: cavTop + 0.001, off: 0 }
      ], seg);
      solid = keep(solid.subtract(cav));

      // dividers, added back as walls that stop below the lip
      const divTop = lip ? Math.min(cavTop, H - S.BASE_H - 0.6) : H;
      const bars = [];
      for (let i = 1; i < divX; i++) {
        const x = -cavW / 2 + cavW * i / divX;
        bars.push(box(divT, cavD + 1, divTop - floorZ, x, 0, floorZ));
      }
      for (let j = 1; j < divY; j++) {
        const y = -cavD / 2 + cavD * j / divY;
        bars.push(box(cavW + 1, divT, divTop - floorZ, 0, y, floorZ));
      }
      if (bars.length) {
        const shell = loftProfile(cavW, cavD, cavR, [
          { z: floorZ, off: 0 }, { z: divTop, off: 0 }
        ], seg);
        solid = keep(solid.add(keep(unionAll(bars).intersect(shell))));
      }

      // scoop: a fillet along the front (-Y) bottom edge of every compartment
      const sc = Math.max(0, opts.scoop || 0);
      if (sc > 0.2) {
        const M = MOD();
        const fills = [];
        for (let j = 0; j < divY; j++) {
          const y0 = -cavD / 2 + cavD * j / divY + (j ? divT / 2 : 0);
          const cyl = keep(M.Manifold.cylinder(cavW + 2, sc, sc, Math.max(16, seg * 4), true)
            .rotate([0, 90, 0])
            .translate([0, y0 + sc, floorZ + sc]));
          const corner = box(cavW + 2, sc, sc, 0, y0 + sc / 2, floorZ);
          fills.push(keep(corner.subtract(cyl)));
        }
        const shell2 = loftProfile(cavW, cavD, cavR, [
          { z: floorZ, off: 0 }, { z: cavTop, off: 0 }
        ], seg);
        solid = keep(solid.add(keep(unionAll(fills).intersect(shell2))));
      }
    }

    return {
      solid: solid,
      info: {
        nx: nx, ny: ny, uz: uz, W: W, D: D, H: H, lip: lip,
        body: uz * S.UNIT_H, stackPitch: lip ? H - lipH : H,
        floorZ: floorZ, wall: wall, warnings: warnings
      }
    };
  };

  /* Tool pocket negatives from a traced outline.
   * zBot = pocket floor, zTop = well above the bin top, floorZ = inside floor. */
  GF.pocketSolids = function (p, zBot, zTop, floorZ) {
    const M = MOD();
    const clearance = p.clearance == null ? 0.4 : p.clearance;
    const cols = Math.max(1, p.cols | 0 || 1), rows = Math.max(1, p.rows | 0 || 1);
    const spacing = p.spacing == null ? 4 : p.spacing;
    const height = zTop - zBot;

    let poly = p.poly.map(function (q) { return [q[0], q[1]]; });
    if (GF.polyArea(poly) < 0) poly = poly.slice().reverse();
    const bb = GF.polyBBox(poly);
    // centre the outline on its own bounding box
    poly = poly.map(function (q) { return [q[0] - (bb.x0 + bb.w / 2), q[1] - (bb.y0 + bb.d / 2)]; });

    let cs = new M.CrossSection([poly], 'Positive');
    if (clearance > 0) cs = cs.offset(clearance, 'Round', 2, 24);
    if (p.simplify) cs = cs.simplify(p.simplify);

    const pitchX = bb.w + 2 * clearance + spacing;
    const pitchY = bb.d + 2 * clearance + spacing;
    const out = [];
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const x = (i - (cols - 1) / 2) * pitchX;
        const y = (j - (rows - 1) / 2) * pitchY;
        let solid = keep(keep(M.Manifold.extrude(cs, height)).translate([x, y, zBot]));

        // Finger holes: a cylinder centred ON the outline reads as a half-round
        // notch in plan — the inner half is already pocket. Cut deeper than the
        // pocket floor so a fingertip gets under the tool rather than merely
        // beside it, but never through the floor.
        if (p.fingers && p.fingers.length) {
          for (const f of p.fingers) {
            const fr = Math.max(2, f.r || 9);
            const dz = Math.min(fr * 0.9, Math.max(0, zBot - (floorZ || 0) - 0.8));
            const cyl = keep(M.Manifold.cylinder(height + dz, fr, fr, 48, false)
              .translate([x + f.x, y + f.y, zBot - dz]));
            solid = keep(solid.add(cyl));
          }
        }
        out.push(solid);
      }
    }
    return out;
  };

  /* Grid units needed to hold a pocket layout. Finger holes stick out past the
   * outline, so they count towards the space needed. */
  GF.pocketFootprint = function (p, wall, edge) {
    const S = SPEC;
    const bb = GF.polyBBox(p.poly);
    if (p.fingers) {
      for (const f of p.fingers) {
        const fr = Math.max(2, f.r || 9);
        bb.x0 = Math.min(bb.x0, f.x - fr); bb.x1 = Math.max(bb.x1, f.x + fr);
        bb.y0 = Math.min(bb.y0, f.y - fr); bb.y1 = Math.max(bb.y1, f.y + fr);
      }
      bb.w = bb.x1 - bb.x0; bb.d = bb.y1 - bb.y0;
    }
    const clearance = p.clearance == null ? 0.4 : p.clearance;
    const cols = Math.max(1, p.cols | 0 || 1), rows = Math.max(1, p.rows | 0 || 1);
    const spacing = p.spacing == null ? 4 : p.spacing;
    const w = cols * (bb.w + 2 * clearance) + (cols - 1) * spacing;
    const d = rows * (bb.d + 2 * clearance) + (rows - 1) * spacing;
    const need = 2 * (wall + (edge == null ? 1.5 : edge));
    return {
      w: w, d: d,
      nx: Math.max(1, Math.ceil((w + need + S.BIN_GAP) / S.PITCH)),
      ny: Math.max(1, Math.ceil((d + need + S.BIN_GAP) / S.PITCH))
    };
  };

  global.GF = GF;
})(window);
