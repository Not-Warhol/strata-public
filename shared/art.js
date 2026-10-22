/* Strata Drop 001 — Contour. Deterministic: same inputs => same piece, in p5 and in SVG.
 * The wallet's NFT bags become a survey map: every collection held from the list raises a
 * peak in that collection's colour; bag size sets its height and width. Total NFTs set how
 * many contour lines there are. Texture: halftone hillshade under a seeded light + paper grain.
 * No bags at all = open sea.
 * Exposes globalThis.StrataArt. Depends on globalThis.StrataSeasons. */
(function (root) {
  function rngFrom(hex) {
    const h = String(hex).replace(/^0x/, '').padEnd(64, '0');
    let a = parseInt(h.slice(0, 8), 16) >>> 0, b = parseInt(h.slice(8, 16), 16) >>> 0,
      c = parseInt(h.slice(16, 24), 16) >>> 0, d = parseInt(h.slice(24, 32), 16) >>> 0;
    const next = () => {
      a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
      let t = (a + b) | 0;
      a = b ^ (b >>> 9);
      b = (c + (c << 3)) | 0;
      c = (c << 21) | (c >>> 11);
      d = (d + 1) | 0;
      t = (t + d) | 0;
      c = (c + t) | 0;
      return (t >>> 0) / 4294967296;
    };
    for (let i = 0; i < 16; i++) next();
    return next;
  }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (x) => x * x * (3 - 2 * x);
  const COMPASS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];

  // Marching squares: flat [x1,y1,x2,y2,...] for one threshold.
  function isoLines(f, G, x0, y0, step, t) {
    const out = [];
    const at = (i, j) => f[j * (G + 1) + i];
    const lerp = (a, b) => (t - a) / (b - a);
    for (let j = 0; j < G; j++) {
      for (let i = 0; i < G; i++) {
        const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
        let idx = 0;
        if (a > t) idx |= 8; if (b > t) idx |= 4; if (c > t) idx |= 2; if (d > t) idx |= 1;
        if (idx === 0 || idx === 15) continue;
        const X = x0 + i * step, Y = y0 + j * step;
        const top = [X + step * lerp(a, b), Y];
        const right = [X + step, Y + step * lerp(b, c)];
        const bottom = [X + step * lerp(d, c), Y + step];
        const left = [X, Y + step * lerp(a, d)];
        const seg = (p, q) => out.push(p[0], p[1], q[0], q[1]);
        const centre = (a + b + c + d) / 4 > t;
        switch (idx) {
          case 1: case 14: seg(left, bottom); break;
          case 2: case 13: seg(bottom, right); break;
          case 3: case 12: seg(left, right); break;
          case 4: case 11: seg(top, right); break;
          case 6: case 9: seg(top, bottom); break;
          case 7: case 8: seg(left, top); break;
          case 5: if (centre) { seg(left, top); seg(bottom, right); } else { seg(left, bottom); seg(top, right); } break;
          case 10: if (centre) { seg(left, bottom); seg(top, right); } else { seg(left, top); seg(bottom, right); } break;
          default: break;
        }
      }
    }
    return out;
  }

  function ringSegs(cx, cy, r, n = 48) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      out.push(cx + r * Math.cos(a0), cy + r * Math.sin(a0), cx + r * Math.cos(a1), cy + r * Math.sin(a1));
    }
    return out;
  }

  // Curated colours for collections. A collection keeps its colour in every wallet.
  const BAG_COLORS = ['#E84142', '#2F7D6D', '#3A5A8C', '#D9731E', '#6B4FA0', '#C9A227', '#B3122E', '#2E4A62',
    '#E0A800', '#5E7686', '#FF6FA8', '#1F8A9E', '#8A5A2B', '#4C7A34', '#9B2F6A', '#3F3FB8', '#C4553B', '#0F6E5A',
    '#7A6FD0', '#A08400'];
  function colorFor(address) {
    let h = 2166136261;
    const a = String(address).toLowerCase();
    for (let i = 0; i < a.length; i++) { h ^= a.charCodeAt(i); h = Math.imul(h, 16777619); }
    return BAG_COLORS[(h >>> 0) % BAG_COLORS.length];
  }


  // ---- Landmarks: every boosted collection owns one original map symbol, drawn on its peak.
  const LANDMARKS = ['Lighthouse', 'Cairn', 'Flag', 'Observatory', 'Windmill', 'Hut', 'Tent', 'Pine', 'Tower', 'Bridge',
    'Beacon', 'Cave', 'Spring', 'Shrine', 'Arch', 'Mine', 'Anchor', 'Lookout', 'Falls', 'Camp', 'Totem'];
  function landmarkShapes(kind, x, y, col, ink, bg, seq) {
    const out = [];
    const P = (pts, fill, a) => out.push({ t: 'poly', pts, fill, a, seq });
    const C = (cx, cy, r, fill, a) => out.push({ t: 'circ', x: cx, y: cy, r, fill, a, seq });
    const L = (pts, sw = 1.8, stroke = ink, a) => out.push({ t: 'segs', pts, stroke, sw, a, seq });
    const arc = (cx, cy, r, a0, a1, n = 10) => { const o = []; for (let k = 0; k < n; k++) { const t0 = a0 + (a1 - a0) * k / n, t1 = a0 + (a1 - a0) * (k + 1) / n; o.push(cx + r * Math.cos(t0), cy + r * Math.sin(t0), cx + r * Math.cos(t1), cy + r * Math.sin(t1)); } return o; };
    // plate: a paper disc with a coloured ring, so the symbol reads on any terrain
    C(x, y - 12, 21, bg, 0.92);
    L(ringSegs(x, y - 12, 21, 36), 2.4, col);
    const b = y - 1; // ground line of the symbol
    switch (LANDMARKS[kind % LANDMARKS.length]) {
      case 'Lighthouse': P([x - 5, b, x + 5, b, x + 3, b - 19, x - 3, b - 19], col); C(x, b - 22, 3, ink); L([x - 11, b - 24, x - 5, b - 22, x + 5, b - 22, x + 11, b - 24], 1.4); break;
      case 'Cairn': C(x, b - 5, 6, col); C(x, b - 14, 4.5, ink); C(x, b - 21, 3, col); break;
      case 'Flag': L([x - 4, b, x - 4, b - 24], 2); P([x - 4, b - 24, x + 10, b - 19, x - 4, b - 14], col); break;
      case 'Observatory': out.push({ t: 'rect', x: x - 8, y: b - 9, w: 16, h: 9, fill: ink, seq }); P([...Array(9)].flatMap((_, k) => [x + 8 * Math.cos(Math.PI + k * Math.PI / 8), b - 9 + 8 * Math.sin(Math.PI + k * Math.PI / 8)]), col); break;
      case 'Windmill': P([x - 5, b, x + 5, b, x + 2, b - 14, x - 2, b - 14], ink); L([x - 9, b - 23, x + 9, b - 5, x + 9, b - 23, x - 9, b - 5], 2.4, col); break;
      case 'Hut': P([x - 8, b, x + 8, b, x + 8, b - 9, x, b - 17, x - 8, b - 9], col); out.push({ t: 'rect', x: x - 2, y: b - 6, w: 4, h: 6, fill: ink, seq }); break;
      case 'Tent': P([x - 11, b, x + 11, b, x, b - 18], col); L([x, b - 18, x, b], 1.6); break;
      case 'Pine': P([x - 9, b - 4, x + 9, b - 4, x, b - 13], col); P([x - 7, b - 10, x + 7, b - 10, x, b - 19], col); P([x - 5, b - 16, x + 5, b - 16, x, b - 24], col); L([x, b - 4, x, b], 2); break;
      case 'Tower': out.push({ t: 'rect', x: x - 5, y: b - 20, w: 10, h: 20, fill: col, seq }); for (const dx of [-5, -1, 3]) out.push({ t: 'rect', x: x + dx, y: b - 24, w: 2, h: 4, fill: col, seq }); break;
      case 'Bridge': L(arc(x, b, 11, Math.PI, Math.PI * 2), 2.4, col); L([x - 13, b - 11, x + 13, b - 11], 2); break;
      case 'Beacon': P([x - 7, b, x + 7, b, x, b - 13], ink); C(x, b - 17, 4, col); L(ringSegs(x, b - 17, 8, 16), 1.2, col); break;
      case 'Cave': P([...Array(11)].flatMap((_, k) => [x + 11 * Math.cos(Math.PI + k * Math.PI / 10), b + 11 * Math.sin(Math.PI + k * Math.PI / 10)]), col); P([...Array(11)].flatMap((_, k) => [x + 5 * Math.cos(Math.PI + k * Math.PI / 10), b + 6 * Math.sin(Math.PI + k * Math.PI / 10)]), ink); break;
      case 'Spring': C(x, b - 12, 5, col); for (const r of [8, 11]) L(arc(x, b - 12, r, -0.5, Math.PI + 0.5, 12), 1.4, col); break;
      case 'Shrine': out.push({ t: 'rect', x: x - 6, y: b - 11, w: 12, h: 11, fill: col, seq }); P([x - 11, b - 11, x + 11, b - 11, x, b - 20], ink); break;
      case 'Arch': out.push({ t: 'rect', x: x - 9, y: b - 16, w: 4, h: 16, fill: col, seq }); out.push({ t: 'rect', x: x + 5, y: b - 16, w: 4, h: 16, fill: col, seq }); out.push({ t: 'rect', x: x - 11, y: b - 20, w: 22, h: 4, fill: ink, seq }); break;
      case 'Mine': L([x - 9, b - 20, x + 9, b - 2, x + 9, b - 20, x - 9, b - 2], 2.6, col); C(x, b - 11, 3, ink); break;
      case 'Anchor': L([x, b - 22, x, b - 2, x - 7, b - 16, x + 7, b - 16], 2.2, col); L(arc(x, b - 8, 8, 0.2, Math.PI - 0.2, 10), 2.2, col); C(x, b - 23, 2.6, ink); break;
      case 'Lookout': out.push({ t: 'rect', x: x - 9, y: b - 18, w: 18, h: 4, fill: col, seq }); L([x - 7, b - 14, x - 9, b, x + 7, b - 14, x + 9, b, x - 8, b - 7, x + 8, b - 7], 1.6); P([x - 9, b - 18, x + 9, b - 18, x, b - 25], ink); break;
      case 'Falls': for (const dx of [-6, 0, 6]) { const o = []; for (let k = 0; k < 6; k++) o.push(x + dx + Math.sin(k) * 1.5, b - 22 + k * 4, x + dx + Math.sin(k + 1) * 1.5, b - 18 + k * 4); L(o, 1.8, col); } L([x - 10, b - 22, x + 10, b - 22], 2.4); break;
      case 'Totem': for (let k = 0; k < 4; k++) out.push({ t: 'rect', x: x - 5 + (k % 2) * 1.5, y: b - 6 - k * 5.5, w: 10 - (k % 2) * 3, h: 4.5, fill: k % 2 ? ink : col, seq }); P([x - 9, b - 22, x + 9, b - 22, x, b - 27], col); break;
      case 'Camp': P([x - 10, b, x + 2, b, x - 4, b - 14], col); C(x + 8, b - 3, 3, RED_FIRE); L([x + 4, b, x + 12, b], 1.6); break;
      default: C(x, b - 10, 6, col);
    }
    return out;
  }
  const RED_FIRE = '#E84142';
  const EXPEDITION = [[0, 'None'], [1, 'Scout'], [3, 'Expedition'], [10, 'Grand Tour'], [21, 'Cartographer']];
  const expeditionFor = (n) => { let t = EXPEDITION[0][1]; for (const [min, name] of EXPEDITION) if (n >= min) t = name; return t; };

  const TERRAIN = [[0, 'Flatland'], [1, 'Sandbar'], [3, 'Hills'], [10, 'Range'], [30, 'Alps'], [100, 'Himalaya']];
  const terrainFor = (n) => { let t = TERRAIN[0][1]; for (const [min, name] of TERRAIN) if (n >= min) t = name; return t; };

  function frameShape(ink) {
    const W = 1000, M = 96, frame = [];
    const F0 = M - 34, F1 = W - M + 34;
    frame.push(F0, F0, F1, F0, F1, F0, F1, F1, F1, F1, F0, F1, F0, F1, F0, F0);
    for (let v = F0 + 50; v < F1 - 10; v += 50) {
      const len = (Math.round((v - F0) / 50) % 2) ? 7 : 14;
      frame.push(v, F0, v, F0 + len, v, F1, v, F1 - len, F0, v, F0 + len, v, F1, v, F1 - len, v);
    }
    return { t: 'segs', pts: frame, stroke: ink, sw: 1.4, a: 0.45, seq: 0 };
  }

  /**
   * p = {
   *   seed: '0x…', season: index (price/background), score: 0-1000,
   *   holdings: [{ i: collectionIndex, n: count }],
   *   collections: [{ address, name, color? }]   (optional, for colours and names)
   * }
   */
  function generate(p) {
    const S = root.StrataSeasons;
    const N = S.SEASONS.length;
    const seasonIdx = clamp(p.season | 0, 0, N - 1);
    const season = S.SEASONS[seasonIdx];
    const rnd = rngFrom(p.seed);
    const act = clamp((p.score || 0) / 1000, 0, 1);
    const cols = p.collections || [];
    const meta = (i) => {
      const c = cols[i] || {};
      return { name: c.name || (c.address ? `${c.address.slice(0, 6)}…${c.address.slice(-4)}` : 'Unnamed'), color: c.color || colorFor(c.address || `idx${i}`), boost: Boolean(c.boost), pidx: c.boostIndex ?? i };
    };

    // boosted collections weigh more: their bags count `boostWeight` times for peak size and ranking
    const PW = p.boostWeight || 3;
    const held = (p.holdings || []).filter((h) => h.n > 0)
      .map((h) => ({ ...h, w: h.n * (meta(h.i).boost ? PW : 1) }))
      .sort((a, b) => b.w - a.w || a.i - b.i);
    const total = held.reduce((a, h) => a + h.n, 0);
    const W = 1000, M = 96;
    const ink = season.palette[3];
    const shapes = [];

    // paper grain
    const grains = 1100 + Math.round(rnd() * 500);
    for (let i = 0; i < grains; i++) {
      shapes.push({ t: 'circ', x: rnd() * W, y: rnd() * W, r: 0.5 + rnd() * 0.9, fill: ink, a: 0.05 + rnd() * 0.08, seq: 0 });
    }
    shapes.push(frameShape(ink));

    // ---- no bags: open sea
    if (!held.length) {
      for (let k = 0; k < 7; k++) {
        const y0 = 330 + k * 56, pts = [];
        let py = y0;
        for (let x = M + 20; x < W - M - 20; x += 8) {
          const y = y0 + Math.sin(x * 0.018 + k * 1.3 + rnd() * 0.2) * (6 + k);
          if (x > M + 20) pts.push(x - 8, py, x, y);
          py = y;
        }
        shapes.push({ t: 'segs', pts, stroke: ink, sw: 1.3, a: 0.28, seq: k + 1 });
      }
      shapes.push({ t: 'segs', pts: ringSegs(500, 500, 10), stroke: ink, sw: 1.6, seq: 8 });
      shapes.push({ t: 'circ', x: 500, y: 500, r: 3.2, fill: ink, seq: 8 });
      return {
        style: 'contour', w: W, h: W, bg: season.bg, ink, steps: 9, enter: 'fade',
        seal: { kind: 'rings' }, shapes,
        traits: { Terrain: 'Flatland', Collections: 0, NFTs: 0, 'Tallest peak': 'None', Peaks: 0, Landmarks: 0, Expedition: 'None', Route: 'Unmapped', Light: '-', Season: season.name },
        peaks: [], landmarks: [],
      };
    }

    // ---- terrain: one peak per collection held (top 24), height and width follow the bag size
    const G = 110;
    const step = (W - 2 * M) / G;
    const maxN = held[0].w;
    const top = held.slice(0, 24);
    const island = 0.13 + 0.17 * clamp(Math.log(1 + total) / Math.log(150), 0, 1); // small bags, small island
    const scale = island / 0.3;
    const peaks = [];
    for (let k = 0; k < top.length; k++) {
      const h = top[k];
      const rel = Math.log(1 + h.w) / Math.log(1 + maxN);
      let x = 0, y = 0;
      for (let tries = 0; tries < 30; tries++) { // spread peaks out
        const spread = (k === 0 ? 0.22 : 0.62) * scale;
        x = M + (0.5 + (rnd() - 0.5) * spread * 1.2) * (W - 2 * M);
        y = M + (0.5 + (rnd() - 0.5) * spread * 1.2) * (W - 2 * M);
        if (peaks.every((q) => Math.hypot(q.x - x, q.y - y) > (70 + 60 * rel) * scale)) break;
      }
      const alone = top.length <= 2 ? 50 : 0;
      peaks.push({ x, y, h: 0.28 + 0.72 * rel, s: (55 + 105 * rel + alone) * (0.45 + 0.55 * scale), ...meta(h.i), n: h.n, i: h.i });
    }

    const NG = 7;
    const ng = [];
    for (let i = 0; i < (NG + 1) * (NG + 1); i++) ng.push(rnd());
    const noise = (u, v) => {
      const x = clamp(u, 0, 1) * NG, y = clamp(v, 0, 1) * NG;
      const i = Math.min(NG - 1, Math.floor(x)), j = Math.min(NG - 1, Math.floor(y));
      const fx = smooth(x - i), fy = smooth(y - j);
      const q = (a, b) => ng[b * (NG + 1) + a];
      return (q(i, j) * (1 - fx) + q(i + 1, j) * fx) * (1 - fy) + (q(i, j + 1) * (1 - fx) + q(i + 1, j + 1) * fx) * fy;
    };
    const rough = 0.04 + (1 - act) * 0.05;
    const f = new Float32Array((G + 1) * (G + 1));
    const owner = new Uint8Array((G + 1) * (G + 1));
    let max = 0;
    for (let j = 0; j <= G; j++) {
      for (let i = 0; i <= G; i++) {
        const x = M + i * step, y = M + j * step;
        let v = 0, best = 0, bestV = -1;
        for (let k = 0; k < peaks.length; k++) {
          const pk = peaks[k];
          const dx = x - pk.x, dy = y - pk.y;
          const c = pk.h * Math.exp(-(dx * dx + dy * dy) / (2 * pk.s * pk.s));
          v += c;
          if (c > bestV) { bestV = c; best = k; }
        }
        v += (noise(i / G, j / G) - 0.5) * rough * 2;
        const du = i / G - 0.5, dv = j / G - 0.5;
        const r = Math.sqrt(du * du + dv * dv) * (1 + (noise(dv + 0.5, du + 0.5) - 0.5) * 0.35);
        v *= 1 - smooth(clamp((r - island) / 0.17, 0, 1));
        f[j * (G + 1) + i] = v;
        owner[j * (G + 1) + i] = best;
        if (v > max) max = v;
      }
    }
    for (let k = 0; k < f.length; k++) f[k] /= max || 1;
    const idxAt = (x, y) => {
      const i = clamp(Math.round((x - M) / step), 0, G), j = clamp(Math.round((y - M) / step), 0, G);
      return j * (G + 1) + i;
    };
    const fAt = (x, y) => {
      const gx = clamp((x - M) / step, 0, G - 0.001), gy = clamp((y - M) / step, 0, G - 0.001);
      const i = Math.floor(gx), j = Math.floor(gy), tx = gx - i, ty = gy - j;
      const q = (a, b) => f[b * (G + 1) + a];
      return (q(i, j) * (1 - tx) + q(i + 1, j) * tx) * (1 - ty) + (q(i, j + 1) * (1 - tx) + q(i + 1, j + 1) * tx) * ty;
    };

    // ---- levels: more NFTs => more contour lines
    const K = clamp(5 + Math.round(Math.log2(1 + total) * 3.2), 5, 36);
    const tOf = (i) => 0.08 + 0.88 * (i + 0.5) / K;
    const levelOf = (v) => { let n = -1; for (let i = 0; i < K; i++) if (v > tOf(i)) n = i; return n; };

    // ---- halftone hillshade, dots take the colour of the collection that owns the slope
    const lightA = rnd() * Math.PI * 2;
    const lx = Math.cos(lightA), ly = Math.sin(lightA);
    const H = 74 + Math.round(act * 22);
    const hs = (W - 2 * M) / H;
    for (let j = 0; j <= H; j++) {
      for (let i = 0; i <= H; i++) {
        const x = M + (i + (j % 2 ? 0.5 : 0)) * hs, y = M + j * hs;
        if (x > W - M) continue;
        const lvl = levelOf(fAt(x, y));
        if (lvl < 0) continue;
        const e = 4;
        const gx = (fAt(x + e, y) - fAt(x - e, y)) / (2 * e) * W;
        const gy = (fAt(x, y + e) - fAt(x, y - e)) / (2 * e) * W;
        const shade = clamp(0.5 + (gx * lx + gy * ly) * 0.35, 0, 1);
        const rr = hs * 0.5 * (0.12 + 0.78 * shade);
        if (rr < 0.45) continue;
        shapes.push({ t: 'circ', x, y, r: rr, fill: peaks[owner[idxAt(x, y)]].color, a: 0.28 + shade * 0.27, seq: lvl + 1 });
      }
    }

    // ---- contour lines, split by the collection that owns each stretch of line
    for (let i = 0; i < K; i++) {
      const pts = isoLines(f, G, M, M, step, tOf(i));
      if (!pts.length) continue;
      const coast = i === 0;
      const byColor = {};
      for (let q = 0; q < pts.length; q += 4) {
        const col = coast ? ink : peaks[owner[idxAt((pts[q] + pts[q + 2]) / 2, (pts[q + 1] + pts[q + 3]) / 2)]].color;
        (byColor[col] = byColor[col] || []).push(pts[q], pts[q + 1], pts[q + 2], pts[q + 3]);
      }
      const index = i % 4 === 0;
      for (const [col, seg] of Object.entries(byColor)) {
        shapes.push({ t: 'segs', pts: seg, stroke: col, sw: coast ? 2.2 : (index ? 3.6 : 1.5), a: coast ? 0.9 : (index ? 1 : 0.85), seq: i + 1 });
      }
    }

    // ---- a benchmark on every peak top, the tallest one doubled
    for (let k = 0; k < peaks.length; k++) {
      const pk = peaks[k];
      if (pk.boost || fAt(pk.x, pk.y) < tOf(0)) continue;
      const big = k === 0;
      shapes.push({ t: 'segs', pts: ringSegs(pk.x, pk.y, big ? 11 : 6), stroke: ink, sw: big ? 1.6 : 1.1, seq: K + 1 });
      shapes.push({ t: 'circ', x: pk.x, y: pk.y, r: big ? 3.2 : 1.8, fill: ink, seq: K + 1 });

    }

    // ---- boosted specials: a dashed survey route linking boosted peaks, then a landmark on each
    const boostPeaks = peaks.filter((pk) => pk.boost);
    for (const pk of boostPeaks) { // a landmark must stand on land: walk it inland if its peak drowned
      for (let k = 0; k < 40 && fAt(pk.x, pk.y) < tOf(0) + 0.02; k++) { pk.x += (500 - pk.x) * 0.08; pk.y += (500 - pk.y) * 0.08; }
    }
    if (boostPeaks.length >= 2) {
      const order = [boostPeaks[0]];
      const rest = boostPeaks.slice(1);
      while (rest.length) { // nearest-neighbour walk from the biggest boosted peak
        const last = order[order.length - 1];
        let bi2 = 0;
        for (let k = 1; k < rest.length; k++) if (Math.hypot(rest[k].x - last.x, rest[k].y - last.y) < Math.hypot(rest[bi2].x - last.x, rest[bi2].y - last.y)) bi2 = k;
        order.push(rest.splice(bi2, 1)[0]);
      }
      const dash = [];
      for (let k = 0; k < order.length - 1; k++) {
        const a = order[k], b = order[k + 1];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const n = Math.max(1, Math.floor(len / 14));
        for (let q = 0; q < n; q += 1) {
          if (q % 2) continue;
          const t0 = q / n, t1 = Math.min(1, (q + 1) / n);
          // slight bend so the route reads as a trail, not a ruler line
          const bend = (t) => Math.sin(t * Math.PI) * 18 * (k % 2 ? 1 : -1);
          const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
          dash.push(a.x + (b.x - a.x) * t0 + nx * bend(t0), a.y + (b.y - a.y) * t0 + ny * bend(t0),
            a.x + (b.x - a.x) * t1 + nx * bend(t1), a.y + (b.y - a.y) * t1 + ny * bend(t1));
        }
      }
      shapes.push({ t: 'segs', pts: dash, stroke: RED_FIRE, sw: 2.2, a: 0.85, seq: K + 1 });
    }
    const landmarks = [];
    for (const pk of boostPeaks) {
      shapes.push(...landmarkShapes(pk.pidx, pk.x, pk.y, pk.color, ink, season.bg, K + 1));
      landmarks.push(`${LANDMARKS[pk.pidx % LANDMARKS.length]} (${pk.name})`);
    }

    const light = COMPASS[Math.round(((lightA + Math.PI) % (Math.PI * 2)) / (Math.PI / 4)) % 8];
    return {
      style: 'contour', w: W, h: W, bg: season.bg, ink,
      steps: K + 2, enter: 'fade',
      seal: { kind: 'rings' },
      shapes,
      traits: {
        Terrain: terrainFor(total), Collections: held.length, NFTs: total,
        'Tallest peak': peaks[0].name, Peaks: peaks.length,
        Landmarks: landmarks.length, Expedition: expeditionFor(landmarks.length),
        Route: boostPeaks.length >= 2 ? `${boostPeaks.length}-stop trail` : 'Unmapped',
        Light: light, Season: season.name,
      },
      peaks: peaks.map((pk) => ({ name: pk.name, color: pk.color, n: pk.n, i: pk.i, boost: pk.boost, landmark: pk.boost ? LANDMARKS[pk.pidx % LANDMARKS.length] : null })),
      landmarks,
      // p.withField (the prints only): the terrain itself, its heights 0..1 on a (G+1)² grid over the map's drawn area (M..W-M), the peak that
      // owns every cell and where the peaks stand. Left out otherwise, so the drop's pieces and metadata are untouched.
      ...(p.withField ? { field: { G, M, W, f: Array.from(f), owner: Array.from(owner), peaks: peaks.map((pk) => ({ x: pk.x, y: pk.y, h: pk.h, color: pk.color, name: pk.name })) } } : {}),
    };
  }

  const n2 = (n) => Math.round(n * 100) / 100;
  function toSVG(piece) {
    const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${piece.w} ${piece.h}" width="${piece.w}" height="${piece.h}">`,
      `<rect width="${piece.w}" height="${piece.h}" fill="${piece.bg}"/>`];
    for (const s of piece.shapes) {
      const op = s.a != null ? (s.t === 'segs' ? ` stroke-opacity="${s.a}"` : ` fill-opacity="${n2(s.a)}"`) : '';
      if (s.t === 'rect') out.push(`<rect x="${n2(s.x)}" y="${n2(s.y)}" width="${n2(s.w)}" height="${n2(s.h)}" fill="${s.fill}"${op}/>`);
      else if (s.t === 'circ') out.push(`<circle cx="${n2(s.x)}" cy="${n2(s.y)}" r="${n2(s.r)}" fill="${s.fill}"${op}/>`);
      else if (s.t === 'poly') out.push(`<polygon points="${s.pts.map(n2).join(' ')}" fill="${s.fill}"${op}/>`);
      else if (s.t === 'segs') {
        let d = '';
        for (let i = 0; i < s.pts.length; i += 4) d += `M${n2(s.pts[i])} ${n2(s.pts[i + 1])}L${n2(s.pts[i + 2])} ${n2(s.pts[i + 3])}`;
        out.push(`<path d="${d}" fill="none" stroke="${s.stroke}" stroke-width="${s.sw}" stroke-linecap="round"${op}/>`);
      }
    }
    out.push('</svg>');
    return out.join('');
  }

  root.StrataArt = { generate, toSVG, rngFrom, colorFor, terrainFor, LANDMARKS };
})(typeof globalThis !== 'undefined' ? globalThis : window);
