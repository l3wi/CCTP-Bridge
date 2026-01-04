/**
 * CCTP contract utilities - pulls data from Bridge Kit SDK (single source of truth).
 * Used for direct contract interactions bypassing Bridge Kit's bridge flow.
 */

import { getBridgeKit, getSupportedEvmChains, type BridgeEnvironment } from "./bridgeKit";

// ABI for MessageTransmitter - only functions we need for direct mint
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
 * Get MessageTransmitter address for a chain from Bridge Kit.
 * Prefers v2 contracts, falls back to v1.
 */
export function getMessageTransmitterAddress(
  chainId: number,
  env?: BridgeEnvironment
): `0x${string}` | null {
  const chains = getSupportedEvmChains(env);
  const chain = chains.find((c) => c.chainId === chainId);

  if (!chain?.cctp?.contracts) return null;

  const contracts = chain.cctp.contracts;

  // Try v2 first (CCTPv2 uses split config with messageTransmitter)
  const v2 = contracts.v2 as { messageTransmitter?: string } | undefined;
  if (v2?.messageTransmitter) {
    return v2.messageTransmitter as `0x${string}`;
  }

  // Fall back to v1
  const v1 = contracts.v1 as { messageTransmitter?: string } | undefined;
  if (v1?.messageTransmitter) {
    return v1.messageTransmitter as `0x${string}`;
  }

  return null;
}

/**
 * Get CCTP domain ID for a chain from Bridge Kit.
 */
export function getCctpDomainId(
  chainId: number,
  env?: BridgeEnvironment
): number | null {
  const chains = getSupportedEvmChains(env);
  const chain = chains.find((c) => c.chainId === chainId);
  return chain?.cctp?.domain ?? null;
}

/**
 * Get chain ID from CCTP domain.
 * Searches all supported chains for matching domain.
 */
export function getChainIdFromDomain(
  domain: number,
  env?: BridgeEnvironment
): number | null {
  const chains = getSupportedEvmChains(env);
  const chain = chains.find((c) => c.cctp?.domain === domain);
  return chain?.chainId ?? null;
}

/**
 * Check if a chain is a testnet based on Bridge Kit data.
 */
export function isTestnetChain(
  chainId: number,
  env?: BridgeEnvironment
): boolean {
  const chains = getSupportedEvmChains(env);
  const chain = chains.find((c) => c.chainId === chainId);
  return chain?.isTestnet ?? false;
}
