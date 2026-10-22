const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('StrataDrop', () => {
  async function setup() {
    const [owner, user, other] = await ethers.getSigners();
    const quoteSigner = ethers.Wallet.createRandom();
    const now = (await ethers.provider.getBlock('latest')).timestamp;
    const c = await (await ethers.getContractFactory('StrataDrop')).deploy('STRATA. 001: Contour', 'STRATA001', quoteSigner.address, now - 10, now + 86400, owner.address, 'https://x/api/drops/001/metadata/', 'https://x/api/drops/001/contract.json');
    const { chainId } = await ethers.provider.getNetwork();
    const domain = { name: 'StrataDrop', version: '1', chainId, verifyingContract: await c.getAddress() };
    const types = { Mint: [
      { name: 'to', type: 'address' }, { name: 'price', type: 'uint256' }, { name: 'seed', type: 'bytes32' },
      { name: 'data', type: 'bytes' }, { name: 'allowance', type: 'uint8' }, { name: 'deadline', type: 'uint256' }] };
    const quote = async (to, price, data = '0x04028000618361000200030078c70002', allowance = 1, n = 0) => {
      const v = { to, price, seed: ethers.id(to + data + n), data, allowance, deadline: now + 3600 }; // chain time, not wall clock: earlier tests move the chain clock forward
      return { ...v, sig: await quoteSigner.signTypedData(domain, types, v) };
    };
    return { c, owner, user, other, quote };
  }
  const call = (c, q, value = q.price) => c.mint(q.price, q.seed, q.data, q.allowance, q.deadline, q.sig, { value });

  it('mints with a valid signature and stores seed and payload', async () => {
    const { c, user, quote } = await setup();
    const q = await quote(user.address, ethers.parseEther('99.5'));
    await expect(call(c.connect(user), q)).to.emit(c, 'Minted');
    const core = await c.cores(1);
    expect(core.seed).to.equal(q.seed);
    expect(core.data).to.equal(q.data);
    expect(await c.tokenURI(1)).to.equal('https://x/api/drops/001/metadata/1');
  });
  it('lets a wallet mint up to its allowance, with a new seed each time', async () => {
    const { c, user, quote } = await setup();
    for (let n = 0; n < 3; n++) await call(c.connect(user), await quote(user.address, 1n, '0x01', 3, n));
    expect(await c.mintedBy(user.address)).to.equal(3);
    await expect(call(c.connect(user), await quote(user.address, 1n, '0x01', 3, 9))).to.be.revertedWithCustomError(c, 'AllowanceUsed');
  });
  it('pays 5% royalties and closes for good after the window', async () => {
    const { c, user, quote } = await setup();
    const [, amount] = await c.royaltyInfo(1, ethers.parseEther('10'));
    expect(amount).to.equal(ethers.parseEther('0.5'));
    await ethers.provider.send('evm_increaseTime', [86400 + 1]); await ethers.provider.send('evm_mine', []);
    await expect(call(c.connect(user), await quote(user.address, 1n))).to.be.revertedWithCustomError(c, 'MintClosed');
    await expect(c.setMintWindow(1, 2)).to.be.revertedWithCustomError(c, 'WindowStarted');
  });
  it('free mint when price is zero', async () => {
    const { c, user, quote } = await setup();
    await call(c.connect(user), await quote(user.address, 0n));
    expect(await c.ownerOf(1)).to.equal(user.address);
  });
  it('forwards each mint payment straight to the owner and holds nothing', async () => {
    const { c, owner, user, quote } = await setup();
    expect(await c.owner()).to.equal(owner.address);
    const price = ethers.parseEther('3');
    await expect(call(c.connect(user), await quote(user.address, price))).to.changeEtherBalances([user, c, owner], [-price, 0n, price]);
    expect(await ethers.provider.getBalance(await c.getAddress())).to.equal(0n);
  });
  it('payouts follow a transferred owner; ownership cannot be renounced; admin is owner-only', async () => {
    const { c, owner, user, other, quote } = await setup();
    await expect(c.renounceOwnership()).to.be.revertedWithCustomError(c, 'CannotRenounce');
    await expect(c.connect(other).setSigner(other.address)).to.be.revertedWithCustomError(c, 'OwnableUnauthorizedAccount');
    await expect(c.connect(other).withdraw(other.address)).to.be.revertedWithCustomError(c, 'OwnableUnauthorizedAccount');
    await c.transferOwnership(other.address);
    const price = ethers.parseEther('1');
    await expect(call(c.connect(user), await quote(user.address, price))).to.changeEtherBalances([other, owner], [price, 0n]);
  });
  it('moves metadata to IPFS, then freezes it for good', async () => {
    const { c, user, other, quote } = await setup();
    await call(c.connect(user), await quote(user.address, 0n));
    expect(await c.supportsInterface('0x49064906')).to.equal(true);
    await expect(c.connect(other).freezeMetadata()).to.be.revertedWithCustomError(c, 'OwnableUnauthorizedAccount');
    await expect(c.setBaseURI('ipfs://bafyfolder/')).to.emit(c, 'BatchMetadataUpdate');
    expect(await c.tokenURI(1)).to.equal('ipfs://bafyfolder/1');
    await expect(c.freezeMetadata()).to.emit(c, 'MetadataFrozen').withArgs('ipfs://bafyfolder/');
    expect(await c.metadataFrozen()).to.equal(true);
    await expect(c.setBaseURI('https://evil/')).to.be.revertedWithCustomError(c, 'MetadataIsFrozen');
    await expect(c.freezeMetadata()).to.be.revertedWithCustomError(c, 'MetadataIsFrozen');
    expect(await c.tokenURI(1)).to.equal('ipfs://bafyfolder/1');
  });
  it('rejects wrong price, tampered payload, another wallet and a second mint', async () => {
    const { c, user, other, quote } = await setup();
    const q = await quote(user.address, ethers.parseEther('50'));
    await expect(call(c.connect(user), q, 1n)).to.be.revertedWithCustomError(c, 'WrongPrice');
    await expect(call(c.connect(user), { ...q, data: '0x00' })).to.be.revertedWithCustomError(c, 'BadSignature');
    await expect(call(c.connect(other), q)).to.be.revertedWithCustomError(c, 'BadSignature');
    await call(c.connect(user), q);
    await expect(call(c.connect(user), q)).to.be.revertedWithCustomError(c, 'AllowanceUsed');
  });
});
