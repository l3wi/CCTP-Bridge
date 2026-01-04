/**
 * Mint simulation utility for CCTP transactions.
 * Simulates the receiveMessage call to check if a mint can be executed.
 */

import { createPublicClient, http, keccak256, encodePacked } from "viem";
import { mainnet, sepolia, avalanche, avalancheFuji, optimism, optimismSepolia, arbitrum, arbitrumSepolia, base, baseSepolia, polygon, polygonAmoy } from "viem/chains";
import {
  getMessageTransmitterAddress,
  MESSAGE_TRANSMITTER_ABI,
  getCctpDomainId,
} from "./contracts";

// Chain configs for viem
const CHAIN_CONFIGS: Record<number, typeof mainnet> = {
  1: mainnet,
  11155111: sepolia,
  43114: avalanche,
  43113: avalancheFuji,
  10: optimism,
  11155420: optimismSepolia,
  42161: arbitrum,
  421614: arbitrumSepolia,
  8453: base,
  84532: baseSepolia,
  137: polygon,
  80002: polygonAmoy,
};

export interface SimulationResult {
  success: boolean;
  canMint: boolean;
  alreadyMinted: boolean;
  error?: string;
}

/**
 * Create a public client for a given chain ID
 */
function getPublicClient(chainId: number) {
  const chain = CHAIN_CONFIGS[chainId];
  if (!chain) {
    throw new Error(`Unsupported chain: ${chainId}`);
  }

  return createPublicClient({
    chain,
    transport: http(),
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
 * Extract nonce from CCTP message bytes.
 * Message format: version (4) + sourceDomain (4) + destinationDomain (4) + nonce (32) + ...
 * Nonce is at bytes 12-44 (0-indexed)
 */
export function extractNonceFromMessage(message: `0x${string}`): `0x${string}` {
  // Remove 0x prefix, nonce starts at byte 12 (char 24) and is 32 bytes (64 chars)
  const nonceHex = message.slice(2 + 24, 2 + 24 + 64);
  return `0x${nonceHex}` as `0x${string}`;
}

/**
 * Extract source domain from CCTP message bytes.
 * Source domain is at bytes 4-8
 */
export function extractSourceDomainFromMessage(message: `0x${string}`): number {
  const domainHex = message.slice(2 + 8, 2 + 16);
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

  const client = getPublicClient(destinationChainId);

  // First, check if nonce is already used
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
  } catch (error: any) {
    const errorMessage = error?.message || String(error);

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
      error: errorMessage.slice(0, 200), // Truncate long errors
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
