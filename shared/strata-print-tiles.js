/* STRATA. Print — "Tiles". Ported from the owner's p5 sketch of squares that open and close: a grid of cells, each with two
 * coloured squares set diagonally and a black square in the middle that shrinks to open the cell and grows to close it.
 * Here every cell is one transaction of the wallet (oldest first, left to right, top to bottom). The two colours of a cell
 * come from the first bytes of its hash (the sketch's 8 colours). A failed transaction never opens: its cell stays closed.
 * The print is one frame of the sketch's loop (0..199); the wave runs from the top-left corner, as in the sketch.
 * Deterministic: same transactions + same frame => same SVG. Pure. Exposes globalThis.StrataPrintTiles. */
(function (root) {
  const W = 1000, H = 1414, M = 84, RED = '#E84142';
  const COLORS = ['#e6302b', '#fd7800', '#fbd400', '#51b72d', '#2abde4', '#5534eb', '#f477c3', '#ffffff'];
  const T0 = -60, T1 = 40, T2 = 100, T3 = 140, CYCLE = T3 - T0;
  const MAX_CELLS = 900;
  const fnvSalt = (v) => { let h = 2166136261; const t = 'tiles:v' + v; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) & 0xffff; };
  const f1 = (v) => Math.round(v * 10) / 10;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const easeInOutCirc = (x) => (x < 0.5 ? (1 - Math.sqrt(1 - Math.pow(2 * x, 2))) / 2 : (Math.sqrt(1 - Math.pow(-2 * x + 2, 2)) + 1) / 2);
  const lerp = (a, b, t) => a + (b - a) * t;

  /** Size of the black centre square, 0..w, for a cell whose clock reads t (the sketch's timeline). */
  function centre(t, w) {
    if (t > 0 && t < T1) return lerp(w, 0, easeInOutCirc(t / (T1 - 1)));
    if (t > T2 && t < T3) return lerp(0, w, easeInOutCirc((t - T2) / (T3 - 1 - T2)));
    return (t > 0 && t <= T2) ? 0 : w;       // closed before it starts, open between the closing and the opening
  }

  /** opts: { txs: [{ h: hash, f?: true when it failed }] oldest first, frame?: 0..199, variant? (integer: same transactions, other colour pairs), label?, credit?, dark?, bg?, logo?, foot? (height of the bottom margin under the picture, default 84 or 110 with the logo; the store's sheets use 110) }
   * logo: true draws STRATA. and the wallet at the top (the first layout); the default is the bare sheet: the piece alone, centred,
   * and everything else on one line at the very bottom, centred (wallet, counts, credit). The line sits 40 units
   * (about 12 mm on A3) from the edge, inside the usual 5 mm print-safe margin; the piece fills everything above it. */
  function generate(opts) {
    const dark = opts.dark !== false;
    const bg = opts.bg || (dark ? '#000000' : '#F4F1E8'), fg = dark ? '#FFFFFF' : '#000000', dim = dark ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.55)';
    const hole = dark ? '#000000' : bg;
    const logo = !!opts.logo;
    const FX1 = W - M, X0 = M, Y0 = logo ? 220 : M, PW = FX1 - M, PH = H - (opts.foot ?? (logo ? 110 : 84)) - Y0;
    let txs = (opts.txs || []).slice();
    if (txs.length > MAX_CELLS) { const k = Math.ceil(txs.length / MAX_CELLS); txs = txs.filter((_, i) => i % k === 0); }
    const salt = opts.variant ? fnvSalt(opts.variant) : 0;
    const n = txs.length, frame = ((opts.frame ?? 60) % CYCLE + CYCLE) % CYCLE;
    const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`, `<rect width="${W}" height="${H}" fill="${bg}"/>`];

    if (n) {
      // columns that make the cells fill the panel as squares as possible
      let C = Math.max(1, Math.round(Math.sqrt(n * PW / PH))), R = Math.ceil(n / C);
      for (let c = Math.max(1, C - 2); c <= C + 2; c++) { const r = Math.ceil(n / c); if (Math.min(PW / c, PH / r) > Math.min(PW / C, PH / R)) { C = c; R = r; } }
      const S = Math.min(PW / C, PH / R), w = S / 2;
      const gx = X0 + (PW - C * S) / 2, gy = Y0 + (PH - R * S) / 2;
      txs.forEach((tx, i) => {
        const col = i % C, row = Math.floor(i / C), cx = gx + col * S + w, cy = gy + row * S + w;
        const b = ((parseInt(String(tx.h).replace(/^0x/, '').slice(0, 4), 16) || 0) ^ salt) & 0xffff;
        const c1 = COLORS[(b >> 8) % 8]; let c2 = COLORS[b % 8]; if (c2 === c1) c2 = COLORS[((b % 8) + 1) % 8];
        // the sketch's wave: the clock of a cell starts later the further it is from the top-left corner (900 px reference canvas)
        const d = Math.hypot((cx - gx) / (C * S), (cy - gy) / (R * S)) * 900;
        const t = (((frame - d / 20 - T0) % CYCLE) + CYCLE) % CYCLE + T0;
        const cw = tx.f ? w : centre(t, w), ww = w - cw;
        out.push(`<rect x="${f1(cx + ww / 2 - w / 2)}" y="${f1(cy + ww / 2 - w / 2)}" width="${f1(w)}" height="${f1(w)}" fill="${c1}"/>`);
        out.push(`<rect x="${f1(cx - ww / 2 - w / 2)}" y="${f1(cy - ww / 2 - w / 2)}" width="${f1(w)}" height="${f1(w)}" fill="${c2}"/>`);
        out.push(`<rect x="${f1(cx - (cw + 1) / 2)}" y="${f1(cy - (cw + 1) / 2)}" width="${f1(cw + 1)}" height="${f1(cw + 1)}" fill="${hole}"/>`);
      });
    }

    if (logo) {
      out.push(`<text x="${M}" y="150" font-family="Big Shoulders Display" font-weight="800" font-size="104" letter-spacing="2" fill="${fg}">STRATA</text>`);
      out.push(`<path d="M${M + 273} 150l15 -26l15 26z" fill="${RED}"/>`);
      if (opts.label) out.push(`<text x="${M}" y="184" font-family="JetBrains Mono" font-size="12" font-weight="600" letter-spacing="3" fill="${dim}">${esc(opts.label)}</text>`);
      out.push(`<text x="${W / 2}" y="${H - 40}" text-anchor="middle" font-family="JetBrains Mono" font-size="11" font-weight="600" letter-spacing="3" fill="${dim}">${esc((opts.credit || 'created by the artist notwarhol for STRATA.').toUpperCase())}</text>`);
    } else {
      const failed = txs.filter((t) => t.f).length;
      const line = [opts.label, `${n} TRANSACTION${n === 1 ? '' : 'S'}${failed ? ` · ${failed} FAILED` : ''}`, (opts.credit || 'created by the artist notwarhol for STRATA.').toUpperCase()].filter(Boolean).join('  ·  ');
      out.push(`<text x="${W / 2}" y="${H - 40}" font-family="JetBrains Mono" font-weight="600" text-anchor="middle" font-size="9" letter-spacing="1.2" fill="${dim}">${esc(line)}</text>`);
    }
    out.push('</svg>');
    return out.join('');
  }

  /** The frame of the loop a wallet's print is frozen on: always between 40 and 160, picked from the seed and the variant (same wallet and variant, same frame). */
  function frameFor(seed, variant) {
    let h = 2166136261; const t = String(seed).toLowerCase() + (variant ? ':v' + variant : '');
    for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
    return 40 + ((h >>> 0) % 121);
  }

  root.StrataPrintTiles = { generate, frameFor, W, H, CYCLE };
})(typeof globalThis !== 'undefined' ? globalThis : this);
