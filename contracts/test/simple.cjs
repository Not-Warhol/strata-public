const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('SimpleDrop', () => {
  async function setup(max = 4) {
    const [owner, user, other] = await ethers.getSigners();
    const c = await (await ethers.getContractFactory('SimpleDrop')).deploy('Test', 'TST', max, owner.address, 'https://x/meta/', 'https://x/contract.json');
    return { c, owner, user, other };
  }

  it('lets only the owner mint, in order, up to the cap', async () => {
    const { c, owner, user } = await setup();
    await expect(c.connect(user).ownerMint(user.address, 1)).to.be.revertedWithCustomError(c, 'OwnableUnauthorizedAccount');
    await c.ownerMint(owner.address, 4);
    expect(await c.totalSupply()).to.equal(4);
    expect(await c.ownerOf(4)).to.equal(owner.address);
    expect(await c.tokenURI(3)).to.equal('https://x/meta/3');
    await expect(c.ownerMint(owner.address, 1)).to.be.revertedWithCustomError(c, 'SoldOut');
  });
  it('opens a public mint at a fixed price and forwards the payment to the owner', async () => {
    const { c, owner, user } = await setup();
    await expect(c.connect(user).mint(1)).to.be.revertedWithCustomError(c, 'MintClosed');
    await c.setPublicMint(true, ethers.parseEther('1'));
    await expect(c.connect(user).mint(1, { value: 1n })).to.be.revertedWithCustomError(c, 'WrongPrice');
    const before = await ethers.provider.getBalance(owner.address);
    await c.connect(user).mint(2, { value: ethers.parseEther('2') });
    expect(await ethers.provider.getBalance(owner.address) - before).to.equal(ethers.parseEther('2'));
    expect(await ethers.provider.getBalance(await c.getAddress())).to.equal(0);
    expect(await c.balanceOf(user.address)).to.equal(2);
  });
  it('pays 5% royalties, exposes contractURI and ERC-4906, and cannot be renounced', async () => {
    const { c, owner } = await setup();
    const [recv, amount] = await c.royaltyInfo(1, ethers.parseEther('10'));
    expect(recv).to.equal(owner.address);
    expect(amount).to.equal(ethers.parseEther('0.5'));
    expect(await c.contractURI()).to.equal('https://x/contract.json');
    expect(await c.supportsInterface('0x49064906')).to.equal(true);
    expect(await c.supportsInterface('0x2a55205a')).to.equal(true);
    await expect(c.renounceOwnership()).to.be.revertedWithCustomError(c, 'CannotRenounce');
  });
  it('moves metadata, then freezes it for good', async () => {
    const { c, owner } = await setup();
    await c.ownerMint(owner.address, 2);
    await expect(c.setBaseURI('ipfs://cid/')).to.emit(c, 'BatchMetadataUpdate').withArgs(1, 2);
    expect(await c.tokenURI(1)).to.equal('ipfs://cid/1');
    await c.freezeMetadata();
    await expect(c.setBaseURI('https://y/')).to.be.revertedWithCustomError(c, 'MetadataIsFrozen');
  });
});
