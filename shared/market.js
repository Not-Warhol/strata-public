/* STRATA. Market — Seaport 1.6 orders, shared by the server (validation) and the browser (building, filling).
 * Shared file: runs in the browser (<script>, needs window.ethers) and in Node (side-effect import after ethers).
 * Exposes globalThis.StrataMarketCore.
 *
 * Every order is a plain Seaport 1.6 order, signed by the wallet (no gas) and kept by our server:
 *   - listing:  offer = the NFT; consideration = price minus royalty to the seller + royalty to the collection.
 *               Paid in AVAX. A falling-price auction is a listing whose end price is lower (Seaport moves it linearly).
 *   - offer:    offer = WAVAX; consideration = the NFT (one token, or any token of the collection) + the royalty
 *               in WAVAX. Bids in a timed auction are offers on that token.
 * No platform fee. An order dies by itself at its end time: nothing to cancel, no gas. Cancelling earlier is an
 * on-chain call by its maker (Seaport `cancel`, or `incrementCounter` for every order at once). */
(function (root) {
  const SEAPORT = '0x0000000000000068F116a894984e2DB1123eB395'; // Seaport 1.6, same address on every chain
  const WAVAX = '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7';
  const ZERO = '0x0000000000000000000000000000000000000000';
  const ZERO32 = '0x' + '0'.repeat(64);
  const ITEM = { NATIVE: 0, ERC20: 1, ERC721: 2, ERC1155: 3, ERC721_CRITERIA: 4, ERC1155_CRITERIA: 5 };

  const TYPES = {
    OrderComponents: [
      { name: 'offerer', type: 'address' }, { name: 'zone', type: 'address' },
      { name: 'offer', type: 'OfferItem[]' }, { name: 'consideration', type: 'ConsiderationItem[]' },
      { name: 'orderType', type: 'uint8' }, { name: 'startTime', type: 'uint256' }, { name: 'endTime', type: 'uint256' },
      { name: 'zoneHash', type: 'bytes32' }, { name: 'salt', type: 'uint256' }, { name: 'conduitKey', type: 'bytes32' },
      { name: 'counter', type: 'uint256' },
    ],
    OfferItem: [
      { name: 'itemType', type: 'uint8' }, { name: 'token', type: 'address' }, { name: 'identifierOrCriteria', type: 'uint256' },
      { name: 'startAmount', type: 'uint256' }, { name: 'endAmount', type: 'uint256' },
    ],
    ConsiderationItem: [
      { name: 'itemType', type: 'uint8' }, { name: 'token', type: 'address' }, { name: 'identifierOrCriteria', type: 'uint256' },
      { name: 'startAmount', type: 'uint256' }, { name: 'endAmount', type: 'uint256' }, { name: 'recipient', type: 'address' },
    ],
  };
  const domain = (chainId) => ({ name: 'Seaport', version: '1.6', chainId, verifyingContract: SEAPORT });

  const T_OFFER = '(uint8 itemType,address token,uint256 identifierOrCriteria,uint256 startAmount,uint256 endAmount)';
  const T_CONS = '(uint8 itemType,address token,uint256 identifierOrCriteria,uint256 startAmount,uint256 endAmount,address recipient)';
  const T_COMP = `(address offerer,address zone,${T_OFFER}[] offer,${T_CONS}[] consideration,uint8 orderType,uint256 startTime,uint256 endTime,bytes32 zoneHash,uint256 salt,bytes32 conduitKey,uint256 counter)`;
  const T_PARAMS = `(address offerer,address zone,${T_OFFER}[] offer,${T_CONS}[] consideration,uint8 orderType,uint256 startTime,uint256 endTime,bytes32 zoneHash,uint256 salt,bytes32 conduitKey,uint256 totalOriginalConsiderationItems)`;
  const SEAPORT_ABI = [
    `function fulfillOrder((${T_PARAMS} parameters,bytes signature) order, bytes32 fulfillerConduitKey) payable returns (bool)`,
    `function matchAdvancedOrders((${T_PARAMS} parameters,uint120 numerator,uint120 denominator,bytes signature,bytes extraData)[] orders, (uint256 orderIndex,uint8 side,uint256 index,uint256 identifier,bytes32[] criteriaProof)[] criteriaResolvers, ((uint256 orderIndex,uint256 itemIndex)[] offerComponents,(uint256 orderIndex,uint256 itemIndex)[] considerationComponents)[] fulfillments, address recipient) payable returns (bool[])`,
    `function cancel(${T_COMP}[] orders) returns (bool)`,
    'function incrementCounter() returns (uint256)',
    'function getCounter(address) view returns (uint256)',
    `function getOrderHash(${T_COMP} order) view returns (bytes32)`,
    'function getOrderStatus(bytes32) view returns (bool isValidated, bool isCancelled, uint256 totalFilled, uint256 totalSize)',
    `event OrderFulfilled(bytes32 orderHash, address indexed offerer, address indexed zone, address recipient, (uint8 itemType,address token,uint256 identifier,uint256 amount)[] offer, (uint8 itemType,address token,uint256 identifier,uint256 amount,address recipient)[] consideration)`,
    'event OrderCancelled(bytes32 orderHash, address indexed offerer, address indexed zone)',
    'event CounterIncremented(uint256 newCounter, address indexed offerer)',
  ];
  const NFT_ABI = [
    'function ownerOf(uint256) view returns (address)',
    'function isApprovedForAll(address,address) view returns (bool)',
    'function setApprovalForAll(address,bool)',
    'function royaltyInfo(uint256,uint256) view returns (address,uint256)',
    'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
  ];
  const WAVAX_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function allowance(address,address) view returns (uint256)',
    'function approve(address,uint256) returns (bool)',
    'function deposit() payable',
    'function withdraw(uint256)',
  ];

  const big = (v) => BigInt(v);
  const royaltyOf = (price, bps) => (big(price) * big(bps)) / 10000n;

  /** A fresh 256-bit salt. */
  function salt() {
    const b = new Uint8Array(32);
    (root.crypto || globalThis.crypto).getRandomValues(b);
    return BigInt('0x' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')).toString();
  }

  /** Listing (fixed price when endPrice is omitted or equal; falling price otherwise). Amounts in wei (strings). */
  function listing({ offerer, token, id, price, endPrice, start, end, royalty, counter, zone = ZERO }) {
    const p0 = big(price), p1 = big(endPrice ?? price);
    const r0 = royaltyOf(p0, royalty.bps), r1 = royaltyOf(p1, royalty.bps);
    return {
      offerer, zone: zone || ZERO,
      offer: [{ itemType: ITEM.ERC721, token, identifierOrCriteria: String(id), startAmount: '1', endAmount: '1' }],
      consideration: [
        { itemType: ITEM.NATIVE, token: ZERO, identifierOrCriteria: '0', startAmount: String(p0 - r0), endAmount: String(p1 - r1), recipient: offerer },
        { itemType: ITEM.NATIVE, token: ZERO, identifierOrCriteria: '0', startAmount: String(r0), endAmount: String(r1), recipient: royalty.receiver },
      ],
      orderType: 0, startTime: String(start), endTime: String(end), zoneHash: ZERO32, salt: salt(), conduitKey: ZERO32, counter: String(counter),
    };
  }

  /** Offer in WAVAX on one token (id) or on any token of the collection (id null). */
  function offer({ offerer, token, id, price, start, end, royalty, counter, zone = ZERO }) {
    const p = big(price), r = royaltyOf(p, royalty.bps);
    const any = id == null;
    return {
      offerer, zone: zone || ZERO,
      offer: [{ itemType: ITEM.ERC20, token: WAVAX, identifierOrCriteria: '0', startAmount: String(p), endAmount: String(p) }],
      consideration: [
        { itemType: any ? ITEM.ERC721_CRITERIA : ITEM.ERC721, token, identifierOrCriteria: any ? '0' : String(id), startAmount: '1', endAmount: '1', recipient: offerer },
        { itemType: ITEM.ERC20, token: WAVAX, identifierOrCriteria: '0', startAmount: String(r), endAmount: String(r), recipient: royalty.receiver },
      ],
      orderType: 0, startTime: String(start), endTime: String(end), zoneHash: ZERO32, salt: salt(), conduitKey: ZERO32, counter: String(counter),
    };
  }

  /** Order parameters for the fill calls (components without the counter). */
  function parameters(c) {
    const { counter, ...rest } = c;
    return { ...rest, totalOriginalConsiderationItems: String(c.consideration.length) };
  }

  const fill = (a, b, c, d) => ({ offerComponents: [{ orderIndex: a, itemIndex: b }], considerationComponents: [{ orderIndex: c, itemIndex: d }] });
  const advanced = (comp, signature) => ({ parameters: parameters(comp), numerator: 1, denominator: 1, signature, extraData: '0x' });
  const criteriaFor = (o, i, id) => (Number(o.consideration[0].itemType) === ITEM.ERC721_CRITERIA ? [{ orderIndex: i, side: 1, index: 0, identifier: String(id), criteriaProof: [] }] : []);

  /** Arguments for matchAdvancedOrders that accept several offers (bids) in ONE transaction.
   *  picks: [{ components, signature, id }] (id = the seller's token that fills it). The seller's own unsigned mirror
   *  order gives every token and takes each price minus its royalty, all paid from the bidders' WAVAX, so the seller
   *  needs no WAVAX approval. `t` = chain time now. */
  function acceptMirror(picks, seller, t, keeper, counter) {
    const n = picks.length;
    const m = {
      offerer: seller, zone: keeper || ZERO,
      offer: picks.map((p) => ({ itemType: ITEM.ERC721, token: p.components.consideration[0].token, identifierOrCriteria: String(p.id), startAmount: '1', endAmount: '1' })),
      consideration: picks.map((p) => {
        const net = big(p.components.offer[0].startAmount) - big(p.components.consideration[1].startAmount);
        return { itemType: ITEM.ERC20, token: WAVAX, identifierOrCriteria: '0', startAmount: String(net), endAmount: String(net), recipient: seller };
      }),
      orderType: keeper ? 2 : 0, startTime: String(t - 600), endTime: String(t + 3600), zoneHash: ZERO32, salt: salt(), conduitKey: ZERO32,
    };
    return keeper ? { ...m, counter: String(counter) } : { ...m, totalOriginalConsiderationItems: String(n) };
  }
  /** signed: { components, signature } of a mirror from acceptMirror(…, keeper, counter): only the keeper can send it. */
  function acceptManyArgs(picks, seller, t, signed) {
    const n = picks.length;
    const mirror = signed ? { parameters: parameters(signed.components), numerator: 1, denominator: 1, signature: signed.signature, extraData: '0x' }
      : { parameters: acceptMirror(picks, seller, t), numerator: 1, denominator: 1, signature: '0x', extraData: '0x' };
    const orders = [...picks.map((p) => advanced(p.components, p.signature)), mirror];
    const fulfillments = picks.flatMap((_, i) => [
      fill(n, i, i, 0), // token → bidder
      fill(i, 0, n, i), // WAVAX → seller
      fill(i, 0, i, 1), // WAVAX → royalty
    ]);
    return [orders, picks.flatMap((p, i) => criteriaFor(p.components, i, p.id)), fulfillments, seller];
  }
  const acceptArgs = (o, signature, seller, id, t) => acceptManyArgs([{ components: o, signature, id }], seller, t);

  /** The second order behind a falling price: the same token on the same schedule, paid in WAVAX with only the
   *  seller's share (the bid pays the royalty), restricted to the STRATA. keeper (zone). It lets the keeper sell to
   *  the best bid the moment the falling price reaches it. Nobody else can fill it. */
  function autoListing(l, keeper) {
    const k0 = l.consideration[0];
    return {
      offerer: l.offerer, zone: keeper,
      offer: l.offer.map((x) => ({ ...x })),
      consideration: [{ itemType: ITEM.ERC20, token: WAVAX, identifierOrCriteria: '0', startAmount: k0.startAmount, endAmount: k0.endAmount, recipient: l.offerer }],
      orderType: 2, startTime: l.startTime, endTime: l.endTime, zoneHash: ZERO32, salt: salt(), conduitKey: ZERO32, counter: l.counter,
    };
  }
  /** Keeper's call: the auto order meets a bid. Whatever the bid pays above the seller's share and its royalty goes
   *  to the seller too (recipient), so the seller ends with the bid minus the royalty, as if they accepted it. */
  function autoMatchArgs(auto, autoSig, bid, bidSig, id) {
    return [
      [advanced(auto, autoSig), advanced(bid, bidSig)],
      criteriaFor(bid, 1, id),
      [fill(0, 0, 1, 0), fill(1, 0, 0, 0), fill(1, 0, 1, 1)], // token → bidder, WAVAX → seller, WAVAX → royalty
      auto.offerer,
    ];
  }

  // Gasless: the maker signs, STRATA. sends (and pays). StrataZone cancels orders that name it; StrataAuction starts
  // and cancels auctions for the seller.
  const ZONE_TYPES = { Cancel: [{ name: 'orderHashes', type: 'bytes32[]' }] };
  const zoneDomain = (chainId, zone) => ({ name: 'StrataZone', version: '1', chainId, verifyingContract: zone });
  const AUCTION_TYPES = {
    Create: [{ name: 'seller', type: 'address' }, { name: 'collection', type: 'address' }, { name: 'tokenId', type: 'uint256' }, { name: 'reserve', type: 'uint96' }, { name: 'duration', type: 'uint64' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }],
  };
  const AUCTION_CANCEL_TYPES = { Cancel: [{ name: 'id', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] };
  const auctionDomain = (chainId, auction) => ({ name: 'StrataAuction', version: '1', chainId, verifyingContract: auction });

  // Usernames (StrataNames) and batch transfers (StrataTransfer)
  const NAME_TYPES = { Name: [{ name: 'wallet', type: 'address' }, { name: 'name', type: 'string' }] };
  const namesDomain = (chainId, names) => ({ name: 'StrataNames', version: '1', chainId, verifyingContract: names });
  const validName = (n) => /^[a-z0-9_]{3,20}$/.test(String(n || ''));
  const SEND_TYPES = {
    Send: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'items', type: 'Item[]' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }],
    Item: [{ name: 'collection', type: 'address' }, { name: 'tokenId', type: 'uint256' }],
  };
  const transferDomain = (chainId, tr) => ({ name: 'StrataTransfer', version: '1', chainId, verifyingContract: tr });
  /** What the owner signs to approve or reject name requests (rebuilt by the server). */
  const adminMessage = ({ remove = [], at }) =>
    `STRATA. Market admin\nRemove names: ${remove.join(', ') || '-'}\nAt: ${at}`;

  /** Seaport's linear amount at time t (seconds). roundUp for consideration items, as Seaport does. */
  function amountAt(startAmount, endAmount, startTime, endTime, t, roundUp) {
    const s = big(startAmount), e = big(endAmount);
    if (s === e) return s;
    const dur = big(endTime) - big(startTime);
    const el = BigInt(Math.max(0, Math.min(Number(dur), t - Number(startTime))));
    const rem = dur - el;
    const total = s * rem + e * el;
    return roundUp ? (total + dur - 1n) / dur : total / dur;
  }

  /** What the order is about, read back from its components, or an error string. royalty: { receiver, bps }. */
  function describe(c, { collections, royaltyFor, zone }) {
    const lc = (a) => String(a || '').toLowerCase();
    if ((lc(c.zone) !== ZERO && lc(c.zone) !== lc(zone)) || c.orderType !== 0 && c.orderType !== '0' || lc(c.conduitKey) !== ZERO32 || lc(c.zoneHash) !== ZERO32) return { error: 'Only plain open orders.' };
    if (c.offer.length !== 1 || c.consideration.length !== 2) return { error: 'Unexpected order shape.' };
    const o = c.offer[0], [k0, k1] = c.consideration;
    if (Number(o.itemType) === ITEM.ERC721) { // listing
      const col = collections.find((x) => lc(x.address) === lc(o.token));
      if (!col) return { error: 'Not a STRATA. collection.' };
      if (String(o.startAmount) !== '1' || String(o.endAmount) !== '1') return { error: 'One token per listing.' };
      if (Number(k0.itemType) !== ITEM.NATIVE || Number(k1.itemType) !== ITEM.NATIVE) return { error: 'Listings are paid in AVAX.' };
      if (lc(k0.recipient) !== lc(c.offerer)) return { error: 'The seller must be paid.' };
      const roy = royaltyFor(col);
      if (lc(k1.recipient) !== lc(roy.receiver)) return { error: 'The royalty goes to the collection.' };
      const p0 = big(k0.startAmount) + big(k1.startAmount), p1 = big(k0.endAmount) + big(k1.endAmount);
      if (p0 <= 0n || p1 <= 0n) return { error: 'Price must be above zero.' };
      if (big(k1.startAmount) < royaltyOf(p0, roy.bps) || big(k1.endAmount) < royaltyOf(p1, roy.bps)) return { error: 'Royalty too low.' };
      if (p1 > p0) return { error: 'A falling price can only fall.' };
      return { kind: 'listing', slug: col.slug, id: String(o.identifierOrCriteria), price: String(p0), endPrice: String(p1) };
    }
    if (Number(o.itemType) === ITEM.ERC20) { // offer
      if (lc(o.token) !== lc(WAVAX)) return { error: 'Offers are made in WAVAX.' };
      if (big(o.startAmount) !== big(o.endAmount)) return { error: 'Offers keep one price.' };
      const col = collections.find((x) => lc(x.address) === lc(k0.token));
      if (!col) return { error: 'Not a STRATA. collection.' };
      const t = Number(k0.itemType);
      if (t !== ITEM.ERC721 && !(t === ITEM.ERC721_CRITERIA && String(k0.identifierOrCriteria) === '0')) return { error: 'Unexpected item.' };
      if (lc(k0.recipient) !== lc(c.offerer)) return { error: 'The token must go to the bidder.' };
      const roy = royaltyFor(col);
      const p = big(o.startAmount);
      if (Number(k1.itemType) !== ITEM.ERC20 || lc(k1.token) !== lc(WAVAX) || lc(k1.recipient) !== lc(roy.receiver)) return { error: 'The royalty goes to the collection.' };
      if (big(k1.startAmount) < royaltyOf(p, roy.bps) || big(k1.startAmount) >= p) return { error: 'Royalty out of range.' };
      return { kind: 'offer', slug: col.slug, id: t === ITEM.ERC721 ? String(k0.identifierOrCriteria) : null, price: String(p), endPrice: String(p) };
    }
    return { error: 'Unexpected order.' };
  }

  /** "Tue 6 Oct, 5:30pm UTC" (house style for times). */
  function when(t) {
    const d = new Date(Number(t) * 1000);
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
    const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
    const h = d.getUTCHours(), m = d.getUTCMinutes();
    return `${day} ${d.getUTCDate()} ${mon}, ${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''}${h < 12 ? 'am' : 'pm'} UTC`;
  }

  root.StrataMarketCore = { SEAPORT, WAVAX, ZERO, ZERO32, ITEM, TYPES, domain, SEAPORT_ABI, NFT_ABI, WAVAX_ABI, T_COMP,
    listing, offer, parameters, acceptArgs, acceptManyArgs, acceptMirror, autoListing, ZONE_TYPES, zoneDomain, NAME_TYPES, namesDomain, validName, SEND_TYPES, transferDomain, adminMessage, AUCTION_TYPES, AUCTION_CANCEL_TYPES, auctionDomain, autoMatchArgs, amountAt, describe, royaltyOf, when };
})(typeof window !== 'undefined' ? window : globalThis);
