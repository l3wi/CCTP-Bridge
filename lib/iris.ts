/**
 * Iris API client for fetching CCTP attestations directly.
 * Used to check attestation status and retrieve message/attestation data
 * for manual mint execution.
 */

import { getCctpDomainId, getCctpDomainIdUniversal, isTestnetChain, isTestnetChainUniversal } from "./contracts";
import type { ChainId } from "./types";
import { isSolanaChain, isValidEvmTxHash, isValidSolanaTxHash } from "./types";
import { irisRateLimiter } from "./utils/rateLimiter";

const IRIS_API_ENDPOINTS = {
  mainnet: "https://iris-api.circle.com",
  testnet: "https://iris-api-sandbox.circle.com",
} as const;

const IRIS_PENDING_CACHE_TTL_MS = 10_000;
const IRIS_COMPLETE_CACHE_TTL_MS = 60_000;
const IRIS_NOT_FOUND_CACHE_TTL_MS = 5_000;

interface CachedAttestationEntry {
  expiresAt: number;
  value: AttestationData | null;
}

// Prevent duplicate concurrent Iris calls for identical sourceDomain+txHash requests.
const pendingUniversalAttestationRequests = new Map<
  string,
  Promise<AttestationData | null>
>();
const cachedUniversalAttestationResponses = new Map<string, CachedAttestationEntry>();
const pendingUniversalNonceAttestationRequests = new Map<
  string,
  Promise<AttestationLookupByNonceResult | null>
>();
const cachedUniversalNonceAttestationResponses = new Map<
  string,
  {
    expiresAt: number;
    value: AttestationLookupByNonceResult | null;
  }
>();

