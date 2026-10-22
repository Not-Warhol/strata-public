/* STRATA. Print — the parts every sheet shares, so the store's preview, the studio and the printed file are the same picture:
 * the wallet's origin hash as a block of 4 lines bottom left, the code stamp (the certificate) bottom right, both 6 mm in from the
 * edge of an A4 (29 units; it grows with the sheet), and an optional line of text. The stamp takes the triangle's red when it reads
 * on the sheet, otherwise black or white, whichever stands out more. Pure. Exposes globalThis.StrataPrintSheet. */
(function (root) {
  const W = 1000, H = 1414, M = 84, RED = '#E84142', SAFE = 29, FOOT = 110, BASE = H - SAFE - 5;   // BASE: the last line of the block, the line and the stamp
  const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const day = (ms) => { const d = new Date(ms); return `${String(d.getUTCDate()).padStart(2, '0')} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };

  const lum = (c) => { const n = parseInt(c.slice(1), 16), f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(n >> 16) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255); };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  /** The stamp's colour on a sheet colour: the red when it reads (contrast 3 or more), else black or white. */
  const inkFor = (bg) => contrast(RED, bg) >= 3 ? RED : (contrast('#111111', bg) >= contrast('#F4F4F4', bg) ? '#111111' : '#F4F4F4');
  const textFor = (bg) => (lum(bg) > 0.4 ? '#111111' : '#F2F2F2');

  /** The origin hash (0x… 64 hex) as 4 lines of 16, bottom left. */
  function block(origin, bg = '#FFFFFF') {
    const h = String(origin || '').replace(/^0x/, '').padEnd(64, '·').slice(0, 64), fg = textFor(bg);
    return [0, 1, 2, 3].map((k) => `<text x="${M}" y="${BASE - 45 + k * 15}" font-family="JetBrains Mono" font-size="13.5" font-weight="700" letter-spacing="2.2" fill="${fg}">${h.slice(k * 16, k * 16 + 16)}</text>`).join('');
  }
  /** The code stamp, bottom right. c: { title ('N° 0042', 'PERSONA #1234'), date (ms), code (8 characters), fp (32 hex: 128 dots) }. */
  function stamp(c, bg = '#FFFFFF') {               // absolute positions (no group transform), so the studio's PNG export can redraw its text
    const ink = inkFor(bg), ox = W - M - 75, oy = H - SAFE - 31, r = (v) => Math.round(v * 100) / 100;
    // { title } alone (no code): the generic stamp the store shows before payment; the number, date, code and dots come only with a paid order
    const blank = !c.code;
    const bits = blank ? [] : String(c.fp).slice(0, 32).padEnd(32, '0').split('').flatMap((x) => parseInt(x, 16).toString(2).padStart(4, '0').split(''));
    let dots = blank ? `<rect x="${r(ox - 72.5)}" y="${r(oy - 9.5)}" width="${r(32 * 4.5)}" height="${r(4 * 4.5)}" fill="none" stroke="${ink}" stroke-width="0.6" stroke-dasharray="1.6 1.6"/>` : '';
    bits.forEach((b, i) => { if (b === '1') dots += `<rect x="${r(ox - 72 + (i % 32) * 4.5)}" y="${r(oy - 9 + Math.floor(i / 32) * 4.5)}" width="3.4" height="3.4" fill="${ink}"/>`; });
    const t = (x, y, size, weight, ls, str) => `<text x="${r(ox + x)}" y="${r(oy + y)}" font-family="JetBrains Mono" font-size="${size}" font-weight="${weight}" letter-spacing="${ls}" fill="${ink}">${esc(str)}</text>`;
    return `<path d="M${r(ox - 72)} ${r(oy - 16)} l5 -8.7 l5 8.7 z" fill="${ink}"/>` + t(-58, -16.5, 8, 700, 1.2, `STRATA. ${c.title}`) + dots
      + t(-72, 17.5, 5.8, 600, 0.9, blank ? 'DATED WHEN PAID' : day(c.date)) + t(-72, 26, 5.8, 600, 0.9, `STRAATA.XYZ/V/${blank ? '--------' : c.code}`);
  }
  /** A centred line of small capitals at height y. */
  const line = (text, y, bg = '#FFFFFF') => `<text x="${W / 2}" y="${y}" text-anchor="middle" font-family="JetBrains Mono" font-size="8" font-weight="700" letter-spacing="1.6" fill="${textFor(bg)}">${esc(String(text).toUpperCase())}</text>`;
  /** The store's rule for every sheet: the origin hash bottom left and the stamp bottom right, on a band kept free at the bottom.
   *  how: 'strip' (Dither, Tiles: their own text goes, the piece was drawn with foot = FOOT) | 'band' (Cubes: a band in the sheet's colour
   *  closes the bottom) | 'none' (already drawn for it). stamp: { title, date, code, fp }. */
  function dress(svg, { how = 'none', origin, stamp: st, parts = [] } = {}) {
    const bg = svg.match(/<rect width="1000" height="1414" fill="([^"]+)"/)?.[1] || '#FFFFFF';
    if (how === 'strip') svg = svg.replace(/<text[\s\S]*?<\/text>/g, '');
    if (how === 'band') svg = svg.replace(/<\/svg>\s*$/, `<rect x="-200" y="${H - FOOT}" width="${W + 400}" height="400" fill="${bg}"/></svg>`);
    return finish(svg, [...parts, block(origin, bg), stamp(st, bg)]);
  }

  /** Adds parts to a sheet (an SVG string) just before its end. */
  const finish = (svg, parts) => svg.replace(/<\/svg>\s*$/, parts.join('') + '</svg>');

  root.StrataPrintSheet = { block, stamp, line, finish, dress, inkFor, day, SAFE, FOOT, BASE, W, H, M };
})(typeof globalThis !== 'undefined' ? globalThis : this);
