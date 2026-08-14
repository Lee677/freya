/* ============================================================================
 * vision.js — photo -> real-world outline
 *
 * Two ways to get millimetres out of a photograph:
 *   1. ruler mode  — click two points a known distance apart (assumes the
 *                    camera was roughly square-on to the object)
 *   2. frame mode  — click the four corners of a known rectangle (the printed
 *                    target, a sheet of paper). The image is then rectified by
 *                    homography, which removes perspective AND lens tilt, so a
 *                    hand-held phone photo is good enough.
 * ==========================================================================*/
(function (global) {
  'use strict';
  const V = {};

  V.loadImage = async function (file) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (e) {
      return await createImageBitmap(file);
    }
  };

  /* ---------------- homography ---------------- */
  // src: 4 [x,y] in image px (TL,TR,BR,BL). dst: same order in output px.
  function solveH(src, dst) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const x = src[i][0], y = src[i][1], u = dst[i][0], w = dst[i][1];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -w * x, -w * y]); b.push(w);
    }
    // Gaussian elimination with partial pivoting
    for (let c = 0; c < 8; c++) {
      let p = c;
      for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      const t = A[c]; A[c] = A[p]; A[p] = t;
      const tb = b[c]; b[c] = b[p]; b[p] = tb;
      const d = A[c][c];
      if (Math.abs(d) < 1e-12) return null;
      for (let k = c; k < 8; k++) A[c][k] /= d;
      b[c] /= d;
      for (let r = 0; r < 8; r++) {
        if (r === c) continue;
        const f = A[r][c];
        if (!f) continue;
        for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
        b[r] -= f * b[c];
      }
    }
    return [b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], 1];
  }
  V.solveH = solveH;

  /* Rectify: quad (image px, TL TR BR BL) -> canvas that is mmW x mmD at
   * `ppm` pixels per millimetre. */
  V.rectify = function (bitmap, quad, mmW, mmD, ppm) {
    ppm = ppm || 4;
    const W = Math.max(32, Math.round(mmW * ppm)), H = Math.max(32, Math.round(mmD * ppm));
    const dst = [[0, 0], [W - 1, 0], [W - 1, H - 1], [0, H - 1]];
    const Hm = solveH(dst, quad);           // output -> input
    if (!Hm) return null;

    const sc = document.createElement('canvas');
    sc.width = bitmap.width; sc.height = bitmap.height;
    const sctx = sc.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(bitmap, 0, 0);
    const src = sctx.getImageData(0, 0, sc.width, sc.height);
    const sd = src.data, sw = sc.width, sh = sc.height;

    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    const octx = out.getContext('2d');
    const od = octx.createImageData(W, H);
    const dd = od.data;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const den = Hm[6] * x + Hm[7] * y + Hm[8];
        const sx = (Hm[0] * x + Hm[1] * y + Hm[2]) / den;
        const sy = (Hm[3] * x + Hm[4] * y + Hm[5]) / den;
        const o = (y * W + x) * 4;
        if (sx < 0 || sy < 0 || sx >= sw - 1 || sy >= sh - 1) { dd[o + 3] = 255; continue; }
        const x0 = sx | 0, y0 = sy | 0, fx = sx - x0, fy = sy - y0;
        const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
        for (let c = 0; c < 3; c++) {
          dd[o + c] =
            sd[i00 + c] * (1 - fx) * (1 - fy) + sd[i10 + c] * fx * (1 - fy) +
            sd[i01 + c] * (1 - fx) * fy + sd[i11 + c] * fx * fy;
        }
        dd[o + 3] = 255;
      }
    }
    octx.putImageData(od, 0, 0);
    return { canvas: out, ppm: ppm, w: W, h: H };
  };

  /* Plain scaled copy for ruler mode (no perspective correction). */
  V.plain = function (bitmap, ppm, maxPx) {
    maxPx = maxPx || 1600;
    const s = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bitmap.width * s); c.height = Math.round(bitmap.height * s);
    c.getContext('2d').drawImage(bitmap, 0, 0, c.width, c.height);
    return { canvas: c, ppm: ppm * s, w: c.width, h: c.height, scale: s };
  };

  /* ---------------- segmentation ---------------- */
  function grayOf(img) {
    const n = img.width * img.height, g = new Uint8ClampedArray(n), d = img.data;
    for (let i = 0; i < n; i++) g[i] = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) | 0;
    return g;
  }
  V.gray = grayOf;

  V.otsu = function (g) {
    const hist = new Float64Array(256);
    for (let i = 0; i < g.length; i++) hist[g[i]]++;
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = 0, thr = 128;
    const total = g.length;
    for (let i = 0; i < 256; i++) {
      wB += hist[i];
      if (!wB) continue;
      const wF = total - wB;
      if (!wF) break;
      sumB += i * hist[i];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; thr = i; }
    }
    return thr;
  };

  /* opts: {threshold, invert, roi:{x0,y0,x1,y1}, clean} -> Uint8Array mask
   *
   * Polarity is not guessed from the background brightness — that fails as soon
   * as the frame edge creeps into the picture. Both polarities are segmented and
   * the one whose blob does NOT run off the edge of the search area wins, which
   * is what actually distinguishes a tool from the surface under it. */
  V.segment = function (img, opts) {
    opts = opts || {};
    const w = img.width, h = img.height;
    const g = grayOf(img);
    const thr = opts.threshold == null ? V.otsu(g) : opts.threshold;
    const r = opts.roi || { x0: 0, y0: 0, x1: w - 1, y1: h - 1 };
    const rx0 = Math.max(0, Math.round(r.x0)), ry0 = Math.max(0, Math.round(r.y0));
    const rx1 = Math.min(w - 1, Math.round(r.x1)), ry1 = Math.min(h - 1, Math.round(r.y1));
    const roiArea = Math.max(1, (rx1 - rx0 + 1) * (ry1 - ry0 + 1));
    const k = opts.clean == null ? 2 : opts.clean;

    function build(dark) {
      const m = new Uint8Array(w * h);
      for (let y = ry0; y <= ry1; y++) {
        for (let x = rx0; x <= rx1; x++) {
          const i = y * w + x;
          m[i] = (dark ? g[i] < thr : g[i] > thr) ? 1 : 0;
        }
      }
      if (k > 0) { erode(m, w, h, k); dilate(m, w, h, k); dilate(m, w, h, k); erode(m, w, h, k); }
      const area = keepLargest(m, w, h);
      // the opening step clears a k-pixel skin, so probe just inside that
      const ti = k + 1;
      const tx0 = Math.min(rx0 + ti, rx1), tx1 = Math.max(rx1 - ti, rx0);
      const ty0 = Math.min(ry0 + ti, ry1), ty1 = Math.max(ry1 - ti, ry0);
      let touch = 0;
      for (let x = tx0; x <= tx1; x++) { if (m[ty0 * w + x]) touch++; if (m[ty1 * w + x]) touch++; }
      for (let y = ty0; y <= ty1; y++) { if (m[y * w + tx0]) touch++; if (m[y * w + tx1]) touch++; }
      return { mask: m, area: area, touch: touch, dark: dark };
    }

    const cands = [build(true), build(false)];
    function score(c) {
      const frac = c.area / roiArea;
      if (frac < 0.0015 || frac > 0.92) return -1e9;      // dust, or the whole field
      return (c.touch ? 0 : 1e6) - c.touch * 10 + c.area * 1e-3;
    }
    V.debug = {
      thr: thr, roiArea: roiArea,
      cands: cands.map(function (c) { return { dark: c.dark, area: c.area, touch: c.touch, frac: c.area / roiArea, score: score(c) }; })
    };
    let best = score(cands[0]) >= score(cands[1]) ? cands[0] : cands[1];
    if (opts.invert) best = (best === cands[0]) ? cands[1] : cands[0];

    fillHoles(best.mask, w, h);
    return {
      mask: best.mask, w: w, h: h, threshold: thr, objDark: best.dark,
      area: best.area, clipped: best.touch > 0
    };
  };

  function boxPass(mask, w, h, r, mode) {
    // separable min/max filter
    const tmp = new Uint8Array(w * h);
    const cmp = mode === 'min';
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = cmp ? 1 : 0;
        for (let i = -r; i <= r; i++) {
          const xx = x + i;
          if (xx < 0 || xx >= w) { if (cmp) v = 0; continue; }
          const m = mask[y * w + xx];
          v = cmp ? Math.min(v, m) : Math.max(v, m);
        }
        tmp[y * w + x] = v;
      }
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        let v = cmp ? 1 : 0;
        for (let i = -r; i <= r; i++) {
          const yy = y + i;
          if (yy < 0 || yy >= h) { if (cmp) v = 0; continue; }
          const m = tmp[yy * w + x];
          v = cmp ? Math.min(v, m) : Math.max(v, m);
        }
        mask[y * w + x] = v;
      }
    }
  }
  function erode(m, w, h, r) { boxPass(m, w, h, r, 'min'); }
  function dilate(m, w, h, r) { boxPass(m, w, h, r, 'max'); }
  V.erode = erode; V.dilate = dilate;

  function keepLargest(mask, w, h) {
    const lab = new Int32Array(w * h).fill(-1);
    let best = -1, bestN = 0;
    const stack = new Int32Array(w * h);
    let id = 0;
    for (let s = 0; s < mask.length; s++) {
      if (!mask[s] || lab[s] >= 0) continue;
      let sp = 0, n = 0;
      stack[sp++] = s; lab[s] = id;
      while (sp) {
        const p = stack[--sp]; n++;
        const x = p % w, y = (p / w) | 0;
        if (x > 0 && mask[p - 1] && lab[p - 1] < 0) { lab[p - 1] = id; stack[sp++] = p - 1; }
        if (x < w - 1 && mask[p + 1] && lab[p + 1] < 0) { lab[p + 1] = id; stack[sp++] = p + 1; }
        if (y > 0 && mask[p - w] && lab[p - w] < 0) { lab[p - w] = id; stack[sp++] = p - w; }
        if (y < h - 1 && mask[p + w] && lab[p + w] < 0) { lab[p + w] = id; stack[sp++] = p + w; }
      }
      if (n > bestN) { bestN = n; best = id; }
      id++;
    }
    for (let i = 0; i < mask.length; i++) mask[i] = (lab[i] === best && mask[i]) ? 1 : 0;
    return bestN;
  }

  function fillHoles(mask, w, h) {
    const out = new Uint8Array(w * h);   // reachable background
    const stack = [];
    for (let x = 0; x < w; x++) { stack.push(x, (h - 1) * w + x); }
    for (let y = 0; y < h; y++) { stack.push(y * w, y * w + w - 1); }
    while (stack.length) {
      const p = stack.pop();
      if (p < 0 || p >= w * h || out[p] || mask[p]) continue;
      out[p] = 1;
      const x = p % w;
      if (x > 0) stack.push(p - 1);
      if (x < w - 1) stack.push(p + 1);
      if (p >= w) stack.push(p - w);
      if (p < w * (h - 1)) stack.push(p + w);
    }
    for (let i = 0; i < mask.length; i++) if (!out[i]) mask[i] = 1;
  }

  /* Crack-following contour trace: walk the boundary between filled and empty
   * pixels keeping the filled side on the right. Always closes, and the result
   * is the true silhouette edge rather than pixel centres. Coordinates are
   * pixel-grid corners. */
  V.contour = function (mask, w, h) {
    let sx = -1, sy = -1;
    for (let y = 0; y < h && sx < 0; y++) {
      for (let x = 0; x < w; x++) if (mask[y * w + x]) { sx = x; sy = y; break; }
    }
    if (sx < 0) return null;
    const F = function (x, y) { return x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1; };
    const step = [[1, 0], [0, 1], [-1, 0], [0, -1]];   // +X, +Y, -X, -Y
    // pixels immediately left and right of the crack ahead, per direction
    const lp = [[0, -1], [0, 0], [-1, 0], [-1, -1]];
    const rp = [[0, 0], [-1, 0], [-1, -1], [0, -1]];
    let i = sx, j = sy, d = 0, startKey = null;
    const pts = [];
    const limit = 8 * (w * h) + 64;
    for (let n = 0; n < limit; n++) {
      const L = F(i + lp[d][0], j + lp[d][1]);
      const R = F(i + rp[d][0], j + rp[d][1]);
      if (L) d = (d + 3) % 4;            // region bulges to the left: turn left
      else if (!R) d = (d + 1) % 4;      // nothing on the right: turn right
      const key = i + ',' + j + ',' + d; // corner + outgoing direction is unique per lap
      if (startKey === null) startKey = key;
      else if (key === startKey) break;
      pts.push([i, j]);
      i += step[d][0]; j += step[d][1];
    }
    return pts;
  };

  /* Ramer–Douglas–Peucker */
  V.rdp = function (pts, eps) {
    if (pts.length < 3) return pts.slice();
    const keepIdx = new Uint8Array(pts.length);
    keepIdx[0] = keepIdx[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [i0, i1] = stack.pop();
      const a = pts[i0], b = pts[i1];
      let dx = b[0] - a[0], dy = b[1] - a[1];
      const L = Math.hypot(dx, dy) || 1;
      dx /= L; dy /= L;
      let bi = -1, bd = eps;
      for (let i = i0 + 1; i < i1; i++) {
        const px = pts[i][0] - a[0], py = pts[i][1] - a[1];
        const d = Math.abs(px * dy - py * dx);
        if (d > bd) { bd = d; bi = i; }
      }
      if (bi > 0) { keepIdx[bi] = 1; stack.push([i0, bi], [bi, i1]); }
    }
    const out = [];
    for (let i = 0; i < pts.length; i++) if (keepIdx[i]) out.push(pts[i]);
    return out;
  };

  /* pixel polygon -> millimetre polygon, Y flipped, centred on its bbox */
  V.toMM = function (pts, ppm, centre) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const mm = pts.map(function (p) { return [p[0] / ppm, -p[1] / ppm]; });
    for (const p of mm) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    if (centre === false) return mm;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    return mm.map(function (p) { return [p[0] - cx, p[1] - cy]; });
  };

  V.polyStats = function (poly) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, a = 0;
    for (let i = 0, n = poly.length, j = n - 1; i < n; j = i++) {
      a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
      x0 = Math.min(x0, poly[i][0]); x1 = Math.max(x1, poly[i][0]);
      y0 = Math.min(y0, poly[i][1]); y1 = Math.max(y1, poly[i][1]);
    }
    return { w: x1 - x0, d: y1 - y0, area: Math.abs(a / 2), n: poly.length };
  };

  global.V = V;
})(window);
