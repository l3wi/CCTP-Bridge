/**
 * CCTP contract addresses and ABI definitions for direct contract interactions.
 * Used for manual mint execution bypassing Bridge Kit SDK.
 */

// MessageTransmitter contract addresses by chainId
export const MESSAGE_TRANSMITTER_ADDRESSES: Record<number, `0x${string}`> = {
  // Mainnet
  1: "0x0a992d191deec32afe36203ad87d7d289a738f81", // Ethereum
  43114: "0x8186359af5f57fbb40c6b14a588d2a59c0c29880", // Avalanche
  10: "0x4d41f22c5a0e5c74090899e5a8fb597a8842b3e8", // Optimism
  42161: "0xC30362313FBBA5cf9163F0bb16a0e01f01A896ca", // Arbitrum
  8453: "0xAD09780d193884d503182aD4588450C416D6F9D4", // Base
  137: "0xF3be9355363857F3e001be68856A2f96b4C39Ba9", // Polygon

  // Testnet
  11155111: "0x7865fAfC2db2093669d92c0F33AeEF291086BEFD", // Ethereum Sepolia
  43113: "0xa9fb1b3009dcb79e2fe346c16a604b8fa8ae0a79", // Avalanche Fuji
  11155420: "0x7865fAfC2db2093669d92c0F33AeEF291086BEFD", // Optimism Sepolia
  421614: "0xaCF1ceeF35caAc005e15888dDb8A3515C41B4872", // Arbitrum Sepolia
  84532: "0x7865fAfC2db2093669d92c0F33AeEF291086BEFD", // Base Sepolia
  80002: "0x7865fAfC2db2093669d92c0F33AeEF291086BEFD", // Polygon Amoy
};

// CCTP Domain IDs - used for Iris API queries
export const CCTP_DOMAIN_IDS: Record<number, number> = {
  // Mainnet
  1: 0, // Ethereum
  43114: 1, // Avalanche
  10: 2, // Optimism
  42161: 3, // Arbitrum
  8453: 6, // Base
  137: 7, // Polygon

  // Testnet
  11155111: 0, // Ethereum Sepolia
  43113: 1, // Avalanche Fuji
  11155420: 2, // Optimism Sepolia
  421614: 3, // Arbitrum Sepolia
  84532: 6, // Base Sepolia
  80002: 7, // Polygon Amoy
};

// Reverse mapping: domain -> chainId (mainnet only for now)
export const DOMAIN_TO_CHAIN_ID: Record<number, number> = {
  0: 1, // Ethereum
  1: 43114, // Avalanche
  2: 10, // Optimism
  3: 42161, // Arbitrum
  6: 8453, // Base
  7: 137, // Polygon
};

// MessageTransmitter ABI - only the functions we need
export const MESSAGE_TRANSMITTER_ABI = [
  {
    inputs: [
      { internalType: "bytes", name: "message", type: "bytes" },
      { internalType: "bytes", name: "attestation", type: "bytes" },
    ],
    name: "receiveMessage",
    outputs: [{ internalType: "bool", name: "success", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "bytes32", name: "sourceAndNonce", type: "bytes32" }],
    name: "usedNonces",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

/**
 * Get MessageTransmitter address for a given chain
 */
export function getMessageTransmitterAddress(
  chainId: number
): `0x${string}` | null {
  return MESSAGE_TRANSMITTER_ADDRESSES[chainId] ?? null;
}

/**
 * Get CCTP domain ID for a given chain
 */
export function getCctpDomainId(chainId: number): number | null {
  return CCTP_DOMAIN_IDS[chainId] ?? null;
}

/**
 * Get chain ID from CCTP domain (mainnet)
 */
export function getChainIdFromDomain(domain: number): number | null {
  return DOMAIN_TO_CHAIN_ID[domain] ?? null;
}

/**
 * Check if a chain is a testnet based on chainId
 */
export function isTestnetChain(chainId: number): boolean {
  const testnetChainIds = [11155111, 43113, 11155420, 421614, 84532, 80002];
  return testnetChainIds.includes(chainId);
}
