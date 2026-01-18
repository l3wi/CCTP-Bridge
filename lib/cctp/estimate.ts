/**
 * Custom CCTP bridge fee estimation.
 * Works without wallet connection - only needs chain IDs and amount.
 */

import { getCctpDomainSafe, IRIS_API_ENDPOINTS } from "./shared";
import { getChainName, BRIDGEKIT_ENV } from "../bridgeKit";
import { getFinalityEstimate } from "../cctpFinality";
import { TransferSpeed as BridgeKitSpeed } from "@circle-fin/bridge-kit";
import type {
  ChainId,
  TransferSpeed,
  BridgeEstimate,
  EstimateParams,
  EstimateError,
} from "./types";

// =============================================================================
// Fee API Types
// =============================================================================

interface FeeResponse {
  finalityThreshold: number;
  minimumFee: string | number;
}

// =============================================================================
// Amount Conversion Utilities
// =============================================================================

/**
 * Parse decimal string to bigint (6 decimals for USDC).
 */
function parseAmount(amount: string): bigint {
  const [integerPart, decimalPart = ""] = amount.split(".");
  const paddedDecimal = decimalPart.padEnd(6, "0").slice(0, 6);
  return BigInt(integerPart + paddedDecimal);
}

/**
 * Convert bigint amount to decimal string (6 decimals for USDC).
 */
function formatAmount(amount: bigint): string {
  const str = amount.toString().padStart(7, "0");
  const integerPart = str.slice(0, -6) || "0";
  const decimalPart = str.slice(-6);
  return `${integerPart}.${decimalPart}`;
}

// =============================================================================
// Fee Fetching
// =============================================================================

// Precision multiplier for handling decimal bps values (supports up to 4 decimal places)
const BPS_PRECISION = 10000n;
const BPS_DIVISOR = 10000n * BPS_PRECISION; // 100_000_000n

/**
 * Fetch all fee tiers from IRIS API.
 * Returns fee info for both fast and standard transfers.
 */
async function fetchFeeTiers(
  sourceDomain: number,
  destinationDomain: number,
  isTestnet: boolean
): Promise<FeeResponse[]> {
  const baseUrl = isTestnet
    ? IRIS_API_ENDPOINTS.testnet
    : IRIS_API_ENDPOINTS.mainnet;

  const url = `${baseUrl}/v2/burn/USDC/fees/${sourceDomain}/${destinationDomain}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch fee tiers: ${response.status}`);
  }

  const data = await response.json();
  if (!Array.isArray(data)) {
    throw new Error("Invalid fee response format");
  }

  return data;
}

/**
 * Convert minimumFee from API (which can be decimal like 1.3) to scaled bigint.
 * Multiplies by BPS_PRECISION to preserve decimal places.
 */
function parseMinimumFee(minimumFee: string | number): bigint {
  const feeAsNumber =
    typeof minimumFee === "string" ? parseFloat(minimumFee) : minimumFee;
  if (Number.isNaN(feeAsNumber)) {
    throw new Error(`Invalid minimumFee value: ${minimumFee}`);
  }
  return BigInt(Math.round(feeAsNumber * Number(BPS_PRECISION)));
}

/**
 * Calculate fee for a given amount and scaled fee tier.
 * Fee is in scaled BPS (bps * BPS_PRECISION) to handle decimals.
 */
function calculateFee(amount: bigint, scaledFeeInBps: bigint): bigint {
  // Guard: fee cannot exceed 100% (10000 * BPS_PRECISION scaled bps)
  const maxScaledBps = 10000n * BPS_PRECISION;
  if (scaledFeeInBps > maxScaledBps) {
    throw new Error(
      `Invalid fee rate: ${scaledFeeInBps / BPS_PRECISION} bps exceeds 100%`
    );
  }
  // Fee = (amount * scaledBps + divisor - 1) / divisor, ceiling division
  return (amount * scaledFeeInBps + BPS_DIVISOR - 1n) / BPS_DIVISOR;
}

// =============================================================================
// Main Estimate Function
// =============================================================================

