/* STRATA. Print — "Fracture". The wallet's NFT bags become a pane of glass broken from one impact.
 * Every NFT held is one shard (up to 420, then shards stand for several NFTs); every collection owns a wedge of the pane
 * in its own colour, wider for a bigger bag. Shards are small and loose near the impact and large and still at the edge.
 * Deterministic: same input => same SVG. Pure (no network). Same sheet and options as shared/strata-print.js.
 * Exposes globalThis.StrataPrintShards. */
(function (root) {
  const W = 1000, H = 1414, M = 84, RED = '#E84142', MAX_SHARDS = 420;

  function fnv(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(s) { let a = fnv(String(s)); return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const f1 = (v) => Math.round(v * 10) / 10;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function mix(hex, to, t) {
    const p = (h, i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
    return '#' + [0, 1, 2].map((i) => Math.round(p(hex, i) + (p(to, i) - p(hex, i)) * t).toString(16).padStart(2, '0')).join('');
  }

  /** Keeps the part of a polygon where nx*x + ny*y <= c. */
  function clip(poly, nx, ny, c) {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const da = nx * a[0] + ny * a[1] - c, db = nx * b[0] + ny * b[1] - c;
      if (da <= 0) out.push(a);
      if ((da < 0 && db > 0) || (da > 0 && db < 0)) { const t = da / (da - db); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
    }
    return out;
  }

  /** opts: { seed, bags: [{ name, color, n, boost? }], label?, dark?, fold? (spread of the blast), hatch? (facet shading), grain? (dust), line1?, line2?, footer? } */
  function generate(opts) {
    const dark = opts.dark !== false;
    const bg = opts.bg || (dark ? '#000000' : '#F4F1E8'), fg = dark ? '#FFFFFF' : '#000000', dim = dark ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.55)';
    const rnd = rng('strata-shards:' + opts.seed);
    const bags = (opts.bags || []).filter((b) => b.n > 0).map((b) => ({ ...b, w: b.n * (b.boost ? 3 : 1) }));
    const total = bags.reduce((t, b) => t + b.n, 0), n = bags.length;
    const blast = opts.fold ?? 1, facet = opts.hatch ?? 1, dust = opts.grain ?? 1;

    const FX1 = W - M, X0 = M, X1 = W - M - 150, Y0 = 250, Y1 = H - 270, PW = X1 - X0, PH = Y1 - Y0;
    const out = [];
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`);
    out.push(`<rect width="${W}" height="${H}" fill="${bg}"/>`);
    out.push(`<defs><clipPath id="panel"><rect x="${X0}" y="${Y0}" width="${PW}" height="${PH}"/></clipPath></defs>`);

    // impact point: somewhere in the middle third of the pane
    const ix = X0 + PW * (0.3 + rnd() * 0.4), iy = Y0 + PH * (0.3 + rnd() * 0.4);
    const REACH = Math.hypot(PW, PH);
    out.push('<g clip-path="url(#panel)">');

    if (n === 0) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * 6.283 + rnd() * 0.3, len = REACH * (0.25 + rnd() * 0.5);
        out.push(`<path d="M${f1(ix)} ${f1(iy)}L${f1(ix + Math.cos(a) * len)} ${f1(iy + Math.sin(a) * len)}" stroke="${dim}" stroke-width=".7" fill="none"/>`);
      }
    } else {
      // ---- shard seeds: dense at the impact, sparse at the edge, kept apart by a distance that grows with the radius
      const N = clamp(Math.max(total, n), 12, MAX_SHARDS);
      const pts = [];
      const base = Math.sqrt((PW * PH) / N) * 0.38;
      for (let tries = 0; pts.length < N && tries < N * 400; tries++) {
        const r = REACH * Math.pow(rnd(), 1.7), a = rnd() * 6.283;
        const x = ix + Math.cos(a) * r, y = iy + Math.sin(a) * r;
        if (x < X0 - 20 || x > X1 + 20 || y < Y0 - 20 || y > Y1 + 20) continue;
        const dmin = base * (0.35 + 1.5 * clamp(r / (REACH * 0.7), 0, 1));
        if (pts.some((p) => (p[0] - x) ** 2 + (p[1] - y) ** 2 < dmin * dmin)) continue;
        pts.push([x, y]);
      }
      while (pts.length < N) pts.push([X0 + rnd() * PW, Y0 + rnd() * PH]);   // fill the rest if the spacing was too strict

      // ---- cells: each seed keeps the area closer to it than to any other seed (Voronoi, cut by half-planes)
      const box = [[X0 - 30, Y0 - 30], [X1 + 30, Y0 - 30], [X1 + 30, Y1 + 30], [X0 - 30, Y1 + 30]];
      const cells = pts.map((p, i) => {
        let poly = box;
        const near = pts.map((q, j) => [j, (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2]).filter((x) => x[0] !== i).sort((a, b) => a[1] - b[1]);
        for (const [j, d2] of near) {
          const far = poly.reduce((m, v) => Math.max(m, (v[0] - p[0]) ** 2 + (v[1] - p[1]) ** 2), 0);
          if (d2 > 4 * far) break;
          const q = pts[j];
          poly = clip(poly, q[0] - p[0], q[1] - p[1], (q[0] * q[0] + q[1] * q[1] - p[0] * p[0] - p[1] * p[1]) / 2);
          if (poly.length < 3) break;
        }
        return poly.length >= 3 ? { poly, c: p } : null;
      });

      // ---- colours: shards sorted by angle around the impact, handed out in runs, so each collection is a wedge
      const order = pts.map((p, i) => [i, (Math.atan2(p[1] - iy, p[0] - ix) + 3.14159) / 6.28318 + (rnd() - 0.5) * 0.03]).sort((a, b) => a[1] - b[1]).map((x) => x[0]);
      const wedges = bags.map((b) => ({ ...b })).sort(() => rnd() - 0.5);
      const W0 = wedges.reduce((t, b) => t + b.w, 0);
      let counts = wedges.map((b) => Math.max(1, Math.round((N * b.w) / W0)));
      for (let diff = N - counts.reduce((t, c) => t + c, 0); diff !== 0;) {          // settle the rounding on the biggest wedges
        const k = counts.indexOf(diff > 0 ? Math.max(...counts) : Math.max(...counts));
        if (diff < 0 && counts[k] <= 1) break;
        counts[k] += Math.sign(diff); diff -= Math.sign(diff);
      }
      const owner = new Array(N);
      let at = 0;
      counts.forEach((c, k) => { for (let m = 0; m < c && at < N; m++) owner[order[at++]] = wedges[k]; });
      while (at < N) owner[order[at]] = wedges[wedges.length - 1], at++;

      // ---- draw: every shard is pushed away from the impact and turned a little, more so near the centre
      const sh = [];
      cells.forEach((cell, i) => {
        if (!cell || !owner[i]) return;
        const col = owner[i].color;
        const cx = cell.poly.reduce((s, v) => s + v[0], 0) / cell.poly.length, cy = cell.poly.reduce((s, v) => s + v[1], 0) / cell.poly.length;
        const dx = cx - ix, dy = cy - iy, d = Math.hypot(dx, dy) || 1;
        const near = Math.exp(-d / 230);
        const push = (3 + 46 * near * (0.5 + rnd())) * blast, turn = (rnd() - 0.5) * 0.5 * near * blast, shrink = 0.9 + 0.06 * (1 - near);
        const ca = Math.cos(turn), sa = Math.sin(turn);
        const mv = ([x, y]) => {
          const rx = (x - cx) * shrink, ry = (y - cy) * shrink;
          return [cx + dx / d * push + rx * ca - ry * sa, cy + dy / d * push + rx * sa + ry * ca];
        };
        const poly = cell.poly.map(mv);
        const tone = mix(col, rnd() < 0.5 ? '#FFFFFF' : '#000000', 0.04 + rnd() * 0.12);
        const path = (p) => 'M' + p.map(([x, y]) => `${f1(x)} ${f1(y)}`).join('L') + 'Z';
        sh.push(`<path d="${path(poly)}" fill="${tone}"/>`);
        if (facet > 0) {                                    // a lit half and a shaded half, split through the middle at a random angle
          const a = rnd() * 6.283, nx = Math.cos(a), ny = Math.sin(a), mc = mv([cx, cy]), c = nx * mc[0] + ny * mc[1];
          const lit = clip(poly, -nx, -ny, -c), shade = clip(poly, nx, ny, c);
          if (lit.length > 2) sh.push(`<path d="${path(lit)}" fill="#FFFFFF" opacity="${f1(0.14 * facet) }"/>`);
          if (shade.length > 2) sh.push(`<path d="${path(shade)}" fill="#000000" opacity="${f1(0.16 * facet)}"/>`);
        }
        sh.push(`<path d="${path(poly)}" fill="none" stroke="${mix(col, '#FFFFFF', 0.55)}" stroke-width=".7" opacity=".55"/>`);
      });
      out.push(sh.join(''));

      // dust: tiny splinters thrown out of the impact
      const specks = Math.round(160 * dust);
      let dp = '';
      for (let k = 0; k < specks; k++) {
        const a = rnd() * 6.283, r = REACH * Math.pow(rnd(), 1.4) * 0.8, x = ix + Math.cos(a) * r, y = iy + Math.sin(a) * r, s = 1 + rnd() * 2.6, t = rnd() * 6.283;
        dp += `M${f1(x)} ${f1(y)}l${f1(Math.cos(t) * s * 2)} ${f1(Math.sin(t) * s * 2)}l${f1(Math.cos(t + 2.1) * s)} ${f1(Math.sin(t + 2.1) * s)}z`;
      }
      const dcol = (bags[Math.floor(rnd() * bags.length)] || {}).color || fg;
      out.push(`<path d="${dp}" fill="${dcol}" opacity=".8"/>`);
    }
    out.push('</g>');
    out.push(`<rect x="${X0}" y="${Y0}" width="${PW}" height="${PH}" fill="none" stroke="${fg}" stroke-width="1.2"/>`);

    // ---- legend: the biggest collections, with a swatch, in the right margin
    const top = [...bags].sort((a, b) => b.w - a.w || String(a.name).localeCompare(String(b.name))).slice(0, 12);
    top.forEach((b, k) => {
      const y = Y0 + 8 + k * 22;
      out.push(`<rect x="${X1 + 16}" y="${y}" width="9" height="9" fill="${b.color}"/>`);
      out.push(`<text x="${X1 + 32}" y="${y + 8}" font-family="JetBrains Mono" font-size="10" font-weight="600" fill="${fg}">${esc(String(b.name).toUpperCase().slice(0, 11))} ×${b.n}</text>`);
    });

    // ---- header and footer, as on the Strata sheet
    out.push(`<text x="${M}" y="150" font-family="Big Shoulders Display" font-weight="800" font-size="104" letter-spacing="2" fill="${fg}">STRATA</text>`);
    out.push(`<path d="M${M + 273} 150l15 -26l15 26z" fill="${RED}"/>`);
    out.push(`<text x="${FX1}" y="76" text-anchor="end" font-family="JetBrains Mono" font-size="12" font-weight="600" letter-spacing="3" fill="${dim}">${esc((opts.label || 'WALLET').toUpperCase())}</text>`);
    out.push(`<text x="${FX1}" y="150" text-anchor="end" font-family="JetBrains Mono" font-size="12" font-weight="600" letter-spacing="3" fill="${dim}">${n} COLLECTION${n === 1 ? '' : 'S'} · ${total} NFT${total === 1 ? '' : 'S'}</text>`);
    out.push(`<path d="M${M} 190h${FX1 - M}" stroke="${fg}" stroke-width="1.2"/>`);
    out.push(`<text x="${M}" y="222" font-family="JetBrains Mono" font-size="12" font-weight="600" letter-spacing="3" fill="${dim}">FRACTURE · AVALANCHE C-CHAIN</text>`);
    const FY = H - 200;
    out.push(`<path d="M${M} ${FY}h${FX1 - M}" stroke="${fg}" stroke-width="1.2"/>`);
    out.push(`<text x="${M}" y="${FY + 44}" font-family="JetBrains Mono" font-size="12" font-weight="600" letter-spacing="3" fill="${dim}">${esc((opts.line1 || 'EVERY SHARD IS ONE NFT').toUpperCase())}</text>`);
    out.push(`<text x="${M}" y="${FY + 70}" font-family="JetBrains Mono" font-size="12" font-weight="600" letter-spacing="3" fill="${dim}">${esc((opts.line2 || 'ONE WALLET, ONE FRACTURE. NEVER DRAWN TWICE.').toUpperCase())}</text>`);
    out.push(`<text x="${M}" y="${FY + 132}" font-family="JetBrains Mono" font-size="10" letter-spacing="3" fill="${dim}">${esc(opts.footer || 'STRATA. · STRAATA.XYZ')}</text>`);
    out.push('</svg>');
    return out.join('');
  }

  root.StrataPrintShards = { generate, W, H };
})(typeof globalThis !== 'undefined' ? globalThis : this);
