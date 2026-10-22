require('@nomicfoundation/hardhat-toolbox');
require('dotenv').config();

const accounts = process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [];

module.exports = {
  solidity: { version: '0.8.24', settings: { optimizer: { enabled: true, runs: 200 } } },
  // Contract verification on Snowtrace (served by Routescan). The key can be any non-empty string.
  etherscan: {
    apiKey: { avalanche: 'snowtrace', fuji: 'snowtrace' },
    customChains: [
      { network: 'avalanche', chainId: 43114, urls: { apiURL: 'https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan', browserURL: 'https://snowtrace.io' } },
      { network: 'fuji', chainId: 43113, urls: { apiURL: 'https://api.routescan.io/v2/network/testnet/evm/43113/etherscan', browserURL: 'https://testnet.snowtrace.io' } },
    ],
  },
  sourcify: { enabled: false },
  networks: {
    fuji: { url: 'https://api.avax-test.network/ext/bc/C/rpc', chainId: 43113, accounts },
    avalanche: { url: 'https://api.avax.network/ext/bc/C/rpc', chainId: 43114, accounts },
  },
};
