import { Chain } from "viem";
import { UseChainsReturnType } from "wagmi";
import { ContractsMap, ChainSupportMap, DomainMap } from "@/lib/types";

export const supportedChains: ChainSupportMap = {
  mainnet: [1, 43114, 42161, 10, 8453, 137, 130, 59144, 146, 480],
  testnet: [5, 43113, 421613, 11155111, 421614, 84532],
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

// CCTP V2 supported chains (mainnet only)
export const supportsV2: number[] = [1, 43114, 42161, 8453, 59144, 146, 480];

// CCTP V2 supported chains (testnet)
export const supportsV2Testnet: number[] = [11155111, 43113, 421614, 84532];

// Map of chainId to domain
export const domains: DomainMap = {
  1: 0, // Ethereum
  43114: 1, // Avalanche
  10: 2, // OP Mainnet
  42161: 3, // Arbitrum
  8453: 6, // Base
  137: 7, // Polygon PoS
  130: 10, // Unichain
  59144: 11, // Linea
  146: 13, // Sonic
  480: 14, // World Chain
};

// Testnet domains
export const testnetDomains: DomainMap = {
  11155111: 0, // Ethereum Sepolia
  43113: 1, // Avalanche Fuji
  421614: 3, // Arbitrum Sepolia
  84532: 6, // Base Sepolia
};

export const isTestnet = (chain: Chain) => {
  return [
    "arbitrum-goerli",
    "goerli",
    "avalanche-fuji",
    "sepolia",
    "arbitrum-sepolia",
    "base-sepolia",
  ].includes(chain.name.toLowerCase());
};

// V2 Contract addresses (mainnet only - chains that actually support V2)
const contractsV2: ContractsMap = {
  1: {
    // Ethereum V2
    TokenMessenger: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
    MessageTransmitter: "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64",
    TokenMinter: "0xfd78EE919681417d192449715b2594ab58f5D002",
    Message: "0xec546b6B005471ECf012e5aF77FBeC07e0FD8f78",
    Usdc: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  },
  43114: {
    // Avalanche V2
    TokenMessenger: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
    MessageTransmitter: "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64",
    TokenMinter: "0xfd78EE919681417d192449715b2594ab58f5D002",
    Message: "0xec546b6B005471ECf012e5aF77FBeC07e0FD8f78",
    Usdc: "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e",
  },
  42161: {
    // Arbitrum V2
    TokenMessenger: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
    MessageTransmitter: "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64",
    TokenMinter: "0xfd78EE919681417d192449715b2594ab58f5D002",
    Message: "0xec546b6B005471ECf012e5aF77FBeC07e0FD8f78",
    Usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  },
  8453: {
    // Base V2
    TokenMessenger: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
    MessageTransmitter: "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64",
    TokenMinter: "0xfd78EE919681417d192449715b2594ab58f5D002",
    Message: "0xec546b6B005471ECf012e5aF77FBeC07e0FD8f78",
    Usdc: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  },
  59144: {
    // Linea V2
    TokenMessenger: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
    MessageTransmitter: "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64",
    TokenMinter: "0xfd78EE919681417d192449715b2594ab58f5D002",
    Message: "0xec546b6B005471ECf012e5aF77FBeC07e0FD8f78",
    Usdc: "0x176211869cA2b568f2A7D4EE941E073a821EE1ff",
  },
  146: {
    // Sonic V2
    TokenMessenger: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
    MessageTransmitter: "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64",
    TokenMinter: "0xfd78EE919681417d192449715b2594ab58f5D002",
    Message: "0xec546b6B005471ECf012e5aF77FBeC07e0FD8f78",
    Usdc: "0x29219dd400f2Bf60E5a23d13Be72B486D4038894",
  },
  480: {
    // World Chain V2
    TokenMessenger: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
    MessageTransmitter: "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64",
    TokenMinter: "0xfd78EE919681417d192449715b2594ab58f5D002",
    Message: "0xec546b6B005471ECf012e5aF77FBeC07e0FD8f78",
    Usdc: "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1",
  },
  // V2 Testnets
  11155111: {
    // Ethereum Sepolia V2
    TokenMessenger: "0x68BaF4e8e786A8ca86E9a6c76B0AB81B90157C6e",
    MessageTransmitter: "0x32e20d2C16564b15bDBa36b52CEAd0411d0e5cBc",
    TokenMinter: "0x60C7D10B3cA08cF73fe6C1e137B9eAcA56E9AC26",
    Message: "0xd40C4F732fe86fa2c6f2F0fb1Bf1c5B9eA82E0Ba",
    Usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  },
  43113: {
    // Avalanche Fuji V2
    TokenMessenger: "0x68BaF4e8e786A8ca86E9a6c76B0AB81B90157C6e",
    MessageTransmitter: "0x32e20d2C16564b15bDBa36b52CEAd0411d0e5cBc",
    TokenMinter: "0x60C7D10B3cA08cF73fe6C1e137B9eAcA56E9AC26",
    Message: "0xd40C4F732fe86fa2c6f2F0fb1Bf1c5B9eA82E0Ba",
    Usdc: "0x5425890298aed601595a70ab815c96711a31bc65",
  },
  421614: {
    // Arbitrum Sepolia V2
    TokenMessenger: "0x68BaF4e8e786A8ca86E9a6c76B0AB81B90157C6e",
    MessageTransmitter: "0x32e20d2C16564b15bDBa36b52CEAd0411d0e5cBc",
    TokenMinter: "0x60C7D10B3cA08cF73fe6C1e137B9eAcA56E9AC26",
    Message: "0xd40C4F732fe86fa2c6f2F0fb1Bf1c5B9eA82E0Ba",
    Usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
  },
  84532: {
    // Base Sepolia V2
    TokenMessenger: "0x68BaF4e8e786A8ca86E9a6c76B0AB81B90157C6e",
    MessageTransmitter: "0x32e20d2C16564b15bDBa36b52CEAd0411d0e5cBc",
    TokenMinter: "0x60C7D10B3cA08cF73fe6C1e137B9eAcA56E9AC26",
    Message: "0xd40C4F732fe86fa2c6f2F0fb1Bf1c5B9eA82E0Ba",
    Usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  },
};

// V1 Contract addresses (all supported chains)
const contracts: ContractsMap = {
  1: {
    // Ethereum
    TokenMessenger: "0xBd3fa81B58Ba92a82136038B25aDec7066af3155",
    MessageTransmitter: "0x0a992d191DEeC32aFe36203Ad87D7d289a738F81",
    TokenMinter: "0xc4922d64a24675E16e1586e3e3Aa56C06fABe907",
    Message: "0xB2f38107A18f8599331677C14374Fd3A952fb2c8",
    Usdc: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  },
  43114: {
    // Avalanche
    TokenMessenger: "0x6B25532e1060CE10cc3B0A99e5683b91BFDe6982",
    MessageTransmitter: "0x8186359aF5F57FbB40c6b14A588d2A59C0C29880",
    TokenMinter: "0x420F5035fd5dC62a167E7e7f08B604335aE272b8",
    Message: "0x21F337db7A718F23e061262470Af8c1Fd01232D1",
    Usdc: "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e",
  },
  10: {
    // OP Mainnet
    TokenMessenger: "0x2B4069517957735bE00ceE0fadAE88a26365528f",
    MessageTransmitter: "0x4D41f22c5a0e5c74090899E5a8Fb597a8842b3e8",
    TokenMinter: "0x33E76C5C31cb928dc6FE6487AB3b2C0769B1A1e3",
    Message: "0xDB2831EaF163be1B564d437A97372deB0046C70D",
    Usdc: "0x0b2c639c533813f4aa9d7837caf62653d097ff85",
  },
  42161: {
    // Arbitrum
    TokenMessenger: "0x19330d10D9Cc8751218eaf51E8885D058642E08A",
    MessageTransmitter: "0xC30362313FBBA5cf9163F0bb16a0e01f01A896ca",
    TokenMinter: "0xE7Ed1fa7f45D05C508232aa32649D89b73b8bA48",
    Message: "0xE189BDCFbceCEC917b937247666a44ED959D81e4",
    Usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  },
  8453: {
    // Base
    TokenMessenger: "0x1682Ae6375C4E4A97e4B583BC394c861A46D8962",
    MessageTransmitter: "0xAD09780d193884d503182aD4588450C416D6F9D4",
    TokenMinter: "0xe45B133ddc64bE80252b0e9c75A8E74EF280eEd6",
    Message: "0x827ae40E55C4355049ab91e441b6e269e4091441",
    Usdc: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  },
  137: {
    // Polygon PoS
    TokenMessenger: "0x9daF8c91AEFAE50b9c0E69629D3F6Ca40cA3B3FE",
    MessageTransmitter: "0xF3be9355363857F3e001be68856A2f96b4C39Ba9",
    TokenMinter: "0x10f7835F827D6Cf035115E10c50A853d7FB2D2EC",
    Message: "0x02d9fa3e7f870E5FAA7Ca6c112031E0ddC5E646C",
    Usdc: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
  },
  130: {
    // Unichain
    TokenMessenger: "0x4e744b28E787c3aD0e810eD65A24461D4ac5a762",
    MessageTransmitter: "0x353bE9E2E38AB1D19104534e4edC21c643Df86f4",
    TokenMinter: "0x726bFEF3cBb3f8AF7d8CB141E78F86Ae43C34163",
    Message: "0x395b1be6E432033B676e3e36B2c2121a1f952622",
    Usdc: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
  },
  // V1 Testnets
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
export { contractsV2 };

// Helper function to get contracts based on version
export const getContracts = (chainId: number, version: "v1" | "v2" = "v1") => {
  return version === "v2" ? contractsV2[chainId] : contracts[chainId];
};

// Helper function to check if chain supports V2
export const isV2Supported = (chainId: number) => {
  return supportsV2.includes(chainId) || supportsV2Testnet.includes(chainId);
};

// Helper function to get all supported chain IDs (V1 + V2)
export const getAllSupportedChainIds = (): number[] => {
  const v1ChainIds = Object.keys(contracts).map(Number);
  const v2ChainIds = Object.keys(contractsV2).map(Number);
  return Array.from(new Set([...v1ChainIds, ...v2ChainIds]));
};

// Helper function to check if a chain is supported (V1 or V2)
export const isChainSupported = (chainId: number): boolean => {
  return chainId in contracts || chainId in contractsV2;
};

// Get domain for a chain
export const getDomain = (chainId: number): number | undefined => {
  if (domains[chainId] !== undefined) {
    return domains[chainId];
  }
  if (testnetDomains[chainId] !== undefined) {
    return testnetDomains[chainId];
  }
  return undefined;
};
