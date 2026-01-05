"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { usePublicClient } from "wagmi";
import { ChainId, isSolanaChain } from "@/lib/types";
import { createSolanaConnection } from "@/lib/solanaAdapter";

// Polling configuration
const POLL_INTERVAL_MS = 5_000; // Poll every 5 seconds
const MAX_POLL_DURATION_MS = 60 * 1000; // Stop polling after 1 minute

export interface BurnPollingState {
  confirmed: boolean;
  failed: boolean;
  checking: boolean;
  lastChecked: Date | null;
  error?: string;
}

interface UseBurnPollingParams {
  burnTxHash: string | null;
  sourceChainId: ChainId | undefined;
  onBurnConfirmed?: () => void;
  onBurnFailed?: (error: string) => void;
  /** Set to true to disable polling (e.g., when burn already confirmed) */
  disabled?: boolean;
}

/**
 * Polls burn transaction status on both EVM and Solana chains.
 * Detects if burn transaction was confirmed or failed.
 *
 * - EVM: Uses getTransactionReceipt to check status
 * - Solana: Uses getSignatureStatus to check status
 */
export function useBurnPolling({
  burnTxHash,
  sourceChainId,
  onBurnConfirmed,
  onBurnFailed,
  disabled = false,
}: UseBurnPollingParams) {
  const publicClient = usePublicClient();

  const [state, setState] = useState<BurnPollingState>({
    confirmed: false,
    failed: false,
    checking: false,
    lastChecked: null,
  });

  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);
  const startTimeRef = useRef<number | null>(null);

  // Refs for callbacks to avoid stale closures
  const onBurnConfirmedRef = useRef(onBurnConfirmed);
  const onBurnFailedRef = useRef(onBurnFailed);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Keep callback refs in sync
  useEffect(() => {
    onBurnConfirmedRef.current = onBurnConfirmed;
    onBurnFailedRef.current = onBurnFailed;
  }, [onBurnConfirmed, onBurnFailed]);

  // Determine if we should poll
  const shouldPoll = useMemo(() => {
    if (disabled) return false;
    if (state.confirmed || state.failed) return false;
    if (!burnTxHash || !sourceChainId) return false;

    // Check if we've exceeded max poll duration
    if (startTimeRef.current) {
      const ageMs = Date.now() - startTimeRef.current;
      if (ageMs >= MAX_POLL_DURATION_MS) return false;
    }

    return true;
  }, [disabled, state.confirmed, state.failed, burnTxHash, sourceChainId]);

  // EVM burn polling
  const checkEvmBurn = useCallback(async () => {
    if (!burnTxHash || !publicClient || isSolanaChain(sourceChainId!)) return;
    if (!isMountedRef.current) return;

    setState((prev) => ({ ...prev, checking: true }));

    try {
      const receipt = await publicClient.getTransactionReceipt({
        hash: burnTxHash as `0x${string}`,
      });

      if (!isMountedRef.current) return;

      if (receipt) {
        if (receipt.status === "success") {
          setState({
            confirmed: true,
            failed: false,
            checking: false,
            lastChecked: new Date(),
          });
          onBurnConfirmedRef.current?.();
        } else if (receipt.status === "reverted") {
          const errorMsg = "Burn transaction reverted on-chain";
          setState({
            confirmed: false,
            failed: true,
            checking: false,
            lastChecked: new Date(),
            error: errorMsg,
          });
          onBurnFailedRef.current?.(errorMsg);
        }
      } else {
        // Receipt not available yet, continue polling
        setState((prev) => ({
          ...prev,
          checking: false,
          lastChecked: new Date(),
        }));
      }
    } catch (error) {
      if (!isMountedRef.current) return;
      console.error("EVM burn status check failed:", error);
      setState((prev) => ({
        ...prev,
        checking: false,
        lastChecked: new Date(),
      }));
    }
  }, [burnTxHash, publicClient, sourceChainId]);

  // Solana burn polling
  const checkSolanaBurn = useCallback(async () => {
    if (!burnTxHash || !sourceChainId || !isSolanaChain(sourceChainId)) return;
    if (!isMountedRef.current) return;

    setState((prev) => ({ ...prev, checking: true }));

    try {
      const connection = createSolanaConnection(sourceChainId);
      const status = await connection.getSignatureStatus(burnTxHash);

      if (!isMountedRef.current) return;

      if (status?.value) {
        if (status.value.err) {
          // Transaction failed
          const errorMsg = `Burn transaction failed: ${JSON.stringify(status.value.err)}`;
          setState({
            confirmed: false,
            failed: true,
            checking: false,
            lastChecked: new Date(),
            error: errorMsg,
          });
          onBurnFailedRef.current?.(errorMsg);
        } else if (
          status.value.confirmationStatus === "confirmed" ||
          status.value.confirmationStatus === "finalized"
        ) {
          // Transaction confirmed
          setState({
            confirmed: true,
            failed: false,
            checking: false,
            lastChecked: new Date(),
          });
          onBurnConfirmedRef.current?.();
        } else {
          // Still processing
          setState((prev) => ({
            ...prev,
            checking: false,
            lastChecked: new Date(),
          }));
        }
      } else {
        // Status not available yet, continue polling
        setState((prev) => ({
          ...prev,
          checking: false,
          lastChecked: new Date(),
        }));
      }
    } catch (error) {
      if (!isMountedRef.current) return;
      console.error("Solana burn status check failed:", error);
      setState((prev) => ({
        ...prev,
        checking: false,
        lastChecked: new Date(),
      }));
    }
  }, [burnTxHash, sourceChainId]);

  // Main polling effect
  useEffect(() => {
    if (!shouldPoll) {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }

    // Initialize start time
    if (!startTimeRef.current) {
      startTimeRef.current = Date.now();
    }

    const checkBurn = isSolanaChain(sourceChainId!) ? checkSolanaBurn : checkEvmBurn;

    // Run initial check
    checkBurn();

    // Start polling
    pollingRef.current = setInterval(checkBurn, POLL_INTERVAL_MS);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [shouldPoll, sourceChainId, checkEvmBurn, checkSolanaBurn]);

  // Reset function for new transactions
  const reset = useCallback(() => {
    setState({
      confirmed: false,
      failed: false,
      checking: false,
      lastChecked: null,
    });
    startTimeRef.current = null;
  }, []);

  return {
    ...state,
    reset,
  };
}