/**
 * Estimate bridge fees without wallet connection.
 *
 * @param params - Source chain, destination chain, amount, and optional speed
 * @returns BridgeEstimate with fees, received amount, and time estimate
 * @throws EstimateError if chains are unsupported or amount is invalid
 */
export async function estimateBridgeFee(
  params: EstimateParams
): Promise<BridgeEstimate> {
  const { sourceChainId, destinationChainId, amount, speed = "fast" } = params;

  // Validate amount
  if (!amount || parseFloat(amount) <= 0) {
    throw {
      code: "INVALID_AMOUNT",
      message: "Amount must be greater than 0",
    } as EstimateError;
  }

  // Resolve CCTP domains
  const sourceDomain = getCctpDomainSafe(sourceChainId);
  const destinationDomain = getCctpDomainSafe(destinationChainId);

  if (sourceDomain === null) {
    throw {
      code: "UNSUPPORTED_CHAIN",
      message: `Source chain ${sourceChainId} is not supported by CCTP`,
    } as EstimateError;
  }

  if (destinationDomain === null) {
    throw {
      code: "UNSUPPORTED_CHAIN",
      message: `Destination chain ${destinationChainId} is not supported by CCTP`,
    } as EstimateError;
  }

  const amountBigInt = parseAmount(amount);
  const isTestnet = BRIDGEKIT_ENV === "testnet";
  const chainName = getChainName(sourceChainId);

  // Standard transfer: no fees
  if (speed === "standard") {
    const timeEstimate = getFinalityEstimate(chainName, BridgeKitSpeed.SLOW);

    return {
      fees: [],
      gasFees: [],
      receivedAmount: amount,
      estimatedTime: timeEstimate?.averageTime ?? "~15 minutes",
      speed: "standard",
      sourceDomain,
      destinationDomain,
    };
  }

  // Fast transfer: fetch fee from IRIS API
  try {
    const feeTiers = await fetchFeeTiers(
      sourceDomain,
      destinationDomain,
      isTestnet
    );

    // Find fast tier (finalityThreshold === 1000)
    const fastTier = feeTiers.find((tier) => tier.finalityThreshold === 1000);

    if (!fastTier) {
      // Fast tier not available - fall back to standard
      const timeEstimate = getFinalityEstimate(chainName, BridgeKitSpeed.SLOW);

      return {
        fees: [],
        gasFees: [],
        receivedAmount: amount,
        estimatedTime: timeEstimate?.averageTime ?? "~15 minutes",
        speed: "standard",
        sourceDomain,
        destinationDomain,
      };
    }

    const scaledFeeInBps = parseMinimumFee(fastTier.minimumFee);
    const baseFee = calculateFee(amountBigInt, scaledFeeInBps);

    // Validate fee doesn't exceed amount
    if (baseFee >= amountBigInt) {
      throw {
        code: "AMOUNT_TOO_SMALL",
        message: `Amount ${amount} USDC is too small for fast transfer fees`,
      } as EstimateError;
    }

    const receivedAmount = amountBigInt - baseFee;
    const timeEstimate = getFinalityEstimate(chainName, BridgeKitSpeed.FAST);

    return {
      fees: [
        {
          amount: formatAmount(baseFee),
          type: "protocol",
        },
      ],
      gasFees: [],
      receivedAmount: formatAmount(receivedAmount),
      estimatedTime: timeEstimate?.averageTime ?? "~20 seconds",
      speed: "fast",
      sourceDomain,
      destinationDomain,
    };
  } catch (error) {
    // Re-throw EstimateError
    if ((error as EstimateError).code) {
      throw error;
    }

    throw {
      code: "NETWORK_ERROR",
      message: `Failed to fetch fee estimate: ${(error as Error).message}`,
    } as EstimateError;
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get total protocol fee from estimate.
 */
export function getTotalFee(
  estimate: BridgeEstimate | null | undefined
): number {
  if (!estimate?.fees) return 0;
  return estimate.fees.reduce((acc, fee) => acc + parseFloat(fee.amount), 0);
}

/**
 * Check if an error is an EstimateError.
 */
export function isEstimateError(error: unknown): error is EstimateError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error
  );
}
