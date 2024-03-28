export const endpoints = {
  mainnet: "https://iris-api.circle.com",
  testnet: "https://iris-api-sandbox.circle.com",
};

export const rpcs: { [key: number]: string } = {
  1: `https://rpc.ankr.com/eth/c4428913f099976eb6bc210098b1e868034ffd9091733f168b0117ba05ebf405`,
  137: `https://rpc.ankr.com/polygon/c4428913f099976eb6bc210098b1e868034ffd9091733f168b0117ba05ebf405`,
  10: `https://rpc.ankr.com/optimism/c4428913f099976eb6bc210098b1e868034ffd9091733f168b0117ba05ebf405`,
  8453: `https://rpc.ankr.com/base/c4428913f099976eb6bc210098b1e868034ffd9091733f168b0117ba05ebf405`,
  43114: `https://rpc.ankr.com/avalanche/c4428913f099976eb6bc210098b1e868034ffd9091733f168b0117ba05ebf405`,
  42161: `https://rpc.ankr.com/arbitrum/c4428913f099976eb6bc210098b1e868034ffd9091733f168b0117ba05ebf405`,
};

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
