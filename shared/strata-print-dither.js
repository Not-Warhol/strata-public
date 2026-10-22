/* STRATA. Print — "Dither". Ported from the owner's p5 sketch of rectangle compositions: black-and-white gradients packed into a grid
 * of rectangles, dithered with Floyd–Steinberg, three times (one per colour channel), then laid over white with the DIFFERENCE
 * blend. The difference of the three dithered layers on white is simply each channel inverted, so the result is an image
 * of 8 colours only: black, white, red, green, blue, cyan, magenta and yellow.
 * The wallet's TRANSACTIONS draw it, not its NFTs. The number of transactions sets the grid (N = 1..4 columns, as the sketch's N:
 * under 10 transactions 1, under 100 2, under 1000 3, from 1000 4). The three channels are the wallet's history in time: the
 * oldest third of its transactions seeds the red layer, the middle third the green one and the newest third the blue one, so
 * the packing, the direction of every gradient and which end is white all come from the transaction hashes. A failed
 * transaction counts as another hash. Same transactions and variant, same image; a new transaction makes another image.
 * The picture is a small indexed PNG (every pixel is 4 print pixels or more) placed on the sheet as an <image> with
 * image-rendering="optimizeSpeed", which resvg draws as nearest-neighbour; browsers need CSS `image { image-rendering: pixelated }`.
 * Pure (no p5, no canvas, no network). Exposes globalThis.StrataPrintDither. */
