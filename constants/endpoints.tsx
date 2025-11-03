export const endpoints = {
  mainnet: "https://iris-api.circle.com",
  testnet: "https://iris-api-sandbox.circle.com",
};

// Block confirmation requirements for V2
export const blockConfirmations = {
  fast: {
    1: { blocks: 2, time: "~20 seconds", seconds: 20 }, // Ethereum
    42161: { blocks: 1, time: "~8 seconds", seconds: 8 }, // Arbitrum
    8453: { blocks: 1, time: "~8 seconds", seconds: 8 }, // Base
    10: { blocks: 1, time: "~8 seconds", seconds: 8 }, // OP Mainnet
    59144: { blocks: 1, time: "~8 seconds", seconds: 8 }, // Linea
    59140: { blocks: 1, time: "~8 seconds", seconds: 8 }, // Codex
    130: { blocks: 1, time: "~8 seconds", seconds: 8 }, // Unichain
    480: { blocks: 1, time: "~8 seconds", seconds: 8 }, // World Chain
  },
  standard: {
    1: { blocks: 65, time: "~13-19 minutes", seconds: 19 * 60 }, // Ethereum
    42161: { blocks: 65, time: "~13-19 minutes", seconds: 19 * 60 }, // Arbitrum -> Ethereum
    8453: { blocks: 65, time: "~13-19 minutes", seconds: 19 * 60 }, // Base -> Ethereum
    43114: { blocks: 1, time: "~8 seconds", seconds: 8 }, // Avalanche
    59144: { blocks: 1, time: "~6-32 hours", seconds: 32 * 60 * 60 }, // Linea hard finality
    59140: { blocks: 65, time: "~13-19 minutes", seconds: 19 * 60 }, // Codex -> Ethereum
    10: { blocks: 65, time: "~13-19 minutes", seconds: 19 * 60 }, // OP Mainnet -> Ethereum
    130: { blocks: 65, time: "~13-19 minutes", seconds: 19 * 60 }, // Unichain -> Ethereum
    137: { blocks: 3, time: "~8 seconds", seconds: 8 }, // Polygon PoS (~2-3 blocks)
    146: { blocks: 1, time: "~8 seconds", seconds: 8 }, // Sonic
    480: { blocks: 65, time: "~13-19 minutes", seconds: 19 * 60 }, // World Chain -> Ethereum
    18: { blocks: 3, time: "~10 seconds", seconds: 10 }, // XDC
    16: { blocks: 1, time: "~5 seconds", seconds: 5 }, // Sei
    19: { blocks: 1, time: "~5 seconds", seconds: 5 }, // HyperEVM
    14: { blocks: 65, time: "~13-19 minutes", seconds: 19 * 60 }, // World Chain alias (domain 14)
    21: { blocks: 65, time: "~30 minutes", seconds: 30 * 60 }, // Ink
    22: { blocks: 65, time: "~13-19 minutes", seconds: 19 * 60 }, // Plume
  },
};

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
