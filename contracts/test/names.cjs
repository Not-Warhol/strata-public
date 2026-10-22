const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');

describe('StrataNames', () => {
  async function setup() {
    const [owner, registrar, alice, bob, eve] = await ethers.getSigners();
    const names = await (await ethers.getContractFactory('StrataNames')).deploy(owner.address, registrar.address);
    const domain = { name: 'StrataNames', version: '1', chainId: (await ethers.provider.getNetwork()).chainId, verifyingContract: await names.getAddress() };
    const types = { Name: [{ name: 'wallet', type: 'address' }, { name: 'name', type: 'string' }] };
    const sign = (w, name) => w.signTypedData(domain, types, { wallet: w.address, name });
    return { owner, registrar, alice, bob, eve, names, sign };
  }
  it('writes a signed name once, forever; one wallet per name', async () => {
    const s = await setup();
    await s.names.connect(s.registrar).register(s.alice.address, 'alice_01', await s.sign(s.alice, 'alice_01'));
    expect(await s.names.nameOf(s.alice.address)).to.equal('alice_01');
    expect(await s.names.walletOf(ethers.id('alice_01'))).to.equal(s.alice.address);
    await expect(s.names.connect(s.registrar).register(s.alice.address, 'other', await s.sign(s.alice, 'other'))).to.be.revertedWithCustomError(s.names, 'HasName');
    await expect(s.names.connect(s.registrar).register(s.bob.address, 'alice_01', await s.sign(s.bob, 'alice_01'))).to.be.revertedWithCustomError(s.names, 'Taken');
    await s.names.connect(s.owner).register(s.bob.address, 'bob', await s.sign(s.bob, 'bob')); // the owner can write too
  });
  it('only the registrar or owner writes, only with the wallet’s own signature, only valid names', async () => {
    const s = await setup();
    await expect(s.names.connect(s.eve).register(s.alice.address, 'alice', await s.sign(s.alice, 'alice'))).to.be.revertedWithCustomError(s.names, 'NotRegistrar');
    await expect(s.names.connect(s.registrar).register(s.alice.address, 'alice', await s.sign(s.eve, 'alice'))).to.be.revertedWithCustomError(s.names, 'BadSignature');
    await expect(s.names.connect(s.registrar).register(s.alice.address, 'alice', await s.sign(s.alice, 'alicia'))).to.be.revertedWithCustomError(s.names, 'BadSignature');
    for (const bad of ['ab', 'Alice', 'al ice', 'a'.repeat(21), 'ação', 'x-y']) {
      await expect(s.names.connect(s.registrar).register(s.alice.address, bad, await s.sign(s.alice, bad))).to.be.revertedWithCustomError(s.names, 'BadName');
    }
    await expect(s.names.connect(s.eve).setRegistrar(s.eve.address)).to.be.reverted;
    await expect(s.names.renounceOwnership()).to.be.revertedWith('disabled');
  });  it('moderation: owner or registrar removes a name; it stays blocked, the wallet may pick another', async () => {
    const s = await setup();
    await s.names.connect(s.registrar).register(s.alice.address, 'rude', await s.sign(s.alice, 'rude'));
    await expect(s.names.connect(s.eve).remove(s.alice.address)).to.be.revertedWithCustomError(s.names, 'NotRegistrar');
    await expect(s.names.connect(s.registrar).remove(s.alice.address)).to.emit(s.names, 'NameRemoved').withArgs(s.alice.address, 'rude');
    expect(await s.names.nameOf(s.alice.address)).to.equal('');
    await expect(s.names.connect(s.owner).remove(s.alice.address)).to.be.revertedWithCustomError(s.names, 'NoName');
    await expect(s.names.connect(s.registrar).register(s.bob.address, 'rude', await s.sign(s.bob, 'rude'))).to.be.revertedWithCustomError(s.names, 'Taken');
    await s.names.connect(s.registrar).register(s.alice.address, 'nice', await s.sign(s.alice, 'nice'));
    expect(await s.names.nameOf(s.alice.address)).to.equal('nice');
  });
});

