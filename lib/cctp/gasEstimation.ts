/**
 * Gas estimation utilities for CCTP mint transactions.
 * Provides dynamic gas cost estimation for both EVM and Solana.
 * Used to check user balance before attempting mint to avoid wallet warnings.
 */

import type { Connection, VersionedTransaction, Transaction } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import type { PublicClient } from "viem";
import { encodeFunctionData } from "viem";
import { MESSAGE_TRANSMITTER_ABI } from "../contracts";
import { getSolanaUsdcMint } from "./shared";
import type { SolanaChainId } from "./types";

// =============================================================================
// Constants
// =============================================================================

/**
 * ATA rent exemption in lamports - fixed by Solana runtime.
 * This is the minimum balance required for a token account.
 */
const ATA_RENT_LAMPORTS = BigInt(2_039_280); // ~0.00204 SOL

/**
 * Gas buffer ratios to account for price fluctuation between estimate and execution.
 * Uses BigInt fractions to avoid precision loss with large values.
 * - EVM: 20% buffer (6/5 = 1.2x) - gas prices can fluctuate
 * - Solana: 50% buffer (3/2 = 1.5x) - priority fees and computation units can vary
 */
const EVM_BUFFER_NUMERATOR = 6n;
const EVM_BUFFER_DENOMINATOR = 5n; // 6/5 = 1.2x
const SOL_BUFFER_NUMERATOR = 3n;
const SOL_BUFFER_DENOMINATOR = 2n; // 3/2 = 1.5x

/**
 * Apply buffer to a bigint value using ceiling division.
 * Formula: ceil(value * numerator / denominator) = (value * numerator + denominator - 1) / denominator
 */
function applyBuffer(value: bigint, numerator: bigint, denominator: bigint): bigint {
  return (value * numerator + denominator - 1n) / denominator;
}

/**
 * Fallback fee values when estimation fails.
 * These are conservative estimates to ensure transactions don't fail.
 */
const SOLANA_FALLBACK_FEE_LAMPORTS = BigInt(10_000); // 0.00001 SOL (typical ~5000)

// =============================================================================
// Types
// =============================================================================

/**
 * Result of gas estimation.
 */
export interface GasEstimate {
  /** Minimum balance needed (includes buffer) */
  required: bigint;
  /** User's current balance */
  current: bigint;
  /** Whether balance >= required */
  sufficient: boolean;
  /** Breakdown of costs */
  breakdown: {
    /** Transaction/gas fee */
    txFee: bigint;
    /** ATA rent (Solana only, if needed) */
    ataCreation?: bigint;
  };
}

// =============================================================================
// Solana Gas Estimation
// =============================================================================

/**
 * Estimate Solana gas cost for receiveMessage transaction.
 * Uses actual transaction to compute accurate fees.
 *
 * @param connection - Solana connection
 * @param userPubkey - User's wallet public key
 * @param transaction - The built transaction (versioned or legacy)
 * @param destinationChainId - Solana chain identifier
 * @param userBalance - User's current SOL balance in lamports
 */
export async function estimateSolanaMintGas(params: {
  connection: Connection;
  userPubkey: PublicKey;
  transaction: VersionedTransaction | Transaction;
  destinationChainId: SolanaChainId;
  userBalance: bigint;
}): Promise<GasEstimate> {
  const { connection, userPubkey, transaction, destinationChainId, userBalance } = params;

  // Get transaction fee from network
  let txFee: bigint;
  try {
    // Check if versioned transaction
    if ("version" in transaction) {
      const feeResult = await connection.getFeeForMessage(transaction.message);
      txFee = BigInt(feeResult.value || 5000);
    } else {
      // Legacy transaction - use compileMessage
      const message = transaction.compileMessage();
      const feeResult = await connection.getFeeForMessage(message);
      txFee = BigInt(feeResult.value || 5000);
    }
  } catch {
    // Fallback to conservative estimate
    txFee = SOLANA_FALLBACK_FEE_LAMPORTS;
  }

  // Check if ATA needs creation
  const needsAtaCreation = await checkAtaNeedsCreation(
    connection,
    userPubkey,
    destinationChainId
  );

  // Calculate total cost
  const ataCreation = needsAtaCreation ? ATA_RENT_LAMPORTS : BigInt(0);
  const baseCost = txFee + ataCreation;
  const requiredWithBuffer = applyBuffer(baseCost, SOL_BUFFER_NUMERATOR, SOL_BUFFER_DENOMINATOR);

  return {
    required: requiredWithBuffer,
    current: userBalance,
    sufficient: userBalance >= requiredWithBuffer,
    breakdown: {
      txFee,
      ataCreation: needsAtaCreation ? ATA_RENT_LAMPORTS : undefined,
    },
  };
}

