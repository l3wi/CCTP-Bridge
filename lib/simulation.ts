/**
 * Mint simulation utility for CCTP transactions.
 * Simulates the receiveMessage call to check if a mint can be executed.
 */

import { keccak256, encodePacked } from "viem";
import {
  getMessageTransmitterAddress,
  MESSAGE_TRANSMITTER_ABI,
} from "./contracts";
import { getCctpDomainSafe } from "./cctp/shared";
import { createEvmPublicClient, createSolanaConnection } from "@/lib/rpc/clients";
import type { SolanaChainId } from "./types";

// CCTP message format constants
const CCTP_MESSAGE_HEADER_BYTES = 148; // Minimum header size
const CCTP_NONCE_OFFSET = 12; // Nonce starts at byte 12
const CCTP_NONCE_LENGTH = 32; // Nonce is 32 bytes
const CCTP_SOURCE_DOMAIN_OFFSET = 4; // Source domain at byte 4
const CCTP_SOURCE_DOMAIN_LENGTH = 4; // Domain is 4 bytes
const CCTP_DEST_DOMAIN_OFFSET = 8; // Destination domain at byte 8
const CCTP_DEST_DOMAIN_LENGTH = 4; // Domain is 4 bytes
const CCTP_SOLANA_EXPIRATION_INDEX = 196; // BurnMessage offset to expirationBlock field
const CCTP_U256_TO_U64_OFFSET = 24; // Last 8 bytes of EVM uint256 contain Solana u64 slot

export interface SimulationResult {
  success: boolean;
  canMint: boolean;
  alreadyMinted: boolean;
  /** True if the message attestation has expired and needs re-signing */
  messageExpired?: boolean;
  error?: string;
}

/**
 * Create a public client for a given chain ID using app's RPC config.
 */
function getPublicClient(chainId: number) {
  return createEvmPublicClient(chainId);
}

/**
 * Check if a nonce has already been used (mint already executed)
 */
export async function checkNonceUsed(
  destinationChainId: number,
  sourceDomain: number,
  nonce: `0x${string}`
): Promise<boolean> {
  const messageTransmitter = getMessageTransmitterAddress(destinationChainId);
  if (!messageTransmitter) {
    throw new Error(`No MessageTransmitter for chain ${destinationChainId}`);
  }

  const client = getPublicClient(destinationChainId);

  // Compute the source nonce hash: keccak256(abi.encodePacked(uint32(sourceDomain), bytes32(nonce)))
  const sourceNonceHash = keccak256(
    encodePacked(["uint32", "bytes32"], [sourceDomain, nonce])
  );

  const usedNonce = await client.readContract({
    address: messageTransmitter,
    abi: MESSAGE_TRANSMITTER_ABI,
    functionName: "usedNonces",
    args: [sourceNonceHash],
  });

  return usedNonce > BigInt(0);
}

/**
 * Validate CCTP message format before extracting data.
 * Returns true if message has valid structure.
 */
function validateMessageFormat(message: `0x${string}`): boolean {
  if (!message || !message.startsWith("0x")) {
    return false;
  }

  // Calculate byte length (subtract 0x prefix, divide by 2 for hex chars)
  const byteLength = (message.length - 2) / 2;

  // Message must be at least header size
  if (byteLength < CCTP_MESSAGE_HEADER_BYTES) {
    return false;
  }

  return true;
}

/**
 * Extract nonce from CCTP message bytes.
 * Message format: version (4) + sourceDomain (4) + destinationDomain (4) + nonce (32) + ...
 * Nonce is at bytes 12-44 (0-indexed, exclusive end)
 */
export function extractNonceFromMessage(message: `0x${string}`): `0x${string}` {
  if (!validateMessageFormat(message)) {
    throw new Error(
      `Invalid CCTP message format: expected at least ${CCTP_MESSAGE_HEADER_BYTES} bytes`
    );
  }

  // Convert byte offsets to hex char positions (multiply by 2, add 2 for 0x prefix)
  const startChar = 2 + CCTP_NONCE_OFFSET * 2;
  const endChar = startChar + CCTP_NONCE_LENGTH * 2;
  const nonceHex = message.slice(startChar, endChar);

  return `0x${nonceHex}` as `0x${string}`;
}

/**
 * Extract source domain from CCTP message bytes.
 * Source domain is at bytes 4-8 (0-indexed, exclusive end)
 */
export function extractSourceDomainFromMessage(message: `0x${string}`): number {
  if (!validateMessageFormat(message)) {
    throw new Error(
      `Invalid CCTP message format: expected at least ${CCTP_MESSAGE_HEADER_BYTES} bytes`
    );
  }

  const startChar = 2 + CCTP_SOURCE_DOMAIN_OFFSET * 2;
  const endChar = startChar + CCTP_SOURCE_DOMAIN_LENGTH * 2;
  const domainHex = message.slice(startChar, endChar);

  return parseInt(domainHex, 16);
}

/**
 * Extract destination domain from CCTP message bytes.
 * Destination domain is at bytes 8-12 (0-indexed, exclusive end)
 */
