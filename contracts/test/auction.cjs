const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');

const E = (v) => ethers.parseEther(v);

describe('StrataAuction', () => {
  async function setup() {
    const [owner, seller, b1, b2, royalty, other] = await ethers.getSigners();
    const nft = await (await ethers.getContractFactory('MockNFT')).deploy(royalty.address);
    const stranger = await (await ethers.getContractFactory('MockNFT')).deploy(royalty.address);
    const auction = await (await ethers.getContractFactory('StrataAuction')).deploy(owner.address, [await nft.getAddress()]);
    await nft.mint(seller.address, 1);
    await nft.mint(seller.address, 2);
    await nft.connect(seller).setApprovalForAll(await auction.getAddress(), true);
    return { owner, seller, b1, b2, royalty, other, nft, stranger, auction };
  }
  const create = (s, reserve = E('1'), dur = 3600, id = 1) => s.auction.connect(s.seller).create(s.nft.getAddress(), id, reserve, dur);

  it('holds the piece, takes AVAX bids, refunds the outbid at once, pays seller and royalty on settle', async () => {
    const s = await setup();
    await create(s);
    expect(await s.nft.ownerOf(1)).to.equal(await s.auction.getAddress());
    await expect(s.auction.connect(s.b1).bid(1, { value: E('0.9') })).to.be.revertedWithCustomError(s.auction, 'TooLow');
    await s.auction.connect(s.b1).bid(1, { value: E('1') });
    await expect(s.auction.connect(s.b2).bid(1, { value: E('1.04') })).to.be.revertedWithCustomError(s.auction, 'TooLow');
    const b1Before = await ethers.provider.getBalance(s.b1.address);
    await s.auction.connect(s.b2).bid(1, { value: E('1.05') });
    expect(await ethers.provider.getBalance(s.b1.address) - b1Before).to.equal(E('1')); // refunded in the same tx
    await expect(s.auction.settle(1)).to.be.revertedWithCustomError(s.auction, 'NotEnded');
    await time.increase(3601);
    const sellerBefore = await ethers.provider.getBalance(s.seller.address), rBefore = await ethers.provider.getBalance(s.royalty.address);
    await s.auction.connect(s.other).settle(1); // anyone can settle
    expect(await s.nft.ownerOf(1)).to.equal(s.b2.address);
    expect(await ethers.provider.getBalance(s.seller.address) - sellerBefore).to.equal(E('0.9975'));
    expect(await ethers.provider.getBalance(s.royalty.address) - rBefore).to.equal(E('0.0525'));
    expect(await ethers.provider.getBalance(await s.auction.getAddress())).to.equal(0n);
    await expect(s.auction.settle(1)).to.be.revertedWithCustomError(s.auction, 'AlreadySettled');
  });

  it('outside collections can pay a platform fee (max 10%), fixed when the auction starts', async () => {
    const s = await setup();
    await expect(s.auction.setFee(s.nft.getAddress(), 1001)).to.be.revertedWithCustomError(s.auction, 'FeeTooHigh');
    await expect(s.auction.connect(s.other).setFee(s.nft.getAddress(), 250)).to.be.revertedWithCustomError(s.auction, 'OwnableUnauthorizedAccount');
    await s.auction.setFee(s.nft.getAddress(), 250); // 2.5%
    await s.auction.setFeeRecipient(s.other.address);
    await create(s);
    await s.auction.setFee(s.nft.getAddress(), 1000); // changing it later doesn't touch this auction
    await s.auction.connect(s.b1).bid(1, { value: E('2') });
    await time.increase(3601);
    const sellerBefore = await ethers.provider.getBalance(s.seller.address), feeBefore = await ethers.provider.getBalance(s.other.address);
    await expect(s.auction.connect(s.b2).settle(1)).to.emit(s.auction, 'FeePaid').withArgs(1, s.other.address, E('0.05'));
    expect(await ethers.provider.getBalance(s.other.address) - feeBefore).to.equal(E('0.05'));
    expect(await ethers.provider.getBalance(s.seller.address) - sellerBefore).to.equal(E('1.85')); // 2 - 0.1 royalty - 0.05 fee
    expect(await ethers.provider.getBalance(await s.auction.getAddress())).to.equal(0n);
  });

  it('nobody backs out once there is a bid; seller can cancel only before it', async () => {
    const s = await setup();
    await create(s);
    await create(s, E('1'), 3600, 2);
    await expect(s.auction.connect(s.b1).cancel(1)).to.be.revertedWithCustomError(s.auction, 'NotSeller');
    await s.auction.connect(s.seller).cancel(2);
    expect(await s.nft.ownerOf(2)).to.equal(s.seller.address);
    await s.auction.connect(s.b1).bid(1, { value: E('1') });
    await expect(s.auction.connect(s.seller).cancel(1)).to.be.revertedWithCustomError(s.auction, 'HasBids');
    await expect(s.auction.connect(s.seller).bid(1, { value: E('2') })).to.be.revertedWithCustomError(s.auction, 'SellerCannotBid');
  });

  it('a late bid pushes the end to 10 minutes after it; no bids after the end', async () => {
    const s = await setup();
    await create(s, E('1'), 3600);
    await time.increase(3600 - 120);
    await s.auction.connect(s.b1).bid(1, { value: E('1') });
    const a = await s.auction.auctions(1);
    expect(Number(a.end)).to.equal((await time.latest()) + 600);
    await time.increase(601);
    await expect(s.auction.connect(s.b2).bid(1, { value: E('5') })).to.be.revertedWithCustomError(s.auction, 'Ended');
  });

  it('without bids, settle returns the piece', async () => {
    const s = await setup();
    await create(s);
    await time.increase(3601);
    await s.auction.settle(1);
    expect(await s.nft.ownerOf(1)).to.equal(s.seller.address);
  });

  it('only allowed collections, only the holder, sane durations, pause stops new auctions only', async () => {
    const s = await setup();
    await s.stranger.mint(s.seller.address, 1);
    await expect(s.auction.connect(s.seller).create(s.stranger.getAddress(), 1, E('1'), 3600)).to.be.revertedWithCustomError(s.auction, 'NotAllowed');
    await expect(s.auction.connect(s.b1).create(s.nft.getAddress(), 1, E('1'), 3600)).to.be.reverted; // not the holder
    await expect(create(s, E('1'), 60)).to.be.revertedWithCustomError(s.auction, 'BadDuration');
    await expect(create(s, 0n)).to.be.revertedWithCustomError(s.auction, 'BadReserve');
    await create(s);
    await s.auction.setPaused(true);
    await expect(create(s, E('1'), 3600, 2)).to.be.revertedWithCustomError(s.auction, 'IsPaused');
    await s.auction.connect(s.b1).bid(1, { value: E('1') }); // a running auction keeps going
    await expect(s.auction.connect(s.b1).setPaused(false)).to.be.reverted;
    await expect(s.auction.renounceOwnership()).to.be.revertedWith('disabled');
  });

  it('a bidder that refuses AVAX is owed its refund instead of blocking the auction', async () => {
    const s = await setup();
    await create(s);
    const refuser = await (await ethers.getContractFactory('Refuser')).deploy();
    await refuser.bid(await s.auction.getAddress(), 1, { value: E('1') });
    await s.auction.connect(s.b1).bid(1, { value: E('2') }); // outbids the refuser: refund can't be pushed
    expect(await s.auction.owed(await refuser.getAddress())).to.equal(E('1'));
    await time.increase(3601);
    await s.auction.settle(1);
    expect(await s.nft.ownerOf(1)).to.equal(s.b1.address);
  });

  it('createFor / cancelFor: anyone relays (and pays gas), only the seller’s signature counts, once', async () => {
    const s = await setup();
    const net = await ethers.provider.getNetwork();
    const domain = { name: 'StrataAuction', version: '1', chainId: net.chainId, verifyingContract: await s.auction.getAddress() };
    const deadline = (await time.latest()) + 600;
    const v = { seller: s.seller.address, collection: await s.nft.getAddress(), tokenId: 1, reserve: E('1'), duration: 3600, nonce: 0, deadline };
    const types = { Create: [{ name: 'seller', type: 'address' }, { name: 'collection', type: 'address' }, { name: 'tokenId', type: 'uint256' }, { name: 'reserve', type: 'uint96' }, { name: 'duration', type: 'uint64' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] };
    const sig = await s.seller.signTypedData(domain, types, v);
    const bad = await s.b1.signTypedData(domain, types, v);
    const args = [v.seller, v.collection, v.tokenId, v.reserve, v.duration, v.deadline];
    await expect(s.auction.connect(s.other).createFor(...args, bad)).to.be.revertedWithCustomError(s.auction, 'BadSignature');
    await s.auction.connect(s.other).createFor(...args, sig); // the relayer pays, the seller signed
    expect(await s.nft.ownerOf(1)).to.equal(await s.auction.getAddress());
    expect((await s.auction.auctions(1)).seller).to.equal(s.seller.address);
    await expect(s.auction.connect(s.other).createFor(...args, sig)).to.be.revertedWithCustomError(s.auction, 'BadSignature'); // nonce used
    const ctypes = { Cancel: [{ name: 'id', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] };
    const cv = { id: 1, deadline };
    await expect(s.auction.connect(s.other).cancelFor(1, deadline, await s.b1.signTypedData(domain, ctypes, cv))).to.be.revertedWithCustomError(s.auction, 'BadSignature');
    await s.auction.connect(s.other).cancelFor(1, deadline, await s.seller.signTypedData(domain, ctypes, cv));
    expect(await s.nft.ownerOf(1)).to.equal(s.seller.address);
    await time.increase(700);
    const v2 = { ...v, tokenId: 2, nonce: 1 };
    await expect(s.auction.connect(s.other).createFor(v2.seller, v2.collection, 2, v2.reserve, v2.duration, v2.deadline, await s.seller.signTypedData(domain, types, v2))).to.be.revertedWithCustomError(s.auction, 'Expired');
  });
});
