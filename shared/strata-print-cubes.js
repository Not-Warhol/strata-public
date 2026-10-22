/* STRATA. Print — "Cubes". Ported from the owner's p5 sketch: a triangle (pointing up, the sketch turned half a turn) drawn with isometric cubes
 * (three rhombi each) in three colours, one of them the colour of the sheet, so those facets vanish. The same drawing order and
 * colour counter as the sketch, so the cube pattern is the sketch's own.
 * Always 8 cubes along each side, so the cubes are the same size on every sheet (the owner's final piece). The wallet changes
 * two things: one of 10 palettes and the order of the three colours (one of 6), both from the transaction hashes and the variant. (The sketch's own red, yellow and blue on yellow is not among them.)
 * Pure (no p5, no canvas, no network). Exposes globalThis.StrataPrintCubes. */
(function (root) {
  const W = 1000, H = 1414, M = 84;
  // [sheet colour, second, third]: the sheet colour is also one of the three cube colours. Every colour has to come out on paper:
  // no neon (the site's #39FF14 prints as a dull green), so the green is #00A651, a green inside the print gamut.
  const PALETTES = [
    ['#00A651', '#000000', '#E84142'],   // Strata: green, black, AVAX red
    ['#FF5A1F', '#0B1F8F', '#FFF1D6'],   // orange, ultramarine, cream
    ['#00C2FF', '#FF2D95', '#FFFFFF'],   // cyan, hot pink, white
    ['#F2E6C9', '#111111', '#E84142'],   // paper, black, red
    ['#7B2CFF', '#FFE600', '#FFFFFF'],   // violet, yellow, white
    ['#0A0A0A', '#00A651', '#E84142'],   // black, green, red
    ['#E84142', '#111111', '#F2F2F2'],   // red, black, off-white
    ['#00A86B', '#FF9EC7', '#101A4A'],   // green, pink, navy
    ['#FFC8DD', '#2B50FF', '#7BE0AD'],   // pastel pink, blue, mint
    ['#0E8F86', '#FFD60A', '#1B1B1B'],   // teal, yellow, graphite
  ];
  const PERMS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

  function fnv(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const f = (n) => Math.round(n * 100) / 100;
  const N = 8;                                                    // cubes along each side of the triangle, fixed

  /** opts: { seed, variant?, txs?: [{ h, f?, t? (unix seconds), c? ('in' | 'out' | 'pay' | 'call' | 'deploy') }], tx?: { ok, failed }, label?, credit?, logo? (default true: STRATA. and the wallet at the top; false = bare), facts? (default true with the logo: a short description of the wallet, top right; false = no description and no count line either, the sheet carries nothing of the wallet unless `label` is given), partial? (true when txs is only the latest part of the history), layout? ('single' (default) | 'nested' | 'giant' | 'fall'), palette? (0..9, to force one), split? (1..4: every cube is made of split × split × split smaller cubes, default 1 = the sketch), side? ('left' (default) | 'right': the logo and the wallet top right, the description top left) } */
  function generate(opts) {
    const txs = opts.txs || [];
    const total = opts.tx ? Math.round(opts.tx.ok + opts.tx.failed) : txs.length;
    const failed = opts.tx ? Math.round(opts.tx.failed) : txs.filter((t) => t.f).length;
    const split = Math.max(1, Math.min(4, Math.floor(opts.split) || 1)), n = N, s = 128, r = 2 * s / n, k = Math.sqrt(3);
    const sk = 'strata-cubes:' + String(opts.seed).toLowerCase() + (opts.variant ? ':v' + opts.variant : '') + ':' + txs.map((t) => t.h + (t.f ? 'f' : '')).join('');
    const pal = PALETTES[opts.palette != null ? opts.palette % PALETTES.length : fnv(sk + ':palette') % PALETTES.length];
    const colors = PERMS[fnv(sk + ':order') % 6].map((i) => pal[i]), bg = pal[0];
    const lum = (c) => parseInt(c.slice(1, 3), 16) * 299 + parseInt(c.slice(3, 5), 16) * 587 + parseInt(c.slice(5, 7), 16) * 114;
    const inks = pal.slice().sort((x, y) => lum(x) - lum(y));                // palette colours only: the edge of a small cube is the darkest colour of the palette that is not the face's own
    /** The drawing of the sketch, centred on the centroid of the triangle: n cubes a side, colours in the order given, `fall(i)` (cube number) -> { dy, a } to let a cube drop out of the structure instead of sitting in it. */
    const structure = (n, s, colors, fall) => {
      const r = 2 * s / n;
      let count = 0, out = '', cube = -1;
      const facet = (tf) => {
        const fill = colors[(count++) % 3];
        if (split === 1) { out += `<polygon points="${f(r)},0 ${f(r / 2)},${f(r * k / 2)} 0,0 ${f(r / 2)},${f(-r * k / 2)}" transform="${tf}" fill="${fill}"/>`; return; }
        const edge = inks.find((c) => c !== fill);
        const a = [r / 2, r * k / 2], b = [r / 2, -r * k / 2], q = 1;   // the facet is a rhombus O + s·a + t·b; every small cube shows as a smaller rhombus, outlined so each reads as a solid cube
        let g = `<g transform="${tf}" fill="${fill}" stroke="${edge}" stroke-width="${f(r / split * 0.07)}" stroke-linejoin="round">`;
        for (let i = 0; i < split; i++) for (let j = 0; j < split; j++) {
          const cx = ((i + .5) * a[0] + (j + .5) * b[0]) / split, cy = ((i + .5) * a[1] + (j + .5) * b[1]) / split;
          const pt = (u, v) => `${f(cx + ((u - .5) * a[0] + (v - .5) * b[0]) * q / split)},${f(cy + ((u - .5) * a[1] + (v - .5) * b[1]) * q / split)}`;
          g += `<polygon points="${pt(0, 0)} ${pt(1, 0)} ${pt(1, 1)} ${pt(0, 1)}"/>`;
        }
        out += g + '</g>';
      };
      const place = (x, y, q, i) => {
        const d = fall && fall(i);
        facet(d ? `translate(${f(x)} ${f(y - d.dy)}) rotate(${f(d.a + q * 120)})` : `translate(${f(x)} ${f(y)}) rotate(${q * 120})`);
      };
      const corners = [[-s, -s * k / 2], [s, -s * k / 2], [0, s * k / 2]];
      for (let i = 0; i < 3; i++) for (let j = 0; j < n; j++) {
        const a = corners[i], b = corners[(i + 1) % 3];
        const x = a[0] + (b[0] - a[0]) * j / (n - 1), y = a[1] + (b[1] - a[1]) * j / (n - 1);
        cube++;
        for (let q = 0; q < 3; q++) place(x, y, q, cube);
      }
      count++;
      const x = -s + 2 * s / (n - 1), y = -s * k / 2;
      place(x, y, 1, 1); place(x, y, 2, 1);
      return { svg: out, cubes: cube + 1 };
    };
    const layout = opts.layout || 'single';
    const rnd = (() => { let a = fnv(sk + ':' + layout); return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })();
    const dark = ((parseInt(bg.slice(1, 3), 16) * 299 + parseInt(bg.slice(3, 5), 16) * 587 + parseInt(bg.slice(5, 7), 16) * 114) / 1000) < 110;   // light text on a dark sheet
    const logo = opts.logo !== false, rows = logo && opts.facts !== false ? facts(txs, total, failed, !!opts.partial) : [];
    const top = logo ? 220 : M, bottom = logo ? H - 110 : H - 84;
    const fg = dark ? '#FFFFFF' : '#000000', dim = dark ? 'rgba(255,255,255,.6)' : 'rgba(0,0,0,.6)', tri = bg.toUpperCase() === '#E84142' ? fg : '#E84142';   // the triangle is red, unless the sheet is that red
    const scale = ((W - 2 * M) / 2) / (s + 2 * s / 4);          // the picture is as wide as the sheet allows, whatever the number of cubes
    const cy = (top + bottom) / 2 - 16 * scale;
    const signed = layout !== 'giant', credit = signed ? [(opts.credit || 'created by notwarhol').toUpperCase()] : [];   // the giant sheet carries no credit line
    const info = rows.length || opts.facts === false ? credit : [`${total} TRANSACTION${total === 1 ? '' : 'S'}${failed ? ` · ${failed} FAILED` : ''}`, ...credit];
    const line = (logo ? info : [opts.label, ...info]).filter(Boolean).join('  ·  ');
    const rot = (cs, l) => [0, 1, 2].map((i) => cs[(i + l) % 3]);
    let picture;
    if (layout === 'nested') {                                    // a triangle inside the hollow of the triangle, once for every order of magnitude of transactions (1 to 3), turned half a turn each time
      const levels = Math.min(3, String(Math.max(1, total)).length), gs = [];
      for (let l = 0; l < levels; l++) {
        const sc = scale * Math.pow(0.32, l);
        gs.push(`<g transform="translate(${W / 2} ${f(cy + 0)}) scale(${f(sc)}) rotate(${l % 2 ? 0 : 180}) translate(0 ${f(s * k / 6)})" shape-rendering="crispEdges">${structure(n, s, rot(colors, l)).svg}</g>`);
      }
      picture = gs.join('');
    } else if (layout === 'giant') {                              // the structure far larger than the sheet: the apex under the logo, the rest bleeds off the sides and the bottom
      const sc = scale * 1.9, apex = top + 70, ty = apex + sc * (s * k / 2 + 2 * s / n);
      picture = `<g transform="translate(${W / 2} ${f(ty)}) scale(${f(sc)}) rotate(180)" shape-rendering="crispEdges">${structure(n, s, colors).svg}</g>`;
    } else if (layout === 'fall') {                               // every failed transaction knocks a cube out of the structure and it falls
      const share = Math.min(0.5, failed / Math.max(1, total) * 3), drops = new Map();
      for (let i = 0; i < 3 * n; i++) if (rnd() < share) drops.set(i, { dy: 70 + rnd() * 330, a: (rnd() - 0.5) * 80 });
      if (!drops.size && failed) drops.set(Math.floor(rnd() * 3 * n), { dy: 150, a: 20 });
      picture = `<g transform="translate(${W / 2} ${f(cy)}) scale(${f(scale)}) rotate(180)" shape-rendering="crispEdges">${structure(n, s, colors, (i) => drops.get(i)).svg}</g>`;
    } else {
      picture = `<g transform="translate(${W / 2} ${f(cy)}) scale(${f(scale)}) rotate(180)" shape-rendering="crispEdges">${structure(n, s, colors).svg}</g>`;
    }
    const right = opts.side === 'right', dx = right ? M + 340 - W + M : 0;   // logo on the right: the description moves to the left
    const text = rows.map(([label, value], i) => {                // the description: beside the logo, one row per fact (label left, value right)
      const y = 84 + i * 17;
      return `<text x="${W - M - 340 + dx}" y="${y}" font-family="JetBrains Mono" font-size="9" font-weight="600" letter-spacing="2" fill="${dim}">${esc(label)}</text>`
        + `<text x="${W - M + dx}" y="${y}" text-anchor="end" font-family="JetBrains Mono" font-size="11.5" font-weight="700" letter-spacing="1" fill="${fg}">${esc(value)}</text>`;
    }).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`
      + `<rect width="${W}" height="${H}" fill="${bg}"/>`
      + (logo ? `<text x="${right ? W - M - 33 : M}" y="150"${right ? ' text-anchor="end"' : ''} font-family="Big Shoulders Display" font-weight="800" font-size="104" letter-spacing="2" fill="${fg}">STRATA</text>`
        + `<path d="M${right ? W - M - 30 : M + 273} 150l15 -26l15 26z" fill="${tri}"/>`
        + (opts.label ? `<text x="${right ? W - M : M}" y="184"${right ? ' text-anchor="end"' : ''} font-family="JetBrains Mono" font-size="12" font-weight="600" letter-spacing="3" fill="${dim}">${esc(opts.label)}</text>` : '') : '')
      + picture
      + text
      + (line ? `<text x="${W / 2}" y="${H - 40}" font-family="JetBrains Mono" font-weight="600" text-anchor="middle" font-size="9" letter-spacing="1.2" fill="${dim}">${esc(line)}</text>` : '') + '</svg>';
  }

  // ---- the description of the wallet
  const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const day = (ts) => { const d = new Date(ts * 1000); return `${String(d.getUTCDate()).padStart(2, '0')} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
  const num = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  /** Rows of [label, value]: counts always, dates and activity when the transactions carry their time. Same transactions, same text. */
  function facts(txs, total, failed, partial) {
    const rows = [['TRANSACTIONS', num(total)], ['FAILED', failed ? `${num(failed)}  (${(failed * 100 / Math.max(1, total)).toFixed(1)}%)` : '0']];
    const timed = txs.filter((x) => x.t);
    if (timed.length) {
      const first = timed[0].t, last = timed[timed.length - 1].t, days = new Map();
      for (const x of timed) { const d = Math.floor(x.t / 86400); days.set(d, (days.get(d) || 0) + 1); }
      let best = [0, 0]; for (const [d, c] of days) if (c > best[1]) best = [d, c];
      const months = Math.max(0, Math.round((last - first) / 86400 / 30.44)), age = months >= 12 ? `${Math.floor(months / 12)} Y ${months % 12} M` : `${Math.max(1, Math.round((last - first) / 86400))} DAYS`;
      const calls = timed.filter((x) => x.c === 'call' || x.c === 'pay').length;
      rows.push([partial ? 'EARLIEST SHOWN' : 'FIRST TRANSACTION', day(first)], ['LATEST', day(last)], ['ACTIVE FOR', age], ['ACTIVE DAYS', num(days.size)],
        ['BUSIEST DAY', `${day(best[0] * 86400)}  ·  ${num(best[1])}`], ['CONTRACT CALLS', num(calls)]);
    }
    return rows;
  }

  root.StrataPrintCubes = { generate, N, PALETTES, W, H };
})(typeof globalThis !== 'undefined' ? globalThis : this);