(function (root) {
  const W = 1000, H = 1414, M = 84, PX = 1.45;               // PX: size of one dither pixel in sheet units (about 0.4 mm on A3)
  const PALETTE = [[0, 0, 0], [255, 0, 0], [0, 255, 0], [255, 255, 0], [0, 0, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255]];   // index = r + 2g + 4b of the INVERTED bits

  function fnv(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(s) { let a = fnv(String(s)); return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---- rectangle packing (the sketch's createComposition, with a seeded random)
  const hit = (a, b) => ((a.i <= b.i && a.i + a.si > b.i) || (b.i <= a.i && b.i + b.si > a.i)) && ((a.j <= b.j && a.j + a.sj > b.j) || (b.j <= a.j && b.j + b.sj > a.j));
  function widest(rects, iMax, siMax, i, j, si, sj) {
    let s = si, stop = false;
    while (!stop) { s++; for (const r of rects) if (i + s > iMax || s > siMax || hit({ i, j, si: s, sj }, r)) { stop = true; break; } }
    return s - 1;
  }
  function tallest(rects, jMax, sjMax, i, j, si, sj) {
    let s = sj, stop = false;
    while (!stop) { s++; for (const r of rects) if (j + s > jMax || s > sjMax || hit({ i, j, si, sj: s }, r)) { stop = true; break; } }
    return s - 1;
  }
  function compose(rnd, cols, rows) {
    const rects = [];
    for (let k = 0; k < 1000; k++) {
      const i = Math.floor(rnd() * cols), j = Math.floor(rnd() * rows);
      let si, sj;
      if (!rects.length) { si = cols - i; sj = rows - j; }
      else {
        const si1 = widest(rects, cols, cols, i, j, 1, 1), sj1 = tallest(rects, rows, rows, i, j, si1, 1);
        const sj2 = tallest(rects, rows, rows, i, j, 1, 1), si2 = widest(rects, cols, cols, i, j, 1, sj2);
        if (si1 * sj1 > si2 * sj2) { si = si1; sj = sj1; } else { si = si2; sj = sj2; }
      }
      if (((si > 1 || sj > 1) && rnd() < 0.5) || (si > 1 && sj > 1)) rects.push({ i, j, si, sj });   // no 1x1 squares, no thin ones
    }
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {                                   // fill the gaps with 1x1
      const c = { i, j, si: 1, sj: 1 };
      if (!rects.some((r) => hit(c, r))) rects.push(c);
    }
    return rects;
  }

  /** One colour channel: gradients in the rectangles, then Floyd–Steinberg (same pass order as the sketch). Returns the layer as floats: the sketch also pushes error into the already-finished neighbour (x-1, y+1), so read it with > 128. */
  function layer(rnd, cols, rows, gw, gh) {
    const buf = new Float32Array(gw * gh), cw = gw / cols, ch = gh / rows;
    for (const r of compose(rnd, cols, rows)) {
      let a = 255, b = 0; if (rnd() < 0.5) [a, b] = [b, a];            // white to black, or the other way
      const vertical = rnd() < 0.5;                                       // direction of the gradient
      const x0 = Math.round(r.i * cw), x1 = Math.round((r.i + r.si) * cw), y0 = Math.round(r.j * ch), y1 = Math.round((r.j + r.sj) * ch);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const t = vertical ? (y - y0 + 0.5) / (y1 - y0) : (x - x0 + 0.5) / (x1 - x0);
        buf[y * gw + x] = a + (b - a) * t;
      }
    }
    for (let x = 0; x < gw; x++) for (let y = 0; y < gh; y++) {
      const v = buf[y * gw + x], q = v > 128 ? 255 : 0, e = v - q;
      buf[y * gw + x] = q;
      if (x < gw - 1) buf[y * gw + x + 1] += (e * 7) / 16;
      if (y < gh - 1) {
        if (x > 0) buf[(y + 1) * gw + x - 1] += (e * 3) / 16;
        buf[(y + 1) * gw + x] += (e * 5) / 16;
        if (x < gw - 1) buf[(y + 1) * gw + x + 1] += e / 16;
      }
    }
    return buf;
  }

  // ---- a tiny PNG writer: 4-bit indexed, stored (uncompressed) deflate blocks
  const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = crcT[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function chunk(type, data) {
    const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
    dv.setUint32(0, data.length); for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8); dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  }
  function png4(idx, w, h) {                                              // idx: Uint8Array of palette indexes 0..15, w*h
    const rowBytes = (w + 1) >> 1, raw = new Uint8Array((rowBytes + 1) * h);
    for (let y = 0; y < h; y++) { const o = y * (rowBytes + 1); raw[o] = 0; for (let x = 0; x < w; x++) raw[o + 1 + (x >> 1)] |= (idx[y * w + x] & 15) << (x & 1 ? 0 : 4); }
    const blocks = Math.ceil(raw.length / 65535), z = new Uint8Array(2 + raw.length + blocks * 5 + 4);
    z[0] = 0x78; z[1] = 0x01; let p = 2, a = 1, b = 0;
    for (let o = 0; o < raw.length; o += 65535) {
      const n = Math.min(65535, raw.length - o); z[p++] = o + n >= raw.length ? 1 : 0; z[p++] = n & 255; z[p++] = n >> 8; z[p++] = ~n & 255; z[p++] = (~n >> 8) & 255;
      z.set(raw.subarray(o, o + n), p); p += n;
    }
    for (let i = 0; i < raw.length; i++) { a = (a + raw[i]) % 65521; b = (b + a) % 65521; }
    new DataView(z.buffer).setUint32(p, ((b << 16) | a) >>> 0);
    const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer); dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 4; ihdr[9] = 3;
    const plte = new Uint8Array(PALETTE.flat());
    const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('PLTE', plte), chunk('IDAT', z), chunk('IEND', new Uint8Array(0))];
    const out = new Uint8Array(parts.reduce((n, q) => n + q.length, 0)); let o = 0; for (const q of parts) { out.set(q, o); o += q.length; }
    return out;
  }
  function b64(u8) {
    if (typeof Buffer !== 'undefined') return Buffer.from(u8).toString('base64');
    let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }

  /** Grid size from the number of transactions: 1 column up to 4 (under 10 -> 1, under 100 -> 2, under 1000 -> 3, 1000 or more -> 4). */
  const gridFor = (transactions) => Math.max(1, Math.min(4, String(Math.max(0, Math.floor(transactions))).length));

  /** opts: { seed, variant?, txs: [{ h: hash, f?: true when it failed }] oldest first, tx?: { ok, failed } (the true counts, when txs is only the latest part), label?, credit?, bg?, foot? (height of the bottom margin under the picture, default 84; the store's sheets use 110 to leave a print-safe band for the origin hash and the stamp) }
   *  The picture fills the sheet; one line of text at the bottom. */
  function generate(opts) {
    const txs = opts.txs || [];
    const total = opts.tx ? Math.round(opts.tx.ok + opts.tx.failed) : txs.length;
    const failed = opts.tx ? Math.round(opts.tx.failed) : txs.filter((t) => t.f).length;
    const bg = opts.bg || '#000000', light = /^#f/i.test(bg), dim = light ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.55)';   // dark text on a white sheet
    const X0 = M, Y0 = M, PW = W - 2 * M, PH = H - (opts.foot ?? 84) - Y0;
    const cols = gridFor(total), rows = Math.max(1, Math.round(cols * PH / PW));
    const gw = Math.round(PW / PX), gh = Math.round(PH / PX);
    const sk = String(opts.seed).toLowerCase() + (opts.variant ? ':v' + opts.variant : '');
    const third = Math.ceil(txs.length / 3);
    const layerSeed = (k) => `strata-dither:${sk}:${k}:` + txs.slice(k * third, (k + 1) * third).map((t) => t.h + (t.f ? 'f' : '')).join('');
    const L = [0, 1, 2].map((k) => layer(rng(layerSeed(k)), cols, rows, gw, gh));        // red = oldest third of the history, green = middle, blue = newest
    const idx = new Uint8Array(gw * gh);
    for (let k = 0; k < idx.length; k++) idx[k] = (L[0][k] > 128 ? 0 : 1) + (L[1][k] > 128 ? 0 : 2) + (L[2][k] > 128 ? 0 : 4);      // channel = 255 - layer: the difference on white
    const png = b64(png4(idx, gw, gh));
    const line = [opts.label, `${total} TRANSACTION${total === 1 ? '' : 'S'}${failed ? ` · ${failed} FAILED` : ''}`, (opts.credit || 'created by the artist notwarhol for STRATA.').toUpperCase()].filter(Boolean).join('  ·  ');
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`
      + `<rect width="${W}" height="${H}" fill="${bg}"/>`
      + `<image x="${X0}" y="${Y0}" width="${PW}" height="${PH}" preserveAspectRatio="none" image-rendering="optimizeSpeed" href="data:image/png;base64,${png}" xlink:href="data:image/png;base64,${png}"/>`
      + `<text x="${W / 2}" y="${H - 40}" font-family="JetBrains Mono" font-weight="600" text-anchor="middle" font-size="8.5" letter-spacing="1" fill="${dim}">${esc(line)}</text></svg>`;
  }

  root.StrataPrintDither = { generate, gridFor, W, H };
})(typeof globalThis !== 'undefined' ? globalThis : this);