/**
 * Check if user's USDC ATA needs to be created.
 * Returns true if ATA doesn't exist.
 */
async function checkAtaNeedsCreation(
  connection: Connection,
  userPubkey: PublicKey,
  destinationChainId: SolanaChainId
): Promise<boolean> {
  try {
    const usdcMint = getSolanaUsdcMint(destinationChainId);
    const ataAddress = await getAssociatedTokenAddress(usdcMint, userPubkey);
    const ataInfo = await connection.getAccountInfo(ataAddress);
    return ataInfo === null;
  } catch {
    // Assume needs creation on error (conservative)
    return true;
  }
}

// =============================================================================
// EVM Gas Estimation
// =============================================================================

/**
 * Estimate EVM gas cost for receiveMessage transaction.
 * Uses eth_estimateGas with actual call data for accurate estimation.
 *
 * @param publicClient - Viem public client for destination chain
 * @param userAddress - User's wallet address
 * @param messageTransmitter - MessageTransmitter contract address
 * @param message - CCTP message bytes
 * @param attestation - Attestation bytes
 * @param userBalance - User's current native balance in wei
 */
export async function estimateEvmMintGas(params: {
  publicClient: PublicClient;
  userAddress: `0x${string}`;
  messageTransmitter: `0x${string}`;
  message: `0x${string}`;
  attestation: `0x${string}`;
  userBalance: bigint;
}): Promise<GasEstimate> {
  const {
    publicClient,
    userAddress,
    messageTransmitter,
    message,
    attestation,
    userBalance,
  } = params;

  // Encode the receiveMessage call data
  const data = encodeFunctionData({
    abi: MESSAGE_TRANSMITTER_ABI,
    functionName: "receiveMessage",
    args: [message, attestation],
  });

  // Estimate gas units
  const gasEstimate = await publicClient.estimateGas({
    account: userAddress,
    to: messageTransmitter,
    data,
  });

  // Get current gas price
  const gasPrice = await publicClient.getGasPrice();

  // Calculate total cost with buffer
  const baseCost = gasEstimate * gasPrice;
  const requiredWithBuffer = applyBuffer(baseCost, EVM_BUFFER_NUMERATOR, EVM_BUFFER_DENOMINATOR);

  return {
    required: requiredWithBuffer,
    current: userBalance,
    sufficient: userBalance >= requiredWithBuffer,
    breakdown: {
      txFee: requiredWithBuffer,
    },
  };
}

// =============================================================================
// Formatting Utilities
// =============================================================================

/**
 * Format lamports to SOL with reasonable precision.
 * @param lamports - Amount in lamports
 * @returns Formatted string (e.g., "0.00307")
 */
export function formatSol(lamports: bigint): string {
  const sol = Number(lamports) / 1_000_000_000;
  // Use enough decimal places to show the amount, but not excessive
  if (sol < 0.0001) {
    return sol.toFixed(6);
  } else if (sol < 0.01) {
    return sol.toFixed(5);
  } else {
    return sol.toFixed(4);
  }
}

/**
 * Format wei to ETH/native token with reasonable precision.
 * @param wei - Amount in wei
 * @param decimals - Token decimals (default: 18)
 * @returns Formatted string (e.g., "0.00015")
 */
export function formatNative(wei: bigint, decimals = 18): string {
  const divisor = 10 ** decimals;
  const amount = Number(wei) / divisor;
  // Use enough decimal places to show the amount
  if (amount < 0.0001) {
    return amount.toFixed(6);
  } else if (amount < 0.01) {
    return amount.toFixed(5);
  } else {
    return amount.toFixed(4);
  }
}