describe('StrataTransfer', () => {
  async function setup() {
    const [owner, holder, to, relayer, eve] = await ethers.getSigners();
    const a = await (await ethers.getContractFactory('MockNFT')).deploy(owner.address);
    const b = await (await ethers.getContractFactory('MockNFT')).deploy(owner.address);
    const tr = await (await ethers.getContractFactory('StrataTransfer')).deploy();
    for (const id of [1, 2, 3]) await a.mint(holder.address, id);
    await b.mint(holder.address, 7);
    for (const c of [a, b]) await c.connect(holder).setApprovalForAll(await tr.getAddress(), true);
    const domain = { name: 'StrataTransfer', version: '1', chainId: (await ethers.provider.getNetwork()).chainId, verifyingContract: await tr.getAddress() };
    const types = { Send: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'items', type: 'Item[]' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }], Item: [{ name: 'collection', type: 'address' }, { name: 'tokenId', type: 'uint256' }] };
    return { owner, holder, to, relayer, eve, a, b, tr, domain, types };
  }
  it('sends several pieces of several collections in one transaction', async () => {
    const s = await setup();
    await s.tr.connect(s.holder).send(s.to.address, [{ collection: await s.a.getAddress(), tokenId: 1 }, { collection: await s.a.getAddress(), tokenId: 2 }, { collection: await s.b.getAddress(), tokenId: 7 }]);
    expect(await s.a.ownerOf(1)).to.equal(s.to.address);
    expect(await s.a.ownerOf(2)).to.equal(s.to.address);
    expect(await s.b.ownerOf(7)).to.equal(s.to.address);
    expect(await s.a.ownerOf(3)).to.equal(s.holder.address);
  });
  it('nobody moves pieces that are not theirs', async () => {
    const s = await setup();
    await expect(s.tr.connect(s.eve).send(s.eve.address, [{ collection: await s.a.getAddress(), tokenId: 1 }])).to.be.reverted;
  });
  it('sendFor: relayed with the holder’s signature, once, before the deadline', async () => {
    const s = await setup();
    const items = [{ collection: await s.a.getAddress(), tokenId: 1 }, { collection: await s.b.getAddress(), tokenId: 7 }];
    const deadline = (await time.latest()) + 600;
    const v = { from: s.holder.address, to: s.to.address, items, nonce: 0, deadline };
    await expect(s.tr.connect(s.relayer).sendFor(s.holder.address, s.eve.address, items, deadline, await s.holder.signTypedData(s.domain, s.types, v))).to.be.revertedWithCustomError(s.tr, 'BadSignature'); // other recipient
    await expect(s.tr.connect(s.relayer).sendFor(s.holder.address, s.to.address, items, deadline, await s.eve.signTypedData(s.domain, s.types, v))).to.be.revertedWithCustomError(s.tr, 'BadSignature');
    const sig = await s.holder.signTypedData(s.domain, s.types, v);
    await s.tr.connect(s.relayer).sendFor(s.holder.address, s.to.address, items, deadline, sig);
    expect(await s.b.ownerOf(7)).to.equal(s.to.address);
    await expect(s.tr.connect(s.relayer).sendFor(s.holder.address, s.to.address, items, deadline, sig)).to.be.revertedWithCustomError(s.tr, 'BadSignature'); // nonce used
    await time.increase(700);
    const v2 = { ...v, items: [{ collection: await s.a.getAddress(), tokenId: 2 }], nonce: 1 };
    await expect(s.tr.connect(s.relayer).sendFor(s.holder.address, s.to.address, v2.items, deadline, await s.holder.signTypedData(s.domain, s.types, v2))).to.be.revertedWithCustomError(s.tr, 'Expired');
  });
  it('refuses a contract that cannot hold NFTs (nothing gets stuck)', async () => {
    const s = await setup();
    await expect(s.tr.connect(s.holder).send(await s.tr.getAddress(), [{ collection: await s.a.getAddress(), tokenId: 1 }])).to.be.reverted;
    expect(await s.a.ownerOf(1)).to.equal(s.holder.address);
  });
});
