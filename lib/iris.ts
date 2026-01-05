/**
 * Iris API client for fetching CCTP attestations directly.
 * Used to check attestation status and retrieve message/attestation data
 * for manual mint execution.
 */

import { getCctpDomainId, getCctpDomainIdUniversal, isTestnetChain, isTestnetChainUniversal } from "./contracts";
import type { ChainId } from "./types";
import { isSolanaChain, isValidEvmTxHash, isValidSolanaTxHash } from "./types";

const IRIS_API_ENDPOINTS = {
  mainnet: "https://iris-api.circle.com",
  testnet: "https://iris-api-sandbox.circle.com",
} as const;

export interface IrisAttestationResponse {
  messages: Array<{
    attestation: string;
    message: string;
    eventNonce: string;
    status: "pending" | "complete";
    cctpVersion: number;
    decodedMessage?: {
      sourceDomain: string;
      destinationDomain: string;
      nonce: string;
      sender: string;
      recipient: string;
      messageBody: string;
      decodedMessageBody?: {
        burnToken: string;
        mintRecipient: string;
        amount: string;
        messageSender: string;
      };
    };
  }>;
}

export interface AttestationData {
  message: `0x${string}`;
  attestation: `0x${string}`;
  status: "pending" | "complete";
  sourceDomain: number;
  destinationDomain: number;
  nonce: string;
  amount?: string;
  mintRecipient?: string;
}

/**
 * Fetch attestation data from Iris API by source chain and burn transaction hash.
 *
 * @param sourceChainId - The chain ID where the burn occurred
 * @param burnTxHash - The burn transaction hash
 * @returns Attestation data if found, null otherwise
 */
export async function fetchAttestation(
  sourceChainId: number,
  burnTxHash: string
): Promise<AttestationData | null> {
  const sourceDomain = getCctpDomainId(sourceChainId);
  if (sourceDomain === null) {
    console.error(`Unknown CCTP domain for chain ${sourceChainId}`);
    return null;
  }

  const isTestnet = isTestnetChain(sourceChainId);
  const baseUrl = isTestnet ? IRIS_API_ENDPOINTS.testnet : IRIS_API_ENDPOINTS.mainnet;

  // Normalize tx hash
  const normalizedHash = burnTxHash.toLowerCase().startsWith("0x")
    ? burnTxHash.toLowerCase()
    : `0x${burnTxHash.toLowerCase()}`;

  const url = `${baseUrl}/v2/messages/${sourceDomain}?transactionHash=${normalizedHash}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      // Log non-404 errors for debugging, but always return null
      if (response.status !== 404) {
        console.error(
          `Iris API error: ${response.status} ${response.statusText}`
        );
      }
      return null;
    }

    const data: IrisAttestationResponse = await response.json();

    if (!data.messages || data.messages.length === 0) {
      return null;
    }

    // Get the first (and usually only) message
    const msg = data.messages[0];

    // Domains are inside decodedMessage
    if (!msg.decodedMessage) {
      console.error("Missing decodedMessage in Iris response");
      return null;
    }

    // Ensure message and attestation have 0x prefix
    const message = (
      msg.message.startsWith("0x") ? msg.message : `0x${msg.message}`
    ) as `0x${string}`;
    const attestation = (
      msg.attestation.startsWith("0x") ? msg.attestation : `0x${msg.attestation}`
    ) as `0x${string}`;

    return {
      message,
      attestation,
      status: msg.status,
      sourceDomain: parseInt(msg.decodedMessage.sourceDomain, 10),
      destinationDomain: parseInt(msg.decodedMessage.destinationDomain, 10),
      nonce: msg.eventNonce,
      amount: msg.decodedMessage.decodedMessageBody?.amount,
      mintRecipient: msg.decodedMessage.decodedMessageBody?.mintRecipient,
    };
  } catch (error) {
    console.error("Failed to fetch attestation from Iris:", error);
    return null;
  }
}

/**
 * Fetch attestation data from Iris API for any chain (EVM or Solana).
 * This universal version handles both EVM transaction hashes (0x...) and
 * Solana transaction signatures (Base58).
 *
 * @param sourceChainId - The chain ID where the burn occurred (EVM number or Solana string)
 * @param burnTxHash - The burn transaction hash/signature
 * @returns Attestation data if found, null otherwise
 */
export async function fetchAttestationUniversal(
  sourceChainId: ChainId,
  burnTxHash: string
): Promise<AttestationData | null> {
  const sourceDomain = getCctpDomainIdUniversal(sourceChainId);
  if (sourceDomain === null) {
    console.error(`Unknown CCTP domain for chain ${sourceChainId}`);
    return null;
  }

  const isTestnet = isTestnetChainUniversal(sourceChainId);
  const baseUrl = isTestnet ? IRIS_API_ENDPOINTS.testnet : IRIS_API_ENDPOINTS.mainnet;

  // Normalize tx hash based on chain type
  let normalizedHash: string;
  if (isSolanaChain(sourceChainId)) {
    // Solana signatures are Base58 encoded, use as-is (trimmed)
    normalizedHash = burnTxHash.trim();
    if (!isValidSolanaTxHash(normalizedHash)) {
      console.error("Invalid Solana transaction signature format");
      return null;
    }
  } else {
    // EVM hashes need 0x prefix and lowercase
    normalizedHash = burnTxHash.toLowerCase().startsWith("0x")
      ? burnTxHash.toLowerCase()
      : `0x${burnTxHash.toLowerCase()}`;
    if (!isValidEvmTxHash(normalizedHash)) {
      console.error("Invalid EVM transaction hash format");
      return null;
    }
  }

  const url = `${baseUrl}/v2/messages/${sourceDomain}?transactionHash=${normalizedHash}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      if (response.status !== 404) {
        console.error(
          `Iris API error: ${response.status} ${response.statusText}`
        );
      }
      return null;
    }

    const data: IrisAttestationResponse = await response.json();

    if (!data.messages || data.messages.length === 0) {
      return null;
    }

    const msg = data.messages[0];

    if (!msg.decodedMessage) {
      console.error("Missing decodedMessage in Iris response");
      return null;
    }

    const message = (
      msg.message.startsWith("0x") ? msg.message : `0x${msg.message}`
    ) as `0x${string}`;
    const attestation = (
      msg.attestation.startsWith("0x") ? msg.attestation : `0x${msg.attestation}`
    ) as `0x${string}`;

    return {
      message,
      attestation,
      status: msg.status,
      sourceDomain: parseInt(msg.decodedMessage.sourceDomain, 10),
      destinationDomain: parseInt(msg.decodedMessage.destinationDomain, 10),
      nonce: msg.eventNonce,
      amount: msg.decodedMessage.decodedMessageBody?.amount,
      mintRecipient: msg.decodedMessage.decodedMessageBody?.mintRecipient,
    };
  } catch (error) {
    console.error("Failed to fetch attestation from Iris:", error);
    return null;
  }
}

/**
 * Check if attestation is ready for a given burn transaction.
 * This is a lighter-weight check that just verifies status.
 *
 * @param sourceChainId - The chain ID where the burn occurred
 * @param burnTxHash - The burn transaction hash
 * @returns true if attestation is complete and ready for mint
 */
export async function isAttestationReady(
  sourceChainId: number,
  burnTxHash: string
): Promise<boolean> {
  const data = await fetchAttestation(sourceChainId, burnTxHash);
  return data?.status === "complete";
}
