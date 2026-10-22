const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('StrataZone', () => {
  it('cancels a maker’s orders only with that maker’s signature, relayed by anyone', async () => {
    const [maker, other, relayer] = await ethers.getSigners();
    const seaport = await (await ethers.getContractFactory('MockSeaport')).deploy();
    const zone = await (await ethers.getContractFactory('StrataZone')).deploy(await seaport.getAddress());
    const Z = await zone.getAddress();
    const order = (offerer, salt, z = Z) => ({ offerer, zone: z, offer: [{ itemType: 2, token: other.address, identifierOrCriteria: 1, startAmount: 1, endAmount: 1 }],
      consideration: [{ itemType: 0, token: ethers.ZeroAddress, identifierOrCriteria: 0, startAmount: 100, endAmount: 100, recipient: offerer }],
      orderType: 0, startTime: 0, endTime: 9999999999, zoneHash: ethers.ZeroHash, salt, conduitKey: ethers.ZeroHash, counter: 0 });
    const orders = [order(maker.address, 1), order(maker.address, 2)];
    const hashes = await Promise.all(orders.map((o) => seaport.getOrderHash(o)));
    const domain = { name: 'StrataZone', version: '1', chainId: (await ethers.provider.getNetwork()).chainId, verifyingContract: Z };
    const types = { Cancel: [{ name: 'orderHashes', type: 'bytes32[]' }] };
    const sig = await maker.signTypedData(domain, types, { orderHashes: hashes });
    await expect(zone.connect(relayer).cancel(orders, await other.signTypedData(domain, types, { orderHashes: hashes }))).to.be.revertedWithCustomError(zone, 'BadSignature');
    await expect(zone.connect(relayer).cancel([orders[0]], sig)).to.be.revertedWithCustomError(zone, 'BadSignature'); // signed a different set
    await expect(zone.connect(relayer).cancel([order(maker.address, 3, other.address)], sig)).to.be.revertedWithCustomError(zone, 'NotOurs');
    await expect(zone.connect(relayer).cancel([orders[0], order(other.address, 4)], sig)).to.be.revertedWithCustomError(zone, 'MixedMakers');
    await zone.connect(relayer).cancel(orders, sig);
    expect(await seaport.cancelled(hashes[0])).to.equal(true);
    expect(await seaport.cancelled(hashes[1])).to.equal(true);
  });
});
