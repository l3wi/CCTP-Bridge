import { useState, useEffect, useRef } from "react";
import { validateAddress } from "@/lib/validation";

interface AddressValidationState {
  isValid: boolean;
  error?: string;
  isValidating: boolean;
}

/**
 * Hook for debounced address validation with real-time feedback.
 * Provides validation state after a configurable delay to avoid
 * excessive validation calls while the user is typing.
 */
export function useDebouncedAddressValidation(
  address: string | undefined,
  debounceMs = 300
): AddressValidationState {
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

      const result = validateAddress(address);
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
  }, [address, debounceMs]);

  return validation;
}
