/* STRATA. Print — "Mask" (working name). Ported from the owner's p5 sketch: a grid of cells, each scattered with dots of random
 * size (a cell holds vg × vg dots, vg from 1 to 39), shown inverted (white dots on black), and four thick wandering strokes through
 * the middle that show the same dots the right way round (black on white), each stroke with its soft offset shadow.
 * The wallet draws it: every cell is one transaction (oldest first, top left to bottom right; a long history is sampled evenly),
 * its hash sets how many dots the cell holds and where they fall; a failed transaction is a single big dot. The image in the middle
 * (`shape`: the sketch's four strokes, or another) comes from the wallet's origin (the first transaction it appears in). Same transactions, origin and variant, same picture.
 * Pure SVG (dots as circles, the strokes as an SVG mask), so it renders the same in the browser and on the server (resvg).
 * Exposes globalThis.StrataPrintMask. */
(function (root) {
  const W = 1000, H = 1414, M = 84;
  // print-safe colours (no neon: it prints dull): the mono ink picks one of these by the wallet's origin
  const INKS = ['#3A4FD9', '#2D9CDB', '#13886A', '#F2C12E', '#EE7623', '#E2452F', '#C2307A', '#5B3A9E'];   // 'Pigments': painters' tube colours that hold on cotton paper and on black (no neon, it prints dull)

  function fnv(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(s) { let a = fnv(String(s)); return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const f1 = (v) => Math.round(v * 10) / 10;

  /** opts: { seed, variant?, txs: [{ h, f? }] oldest first, origin? (hash of the wallet's first transaction), format? ('sheet' (default): 10 × 14 cells
   *  filling the sheet | 'square': 10 × 10, the sketch's own square), foot? (bottom margin under the picture, default 84; the store uses 110),
   *  shape? (the image in the middle: 'strokes' (the sketch) | 'triangle' | 'journey' | 'rings' | 'origin' | 'blocks' | 'eclipse' | 'persona'),
   *  persona? (13 × 13 grid of 0/1, the holder's Persona mask, for shape 'persona'), clear? ([[x, y, w, h]…] boxes the spill keeps off), ink? ('bw' (default) | 'mono': one colour of the wallet: its dots on black, and black dots on it inside the image), hue? (the mono colour, chosen by the buyer; default: one of INKS from the origin), spill? (true: some dots and a few splashes land outside the picture, never in the bottom band) } */
  /** Where the picture sits on the sheet: { cols, rows, g (cell), X0, Y0, PW, PH }, centred in the room the margins and `foot` leave. */
  function box(opts = {}) {
    const cols = 10, PW = W - 2 * M, g = PW / cols, room = H - (opts.foot ?? 84) - M;
    const rows = opts.format === 'square' ? 10 : Math.floor(room / g), PH = rows * g;
    return { cols, rows, g, X0: M, Y0: M + (room - PH) / 2, PW, PH };
  }

  function generate(opts) {
    const txs = opts.txs || [], v = opts.variant ? ':v' + opts.variant : '', sk = String(opts.seed).toLowerCase();
    const { cols, rows, g, X0, Y0, PW, PH } = box(opts);
    const n = cols * rows, px = g / 90;                    // px: one pixel of the sketch's canvas (its cells are about 90 px)

    // ---- the ink: black and white, or one colour of the wallet
    const mono = opts.ink === 'mono', hue = opts.hue || INKS[Math.floor(rng('strata-mask:ink:' + (opts.origin || sk) + v)() * INKS.length)];

    // ---- the dots, cell by cell
    const D = [];
    for (let i = 0; i < n; i++) {
      const tx = txs.length ? (txs.length >= n ? txs[Math.floor(i * txs.length / n)] : txs[i]) : null;
      const r = rng('strata-mask:' + (tx ? tx.h : sk + ':cell' + i) + v);
      const vg = tx && tx.f ? 1 : 1 + Math.floor(r() * 39), sg = g / vg;
      const cx = X0 + (i % cols) * g + g / 2, cy = Y0 + Math.floor(i / cols) * g + g / 2;
      for (let a = 0; a < vg; a++) for (let b = 0; b < vg; b++) {
        const d = tx && tx.f ? g * 0.32 : Math.min(px + r() * (sg - px), g * 0.26);                      // strokeWeight(random(1, sg)); a failed transaction: one heavier dot (a third of a cell: the owner found the full-cell ones too big)
        const x = cx - g / 2 + sg / 2 + a * sg + (r() - 0.5) * g, y = cy - g / 2 + sg / 2 + b * sg + (r() - 0.5) * g;
        D.push([x, y, Math.max(d, px) / 2]);
      }
    }
    const circle = ([x, y, rr]) => `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(rr)}"/>`;
    // specks (opts.white: the share of the dots, e.g. 0.12; opts.speck: their colour, white by default, STRATA. red in the black-and-white print): in a coloured print some dots are paper-white instead of coloured, over both
    // the field and the face. A white dot replaces its coloured one (never a white dot on a coloured one), and is always small: at most about half the largest dot
    const wr = rng('strata-mask:white:' + (opts.origin || sk) + v), isWhite = D.map(() => opts.white > 0 && wr() < opts.white);
    const kept = D.filter((_, i) => !isWhite[i]);
    const cell = 24, grid = new Map(), key = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;   // the coloured dots by area, to find the ones near a white speck
    if (opts.white > 0) for (const d of kept) { const k = key(d[0], d[1]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(d); }
    const covered = (x, y) => { for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const [cx, cy, cr] of grid.get(`${Math.floor(x / cell) + a},${Math.floor(y / cell) + b}`) || []) if ((cx - x) ** 2 + (cy - y) ** 2 < (cr + 0.5) ** 2) return true; return false; };
    const whites = D.filter((d, i) => isWhite[i] && !covered(d[0], d[1])).map(([x, y, rr]) => circle([x, y, Math.max(px / 2, Math.min(rr, g * 0.06))])).join('');   // never white inside a coloured dot
    const dots = kept.map(circle).join('');
    // the Persona print: under the mask the dots are drawn smaller, so the mask reads as a lighter face (at full size both sides turn the same grey and it disappears)
    const inside = null;   // the Persona's face uses the very same dots (a smaller copy left a ring of the outer dot around every inner one)

    // ---- spill: a share of the dots that fall past the edge stay on the paper, and a few splashes fly further (never into the bottom band)
    let spill = '';
    if (opts.spill) {
      const sr = rng('strata-mask:spill:' + (opts.origin || sk) + v), bottom = Y0 + PH + 22, lim = 30;
      const clear = opts.clear || [];                               // [x, y, w, h] boxes the spill keeps off (the line of text above the picture)
      const ok = (x, y, rr) => x - rr > lim && x + rr < W - lim && y - rr > lim && y + rr < bottom && !clear.some(([cx, cy, cw, ch]) => x + rr > cx && x - rr < cx + cw && y + rr > cy && y - rr < cy + ch);
      for (const d of D) { const out = d[0] < X0 || d[0] > X0 + PW || d[1] < Y0 || d[1] > Y0 + PH; if (out && sr() < 0.45 && ok(d[0], d[1], d[2])) spill += circle(d); }
      for (let k = 0; k < 46; k++) {                             // splashes: thrown off an edge, smaller the further they go
        const side = Math.floor(sr() * 4), t = sr(), far = 6 + Math.pow(sr(), 1.6) * 70, rr = Math.max(px, (1 - far / 80) * (1 + sr() * 3));
        const x = side === 1 ? X0 + PW + far : side === 3 ? X0 - far : X0 + t * PW, y = side === 0 ? Y0 - far : side === 2 ? Y0 + PH + far * 0.25 : Y0 + t * PH;
        if (ok(x, y, rr)) spill += circle([x, y, rr]);
      }
      spill = `<g fill="#000000">${spill}</g>`;                   // on the white paper: black
    }

    // ---- the image in the middle: a mask (white shows the dots the right way round), every part with its soft offset shadow
    const o = rng('strata-mask:' + (opts.shape || 'strokes') + ':' + (opts.origin || sk) + v), cr = PW / 1.2, mx = X0 + PW / 2, my = Y0 + PH / 2;
    const soft = (el, dx = (o() - 0.5) * 2 * cr / 30, dy = cr / 30) => `<g transform="translate(${f1(dx)} ${f1(dy)})" filter="url(#mk-soft)">${el}</g>${el}`;
    const line = (el, w) => `<g fill="none" stroke="#FFFFFF" stroke-width="${f1(w)}" stroke-linecap="round" stroke-linejoin="round">${el}</g>`;
    const curve = (p, close) => {                                  // Catmull-Rom through the points (p5's curveVertex: the first and last only steer)
      const q = close ? [p[p.length - 1], ...p, p[0], p[1]] : p;
      let d = `M${f1(q[1][0])} ${f1(q[1][1])}`;
      for (let k = 1; k < q.length - 2; k++) { const [a, b, c, e] = [q[k - 1], q[k], q[k + 1], q[k + 2]]; d += `C${f1(b[0] + (c[0] - a[0]) / 6)} ${f1(b[1] + (c[1] - a[1]) / 6)} ${f1(c[0] - (e[0] - b[0]) / 6)} ${f1(c[1] - (e[1] - b[1]) / 6)} ${f1(c[0])} ${f1(c[1])}`; }
      return d + (close ? 'Z' : '');
    };
    const hashOf = String(opts.origin || '').replace(/^0x/, '') || Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(o() * 16)]).join('');
    const SHAPES = {
      strokes: () => Array.from({ length: 4 }, () => {          // the sketch: four strokes through 9 random points on a circle
        const turn = o() * Math.PI * 2, sx = (o() - 0.5) * 2 * cr / 30, sw = px + o() * (PW / 20 - px);
        const p = Array.from({ length: 9 }, () => { const a = o() * Math.PI * 2 + turn; return [mx + cr / 2 * Math.cos(a), my + cr / 2 * Math.sin(a)]; });
        return soft(line(`<path d="${curve(p)}"/>`, sw), sx);
      }).join(''),
      triangle: () => {                                          // the STRATA. triangle, a thick outline, turned a little
        const r = PW * 0.36, t = (o() - 0.5) * 0.5, pts = [0, 1, 2].map((k) => { const a = -Math.PI / 2 + t + k * 2 * Math.PI / 3; return `${f1(mx + r * Math.cos(a))},${f1(my + r * 0.12 + r * Math.sin(a))}`; }).join(' ');
        return soft(line(`<polygon points="${pts}"/>`, PW / 13));
      },
      journey: () => {                                           // the wallet's path: one line through the cells of its transactions, in time order
        const k = 26, p = Array.from({ length: k }, (_, j) => { const c = Math.floor(j * (n - 1) / (k - 1)); return [X0 + (c % cols) * g + g / 2 + (o() - 0.5) * g * 1.6, Y0 + Math.floor(c / cols) * g + g / 2 + (o() - 0.5) * g * 1.6]; });
        return soft(line(`<path d="${curve([p[0], ...p, p[k - 1]])}"/>`, PW / 26));
      },
      rings: () => {                                             // circles, one more for every order of magnitude of transactions
        const m = 2 + String(Math.max(1, txs.length)).length;
        return Array.from({ length: m }, (_, j) => soft(line(`<circle cx="${f1(mx + (o() - 0.5) * PW * 0.3)}" cy="${f1(my + (o() - 0.5) * PH * 0.3)}" r="${f1(PW * (0.1 + 0.32 * (j + 1) / m))}"/>`, PW / 70 + o() * PW / 30))).join('');
      },
      origin: () => {                                            // the origin hash itself, set large: 4 lines of 16 characters
        const fs = PW / (16 * 0.6) * 0.86, lh = fs * 1.05, top = my - lh * 1.5;
        return soft(`<g fill="#FFFFFF" font-family="JetBrains Mono" font-weight="700" font-size="${f1(fs)}" text-anchor="middle">${[0, 1, 2, 3].map((r) => `<text x="${f1(mx)}" y="${f1(top + r * lh + fs * 0.36)}">${hashOf.slice(r * 16, r * 16 + 16)}</text>`).join('')}</g>`);
      },
      blocks: () => {                                            // solid rectangles laid over each other, from the hash
        return Array.from({ length: 5 }, () => { const w = PW * (0.18 + o() * 0.42), h = PH * (0.1 + o() * 0.3);
          return soft(`<rect x="${f1(X0 + o() * (PW - w))}" y="${f1(Y0 + o() * (PH - h))}" width="${f1(w)}" height="${f1(h)}" fill="#FFFFFF"/>`); }).join('');
      },
      persona: () => {                                           // the holder's Persona mask: its 13 × 13 pixels, white, the eyes and mouth left open
        const gr = opts.persona || [], cs = Math.min(PW, PH) * 0.72 / 13, ox = mx - cs * 6.5, oy = my - cs * 6.5;
        let r = '';
        // not too neat: every pixel a little off its place and size, like a stamp pressed by hand (the whole face is tilted and moved below)
        const jr = rng('strata-mask:persona-hand:' + (opts.origin || sk) + v);
        gr.forEach((row, y) => row.forEach((on, x) => { if (!on) return; const j = cs * 0.09, sz = cs * (1 + (jr() - 0.5) * 0.12);
          r += `<rect x="${f1(ox + x * cs + (jr() - 0.5) * 2 * j)}" y="${f1(oy + y * cs + (jr() - 0.5) * 2 * j)}" width="${f1(sz + 0.6)}" height="${f1(sz + 0.6)}"/>`; }));
        const tilt = (jr() - 0.5) * 14, mvx = (jr() - 0.5) * PW * 0.08, mvy = (jr() - 0.5) * PH * 0.06;   // up to 7° either way, a little off the centre
        // sprayed like the field: the face's border roughened, specks thrown out from every outer side of its pixels, and paper specks just inside
        const pr = rng('strata-mask:persona-edge:' + (opts.origin || sk) + v), on = (x, y) => gr[y]?.[x] === 1, reach = cs * 1.25, deepest = cs * 0.6;
        let spray = '', holes = '';
        gr.forEach((row, y) => row.forEach((cell, x) => {
          if (!cell) return;
          for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
            if (on(x + dx, y + dy)) continue;                        // an inner side: no edge here
            for (let k = 0; k < 70; k++) {
              const t = pr(), ex = ox + (x + (dx === 0 ? t : dx > 0 ? 1 : 0)) * cs, ey = oy + (y + (dy === 0 ? t : dy > 0 ? 1 : 0)) * cs;
              const far = Math.pow(pr(), 2) * reach, rr = Math.max(px * 0.6, (1 - far / reach) * (0.4 + pr() * 1.7));
              spray += circle([ex + dx * far + (pr() - 0.5) * 3, ey + dy * far + (pr() - 0.5) * 3, rr]);
              const deep = Math.pow(pr(), 1.8) * deepest, hr = Math.max(px * 0.6, (1 - deep / deepest) * (0.4 + pr() * 1.4));
              holes += circle([ex - dx * deep + (pr() - 0.5) * 3, ey - dy * deep + (pr() - 0.5) * 3, hr]);
            }
          }
        }));
        return `<g transform="translate(${f1(mvx)} ${f1(mvy)}) rotate(${f1(tilt)} ${f1(mx)} ${f1(my)})"><filter id="mk-prough" filterUnits="userSpaceOnUse" x="${f1(ox - cs)}" y="${f1(oy - cs)}" width="${f1(cs * 15)}" height="${f1(cs * 15)}"><feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="2" seed="${Math.floor(pr() * 999)}" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="${f1(cs * 0.42)}" xChannelSelector="R" yChannelSelector="G"/></filter>`
          + soft(`<g fill="#CCCCCC" filter="url(#mk-prough)">${r}</g>`) + `<g fill="#CCCCCC">${spray}</g><g fill="#000000">${holes}</g></g>`;
      },
      eclipse: () => {                                           // one disc, nearly whole: a moon bitten by a second one
        const r = PW * 0.3, dx = (o() - 0.5) * r * 1.4, dy = (o() - 0.5) * r * 1.4;
        return soft(`<circle cx="${f1(mx)}" cy="${f1(my)}" r="${f1(r)}" fill="#FFFFFF"/><circle cx="${f1(mx + dx)}" cy="${f1(my + dy)}" r="${f1(r * 0.8)}" fill="#000000"/>`, 0, cr / 30);
      },
    };
    const shapes = (SHAPES[opts.shape] || SHAPES.strokes)();

    // ---- the black field's edge, sprayed: no straight border, the field frays out in specks (dense at the edge, rarer further out),
    // and its border itself is roughened. Kept off the bottom band (the hash and the stamp).
    const er = rng('strata-mask:edge:' + (opts.origin || sk) + v), per = 2 * (PW + PH), floor = Y0 + PH + 14, out = 64;
    let spray = '', holes = '';
    for (let k = 0; k < 4200; k++) {
      let u = er() * per, x, y, nx = 0, ny = 0;
      if (u < PW) { x = X0 + u; y = Y0; ny = -1; } else if ((u -= PW) < PH) { x = X0 + PW; y = Y0 + u; nx = 1; } else if ((u -= PH) < PW) { x = X0 + PW - u; y = Y0 + PH; ny = 1; } else { u -= PW; x = X0; y = Y0 + PH - u; nx = -1; }
      const far = Math.pow(er(), 2.2) * out - 5, rr = Math.max(px * 0.6, (1 - Math.max(0, far) / out) * (0.5 + er() * 2.4));
      const sx = x + nx * far + (er() - 0.5) * 5, sy = Math.min(floor - rr, y + ny * far + (er() - 0.5) * 5);
      if ((opts.clear || []).some(([cx, cy, cw, ch]) => sx + rr > cx - 6 && sx - rr < cx + cw + 6 && sy + rr > cy - 6 && sy - rr < cy + ch + 6)) continue;   // off the line of text above the picture
      spray += circle([sx, sy, rr]);
    }
    for (let k = 0; k < 1800; k++) {                              // and the ink fails a little inside its edge: specks of paper in the black
      let u = er() * per, x, y, nx = 0, ny = 0;
      if (u < PW) { x = X0 + u; y = Y0; ny = 1; } else if ((u -= PW) < PH) { x = X0 + PW; y = Y0 + u; nx = -1; } else if ((u -= PH) < PW) { x = X0 + PW - u; y = Y0 + PH; ny = -1; } else { u -= PW; x = X0; y = Y0 + PH - u; nx = 1; }
      const deep = Math.pow(er(), 1.8) * 26, rr = Math.max(px * 0.6, (1 - deep / 26) * (0.6 + er() * 2.2));
      holes += circle([x + nx * deep + (er() - 0.5) * 6, y + ny * deep + (er() - 0.5) * 6, rr]);
    }
    const gx = X0 - out - 8, gy = Y0 - out - 8, gw = PW + 2 * out + 16, gh = floor - gy;   // the field drawn a little larger, the mask decides where it shows

    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`
      + `<rect width="${W}" height="${H}" fill="${opts.bg || '#FFFFFF'}"/>`
      + `<defs><filter id="mk-rough" filterUnits="userSpaceOnUse" x="${f1(gx)}" y="${f1(gy)}" width="${f1(gw)}" height="${f1(gh)}"><feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="3" seed="${Math.floor(er() * 999)}" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="30" xChannelSelector="R" yChannelSelector="G"/></filter>`
      + `<mask id="mk-field" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect x="${f1(X0)}" y="${f1(Y0)}" width="${f1(PW)}" height="${f1(PH)}" fill="#FFFFFF" filter="url(#mk-rough)"/><g fill="#FFFFFF">${spray}</g><g fill="#000000">${holes}</g></mask>`
      + `<filter id="mk-soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${f1(5 * px)}"/></filter>`
      + `<mask id="mk-strokes" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">${shapes}</mask>`
      + `<mask id="mk-solid" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">${shapes.replace(/#CCCCCC/g, '#FFFFFF').replace(/mk-prough/g, 'mk-prough-s')}</mask>`   // the same shapes at full strength: the dots inside the face stay pure black
      + `<g id="mk-dots">${dots}</g>${inside ? `<g id="mk-dots-in">${inside}</g>` : ''}</defs>`
      + spill
      + `<g mask="url(#mk-field)"><rect x="${f1(gx)}" y="${f1(gy)}" width="${f1(gw)}" height="${f1(gh)}" fill="#000000"/><use href="#mk-dots" xlink:href="#mk-dots" fill="${mono ? hue : '#FFFFFF'}"/>`   // inverted: light dots on black
      + `<g mask="url(#mk-strokes)"><rect x="${f1(X0)}" y="${f1(Y0)}" width="${f1(PW)}" height="${f1(PH)}" fill="${mono ? hue : '#FFFFFF'}"/></g><g mask="url(#mk-solid)"><use href="#${inside ? 'mk-dots-in' : 'mk-dots'}" xlink:href="#${inside ? 'mk-dots-in' : 'mk-dots'}" fill="#000000"/></g>${whites ? `<g fill="${opts.speck || '#FFFFFF'}">${whites}</g>` : ''}</g>`   // under the mask: the right way round; the white specks over both
      + '</svg>';
  }

  // the Persona print's specks (owner's choice 2026-10-12): always black and white, some dots in one colour the buyer picks from these, STRATA. red first
  const SPECKS = [['#E84142', 'STRATA. red'], ['#FF7A1A', 'Orange'], ['#FFC400', 'Yellow'], ['#00A651', 'Green'], ['#1F6BFF', 'Blue'], ['#8A3FFC', 'Violet'], ['#FF5DA2', 'Pink'], ['#00B8C8', 'Cyan'], ['#C9A227', 'Gold'], ['#B08CFF', 'Lilac'], ['#FF6F59', 'Coral'], ['#FFB000', 'Amber'], ['#E5007E', 'Magenta'], ['#D7263D', 'Scarlet'], ['#FF8C42', 'Tangerine'], ['#1ABC9C', 'Turquoise'], ['#008C8C', 'Teal'], ['#48D1CC', 'Aqua'], ['#3DDC97', 'Mint'], ['#1E6F9F', 'Petrol blue'], ['#C46A3A', 'Copper'], ['#A47C48', 'Bronze'], ['#A63D2A', 'Rust'], ['#8A8F3A', 'Olive'], ['#B8BEC6', 'Silver']];
  const SPECK_SHARE = 0.2;                                            // the share of the dots that may turn into specks (about 12% do, once those inside another dot are dropped)
  root.StrataPrintMask = { generate, box, INKS, SPECKS, SPECK_SHARE, W, H };
})(typeof globalThis !== 'undefined' ? globalThis : this);
