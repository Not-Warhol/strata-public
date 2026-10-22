const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('StrataReseed', () => {
  async function setup() {
    const [owner, minter, buyer, other] = await ethers.getSigners();
    const quoteSigner = ethers.Wallet.createRandom();
    const now = (await ethers.provider.getBlock('latest')).timestamp;
    const drop = await (await ethers.getContractFactory('StrataDrop')).deploy('STRATA. 001: Contour', 'STRATA001', quoteSigner.address, now - 10, now + 86400, owner.address, 'https://x/m/', 'https://x/c.json');
    const { chainId } = await ethers.provider.getNetwork();
    const mintDomain = { name: 'StrataDrop', version: '1', chainId, verifyingContract: await drop.getAddress() };
    const mintTypes = { Mint: [
      { name: 'to', type: 'address' }, { name: 'price', type: 'uint256' }, { name: 'seed', type: 'bytes32' },
      { name: 'data', type: 'bytes' }, { name: 'allowance', type: 'uint8' }, { name: 'deadline', type: 'uint256' }] };
    const m = { to: minter.address, price: 0n, seed: ethers.id('minted'), data: '0x01', allowance: 1, deadline: now + 3600 };
    await drop.connect(minter).mint(m.price, m.seed, m.data, m.allowance, m.deadline, await quoteSigner.signTypedData(mintDomain, mintTypes, m));
    await ethers.provider.send('evm_increaseTime', [86400 + 1]); await ethers.provider.send('evm_mine', []); // mint window closed

    const r = await (await ethers.getContractFactory('StrataReseed')).deploy(await drop.getAddress(), quoteSigner.address);
    const domain = { name: 'StrataReseed', version: '1', chainId, verifyingContract: await r.getAddress() };
    const types = { Reseed: [
      { name: 'to', type: 'address' }, { name: 'tokenId', type: 'uint256' }, { name: 'price', type: 'uint256' },
      { name: 'seed', type: 'bytes32' }, { name: 'data', type: 'bytes' }, { name: 'deadline', type: 'uint256' }] };
    const quote = async (to, { tokenId = 1n, price = 0n, data = '0x02', tag = 'a', seed, by = quoteSigner } = {}) => {
      const t = (await ethers.provider.getBlock('latest')).timestamp;
      const v = { to, tokenId, price, seed: seed || ethers.id(to + tag), data, deadline: t + 600 };
      return { ...v, sig: await by.signTypedData(domain, types, v) };
    };
    const call = (who, q, value = q.price) => r.connect(who).reseed(q.tokenId, q.price, q.seed, q.data, q.deadline, q.sig, { value });
    return { drop, r, owner, minter, buyer, other, quote, call };
  }

  it('lets a buyer redraw the piece from their own wallet after the mint closed', async () => {
    const { drop, r, minter, buyer, quote, call } = await setup();
    await drop.connect(minter).transferFrom(minter.address, buyer.address, 1);
    const q = await quote(buyer.address, { data: '0xbeef' });
    await expect(call(buyer, q)).to.emit(r, 'Reseeded').withArgs(1, buyer.address, q.seed, 0, 1).and.to.emit(r, 'MetadataUpdate').withArgs(1);
    const cur = await r.current(1);
    expect(cur.seed).to.equal(q.seed);
    expect(cur.data).to.equal('0xbeef');
    expect(cur.by).to.equal(buyer.address);
    expect(await r.versions(1)).to.equal(1);
    expect(await r.totalReseeds()).to.equal(1);
    expect(await r.history(0)).to.equal(1);
    expect(await drop.ownerOf(1)).to.equal(buyer.address); // the token never moves
    expect((await drop.cores(1)).seed).to.equal(ethers.id('minted')); // the original stays on the drop contract
  });
  it('only the current holder can reseed, once per holder', async () => {
    const { drop, r, minter, buyer, other, quote, call } = await setup();
    await expect(call(buyer, await quote(buyer.address))).to.be.revertedWithCustomError(r, 'NotHolder');
    await call(minter, await quote(minter.address));
    await expect(call(minter, await quote(minter.address, { tag: 'b' }))).to.be.revertedWithCustomError(r, 'AlreadyReseeded');
    // a new holder gets their own reseed; the old version stays readable
    await drop.connect(minter).transferFrom(minter.address, other.address, 1);
    const q = await quote(other.address, { data: '0x03' });
    await expect(call(other, q)).to.emit(r, 'Reseeded').withArgs(1, other.address, q.seed, 0, 2);
    expect((await r.coreAt(1, 1)).by).to.equal(minter.address);
    expect((await r.current(1)).by).to.equal(other.address);
  });
  it('rejects forged, reused, expired and wrongly paid quotes', async () => {
    const { r, minter, quote, call } = await setup();
    const forged = await quote(minter.address, { by: ethers.Wallet.createRandom() });
    await expect(call(minter, forged)).to.be.revertedWithCustomError(r, 'BadSignature');
    const q = await quote(minter.address, { price: 5n });
    await expect(call(minter, q, 4n)).to.be.revertedWithCustomError(r, 'WrongPrice');
    const tampered = { ...q, data: '0x99' };
    await expect(call(minter, tampered)).to.be.revertedWithCustomError(r, 'BadSignature');
    await ethers.provider.send('evm_increaseTime', [601]); await ethers.provider.send('evm_mine', []);
    await expect(call(minter, q)).to.be.revertedWithCustomError(r, 'QuoteExpired');
  });
  it('a seed can never be used twice', async () => {
    const { drop, r, minter, buyer, quote, call } = await setup();
    const seed = ethers.id('same');
    await call(minter, await quote(minter.address, { seed }));
    await drop.connect(minter).transferFrom(minter.address, buyer.address, 1);
    await expect(call(buyer, await quote(buyer.address, { seed }))).to.be.revertedWithCustomError(r, 'SeedTaken');
  });
  it('forwards the payment straight to the owner and holds nothing', async () => {
    const { r, owner, minter, quote, call } = await setup();
    const price = ethers.parseEther('0.2');
    await expect(call(minter, await quote(minter.address, { price }))).to.changeEtherBalances([minter, r, owner], [-price, 0n, price]);
  });
  it('close() is owner-only and final; ownership cannot be renounced', async () => {
    const { r, minter, quote, call } = await setup();
    await expect(r.connect(minter).close()).to.be.revertedWithCustomError(r, 'OwnableUnauthorizedAccount');
    await expect(r.connect(minter).setSigner(minter.address)).to.be.revertedWithCustomError(r, 'OwnableUnauthorizedAccount');
    await expect(r.renounceOwnership()).to.be.revertedWithCustomError(r, 'CannotRenounce');
    await r.close();
    await expect(call(minter, await quote(minter.address))).to.be.revertedWithCustomError(r, 'ReseedClosed');
  });
});
