import { useState, useEffect, useRef } from "react";
import { validateAddress, validateUniversalAddress } from "@/lib/validation";
import type { ChainType } from "@/lib/types";

interface AddressValidationState {
  isValid: boolean;
  error?: string;
  isValidating: boolean;
}

/**
 * Hook for debounced address validation with real-time feedback.
 * Provides validation state after a configurable delay to avoid
 * excessive validation calls while the user is typing.
 *
 * @param address - The address to validate
 * @param chainType - Optional chain type for cross-chain validation ("evm" or "solana")
 * @param debounceMs - Debounce delay in milliseconds (default: 300)
 */
export function useDebouncedAddressValidation(
  address: string | undefined,
  chainType: ChainType | null | undefined = null,
  debounceMs: number = 300
): AddressValidationState {
  // Normalize chainType to ensure consistent dependency tracking
  const normalizedChainType = chainType ?? null;

  const [validation, setValidation] = useState<AddressValidationState>({
    isValid: false,
    isValidating: false,
  });
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    // Clear any pending timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    // If address is empty or undefined, reset to invalid without error
    if (!address || address.trim() === "") {
      setValidation({ isValid: false, isValidating: false });
      return;
    }

    // Start validating state
    setValidation((prev) => ({ ...prev, isValidating: true }));

    // Debounce the validation
    timeoutRef.current = setTimeout(() => {
      if (!mountedRef.current) return;

      // Use chain-aware validation if chainType is provided
      const result = normalizedChainType
        ? validateUniversalAddress(address, normalizedChainType)
        : validateAddress(address);
      setValidation({
        isValid: result.isValid,
        error: result.error,
        isValidating: false,
      });
    }, debounceMs);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [address, normalizedChainType, debounceMs]);

  return validation;
}
