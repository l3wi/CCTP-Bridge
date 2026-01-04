import { BaseError as ViemBaseError } from "viem";

export class BridgeError extends Error {
  constructor(message: string, public code: string, public details?: any) {
    super(message);
    this.name = "BridgeError";
  }
}

export class ValidationError extends BridgeError {
  constructor(message: string, details?: any) {
    super(message, "VALIDATION_ERROR", details);
    this.name = "ValidationError";
  }
}

export class TransactionError extends BridgeError {
  constructor(message: string, details?: any) {
    super(message, "TRANSACTION_ERROR", details);
    this.name = "TransactionError";
  }
}

export class NetworkError extends BridgeError {
  constructor(message: string, details?: any) {
    super(message, "NETWORK_ERROR", details);
    this.name = "NetworkError";
  }
}

export const ERROR_MESSAGES = {
  INVALID_AMOUNT: "Please enter a valid amount",
  AMOUNT_TOO_LARGE: "Amount exceeds maximum limit",
  AMOUNT_TOO_SMALL: "Amount is too small",
  INVALID_ADDRESS: "Please enter a valid wallet address",
  INSUFFICIENT_BALANCE: "Insufficient balance for this transaction",
  UNSUPPORTED_CHAIN: "This chain is not supported",
  TRANSACTION_FAILED: "Transaction failed. Please try again.",
  NETWORK_ERROR: "Network error. Please check your connection.",
  APPROVAL_FAILED: "Token approval failed",
  BRIDGE_FAILED: "Bridge transaction failed",
  CLAIM_FAILED: "Claim transaction failed",
  ATTESTATION_TIMEOUT: "Attestation is taking longer than expected",
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export const getErrorMessage = (error: unknown): string => {
  if (error instanceof BridgeError) {
    return error.message;
  }

  // Handle viem errors - extract shortMessage if available
  if (error instanceof ViemBaseError) {
    return error.shortMessage || error.message;
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // Handle common blockchain errors
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
};

export const retryWithExponentialBackoff = async <T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> => {
  let lastError: Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unknown error");

      if (attempt === maxRetries) {
        throw new NetworkError(
          `Failed after ${maxRetries + 1} attempts: ${lastError.message}`,
          { originalError: lastError, attempts: attempt + 1 }
        );
      }

      const delay = baseDelay * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
};

export interface RetryConfig {
  maxRetries?: number;
  baseDelay?: number;
  shouldRetry?: (error: unknown) => boolean;
}

export const withRetry = <T>(
  fn: () => Promise<T>,
  config: RetryConfig = {}
): Promise<T> => {
  const { maxRetries = 3, baseDelay = 1000, shouldRetry = () => true } = config;

  return retryWithExponentialBackoff(
    async () => {
      try {
        return await fn();
      } catch (error) {
        if (!shouldRetry(error)) {
          throw error;
        }
        throw error;
      }
    },
    maxRetries,
    baseDelay
  );
};