export interface IrisAttestationResponse {
  messages: Array<{
    attestation: string;
    message: string;
    transactionHash?: string;
    txHash?: string;
    sourceTxHash?: string;
    eventNonce: string;
    status: "pending" | "pending_confirmations" | "complete";
    cctpVersion: number;
    /** Reason for delayed attestation (e.g., "insufficient_fee" for fast transfers without proper fee) */
    delayReason?: string;
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
  message?: `0x${string}`;
  attestation?: `0x${string}`;
  status: "pending" | "pending_confirmations" | "complete";
  sourceDomain?: number;
  destinationDomain?: number;
  nonce: string;
  amount?: string;
  mintRecipient?: string;
  /** Reason for delayed attestation (e.g., "insufficient_fee") - indicates standard speed fallback */
  delayReason?: string;
}

export interface AttestationLookupByNonceResult {
  attestation: AttestationData;
  burnTxHash?: string;
}

/**
 * Log attestation delay reason if present.
 */
function logDelayReason(delayReason: string | undefined): void {
  if (delayReason) {
    console.warn(
      `[CCTP] Attestation delayed: ${delayReason}. Transfer will proceed at standard speed.`
    );
  }
}

function normalizeSourceTxHash(
  sourceChainId: ChainId,
  maybeHash: unknown
): string | undefined {
  if (typeof maybeHash !== "string") return undefined;
  const trimmed = maybeHash.trim();
  if (!trimmed) return undefined;

  if (isSolanaChain(sourceChainId)) {
    return isValidSolanaTxHash(trimmed) ? trimmed : undefined;
  }

  const normalized = trimmed.startsWith("0x")
    ? trimmed.toLowerCase()
    : `0x${trimmed.toLowerCase()}`;
  return isValidEvmTxHash(normalized) ? normalized : undefined;
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
    // Rate limit API calls to stay under 35 req/s limit
    const response = await irisRateLimiter.throttle(() =>
      fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      })
    );

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

    // Log delay reason if present (insufficient fee means fallback to standard speed)
    logDelayReason(msg.delayReason);

    // Domains are inside decodedMessage
    if (!msg.decodedMessage) {
      // Attestation still in progress - expected during attestation window.
      if (msg.status === "complete") {
        console.error("Iris returned complete status without decodedMessage payload");
        return null;
      }
      return {
        status: msg.status,
        nonce: msg.eventNonce,
        delayReason: msg.delayReason,
      };
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
      delayReason: msg.delayReason,
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
  const requestKey = `${sourceDomain}:${normalizedHash}:${isTestnet ? "testnet" : "mainnet"}`;
  const now = Date.now();
  const cached = cachedUniversalAttestationResponses.get(requestKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const existingRequest = pendingUniversalAttestationRequests.get(requestKey);
  if (existingRequest) {
    return existingRequest;
  }

  const requestPromise = (async (): Promise<AttestationData | null> => {
    try {
      // Rate limit API calls to stay under 35 req/s limit
      const response = await irisRateLimiter.throttle(() =>
        fetch(url, {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
        })
      );

      if (!response.ok) {
        if (response.status !== 404) {
          console.error(
            `Iris API error: ${response.status} ${response.statusText}`
          );
        }
        cachedUniversalAttestationResponses.set(requestKey, {
          value: null,
          expiresAt: Date.now() + IRIS_NOT_FOUND_CACHE_TTL_MS,
        });
        return null;
      }

      const data: IrisAttestationResponse = await response.json();

      if (!data.messages || data.messages.length === 0) {
        cachedUniversalAttestationResponses.set(requestKey, {
          value: null,
          expiresAt: Date.now() + IRIS_NOT_FOUND_CACHE_TTL_MS,
        });
        return null;
      }

      const msg = data.messages[0];

      // Log delay reason if present (insufficient fee means fallback to standard speed)
      logDelayReason(msg.delayReason);

      if (!msg.decodedMessage) {
        if (msg.status === "complete") {
          console.error("Iris returned complete status without decodedMessage payload");
          cachedUniversalAttestationResponses.set(requestKey, {
            value: null,
            expiresAt: Date.now() + IRIS_NOT_FOUND_CACHE_TTL_MS,
          });
          return null;
        }

        const pendingResult: AttestationData = {
          status: msg.status,
          nonce: msg.eventNonce,
          delayReason: msg.delayReason,
        };
        cachedUniversalAttestationResponses.set(requestKey, {
          value: pendingResult,
          expiresAt: Date.now() + IRIS_PENDING_CACHE_TTL_MS,
        });
        return pendingResult;
      }

      const message = (
        msg.message.startsWith("0x") ? msg.message : `0x${msg.message}`
      ) as `0x${string}`;
      const attestation = (
        msg.attestation.startsWith("0x") ? msg.attestation : `0x${msg.attestation}`
      ) as `0x${string}`;

      const attestationResult: AttestationData = {
        message,
        attestation,
        status: msg.status,
        sourceDomain: parseInt(msg.decodedMessage.sourceDomain, 10),
        destinationDomain: parseInt(msg.decodedMessage.destinationDomain, 10),
        nonce: msg.eventNonce,
        amount: msg.decodedMessage.decodedMessageBody?.amount,
        mintRecipient: msg.decodedMessage.decodedMessageBody?.mintRecipient,
        delayReason: msg.delayReason,
      };
      const ttl =
        attestationResult.status === "complete"
          ? IRIS_COMPLETE_CACHE_TTL_MS
          : IRIS_PENDING_CACHE_TTL_MS;
      cachedUniversalAttestationResponses.set(requestKey, {
        value: attestationResult,
        expiresAt: Date.now() + ttl,
      });
      return attestationResult;
    } catch (error) {
      console.error("Failed to fetch attestation from Iris:", error);
      cachedUniversalAttestationResponses.set(requestKey, {
        value: null,
        expiresAt: Date.now() + IRIS_NOT_FOUND_CACHE_TTL_MS,
      });
      return null;
    } finally {
      pendingUniversalAttestationRequests.delete(requestKey);
    }
  })();

  pendingUniversalAttestationRequests.set(requestKey, requestPromise);
  return requestPromise;
}

/**
 * Fetch attestation data from Iris API by source chain + nonce.
 * Useful for restoring share links that only include a nonce.
 */
export async function fetchAttestationByNonceUniversal(
  sourceChainId: ChainId,
  nonce: string
): Promise<AttestationLookupByNonceResult | null> {
  const sourceDomain = getCctpDomainIdUniversal(sourceChainId);
  if (sourceDomain === null) {
    console.error(`Unknown CCTP domain for chain ${sourceChainId}`);
    return null;
  }

  const normalizedNonce = nonce.trim();
  if (!normalizedNonce) {
    return null;
  }

  const isTestnet = isTestnetChainUniversal(sourceChainId);
  const baseUrl = isTestnet ? IRIS_API_ENDPOINTS.testnet : IRIS_API_ENDPOINTS.mainnet;
  const url = `${baseUrl}/v2/messages/${sourceDomain}?nonce=${encodeURIComponent(
    normalizedNonce
  )}`;
  const requestKey = `${sourceDomain}:${normalizedNonce}:${isTestnet ? "testnet" : "mainnet"}`;
  const now = Date.now();
  const cached = cachedUniversalNonceAttestationResponses.get(requestKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const existingRequest = pendingUniversalNonceAttestationRequests.get(requestKey);
  if (existingRequest) {
    return existingRequest;
  }

  const requestPromise = (async (): Promise<AttestationLookupByNonceResult | null> => {
    try {
      const response = await irisRateLimiter.throttle(() =>
        fetch(url, {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
        })
      );

      if (!response.ok) {
        if (response.status !== 404) {
          console.error(
            `Iris nonce API error: ${response.status} ${response.statusText}`
          );
        }
        cachedUniversalNonceAttestationResponses.set(requestKey, {
          value: null,
          expiresAt: Date.now() + IRIS_NOT_FOUND_CACHE_TTL_MS,
        });
        return null;
      }

      const data: IrisAttestationResponse = await response.json();

      if (!data.messages || data.messages.length === 0) {
        cachedUniversalNonceAttestationResponses.set(requestKey, {
          value: null,
          expiresAt: Date.now() + IRIS_NOT_FOUND_CACHE_TTL_MS,
        });
        return null;
      }

      const msg = data.messages[0];
      logDelayReason(msg.delayReason);

      if (!msg.decodedMessage) {
        if (msg.status === "complete") {
          console.error("Iris returned complete status without decodedMessage payload");
          cachedUniversalNonceAttestationResponses.set(requestKey, {
            value: null,
            expiresAt: Date.now() + IRIS_NOT_FOUND_CACHE_TTL_MS,
          });
          return null;
        }

        const pendingAttestation: AttestationData = {
          status: msg.status,
          nonce: msg.eventNonce,
          delayReason: msg.delayReason,
        };
        const pendingResult: AttestationLookupByNonceResult = {
          attestation: pendingAttestation,
          burnTxHash: normalizeSourceTxHash(
            sourceChainId,
            msg.transactionHash ?? msg.txHash ?? msg.sourceTxHash
          ),
        };
        cachedUniversalNonceAttestationResponses.set(requestKey, {
          value: pendingResult,
          expiresAt: Date.now() + IRIS_PENDING_CACHE_TTL_MS,
        });
        return pendingResult;
      }

      const message = (
        msg.message.startsWith("0x") ? msg.message : `0x${msg.message}`
      ) as `0x${string}`;
      const attestation = (
        msg.attestation.startsWith("0x") ? msg.attestation : `0x${msg.attestation}`
      ) as `0x${string}`;

      const attestationResult: AttestationData = {
        message,
        attestation,
        status: msg.status,
        sourceDomain: parseInt(msg.decodedMessage.sourceDomain, 10),
        destinationDomain: parseInt(msg.decodedMessage.destinationDomain, 10),
        nonce: msg.eventNonce,
        amount: msg.decodedMessage.decodedMessageBody?.amount,
        mintRecipient: msg.decodedMessage.decodedMessageBody?.mintRecipient,
        delayReason: msg.delayReason,
      };

      const result: AttestationLookupByNonceResult = {
        attestation: attestationResult,
        burnTxHash: normalizeSourceTxHash(
          sourceChainId,
          msg.transactionHash ?? msg.txHash ?? msg.sourceTxHash
        ),
      };

      const ttl =
        attestationResult.status === "complete"
          ? IRIS_COMPLETE_CACHE_TTL_MS
          : IRIS_PENDING_CACHE_TTL_MS;
      cachedUniversalNonceAttestationResponses.set(requestKey, {
        value: result,
        expiresAt: Date.now() + ttl,
      });
      return result;
    } catch (error) {
      console.error("Failed to fetch nonce attestation from Iris:", error);
      cachedUniversalNonceAttestationResponses.set(requestKey, {
        value: null,
        expiresAt: Date.now() + IRIS_NOT_FOUND_CACHE_TTL_MS,
      });
      return null;
    } finally {
      pendingUniversalNonceAttestationRequests.delete(requestKey);
    }
  })();

  pendingUniversalNonceAttestationRequests.set(requestKey, requestPromise);
  return requestPromise;
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

export interface ReattestResult {
  success: boolean;
  message?: string;
  nonce?: string;
  error?: string;
}

/**
 * Request re-attestation for an expired CCTP message.
 * This is used when a message has expired and needs to be re-signed by Circle.
 *
 * CCTP v2 messages have a 24-hour expiration window. If the message expires
 * before being claimed on the destination chain, this endpoint can be used
 * to get a fresh attestation.
 *
 * Note: Re-attested messages will use standard finality (not fast transfer).
 *
 * @param sourceChainId - The source chain ID (to determine testnet/mainnet)
 * @param nonce - The message nonce (can be decimal string or hex)
 * @returns Result indicating success or failure
 */
export async function requestReattestation(
  sourceChainId: ChainId,
  nonce: string
): Promise<ReattestResult> {
  const isTestnet = isTestnetChainUniversal(sourceChainId);

  const baseUrl = isTestnet ? IRIS_API_ENDPOINTS.testnet : IRIS_API_ENDPOINTS.mainnet;

  // The API expects the nonce in the path
  // Nonce should be the eventNonce from the attestation response
  const url = `${baseUrl}/v2/reattest/${nonce}`;

  try {
    const response = await irisRateLimiter.throttle(() =>
      fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      })
    );

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `Re-attestation failed: ${response.status}`;

      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.message || errorJson.error || errorMessage;
      } catch {
        // Use the raw text if not JSON
        if (errorText) {
          errorMessage = errorText;
        }
      }

      console.error("Re-attestation API error:", {
        status: response.status,
        error: errorText,
      });

      return {
        success: false,
        error: errorMessage,
      };
    }

    const data = await response.json();

    return {
      success: true,
      message: data.message || "Re-attestation requested successfully",
      nonce: data.nonce,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Failed to request re-attestation:", error);

    return {
      success: false,
      error: `Network error: ${errorMessage}`,
    };
  }
}

/**
 * Check if an error message indicates an expired CCTP message.
 */
export function isMessageExpiredError(error: unknown): boolean {
  const errorMessage = error instanceof Error ? error.message : String(error);
  return /message expired|must be re-signed/i.test(errorMessage);
}
