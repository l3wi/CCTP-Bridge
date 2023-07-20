export const endpoints = {
  mainnet: "https://iris-api.circle.com",
  testnet: "https://iris-api-sandbox.circle.com",
};

export const explorers: { [key: number]: string } = {
  1: "https://etherscan.io/", // Mainnet
  43114: "https://snowtrace.io/", // Avalanche
  42161: "https://arbiscan.io/", // Arbitrum
  5: "https://goerli.etherscan.io/", // Goerli
  43113: "https://testnet.snowtrace.io/", // Avalanche Fuji
  421613: "https://goerli.arbiscan.io/", // Arbitrum Goerli
};
