const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');

describe('StrataRewards', () => {
  async function setup() {
    const [owner, server, alice, bob, eve] = await ethers.getSigners();
    const rw = await (await ethers.getContractFactory('StrataRewards')).deploy(owner.address, server.address);
    const tok = await (await ethers.getContractFactory('MockToken')).deploy();
    const nft = await (await ethers.getContractFactory('MockNFT')).deploy(owner.address);
    const R = await rw.getAddress(), T = await tok.getAddress(), N = await nft.getAddress();
    await tok.mint(R, ethers.parseEther('100'));
    for (const id of [1, 2, 3]) { await nft.mint(owner.address, id); await nft['safeTransferFrom(address,address,uint256)'](owner.address, R, id); }
    const domain = { name: 'StrataRewards', version: '1', chainId: (await ethers.provider.getNetwork()).chainId, verifyingContract: R };
    const types = { Claim: [
      { name: 'wallet', type: 'address' }, { name: 'token', type: 'address' }, { name: 'kind', type: 'uint8' }, { name: 'amount', type: 'uint256' },
      { name: 'ids', type: 'uint256[]' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] };
    const deadline = (await time.latest()) + 3600;
    const sign = (c, by = server) => by.signTypedData(domain, types, { deadline, ...c });
    const claim = async (w, c, sig) => rw.connect(w).claim(c.token, c.kind, c.amount, c.ids, c.nonce, c.deadline ?? deadline, sig ?? await sign({ wallet: w.address, ...c }));
    return { owner, server, alice, bob, eve, rw, tok, nft, T, N, sign, claim, deadline };
  }

  it('pays ERC-20 and ERC-721 claims signed by the server, once each', async () => {
    const s = await setup();
    await s.rw.setDailyLimit(s.T, ethers.parseEther('10'));
    await s.rw.setDailyLimit(s.N, 2);
    const c20 = { token: s.T, kind: 0, amount: ethers.parseEther('3'), ids: [], nonce: 1 };
    await expect(s.claim(s.alice, c20)).to.emit(s.rw, 'Claimed');
    expect(await s.tok.balanceOf(s.alice.address)).to.equal(ethers.parseEther('3'));
    await expect(s.claim(s.alice, c20)).to.be.revertedWithCustomError(s.rw, 'Used');
    const c721 = { token: s.N, kind: 1, amount: 0, ids: [2], nonce: 2 };
    await s.claim(s.alice, c721);
    expect(await s.nft.ownerOf(2)).to.equal(s.alice.address);
  });

  it('refuses other wallets, wrong signers, changed claims and late claims', async () => {
    const s = await setup();
    await s.rw.setDailyLimit(s.T, ethers.parseEther('10'));
    const c = { token: s.T, kind: 0, amount: ethers.parseEther('1'), ids: [], nonce: 7 };
    const sig = await s.sign({ wallet: s.alice.address, ...c });
    await expect(s.claim(s.eve, c, sig)).to.be.revertedWithCustomError(s.rw, 'BadSignature'); // signed for alice
    await expect(s.claim(s.alice, { ...c, amount: ethers.parseEther('5') }, sig)).to.be.revertedWithCustomError(s.rw, 'BadSignature');
    await expect(s.claim(s.alice, c, await s.sign({ wallet: s.alice.address, ...c }, s.eve))).to.be.revertedWithCustomError(s.rw, 'BadSignature');
    await time.increase(7200);
    await expect(s.claim(s.alice, c, sig)).to.be.revertedWithCustomError(s.rw, 'Expired');
  });

  it('daily limits: off by default, capped per UTC day, fresh the next day', async () => {
    const s = await setup();
    const c = (nonce, ids) => ({ token: s.N, kind: 1, amount: 0, ids, nonce });
    await expect(s.claim(s.alice, c(1, [1]))).to.be.revertedWithCustomError(s.rw, 'RewardOff');
    await s.rw.setDailyLimit(s.N, 2);
    await expect(s.claim(s.alice, c(2, [1, 2, 3]))).to.be.revertedWithCustomError(s.rw, 'OverDailyLimit');
    await s.claim(s.alice, c(3, [1, 2]));
    await expect(s.claim(s.bob, c(4, [3]))).to.be.revertedWithCustomError(s.rw, 'OverDailyLimit');
    await time.increase(86400);
    const d2 = (await time.latest()) + 3600;
    await s.rw.connect(s.bob).claim(s.N, 1, 0, [3], 5, d2, await s.sign({ wallet: s.bob.address, ...c(5, [3]), deadline: d2 }));
    expect(await s.nft.ownerOf(3)).to.equal(s.bob.address);
    await expect(s.claim(s.alice, { token: s.N, kind: 1, amount: 0, ids: [], nonce: 9 })).to.be.reverted; // nothing to pay
  });

  it('owner: pause, signer, withdraw; nobody else; never renounced', async () => {
    const s = await setup();
    await s.rw.setDailyLimit(s.T, ethers.parseEther('10'));
    await s.rw.setPaused(true);
    await expect(s.claim(s.alice, { token: s.T, kind: 0, amount: 1n, ids: [], nonce: 1 })).to.be.revertedWithCustomError(s.rw, 'IsPaused');
    await s.rw.withdraw(s.T, ethers.parseEther('100'), []);
    await s.rw.withdraw(s.N, 0, [1, 2, 3]);
    expect(await s.tok.balanceOf(s.owner.address)).to.equal(ethers.parseEther('100'));
    expect(await s.nft.ownerOf(1)).to.equal(s.owner.address);
    for (const f of [() => s.rw.connect(s.eve).setPaused(false), () => s.rw.connect(s.eve).setSigner(s.eve.address), () => s.rw.connect(s.eve).setDailyLimit(s.T, 1), () => s.rw.connect(s.eve).withdraw(s.T, 1, [])]) await expect(f()).to.be.reverted;
    await expect(s.rw.renounceOwnership()).to.be.revertedWith('disabled');
  });
});
