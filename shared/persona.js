/* STRATA. Drop 002 — Persona. A mask that grows with a wallet.
 * One unique mask per token (2,780 possible, enumerated once so no two ids are alike). At the mint the mask is
 * divided by the builder wallet's PAST (one lot per past transaction: the treemap when the wallet has more
 * transactions than the mask has pixels, grown pixel regions otherwise). Every transaction AFTER the mint (or
 * after a redraw) raises one building on the next lot, in a seeded order; once every lot is built, the biggest
 * built lots split and the mask gets finer. The first 10 buildings are green, then the piece is kept at 60% green /
 * 40% white; a failed transaction is a red, blinking building. Roof symbol + level of tint = the protocol (its
 * contract address), the same in every wallet.
 * buildScene() is pure (no network): the server feeds it transactions and serves the scene; the browser and the
 * SVG renderer only draw scenes, so every view of a piece is the same picture.
 * Exposes globalThis.StrataPersona. */
(function (root) {
  const GREEN_SHARE = 0.6, FIRST_GREEN = 10, N = 40, MASKS_SEED = 'strata:persona:masks';
  const NEON = ['#FF3B30', '#FF9F1C', '#FFD60A', '#B5E61D', '#30D158', '#06D6A0', '#00C7BE', '#00B4D8', '#3A86FF', '#5E5CE6', '#8338EC', '#BF5AF2', '#FF5FA2', '#FF2D55', '#F4A261', '#90E0EF'];
  const NEUTRAL = { transfer: { col: '#C8CCD2', shape: 10 }, incoming: { col: '#8A919C', shape: 11 }, deploy: { col: '#EDEDE9', shape: 12 } };
  const PROTO_SHAPES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26];
  const TINT = { white: [255, 255, 255], green: [57, 255, 20], red: [255, 59, 48] };

  function fnv(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(s) { let a = fnv(s); return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  // Protocol style: constant for a contract address in every wallet.
  function styleFor(group) {
    if (NEUTRAL[group]) return NEUTRAL[group];
    return { col: NEON[fnv(group) % NEON.length], shape: PROTO_SHAPES[fnv(group + '#shape') % PROTO_SHAPES.length] };
  }
  // In the monochrome piece every protocol keeps its own level of the tint (from its colour's luminance).
  function level(hex) { const n = parseInt(hex.slice(1), 16); return 0.72 + 0.28 * (0.3 * (n >> 16 & 255) + 0.59 * (n >> 8 & 255) + 0.11 * (n & 255)) / 255; }
  const rgb = (tint, k) => { const c = TINT[tint]; return `rgb(${Math.round(c[0] * k)},${Math.round(c[1] * k)},${Math.round(c[2] * k)})`; };

  // ---------- masks: every combination of features, deduplicated, in a fixed shuffled order ----------
  const HEADS = ['Round', 'Oval', 'Square', 'Shield', 'Skull', 'Helmet', 'Diamond'];
  const EYES = ['Dots', 'Wide', 'Tall', 'Big', 'Visor', 'Cyclops'];
  const MOUTHS = ['Line', 'Smile', 'Grill', 'O', 'None'];
  function grid(p) {
    const W = 13, H = 13, C = 6, g = Array.from({ length: H }, () => Array(W).fill(0));
    const inHead = (u, v) => {
      switch (p.head) {
        case 'Round': return u * u + v * v <= 1.02;
        case 'Oval': return u * u / 0.62 + v * v <= 1.02;
        case 'Square': return Math.abs(u) <= 0.86 && Math.abs(v) <= 0.92 && Math.abs(u) + Math.abs(v) <= 1.6;
        case 'Shield': return v >= -0.92 && v <= 0.95 && Math.abs(u) <= 0.88 - Math.max(0, v - 0.1) * 0.95;
        case 'Skull': return (v < 0.25 && u * u + (v + 0.05) * (v + 0.05) <= 0.95) || (v >= 0.25 && v <= 0.95 && Math.abs(u) <= 0.55);
        case 'Helmet': return v <= 0.95 && Math.abs(u) <= 0.9 && (v >= -0.2 || u * u + (v + 0.2) * (v + 0.2) <= 0.82);
        default: return Math.abs(u) / 0.95 + Math.abs(v) <= 1.02;
      }
    };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inHead((x - C) / 6, (y - C) / 6)) g[y][x] = 1;
    const hole = (x, y) => { if (y >= 0 && y < H && x >= 0 && x < W) { g[y][x] = 0; g[y][W - 1 - x] = 0; } };
    const ey = p.ey, ex = p.ex;
    if (p.eyes === 'Dots') hole(ex, ey);
    else if (p.eyes === 'Wide') { hole(ex, ey); hole(ex - 1, ey); }
    else if (p.eyes === 'Tall') { hole(ex, ey); hole(ex, ey + 1); }
    else if (p.eyes === 'Big') { hole(ex, ey); hole(ex - 1, ey); hole(ex, ey + 1); hole(ex - 1, ey + 1); }
    else if (p.eyes === 'Visor') { for (let x = 2; x <= C; x++) hole(x, ey); }
    else { hole(C, ey); hole(C - 1, ey); hole(C, ey + 1); hole(C - 1, ey + 1); }
    if (p.brow && p.eyes !== 'Visor') for (let x = ex - 1; x <= ex + 1; x++) hole(x, ey - 2);
    if (p.nose) hole(C, ey + 2);
    const my = Math.min(H - 3, ey + 4);
    if (p.mouth === 'Line') for (let x = C - 2; x <= C; x++) hole(x, my);
    else if (p.mouth === 'Smile') { hole(C - 3, my - 1); for (let x = C - 2; x <= C; x++) hole(x, my); }
    else if (p.mouth === 'Grill') { for (let x = C - 3; x <= C; x++) if ((C - x) % 2 === 0) { hole(x, my); hole(x, my + 1); } }
    else if (p.mouth === 'O') { hole(C, my); hole(C - 1, my); hole(C, my + 1); hole(C - 1, my + 1); }
    return g;
  }
  let MASKS = null;
  function masks() {
    if (MASKS) return MASKS;
    const seen = new Map();
    for (const head of HEADS) for (const eyes of EYES) for (const ey of [4, 5]) for (const ex of [4, 3]) for (const brow of [false, true]) for (const nose of [false, true]) for (const mouth of MOUTHS) {
      const p = { head, eyes, ey, ex, brow: brow && eyes !== 'Visor', nose, mouth }, g = grid(p), key = g.map((r) => r.join('')).join('');
      if (!seen.has(key)) seen.set(key, { ...p, g });
    }
    const list = [...seen.values()], R = rng(MASKS_SEED);
    for (let q = list.length - 1; q > 0; q--) { const r = Math.floor(R() * (q + 1)); [list[q], list[r]] = [list[r], list[q]]; }
    return (MASKS = list);
  }
  const maskCount = () => masks().length;
  function mask(id) {
    const m = masks()[id];
    if (!m) throw new Error('No such mask: ' + id);
    const g = m.g, W = 13, H = 13, cs = N / W, rects = [], edges = [];
    for (let y = 0; y < H; y++) { let x = 0; while (x < W) { if (!g[y][x]) { x++; continue; } let x2 = x; while (x2 < W && g[y][x2]) x2++; rects.push([x * cs, y * cs, (x2 - x) * cs, cs]); x = x2; } }
    const on = (x, y) => x >= 0 && y >= 0 && x < W && y < H && g[y][x] === 1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!on(x, y)) continue;
      if (!on(x, y - 1)) edges.push([x, y, x + 1, y]);
      if (!on(x, y + 1)) edges.push([x, y + 1, x + 1, y + 1]);
      if (!on(x - 1, y)) edges.push([x, y, x, y + 1]);
      if (!on(x + 1, y)) edges.push([x + 1, y, x + 1, y + 1]);
    }
    const traits = { Head: m.head, Eyes: m.eyes, Brow: m.brow ? 'Yes' : 'No', Nose: m.nose ? 'Yes' : 'No', Mouth: m.mouth };
    return { id, g, cs, rects, edges: edges.map((e) => e.map((v) => v * cs)), traits };
  }

  // ---------- transactions ----------
  // Routescan/Etherscan txlist rows of one wallet → { t (ms), value (AVAX), fee (AVAX), failed, group }.
  function interpret(address, rows) {
    const me = address.toLowerCase();
    return rows.map((r) => {
      const from = (r.from || '').toLowerCase(), to = (r.to || '').toLowerCase();
      let group;
      if (from === me && !to) group = 'deploy';
      else if (from === me && r.input && r.input !== '0x') group = to;
      else if (from === me) group = 'transfer';
      else group = 'incoming';
      return { t: Number(r.timeStamp) * 1000, value: Number(r.value) / 1e18, fee: from === me ? Number(r.gasUsed) * Number(r.gasPrice) / 1e18 : 0,
        failed: r.isError === '1' || r.txreceipt_status === '0', group, block: Number(r.blockNumber), h: r.hash };
    });
  }

  function squarify(list, rx, ry, rw, rh) {
    const worst = (row, side) => { const sum = row.reduce((a, it) => a + it.a2, 0); let mx = 0, mn = Infinity; for (const it of row) { mx = Math.max(mx, it.a2); mn = Math.min(mn, it.a2); } return Math.max(side * side * mx / (sum * sum), (sum * sum) / (side * side * mn)); };
    let i = 0;
    while (i < list.length) {
      const side = Math.min(rw, rh), row = [list[i++]];
      while (i < list.length && worst([...row, list[i]], side) <= worst(row, side)) row.push(list[i++]);
      const sum = row.reduce((a, it) => a + it.a2, 0);
      if (rw >= rh) { const w = sum / rh; let y = ry; for (const it of row) { const h = it.a2 / w; it.x = rx; it.y = y; it.w = w; it.hh = h; y += h; } rx += w; rw -= w; }
      else { const h = sum / rw; let x = rx; for (const it of row) { const w = it.a2 / h; it.x = x; it.y = ry; it.w = w; it.hh = h; x += w; } ry += h; rh -= h; }
    }
  }

  // The map of the past: one lot per past transaction (same rules as the prototype, notes/drop-002-cidade.html).
  function pastLots(M, past, seed) {
    const g = M.g, W = 13, H = 13, cs = M.cs;
    const on = []; g.forEach((row, y) => row.forEach((v, x) => { if (v) on.push([x, y]); }));
    const R2 = rng(seed + '|lots');
    const n = Math.max(1, past.length);
    if (n > on.length) {
      // treemap: area from value, positions shuffled, spread over the mask's pixel runs
      let items = past;
      if (past.length > 2500) {
        const m = new Map();
        for (const t of past) { const k = t.group + '|' + Math.floor(t.t / 86400000); const e = m.get(k); if (e) e.value += t.value; else m.set(k, { ...t }); }
        items = [...m.values()].sort((a, b) => a.t - b.t);
      }
      const R = rng(seed);
      items = items.map((t) => { const s = 1 + Math.min(5, Math.log10(1 + t.value) * 1.5); return { wt: s * s }; });
      const plots = items.slice();
      for (let q = plots.length - 1; q > 0; q--) { const r = Math.floor(R() * (q + 1)); [plots[q], plots[r]] = [plots[r], plots[q]]; }
      const area = M.rects.reduce((a, r) => a + r[2] * r[3], 0), nR = M.rects.length;
      const exact = M.rects.map((r) => r[2] * r[3] / area * plots.length);
      const cnt = exact.map((x) => Math.max(1, Math.floor(x)));
      let tot = cnt.reduce((a, b) => a + b, 0);
      const byRem = exact.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]);
      for (let q = 0; tot < plots.length; q++, tot++) cnt[byRem[q % nR][1]]++;
      while (tot > plots.length) { const m = cnt.indexOf(Math.max(...cnt)); cnt[m]--; tot--; }
      let i = 0; const lots = [];
      M.rects.forEach((r, ri) => {
        const list = plots.slice(i, i + cnt[ri]); i += cnt[ri];
        if (!list.length) return;
        const la = list.reduce((a, it) => a + it.wt, 0);
        list.forEach((it) => { it.a2 = it.wt / la * r[2] * r[3]; });
        squarify(list, r[0], r[1], r[2], r[3]);
        for (const it of list) lots.push({ rect: [it.x, it.y, it.w, it.hh] });
      });
      return lots;
    }
    // fewer transactions than pixels: grow that many irregular regions from random seed pixels
    const lab = g.map((r) => r.map(() => -1)), idx = on.map((_, i) => i);
    for (let q = idx.length - 1; q > 0; q--) { const r = Math.floor(R2() * (q + 1)); [idx[q], idx[r]] = [idx[r], idx[q]]; }
    const fr = [];
    for (let k = 0; k < n; k++) { const [x, y] = on[idx[k]]; lab[y][x] = k; fr.push([x, y]); }
    while (fr.length) {
      const i = Math.floor(R2() * fr.length), [x, y] = fr[i]; fr[i] = fr[fr.length - 1]; fr.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (Y < 0 || Y >= H || X < 0 || X >= W || !g[Y][X] || lab[Y][X] >= 0) continue; lab[Y][X] = lab[y][x]; fr.push([X, Y]); }
    }
    for (const [x, y] of on) if (lab[y][x] < 0) { let bd = 1e9; for (const [a, b] of on) if (lab[b][a] >= 0 && Math.abs(a - x) + Math.abs(b - y) < bd) { bd = Math.abs(a - x) + Math.abs(b - y); lab[y][x] = lab[b][a]; } }
    const lots = Array.from({ length: n }, () => ({ cells: [] }));
    for (const [x, y] of on) lots[lab[y][x]].cells.push([x, y]);
    return lots.filter((l) => l.cells.length);
  }

  /**
   * The whole piece as drawable data.
   *   maskId: 0..maskCount()-1 · seed: string (builder address + token) · past/after: interpret()ed transactions
   * Returns { N, maskId, traits, rects, edges, segs (lot outlines), items (buildings in build order), lots, built }.
   */
  function buildScene({ maskId, seed, past, after }) {
    const M = mask(maskId), cs = M.cs;
    const lots = pastLots(M, past, seed);
    const R2 = rng(seed + '|order');
    const order = lots.map((_, i) => i);
    for (let q = order.length - 1; q > 0; q--) { const r = Math.floor(R2() * (q + 1)); [order[q], order[r]] = [order[r], order[q]]; }
    const nLots = lots.length;
    const pieces = (lot) => {
      if (lot.rect) return [lot.rect];
      const out = [], rows = {};
      for (const [x, y] of lot.cells) (rows[y] = rows[y] || []).push(x);
      for (const y in rows) { const xs = rows[y].sort((a, b) => a - b); let a = xs[0], p = xs[0]; for (const x of xs.slice(1).concat([1e9])) { if (x === p + 1) { p = x; continue; } out.push([a * cs, y * cs, (p - a + 1) * cs, cs]); a = p = x; } }
      return out;
    };
    const area = (lot) => pieces(lot).reduce((a, r) => a + r[2] * r[3], 0);
    // colour of every post-mint transaction: the first 10 green, then exactly 60/40 as the total grows
    let greens = 0;
    const txs = after.map((tx, i) => { const g = i < FIRST_GREEN || Math.round(GREEN_SHARE * (i + 1)) > greens; if (g) greens++; return { ...tx, i, green: g }; });
    const built = [];
    txs.slice(0, nLots).forEach((tx, k) => { lots[order[k]].tx = tx; built.push(lots[order[k]]); });
    const R3 = rng(seed + '|overflow');
    for (const tx of txs.slice(nLots)) {
      let best = null, bs = -1;
      for (const l of built) { const sc = area(l) * (0.7 + 0.3 * R3()); if (sc > bs) { bs = sc; best = l; } }
      if (!best) break;
      const f = 0.35 + 0.3 * R3();
      let nl;
      if (best.cells && best.cells.length > 1) {
        const xs = best.cells.map((c) => c[0]), ys = best.cells.map((c) => c[1]);
        const ax = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys) ? 0 : 1;
        const sorted = best.cells.slice().sort((a, b) => a[ax] - b[ax] || a[1 - ax] - b[1 - ax]);
        const cut = Math.min(sorted.length - 1, Math.max(1, Math.round(sorted.length * f)));
        best.cells = sorted.slice(0, cut); nl = { cells: sorted.slice(cut), tx };
      } else {
        if (best.cells) { const [x, y] = best.cells[0]; best.rect = [x * cs, y * cs, cs, cs]; delete best.cells; }
        const [x, y, w, h] = best.rect;
        if (w >= h) { best.rect = [x, y, w * f, h]; nl = { rect: [x + w * f, y, w * (1 - f), h], tx }; }
        else { best.rect = [x, y, w, h * f]; nl = { rect: [x, y + h * f, w, h * (1 - f)], tx }; }
      }
      lots.push(nl); built.push(nl);
    }
    const r2 = (v) => Math.round(v * 1000) / 1000;
    const heightFor = (p, tx) => 0.5 + 0.35 * Math.sqrt(Math.min(p[2], p[3], N / 13)) * 2 + 0.9 * Math.log10(1 + tx.fee * 1000);
    const items = [];
    for (const l of built) {
      const tx = l.tx, sty = styleFor(tx.group), ps = pieces(l);
      const big = ps.reduce((m, p, j) => p[2] * p[3] > ps[m][2] * ps[m][3] ? j : m, 0), h = heightFor(ps[big], tx), ph = (fnv(String(tx.t) + tx.i) % 628) / 100;
      ps.forEach((p, j) => items.push({ x: r2(p[0]), y: r2(p[1]), w: r2(p[2]), hh: r2(p[3]), h: r2(h), i: tx.i, tint: tx.failed ? 'red' : tx.green ? 'green' : 'white',
        lv: r2(level(sty.col)), shape: j === big ? sty.shape : -1, part: ps.length > 1 ? 1 : 0, ax: r2(ps[big][0]), ay: r2(ps[big][1]), ph: r2(ph) }));
    }
    items.sort((a, b) => a.i - b.i);
    const segs = [];
    for (const l of lots) {
      if (l.rect) { const [x, y, w, h] = l.rect.map(r2); segs.push([x, y, r2(x + w), y], [r2(x + w), y, r2(x + w), r2(y + h)], [r2(x + w), r2(y + h), x, r2(y + h)], [x, r2(y + h), x, y]); continue; }
      const mine = new Set(l.cells.map((c) => c[0] + ',' + c[1]));
      for (const [x, y] of l.cells) {
        const X = r2(x * cs), Y = r2(y * cs), X1 = r2((x + 1) * cs), Y1 = r2((y + 1) * cs);
        if (!mine.has(x + ',' + (y - 1))) segs.push([X, Y, X1, Y]);
        if (!mine.has(x + ',' + (y + 1))) segs.push([X, Y1, X1, Y1]);
        if (!mine.has((x - 1) + ',' + y)) segs.push([X, Y, X, Y1]);
        if (!mine.has((x + 1) + ',' + y)) segs.push([X1, Y, X1, Y1]);
      }
    }
    const fails = txs.filter((t) => t.failed).length;
    const traits = { ...M.traits, Lots: nLots, Buildings: built.length, Green: Math.round(greens), Failed: fails };
    return { N, maskId, traits, rects: M.rects.map((r) => r.map(r2)), edges: M.edges.map((e) => e.map(r2)), segs, items, lots: nLots, built: built.length };
  }

  // ---------- drawing ----------
  // Roof symbols as polygons (unit square centred on 0,0, size 1), so canvas and SVG draw the same shapes.
  const SHAPES = {};
  function shapePolys(k) {
    if (SHAPES[k]) return SHAPES[k];
    const polys = [], P = (pts) => polys.push(pts);
    const circle = (cx, cy, r, a0 = 0, a1 = Math.PI * 2, rev = false, n = 28) => { const pts = []; for (let i = 0; i <= n; i++) { const a = rev ? a1 - (a1 - a0) * i / n : a0 + (a1 - a0) * i / n; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } return pts; };
    const star = (n, r0, r1, a0) => { const pts = []; for (let i = 0; i < n * 2; i++) { const a = a0 + i * Math.PI / n, r = i % 2 ? r1 : r0; pts.push([r * Math.cos(a), r * Math.sin(a)]); } return pts; };
    const ngon = (n, r, a0, dy = 0) => Array.from({ length: n }, (_, i) => { const a = a0 + i * 2 * Math.PI / n; return [r * Math.cos(a), r * Math.sin(a) + dy]; });
    const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    switch (k) {
      case 0: P(circle(0, 0, .32)); break;
      case 1: P([[-.36, .36], ...circle(-.36, .36, .72, -Math.PI / 2, 0)]); break;
      case 2: P([[-.34, .34], [-.34, 0], ...circle(0, 0, .34, Math.PI, 2 * Math.PI), [.34, .34]]); P([[-.15, .34], [-.15, .08], ...circle(0, .08, .15, Math.PI, 2 * Math.PI), [.15, .34]]); break;
      case 3: P([[0, -.36], [.4, .3], [-.4, .3]]); break;
      case 4: P(circle(0, 0, .34)); P(circle(0, 0, .18)); break;
      case 5: P([[0, -.38], [.3, 0], [0, .38], [-.3, 0]]); break;
      case 6: for (const oy of [-.12, .14]) { const pts = []; for (let i = 0; i <= 24; i++) { const x = -.38 + .76 * i / 24; pts.push([x, oy + .07 * Math.sin(x * 14)]); } for (let i = 24; i >= 0; i--) { const x = -.38 + .76 * i / 24; pts.push([x, oy + .11 + .07 * Math.sin(x * 14)]); } P(pts); } break;
      case 7: P(star(4, .38, .1, -Math.PI / 2)); break;
      case 8: { const c = Math.SQRT1_2, rot = (pts) => pts.map(([x, y]) => [x * c - y * c, x * c + y * c]); P(rot(rect(-.4, -.07, .8, .14))); P(rot(rect(-.07, -.4, .14, .8))); break; }
      case 10: P([[0, -.38], [.3, -.05], [.1, -.05], [.1, .36], [-.1, .36], [-.1, -.05], [-.3, -.05]]); break;
      case 11: P([[0, .38], [.3, .05], [.1, .05], [.1, -.36], [-.1, -.36], [-.1, .05], [-.3, .05]]); break;
      case 12: P(rect(-.34, -.34, .68, .68)); P(rect(-.2, -.2, .4, .4)); P(rect(-.08, -.08, .16, .16)); break;
      case 13: P(ngon(6, .37, Math.PI / 6)); break;
      case 14: P(ngon(8, .37, Math.PI / 8)); P(ngon(8, .2, Math.PI / 8)); break;
      case 15: P(circle(0, 0, .36)); P(circle(0, 0, .24)); P(circle(0, 0, .1)); break;
      case 16: P([[-.3, -.36], [.3, -.36], [0, 0]]); P([[-.3, .36], [.3, .36], [0, 0]]); break;
      case 17: P([[.08, -.4], [-.24, .05], [-.02, .05], [-.1, .4], [.24, -.08], [.02, -.08]]); break;
      case 18: for (const oy of [-.2, .06]) P([[-.34, oy + .14], [0, oy - .08], [.34, oy + .14], [.34, oy + .28], [0, oy + .06], [-.34, oy + .28]]); break;
      case 19: P(star(5, .38, .16, -Math.PI / 2)); break;
      case 20: P(circle(0, 0, .36)); P(circle(.12, -.1, .3)); break;
      case 21: P(ngon(5, .38, -Math.PI / 2, .03)); break;
      case 22: for (const x of [-.3, -.06, .18]) P(rect(x, -.36, .12, .72)); break;
      case 23: P(circle(0, 0, .37)); P(rect(-.25, -.06, .5, .12)); P(rect(-.06, -.25, .12, .5)); break;
      case 24: P([[-.4, -.3], [.4, -.3], [0, .36]]); break;
      case 25: P([[-.38, .14], ...circle(0, .14, .38, Math.PI, 2 * Math.PI)]); P(rect(-.38, .22, .76, .1)); break;
      case 26: for (const [dx, dy] of [[-.24, -.24], [.24, -.24], [0, 0], [-.24, .24], [.24, .24]]) P(rect(dx - .08, dy - .08, .16, .16)); break;
      default: { let y = -.36; for (const h of [.1, .15, .07, .12]) { P(rect(-.36, y, .72, h)); y += h + .06; } }
    }
    return (SHAPES[k] = polys);
  }

  // The camera: straight down on the mask, a little perspective, a slow drift of the eye (parallax on the roofs).
  function view(S, t) {
    const c = N / 2, F = N * 2.4, exo = Math.sin(t * 0.21) * N * 0.16, eyo = Math.cos(t * 0.15) * N * 0.12;
    const k = S * 0.8 / N * (1 + 0.03 * Math.sin(t * 0.33)), ox = S / 2, oy = S / 2, ex = c + exo, ey = c + eyo;
    return { k, ex, ey, P: (x, y, z) => { const s = F / (F - z); return [ox + ((x - ex) * s + ex - c) * k, oy + ((y - ey) * s + ey - c) * k]; } };
  }

  /**
   * Everything to draw at time t, as plain shapes (painter's order). Used by the canvas and the SVG renderer.
   *   o.build: seconds since the replay started (null = finished). o.static: no blinking/pulse (for the still image).
   *   o.view: a camera (S, t) → { k, ex, ey, P } in place of the default one (the interactive viewer: zoom, pan, tilt).
   */
  function frame(scene, S, t, o = {}) {
    const { k, ex, ey, P } = (o.view || view)(S, t), out = [];
    const quad = (x0, y0, x1, y1, z) => [P(x0, y0, z), P(x1, y0, z), P(x1, y1, z), P(x0, y1, z)];
    for (const r of scene.rects) out.push({ poly: quad(r[0], r[1], r[0] + r[2], r[1] + r[3], 0), fill: '#040405' });
    out.push({ lines: scene.segs.map(([a, b, c2, d]) => [P(a, b, 0), P(c2, d, 0)]), stroke: '#FFFFFF', width: Math.max(0.6, S * 0.001), alpha: 0.85 });
    out.push({ lines: scene.edges.map(([a, b, c2, d]) => [P(a, b, 0), P(c2, d, 0)]), stroke: '#FFFFFF', width: Math.max(1, S * 0.0035), glow: S * 0.012, alpha: 0.95 });
    const nItems = scene.items.length, BUILD = Math.min(14, 0.8 + nItems * 0.35); // a few buildings rise in a second or two, a crowd over 14 s
    const list = scene.items.map((it) => ({ it, dd: -Math.hypot(it.x + it.w / 2 - ex, it.y + it.hh / 2 - ey) })).sort((a, b) => a.dd - b.dd);
    for (const { it } of list) {
      let up = 1, flash = 0;
      if (o.build != null) {
        const at = nItems > 1 ? (it.i / Math.max(1, scene.items[nItems - 1].i)) * BUILD : 0, since = o.build - at;
        if (since <= 0) continue;
        const pr = Math.min(1, since / 0.5), c1 = 1.70158; up = 1 + (c1 + 1) * Math.pow(pr - 1, 3) + c1 * Math.pow(pr - 1, 2);
        flash = Math.max(0, 1 - since / 0.6);
      }
      const pulse = o.static ? 0.9 : 0.72 + 0.22 * Math.sin(t * 0.8 - (it.ax + it.ay) * 0.18) + 0.06 * Math.sin(t * 1.7 + it.ph);
      const h = it.h * up * pulse, g = it.part ? 0 : Math.min(0.12, it.w * 0.12, it.hh * 0.12);
      const x0 = it.x + g, y0 = it.y + g, x1 = it.x + it.w - g, y1 = it.y + it.hh - g;
      const col = it.tint === 'red' ? rgb('red', 1) : rgb(it.tint, it.lv), alpha = it.tint === 'red' && !o.static && Math.sin(t * 5 + it.ph * 3) <= -0.3 ? 0.3 : 1;
      const b = quad(x0, y0, x1, y1, 0), tp = quad(x0, y0, x1, y1, h), normals = [[0, -1], [1, 0], [0, 1], [-1, 0]];
      for (let i = 0; i < 4; i++) {
        const [nx, ny] = normals[i]; if (nx * (ex - (it.x + it.w / 2)) + ny * (ey - (it.y + it.hh / 2)) <= 0) continue;
        const j = (i + 1) % 4; out.push({ poly: [b[i], b[j], tp[j], tp[i]], fill: i % 2 ? '#060608' : '#0a0a0d', stroke: col, width: 0.8 * S / 600, alpha });
      }
      const roof = it.tint === 'red' ? rgb('red', 0.14) : rgb(it.tint, it.lv * 0.1);
      out.push({ poly: tp, fill: roof, stroke: col, width: 0.9 * S / 600, alpha });
      if (flash > 0) out.push({ poly: tp, fill: `rgba(255,255,255,${0.75 * flash})`, add: true });
      const q = Math.min(x1 - x0, y1 - y0);
      if (it.shape >= 0 && q * k > 2.5) {
        const qx = (x0 + x1) / 2, qy = (y0 + y1) / 2, s = q * 0.9;
        out.push({ polys: shapePolys(it.shape).map((pts) => pts.map(([u, v]) => P(qx + u * s, qy + v * s, h))), fill: col, alpha, evenodd: true });
      }
    }
    return out;
  }

  function drawCanvas(ctx, scene, S, t, o = {}) {
    ctx.save();
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, S, S);
    for (const s of frame(scene, S, t, o)) {
      ctx.globalAlpha = s.alpha ?? 1;
      if (s.add) ctx.globalCompositeOperation = 'lighter';
      if (s.lines) {
        ctx.beginPath(); for (const [a, b] of s.lines) { ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
        ctx.strokeStyle = s.stroke; ctx.lineCap = 'square';
        if (s.glow) { const a = ctx.globalAlpha; ctx.globalAlpha = a * 0.25; ctx.lineWidth = s.width * 3.5; ctx.shadowColor = s.stroke; ctx.shadowBlur = s.glow * 2.5; ctx.stroke(); ctx.globalAlpha = a; ctx.shadowBlur = s.glow; }
        ctx.lineWidth = s.width; ctx.stroke(); ctx.shadowBlur = 0;
      } else if (s.polys) {
        ctx.beginPath(); for (const pts of s.polys) { ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.closePath(); }
        ctx.fillStyle = s.fill; ctx.fill('evenodd');
      } else {
        const p = s.poly; ctx.beginPath(); ctx.moveTo(p[0][0], p[0][1]); for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1]); ctx.closePath();
        if (s.fill) { ctx.fillStyle = s.fill; ctx.fill(); }
        if (s.stroke) { ctx.strokeStyle = s.stroke; ctx.lineWidth = s.width; ctx.stroke(); }
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }

  function toSVG(scene, S = 1200, t = 24) {
    const f = (v) => Math.round(v * 10) / 10, pts = (p) => p.map(([x, y]) => `${f(x)},${f(y)}`).join(' ');
    const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">`,
      `<defs><filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${f(S * 0.012)}"/></filter></defs>`, `<rect width="${S}" height="${S}" fill="#000"/>`];
    for (const s of frame(scene, S, t, { static: true })) {
      const a = s.alpha != null && s.alpha !== 1 ? ` opacity="${s.alpha}"` : '';
      if (s.lines) {
        const d = s.lines.map(([p, q]) => `M${f(p[0])} ${f(p[1])}L${f(q[0])} ${f(q[1])}`).join('');
        if (s.glow) parts.push(`<path d="${d}" stroke="${s.stroke}" stroke-width="${f(s.width * 3.5)}" stroke-linecap="square" fill="none" opacity="0.35" filter="url(#glow)"/>`);
        parts.push(`<path d="${d}" stroke="${s.stroke}" stroke-width="${f(s.width)}" stroke-linecap="square" fill="none"${a}/>`);
      } else if (s.polys) {
        parts.push(`<path d="${s.polys.map((p) => 'M' + pts(p).replace(/ /g, 'L') + 'Z').join('')}" fill="${s.fill}" fill-rule="evenodd"${a}/>`);
      } else if (!s.add) {
        parts.push(`<polygon points="${pts(s.poly)}" fill="${s.fill || 'none'}"${s.stroke ? ` stroke="${s.stroke}" stroke-width="${f(s.width * 1000) / 1000}" stroke-linejoin="round"` : ''}${a}/>`);
      }
    }
    parts.push('</svg>');
    return parts.join('');
  }

  // Simulated wallet (examples on the site only; never a real wallet): past + post-mint transactions.
  function demoTxs(seed, n, from = Date.parse('2021-01-01T00:00:00Z')) {
    const R = rng('demo|' + seed), txs = [], contracts = [];
    const hex = () => '0x' + Array.from({ length: 40 }, () => '0123456789abcdef'[Math.floor(R() * 16)]).join('');
    for (let i = 0; i < 45; i++) contracts.push(hex());
    let t = from;
    for (let i = 0; i < n; i++) {
      t += Math.exp(R() * 3.5) * 3600e3 * (R() < 0.08 ? 40 : 1);
      const r = R(), group = r < 0.14 ? 'transfer' : r < 0.24 ? 'incoming' : r < 0.25 ? 'deploy' : contracts[Math.min(44, Math.floor(Math.pow(R(), 2.2) * 45))];
      txs.push({ t, value: R() < 0.55 ? 0 : Math.exp((R() - 0.4) * 7), fee: Math.exp(Math.log(0.004) + (R() - 0.5) * 2.4), failed: R() < 0.03, group });
    }
    return txs;
  }
  function demoScene(seed, { past = 300, after = 120, maskId } = {}) {
    const id = maskId ?? fnv('mask|' + seed) % maskCount();
    return buildScene({ maskId: id, seed: 'demo|' + seed, past: demoTxs(seed, past), after: demoTxs(seed + '-after', after, Date.parse('2026-10-01T18:00:00Z')) });
  }

  root.StrataPersona = { demoScene, demoTxs, shapePolys, maskCount, mask, interpret, buildScene, drawCanvas, toSVG, frame, styleFor, GREEN_SHARE, FIRST_GREEN };
})(typeof globalThis !== 'undefined' ? globalThis : window);
