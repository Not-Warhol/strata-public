const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('StrataStake', () => {
  async function setup() {
    const [owner, alice, bob, eve] = await ethers.getSigners();
    const nft = await (await ethers.getContractFactory('MockNFT')).deploy(owner.address);
    const stake = await (await ethers.getContractFactory('StrataStake')).deploy(owner.address, await nft.getAddress());
    for (const id of [1, 2, 3]) await nft.mint(alice.address, id);
    await nft.mint(bob.address, 4);
    return { owner, alice, bob, eve, nft, stake };
  }

  it('stakes owned tokens without moving them', async () => {
    const s = await setup();
    await expect(s.stake.connect(s.alice).stake([1, 2])).to.emit(s.stake, 'Staked');
    expect(await s.nft.ownerOf(1)).to.equal(s.alice.address); // never leaves the wallet
    expect(await s.stake.isStaked(1)).to.equal(true);
    expect(await s.stake.isStaked(3)).to.equal(false);
    const [w, since] = await s.stake.stakesOf([1, 2, 3]);
    expect(w).to.deep.equal([s.alice.address, s.alice.address, ethers.ZeroAddress]);
    expect(since[0]).to.be.gt(0n);
    expect(since[2]).to.equal(0n);
  });

  it('refuses tokens the caller does not own, doubles and empty lists', async () => {
    const s = await setup();
    await expect(s.stake.connect(s.eve).stake([1])).to.be.revertedWithCustomError(s.stake, 'NotOwner').withArgs(1);
    await s.stake.connect(s.alice).stake([1]);
    await expect(s.stake.connect(s.alice).stake([1])).to.be.revertedWithCustomError(s.stake, 'AlreadyStaked').withArgs(1);
    await expect(s.stake.connect(s.alice).stake([])).to.be.revertedWithCustomError(s.stake, 'Empty');
    await expect(s.stake.connect(s.alice).stake([99])).to.be.reverted; // not minted
  });

  it('a stake ends when the token moves; the new owner can stake it from zero', async () => {
    const s = await setup();
    await s.stake.connect(s.alice).stake([1]);
    await s.nft.connect(s.alice).transferFrom(s.alice.address, s.bob.address, 1);
    expect(await s.stake.isStaked(1)).to.equal(false);
    expect((await s.stake.stakesOf([1]))[0][0]).to.equal(ethers.ZeroAddress);
    await expect(s.stake.connect(s.alice).stake([1])).to.be.revertedWithCustomError(s.stake, 'NotOwner');
    await expect(s.stake.connect(s.bob).stake([1])).to.emit(s.stake, 'Unstaked').withArgs(s.alice.address, 1).and.to.emit(s.stake, 'Staked');
    expect(await s.stake.isStaked(1)).to.equal(true);
    expect((await s.stake.stakes(1)).wallet).to.equal(s.bob.address);
  });

  it('only the staker unstakes; unstaking works while paused', async () => {
    const s = await setup();
    await s.stake.connect(s.alice).stake([1, 2]);
    await expect(s.stake.connect(s.eve).unstake([1])).to.be.revertedWithCustomError(s.stake, 'NotStaker').withArgs(1);
    await s.stake.connect(s.owner).setPaused(true);
    await expect(s.stake.connect(s.alice).stake([3])).to.be.revertedWithCustomError(s.stake, 'IsPaused');
    await expect(s.stake.connect(s.alice).unstake([1])).to.emit(s.stake, 'Unstaked').withArgs(s.alice.address, 1);
    expect(await s.stake.isStaked(1)).to.equal(false);
    expect(await s.stake.isStaked(2)).to.equal(true);
    await expect(s.stake.connect(s.alice).unstake([1])).to.be.revertedWithCustomError(s.stake, 'NotStaker');
  });

  it('owner-only pause; ownership never renounced', async () => {
    const s = await setup();
    await expect(s.stake.connect(s.eve).setPaused(true)).to.be.reverted;
    await expect(s.stake.connect(s.owner).setPaused(true)).to.emit(s.stake, 'Paused').withArgs(true);
    await expect(s.stake.renounceOwnership()).to.be.revertedWith('disabled');
  });
});
