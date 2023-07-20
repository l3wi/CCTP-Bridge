import { Chain } from "wagmi";

export const supportedChains: { [key: string]: Number[] } = {
  mainnet: [1, 43114, 42161],
  testnet: [5, 43113, 421613],
};

export const getChainsFromId = (chainId: number, chains: Chain[]) => {
  if (supportedChains.mainnet.includes(chainId)) {
    return supportedChains.mainnet.map((chain) =>
      chains.find((c: Chain) => c.id === chain)
    );
  } else {
    return supportedChains.testnet.map((chain) =>
      chains.find((c: Chain) => c.id === chain)
    );
  }
};

// Map of domain to chainId
export const domains: { [key: number]: number } = {
  1: 0, // Mainnet
  43114: 1, // Avalanche
  42161: 3, // Arbitrum
  5: 0, // Goerli
  43113: 1, // Avalanche Fuji
  421613: 3, // Arbitrum Goerli
};

export const isTestnet = (chain: Chain) => {
  return ["arbitrum-goerli", "goerli", "avalanche-fuji"].includes(
    chain.network
  );
};

type Contracts = {
  [key: number]: {
    TokenMessenger: `0x${string}`;
    MessageTransmitter: `0x${string}`;
    TokenMinter: `0x${string}`;
    Usdc: `0x${string}`;
  };
};

const contracts: Contracts = {
  1: {
    // Mainnet
    TokenMessenger: "0xbd3fa81b58ba92a82136038b25adec7066af3155",
    MessageTransmitter: "0x0a992d191deec32afe36203ad87d7d289a738f81",
    TokenMinter: "0xc4922d64a24675e16e1586e3e3aa56c06fabe907",
    Usdc: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  },
  43114: {
    // Avalanche
    TokenMessenger: "0x6b25532e1060ce10cc3b0a99e5683b91bfde6982",
    MessageTransmitter: "0x8186359af5f57fbb40c6b14a588d2a59c0c29880",
    TokenMinter: "0x420f5035fd5dc62a167e7e7f08b604335ae272b8",
    Usdc: "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e",
  },
  42161: {
    // Arbitrum
    TokenMessenger: "0x19330d10D9Cc8751218eaf51E8885D058642E08A",
    MessageTransmitter: "0xC30362313FBBA5cf9163F0bb16a0e01f01A896ca",
    TokenMinter: "0xE7Ed1fa7f45D05C508232aa32649D89b73b8bA48",
    Usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  },
  5: {
    // Goerli
    TokenMessenger: "0xd0c3da58f55358142b8d3e06c1c30c5c6114efe8",
    MessageTransmitter: "0x26413e8157cd32011e726065a5462e97dd4d03d9",
    TokenMinter: "0xca6b4c00831ffb77afe22e734a6101b268b7fcbe",
    Usdc: "0x07865c6e87b9f70255377e024ace6630c1eaa37f",
  },
  43113: {
    // Avalanche Fuji
    TokenMessenger: "0xeb08f243e5d3fcff26a9e38ae5520a669f4019d0",
    MessageTransmitter: "0xa9fb1b3009dcb79e2fe346c16a604b8fa8ae0a79",
    TokenMinter: "0x4ed8867f9947a5fe140c9dc1c6f207f3489f501e",
    Usdc: "0x5425890298aed601595a70ab815c96711a31bc65",
  },
  421613: {
    // Arbitrum Goerli
    TokenMessenger: "0x12dcfd3fe2e9eac2859fd1ed86d2ab8c5a2f9352",
    MessageTransmitter: "0x109bc137cb64eab7c0b1dddd1edf341467dc2d35",
    TokenMinter: "0xe997d7d2f6e065a9a93fa2175e878fb9081f1f0a",
    Usdc: "0xfd064a18f3bf249cf1f87fc203e90d8f650f2d63",
  },
};

export default contracts;
