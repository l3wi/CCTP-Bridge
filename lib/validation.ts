import { isAddress, parseUnits } from "viem";
import { ValidationError } from "./errors";

// Constants for validation
export const MAX_USDC_AMOUNT = parseUnits("1000000", 6); // 1M USDC
export const MIN_USDC_AMOUNT = parseUnits("0.01", 6); // 0.01 USDC
export const USDC_DECIMALS = 6;
export const MAX_DECIMAL_PLACES = 6;

export interface AmountValidation {
  isValid: boolean;
  error?: string;
  parsedAmount?: bigint;
}

export const validateAmount = (
  amountStr: string,
  balance?: bigint,
  decimals: number = USDC_DECIMALS
): AmountValidation => {
  try {
    // Clean the input string
    const cleanStr = amountStr.replace(/[^0-9.]/g, "");

    if (!cleanStr || cleanStr === "") {
      return { isValid: false, error: "Please enter an amount" };
    }

    // Check for multiple decimal points
    const decimalCount = (cleanStr.match(/\./g) || []).length;
    if (decimalCount > 1) {
      return { isValid: false, error: "Invalid number format" };
    }

    // Check decimal places
    if (cleanStr.includes(".")) {
      const decimalPart = cleanStr.split(".")[1];
      if (decimalPart && decimalPart.length > decimals) {
        return {
          isValid: false,
          error: `Maximum ${decimals} decimal places allowed`,
        };
      }
    }

    // Parse the amount
    const parsedAmount = parseUnits(cleanStr, decimals);

    // Check minimum amount
    if (parsedAmount < MIN_USDC_AMOUNT) {
      return {
        isValid: false,
        error: `Minimum amount is ${formatUnits(
          MIN_USDC_AMOUNT,
          decimals
        )} USDC`,
      };
    }

    // Check maximum amount
    if (parsedAmount > MAX_USDC_AMOUNT) {
      return {
        isValid: false,
        error: `Maximum amount is ${formatUnits(
          MAX_USDC_AMOUNT,
          decimals
        )} USDC`,
      };
    }

    // Check balance if provided
    if (balance !== undefined && parsedAmount > balance) {
      return {
        isValid: false,
        error: "Insufficient balance",
      };
    }

    return {
      isValid: true,
      parsedAmount,
    };
  } catch (error) {
    return {
      isValid: false,
      error: "Invalid amount format",
    };
  }
};

export const validateAddress = (
  address: string
): { isValid: boolean; error?: string } => {
  if (!address || address.trim() === "") {
    return { isValid: false, error: "Please enter a wallet address" };
  }

  if (!isAddress(address)) {
    return { isValid: false, error: "Please enter a valid wallet address" };
  }

  return { isValid: true };
};

export const validateChainSelection = (
  sourceChain?: number,
  targetChain?: number
): { isValid: boolean; error?: string } => {
  if (!targetChain) {
    return { isValid: false, error: "Please select a destination chain" };
  }

  if (sourceChain === targetChain) {
    return {
      isValid: false,
      error: "Source and destination chains cannot be the same",
    };
  }

  return { isValid: true };
};

export interface BridgeValidation {
  isValid: boolean;
  errors: string[];
  data?: {
    amount: bigint;
    targetChain: number;
    targetAddress: `0x${string}`;
  };
}

export const validateBridgeParams = (params: {
  amount?: { str: string; bigInt: bigint } | null;
  targetChain?: number | null;
  targetAddress?: string;
  sourceChain?: number;
  balance?: bigint;
  isCustomAddress?: boolean;
  userAddress?: `0x${string}`;
}): BridgeValidation => {
  const errors: string[] = [];

  // Validate amount
  if (!params.amount || params.amount.bigInt === BigInt(0)) {
    errors.push("Please enter an amount");
  } else {
    const amountValidation = validateAmount(params.amount.str, params.balance);
    if (!amountValidation.isValid && amountValidation.error) {
      errors.push(amountValidation.error);
    }
  }

  // Validate chain selection
  const chainValidation = validateChainSelection(
    params.sourceChain,
    params.targetChain || undefined
  );
  if (!chainValidation.isValid && chainValidation.error) {
    errors.push(chainValidation.error);
  }

  // Validate target address
  let finalTargetAddress = params.userAddress;
  if (params.isCustomAddress && params.targetAddress) {
    const addressValidation = validateAddress(params.targetAddress);
    if (!addressValidation.isValid && addressValidation.error) {
      errors.push(addressValidation.error);
    } else {
      finalTargetAddress = params.targetAddress as `0x${string}`;
    }
  }

  if (!finalTargetAddress) {
    errors.push("Target address is required");
  }

  const isValid = errors.length === 0;

  return {
    isValid,
    errors,
    data:
      isValid && params.amount && params.targetChain && finalTargetAddress
        ? {
            amount: params.amount.bigInt,
            targetChain: params.targetChain,
            targetAddress: finalTargetAddress,
          }
        : undefined,
  };
};

// Helper function to format units (since we're using it)
const formatUnits = (value: bigint, decimals: number): string => {
  let divisor = BigInt(1);
  for (let i = 0; i < decimals; i++) {
    divisor = divisor * BigInt(10);
  }
  const quotient = value / divisor;
  const remainder = value % divisor;

  if (remainder === BigInt(0)) {
    return quotient.toString();
  }

  const remainderStr = remainder.toString().padStart(decimals, "0");
  const trimmedRemainder = remainderStr.replace(/0+$/, "");

  return `${quotient}.${trimmedRemainder}`;
};
