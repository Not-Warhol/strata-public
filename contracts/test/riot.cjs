const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');

describe('StrataRiot', () => {
  async function setup() {
    const [owner, server, alice, bob, eve] = await ethers.getSigners();
    const r = await (await ethers.getContractFactory('StrataRiot')).deploy('STRATA. Riot', 'RIOT', owner.address, server.address, owner.address, 'https://x/meta/', 'https://x/contract.json');
    const domain = { name: 'StrataRiot', version: '1', chainId: (await ethers.provider.getNetwork()).chainId, verifyingContract: await r.getAddress() };
    const types = { Reinvest: [{ name: 'wallet', type: 'address' }, { name: 'tokenId', type: 'uint256' }, { name: 'levels', type: 'uint8' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] };
    const deadline = (await time.latest()) + 3600;
    const sign = (w, tokenId, levels, nonce, by = server, dl = deadline) => by.signTypedData(domain, types, { wallet: w.address, tokenId, levels, nonce, deadline: dl });
    const go = async (w, tokenId, levels, nonce, sig) => r.connect(w).reinvest(tokenId, levels, nonce, deadline, sig ?? await sign(w, tokenId, levels, nonce));
    return { owner, server, alice, bob, eve, r, sign, go, deadline };
  }

  it('mints at the levels reinvested, then levels up to 10; one event per reinvest', async () => {
    const s = await setup();
    await expect(s.go(s.alice, 0, 3, 1)).to.emit(s.r, 'Reinvested').withArgs(1, s.alice.address, 0, 3, 1);
    expect(await s.r.ownerOf(1)).to.equal(s.alice.address);
    expect(await s.r.levelOf(1)).to.equal(3);
    await expect(s.go(s.alice, 1, 7, 2)).to.emit(s.r, 'Reinvested').withArgs(1, s.alice.address, 3, 10, 2).and.to.emit(s.r, 'MetadataUpdate').withArgs(1);
    expect(await s.r.levelOf(1)).to.equal(10);
    await expect(s.go(s.alice, 1, 1, 3)).to.be.revertedWithCustomError(s.r, 'BadLevels');
    await expect(s.go(s.alice, 0, 0, 4)).to.be.revertedWithCustomError(s.r, 'BadLevels');
    await expect(s.go(s.bob, 0, 11, 1)).to.be.revertedWithCustomError(s.r, 'BadLevels');
    await s.go(s.bob, 0, 10, 2); // ten at once
    expect(await s.r.levelOf(2)).to.equal(10);
  });

  it('only the holder levels a piece, only with its own signed message, once, before the deadline', async () => {
    const s = await setup();
    await s.go(s.alice, 0, 2, 1);
    await expect(s.go(s.bob, 1, 1, 1)).to.be.revertedWithCustomError(s.r, 'NotHolder');
    const sig = await s.sign(s.alice, 1, 1, 9);
    await expect(s.r.connect(s.eve).reinvest(1, 1, 9, s.deadline, sig)).to.be.revertedWithCustomError(s.r, 'BadSignature');      // signed for alice
    await expect(s.r.connect(s.alice).reinvest(1, 2, 9, s.deadline, sig)).to.be.revertedWithCustomError(s.r, 'BadSignature');    // levels changed
    await expect(s.go(s.alice, 1, 1, 9, await s.sign(s.alice, 1, 1, 9, s.eve))).to.be.revertedWithCustomError(s.r, 'BadSignature');
    await s.r.connect(s.alice).reinvest(1, 1, 9, s.deadline, sig);
    await expect(s.r.connect(s.alice).reinvest(1, 1, 9, s.deadline, sig)).to.be.revertedWithCustomError(s.r, 'Used');
    await time.increase(7200);
    await expect(s.go(s.alice, 1, 1, 10)).to.be.revertedWithCustomError(s.r, 'Expired');
  });

  it('a sold piece levels up for its new holder; the holder can burn it (level stays readable)', async () => {
    const s = await setup();
    await s.go(s.alice, 0, 4, 1);
    await s.r.connect(s.alice).transferFrom(s.alice.address, s.bob.address, 1);
    await expect(s.go(s.alice, 1, 1, 2)).to.be.revertedWithCustomError(s.r, 'NotHolder');
    await s.go(s.bob, 1, 2, 1);
    expect(await s.r.levelOf(1)).to.equal(6);
    await expect(s.r.connect(s.eve).burn(1)).to.be.reverted;
    await expect(s.r.connect(s.bob).burn(1)).to.emit(s.r, 'Transfer').withArgs(s.bob.address, ethers.ZeroAddress, 1);
    await expect(s.r.ownerOf(1)).to.be.reverted;
    expect(await s.r.levelOf(1)).to.equal(6);
    await expect(s.go(s.bob, 1, 1, 3)).to.be.revertedWithCustomError(s.r, 'NotHolder');
    await s.go(s.bob, 0, 1, 4); // after a burn, a new piece starts again
    expect(await s.r.ownerOf(2)).to.equal(s.bob.address);
  });

  it('owner: signer, metadata, freeze, royalties; nobody else; never renounced', async () => {
    const s = await setup();
    await s.go(s.alice, 0, 1, 1);
    expect(await s.r.tokenURI(1)).to.equal('https://x/meta/1');
    const [to, fee] = await s.r.royaltyInfo(1, 10000);
    expect([to, fee]).to.deep.equal([s.owner.address, 500n]);
    expect(await s.r.supportsInterface('0x49064906')).to.equal(true);
    await s.r.setBaseURI('ipfs://cid/');
    await s.r.freezeMetadata();
    await expect(s.r.setBaseURI('x')).to.be.revertedWithCustomError(s.r, 'MetadataIsFrozen');
    for (const f of [() => s.r.connect(s.eve).setSigner(s.eve.address), () => s.r.connect(s.eve).refresh(1), () => s.r.connect(s.eve).setContractURI('x'), () => s.r.connect(s.eve).setRoyaltyReceiver(s.eve.address)]) await expect(f()).to.be.reverted;
    await expect(s.r.renounceOwnership()).to.be.revertedWithCustomError(s.r, 'CannotRenounce');
    await s.r.setSigner(s.eve.address);
    await expect(s.go(s.alice, 1, 1, 2)).to.be.revertedWithCustomError(s.r, 'BadSignature'); // old signer no longer valid
  });
});
