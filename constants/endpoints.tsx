export const endpoints = {
  mainnet: "https://iris-api.circle.com",
  testnet: "https://iris-api-sandbox.circle.com",
};

// export const rpcs: { [key: number]: string } = {
//   1: `https://rpc.ankr.com/eth/c4428913f099976eb6bc210098b1e868034ffd9091733f168b0117ba05ebf405`,
//   137: `https://rpc.ankr.com/polygon/c4428913f099976eb6bc210098b1e868034ffd9091733f168b0117ba05ebf405`,
//   10: `https://rpc.ankr.com/optimism/c4428913f099976eb6bc210098b1e868034ffd9091733f168b0117ba05ebf405`,
//   8453: `https://rpc.ankr.com/base/c4428913f099976eb6bc210098b1e868034ffd9091733f168b0117ba05ebf405`,
//   43114: `https://rpc.ankr.com/avalanche/c4428913f099976eb6bc210098b1e868034ffd9091733f168b0117ba05ebf405`,
//   42161: `https://rpc.ankr.com/arbitrum/c4428913f099976eb6bc210098b1e868034ffd9091733f168b0117ba05ebf405`,
// };

export const explorers: { [key: number]: string } = {
  1: "https://etherscan.io/", // Mainnet
  137: "https://polygonscan.com/", // Polygon
  10: "https://optimistic.etherscan.io/", // Optimism
  8453: "https:/basescan.org/", // Base
  43114: "https://snowtrace.io/", // Avalanche
  42161: "https://arbiscan.io/", // Arbitrum
  5: "https://goerli.etherscan.io/", // Goerli
  43113: "https://testnet.snowtrace.io/", // Avalanche Fuji
  421613: "https://goerli.arbiscan.io/", // Arbitrum Goerli
};

export const rpcs: { [key: number]: string } = {
  1: `https://eth-mainnet.rpc.grove.city/v1/8b88b6f9`,
  10: `https://optimism-mainnet.rpc.grove.city/v1/8b88b6f9`,
  137: `https://poly-mainnet.rpc.grove.city/v1/8b88b6f9`,
  8453: `https://base-mainnet.rpc.grove.city/v1/8b88b6f9`,
  43114: `https://avax-mainnet.rpc.grove.city/v1/8b88b6f9`,
  42161: `https://arbitrum-one.rpc.grove.city/v1/8b88b6f9`,
};
