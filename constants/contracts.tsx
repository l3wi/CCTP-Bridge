import { Chain } from "viem";
import { UseChainsReturnType } from "wagmi";
import { ContractsMap, ChainSupportMap, DomainMap } from "@/lib/types";

export const supportedChains: ChainSupportMap = {
  mainnet: [1, 43114, 42161, 10, 8453, 137],
  testnet: [5, 43113, 421613],
};

export const getChainsFromId = (
  chainId: number,
  chains: UseChainsReturnType
) => {
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

export const supportsV2: number[] = [1, 43114, 8453];

// Map of chainId to domain
export const domains: DomainMap = {
  1: 0, // Ethereum
  43114: 1, // Avalanche
  10: 2, // Optimism
  42161: 3, // Arbitrum
  8453: 6, // Base
  137: 7, // Matic
};

export const isTestnet = (chain: Chain) => {
  return ["arbitrum-goerli", "goerli", "avalanche-fuji"].includes(chain.name);
};

const contracts: ContractsMap = {
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
  10: {
    // Optimism
    TokenMessenger: "0x2B4069517957735bE00ceE0fadAE88a26365528f",
    MessageTransmitter: "0x4d41f22c5a0e5c74090899e5a8fb597a8842b3e8",
    TokenMinter: "0x33E76C5C31cb928dc6FE6487AB3b2C0769B1A1e3",
    Usdc: "0x0b2c639c533813f4aa9d7837caf62653d097ff85",
  },
  42161: {
    // Arbitrum
    TokenMessenger: "0x19330d10D9Cc8751218eaf51E8885D058642E08A",
    MessageTransmitter: "0xC30362313FBBA5cf9163F0bb16a0e01f01A896ca",
    TokenMinter: "0xE7Ed1fa7f45D05C508232aa32649D89b73b8bA48",
    Usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  },
  8453: {
    // Base
    TokenMessenger: "0x1682Ae6375C4E4A97e4B583BC394c861A46D8962",
    MessageTransmitter: "0xAD09780d193884d503182aD4588450C416D6F9D4",
    TokenMinter: "0xe45B133ddc64bE80252b0e9c75A8E74EF280eEd6",
    Usdc: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  },
  137: {
    // Matic
    TokenMessenger: "0x9daF8c91AEFAE50b9c0E69629D3F6Ca40cA3B3FE",
    MessageTransmitter: "0xF3be9355363857F3e001be68856A2f96b4C39Ba9",
    TokenMinter: "0x10f7835F827D6Cf035115E10c50A853d7FB2D2EC",
    Usdc: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
  },
  //// Testnets
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
