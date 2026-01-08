/**
 * Shared CCTP utilities.
 * Single source of truth for constants and common functions.
 */

import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  getAllSupportedChains,
  type BridgeEnvironment,
  BRIDGEKIT_ENV,
} from "../bridgeKit";
import type {
  ChainId,
  ChainType,
  SolanaChainId,
  UniversalTxHash,
  EvmTxHash,
} from "./types";
import {
  isSolanaChain,
  getChainType,
  isValidEvmTxHash,
  isValidSolanaTxHash,
} from "./types";

// =============================================================================
// USDC Mint Addresses (Solana)
// =============================================================================

/**
 * Solana USDC mint addresses - single source of truth.
 * Used for ATA derivation and token transfers.
 */
export const SOLANA_USDC_MINT: Record<SolanaChainId, string> = {
  Solana: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  Solana_Devnet: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
} as const;

// =============================================================================
// CCTP Address Lookup Tables (Solana)
// =============================================================================

/**
 * CCTP Address Lookup Tables for Solana receiveMessage transactions.
 * ALTs reduce transaction size by replacing 32-byte addresses with 1-byte indices.
 *
 * Each ALT contains the static CCTP program accounts:
 * - MESSAGE_TRANSMITTER_PROGRAM_ID
 * - TOKEN_MESSENGER_PROGRAM_ID
 * - TOKEN_PROGRAM_ID
 * - SystemProgram
 * - tokenMessengerPda
 * - messageTransmitterPda
 * - tokenMinterPda
 * - localTokenPda
 * - custodyPda
 * - messageTransmitterAuthorityPda
 * - eventAuthorityPda
 *
 * Deploy with: bun run scripts/deploy-cctp-alt.ts <mainnet|devnet>
 */
export const CCTP_ALT_ADDRESSES: Record<SolanaChainId, string | null> = {
  Solana: "HKxj9RU7yzzTpiufNEoPUGfvzMQYKw2V9kNTp2PPK5b7",
  // TODO: Deploy ALT and update this address
  // Run: bun run scripts/deploy-cctp-alt.ts devnet
  Solana_Devnet: null,
};

/**
 * Get CCTP ALT PublicKey for a Solana chain.
 * Returns null if not configured (will fall back to legacy transaction).
 */
export function getCctpAltAddress(chainId: SolanaChainId): PublicKey | null {
  const address = CCTP_ALT_ADDRESSES[chainId];
  return address ? new PublicKey(address) : null;
}

/**
 * Get Solana USDC mint as PublicKey
 */
export function getSolanaUsdcMint(chainId: SolanaChainId): PublicKey {
  return new PublicKey(SOLANA_USDC_MINT[chainId]);
}

// =============================================================================
// CCTP Domain Resolution
// =============================================================================

/**
 * Get CCTP domain ID for any chain (EVM or Solana).
 * Uses Bridge Kit as source of truth for dynamic resolution.
 *
 * @throws Error if chain is not supported or has no CCTP domain
 */
export function getCctpDomain(
  chainId: ChainId,
  env: BridgeEnvironment = BRIDGEKIT_ENV
): number {
  const chains = getAllSupportedChains(env);

  const chain = chains.find((c) => {
    if (c.type === "evm") return (c as { chainId: number }).chainId === chainId;
    if (c.type === "solana") return (c as { chain: SolanaChainId }).chain === chainId;
    return false;
  });

  // Access CCTP domain from chain definition
  const cctp = chain?.cctp as { domain?: number } | undefined;
  if (cctp?.domain === undefined) {
    throw new Error(`No CCTP domain found for chain ${chainId}`);
  }

  return cctp.domain;
}

/**
 * Get CCTP domain ID, returning null instead of throwing on error.
 * Useful for validation without try/catch.
 */
export function getCctpDomainSafe(
  chainId: ChainId,
  env: BridgeEnvironment = BRIDGEKIT_ENV
): number | null {
  try {
    return getCctpDomain(chainId, env);
  } catch {
    return null;
  }
}

// =============================================================================
// Finality Thresholds
// =============================================================================

/**
 * CCTP v2 finality thresholds by ecosystem.
 * - EVM uses block-based thresholds (1000/2000 represent the protocol constants)
 * - Solana uses slot-based thresholds (3/32 slots)
 */
export const FINALITY_THRESHOLDS = {
  evm: {
    fast: 1000,
    standard: 2000,
  },
  solana: {
    fast: 3,
    standard: 32,
  },
} as const;

/**
 * Get finality threshold for a chain and transfer speed.
 */
export function getFinalityThreshold(
  chainId: ChainId,
  speed: "fast" | "standard"
): number {
  const chainType = getChainType(chainId);
  return FINALITY_THRESHOLDS[chainType][speed];
}

// =============================================================================
// Zero Constants
// =============================================================================

/** Zero bytes32 - used for destinationCaller (allows any caller) */
export const ZERO_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

// =============================================================================
// Mint Recipient Formatting
// =============================================================================

/**
 * Format an address as 32-byte bytes32 for CCTP mintRecipient field.
 * Returns hex string format suitable for EVM contract calls.
 *
 * - EVM addresses (20 bytes): left-pad with zeros to 32 bytes
 * - Solana addresses: compute ATA for USDC, then convert to 32-byte hex
 *
 * IMPORTANT: For Solana destinations, CCTP requires the ATA (token account)
 * as mintRecipient, NOT the wallet pubkey.
 */
