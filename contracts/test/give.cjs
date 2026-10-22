const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('Give (the open donation: a Receipt for 0.1 AVAX or more)', () => {
  async function setup() {
    const [owner, user, other, operator, payTo] = await ethers.getSigners();
    const r = await (await ethers.getContractFactory('StrataReceipt')).deploy('Receipt', 'RECEIPT', owner.address, 'https://x/api/receipts/', 'https://x/api/receipts/contract.json');
    const g = await (await ethers.getContractFactory('StrataGive')).deploy(owner.address, await r.getAddress(), payTo.address, ethers.parseEther('0.1'));
    await r.setMinter(await g.getAddress());
    return { r, g, owner, user, other, operator, payTo };
  }

  it('0.1 AVAX: the money reaches payTo and a Receipt is minted in the same transaction', async () => {
    const { r, g, user, payTo } = await setup();
    const tx = g.connect(user).give({ value: ethers.parseEther('0.1') });
    await expect(tx).to.emit(g, 'Gave').withArgs(user.address, ethers.parseEther('0.1'), ethers.parseEther('0.1'), 1);
    await expect(tx).to.emit(r, 'Issued').withArgs(user.address, 1, 0, ethers.parseEther('0.1'));
    await expect(tx).to.changeEtherBalances([user, payTo], [-ethers.parseEther('0.1'), ethers.parseEther('0.1')]);
    expect(await r.ownerOf(1)).to.equal(user.address);
    expect(await g.given(user.address)).to.equal(ethers.parseEther('0.1'));
    expect(await g.total()).to.equal(ethers.parseEther('0.1'));
    expect(await g.gifts()).to.equal(1);
    expect(await ethers.provider.getBalance(await g.getAddress())).to.equal(0);
  });
  it('below the minimum: refused, nothing moves', async () => {
    const { g, user } = await setup();
    await expect(g.connect(user).give({ value: ethers.parseEther('0.099') })).to.be.revertedWithCustomError(g, 'BelowMinimum');
    await expect(g.connect(user).give()).to.be.revertedWithCustomError(g, 'BelowMinimum');
  });
  it('a second gift adds up on chain; no second Receipt', async () => {
    const { r, g, user, payTo } = await setup();
    await g.connect(user).give({ value: ethers.parseEther('0.5') });
    const tx = g.connect(user).give({ value: ethers.parseEther('1') });
    await expect(tx).to.emit(g, 'Gave').withArgs(user.address, ethers.parseEther('1'), ethers.parseEther('1.5'), 0);
    await expect(tx).to.not.emit(r, 'Issued');
    await expect(tx).to.changeEtherBalances([user, payTo], [-ethers.parseEther('1'), ethers.parseEther('1')]);
    expect(await r.balanceOf(user.address)).to.equal(1);
    expect(await g.given(user.address)).to.equal(ethers.parseEther('1.5'));
    expect(await g.gifts()).to.equal(2);
  });
  it('a wallet that already holds a Receipt (minted another way) gives and gets no second one', async () => {
    const { r, g, owner, user } = await setup();
    await g.connect(owner).issue(user.address, 7, ethers.parseEther('0.05')); // by hand, as the Persona mint would have
    expect(await r.balanceOf(user.address)).to.equal(1);
    await expect(g.connect(user).give({ value: ethers.parseEther('0.1') })).to.emit(g, 'Gave').withArgs(user.address, ethers.parseEther('0.1'), ethers.parseEther('0.1'), 0);
    expect(await r.balanceOf(user.address)).to.equal(1);
  });
  it('issue by hand: the owner and the operator only', async () => {
    const { r, g, owner, user, other, operator } = await setup();
    await expect(g.connect(other).issue(user.address, 0, 1)).to.be.revertedWithCustomError(g, 'NotOperator');
    await g.connect(owner).setOperator(operator.address);
    await expect(g.connect(operator).issue(user.address, 0, 1)).to.emit(r, 'Issued').withArgs(user.address, 1, 0, 1);
    await expect(g.connect(operator).issue(user.address, 0, 1)).to.not.emit(r, 'Issued');   // the Receipt answers 0, never a second one
    expect(await r.balanceOf(user.address)).to.equal(1);
  });
  it('the owner can change the minimum and where the money goes; nobody can renounce', async () => {
    const { g, owner, user, other } = await setup();
    await expect(g.connect(user).setMinGift(1)).to.be.revertedWithCustomError(g, 'OwnableUnauthorizedAccount');
    await g.connect(owner).setMinGift(ethers.parseEther('0.2'));
    await expect(g.connect(user).give({ value: ethers.parseEther('0.1') })).to.be.revertedWithCustomError(g, 'BelowMinimum');
    await g.connect(owner).setPayTo(other.address);
    await expect(g.connect(user).give({ value: ethers.parseEther('0.2') })).to.changeEtherBalances([user, other], [-ethers.parseEther('0.2'), ethers.parseEther('0.2')]);
    await expect(g.connect(owner).renounceOwnership()).to.be.revertedWithCustomError(g, 'CannotRenounce');
  });
  it('the Receipt refuses a mint from anyone but its minter', async () => {
    const { r, user } = await setup();
    await expect(r.connect(user).issue(user.address, 0, 1)).to.be.revertedWithCustomError(r, 'NotMinter');
  });
});
