/**
 * CCTP contract utilities - pulls data from Bridge Kit SDK (single source of truth).
 * Used for direct contract interactions bypassing Bridge Kit's bridge flow.
 */

import { createPublicClient, http, encodePacked, keccak256 } from "viem";
import { getBridgeKit, getSupportedEvmChains, getAllSupportedChains, type BridgeEnvironment } from "./bridgeKit";
import type { ChainId, SolanaChainId } from "./types";

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
 * Get CCTP domain ID for any chain (EVM or Solana) from Bridge Kit.
 */
export function getCctpDomainIdUniversal(
  chainId: ChainId,
  env?: BridgeEnvironment
): number | null {
  const chains = getAllSupportedChains(env);
  const chain = chains.find((c) => {
    if (c.type === "evm") return (c as { chainId: number }).chainId === chainId;
    if (c.type === "solana") return (c as { chain: SolanaChainId }).chain === chainId;
    return false;
  });
  const cctp = chain?.cctp as { domain?: number } | undefined;
  return cctp?.domain ?? null;
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
 * Get chain ID from CCTP domain (universal - supports both EVM and Solana).
 * Returns numeric chainId for EVM chains, string chainId for Solana chains.
 */
export function getChainIdFromDomainUniversal(
  domain: number,
  env?: BridgeEnvironment
): ChainId | null {
  const chains = getAllSupportedChains(env);

  // Find chain by CCTP domain - need to cast through unknown due to union type variance
  const chain = chains.find((c) => {
    const cctp = c.cctp as { domain?: number } | undefined;
    return cctp?.domain === domain;
  });

  if (!chain) return null;

  // EVM chains have numeric chainId
  if (chain.type === "evm") {
    return (chain as { chainId: number }).chainId;
  }

  // Solana chains use string identifier (chain property)
  if (chain.type === "solana") {
    return (chain as { chain: SolanaChainId }).chain;
  }

  return null;
}

/**
 * Get chain info from domain across ALL chains (including non-EVM and both environments).
 * Useful for providing better error messages when a domain is valid but not supported.
 */
export function getChainInfoFromDomainAllChains(
  domain: number
): { name: string; type: string; isTestnet: boolean; chainId?: number } | null {
  const kit = getBridgeKit();
  const allChains = kit.getSupportedChains();

  const chain = allChains.find((c) => c.cctp?.domain === domain);
  if (!chain) return null;

  return {
    name: chain.name,
    type: chain.type,
    isTestnet: chain.isTestnet,
    chainId: chain.type === "evm" ? (chain as { chainId?: number }).chainId : undefined,
  };
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

/**
 * Check if a chain is a testnet (works for both EVM and Solana chains).
 */
export function isTestnetChainUniversal(
  chainId: ChainId,
  env?: BridgeEnvironment
): boolean {
  const chains = getAllSupportedChains(env);
  const chain = chains.find((c) => {
    if (c.type === "evm") return (c as { chainId: number }).chainId === chainId;
    if (c.type === "solana") return (c as { chain: SolanaChainId }).chain === chainId;
    return false;
  });
  return chain?.isTestnet ?? false;
}

/**
 * Compute the sourceAndNonce hash used by CCTP's usedNonces mapping.
 * This matches the CCTP contract's _hashSourceAndNonce implementation.
 */
export function hashSourceAndNonce(sourceDomain: number, nonce: string): `0x${string}` {
  // CCTP uses keccak256(abi.encodePacked(uint32 sourceDomain, uint64 nonce))
  return keccak256(
    encodePacked(
      ["uint32", "uint64"],
      [sourceDomain, BigInt(nonce)]
    )
  );
}

/**
 * Check if a CCTP message nonce has been used (transaction already claimed).
 * Queries the usedNonces mapping on the destination chain's MessageTransmitter.
 *
 * @param destinationChainId - The destination chain ID
 * @param sourceDomain - The source CCTP domain
 * @param nonce - The message nonce
 * @param env - Bridge environment (mainnet/testnet)
 * @returns true if nonce is used (already claimed), false if not, null on error
 */
export async function isNonceUsed(
  destinationChainId: number,
  sourceDomain: number,
  nonce: string,
  env?: BridgeEnvironment
): Promise<boolean | null> {
  const messageTransmitter = getMessageTransmitterAddress(destinationChainId, env);
  if (!messageTransmitter) {
    console.error(`No MessageTransmitter found for chain ${destinationChainId}`);
    return null;
  }

  const chains = getSupportedEvmChains(env);
  const chain = chains.find((c) => c.chainId === destinationChainId);
  if (!chain) {
    console.error(`Chain ${destinationChainId} not found`);
    return null;
  }

  // Get RPC URL for destination chain
  const rpcUrl = chain.rpcEndpoints?.[0];

  try {
    const client = createPublicClient({
      chain: {
        id: chain.chainId,
        name: chain.name,
        nativeCurrency: chain.nativeCurrency,
        rpcUrls: {
          default: { http: rpcUrl ? [rpcUrl] : [] },
          public: { http: rpcUrl ? [rpcUrl] : [] },
        },
      },
      transport: rpcUrl ? http(rpcUrl) : http(),
    });

    const sourceAndNonce = hashSourceAndNonce(sourceDomain, nonce);

    const result = await client.readContract({
      address: messageTransmitter,
      abi: MESSAGE_TRANSMITTER_ABI,
      functionName: "usedNonces",
      args: [sourceAndNonce],
    });

    // usedNonces returns 1 if used, 0 if not
    return result === BigInt(1);
  } catch (error) {
    console.error("Failed to check nonce status:", error);
    return null;
  }
}