export function formatMintRecipientHex(
  address: string,
  destinationChainId: ChainId
): `0x${string}` {
  if (isSolanaChain(destinationChainId)) {
    // Solana destination - derive the Associated Token Account for USDC
    const ownerPubkey = new PublicKey(address);
    const usdcMint = getSolanaUsdcMint(destinationChainId);

    // Compute the ATA (Associated Token Account)
    const ata = getAssociatedTokenAddressSync(usdcMint, ownerPubkey);

    // Convert ATA pubkey to 32-byte hex
    const hex = Buffer.from(ata.toBytes()).toString("hex");
    return `0x${hex}` as `0x${string}`;
  } else {
    // EVM destination - pad 20-byte address to 32 bytes
    const cleanAddress = address.toLowerCase().replace("0x", "");
    if (cleanAddress.length !== 40) {
      throw new Error(`Invalid EVM address: ${address}`);
    }
    // Left-pad with zeros to 32 bytes (64 hex chars)
    const padded = cleanAddress.padStart(64, "0");
    return `0x${padded}` as `0x${string}`;
  }
}

/**
 * Format an address as PublicKey for Solana CCTP instructions.
 * Returns PublicKey suitable for Anchor instruction accounts.
 */
export function formatMintRecipientPubkey(
  address: string,
  destinationChainId: ChainId
): PublicKey {
  if (isSolanaChain(destinationChainId)) {
    // Solana destination - derive the Associated Token Account for USDC
    const ownerPubkey = new PublicKey(address);
    const usdcMint = getSolanaUsdcMint(destinationChainId);
    return getAssociatedTokenAddressSync(usdcMint, ownerPubkey);
  } else {
    // EVM destination - pad 20-byte address to 32 bytes, convert to PublicKey
    const cleanAddress = address.toLowerCase().replace("0x", "");
    if (cleanAddress.length !== 40) {
      throw new Error(`Invalid EVM address: ${address}`);
    }
    const padded = cleanAddress.padStart(64, "0");
    return new PublicKey(Buffer.from(padded, "hex"));
  }
}

// =============================================================================
// Error Detection
// =============================================================================

/**
 * Detect if an error is a user rejection (wallet declined transaction).
 * Works for both EVM (MetaMask, etc.) and Solana (Phantom, etc.) wallets.
 */
export function isUserRejection(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();

  return (
    lowerMessage.includes("user rejected") ||
    lowerMessage.includes("user denied") ||
    lowerMessage.includes("rejected the request") ||
    lowerMessage.includes("user cancelled") ||
    lowerMessage.includes("user canceled") ||
    lowerMessage.includes("transaction was rejected")
  );
}

/**
 * Extract a clean error message from any error type.
 * Truncates long messages and removes stack traces.
 */
export function extractErrorMessage(error: unknown, maxLength = 200): string {
  const message = error instanceof Error ? error.message : String(error);

  // Remove stack traces
  const cleanMessage = message.split("\n")[0];

  // Truncate if too long
  if (cleanMessage.length > maxLength) {
    return cleanMessage.slice(0, maxLength) + "...";
  }

  return cleanMessage;
}

// =============================================================================
// Hash Normalization
// =============================================================================

/**
 * Normalize a transaction hash based on chain type.
 * - EVM: lowercase with 0x prefix
 * - Solana: trimmed (Base58 is case-sensitive)
 */
export function normalizeHash(
  hash: string,
  chainType: ChainType
): UniversalTxHash {
  if (chainType === "solana") {
    return hash.trim();
  }

  // EVM: ensure lowercase with 0x prefix
  const cleaned = hash.toLowerCase().trim();
  return cleaned.startsWith("0x") ? cleaned : `0x${cleaned}`;
}

/**
 * Validate and convert to EVM tx hash.
 * Returns undefined if invalid.
 */
export function asEvmTxHash(value: unknown): EvmTxHash | undefined {
  if (isValidEvmTxHash(value)) return value;
  return undefined;
}

/**
 * Validate and convert to universal tx hash.
 * Returns undefined if invalid.
 */
export function asUniversalTxHash(value: unknown): UniversalTxHash | undefined {
  if (isValidEvmTxHash(value)) return value;
  if (isValidSolanaTxHash(value)) return value;
  return undefined;
}

// =============================================================================
// Iris API Configuration
// =============================================================================

/** Circle Iris API endpoints */
export const IRIS_API_ENDPOINTS = {
  mainnet: "https://iris-api.circle.com",
  testnet: "https://iris-api-sandbox.circle.com",
} as const;

/**
 * Get Iris API base URL for a chain.
 */
export function getIrisApiUrl(chainId: ChainId): string {
  // Determine testnet status
  if (isSolanaChain(chainId)) {
    return chainId === "Solana_Devnet"
      ? IRIS_API_ENDPOINTS.testnet
      : IRIS_API_ENDPOINTS.mainnet;
  }

  // EVM testnet chain IDs
  const testnetChainIds = [
    11155111, // Ethereum Sepolia
    43113, // Avalanche Fuji
    11155420, // Optimism Sepolia
    421614, // Arbitrum Sepolia
    84532, // Base Sepolia
    80002, // Polygon Amoy
    59141, // Linea Sepolia
  ];

  return testnetChainIds.includes(chainId)
    ? IRIS_API_ENDPOINTS.testnet
    : IRIS_API_ENDPOINTS.mainnet;
}

// =============================================================================
// Re-exports for convenience
// =============================================================================

export { isSolanaChain, getChainType } from "./types";
