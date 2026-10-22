/* STRATA. Riot: the piece that compounds. One sheet, 50 × 70 with a white border; level 1 is a rectangle made of
 * black drops, every level after it one more spray of paint in its own colour, all drawn from the reinvest transactions'
 * hashes (`hashes[L - 1]` is the tx hash that made level L; a reinvest of N credits gives N levels the same hash).
 * Nothing already drawn ever changes: a level only adds drops on top. Pure SVG, so the browser and the server
 * (resvg → PNG) draw the very same picture. Exposes globalThis.StrataRiot. */
(function (root) {
  const W = 1000, H = 1400, M = 84, FOOT = 110;
  const X0 = M, Y0 = M, PW = W - 2 * M, PH = H - M - FOOT;
  // one colour per level: black for the rectangle, then painters' colours (no neon), level 10 the red
  const INK = ['#0A0A0A', '#2D9CDB', '#13886A', '#3A4FD9', '#F2C12E', '#EE7623', '#C2307A', '#5B3A9E', '#9BC53D', '#E84142'];
  const NAMES = ['Black', 'Sky', 'Green', 'Blue', 'Yellow', 'Orange', 'Magenta', 'Violet', 'Lime', 'Red'];

  function fnv(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(s) { let a = fnv(String(s)); return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const f1 = (v) => Math.round(v * 10) / 10;

  // one throw of paint: from a point, in a direction; drops get smaller the further they fly, the fast ones stretch a little
  function spray(R, ox, oy, ang, count, reach, big, fan = 1) {
    const out = [];
    for (let k = 0; k < count; k++) {
      const far = Math.pow(R(), 1.15) * reach, side = (R() - 0.5) * (18 + far * 0.55 * fan);
      const x = ox + Math.cos(ang) * far - Math.sin(ang) * side, y = oy + Math.sin(ang) * far + Math.cos(ang) * side;
      const r = Math.max(0.9, (1 - far / (reach * 1.1)) * (1 + Math.pow(R(), 4) * big));
      const stretch = far > reach * 0.35 && R() < 0.3 ? 1 + R() * 1.4 : 1;
      out.push([x, y, r, stretch, ang, far]);
    }
    return out;
  }

  /** The drops of level L made by tx `hash`: { color, drops: [[x, y, r, stretch, angle, distance]…] }. */
  function layer(hash, L) {
    const h = String(hash).toLowerCase();
    const inPic = (x, y, r) => x > X0 - r && x < X0 + PW + r && y > Y0 - r && y < Y0 + PH + r;
    const onPaper = (x, y, r) => x - r > 24 && x + r < W - 24 && y - r > 24 && y + r < Y0 + PH + 26;   // never into the foot band
    const R = rng(h + ':' + L), drops = [];
    if (L === 1) {
      // the rectangle: black drops on white paper, dense enough to read as a block, the paper showing between them;
      // how full is up to the hash (1× is the minimum the owner approved), plus throws that spill past its edges
      const cell = 22, density = 1 + Math.pow(R(), 1.5) * 1.6;
      for (let y = Y0; y < Y0 + PH; y += cell) for (let x = X0; x < X0 + PW; x += cell) {
        const n = Math.round((3 + Math.floor(R() * 6)) * density);
        for (let k = 0; k < n; k++) drops.push([x + R() * cell, y + R() * cell, 2 + Math.pow(R(), 1.6) * 11, 1, 0, 0]);
      }
      const throws = 18 + Math.floor(R() * 12);
      for (let t = 0; t < throws; t++) {
        const ex = R() < 0.5, x = ex ? X0 + (R() < 0.5 ? 0 : PW) : X0 + R() * PW, y = ex ? Y0 + R() * PH : Y0 + (R() < 0.5 ? 0 : PH);
        drops.push(...spray(R, x, y, Math.atan2(y - (Y0 + PH / 2), x - (X0 + PW / 2)) + (R() - 0.5), 30 + Math.floor(R() * 50), 60 + R() * 90, 8));
      }
    } else {
      // two to four throws, each from its own spot anywhere on the picture, so the colour falls spread over the painting
      const throws = 2 + Math.floor(R() * 3);
      for (let t = 0; t < throws; t++) drops.push(...spray(R, X0 + PW * (0.05 + R() * 0.9), Y0 + PH * (0.05 + R() * 0.9), R() * Math.PI * 2, 110 + Math.floor(R() * 220), 380 + R() * 420, 30, 1.6));
    }
    // inside the picture everything shows; past the edge, a share of the drops stays on the white paper
    const sp = rng(h + ':spill:' + L);
    return { color: INK[L - 1], drops: drops.filter(([x, y, r]) => inPic(x, y, r) || (sp() < 0.45 && onPaper(x, y, r))) };
  }

  const dropSVG = ([x, y, r, s, a]) => s > 1
    ? `<ellipse cx="${f1(x)}" cy="${f1(y)}" rx="${f1(r * s)}" ry="${f1(r)}" transform="rotate(${f1(a * 180 / Math.PI)} ${f1(x)} ${f1(y)})"/>`
    : `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}"/>`;

  /** The sheet as SVG, levels 1…upTo (default: every hash given). */
  function svg(hashes, upTo = hashes.length) {
    const groups = hashes.slice(0, upTo).map((h, i) => { const l = layer(h, i + 1); return `<g fill="${l.color}">${l.drops.map(dropSVG).join('')}</g>`; }).join('');
    // drops inside the picture are clipped to it, and drawn again unclipped only where they spilled onto the paper
    return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">`
      + `<defs><clipPath id="pic"><rect x="${X0}" y="${Y0}" width="${PW}" height="${PH}"/></clipPath>`
      + `<mask id="paper"><rect width="${W}" height="${H}" fill="#fff"/><rect x="${X0}" y="${Y0}" width="${PW}" height="${PH}" fill="#000"/></mask></defs>`
      + `<rect width="${W}" height="${H}" fill="#FFFFFF"/><g clip-path="url(#pic)">${groups}</g><g mask="url(#paper)">${groups}</g></svg>`;
  }

  root.StrataRiot = { W, H, X0, Y0, PW, PH, INK, NAMES, MAX_LEVEL: 10, layer, svg };
})(typeof globalThis !== 'undefined' ? globalThis : this);
