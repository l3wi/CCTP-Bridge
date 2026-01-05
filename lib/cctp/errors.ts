/**
 * CCTP error handling utilities.
 * Provides consistent error handling across burn and mint operations.
 */

import type { BurnResult, MintResult } from "./types";
import { isUserRejection, extractErrorMessage } from "./shared";

// =============================================================================
// Error Codes
// =============================================================================

export type BridgeErrorCode =
  | "USER_REJECTED"
  | "INSUFFICIENT_BALANCE"
  | "INSUFFICIENT_GAS"
  | "CHAIN_NOT_SUPPORTED"
  | "CONTRACT_ERROR"
  | "ATTESTATION_PENDING"
  | "ATTESTATION_FAILED"
  | "NONCE_ALREADY_USED"
  | "SIMULATION_FAILED"
  | "NETWORK_ERROR"
  | "UNKNOWN_ERROR";

// =============================================================================
// Error Class
// =============================================================================

/**
 * Custom error class for bridge operations.
 * Includes error code and phase for better error handling.
 */
export class BridgeError extends Error {
  constructor(
    message: string,
    public readonly code: BridgeErrorCode,
    public readonly phase: "approval" | "burn" | "attestation" | "mint"
  ) {
    super(message);
    this.name = "BridgeError";
  }
}

// =============================================================================
// Error Detection
// =============================================================================

/**
 * Detect if error indicates insufficient balance
 */
export function isInsufficientBalance(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();

  return (
    lowerMessage.includes("insufficient funds") ||
    lowerMessage.includes("insufficient balance") ||
    lowerMessage.includes("exceeds balance") ||
    lowerMessage.includes("not enough")
  );
}

/**
 * Detect if error indicates insufficient gas
 */
export function isInsufficientGas(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();

  return (
    lowerMessage.includes("insufficient gas") ||
    lowerMessage.includes("gas too low") ||
    lowerMessage.includes("out of gas") ||
    lowerMessage.includes("intrinsic gas too low")
  );
}

/**
 * Detect if error indicates nonce already used (mint already executed)
 */
export function isNonceAlreadyUsed(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();

  return (
    lowerMessage.includes("nonce already used") ||
    lowerMessage.includes("already claimed") ||
    lowerMessage.includes("already minted") ||
    lowerMessage.includes("message already received")
  );
}

/**
 * Get appropriate error code from error
 */
export function getErrorCode(error: unknown): BridgeErrorCode {
  if (isUserRejection(error)) return "USER_REJECTED";
  if (isInsufficientBalance(error)) return "INSUFFICIENT_BALANCE";
  if (isInsufficientGas(error)) return "INSUFFICIENT_GAS";
  if (isNonceAlreadyUsed(error)) return "NONCE_ALREADY_USED";
  return "UNKNOWN_ERROR";
}

// =============================================================================
// Error Handlers
// =============================================================================

/**
 * Handle errors from burn operations.
 * Returns consistent BurnResult with appropriate error message.
 */
export function handleBurnError(
  error: unknown,
  phase: "approval" | "burn"
): BurnResult {
  const code = getErrorCode(error);
  const message = extractErrorMessage(error);

  // User-friendly messages based on error code
  if (code === "USER_REJECTED") {
    return {
      success: false,
      error: phase === "approval"
        ? "Approval cancelled by user"
        : "Transaction cancelled by user",
    };
  }

  if (code === "INSUFFICIENT_BALANCE") {
    return {
      success: false,
      error: "Insufficient USDC balance",
    };
  }

  if (code === "INSUFFICIENT_GAS") {
    return {
      success: false,
      error: "Insufficient gas for transaction",
    };
  }

  // Generic error with original message
  return {
    success: false,
    error: `${phase === "approval" ? "Approval" : "Burn"} failed: ${message}`,
  };
}

// =============================================================================
// Error Formatting
// =============================================================================

/**
 * Format error for display in toast notifications.
 * Returns a short, user-friendly message.
 */
export function formatErrorForToast(error: unknown): string {
  if (isUserRejection(error)) {
    return "Transaction cancelled";
  }

  if (isInsufficientBalance(error)) {
    return "Insufficient balance";
  }

  if (isInsufficientGas(error)) {
    return "Insufficient gas";
  }

  if (isNonceAlreadyUsed(error)) {
    return "Already claimed";
  }

  // For unknown errors, extract a short message
  return extractErrorMessage(error, 50);
}

/**
 * Wrap an async operation with consistent error handling.
 * Useful for wrapping contract calls.
 */
export async function withErrorHandling<T>(
  operation: () => Promise<T>,
  phase: "approval" | "burn" | "attestation" | "mint"
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const code = getErrorCode(error);
    const message = extractErrorMessage(error);
    throw new BridgeError(message, code, phase);
  }
}

// =============================================================================
// Legacy Error Message Extraction (for backward compatibility)
// =============================================================================

/**
 * Extract a user-friendly error message from any error type.
 * Handles viem errors, common blockchain errors, and generic errors.
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof BridgeError) {
    return error.message;
  }

  // Handle viem errors - check for shortMessage property
  if (
    error &&
    typeof error === "object" &&
    "shortMessage" in error &&
    typeof (error as { shortMessage?: string }).shortMessage === "string"
  ) {
    return (error as { shortMessage: string }).shortMessage;
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // Handle common blockchain errors with user-friendly messages
    if (message.includes("user rejected") || message.includes("user denied")) {
      return "Transaction was cancelled by user";
    }
    if (message.includes("insufficient funds")) {
      return "Insufficient funds for transaction";
    }
    if (message.includes("gas required exceeds") || message.includes("out of gas")) {
      return "Transaction failed due to insufficient gas";
    }
    if (message.includes("nonce too low") || message.includes("nonce has already been used")) {
      return "Transaction nonce conflict - please try again";
    }
    if (message.includes("replacement transaction underpriced")) {
      return "Gas price too low - increase gas and retry";
    }
    if (message.includes("execution reverted")) {
      return "Transaction reverted by contract";
    }
    if (message.includes("timeout") || message.includes("timed out")) {
      return "Request timed out - please try again";
    }

    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "An unexpected error occurred";
}
