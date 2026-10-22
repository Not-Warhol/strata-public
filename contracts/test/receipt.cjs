const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('Receipt (issued with the Persona mint)', () => {
  async function setup() {
    const [owner, user, other, third] = await ethers.getSigners();
    const quoteSigner = ethers.Wallet.createRandom();
    const now = (await ethers.provider.getBlock('latest')).timestamp;
    const p = await (await ethers.getContractFactory('PersonaDrop')).deploy('STRATA. 002: Persona', 'STRATA002', quoteSigner.address, now - 10, now + 7 * 86400, owner.address, 'https://x/api/drops/002/metadata/', 'https://x/api/drops/002/contract.json');
    const r = await (await ethers.getContractFactory('StrataReceipt')).deploy('Receipt', 'RECEIPT', owner.address, 'https://x/api/receipts/', 'https://x/api/receipts/contract.json');
    await r.setMinter(await p.getAddress());
    await p.setReceipt(await r.getAddress(), ethers.parseEther('0.05'));
    const { chainId } = await ethers.provider.getNetwork();
    const domain = { name: 'StrataDrop', version: '2', chainId, verifyingContract: await p.getAddress() };
    const types = { Mint: [
      { name: 'to', type: 'address' }, { name: 'price', type: 'uint256' }, { name: 'seeds', type: 'bytes32[]' },
      { name: 'data', type: 'bytes[]' }, { name: 'allowance', type: 'uint8' }, { name: 'deadline', type: 'uint256' }] };
    let mask = 0;
    const mint = async (w, avax, n = 1) => {
      const v = { to: w.address, price: 0n, seeds: Array.from({ length: n }, () => ethers.zeroPadValue(ethers.toBeHex(++mask), 32)), allowance: 8, deadline: now + 3600 };
      v.data = v.seeds.map(() => '0x01');
      return p.connect(w).mint(v.price, v.seeds, v.data, v.allowance, v.deadline, await quoteSigner.signTypedData(domain, types, v), { value: ethers.parseEther(avax) });
    };
    return { p, r, owner, user, other, third, mint };
  }

  it('a gift of 0.05 AVAX or more gets the mask and a receipt in the same transaction', async () => {
    const { p, r, owner, user, mint } = await setup();
    const tx = mint(user, '0.5');
    await expect(tx).to.emit(r, 'Issued').withArgs(user.address, 1, 1, ethers.parseEther('0.5'));
    await expect(tx).to.changeEtherBalances([user, owner], [-ethers.parseEther('0.5'), ethers.parseEther('0.5')]);
    const rc = await (await tx).wait();
    expect(await p.ownerOf(1)).to.equal(user.address);
    expect(await r.ownerOf(1)).to.equal(user.address);
    const g = await r.gifts(1);
    expect(g.paid).to.equal(ethers.parseEther('0.5')); expect(g.persona).to.equal(1); expect(g.blockNumber).to.equal(rc.blockNumber);
    expect(await r.tokenURI(1)).to.equal('https://x/api/receipts/1');
  });
  it('free or below 0.05: the mask, no receipt', async () => {
    const { p, r, user, other, mint } = await setup();
    await mint(user, '0');
    await mint(other, '0.049');
    expect(await p.totalSupply()).to.equal(2);
    expect(await r.totalMinted()).to.equal(0);
  });
  it('one receipt per wallet: a second gift mints fine and gets no second receipt', async () => {
    const { p, r, user, other, mint } = await setup();
    await mint(user, '0.1');
    await expect(mint(user, '2')).to.not.emit(r, 'Issued');
    await mint(other, '0.05', 2); // two masks in one mint: one receipt, pointing at the first mask
    expect(await r.totalMinted()).to.equal(2);
    expect((await r.gifts(2)).persona).to.equal(3);
    expect(await p.totalSupply()).to.equal(4);
  });
  it('a broken receipt never blocks a mint', async () => {
    const { p, r, user, mint } = await setup();
    await r.setMinter(ethers.ZeroAddress); // Receipt now rejects Persona: issue reverts inside the mint
    await expect(mint(user, '1')).to.not.be.reverted;
    expect(await p.ownerOf(1)).to.equal(user.address);
    expect(await r.totalMinted()).to.equal(0);
    await p.setReceipt(ethers.ZeroAddress, 0); // receipts off
    await expect(mint(user, '1')).to.not.be.reverted;
  });
  it('the owner can issue one by hand (once per wallet), nobody else can issue', async () => {
    const { r, user, other, mint } = await setup();
    await expect(r.connect(user).issue(user.address, 1, 1)).to.be.revertedWithCustomError(r, 'NotMinter');
    await expect(r.connect(user).ownerIssue(user.address, 1, 1)).to.be.revertedWithCustomError(r, 'OwnableUnauthorizedAccount');
    await r.ownerIssue(other.address, 7, ethers.parseEther('0.2'));
    await expect(r.ownerIssue(other.address, 7, 1)).to.be.revertedWithCustomError(r, 'AlreadyReceived');
    await expect(mint(other, '1')).to.not.emit(r, 'Issued');
  });
  it('transferable, burnable by its holder only; royalties 5%; metadata can move then freeze', async () => {
    const { r, owner, user, other, mint } = await setup();
    await mint(user, '0.3');
    await r.connect(user).transferFrom(user.address, other.address, 1);
    await expect(r.connect(user).burn(1)).to.be.revertedWithCustomError(r, 'ERC721InsufficientApproval');
    const [recv, amt] = await r.royaltyInfo(1, ethers.parseEther('1'));
    expect(recv).to.equal(owner.address); expect(amt).to.equal(ethers.parseEther('0.05'));
    await r.setBaseURI('ipfs://CID/');
    expect(await r.tokenURI(1)).to.equal('ipfs://CID/1');
    await r.freezeMetadata();
    await expect(r.setBaseURI('https://y/')).to.be.revertedWithCustomError(r, 'MetadataIsFrozen');
    await expect(r.renounceOwnership()).to.be.revertedWithCustomError(r, 'CannotRenounce');
    expect(await r.supportsInterface('0x49064906')).to.equal(true);
    await r.connect(other).burn(1);
    await expect(r.ownerOf(1)).to.be.revertedWithCustomError(r, 'ERC721NonexistentToken');
  });
});
