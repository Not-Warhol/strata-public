/* STRATA. Print — "Lines" (working name). Ported from the owner's p5 sketch: one to three blocks of close lines on a pale sheet, each
 * line a row of dots of changing weight (random or following a noise field), the blocks shifted and sometimes overlapping, and a fine
 * grain over the sheet inside a 5% margin.
 * The wallet draws it. Every block is one protocol the wallet talks to (the contracts it calls most, up to four), in the ink that
 * protocol always has. The protocol's address also sets the block's direction (vertical or horizontal lines) and how its dots run
 * (random or along the noise), so a protocol looks the same in every wallet. Every line is one transaction to it, in time order, and the
 * gap to the next line grows with the time between them: bursts pack the lines, quiet months open gaps, and the block is as long as
 * that history (squeezed only when it would not fit). The block's other side follows the protocol's share of the calls. A failed
 * transaction draws its line red. Blocks overlap in multiply, so their inks darken each other. The grain grows with the wallet's age.
 * Where the blocks sit comes from the wallet's origin. Same transactions, origin and variant, same picture.
 * Each line is one filled shape (its dots joined, every dot keeping its own weight), so the sheet stays light. Pure SVG.
 * Exposes globalThis.StrataPrintLines. */
(function (root) {
  const W = 1000, H = 1414, M = 70, PX = 1.1;                 // M: the blocks keep this far from the top and the bottom band                         // PX: one pixel of the sketch's canvas (about 900 px across)
  const INKS = ['#080808', '#101010', '#181818', '#060630', '#300606'], FAILED = '#E84142', RED = '#E84142', PAPER = '#F0F0F0';

  function fnv(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(s) { let a = fnv(String(s)); return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const f1 = (v) => Math.round(v * 10) / 10;
  /** Smooth value noise in 0..1 (stands in for p5's noise()). */
  function noise2(seed) {
    const h = (x, y) => (fnv(seed + ':' + x + ',' + y) % 10000) / 10000, s = (t) => t * t * (3 - 2 * t);
    return (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = s(x - xi), yf = s(y - yi);
      const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
      return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf; };
  }

  /** The protocols of a wallet: contract calls grouped by the address they went to, most used first: [{ a, txs }]. */
  function protocols(txs) {
    const by = new Map();
    for (const t of txs) if ((t.c === 'call' || t.c === 'pay') && t.a) { if (!by.has(t.a)) by.set(t.a, []); by.get(t.a).push(t); }
    return [...by].map(([a, list]) => ({ a, txs: list })).sort((x, y) => y.txs.length - x.txs.length || (x.a < y.a ? -1 : 1));
  }

  /** opts: { seed, variant?, txs: [{ h, t?, f?, c?, a? }] oldest first, origin?, blocks? (1..4, default: one per protocol, up to 4),
   *  foot? (the lines stop this far above the bottom, to leave the band for the hash and the stamp; default 0 = to the edge),
   *  map? ({ id, segs: [{ pts: [x1, y1, x2, y2, …], sw }] }: the holder's Contour (Drop 001) the print is made from, its contour lines in
   *  the map's own 1000 × 1000 space; it fills most of the sheet in the same dotted lines, under the protocols' blocks) } */
  function generate(opts) {
    const txs = opts.txs || [], v = opts.variant ? ':v' + opts.variant : '', sk = String(opts.seed).toLowerCase();
    const wr = rng('strata-lines:' + (opts.origin || sk) + v), foot = opts.foot || 0, bottom = H - foot;
    let ps = protocols(txs);
    if (!ps.length) ps = [{ a: 'transfers:' + sk, txs: txs.length ? txs : [{ h: sk }] }];          // no contract calls: the wallet's own transfers make one block
    const num = Math.max(1, Math.min(4, opts.blocks || ps.length)); ps = ps.slice(0, num);
    const calls = ps.reduce((n, p) => n + p.txs.length, 0), map = opts.map || null;
    // every protocol's block gets its own band of the sheet's height, in an order that comes from the wallet
    const items = ps.map((p) => ({ p })).map((x) => [wr(), x]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    const slot = (bottom - 2 * M) / items.length, slotOf = (x) => items.indexOf(x);
    // the grain, as the sketch's iFrac: the older the wallet, the more grain, like a patina
    const timed = txs.filter((t) => t.t), years = timed.length > 1 ? (timed[timed.length - 1].t - timed[0].t) / 31557600 : 0;
    const grain = 0.08 + Math.min(0.17, years * 0.05);   // 0.08 for a new wallet, 0.25 at 3½ years and over (the sketch uses 0.2)
    const taken = new Set();
    const inkOf = (a) => { let k = fnv('strata-lines:ink:' + a) % INKS.length; while (taken.has(k) && taken.size < INKS.length) k = (k + 1) % INKS.length; taken.add(k); return INKS[k]; };   // a protocol keeps its ink in every wallet

    let out = '';
    items.filter((x) => x.p).forEach((it) => {
      const p = it.p, i = slotOf(it);
      const pr = rng('strata-lines:protocol:' + p.a), share = p.txs.length / calls;
      const vertical = pr() < 0.5, noisy = pr() < 0.5, nz = noise2('strata-lines:noise:' + p.a), ink = inkOf(p.a);
      // the rhythm: one line per transaction, in time order; the gap to the next line grows with the time between them,
      // so a burst of activity packs the lines and a quiet month opens a gap. The block is as long as its history.
      const gaps = p.txs.map((t, k) => { const nx = p.txs[k + 1]; const dt = nx && t.t && nx.t ? Math.max(0, nx.t - t.t) : 3600 * (1 + pr() * 24);
        return (0.5 + 5.5 * Math.min(1, Math.log1p(dt / 3600) / Math.log1p(24 * 60))) * PX; });
      const maxAcross = vertical ? W * 0.9 : (bottom - 2 * M) * 0.16, total = gaps.reduce((a, b) => a + b, 0), squeeze = Math.min(1, maxAcross / total);
      const across = total * squeeze, along = vertical ? (bottom - 2 * M) * (0.04 + 0.14 * share) : W * (0.45 + 0.45 * Math.sqrt(share));   // thin bands, as in the sketch
      const bw = vertical ? across : along, bh = vertical ? along : across;
      // where it sits: its own band of the sheet's height (with some play, so blocks may overlap), and left or right of the middle;
      // a block may run off the side of the sheet, never off the top or into the bottom band
      const cy = M + slot * (i + 0.5) + (wr() - 0.5) * slot * 0.9;
      const x0 = Math.min(W - bw * 0.6, Math.max(-bw * 0.4, (W - bw) / 2 + (wr() - 0.5) * W * 0.5)), y0 = Math.min(bottom - M - bh, Math.max(M, cy - bh / 2));
      let shapes = '', red = '', c = (vertical ? x0 : y0) + (pr() * 2 - 1) * PX;
      const a0 = vertical ? y0 : x0, a1 = a0 + (vertical ? bh : bw);
      p.txs.forEach((t, k) => {
        const lr = rng('strata-lines:line:' + t.h + v), left = [], right = [];
        for (let u = a0 + (lr() * 2 - 1) * PX; u < a1;) {                                           // the dots of one line, each its own weight
          const sw = noisy ? (0.5 + 0.4 * (vertical ? nz(c / W * 20, u / H * 4) : nz(u / W * 4, c / H * 20))) * 3 * PX : (0.5 + lr() * 2) * PX;
          if (vertical) { left.push(`${f1(c - sw / 2)} ${f1(u)}`); right.push(`${f1(c + sw / 2)} ${f1(u)}`); }
          else { left.push(`${f1(u)} ${f1(c - sw / 2)}`); right.push(`${f1(u)} ${f1(c + sw / 2)}`); }
          u += sw;
        }
        if (left.length > 1) { const d = `M${left.join('L')}L${right.reverse().join('L')}Z`; if (t.f) red += d; else shapes += d; }
        c += gaps[k] * squeeze;
      });
      out += `<g style="mix-blend-mode:multiply"><path d="${shapes}" fill="${ink}"/>` + (red ? `<path d="${red}" fill="${FAILED}"/>` : '') + '</g>';   // where blocks overlap, the inks darken each other
    });

    // ---- the holder's Contour, large, under the blocks: its contour lines as rows of dots of changing weight (a dot at every step of a
    // line; the index contours, thicker on the map, get heavier dots), in the ink its token always has
    if (map) {
      const mr = rng('strata-lines:contour:' + map.id + v), ink = opts.contourInk || RED;   // the Contour always in STRATA.'s red, the triangle's
      const side = Math.min(W * 1.08, bottom - 2 * M), x0 = (W - side) / 2 + (mr() - 0.5) * W * 0.06, y0 = M + (bottom - 2 * M - side) * (0.35 + mr() * 0.3);   // the mountain fills the sheet's width (its own margin keeps it in), near the middle
      const k = side / 808, by = new Map();                                                       // the map's drawn area is 96..904 of its 1000
      for (const sg of map.segs) for (let q = 0; q < sg.pts.length; q += 2) {                    // every point of the line: the mountain reads strong under the blocks
        const d = Math.round((2 + mr() * 3) * Math.pow(sg.sw / 1.5, 0.6) * PX * 4) / 4;    // the dot's weight, in quarter steps so the dots share a few paths
        const x = x0 + (sg.pts[q] - 96) * k, y = y0 + (sg.pts[q + 1] - 96) * k;
        if (!by.has(d)) by.set(d, ''); by.set(d, by.get(d) + `M${f1(x)} ${f1(y)}h0`);
      }
      out = `<g fill="none" stroke="${ink}" stroke-linecap="round">${[...by].map(([d, path]) => `<path d="${path}" stroke-width="${d}"/>`).join('')}</g>` + out;   // drawn first: the blocks lie over the map in multiply
    }

    const gs = Math.floor(wr() * 1000), gk = 4.5 * grain, mar = Math.min(W, H) * 0.05;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`
      + `<rect width="${W}" height="${H}" fill="${PAPER}"/>`
      + `<defs><clipPath id="ln-room"><rect x="-200" y="-200" width="${W + 400}" height="${H - foot + 200}"/></clipPath>`
      + `<filter id="ln-grain" x="${f1(mar)}" y="${f1(mar)}" width="${f1(W - 2 * mar)}" height="${f1(H - 2 * mar - foot)}" filterUnits="userSpaceOnUse"><feTurbulence type="fractalNoise" baseFrequency="3.2" numOctaves="1" seed="${gs}" result="n"/>`
      + `<feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  ${f1(gk)} 0 0 0 ${f1(-gk / 2)}" result="light"/>`
      + `<feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${f1(-gk)} 0 0 0 ${f1(gk / 2)}" result="dark"/>`
      + `<feMerge><feMergeNode in="light"/><feMergeNode in="dark"/></feMerge></filter></defs>`
      + `<g clip-path="url(#ln-room)">${out}</g>`
      + `<rect x="${f1(mar)}" y="${f1(mar)}" width="${f1(W - 2 * mar)}" height="${f1(H - 2 * mar - foot)}" filter="url(#ln-grain)"/>`   // the grain, inside the margin (the sketch's shader)
      + '</svg>';
  }

  /** A Contour (Drop 001) piece, as StrataArt.generate returns it, as the `map` of a print: its contour lines, benchmarks and route, not its frame. */
  const mapFrom = (piece, id) => ({ id, segs: piece.shapes.filter((x) => x.t === 'segs' && x.seq > 0).map((x) => ({ pts: x.pts, sw: x.sw })) });

  root.StrataPrintLines = { generate, protocols, mapFrom, W, H };
})(typeof globalThis !== 'undefined' ? globalThis : this);
