/* STRATA. Special drop: Pharaoh Birthday. The only things a Passage token draws for itself: its traits, rolled from
 * the token's seed with fixed odds. Everything else (the walls: Pharaoh V3's first year, the posts, the neon) is the
 * same in every token. Used by the piece (browser) and the server's metadata. Exposes globalThis.PharaohTraits. */
(function (root) {
  // [name, weight, value the shader reads]
  const LUCK = {
    corridor: [['Triangle', 60, 3], ['Square', 22, 4], ['Hexagon', 11, 6], ['Round', 7, 0]],
    core:     [['Standing', 62, 0], ['Sliced', 13, 3], ['Wireframe', 13, 4], ['Particles', 12, 5]],
    material: [['Red', 34, 0], ['Chrome', 11, 1], ['Glass', 9, 5], ['Obsidian', 8, 2], ['Ledger', 8, 6], ['Gold', 6, 3], ['Molten', 6, 7], ['Marble', 6, 8], ['Sandstone', 4, 10], ['Circuit', 4, 9], ['Prism', 4, 4]],
    effect:   [['None', 62, 0], ['Glitch', 10, 1], ['Hologram', 8, 2], ['Pulse', 7, 4], ['Scan', 6, 5], ['Shatter', 4, 3], ['Orbit', 3, 6]],
    negative: [['No', 97, 0], ['Yes', 3, 1]],
    prints:   [['Engraved', 80, 0], ['Original', 20, 1]],
  };
  const NAMES = { corridor: 'Corridor', core: 'Logo', material: 'Material', effect: 'Logo effect', negative: 'Negative', prints: 'Prints' };
  function fnv(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(s) { let a = fnv(s); return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  /** { corridor: [name, weight, value], … } for a seed string (a token's on-chain seed, lowercase hex). */
  function roll(seed) {
    const R = rng(String(seed).toLowerCase()), out = {};
    for (const k in LUCK) {
      const tot = LUCK[k].reduce((a, x) => a + x[1], 0);
      let r = R() * tot, pick = LUCK[k][0];
      for (const x of LUCK[k]) { if (r < x[1]) { pick = x; break; } r -= x[1]; }
      out[k] = pick;
    }
    return out;
  }
  root.PharaohTraits = { LUCK, NAMES, roll };
})(typeof globalThis !== 'undefined' ? globalThis : this);
