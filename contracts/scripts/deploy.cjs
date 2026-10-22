const hre = require('hardhat');

async function main() {
  const {
    DROP_ID = '001', DROP_NAME = 'STRATA. 001: Contour', DROP_SYMBOL = 'STRATA001',
    SIGNER_ADDRESS, PUBLIC_URL, MINT_START, MINT_END, ROYALTY_RECEIVER,
  } = process.env;
  if (!SIGNER_ADDRESS || !PUBLIC_URL || !MINT_START || !MINT_END) throw new Error('Set SIGNER_ADDRESS, PUBLIC_URL, MINT_START and MINT_END in .env');
  const [deployer] = await hre.ethers.getSigners();
  const start = Math.floor(Date.parse(MINT_START) / 1000), end = Math.floor(Date.parse(MINT_END) / 1000);
  if (!(end > start)) throw new Error('MINT_END must be after MINT_START');
  const url = PUBLIC_URL.replace(/\/$/, '');
  const baseURI = `${url}/api/drops/${DROP_ID}/metadata/`;
  const contractURI = `${url}/api/drops/${DROP_ID}/contract.json`;
  const royalty = ROYALTY_RECEIVER || deployer.address;
  const args = [DROP_NAME, DROP_SYMBOL, SIGNER_ADDRESS, start, end, royalty, baseURI, contractURI];
  const c = await (await hre.ethers.getContractFactory('StrataDrop')).deploy(...args);
  await c.waitForDeployment();
  const addr = await c.getAddress();
  console.log(`StrataDrop ${DROP_ID}:`, addr);
  console.log('Mint window:', new Date(start * 1000).toISOString(), '→', new Date(end * 1000).toISOString());
  console.log('Royalties: 5% to', royalty);
  console.log(`\nAdd to the server env: CONTRACT_${DROP_ID}=${addr}`);
  console.log(`Verify: npx hardhat verify --network ${hre.network.name} ${addr} ${args.map((a) => JSON.stringify(String(a))).join(' ')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
