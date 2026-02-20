"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useWalletClient } from "wagmi";
import { ChainId, isSolanaChain } from "@/lib/types";
import { createEvmPublicClient, createSolanaConnection } from "@/lib/rpc/clients";

// Polling configuration
const POLL_INTERVAL_MS = 5_000; // Poll every 5 seconds
const MAX_POLL_DURATION_MS = 60 * 1000; // Stop polling after 1 minute
const POLL_TIMEOUT_ERROR =
  "Burn confirmation is taking longer than expected. Please check your transaction status and retry if needed.";

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
  const { data: walletClient } = useWalletClient();
  const evmPublicClient = useMemo(() => {
    if (!sourceChainId || isSolanaChain(sourceChainId)) return null;
    return createEvmPublicClient(sourceChainId, { walletClient });
  }, [sourceChainId, walletClient]);
  const solanaConnection = useMemo(() => {
    if (!sourceChainId || !isSolanaChain(sourceChainId)) return null;
    return createSolanaConnection(sourceChainId);
  }, [sourceChainId]);

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

  useEffect(() => {
    startTimeRef.current = null;
    setState({
      confirmed: false,
      failed: false,
      checking: false,
      lastChecked: null,
    });
  }, [burnTxHash, sourceChainId]);

  // EVM burn polling
  const checkEvmBurn = useCallback(async () => {
    if (!burnTxHash || !evmPublicClient || isSolanaChain(sourceChainId!)) return;
    if (!isMountedRef.current) return;

    setState((prev) => ({ ...prev, checking: true }));

    try {
      const receipt = await evmPublicClient.getTransactionReceipt({
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
  }, [burnTxHash, evmPublicClient, sourceChainId]);

  // Solana burn polling
  const checkSolanaBurn = useCallback(async () => {
    if (!burnTxHash || !sourceChainId || !isSolanaChain(sourceChainId)) return;
    if (!solanaConnection) return;
    if (!isMountedRef.current) return;

    setState((prev) => ({ ...prev, checking: true }));

    try {
      const statusResult = await solanaConnection.getSignatureStatuses(
        [burnTxHash],
        { searchTransactionHistory: true }
      );
      const status = statusResult.value[0] ?? null;

      if (!isMountedRef.current) return;

      if (status) {
        if (status.err) {
          // Transaction failed
          const errorMsg = `Burn transaction failed: ${JSON.stringify(status.err)}`;
          setState({
            confirmed: false,
            failed: true,
            checking: false,
            lastChecked: new Date(),
            error: errorMsg,
          });
          onBurnFailedRef.current?.(errorMsg);
        } else if (
          status.confirmationStatus === "confirmed" ||
          status.confirmationStatus === "finalized"
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
  }, [burnTxHash, sourceChainId, solanaConnection]);

  // Main polling effect
  useEffect(() => {
    const shouldPoll =
      !disabled &&
      !state.confirmed &&
      !state.failed &&
      !!burnTxHash &&
      !!sourceChainId;

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
    const checkBurnWithTimeout = async () => {
      if (!isMountedRef.current) return;

      if (startTimeRef.current) {
        const ageMs = Date.now() - startTimeRef.current;
        if (ageMs >= MAX_POLL_DURATION_MS) {
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }

          setState((prev) => ({
            ...prev,
            confirmed: false,
            failed: true,
            checking: false,
            lastChecked: new Date(),
            error: POLL_TIMEOUT_ERROR,
          }));
          onBurnFailedRef.current?.(POLL_TIMEOUT_ERROR);
          return;
        }
      }

      await checkBurn();
    };

    // Run initial check
    void checkBurnWithTimeout();

    // Start polling
    pollingRef.current = setInterval(() => {
      void checkBurnWithTimeout();
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [
    disabled,
    state.confirmed,
    state.failed,
    burnTxHash,
    sourceChainId,
    checkEvmBurn,
    checkSolanaBurn,
  ]);

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
