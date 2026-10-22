const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('PersonaDrop', () => {
  async function setup() {
    const [owner, user, other, buyer] = await ethers.getSigners();
    const quoteSigner = ethers.Wallet.createRandom();
    const now = (await ethers.provider.getBlock('latest')).timestamp;
    const c = await (await ethers.getContractFactory('PersonaDrop')).deploy('STRATA. 002: Persona', 'STRATA002', quoteSigner.address, now - 10, now + 7 * 86400, owner.address, 'https://x/api/drops/002/metadata/', 'https://x/api/drops/002/contract.json');
    const { chainId } = await ethers.provider.getNetwork();
    const domain = { name: 'StrataDrop', version: '2', chainId, verifyingContract: await c.getAddress() };
    const types = { Mint: [
      { name: 'to', type: 'address' }, { name: 'price', type: 'uint256' }, { name: 'seeds', type: 'bytes32[]' },
      { name: 'data', type: 'bytes[]' }, { name: 'allowance', type: 'uint8' }, { name: 'deadline', type: 'uint256' }] };
    let mask = 0;
    // one quote for n masks (n = 1 unless given); seed/data may be given for a single-mask quote
    const quote = async (to, { price = 0n, allowance = 2, data = '0x01', seed, n = 1 } = {}) => {
      const seeds = seed ? [seed] : Array.from({ length: n }, () => ethers.zeroPadValue(ethers.toBeHex(++mask), 32));
      const v = { to, price, seeds, data: seeds.map(() => data), allowance, deadline: now + 3600 };
      return { ...v, seed: seeds[0], sig: await quoteSigner.signTypedData(domain, types, v) };
    };
    return { c, owner, user, other, buyer, quote, quoteSigner, now, domain, types };
  }
  const call = (c, q, value = q.price) => c.mint(q.price, q.seeds, q.data, q.allowance, q.deadline, q.sig, { value });

  it('free mint stores seed, payload and the builder (minter + block)', async () => {
    const { c, user, quote } = await setup();
    const q = await quote(user.address);
    const tx = await call(c.connect(user), q);
    const rc = await tx.wait();
    await expect(tx).to.emit(c, 'Minted').withArgs(user.address, 1, q.seed, 0);
    const core = await c.cores(1);
    expect(core.seed).to.equal(q.seed);
    const b = await c.builds(1);
    expect(b.wallet).to.equal(user.address);
    expect(b.since).to.equal(rc.blockNumber);
    expect(b.redraws).to.equal(0);
    expect(await c.tokenURI(1)).to.equal('https://x/api/drops/002/metadata/1');
  });
  it('pay what you want: tips above the minimum go straight to the owner', async () => {
    const { c, owner, user, quote } = await setup();
    const tip = ethers.parseEther('0.69');
    await expect(call(c.connect(user), await quote(user.address), tip)).to.changeEtherBalances([user, c, owner], [-tip, 0n, tip]);
    const q = await quote(user.address, { price: ethers.parseEther('1') });
    await expect(call(c.connect(user), q, ethers.parseEther('0.5'))).to.be.revertedWithCustomError(c, 'WrongPrice');
  });
  it('allowance is signed per wallet, under an adjustable ceiling', async () => {
    const { c, user, quote } = await setup();
    for (let n = 0; n < 8; n++) await call(c.connect(user), await quote(user.address, { allowance: 8 }));
    expect(await c.mintedBy(user.address)).to.equal(8);
    await expect(call(c.connect(user), await quote(user.address, { allowance: 8 }))).to.be.revertedWithCustomError(c, 'AllowanceUsed');
    await c.setMaxPerWallet(4);
    await expect(call(c.connect(user), await quote(user.address, { allowance: 9 }))).to.be.revertedWithCustomError(c, 'AllowanceUsed');
  });
  it('a mask (seed) can only be minted once, by anyone, including the owner reserve', async () => {
    const { c, user, other, quote } = await setup();
    const seed = ethers.zeroPadValue('0x0417', 32);
    await call(c.connect(user), await quote(user.address, { seed }));
    await expect(call(c.connect(other), await quote(other.address, { seed }))).to.be.revertedWithCustomError(c, 'SeedTaken');
    await expect(c.ownerMint(user.address, [seed], ['0x'])).to.be.revertedWithCustomError(c, 'SeedTaken');
  });
  it('owner reserve mints many at once, owner-only, built from the receiving wallet', async () => {
    const { c, owner, other } = await setup();
    const seeds = Array.from({ length: 10 }, (_, i) => ethers.zeroPadValue(ethers.toBeHex(2000 + i), 32));
    await expect(c.connect(other).ownerMint(other.address, seeds, seeds.map(() => '0x'))).to.be.revertedWithCustomError(c, 'OwnableUnauthorizedAccount');
    await c.ownerMint(owner.address, seeds, seeds.map(() => '0x'));
    expect(await c.totalSupply()).to.equal(10);
    expect(await c.balanceOf(owner.address)).to.equal(10);
    expect((await c.builds(10)).wallet).to.equal(owner.address);
    expect(await c.mintedBy(owner.address)).to.equal(0); // the reserve doesn't use a public allowance
    await expect(c.ownerMint(owner.address, seeds.slice(0, 1), [])).to.be.revertedWithCustomError(c, 'BadInput');
  });
  it('redraw: a buyer makes the piece theirs once per holding; the minter cannot redraw their own', async () => {
    const { c, owner, user, buyer, quote } = await setup();
    await call(c.connect(user), await quote(user.address));
    await expect(c.connect(user).redraw(1)).to.be.revertedWithCustomError(c, 'AlreadyBuilder');
    await expect(c.connect(buyer).redraw(1)).to.be.revertedWithCustomError(c, 'NotHolder');
    await c.connect(user).transferFrom(user.address, buyer.address, 1);
    const tip = ethers.parseEther('0.1');
    const tx = c.connect(buyer).redraw(1, { value: tip });
    await expect(tx).to.emit(c, 'Redrawn').and.to.emit(c, 'MetadataUpdate').withArgs(1);
    await expect(tx).to.changeEtherBalances([buyer, owner], [-tip, tip]);
    const b = await c.builds(1);
    expect(b.wallet).to.equal(buyer.address);
    expect(b.redraws).to.equal(1);
    await expect(c.connect(buyer).redraw(1)).to.be.revertedWithCustomError(c, 'AlreadyBuilder');
    // back to the original minter: they may make it theirs again
    await c.connect(buyer).transferFrom(buyer.address, user.address, 1);
    await c.connect(user).redraw(1);
    expect((await c.builds(1)).redraws).to.equal(2);
  });
  it('redraw can be closed and reopened by the owner only', async () => {
    const { c, user, buyer, other, quote } = await setup();
    await call(c.connect(user), await quote(user.address));
    await c.connect(user).transferFrom(user.address, buyer.address, 1);
    await expect(c.connect(other).setRedrawOpen(false)).to.be.revertedWithCustomError(c, 'OwnableUnauthorizedAccount');
    await c.setRedrawOpen(false);
    await expect(c.connect(buyer).redraw(1)).to.be.revertedWithCustomError(c, 'RedrawClosed');
    await c.setRedrawOpen(true);
    await c.connect(buyer).redraw(1);
  });
  it('window is adjustable by the owner, even after it opened; closed outside it', async () => {
    const { c, user, other, quote, now } = await setup();
    await expect(c.connect(other).setMintWindow(now, now + 10)).to.be.revertedWithCustomError(c, 'OwnableUnauthorizedAccount');
    await c.setMintWindow(now + 1000, now + 2000);
    await expect(call(c.connect(user), await quote(user.address))).to.be.revertedWithCustomError(c, 'MintClosed');
    await expect(c.setMintWindow(5, 5)).to.be.revertedWithCustomError(c, 'BadWindow');
    await c.setMintWindow(now - 10, now + 86400);
    await call(c.connect(user), await quote(user.address));
  });
  it('rejects a forged or tampered quote and another wallet using it', async () => {
    const { c, user, other, quote, domain, types } = await setup();
    const q = await quote(user.address);
    await expect(call(c.connect(other), q)).to.be.revertedWithCustomError(c, 'BadSignature');
    await expect(c.connect(user).mint(q.price, q.seeds, ['0x02'], q.allowance, q.deadline, q.sig)).to.be.revertedWithCustomError(c, 'BadSignature');
    await expect(c.connect(user).mint(q.price, q.seeds, q.data, 50, q.deadline, q.sig)).to.be.revertedWithCustomError(c, 'BadSignature');
    const fake = ethers.Wallet.createRandom();
    const v = { to: user.address, price: 0n, seeds: [ethers.zeroPadValue('0x99', 32)], data: ['0x01'], allowance: 2, deadline: q.deadline };
    const sig = await fake.signTypedData(domain, types, v);
    await expect(c.connect(user).mint(v.price, v.seeds, v.data, v.allowance, v.deadline, sig)).to.be.revertedWithCustomError(c, 'BadSignature');
  });
  it('mints several masks in one transaction, within the signed allowance', async () => {
    const { c, user, quote } = await setup();
    const q = await quote(user.address, { n: 3, allowance: 3 });
    const tx = await call(c.connect(user), q);
    for (let i = 0; i < 3; i++) await expect(tx).to.emit(c, 'Minted').withArgs(user.address, i + 1, q.seeds[i], 0);
    expect(await c.mintedBy(user.address)).to.equal(3);
    expect(await c.balanceOf(user.address)).to.equal(3);
    // a batch can't go past the allowance, and a quote lands only once
    await expect(call(c.connect(user), await quote(user.address, { n: 2, allowance: 4 }))).to.be.revertedWithCustomError(c, 'AllowanceUsed');
    await call(c.connect(user), await quote(user.address, { n: 1, allowance: 4 }));
    // seeds can't repeat inside a batch either
    const s = ethers.zeroPadValue('0x0bad', 32), d = await quote(user.address, { allowance: 9 });
    const v = { ...d, seeds: [s, s], data: ['0x01', '0x01'] };
    await expect(c.connect(user).mint(0n, v.seeds, v.data, 9, v.deadline, d.sig)).to.be.revertedWithCustomError(c, 'BadSignature');
  });
  it('refresh events, ERC-4906, royalties, no renounce, metadata freeze', async () => {
    const { c, owner, user, other, quote } = await setup();
    await call(c.connect(user), await quote(user.address));
    expect(await c.supportsInterface('0x49064906')).to.equal(true);
    await expect(c.connect(other).refresh(1)).to.emit(c, 'MetadataUpdate').withArgs(1);
    await expect(c.connect(other).refresh(99)).to.be.revertedWithCustomError(c, 'ERC721NonexistentToken');
    await expect(c.refreshAll()).to.emit(c, 'BatchMetadataUpdate');
    await expect(c.connect(other).refreshAll()).to.be.revertedWithCustomError(c, 'NotRefresher');
    await expect(c.connect(other).setRefresher(other.address)).to.be.revertedWithCustomError(c, 'OwnableUnauthorizedAccount');
    await c.setRefresher(other.address);
    await expect(c.connect(other).refreshAll()).to.emit(c, 'BatchMetadataUpdate');
    await c.setRefresher(ethers.ZeroAddress);
    await expect(c.connect(other).refreshAll()).to.be.revertedWithCustomError(c, 'NotRefresher');
    const [recv, amount] = await c.royaltyInfo(1, ethers.parseEther('10'));
    expect(recv).to.equal(owner.address); expect(amount).to.equal(ethers.parseEther('0.5'));
    await expect(c.renounceOwnership()).to.be.revertedWithCustomError(c, 'CannotRenounce');
    await c.setBaseURI('ipfs://x/'); await c.freezeMetadata();
    await expect(c.setBaseURI('https://y/')).to.be.revertedWithCustomError(c, 'MetadataIsFrozen');
  });
});
