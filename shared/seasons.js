/* Strata — C-Chain seasons, scoring and tiers.
 * Shared file: runs in the browser (<script>) and in Node (side-effect import).
 * Exposes globalThis.StrataSeasons.
 * Dates are editorial approximations. Edit them here; this is the only place they live. */
(function (root) {
  const D = (s) => Math.floor(Date.parse(s) / 1000);

  // start = season start (unix s). A season ends when the next one starts.
  // Genesis is recalculated from the real timestamp of C-Chain block 1 (setGenesis).
  const SEASONS = [
    { id: 'genesis', name: 'Genesis Day', start: D('2020-09-23T00:00:00Z'), price: '0',
      blurb: 'First 24 hours of the C-Chain. You were early before early was a meme. Free mint.',
      palette: ['#C9A227', '#F6E7B0', '#FFFDF4', '#5B470B', '#E84142'], bg: '#FBF6E4' },
    { id: 'season-0', name: 'Season 0', start: D('2020-09-24T00:00:00Z'), price: '0.05',
      blurb: 'No bridge, no DEX, no friends. Just you and the validators.',
      palette: ['#2E4A62', '#9DB8CF', '#EEF3F7', '#132130', '#E84142'], bg: '#E9EEF2' },
    { id: 'defi-dawn', name: 'DeFi Dawn', start: D('2021-02-09T00:00:00Z'), price: '0.08',
      blurb: 'Pangolin, then Joe. You provided liquidity and called it a personality.',
      palette: ['#2F7D6D', '#A7D8C9', '#F2F8F5', '#0F3A32', '#E84142'], bg: '#EDF5F1' },
    { id: 'rush', name: 'Avalanche Rush', start: D('2021-08-18T00:00:00Z'), price: '0.12',
      blurb: 'Free money season. Everyone was a genius for about six weeks.',
      palette: ['#E84142', '#FFB9AE', '#FFF3EF', '#5C0E12', '#1C2230'], bg: '#FFF3EF' },
    { id: 'wonderland', name: 'Time Wonderland', start: D('2021-10-15T00:00:00Z'), price: '0.15',
      blurb: '(3,3), four-digit APY and a treasury you trusted. We don\'t talk about it.',
      palette: ['#6B4FA0', '#CDBBF0', '#F5F1FC', '#27163F', '#E0B64B'], bg: '#F4F0FB' },
    { id: 'thaw', name: 'The Great Thaw', start: D('2022-02-01T00:00:00Z'), price: '0.25',
      blurb: 'Terra, FTX, the whole buffet. You stayed. Nobody knows why.',
      palette: ['#5E7686', '#C6D3DC', '#F2F5F7', '#222E36', '#E84142'], bg: '#EDF1F4' },
    { id: 'arena', name: 'Rebuild', start: D('2023-03-01T00:00:00Z'), price: '0.35',
      blurb: 'Subnets, social-fi and buying tickets to people\'s group chats.',
      palette: ['#D9731E', '#F7CBA0', '#FFF7EE', '#4A2408', '#1C2230'], bg: '#FFF6EC' },
    { id: 'meme-rush', name: 'Meme Rush', start: D('2023-11-15T00:00:00Z'), price: '0.45',
      blurb: 'Chickens, inscriptions and a coin for every animal on the farm.',
      palette: ['#E0A800', '#FF7DBB', '#FFFBE8', '#1C2230', '#E84142'], bg: '#FFFAE3' },
    { id: 'long-winter', name: 'Long Winter', start: D('2024-04-01T00:00:00Z'), price: '0.6',
      blurb: 'Charts went sideways. So did your sleep schedule.',
      palette: ['#3A5A8C', '#AFC3E5', '#EFF4FB', '#121C2E', '#E84142'], bg: '#EEF3FB' },
    { id: 'a9000', name: 'Avalanche9000', start: D('2024-12-16T00:00:00Z'), price: '0.8',
      blurb: 'Cheap L1s for everyone. Your chain gets a chain.',
      palette: ['#B3122E', '#F29AA7', '#FDF1F3', '#3D0610', '#1C2230'], bg: '#FCEFF1' },
    { id: 'fresh-snow', name: 'Fresh Snow', start: D('2026-01-01T00:00:00Z'), price: '1',
      blurb: 'Fresh wallet, new-car smell. Full price, no discount for vibes.',
      palette: ['#7F95A3', '#DCE5EB', '#FAFCFD', '#26323B', '#E84142'], bg: '#F6F9FB' },
  ];

  function setGenesis(ts) {
    if (!ts) return;
    SEASONS[0].start = ts;
    SEASONS[1].start = ts + 86400;
  }

  function seasonIndexFor(ts) {
    if (ts == null) return SEASONS.length - 1;
    let idx = 0;
    for (let i = 0; i < SEASONS.length; i++) if (ts >= SEASONS[i].start) idx = i;
    return idx;
  }

  function seasonEnd(i) {
    return i + 1 < SEASONS.length ? SEASONS[i + 1].start : null;
  }

  // Score 0–1000. Age weighs most; recent activity cannot buy age.
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  function computeScore(m) {
    const parts = {
      age: Math.round(clamp01(m.ageDays / 2100) * 300),
      transactions: Math.round(clamp01(Math.log10((m.sent || 0) + 1) / 4) * 250),
      months: Math.round(clamp01((m.activeMonths || 0) / 48) * 200),
      contracts: Math.round(clamp01((m.contracts || 0) / 80) * 120),
      tokens: Math.round(clamp01((m.tokens || 0) / 60) * 80),
      nfts: Math.round(clamp01((m.nfts || 0) / 25) * 50),
    };
    const score = Object.values(parts).reduce((a, b) => a + b, 0);
    return { score, parts };
  }

  const TIERS = [
    { min: 0, name: 'Tourist' },
    { min: 150, name: 'Exit Liquidity' },
    { min: 300, name: 'Bag Holder' },
    { min: 450, name: 'Floor Sweeper' },
    { min: 600, name: 'Diamond Mittens' },
    { min: 750, name: 'Degen Elder' },
    { min: 900, name: 'Ancient Validator' },
  ];
  function tierFor(score) {
    let t = 0;
    for (let i = 0; i < TIERS.length; i++) if (score >= TIERS[i].min) t = i;
    return { index: t, name: TIERS[t].name };
  }

  /** Drop pricing (all numbers live in drops/index.json → pricing).
   *  0 NFTs from the list           → `none` (100 AVAX)
   *  exactly 1 NFT                  → `single` (1 AVAX), no discount
   *  otherwise base = top × (of − collections) / (of − 1), where top = `max`, or `fresh.max` for young wallets
   *  then a discount per NFT held from the list: `discount.perNft` for most collections,
   *  `discount.perBoostedNft` for boosted ones, capped at `discount.max` (fresh wallets: fresh.* rates and cap).
   *  w = { collections, nfts, boostNfts, ageDays }. Returns { price, base, discount, tier } (0.001 AVAX). */
  const r3 = (x) => Math.round(x * 1000) / 1000;
  function priceForBags(w, pr) {
    const held = Math.max(0, Math.min(w.collections || 0, pr.of));
    const nfts = w.nfts ?? held;
    if (held === 0 || nfts === 0) return { price: String(Number(pr.none)), base: String(Number(pr.none)), discount: 0, tier: 'none' };
    if (nfts === 1) return { price: String(Number(pr.single)), base: String(Number(pr.single)), discount: 0, tier: 'single' };
    const fresh = pr.fresh && w.ageDays != null && w.ageDays < pr.fresh.days;
    const rates = fresh ? { perNft: pr.fresh.perNft, perBoostedNft: pr.fresh.perBoostedNft, max: pr.fresh.cap } : pr.discount;
    const base = Number(fresh ? pr.fresh.max : pr.max) * (pr.of - held) / (pr.of - 1);
    const boosted = Math.max(0, Math.min(w.boostNfts || 0, nfts));
    const raw = (nfts - boosted) * rates.perNft + boosted * rates.perBoostedNft;
    const discount = Math.round(Math.min(rates.max, raw) * 10000) / 10000;
    return { price: String(r3(base * (1 - discount))), base: String(r3(base)), discount, tier: fresh ? 'fresh' : 'standard' };
  }
  function describePricing(pr) {
    const pc = (x) => `${Math.round(x * 1000) / 10}%`;
    const d = pr.discount;
    let t = `With two or more NFTs from the list, a piece costs at most ${pr.max} AVAX, and less with every extra collection you hold, down to free with all of them. Exactly one NFT: ${pr.single} AVAX.`;
    t += ` Then every NFT you hold from the list takes ${pc(d.perNft)} off, and ${pc(d.perBoostedNft)} for the collections marked ${pc(d.perBoostedNft)}, up to ${pc(d.max)} in total.`;
    if (pr.fresh) t += ` Wallets younger than ${pr.fresh.days} days start at ${pr.fresh.max} AVAX with half the discount (${pc(pr.fresh.perNft)} and ${pc(pr.fresh.perBoostedNft)} per NFT, up to ${pc(pr.fresh.cap)}).`;
    t += ` Wallets with nothing from the list can still mint, but pay a ${pr.none} AVAX no-bags fee. That is a fee, not the price.`;
    return t;
  }

  root.StrataSeasons = { priceForBags, describePricing, SEASONS, TIERS, setGenesis, seasonIndexFor, seasonEnd, computeScore, tierFor };
})(typeof globalThis !== 'undefined' ? globalThis : window);
