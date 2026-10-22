/* STRATA. Print — "Strata". A wallet's NFT bags become a geological cross-section, made for paper.
 * Every collection held is one rock layer in that collection's colour; the thicker the bag, the thicker the layer.
 * The biggest bag lies deepest. All layers fold together along one seeded fold, so no two sections are alike.
 * Deterministic: same input => same SVG. Pure (no network): the server reads the bags, this only draws.
 * Sizes are A-series (1 : 1.4142); the SVG is drawn on a 1000 x 1414 canvas and scales to any dpi.
 * Exposes globalThis.StrataPrint. */
(function (root) {
  const W = 1000, H = 1414, M = 84;
  const INK = '#000000', PAPER = '#F4F1E8', NEON = '#39FF14', RED = '#E84142';

  function fnv(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(s) { let a = fnv(String(s)); return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const f1 = (v) => Math.round(v * 10) / 10;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function mix(hex, to, t) {
    const p = (h, i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
    const c = [0, 1, 2].map((i) => Math.round(p(hex, i) + (p(to, i) - p(hex, i)) * t));
    return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  }

  /** opts: { seed, bags: [{ name, color, n, boost? }], label?, dark?, fault?: 'auto'|'on'|'off', fold?, hatch?, grain? }
   * dark defaults to true; fold, hatch and grain are multipliers (1 = as designed). */
  function generate(opts) {
    const dark = opts.dark !== false;
    const bg = opts.bg || (dark ? INK : PAPER), fg = dark ? '#FFFFFF' : '#000000', dim = dark ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.55)';
    const rnd = rng('strata-print:' + opts.seed);
    const bags = (opts.bags || []).filter((b) => b.n > 0).map((b) => ({ ...b, w: b.n * (b.boost ? 3 : 1) }))
      .sort((a, b) => a.w - b.w || String(a.name).localeCompare(String(b.name)));      // thinnest on top, biggest deepest
    const total = bags.reduce((t, b) => t + b.n, 0);

    // the panel
    const FX1 = W - M, X0 = M, X1 = W - M - 150, Y0 = 250, Y1 = H - 270, PH = Y1 - Y0, PW = X1 - X0;
    const out = [];
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`);
    out.push(`<rect width="${W}" height="${H}" fill="${bg}"/>`);
    out.push(`<defs><clipPath id="panel"><rect x="${X0}" y="${Y0}" width="${PW}" height="${PH}"/></clipPath></defs>`);

    // ---- layers
    const n = bags.length;
    if (n === 0) {
      out.push(`<g clip-path="url(#panel)"><rect x="${X0}" y="${Y0}" width="${PW}" height="${PH}" fill="none" stroke="${dim}" stroke-width="1"/>`);
      for (let k = 0; k < 40; k++) { const y = Y0 + 60 + k * 11; out.push(`<path d="M${X0} ${y}H${X1}" stroke="${dim}" stroke-width=".6" opacity="${0.6 - k * 0.012}"/>`); }
      out.push('</g>');
    } else {
      // thickness: sqrt keeps one huge bag from flattening the rest; every layer gets a floor so it stays a visible line
      const min = clamp(PH / (n * 4), 3, 14);
      let th = bags.map((b) => Math.sqrt(b.w));
      const sum = th.reduce((a, v) => a + v, 0);
      th = th.map((v) => Math.max(min, (v / sum) * PH));
      const fix = PH / th.reduce((a, v) => a + v, 0);
      th = th.map((v) => v * fix);

      // fold: one shared curve + a small own wobble per boundary. Amplitude shrinks with many layers so it stays legible.
      const waves = [0, 1, 2].map((j) => ({ a: (60 - j * 16) * (0.6 + rnd() * 0.8) * (opts.fold ?? 1), f: (1.1 + j * 1.35 + rnd() * 0.5) * Math.PI / PW, p: rnd() * 6.28 }));
      const tilt = (rnd() - 0.5) * 110;
      const fold = (x) => waves.reduce((s, w) => s + w.a * Math.sin(w.f * (x - X0) + w.p), 0) + tilt * ((x - X0) / PW - 0.5);
      const wob = Array.from({ length: n + 1 }, () => ({ a: 3 + rnd() * 9, f: (3 + rnd() * 5) * Math.PI / PW, p: rnd() * 6.28 }));
      const fr = [rnd(), rnd(), rnd(), rnd(), rnd()];   // always drawn, so the fault switch never changes the fold
      const mode = opts.fault === true ? 'on' : opts.fault === false ? 'off' : (opts.fault || 'auto');
      const fault = mode === 'off' || (mode === 'auto' && fr[0] >= 0.55) ? null
        : { x: X0 + PW * (0.3 + fr[1] * 0.4), slope: (fr[2] - 0.5) * 0.9, dy: (fr[3] < 0.5 ? -1 : 1) * (14 + fr[4] * 26) };
      const STEPS = 90;
      const xs = Array.from({ length: STEPS + 1 }, (_, i) => X0 + (PW * i) / STEPS);
      const edge = (k, x) => {
        let y = Y0 + th.slice(0, k).reduce((a, v) => a + v, 0);
        y += fold(x) + wob[k].a * Math.sin(wob[k].f * (x - X0) + wob[k].p) * clamp(th[Math.min(k, n - 1)] / 30, 0.25, 1);
        if (fault) { const side = x - fault.x - (y - (Y0 + PH / 2)) * fault.slope; if (side > 0) y += fault.dy; }
        return y;
      };
      out.push('<g clip-path="url(#panel)">');
      out.push(`<path d="M${xs.map((x) => `${f1(x)} ${f1(edge(n, x))}`).join('L')}L${X1} ${Y1 + 300}L${X0} ${Y1 + 300}Z" fill="${mix(bags[n - 1].color, bg, 0.62)}"/>`);   // bedrock under the deepest layer
      const cap = 3;                                    // the dark seam between layers
      for (let k = 0; k < n; k++) {
        const b = bags[k];
        const top = xs.map((x) => [x, edge(k, x)]), bot = xs.map((x) => [x, edge(k + 1, x)]);
        const d = 'M' + top.map(([x, y]) => `${f1(x)} ${f1(y)}`).join('L') + 'L' + bot.reverse().map(([x, y]) => `${f1(x)} ${f1(y - (th[k] > cap * 2 ? cap : 0))}`).join('L') + 'Z';
        out.push(`<path d="${d}" fill="${b.color}"/>`);
        // hatching that follows the fold: darker lines near the bottom of the layer, a light line near the top
        const lines = clamp(Math.round(th[k] / 5 * (opts.hatch ?? 1)), 0, 24);
        for (let l = 1; l <= lines; l++) {
          const t = l / (lines + 1);
          const dl = 'M' + xs.map((x) => `${f1(x)} ${f1(edge(k, x) * (1 - t) + edge(k + 1, x) * t)}`).join('L');
          out.push(`<path d="${dl}" fill="none" stroke="${t < 0.3 ? mix(b.color, '#FFFFFF', 0.35) : mix(b.color, '#000000', 0.18 + t * 0.35)}" stroke-width="${f1(0.5 + t * 0.7)}" opacity=".75"/>`);
        }
        // grit: stipple weighted toward the bottom of the layer
        const dots = clamp(Math.round(th[k] * 2.2 * (opts.grain ?? 1)), 0, 600);
        let g = '';
        for (let q = 0; q < dots; q++) {
          const x = X0 + rnd() * PW, t = Math.pow(rnd(), 0.6);
          const y = edge(k, x) * (1 - t) + edge(k + 1, x) * t;
          g += `M${f1(x)} ${f1(y)}h.9v.9h-.9z`;
        }
        if (g) out.push(`<path d="${g}" fill="${mix(b.color, '#000000', 0.55)}" opacity=".7"/>`);
      }
      // thin ink line where the boundaries meet the bottom, then the frame
      out.push('</g>');
      out.push(`<rect x="${X0}" y="${Y0}" width="${PW}" height="${PH}" fill="none" stroke="${fg}" stroke-width="1.2"/>`);

      // ---- labels: the deepest 9 layers, named on the right with a leader tick
      const mids = bags.map((_, k) => (edge(k, X1) + edge(k + 1, X1)) / 2);
      const show = bags.map((b, k) => ({ b, k })).slice(-8).filter(({ k }) => th[k] > 7);
      let lastY = -1e9;
      for (const { b, k } of show) {
        const y = Math.max(mids[k], lastY + 22); lastY = y;
        out.push(`<path d="M${X1} ${f1(mids[k])}l12 0l8 ${f1(y - mids[k])}" fill="none" stroke="${fg}" stroke-width=".8"/>`);
        out.push(`<text x="${X1 + 26}" y="${f1(y + 3.5)}" font-family="JetBrains Mono" font-size="10" font-weight="600" fill="${fg}">${esc(String(b.name).toUpperCase().slice(0, 11))} ×${b.n}</text>`);
      }
    }

    // ---- depth ticks on the left (one per 10 NFTs, up to 9)
    for (let t = 0; t <= 8; t++) {
      const y = Y0 + (PH * t) / 8;
      out.push(`<path d="M${X0 - 12} ${f1(y)}h8" stroke="${fg}" stroke-width=".8"/>`);
    }

    // ---- header
    out.push(`<text x="${M}" y="150" font-family="Big Shoulders Display" font-weight="800" font-size="104" letter-spacing="2" fill="${fg}">STRATA</text>`);
    // the full stop is the red AVAX triangle
    out.push(`<path d="M${M + 273} 150l15 -26l15 26z" fill="${RED}"/>`);
    out.push(`<text x="${FX1}" y="76" text-anchor="end" font-family="JetBrains Mono" font-size="12" font-weight="600" letter-spacing="3" fill="${dim}">${esc((opts.label || 'WALLET').toUpperCase())}</text>`);
    out.push(`<text x="${FX1}" y="150" text-anchor="end" font-family="JetBrains Mono" font-size="12" font-weight="600" letter-spacing="3" fill="${dim}">${n} LAYER${n === 1 ? '' : 'S'} · ${total} NFT${total === 1 ? '' : 'S'}</text>`);
    out.push(`<path d="M${M} 190h${FX1 - M}" stroke="${fg}" stroke-width="1.2"/>`);
    out.push(`<text x="${M}" y="222" font-family="JetBrains Mono" font-size="12" font-weight="600" letter-spacing="3" fill="${dim}">CROSS-SECTION · AVALANCHE C-CHAIN</text>`);

    // ---- footer
    const FY = H - 200;
    out.push(`<path d="M${M} ${FY}h${FX1 - M}" stroke="${fg}" stroke-width="1.2"/>`);
    out.push(`<text x="${M}" y="${FY + 44}" font-family="JetBrains Mono" font-size="12" font-weight="600" letter-spacing="3" fill="${dim}">${esc((opts.line1 || 'THE DEEPEST LAYER IS YOUR BIGGEST BAG').toUpperCase())}</text>`);
    out.push(`<text x="${M}" y="${FY + 70}" font-family="JetBrains Mono" font-size="12" font-weight="600" letter-spacing="3" fill="${dim}">${esc((opts.line2 || 'ONE WALLET, ONE SECTION. NEVER DRAWN TWICE.').toUpperCase())}</text>`);
    out.push(`<text x="${M}" y="${FY + 132}" font-family="JetBrains Mono" font-size="10" letter-spacing="3" fill="${dim}">${esc(opts.footer || 'STRATA. · STRAATA.XYZ')}</text>`);
    out.push('</svg>');
    return out.join('');
  }

  root.StrataPrint = { generate, W, H, NEON };
})(typeof globalThis !== 'undefined' ? globalThis : this);
