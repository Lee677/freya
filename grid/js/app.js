/* ============================================================================
 * app.js — UI
 * ==========================================================================*/
(function () {
  'use strict';
  const $ = function (id) { return document.getElementById(id); };
  const num = function (id) { return parseFloat($(id).value) || 0; };
  const int = function (id) { return Math.round(num(id)); };
  const on = function (id, ev, fn) { const e = $(id); if (e) e.addEventListener(ev, fn); };

  let viewer = null;
  const S = {
    tab: 'bp',
    bp: null,        // {whole:mesh, tiles:[{name,mesh,offset}], info}
    bin: null,
    rig: null,
    stand: null,
    outline: null,   // mm polygon, centred
    scan: {
      bitmap: null, base: null, ppm: null, pts: [], roi: null,
      contourPx: null, mask: null, work: null
    }
  };

  function status(msg, cls) {
    const el = $('status');
    el.className = 'status' + (cls ? ' ' + cls : '');
    el.textContent = msg || '';
  }
  function readout(html) { $('readout').innerHTML = html; }
  const fmt = function (v, n) { return (Math.round(v * Math.pow(10, n == null ? 1 : n)) / Math.pow(10, n == null ? 1 : n)).toFixed(n == null ? 1 : n); };

  function busy(msg, fn) {
    status(msg, 'busy');
    // plain timeout, not rAF: work must still run when the tab is in the background
    return new Promise(function (res) {
      setTimeout(function () {
        try { const r = fn(); status(''); res(r); }
        catch (e) { console.error(e); status(e.message || String(e), 'err'); res(null); }
      }, 24);
    });
  }

  /* ---------------------------------------------------------------- tabs */
  function selectTab(t) {
    S.tab = t;
    document.querySelectorAll('nav.tabs button').forEach(function (b) {
      b.setAttribute('aria-selected', b.dataset.tab === t ? 'true' : 'false');
    });
    document.querySelectorAll('.pane').forEach(function (p) { p.classList.remove('on'); });
    $('pane-' + t).classList.add('on');
    const photo = t === 'scan';
    $('photo').classList.toggle('hide', !photo);
    $('view').classList.toggle('hide', photo);
    if (!photo && viewer) viewer.resize();
    if (t === 'bp' && S.bp) showBaseplate();
    if (t === 'bin' && S.bin) showMeshes([S.bin.mesh]);
    if (t === 'rig' && S.rig) showMeshes([S.rig.mesh]);
  }
  document.querySelectorAll('nav.tabs button').forEach(function (b) {
    b.addEventListener('click', function () { selectTab(b.dataset.tab); });
  });

  function syncVisibility() {
    const style = $('bin-style').value;
    document.querySelectorAll('[data-when]').forEach(function (el) {
      el.style.display = el.dataset.when.split(' ').indexOf(style) >= 0 ? '' : 'none';
    });
    const mode = $('sc-mode').value;
    document.querySelectorAll('[data-scan]').forEach(function (el) {
      el.style.display = el.dataset.scan === mode ? '' : 'none';
    });
  }
  on('bin-style', 'change', syncVisibility);
  on('sc-mode', 'change', function () { S.scan.pts = []; drawScan(); syncVisibility(); });

  function showMeshes(list) {
    if (!viewer) return;
    $('photo').classList.add('hide');
    $('view').classList.remove('hide');
    viewer.resize();
    viewer.show(list);
  }

  /* ------------------------------------------------------------ baseplate */
  function buildBaseplate() {
    return busy('building baseplate…', function () {
      GF.flush();
      const u = parseFloat($('bp-units').value);
      const opts = {
        drawerW: num('bp-w') * u, drawerD: num('bp-d') * u,
        gap: num('bp-gap'), fill: $('bp-fill').value, align: $('bp-align').value,
        floor: num('bp-floor'), cornerRelief: num('bp-relief'),
        seg: int('bp-seg')
      };
      if (opts.drawerW < 45 || opts.drawerD < 45) throw new Error('Drawer must be at least 45 mm each way.');
      if (opts.drawerW > 2000 || opts.drawerD > 2000) throw new Error('That drawer is over 2 m — check the units.');
      const r = GF.buildBaseplate(opts);
      const whole = EX.toMesh(r.solid);
      let tiles = null;
      if ($('bp-split').checked) {
        const t = GF.tileBaseplate(r.solid, r.info, num('bp-bedx'), num('bp-bedy'), 0);
        if (t) tiles = t.map(function (p) { return { name: p.name, mesh: EX.toMesh(p.solid), w: p.w, d: p.d }; });
        if (tiles) {
          const bw = Math.max.apply(null, tiles.map(function (p) { return p.w; }));
          const bd = Math.max.apply(null, tiles.map(function (p) { return p.d; }));
          S.bpTileMax = [bw, bd];
        }
      }
      GF.flush();
      S.bp = { whole: whole, tiles: tiles, info: r.info, opts: opts };
      showBaseplate();
      const st = EX.meshStats(whole);
      const i = r.info;
      let h = '<b>' + i.nx + ' × ' + i.ny + '</b> cells · plate <b>' + fmt(i.plateW) + ' × ' + fmt(i.plateD) +
        ' × ' + fmt(i.height, 2) + ' mm</b>\n' +
        'skirt ' + fmt(i.skirtX, 2) + ' mm on X, ' + fmt(i.skirtY, 2) + ' mm on Y' +
        (opts.fill === 'grid' ? ' (trimmed to grid)' : '') + '\n' +
        'unused drawer space: ' + fmt(i.leftoverX, 1) + ' × ' + fmt(i.leftoverY, 1) + ' mm\n' +
        (tiles ? '<b>' + tiles.length + ' tiles</b>, largest ' + fmt(S.bpTileMax[0]) + ' × ' + fmt(S.bpTileMax[1]) +
          ' mm on a ' + fmt(num('bp-bedx'), 0) + ' × ' + fmt(num('bp-bedy'), 0) + ' mm bed\n'
          : 'prints in one piece\n') +
        st.tris.toLocaleString() + ' triangles · ~' + fmt(st.grams, 0) + ' g of filament';
      if (st.tris > 25000) {
        h += '\n<span class="w">big plate — the STEP will be around ' +
          fmt(st.tris * 0.3 / 1000, 0) + ' MB and take a few seconds to write</span>';
      }
      readout(h);
      ['bp-stl', 'bp-step'].forEach(function (b) { $(b).disabled = false; });
      $('bp-zip').disabled = !tiles;
    });
  }
  function showBaseplate() {
    if (!S.bp) return;
    if (S.bp.tiles) {
      // nudge tiles apart so the split lines are visible in the preview
      showMeshes(S.bp.tiles.map(function (t) {
        const st = EX.meshStats(t.mesh);
        const mx = (st.min[0] + st.max[0]) / 2, my = (st.min[1] + st.max[1]) / 2;
        return {
          verts: t.mesh.verts, tris: t.mesh.tris,
          offset: [Math.sign(mx) * 4, Math.sign(my) * 4, 0]
        };
      }));
    } else {
      showMeshes([S.bp.whole]);
    }
  }
  on('bp-build', 'click', buildBaseplate);
  on('bp-stl', 'click', function () {
    const i = S.bp.info;
    EX.save(EX.stl(S.bp.whole, 'baseplate'), 'gridfinity-baseplate-' + i.nx + 'x' + i.ny + '.stl');
  });
  on('bp-step', 'click', function () {
    busy('writing STEP…', function () {
      const i = S.bp.info;
      const r = EX.step(S.bp.whole, 'baseplate_' + i.nx + 'x' + i.ny);
      EX.save(r.blob, 'gridfinity-baseplate-' + i.nx + 'x' + i.ny + '.step');
      readout($('readout').innerHTML + '\nSTEP: ' + r.faces.toLocaleString() + ' faces, ' + r.entities.toLocaleString() + ' entities');
    });
  });
  on('bp-zip', 'click', function () {
    busy('zipping tiles…', function () {
      const files = S.bp.tiles.map(function (t) {
        return { name: 'gridfinity-baseplate-' + t.name + '.stl', blob: EX.stl(t.mesh, t.name) };
      });
      EX.zip(files).then(function (z) { EX.save(z, 'gridfinity-baseplate-tiles.zip'); });
    });
  });

  /* ------------------------------------------------------------------ bin */
  function binOpts() {
    const style = $('bin-style').value;
    const o = {
      nx: int('bin-nx'), ny: int('bin-ny'), uz: int('bin-uz'),
      lip: $('bin-lip').checked, heightMode: $('bin-hmode').value,
      wall: num('bin-wall'), floorT: num('bin-floor'),
      scoop: style === 'solid' || style === 'pocket' ? 0 : num('bin-scoop'),
      solidBody: style === 'solid',
      divX: style === 'div' ? int('bin-divx') : 1,
      divY: style === 'div' ? int('bin-divy') : 1,
      divT: num('bin-divt'),
      seg: int('bp-seg')
    };
    if (style === 'pocket') {
      if (!S.outline) throw new Error('No outline yet — trace one on the Tool scan tab.');
      o.pocket = {
        poly: S.outline, depth: num('bin-pdepth'), clearance: num('bin-pclear'),
        cols: int('bin-pcols'), rows: int('bin-prows'), spacing: num('bin-pspace'),
        fingerR: num('bin-pfinger')
      };
      if ($('bin-pauto').checked) {
        const f = GF.pocketFootprint(o.pocket, o.wall, 1.5);
        o.nx = f.nx; o.ny = f.ny;
        $('bin-nx').value = f.nx; $('bin-ny').value = f.ny;
      }
    }
    return o;
  }
  function buildBin() {
    return busy('building bin…', function () {
      GF.flush();
      const o = binOpts();
      if (o.nx > 12 || o.ny > 12 || o.uz > 40) throw new Error('That is bigger than this tool will build.');
      const r = GF.buildBin(o);
      const mesh = EX.toMesh(r.solid);
      GF.flush();
      S.bin = { mesh: mesh, info: r.info, opts: o };
      showMeshes([mesh]);
      const st = EX.meshStats(mesh);
      const i = r.info;
      let h = '<b>' + i.nx + ' × ' + i.ny + ' × ' + i.uz + 'u</b> · ' +
        fmt(i.W, 1) + ' × ' + fmt(i.D, 1) + ' × ' + fmt(i.H, 2) + ' mm overall\n' +
        (i.lip ? 'body ' + fmt(i.body, 0) + ' mm + stacking lip · stacks at ' + fmt(i.stackPitch, 2) + ' mm pitch\n'
          : 'no stacking lip\n') +
        'wall ' + fmt(i.wall, 1) + ' mm · inside floor at z = ' + fmt(i.floorZ, 2) + ' mm\n' +
        st.tris.toLocaleString() + ' triangles · ~' + fmt(st.grams, 0) + ' g of filament';
      if (o.pocket) {
        const ps = V.polyStats(o.pocket.poly);
        h += '\npocket ' + fmt(ps.w, 1) + ' × ' + fmt(ps.d, 1) + ' mm + ' + fmt(o.pocket.clearance, 2) +
          ' mm clearance × ' + (o.pocket.cols * o.pocket.rows) + ' off';
      }
      for (const w of i.warnings) h += '\n<span class="w">' + w + '</span>';
      readout(h);
      $('bin-stl').disabled = $('bin-step').disabled = false;
    });
  }
  function binName() {
    const i = S.bin.info;
    return 'gridfinity-bin-' + i.nx + 'x' + i.ny + 'x' + i.uz + (S.bin.opts.pocket ? '-tool' : '');
  }
  on('bin-build', 'click', buildBin);
  on('bin-stl', 'click', function () { EX.save(EX.stl(S.bin.mesh, 'bin'), binName() + '.stl'); });
  on('bin-step', 'click', function () {
    busy('writing STEP…', function () {
      const r = EX.step(S.bin.mesh, binName().replace(/-/g, '_'));
      EX.save(r.blob, binName() + '.step');
    });
  });

  /* ------------------------------------------------------------------ rig */
  on('rig-build', 'click', function () {
    busy('building frame…', function () {
      GF.flush();
      const r = GF.buildTarget({
        innerW: num('rig-iw'), innerD: num('rig-id'),
        frameW: num('rig-fw'), thickness: num('rig-t')
      });
      const mesh = EX.toMesh(r.solid);
      GF.flush();
      S.rig = { mesh: mesh, info: r.info };
      showMeshes([mesh]);
      const st = EX.meshStats(mesh);
      readout('Calibration frame · outside <b>' + fmt(r.info.outerW) + ' × ' + fmt(r.info.outerD) +
        ' mm</b>, inside <b>' + fmt(r.info.innerW) + ' × ' + fmt(r.info.innerD) + ' mm</b>\n' +
        'lay the tool inside, photograph, then click the four inside corners on the Tool scan tab\n' +
        '~' + fmt(st.grams, 0) + ' g of filament');
      $('rig-stl').disabled = $('rig-step').disabled = false;
      $('sc-fw').value = num('rig-iw'); $('sc-fd').value = num('rig-id');
    });
  });
  on('rig-stl', 'click', function () { EX.save(EX.stl(S.rig.mesh, 'target'), 'photo-target.stl'); });
  on('rig-step', 'click', function () {
    busy('writing STEP…', function () { EX.save(EX.step(S.rig.mesh, 'photo_target').blob, 'photo-target.step'); });
  });
  on('rig-svg', 'click', function () {
    EX.save(EX.targetSVG(num('rig-iw'), num('rig-id')), 'photo-target-A4.svg');
    status('printed at 100 % the bar must measure 100 mm — check before you trust it');
  });

  on('st-build', 'click', function () {
    busy('building stand…', function () {
      GF.flush();
      const r = GF.buildStand({
        height: num('st-h'), reach: num('st-reach'),
        phoneW: num('st-pw'), phoneT: num('st-pt'),
        lensX: num('st-lx'), lensY: num('st-ly'), lensD: num('st-ld'),
        bedZ: num('st-bedz')
      });
      const parts = r.parts.map(function (p) { return { name: p.name, qty: p.qty, mesh: EX.toMesh(p.solid) }; });
      GF.flush();
      S.stand = { parts: parts, info: r.info };
      let x = 0;
      showMeshes(parts.map(function (p) {
        const st = EX.meshStats(p.mesh);
        const off = [x - st.min[0], 0, 0];
        x += st.x + 20;
        return { verts: p.mesh.verts, tris: p.mesh.tris, offset: off };
      }));
      readout('Overhead stand · camera at <b>' + fmt(r.info.height, 0) + ' mm</b>\n' +
        parts.map(function (p) { return p.qty + ' × ' + p.name; }).join('\n') + '\n' +
        'column prints in ' + r.info.segments + ' segment(s) of ' + fmt(r.info.segH, 0) + ' mm');
      $('st-zip').disabled = false;
    });
  });
  on('st-zip', 'click', function () {
    busy('zipping…', function () {
      const files = S.stand.parts.map(function (p) {
        return { name: p.name + (p.qty > 1 ? '_x' + p.qty : '') + '.stl', blob: EX.stl(p.mesh, p.name) };
      });
      EX.zip(files).then(function (z) { EX.save(z, 'photo-stand.zip'); });
    });
  });

  /* ----------------------------------------------------------------- scan */
  const cv = $('sc-canvas');
  const cx = cv.getContext('2d');

  function setBase(canvas, ppm) {
    S.scan.base = canvas;
    S.scan.ppm = ppm || null;
    cv.width = canvas.width; cv.height = canvas.height;
    S.scan.contourPx = null; S.scan.mask = null; S.scan.tinted = null;
    S.scan.undo = []; S.scan.edited = false; S.scan.traced = null; S.scan.hover = -1;
    refreshEditButtons();
    drawScan();
  }

  /* The mask tint costs a full-frame getImageData/putImageData, which is far
   * too slow to redo on every pointermove while dragging a handle. Bake it once
   * into an offscreen canvas and blit that instead. */
  function buildTint() {
    if (!S.scan.mask) { S.scan.tinted = null; return; }
    const t = document.createElement('canvas');
    t.width = cv.width; t.height = cv.height;
    const g = t.getContext('2d', { willReadFrequently: true });
    g.drawImage(S.scan.base, 0, 0);
    const img = g.getImageData(0, 0, t.width, t.height);
    const d = img.data, m = S.scan.mask;
    for (let i = 0; i < m.length; i++) {
      if (m[i]) { d[i * 4] = d[i * 4] * 0.72 + 22; d[i * 4 + 1] = d[i * 4 + 1] * 0.72 + 40; d[i * 4 + 2] = d[i * 4 + 2] * 0.72 + 92; }
    }
    g.putImageData(img, 0, 0);
    S.scan.tinted = t;
  }

  function drawScan() {
    if (!S.scan.base) return;
    cx.clearRect(0, 0, cv.width, cv.height);
    cx.drawImage(S.scan.tinted || S.scan.base, 0, 0);
    const acc = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#3a5bd0';
    // roi
    if (S.scan.roi) {
      const r = S.scan.roi;
      cx.save();
      cx.strokeStyle = acc; cx.setLineDash([6, 4]); cx.lineWidth = 2;
      cx.strokeRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
      cx.restore();
    }
    // outline
    if (S.scan.contourPx && S.scan.contourPx.length > 2) {
      const lw = Math.max(2.5, cv.width / 320);
      cx.save();
      cx.lineJoin = 'round';
      cx.beginPath();
      S.scan.contourPx.forEach(function (p, i) { i ? cx.lineTo(p[0], p[1]) : cx.moveTo(p[0], p[1]); });
      cx.closePath();
      cx.strokeStyle = 'rgba(255,255,255,.85)'; cx.lineWidth = lw * 2.2; cx.stroke();
      cx.strokeStyle = '#f0721c'; cx.lineWidth = lw; cx.stroke();
      cx.restore();

      // draggable handles, sized in screen pixels so they stay grabbable
      if (canEdit()) {
        const s = dispScale();
        const r = 4.6 * s;
        cx.save();
        cx.lineWidth = 1.6 * s;
        S.scan.contourPx.forEach(function (p, i) {
          const active = i === S.scan.hover || (drag && drag.vertex === i);
          cx.beginPath();
          cx.arc(p[0], p[1], active ? r * 1.7 : r, 0, 7);
          cx.fillStyle = active ? '#f0721c' : 'rgba(255,255,255,.92)';
          cx.strokeStyle = active ? '#fff' : '#f0721c';
          cx.fill(); cx.stroke();
        });
        cx.restore();
      }
    }
    // picked points
    S.scan.pts.forEach(function (p, i) {
      cx.save();
      cx.fillStyle = acc; cx.strokeStyle = '#fff'; cx.lineWidth = 2;
      cx.beginPath(); cx.arc(p[0], p[1], 7, 0, 7); cx.fill(); cx.stroke();
      cx.fillStyle = '#fff'; cx.font = 'bold 10px sans-serif'; cx.textAlign = 'center';
      cx.fillText(String(i + 1), p[0], p[1] + 3.5);
      cx.restore();
    });
    if (S.scan.pts.length >= 2) {
      cx.save();
      cx.strokeStyle = acc; cx.lineWidth = 1.5; cx.setLineDash([4, 3]);
      cx.beginPath();
      S.scan.pts.forEach(function (p, i) { i ? cx.lineTo(p[0], p[1]) : cx.moveTo(p[0], p[1]); });
      if (S.scan.pts.length === 4) cx.closePath();
      cx.stroke(); cx.restore();
    }
    $('sc-pts').textContent = S.scan.pts.length + ($('sc-mode').value === 'frame' ? ' / 4' : ' / 2');
    const need = $('sc-mode').value === 'frame' ? 4 : 2;
    $('sc-apply').disabled = S.scan.pts.length !== need || !S.scan.bitmap;
  }

  function evPos(e) {
    const r = cv.getBoundingClientRect();
    return [(e.clientX - r.left) * (cv.width / r.width), (e.clientY - r.top) * (cv.height / r.height)];
  }

  /* ---- outline editing -------------------------------------------------
   * Auto-trace gets the silhouette close; this is for the places it does not.
   * Drag a handle to move it, click the line to add one, right-click to remove.
   * Every change re-derives the millimetre outline the bin is cut from. */
  const HIT_PX = 10;                       // grab radius, in screen pixels
  function dispScale() {
    const r = cv.getBoundingClientRect();
    return r.width ? cv.width / r.width : 1;
  }
  function canEdit() {
    return !!(S.scan.ppm && S.scan.contourPx && S.scan.contourPx.length > 2);
  }
  function distToSeg(p, a, b) {
    const vx = b[0] - a[0], vy = b[1] - a[1];
    const len = vx * vx + vy * vy;
    let t = len ? ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len : 0;
    t = Math.max(0, Math.min(1, t));
    const qx = a[0] + t * vx, qy = a[1] + t * vy;
    return { d: Math.hypot(p[0] - qx, p[1] - qy), at: [qx, qy] };
  }
  function hitTest(p) {
    if (!canEdit()) return null;
    const poly = S.scan.contourPx, n = poly.length, tol = HIT_PX * dispScale();
    let best = null;
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(p[0] - poly[i][0], p[1] - poly[i][1]);
      if (d <= tol && (!best || d < best.d)) best = { type: 'vertex', i: i, d: d };
    }
    if (best) return best;
    for (let i = 0; i < n; i++) {
      const s = distToSeg(p, poly[i], poly[(i + 1) % n]);
      if (s.d <= tol && (!best || s.d < best.d)) best = { type: 'edge', i: i, at: s.at, d: s.d };
    }
    return best;
  }
  function pushUndo() {
    if (!S.scan.contourPx) return;
    S.scan.undo = S.scan.undo || [];
    S.scan.undo.push(S.scan.contourPx.map(function (p) { return [p[0], p[1]]; }));
    if (S.scan.undo.length > 40) S.scan.undo.shift();
    S.scan.edited = true;
    refreshEditButtons();
  }
  function refreshEditButtons() {
    const u = $('sc-undo'), r = $('sc-reset');
    if (!u || !r) return;
    u.disabled = !(S.scan.undo && S.scan.undo.length);
    r.disabled = !(S.scan.traced && S.scan.edited);
  }
  // push the edited polygon back out as millimetres for the bin builder
  function syncOutline(withStats) {
    if (!canEdit()) return;
    S.outline = V.toMM(S.scan.contourPx, S.scan.ppm);
    const st = V.polyStats(S.outline);
    $('bin-poly').textContent = fmt(st.w, 1) + ' × ' + fmt(st.d, 1) + ' mm, ' + st.n + ' pts';
    if (withStats) {
      readout('Outline: <b>' + fmt(st.w, 1) + ' × ' + fmt(st.d, 1) + ' mm</b>, ' +
        fmt(st.area / 100, 1) + ' cm² · ' + st.n + ' points' +
        (S.scan.edited ? ' · edited by hand' : '') + '\n' +
        'Drag a point to move it, click the line to add one, right-click a point to remove it.\n' +
        'Happy with it? Send it to the Bin tab.');
    }
  }

  let drag = null;
  cv.addEventListener('pointerdown', function (e) {
    if (!S.scan.base) return;
    const p = evPos(e);
    if (e.button === 0) {
      const h = hitTest(p);
      if (h) {
        pushUndo();
        let i = h.i;
        if (h.type === 'edge') { i = h.i + 1; S.scan.contourPx.splice(i, 0, h.at); }
        drag = { vertex: i };
        S.scan.hover = i;
        try { cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
        drawScan();
        return;
      }
    }
    drag = { start: p, moved: false };
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
  });

  cv.addEventListener('pointermove', function (e) {
    const p = evPos(e);
    if (drag && drag.vertex != null) {
      S.scan.contourPx[drag.vertex] = [
        Math.max(0, Math.min(cv.width, p[0])),
        Math.max(0, Math.min(cv.height, p[1]))
      ];
      syncOutline(false);
      drawScan();
      return;
    }
    if (!drag) {                                   // hover feedback only
      if (!canEdit()) return;
      const h = hitTest(p);
      const i = h && h.type === 'vertex' ? h.i : -1;
      cv.style.cursor = h ? (h.type === 'vertex' ? 'grab' : 'copy') : 'crosshair';
      if (i !== S.scan.hover) { S.scan.hover = i; drawScan(); }
      return;
    }
    if (Math.hypot(p[0] - drag.start[0], p[1] - drag.start[1]) > 6) {
      drag.moved = true;
      S.scan.roi = {
        x0: Math.min(drag.start[0], p[0]), y0: Math.min(drag.start[1], p[1]),
        x1: Math.max(drag.start[0], p[0]), y1: Math.max(drag.start[1], p[1])
      };
      $('sc-roi').textContent = 'search area ' + Math.round(S.scan.roi.x1 - S.scan.roi.x0) + ' × ' +
        Math.round(S.scan.roi.y1 - S.scan.roi.y0) + ' px';
      drawScan();
    }
  });

  cv.addEventListener('pointerup', function (e) {
    if (!drag) return;
    if (drag.vertex != null) {
      syncOutline(true);
    } else if (!drag.moved && !canEdit()) {
      const need = $('sc-mode').value === 'frame' ? 4 : 2;
      if (S.scan.pts.length >= need) S.scan.pts = [];
      S.scan.pts.push(evPos(e));
      drawScan();
    }
    drag = null;
  });
  cv.addEventListener('pointercancel', function () { drag = null; });

  // right-click a handle to delete it
  cv.addEventListener('contextmenu', function (e) {
    if (!canEdit()) return;
    const h = hitTest(evPos(e));
    if (!h || h.type !== 'vertex') return;
    e.preventDefault();
    if (S.scan.contourPx.length <= 4) { status('an outline needs at least four points'); return; }
    pushUndo();
    S.scan.contourPx.splice(h.i, 1);
    S.scan.hover = -1;
    syncOutline(true);
    drawScan();
  });

  function undoEdit() {
    if (!S.scan.undo || !S.scan.undo.length) return;
    S.scan.contourPx = S.scan.undo.pop();
    S.scan.hover = -1;
    S.scan.edited = !!S.scan.undo.length || S.scan.edited;
    refreshEditButtons();
    syncOutline(true);
    drawScan();
  }
  on('sc-undo', 'click', undoEdit);
  on('sc-reset', 'click', function () {
    if (!S.scan.traced) return;
    pushUndo();
    S.scan.contourPx = S.scan.traced.map(function (p) { return [p[0], p[1]]; });
    S.scan.edited = false;
    S.scan.hover = -1;
    refreshEditButtons();
    syncOutline(true);
    drawScan();
  });
  addEventListener('keydown', function (e) {
    if (S.tab !== 'scan') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undoEdit(); }
  });
  on('sc-zoom', 'change', function () {
    cv.classList.toggle('native', $('sc-zoom').value === '1');
    drawScan();
  });

  function loadFile(file) {
    if (!file) return;
    status('reading photo…', 'busy');
    V.loadImage(file).then(function (bm) {
      S.scan.bitmap = bm;
      S.scan.pts = []; S.scan.roi = null; S.scan.ppm = null;
      const max = 1100;
      const s = Math.min(1, max / Math.max(bm.width, bm.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bm.width * s); c.height = Math.round(bm.height * s);
      c.getContext('2d').drawImage(bm, 0, 0, c.width, c.height);
      S.scan.srcScale = bm.width / c.width;
      setBase(c, null);
      $('sc-trace').disabled = true;
      $('sc-s1').classList.add('done');
      $('sc-roi').textContent = 'whole image';
      status('');
      readout('Photo loaded: <b>' + bm.width + ' × ' + bm.height + '</b> px\n' +
        ($('sc-mode').value === 'frame'
          ? 'click the four inside corners of the frame — top-left, top-right, bottom-right, bottom-left'
          : 'click two points on the ruler a known distance apart'));
      selectTab('scan');
    }).catch(function (e) { status('could not read that image: ' + e.message, 'err'); });
  }
  on('sc-file', 'change', function (e) { loadFile(e.target.files[0]); });
  on('sc-drop', 'click', function () { $('sc-file').click(); });
  ['dragover', 'dragenter'].forEach(function (t) {
    $('sc-drop').addEventListener(t, function (e) { e.preventDefault(); $('sc-drop').classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (t) {
    $('sc-drop').addEventListener(t, function (e) { e.preventDefault(); $('sc-drop').classList.remove('over'); });
  });
  $('sc-drop').addEventListener('drop', function (e) {
    if (e.dataTransfer.files.length) loadFile(e.dataTransfer.files[0]);
  });
  document.addEventListener('paste', function (e) {
    if (S.tab !== 'scan') return;
    for (const it of e.clipboardData.files) { loadFile(it); break; }
  });

  on('sc-clearpts', 'click', function () { S.scan.pts = []; drawScan(); });
  on('sc-roiclear', 'click', function () { S.scan.roi = null; $('sc-roi').textContent = 'whole image'; drawScan(); });

  on('sc-apply', 'click', function () {
    busy('rectifying…', function () {
      const mode = $('sc-mode').value;
      const k = S.scan.srcScale || 1;
      const src = S.scan.pts.map(function (p) { return [p[0] * k, p[1] * k]; });
      if (mode === 'frame') {
        const mmW = num('sc-fw'), mmD = num('sc-fd');
        if (mmW < 10 || mmD < 10) throw new Error('Enter the real size of the rectangle first.');
        const ppm = Math.min(8, Math.max(2, 1400 / Math.max(mmW, mmD)));
        const r = V.rectify(S.scan.bitmap, src, mmW, mmD, ppm);
        if (!r) throw new Error('Those four points are degenerate — pick the corners in order.');
        S.scan.pts = [];
        setBase(r.canvas, r.ppm);
        readout('Rectified to <b>' + fmt(mmW) + ' × ' + fmt(mmD) + ' mm</b> at ' + fmt(r.ppm, 2) +
          ' px/mm.\nDrag a box around the tool if anything else is in shot, then trace.');
      } else {
        const mm = num('sc-len');
        if (mm <= 0) throw new Error('Enter the distance between the two points.');
        const d = Math.hypot(src[1][0] - src[0][0], src[1][1] - src[0][1]);
        const ppmSrc = d / mm;
        const r = V.plain(S.scan.bitmap, ppmSrc, 1400);
        S.scan.pts = [];
        setBase(r.canvas, r.ppm);
        readout('Scale set: <b>' + fmt(ppmSrc, 2) + ' px/mm</b> in the original photo.\n' +
          '<span class="w">Perspective is not corrected in ruler mode — keep the camera square-on.</span>\n' +
          'Drag a box around the tool if anything else is in shot, then trace.');
      }
      $('sc-trace').disabled = false;
      $('sc-s2').classList.add('done');
    });
  });

  on('sc-trace', 'click', function () {
    busy('tracing…', function () {
      if (!S.scan.ppm) throw new Error('Set the scale first.');
      const b = S.scan.base;
      const c2 = document.createElement('canvas');
      c2.width = b.width; c2.height = b.height;
      const g2 = c2.getContext('2d', { willReadFrequently: true });
      g2.drawImage(b, 0, 0);
      const img = g2.getImageData(0, 0, b.width, b.height);
      const seg = V.segment(img, {
        threshold: $('sc-auto').checked ? null : int('sc-thr'),
        invert: $('sc-inv').checked,
        clean: int('sc-clean'),
        roi: S.scan.roi ? {
          x0: Math.round(S.scan.roi.x0), y0: Math.round(S.scan.roi.y0),
          x1: Math.round(S.scan.roi.x1), y1: Math.round(S.scan.roi.y1)
        } : null
      });
      const raw = V.contour(seg.mask, seg.w, seg.h);
      if (!raw || raw.length < 8) throw new Error('Nothing found — try inverting, or drag a box around the tool.');
      const smoothMM = Math.max(0.05, num('sc-simp') / 10);
      const simp = V.rdp(raw, smoothMM * S.scan.ppm);
      S.scan.mask = seg.mask;
      S.scan.contourPx = simp;
      S.scan.traced = simp.map(function (p) { return [p[0], p[1]]; });  // baseline for Reset
      S.scan.undo = [];
      S.scan.edited = false;
      S.scan.hover = -1;
      refreshEditButtons();
      buildTint();
      S.outline = V.toMM(simp, S.scan.ppm);
      drawScan();
      const st = V.polyStats(S.outline);
      readout('Outline: <b>' + fmt(st.w, 1) + ' × ' + fmt(st.d, 1) + ' mm</b>, ' +
        fmt(st.area / 100, 1) + ' cm² · ' + st.n + ' points\n' +
        'threshold ' + seg.threshold + (seg.objDark ? ' (dark object)' : ' (light object)') +
        ' · smoothing ' + fmt(smoothMM, 2) + ' mm\n' +
        (seg.clipped ? '<span class="w">the shape runs off the edge of the search area — drag a wider box</span>\n' : '') +
        'Off the mark anywhere? Drag a point to move it, click the line to add one,\n' +
        'right-click a point to remove it. Then send it to the Bin tab.');
      $('sc-use').disabled = $('sc-svg').disabled = false;
      $('sc-s3').classList.add('done');
      $('bin-poly').textContent = fmt(st.w, 1) + ' × ' + fmt(st.d, 1) + ' mm, ' + st.n + ' pts';
    });
  });
  ['sc-thr', 'sc-clean', 'sc-simp', 'sc-inv', 'sc-auto'].forEach(function (id) {
    on(id, 'change', function () {
      if (!S.scan.contourPx) return;
      // a re-trace throws away hand edits, so make that a deliberate act
      if (S.scan.edited) { status('press Trace outline to re-run — your edits will be replaced', 'busy'); return; }
      $('sc-trace').click();
    });
  });

  on('sc-use', 'click', function () {
    $('bin-style').value = 'pocket';
    syncVisibility();
    selectTab('bin');
    $('sc-s4').classList.add('done');
    buildBin();
  });
  on('sc-svg', 'click', function () {
    EX.save(EX.outlineSVG(S.outline, 'tool outline'), 'tool-outline.svg');
  });

  // scrolling the page must never nudge a number field
  addEventListener('wheel', function () {
    const a = document.activeElement;
    if (a && a.tagName === 'INPUT' && a.type === 'number') a.blur();
  }, { passive: true, capture: true });

  /* ----------------------------------------------------------------- boot */
  function boot() {
    viewer = new Viewer($('view'));
    syncVisibility();
    status('');
    buildBaseplate();
  }
  if (window.MANIFOLD) boot();
  else addEventListener('manifold-ready', boot);
  addEventListener('error', function (e) {
    if (e.message && /manifold/i.test(e.message)) status(e.message, 'err');
  });
})();
