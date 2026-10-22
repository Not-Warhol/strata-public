/* STRATA. Print — "Lines", the Contour holders' print: the owner's complex-analysis sketch, still (its animation taken out), shaped by the
 * holder's Contour. The Contour's terrain moves the sketch's colour bands, lights it like a shaded relief map and draws its contour lines.
 * The version (A, C, D, E or F) comes from the wallet's origin hash; the palette is the buyer's choice. Same maths as the studio's shader
 * (web/prints/sketch/complex.frag.glsl), on the CPU, so the store's preview and the 300 dpi print file are the same picture.
 * Pure. Exposes globalThis.StrataPrintRelief. */
(function (root) {
  const W = 1000, H = 1414, P0 = [50, 50], P1 = [950, 1254], PAPER = '#F0F0F0';
  const TAU = Math.PI * 2, D = 10;
  // the palettes the buyer picks from: a colour for the swatch, the name, and the ramp of four colours the bands run through (0: the sketch's own)
  const PALETTES = [
    { hex: '#B0368C', name: 'Sketch', ramp: null },
    { hex: '#E84142', name: 'STRATA. red', ramp: [[.02, .02, .02], [.35, .03, .04], [.91, .25, .26], [1, .86, .82]] },
    { hex: '#C79E54', name: 'Survey map', ramp: [[.05, .16, .35], [.2, .48, .32], [.78, .62, .33], [.97, .95, .9]] },
    { hex: '#FA6B1A', name: 'Infrared', ramp: [[.02, 0, .06], [.42, .05, .5], [.98, .42, .1], [1, .93, .45]] },
    { hex: '#5AD9F2', name: 'Ice', ramp: [[0, .03, .12], [.05, .3, .55], [.35, .85, .95], [.96, 1, 1]] },
    { hex: '#2A2725', name: 'Ink on paper', ramp: [[.95, .93, .88], [.75, .72, .66], [.3, .28, .27], [.05, .05, .05]] },
    { hex: '#FF1A99', name: 'Acid', ramp: [[.04, 0, .1], [1, .1, .6], [.1, .9, 1], [1, 1, 1]] },
  ];
  const VERSIONS = [0, 2, 3, 4, 5];   // A height, C bent, D finer, E terraces, F strong (B, the slope, is left out: it looked like a collage)
  const fnv = (k) => { let h = 2166136261; for (let q = 0; q < k.length; q++) { h ^= k.charCodeAt(q); h = Math.imul(h, 16777619); } return h >>> 0; };
  /** The version a wallet's origin hash gives (the studio's Randomize picks with another variation). */
  const modeFor = (origin, variant = 0) => VERSIONS[fnv(String(origin) + ':' + variant) % VERSIONS.length];
  const palOf = (hex) => Math.max(0, PALETTES.findIndex((p) => p.hex.toLowerCase() === String(hex || '').toLowerCase()));

  const S = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const smin = (a, b, k) => { const h = Math.min(1, Math.max(0, 0.5 + 0.5 * (b - a) / k)); return b + (a - b) * h - k * h * (1 - h); };
  const fract = (x) => x - Math.floor(x);

  /** The Contour's terrain, from StrataArt.generate({ ..., withField: true }).field: heights 0..1 on an n × n grid. */
  function terrain(field) {
    const n = field.G + 1, f = Float32Array.from(field.f, (v) => Math.max(0, Math.min(1, v)));
    const ox = P0[0], oy = (P0[1] + P1[1]) / 2 - (P1[0] - P0[0]) / 2, side = P1[0] - P0[0];
    // as the GPU samples it: linear between texel centres, clamped at the edges; sea (0) outside the map square
    return (x, y) => {
      const mx = (x - ox) / side, my = (y - oy) / side;
      if (mx < 0 || my < 0 || mx > 1 || my > 1) return 0;
      const fx = Math.min(n - 1, Math.max(0, mx * n - 0.5)), fy = Math.min(n - 1, Math.max(0, my * n - 0.5));
      const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(n - 1, x0 + 1), y1 = Math.min(n - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
      const a = f[y0 * n + x0] + (f[y0 * n + x1] - f[y0 * n + x0]) * tx, b = f[y1 * n + x0] + (f[y1 * n + x1] - f[y1 * n + x0]) * tx;
      return a + (b - a) * ty;
    };
  }

  /** The colour (0..1 rgb) of one point of the sheet (sheet units, y down). */
  function shade(height, mode, pal, x, y, out) {
    const cx = (P0[0] + P1[0]) / 2, cy = (P0[1] + P1[1]) / 2, sw = P1[0] - P0[0], sh = P1[1] - P0[1];
    let ux = (x - cx) / sw, uy = -(y - cy) / sw; const grain = 0.9 + 0.1 * fract(Math.sin(ux * 12.9898 + uy * 78.233) * 345678);
    let sx = 2 * (x - P0[0]) / sw - 1, sy = -(2 * (y - P0[1]) / sh - 1);
    const h = height(x, y), e = 3, gx = height(x + e, y) - height(x - e, y), gy = height(x, y + e) - height(x, y - e);
    const land = S(0, 0.04, h);
    // the scene: the sketch's figure 1, without time
    if (mode === 2) { const wx = gx * 9 + h * 0.35, wy = -gy * 9 + h * 0.35; ux += wx * 0.25; uy += wy * 0.25; sx += wx; sy += wy; }   // C: the plane bends with the terrain
    ux = smin(ux, -ux, -0.025) - 0.1;
    const ax = ux, ay = uy + D, bx = ux, by = uy - D;
    const nx = ax + bx, ny = ay + by, dx = ax / bx, dy = ay / by, dd = dx * dx + dy * dy;
    let qx = (nx * dx + ny * dy) / dd, qy = (ny * dx - nx * dy) / dd;
    if (mode === 1) { qx += (gx + 1e-4 - qx) * land; qy += (-gy + 1e-4 - qy) * land; }                                              // B (not sold)
    const mx = sx * sy - sy * sx, my = sy * sy + sx * sx;                                                                            // cmul(st, st.yx)
    const s = Math.hypot(mx, my); let rx = Math.sqrt(Math.max(0.5 * (s + mx), 0)), ry = Math.sqrt(Math.max(0.5 * (s - mx), 0));
    if (!(my < 0)) ry = -ry;                                                                                                       // csqrt
    const ang = Math.atan2(qy, qx) / TAU;
    let k = Math.min(Math.abs(rx) + ang, Math.abs(ry) + ang);
    if (mode === 0) k += 2.4 * h;
    else if (mode === 2) k += 1.2 * h;
    else if (mode === 3) k = k * (1 + 4 * h) + h;
    else if (mode === 4) k += 2.4 * Math.floor(Math.min(h, 0.999) * 12) / 12;
    else if (mode === 5) k += 4.8 * h;
    // the palette
    let r, g, b; const P = PALETTES[pal] || PALETTES[0];
    if (!P.ramp) { r = 0.5 + 0.5 * Math.sin(k * 2.8 + 1.5); g = 0.5 + 0.5 * Math.sin(k * 2.8 + 2); b = 0.5 + 0.5 * Math.sin(k * 2.8 + 3); }
    else {
      const t = Math.min(1, Math.max(0, 0.5 + 0.5 * Math.sin(k * 2.8))) * 3, i = Math.min(2, Math.floor(t)), u = t - i, A = P.ramp[i], B = P.ramp[i + 1];
      r = A[0] + (B[0] - A[0]) * u; g = A[1] + (B[1] - A[1]) * u; b = A[2] + (B[2] - A[2]) * u;
    }
    r *= grain; g *= grain; b *= grain;
    if (!P.ramp) { r *= 1; g *= 0.2; b *= 0.8; r /= 1 + Math.exp(-S(-0.5, 1.5, r)); g /= 1 + Math.exp(-S(-0.5, 1.5, g)); b /= 1 + Math.exp(-S(-0.5, 1.5, b)); }   // the sketch's own tint
    // the relief: light from the upper left over the slopes
    let lx = -gx * 26, ly = gy * 26, lz = 1; const ln = Math.hypot(lx, ly, lz); lx /= ln; ly /= ln; lz /= ln;
    const Ln = Math.hypot(0.55, 0.55, 0.63), light = (lx * -0.55 + ly * 0.55 + lz * 0.63) / Ln, m = 1 + (0.45 + 0.8 * light - 1) * land;
    r *= m; g *= m; b *= m;
    // the contour lines, a fixed width on the sheet (the same on the screen and on the print)
    if (mode !== 5) {
      const qq = h * 10 + 0.5, w = 1.5 * 10 * (Math.abs(gx) + Math.abs(gy)) / 6 + 1e-4, line = 1 - S(0, w * 1.4, Math.abs(fract(qq - 0.5) - 0.5)), f = line * land * 0.7 * 0.65;
      r -= r * f; g -= g * f; b -= b * f;
    }
    out[0] = r; out[1] = g; out[2] = b;
  }

  /** The picture (the sheet's art area, P0..P1) as RGBA bytes, w px wide. aa: samples per pixel along each side (1 or 2). */
  function picture({ field, mode = 0, pal = 0, w = 600, aa = 1 }) {
    const height = terrain(field), sw = P1[0] - P0[0], sh = P1[1] - P0[1], hpx = Math.round(w * sh / sw), u = sw / w;
    const px = new Uint8ClampedArray(w * hpx * 4), c = [0, 0, 0], n = aa * aa;
    for (let j = 0; j < hpx; j++) for (let i = 0; i < w; i++) {
      let r = 0, g = 0, b = 0;
      for (let a = 0; a < aa; a++) for (let bb = 0; bb < aa; bb++) {
        shade(height, mode, pal, P0[0] + (i + (a + 0.5) / aa) * u, P0[1] + (j + (bb + 0.5) / aa) * u, c);
        r += Math.min(1, Math.max(0, c[0])); g += Math.min(1, Math.max(0, c[1])); b += Math.min(1, Math.max(0, c[2]));
      }
      const o = (j * w + i) * 4; px[o] = r / n * 255; px[o + 1] = g / n * 255; px[o + 2] = b / n * 255; px[o + 3] = 255;
    }
    return { w, h: hpx, px };
  }

  /** The sheet as SVG (1000 × 1414): the paper, the picture as an image (its data URL from `png`, made by the caller: a canvas in the
   *  browser, zlib on the server), and the parts the caller adds (origin hash, stamp) via StrataPrintSheet.finish. */
  function generate({ href }) {
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${PAPER}"/>`
      + `<image x="${P0[0]}" y="${P0[1]}" width="${P1[0] - P0[0]}" height="${P1[1] - P0[1]}" preserveAspectRatio="none" href="${href}" xlink:href="${href}"/></svg>`;
  }

  root.StrataPrintRelief = { PALETTES, VERSIONS, PAPER, P0, P1, modeFor, palOf, picture, generate };
})(typeof globalThis !== 'undefined' ? globalThis : this);
