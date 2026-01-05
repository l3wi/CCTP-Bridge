/**
 * Unified CCTP nonce checking.
 * Consolidates EVM and Solana nonce verification into a single interface.
 */

import { createPublicClient, keccak256, encodePacked } from "viem";
import { Connection, PublicKey } from "@solana/web3.js";
import { getSupportedEvmChains, getSolanaRpcEndpoint, BRIDGEKIT_ENV } from "../bridgeKit";
import type { ChainId, SolanaChainId, NonceCheckResult } from "./types";
import { isSolanaChain } from "./types";

// =============================================================================
// Constants
// =============================================================================

/** Message Transmitter Program ID (Solana) */
const MESSAGE_TRANSMITTER_PROGRAM_ID = new PublicKey(
  "CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC"
);

/** MessageTransmitter ABI for EVM nonce checking */
const USED_NONCES_ABI = [
  {
    inputs: [{ name: "sourceAndNonce", type: "bytes32" }],
    name: "usedNonces",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// CCTP message format constants
const CCTP_NONCE_OFFSET = 12; // Nonce starts at byte 12
const CCTP_NONCE_LENGTH = 32; // Nonce is 32 bytes
const CCTP_SOURCE_DOMAIN_OFFSET = 4; // Source domain at byte 4
const CCTP_SOURCE_DOMAIN_LENGTH = 4; // Domain is 4 bytes
const CCTP_MESSAGE_MIN_LENGTH = 148; // Minimum header size

// =============================================================================
// Message Parsing
// =============================================================================

/**
 * Validate CCTP message format.
 */
function validateMessageFormat(message: `0x${string}`): boolean {
  if (!message?.startsWith("0x")) return false;
  const byteLength = (message.length - 2) / 2;
  return byteLength >= CCTP_MESSAGE_MIN_LENGTH;
}

/**
 * Extract nonce (32 bytes) from CCTP message.
 * Located at bytes 12-44 in the message.
 */
export function extractNonceFromMessage(message: `0x${string}`): `0x${string}` {
  if (!validateMessageFormat(message)) {
    throw new Error(`Invalid CCTP message format: expected at least ${CCTP_MESSAGE_MIN_LENGTH} bytes`);
  }

  const startChar = 2 + CCTP_NONCE_OFFSET * 2;
  const endChar = startChar + CCTP_NONCE_LENGTH * 2;
  const nonceHex = message.slice(startChar, endChar);

  return `0x${nonceHex}` as `0x${string}`;
}

/**
 * Extract source domain (4 bytes) from CCTP message.
 * Located at bytes 4-8 in the message.
 */
export function extractSourceDomainFromMessage(message: `0x${string}`): number {
  if (!validateMessageFormat(message)) {
    throw new Error(`Invalid CCTP message format: expected at least ${CCTP_MESSAGE_MIN_LENGTH} bytes`);
  }

  const startChar = 2 + CCTP_SOURCE_DOMAIN_OFFSET * 2;
  const endChar = startChar + CCTP_SOURCE_DOMAIN_LENGTH * 2;
  const domainHex = message.slice(startChar, endChar);

  return parseInt(domainHex, 16);
}

// =============================================================================
// EVM Nonce Checking
// =============================================================================

/**
 * Get MessageTransmitter address for an EVM chain.
 */
function getMessageTransmitterAddress(chainId: number): `0x${string}` | null {
  const chains = getSupportedEvmChains(BRIDGEKIT_ENV);
  const chain = chains.find((c) => c.chainId === chainId);

  if (!chain?.cctp?.contracts) return null;

  const contracts = chain.cctp.contracts;
  const v2 = contracts.v2 as { messageTransmitter?: string } | undefined;
  if (v2?.messageTransmitter) {
    return v2.messageTransmitter as `0x${string}`;
  }

  const v1 = contracts.v1 as { messageTransmitter?: string } | undefined;
  return (v1?.messageTransmitter as `0x${string}`) ?? null;
}

/**
 * Create a public client for an EVM chain.
 */
function createEvmClient(chainId: number) {
  const chains = getSupportedEvmChains(BRIDGEKIT_ENV);
  const chain = chains.find((c) => c.chainId === chainId);
  if (!chain) throw new Error(`Unsupported EVM chain: ${chainId}`);

  const rpcUrl = chain.rpcEndpoints?.[0] ?? chain.rpcUrls?.default?.http?.[0];
  if (!rpcUrl) throw new Error(`No RPC URL for chain ${chainId}`);

  const { http } = require("viem");
  return createPublicClient({
    transport: http(rpcUrl),
  });
}

/**
 * Check if nonce is used on EVM destination.
 */
async function checkEvmNonceUsed(
  destinationChainId: number,
  sourceDomain: number,
  nonce: `0x${string}`
): Promise<NonceCheckResult> {
  const messageTransmitter = getMessageTransmitterAddress(destinationChainId);
  if (!messageTransmitter) {
    return { isUsed: false, error: `No MessageTransmitter for chain ${destinationChainId}` };
  }

  try {
    const client = createEvmClient(destinationChainId);

    // Compute hash: keccak256(abi.encodePacked(uint32(sourceDomain), bytes32(nonce)))
    const sourceNonceHash = keccak256(
      encodePacked(["uint32", "bytes32"], [sourceDomain, nonce])
    );

    const usedNonce = await client.readContract({
      address: messageTransmitter,
      abi: USED_NONCES_ABI,
      functionName: "usedNonces",
      args: [sourceNonceHash],
    });

    return { isUsed: usedNonce > BigInt(0) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { isUsed: false, error: `Failed to check EVM nonce: ${message}` };
  }
}

// =============================================================================
// Solana Nonce Checking
// =============================================================================

/**
 * Derive the usedNonce PDA from nonce bytes.
 */
function deriveUsedNoncePda(nonceHex: string): PublicKey {
  const cleanNonce = nonceHex.replace(/^0x/, "");
  if (cleanNonce.length !== 64) {
    throw new Error(`Invalid nonce: expected 64 hex chars, got ${cleanNonce.length}`);
  }

  const nonceBuf = Buffer.from(cleanNonce, "hex");
  const [usedNoncePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("used_nonce"), nonceBuf],
    MESSAGE_TRANSMITTER_PROGRAM_ID
  );

  return usedNoncePda;
}

/**
 * Check if nonce is used on Solana destination.
 * Checks if the usedNonce PDA account exists.
 */
async function checkSolanaNonceUsed(
  destinationChainId: SolanaChainId,
  nonce: `0x${string}`
): Promise<NonceCheckResult> {
  try {
    const endpoint = getSolanaRpcEndpoint(destinationChainId);
    const connection = new Connection(endpoint, "confirmed");

    const usedNoncePda = deriveUsedNoncePda(nonce);
    const accountInfo = await connection.getAccountInfo(usedNoncePda);

    // If account exists, nonce has been used
    return { isUsed: accountInfo !== null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { isUsed: false, error: `Failed to check Solana nonce: ${message}` };
  }
}

// =============================================================================
// Unified Interface
// =============================================================================

/**
 * Check if a CCTP nonce has been used (mint already executed).
 * Automatically routes to EVM or Solana implementation based on destination chain.
 *
 * @param destinationChainId - The destination chain where mint would occur
 * @param message - The CCTP message bytes (nonce is extracted from this)
 */
export async function checkNonceUsed(
  destinationChainId: ChainId,
  message: `0x${string}`
): Promise<NonceCheckResult> {
  try {
    // Extract nonce and source domain from message
    const nonce = extractNonceFromMessage(message);
    const sourceDomain = extractSourceDomainFromMessage(message);

    if (isSolanaChain(destinationChainId)) {
      return await checkSolanaNonceUsed(destinationChainId, nonce);
    } else {
      return await checkEvmNonceUsed(destinationChainId as number, sourceDomain, nonce);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { isUsed: false, error: errorMessage };
  }
}

/**
 * Check nonce using raw parameters (for cases where message is not available).
 * Only works for EVM destinations.
 */
export async function checkEvmNonceUsedDirect(
  destinationChainId: number,
  sourceDomain: number,
  nonce: `0x${string}`
): Promise<NonceCheckResult> {
  return checkEvmNonceUsed(destinationChainId, sourceDomain, nonce);
}
