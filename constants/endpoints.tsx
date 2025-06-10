export const endpoints = {
  v1: {
    mainnet: "https://iris-api.circle.com",
    testnet: "https://iris-api-sandbox.circle.com",
  },
  v2: {
    mainnet: "https://iris-api-v2.circle.com",
    testnet: "https://iris-api-v2-sandbox.circle.com",
  },
};

// V2 API endpoints
export const v2Endpoints = {
  publicKeys: '/v2/publicKeys',
  messages: (sourceDomainId: number) => `/v2/messages/${sourceDomainId}`,
  reattest: (nonce: string) => `/v2/reattest/${nonce}`,
  fastBurnAllowance: '/v2/fastBurn/USDC/allowance',
  fastBurnFees: (sourceDomainId: number, destDomainId: number) => `/v2/fastBurn/USDC/fees/${sourceDomainId}/${destDomainId}`,
};

// Block confirmation requirements for V2
export const blockConfirmations = {
  fast: {
    1: { blocks: 2, time: '~20 seconds' }, // Ethereum
    42161: { blocks: 1, time: '~8 seconds' }, // Arbitrum
    43114: { blocks: 1, time: '~8 seconds' }, // Avalanche
    8453: { blocks: 1, time: '~8 seconds' }, // Base
  },
  standard: {
    1: { blocks: 65, time: '13-19 minutes' }, // Ethereum
    42161: { blocks: 65, time: '13-19 minutes' }, // Arbitrum (L2 to Ethereum)
    43114: { blocks: 65, time: '13-19 minutes' }, // Avalanche
    8453: { blocks: 65, time: '13-19 minutes' }, // Base (L2 to Ethereum)
  },
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
  8453: "https://basescan.org/", // Base
  43114: "https://snowtrace.io/", // Avalanche
  42161: "https://arbiscan.io/", // Arbitrum
  5: "https://goerli.etherscan.io/", // Goerli
  43113: "https://testnet.snowtrace.io/", // Avalanche Fuji
  421613: "https://goerli.arbiscan.io/", // Arbitrum Goerli
};

export const rpcs: { [key: number]: string } = {
  1: `https://eth-mainnet.g.alchemy.com/v2/INRThnRGgcJnmv6FDIgPbURqDN4mzv-C`,
  10: `https://opt-mainnet.g.alchemy.com/v2/INRThnRGgcJnmv6FDIgPbURqDN4mzv-C`,
  137: `https://polygon-mainnet.g.alchemy.com/v2/INRThnRGgcJnmv6FDIgPbURqDN4mzv-C`,
  8453: `https://base-mainnet.g.alchemy.com/v2/INRThnRGgcJnmv6FDIgPbURqDN4mzv-C`,
  43114: `https://avax-mainnet.g.alchemy.com/v2/INRThnRGgcJnmv6FDIgPbURqDN4mzv-C`,
  42161: `https://arb-mainnet.g.alchemy.com/v2/INRThnRGgcJnmv6FDIgPbURqDN4mzv-C`,
};