export function extractDestinationDomainFromMessage(message: `0x${string}`): number {
  if (!validateMessageFormat(message)) {
    throw new Error(
      `Invalid CCTP message format: expected at least ${CCTP_MESSAGE_HEADER_BYTES} bytes`
    );
  }

  const startChar = 2 + CCTP_DEST_DOMAIN_OFFSET * 2;
  const endChar = startChar + CCTP_DEST_DOMAIN_LENGTH * 2;
  const domainHex = message.slice(startChar, endChar);

  return parseInt(domainHex, 16);
}

/**
 * Extract expiration block from a CCTP v2 message for Solana destinations.
 * Returns 0 when the message does not carry an expiration block.
 */
function extractSolanaExpirationBlock(message: `0x${string}`): number {
  if (!validateMessageFormat(message)) return 0;

  const hex = message.slice(2);
  const totalBytes = hex.length / 2;
  const requiredBytes =
    CCTP_MESSAGE_HEADER_BYTES + CCTP_SOLANA_EXPIRATION_INDEX + 32;

  if (totalBytes < requiredBytes) return 0;

  const byteOffset =
    CCTP_MESSAGE_HEADER_BYTES +
    CCTP_SOLANA_EXPIRATION_INDEX +
    CCTP_U256_TO_U64_OFFSET;
  const start = byteOffset * 2;
  const end = start + 16; // u64 = 8 bytes
  const expirationHex = hex.slice(start, end);

  if (expirationHex.length !== 16) return 0;
  const parsed = Number.parseInt(expirationHex, 16);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Simulate a mint (receiveMessage) transaction to check if it will succeed.
 *
 * @param destinationChainId - The chain ID where mint will occur
 * @param message - The CCTP message bytes
 * @param attestation - The attestation bytes from Circle
 * @returns Simulation result with success status and error details
 */
export async function simulateMint(
  destinationChainId: number,
  message: `0x${string}`,
  attestation: `0x${string}`
): Promise<SimulationResult> {
  const messageTransmitter = getMessageTransmitterAddress(destinationChainId);
  if (!messageTransmitter) {
    return {
      success: false,
      canMint: false,
      alreadyMinted: false,
      error: `No MessageTransmitter for chain ${destinationChainId}`,
    };
  }

  // Validate message format before processing
  if (!validateMessageFormat(message)) {
    return {
      success: false,
      canMint: false,
      alreadyMinted: false,
      error: `Invalid CCTP message format`,
    };
  }

  // Validate destination domain matches the target chain
  try {
    const messageDomain = extractDestinationDomainFromMessage(message);
    const expectedDomain = getCctpDomainSafe(destinationChainId);

    if (expectedDomain !== null && messageDomain !== expectedDomain) {
      console.error(
        `[simulateMint] Domain mismatch: message destination domain=${messageDomain}, ` +
        `but target chain ${destinationChainId} has domain=${expectedDomain}. ` +
        `The mint must be executed on the chain matching domain ${messageDomain}.`
      );
      return {
        success: false,
        canMint: false,
        alreadyMinted: false,
        error: `Destination chain mismatch: this transfer targets domain ${messageDomain}, ` +
          `not chain ${destinationChainId} (domain ${expectedDomain}). ` +
          `Please switch to the correct destination chain.`,
      };
    }
  } catch {
    // Don't block on validation errors — continue with simulation
  }

  const client = getPublicClient(destinationChainId);

  // Extract nonce and source domain for nonce check
  const nonce = extractNonceFromMessage(message);
  const sourceDomain = extractSourceDomainFromMessage(message);

  try {
    const isUsed = await checkNonceUsed(destinationChainId, sourceDomain, nonce);
    if (isUsed) {
      return {
        success: true,
        canMint: false,
        alreadyMinted: true,
        error: "Nonce already used - mint was already executed",
      };
    }
  } catch (error) {
    // Continue to simulation if nonce check fails
    console.warn("Nonce check failed, continuing to simulation:", error);
  }

  // Simulate the receiveMessage call
  try {
    await client.simulateContract({
      address: messageTransmitter,
      abi: MESSAGE_TRANSMITTER_ABI,
      functionName: "receiveMessage",
      args: [message, attestation],
    });

    return {
      success: true,
      canMint: true,
      alreadyMinted: false,
    };
  } catch (error: unknown) {
    // Log full error for debugging before truncating
    console.error("Mint simulation failed:", error);

    const errorMessage =
      error instanceof Error ? error.message : String(error);

    // Check for nonce already used error
    if (/nonce already used/i.test(errorMessage)) {
      return {
        success: true,
        canMint: false,
        alreadyMinted: true,
        error: "Nonce already used - mint was already executed",
      };
    }

    // Check for invalid attestation
    if (/invalid attestation/i.test(errorMessage)) {
      return {
        success: false,
        canMint: false,
        alreadyMinted: false,
        error: "Invalid attestation signature",
      };
    }

    // Check for expired message (CCTP v2 messages expire after 24 hours)
    if (/message expired|must be re-signed/i.test(errorMessage)) {
      return {
        success: false,
        canMint: false,
        alreadyMinted: false,
        messageExpired: true,
        error: "Message expired - attestation needs to be re-signed",
      };
    }

    return {
      success: false,
      canMint: false,
      alreadyMinted: false,
      error: errorMessage.slice(0, 200), // Truncate for UI display
    };
  }
}

/**
 * Full check: fetch attestation from Iris and simulate mint.
 * This is the main function used by the UI for polling.
 * Supports both EVM and Solana source chains.
 *
 * @param skipSimulation - If true, skip EVM simulation and return success once attestation is ready.
 *                         Use for Solana sources to avoid RPC spam (user must click Claim anyway).
 */
export async function checkMintReadiness(
  sourceChainId: number | string, // EVM chain ID or Solana chain string
  destinationChainId: number,
  burnTxHash: string,
  skipSimulation: boolean = false
): Promise<SimulationResult & { attestationReady: boolean; delayReason?: string; nonce?: string }> {
  // Import dynamically to avoid circular deps
  const { fetchAttestationUniversal } = await import("./iris");

  // fetchAttestationUniversal accepts ChainId (number | string)
  const attestationData = await fetchAttestationUniversal(
    sourceChainId as import("./types").ChainId,
    burnTxHash
  );

  if (!attestationData) {
    return {
      success: false,
      canMint: false,
      alreadyMinted: false,
      attestationReady: false,
      error: "Attestation not found or not ready",
    };
  }

  if (attestationData.status !== "complete") {
    return {
      success: false,
      canMint: false,
      alreadyMinted: false,
      attestationReady: false,
      error: "Attestation pending",
      delayReason: attestationData.delayReason,
      nonce: attestationData.nonce,
    };
  }

  // Skip RPC simulation if requested (for Solana sources)
  // Once attestation is ready, we know the user can mint - they just need to click Claim
  if (skipSimulation) {
    return {
      success: true,
      canMint: true,
      alreadyMinted: false,
      attestationReady: true,
      delayReason: attestationData.delayReason,
      nonce: attestationData.nonce,
    };
  }

  const simResult = await simulateMint(
    destinationChainId,
    attestationData.message,
    attestationData.attestation
  );

  return {
    ...simResult,
    attestationReady: true,
    delayReason: attestationData.delayReason,
    nonce: attestationData.nonce,
  };
}

/**
 * Check if a Solana CCTP mint has already been executed.
 * Uses transaction simulation to detect "account already in use" error,
 * which indicates the nonce account was already allocated (mint happened).
 *
 * @param sourceChainId - The source EVM chain ID
 * @param destinationChainId - The destination Solana chain ID
 * @param attestationData - The attestation data from Iris
 * @param walletAdapter - The Solana wallet adapter
 * @returns Simulation result with alreadyMinted status
 */
export async function checkSolanaMintStatus(
  sourceChainId: number,
  destinationChainId: SolanaChainId,
  attestationData: {
    nonce: string;
    attestation: string;
    message: string;
    mintRecipient?: string;
  },
  _walletAdapter: unknown
): Promise<SimulationResult> {
  try {
    void sourceChainId;

    // This helper is now metadata/RPC only and no longer relies on BridgeKit adapters.
    // Do lightweight freshness checks here so polling does not mark an expired
    // message as ready-to-claim.
    if (!attestationData.message || !attestationData.attestation) {
      return {
        success: false,
        canMint: false,
        alreadyMinted: false,
        error: "Missing attestation payload",
      };
    }

    const expirationBlock = extractSolanaExpirationBlock(
      attestationData.message as `0x${string}`
    );
    if (expirationBlock > 0) {
      const connection = createSolanaConnection(destinationChainId, "confirmed");
      const currentSlot = await connection.getSlot("confirmed");

      if (currentSlot >= expirationBlock) {
        return {
          success: false,
          canMint: false,
          alreadyMinted: false,
          messageExpired: true,
          error: `Message expired at slot ${expirationBlock} (current: ${currentSlot})`,
        };
      }
    }

    return {
      success: true,
      canMint: true,
      alreadyMinted: false,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Extract logs from Solana simulation errors if available
    const errorLogs = (error as { logs?: string[] })?.logs ?? [];
    const logsText = errorLogs.join("\n");

    // Check for "already in use" or CCTP Custom:0 error - means nonce consumed, mint happened
    // CCTP logs "Allocate: account Address {...} already in use" when nonce consumed
    if (
      /already in use/i.test(errorMessage) ||
      /already in use/i.test(logsText) ||
      /account.*already.*use/i.test(errorMessage) ||
      /"Custom":\s*0\b/.test(errorMessage)
    ) {
      return {
        success: true,
        canMint: false,
        alreadyMinted: true,
        error: "Nonce already used - mint was already executed",
      };
    }

    return {
      success: false,
      canMint: false,
      alreadyMinted: false,
      error: errorMessage.slice(0, 200),
    };
  }
}
