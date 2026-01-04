/**
 * Mint simulation utility for CCTP transactions.
 * Simulates the receiveMessage call to check if a mint can be executed.
 */

import { createPublicClient, keccak256, encodePacked } from "viem";
import {
  getMessageTransmitterAddress,
  MESSAGE_TRANSMITTER_ABI,
} from "./contracts";
import {
  getWagmiChainsForEnv,
  getWagmiTransportsForEnv,
} from "./bridgeKit";

// CCTP message format constants
const CCTP_MESSAGE_HEADER_BYTES = 148; // Minimum header size
const CCTP_NONCE_OFFSET = 12; // Nonce starts at byte 12
const CCTP_NONCE_LENGTH = 32; // Nonce is 32 bytes
const CCTP_SOURCE_DOMAIN_OFFSET = 4; // Source domain at byte 4
const CCTP_SOURCE_DOMAIN_LENGTH = 4; // Domain is 4 bytes

export interface SimulationResult {
  success: boolean;
  canMint: boolean;
  alreadyMinted: boolean;
  error?: string;
}

/**
 * Create a public client for a given chain ID using app's RPC config.
 */
function getPublicClient(chainId: number) {
  const chains = getWagmiChainsForEnv();
  const transports = getWagmiTransportsForEnv();

  const chain = chains.find((c) => c.id === chainId);
  if (!chain) {
    throw new Error(`Unsupported chain: ${chainId}`);
  }

  const transport = transports[chainId];
  if (!transport) {
    throw new Error(`No RPC transport configured for chain ${chainId}`);
  }

  return createPublicClient({
    chain,
    transport,
  });
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

  return usedNonce > 0n;
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
 */
export async function checkMintReadiness(
  sourceChainId: number,
  destinationChainId: number,
  burnTxHash: string
): Promise<SimulationResult & { attestationReady: boolean }> {
  // Import dynamically to avoid circular deps
  const { fetchAttestation } = await import("./iris");

  const attestationData = await fetchAttestation(sourceChainId, burnTxHash);

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
  };
}
