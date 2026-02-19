"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { BridgeResult } from "@circle-fin/bridge-kit";
import { ChainId, isSolanaChain } from "@/lib/types";
import { checkMintReadiness } from "@/lib/simulation";
import { fetchAttestationUniversal, requestReattestation } from "@/lib/iris";
import { useTransactionStore } from "@/lib/store/transactionStore";
import { useToast } from "@/components/ui/use-toast";
import { resolveEstimatedTimeLabel } from "@/lib/estimatedTime";

// Polling configuration
const MAX_POLL_DURATION_MS = 60 * 60 * 1000; // Stop polling after 1 hour
const EVM_MINT_POLL_INTERVAL_MS = 5_000; // Fast transfers target sub-minute UX; keep EVM readiness checks responsive
const SOLANA_POLL_INTERVAL_MS = 15_000; // Solana attestations settle slower; avoid over-polling Iris
const REATTEST_POLL_INTERVAL_MS = 15_000; // Poll every 15 seconds while awaiting re-attestation

export interface MintPollingState {
  canMint: boolean;
  alreadyMinted: boolean;
  attestationReady: boolean;
  checking: boolean;
  lastChecked: Date | null;
  error?: string;
  /** Reason for delayed attestation (e.g., "insufficient_fee") - indicates standard speed fallback */
  delayReason?: string;
  /** True if the message attestation has expired and needs re-signing */
  messageExpired?: boolean;
  /** The nonce for the message (needed for re-attestation) */
  nonce?: string;
}

interface UseMintPollingParams {
  burnTxHash: string | null;
  sourceChainId: ChainId | undefined;
  destinationChainId: ChainId | undefined;
  burnCompletedAt: Date | null;
  startedAt: Date | undefined;
  isSuccess: boolean;
  hasBurnCompleted: boolean;
  hasFetchAttestation: boolean;
  displaySteps: BridgeResult["steps"];
  onStepsUpdate: (steps: BridgeResult["steps"]) => void;
}

/**
 * Handles polling for mint readiness on both EVM and Solana destinations.
 * - EVM: Uses contract simulation via checkMintReadiness
 * - Solana: Polls Iris API for attestation status
 *
 * When a message expires, automatically requests re-attestation and polls
 * for the fresh attestation every 15 seconds.
 */
export function useMintPolling({
  burnTxHash,
  sourceChainId,
  destinationChainId,
  burnCompletedAt,
  startedAt,
  isSuccess,
  hasBurnCompleted,
  hasFetchAttestation,
  displaySteps,
  onStepsUpdate,
}: UseMintPollingParams) {
  const { updateTransaction } = useTransactionStore();
  const { toast } = useToast();

  const [mintSimulation, setMintSimulation] = useState<MintPollingState>({
    canMint: false,
    alreadyMinted: false,
    checking: false,
    attestationReady: false,
    lastChecked: null,
    delayReason: undefined,
    messageExpired: false,
    nonce: undefined,
  });

  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const solanaPollingRef = useRef<NodeJS.Timeout | null>(null);
  const reattestPollingRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);

  // Track re-attestation state
  const [isReattesting, setIsReattesting] = useState(false);
  const [isAwaitingReattestation, setIsAwaitingReattestation] = useState(false);
  // Guard against duplicate auto-reattest triggers
  const reattestTriggeredRef = useRef(false);

  const isDocumentVisible = useCallback(
    () =>
      typeof document === "undefined" || document.visibilityState === "visible",
    []
  );

  // Refs to avoid stale closures in polling intervals
  const displayStepsRef = useRef<BridgeResult["steps"]>(displaySteps);
  const onStepsUpdateRef = useRef(onStepsUpdate);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Keep refs in sync with latest values
  useEffect(() => {
    displayStepsRef.current = displaySteps;
    onStepsUpdateRef.current = onStepsUpdate;
  }, [displaySteps, onStepsUpdate]);

  // Check if we should poll EVM destinations
  const shouldPollEvm = useMemo(() => {
    if (isSuccess) return false;
    if (mintSimulation.alreadyMinted) return false;
    if (mintSimulation.attestationReady || mintSimulation.canMint) return false;
    if (hasFetchAttestation) return false;
    // Stop polling when message is expired - auto-reattest will handle it
    if (mintSimulation.messageExpired) return false;
    if (isAwaitingReattestation) return false;
    if (!burnTxHash || !sourceChainId || !destinationChainId) return false;

    // EVM polling only for EVM destinations
    if (isSolanaChain(destinationChainId)) return false;

    const referenceTime = burnCompletedAt ?? startedAt;
    if (!referenceTime) return false;

    const ageMs = Date.now() - referenceTime.getTime();
    if (ageMs >= MAX_POLL_DURATION_MS) return false;

    return true;
  }, [
    isSuccess,
    mintSimulation.alreadyMinted,
    mintSimulation.attestationReady,
    mintSimulation.canMint,
    hasFetchAttestation,
    mintSimulation.messageExpired,
    isAwaitingReattestation,
    burnTxHash,
    sourceChainId,
    destinationChainId,
    burnCompletedAt,
    startedAt,
  ]);

  // Check if we should poll Solana attestation
  const shouldPollSolana = useMemo(() => {
    if (isSuccess) return false;
    if (!burnTxHash || !sourceChainId || !destinationChainId) return false;

    // Only poll for Solana destinations
    if (!isSolanaChain(destinationChainId)) return false;

    // Don't poll if burn hasn't completed
    if (!hasBurnCompleted) return false;

    // Don't poll if attestation already fetched
    if (hasFetchAttestation) return false;

    // While re-attestation is in progress, a dedicated poller handles Iris checks.
    if (mintSimulation.messageExpired || isAwaitingReattestation) return false;

    if (mintSimulation.attestationReady) return false;

    const referenceTime = burnCompletedAt ?? startedAt;
    if (!referenceTime) return false;

    const ageMs = Date.now() - referenceTime.getTime();
    if (ageMs >= MAX_POLL_DURATION_MS) return false;

    return true;
  }, [
    isSuccess,
    burnTxHash,
    sourceChainId,
    destinationChainId,
    hasBurnCompleted,
    hasFetchAttestation,
    mintSimulation.messageExpired,
    mintSimulation.attestationReady,
    isAwaitingReattestation,
    burnCompletedAt,
    startedAt,
  ]);

  // =========================================================================
  // Auto re-attestation: when messageExpired is set, automatically request
  // re-attestation and start polling for the new attestation.
  // =========================================================================
  useEffect(() => {
    if (
      !mintSimulation.messageExpired ||
      !mintSimulation.nonce ||
      !sourceChainId ||
      reattestTriggeredRef.current
    ) {
      return;
    }

    // Mark as triggered so we don't fire again
    reattestTriggeredRef.current = true;

    const doReattest = async () => {
      if (!isMountedRef.current) return;

      setIsReattesting(true);

      toast({
        title: "Attestation expired",
        description: "Automatically requesting a new attestation from Circle…",
      });

      try {
        const result = await requestReattestation(sourceChainId, mintSimulation.nonce!);

        if (!isMountedRef.current) return;

        if (result.success) {
          toast({
            title: "Re-attestation requested",
            description: "Waiting for Circle to process. This may take a minute…",
          });
          setIsAwaitingReattestation(true);
        } else {
          toast({
            title: "Re-attestation failed",
            description: result.error || "Please try claiming again in a few minutes.",
            variant: "destructive",
          });
          // Allow retry by resetting the guard
          reattestTriggeredRef.current = false;
        }
      } catch (error) {
        if (!isMountedRef.current) return;
        const msg = error instanceof Error ? error.message : String(error);
        toast({
          title: "Re-attestation failed",
          description: msg,
          variant: "destructive",
        });
        reattestTriggeredRef.current = false;
      } finally {
        if (isMountedRef.current) {
          setIsReattesting(false);
        }
      }
    };

    doReattest();
  }, [mintSimulation.messageExpired, mintSimulation.nonce, sourceChainId, toast]);

  // =========================================================================
  // Poll for new attestation after re-attestation request
  // =========================================================================
  useEffect(() => {
    if (!isAwaitingReattestation || !burnTxHash || !sourceChainId) {
      if (reattestPollingRef.current) {
        clearInterval(reattestPollingRef.current);
        reattestPollingRef.current = null;
      }
      return;
    }

    const pollForNewAttestation = async () => {
      if (!isMountedRef.current || !burnTxHash || !sourceChainId) return;
      if (!isDocumentVisible()) return;

      try {
        const result = await fetchAttestationUniversal(sourceChainId, burnTxHash);

        if (!isMountedRef.current) return;

        if (result?.status === "complete") {
          // Fresh attestation is ready — reset expired state and re-enable claim
          setIsAwaitingReattestation(false);
          reattestTriggeredRef.current = false;

          setMintSimulation((prev) => ({
            ...prev,
            messageExpired: false,
            error: undefined,
            canMint: true,
            attestationReady: true,
          }));

          // Update steps
          const currentSteps = displayStepsRef.current ?? [];
          const updatedSteps = currentSteps.map((step) => {
            if (/attestation|attest/i.test(step.name)) {
              return { ...step, state: "success" as const };
            }
            return step;
          });
          if (burnTxHash) {
            updateTransaction(burnTxHash, { steps: updatedSteps });
          }
          onStepsUpdateRef.current?.(updatedSteps);

          toast({
            title: "New attestation ready",
            description: "You can now claim your USDC.",
          });

          // Stop polling
          if (reattestPollingRef.current) {
            clearInterval(reattestPollingRef.current);
            reattestPollingRef.current = null;
          }
        }
      } catch (error) {
        console.error("Re-attestation poll failed:", error);
      }
    };

    // First check immediately, then every 15s
    pollForNewAttestation();
    reattestPollingRef.current = setInterval(pollForNewAttestation, REATTEST_POLL_INTERVAL_MS);

    return () => {
      if (reattestPollingRef.current) {
        clearInterval(reattestPollingRef.current);
        reattestPollingRef.current = null;
      }
    };
  }, [
    isAwaitingReattestation,
    burnTxHash,
    sourceChainId,
    updateTransaction,
    toast,
    isDocumentVisible,
  ]);

  // EVM polling effect
  useEffect(() => {
    if (!shouldPollEvm) {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }

    const checkMint = async () => {
      if (!burnTxHash || !sourceChainId || !destinationChainId) return;
      if (!isMountedRef.current) return;
      if (isSolanaChain(destinationChainId)) return;
      if (!isDocumentVisible()) return;

      setMintSimulation((prev) => ({ ...prev, checking: true }));

      try {
        // Skip EVM simulation for Solana sources to avoid RPC spam
        const skipSimulation = isSolanaChain(sourceChainId);
        const result = await checkMintReadiness(
          sourceChainId,
          destinationChainId as number,
          burnTxHash,
          skipSimulation
        );

        if (!isMountedRef.current) return;

        // Handle delay reason (e.g., insufficient_fee) - update to standard speed
        if (result.delayReason && !mintSimulation.delayReason) {
          // Update transaction to reflect standard speed fallback
          updateTransaction(burnTxHash, {
            transferType: "standard",
            estimatedTime: resolveEstimatedTimeLabel({
              transferType: "standard",
              sourceChainId,
            }),
          });
        }

        setMintSimulation({
          canMint: result.canMint,
          alreadyMinted: result.alreadyMinted,
          checking: false,
          attestationReady: result.attestationReady,
          lastChecked: new Date(),
          error: result.error,
          delayReason: result.delayReason,
          messageExpired: result.messageExpired,
          nonce: result.nonce,
        });

        if (result.nonce && burnTxHash) {
          updateTransaction(burnTxHash, {
            nonce: result.nonce,
          });
        }

        // Read latest steps from ref to avoid stale closure
        const currentSteps = displayStepsRef.current ?? [];

        // Handle already minted case
        if (result.alreadyMinted && burnTxHash) {
          const updatedSteps = currentSteps.map((step) => {
            if (/attestation|attest/i.test(step.name)) {
              return { ...step, state: "success" as const };
            }
            if (/mint|claim|receive/i.test(step.name)) {
              return {
                ...step,
                state: "success" as const,
                errorMessage: "success - check wallet",
              };
            }
            return step;
          });

          updateTransaction(burnTxHash, {
            status: "claimed",
            bridgeState: "success",
            completedAt: new Date(),
            steps: updatedSteps,
            nonce: result.nonce,
          });

          onStepsUpdateRef.current?.(updatedSteps);
        } else if (result.attestationReady && burnTxHash) {
          // Attestation ready but not minted
          const updatedSteps = currentSteps.map((step) => {
            if (/attestation|attest/i.test(step.name)) {
              return { ...step, state: "success" as const };
            }
            return step;
          });

          updateTransaction(burnTxHash, {
            steps: updatedSteps,
            nonce: result.nonce,
          });
          onStepsUpdateRef.current?.(updatedSteps);
        }
      } catch (error) {
        console.error("Mint readiness check failed:", error);
        if (!isMountedRef.current) return;
        setMintSimulation((prev) => ({
          ...prev,
          checking: false,
          error: "Failed to check mint status",
        }));
      }
    };

    checkMint();
    pollingRef.current = setInterval(checkMint, EVM_MINT_POLL_INTERVAL_MS);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [
    shouldPollEvm,
    burnTxHash,
    sourceChainId,
    destinationChainId,
    updateTransaction,
    isDocumentVisible,
  ]);

  // Solana attestation polling effect
  useEffect(() => {
    if (!shouldPollSolana) {
      if (solanaPollingRef.current) {
        clearInterval(solanaPollingRef.current);
        solanaPollingRef.current = null;
      }
      return;
    }

    if (mintSimulation.messageExpired || isAwaitingReattestation) {
      if (solanaPollingRef.current) {
        clearInterval(solanaPollingRef.current);
        solanaPollingRef.current = null;
      }
      return;
    }

    const checkAttestation = async () => {
      if (!burnTxHash || !sourceChainId) return;
      if (!isMountedRef.current) return;
      if (!isDocumentVisible()) return;

      try {
        const result = await fetchAttestationUniversal(sourceChainId, burnTxHash);

        if (!isMountedRef.current) return;

        // Handle delay reason (e.g., insufficient_fee) - update to standard speed
        if (result?.delayReason && !mintSimulation.delayReason) {
          setMintSimulation((prev) => ({
            ...prev,
            delayReason: result.delayReason,
          }));

          // Update transaction to reflect standard speed fallback
          updateTransaction(burnTxHash, {
            transferType: "standard",
            estimatedTime: resolveEstimatedTimeLabel({
              transferType: "standard",
              sourceChainId,
            }),
          });
        }

        if (result?.status === "complete") {
          // Read latest steps from ref to avoid stale closure
          const currentSteps = displayStepsRef.current ?? [];

          // Update attestation step to success
          const updatedSteps = currentSteps.map((step) => {
            if (/attestation|attest/i.test(step.name)) {
              return { ...step, state: "success" as const };
            }
            return step;
          });

          // Add attestation step if missing
          if (!updatedSteps.some((s) => /attestation|attest/i.test(s.name))) {
            const burnIndex = updatedSteps.findIndex((s) => /burn/i.test(s.name));
            const insertIndex = burnIndex >= 0 ? burnIndex + 1 : updatedSteps.length;
            updatedSteps.splice(insertIndex, 0, {
              name: "Fetch Attestation",
              state: "success" as const,
            });
          }

          updateTransaction(burnTxHash, {
            steps: updatedSteps,
            nonce: result.nonce,
          });
          onStepsUpdateRef.current?.(updatedSteps);

          // Update local state
          setMintSimulation((prev) => ({
            ...prev,
            attestationReady: true,
          }));

          // Stop polling
          if (solanaPollingRef.current) {
            clearInterval(solanaPollingRef.current);
            solanaPollingRef.current = null;
          }
        }
      } catch (error) {
        console.error("Solana attestation check failed:", error);
      }
    };

    checkAttestation();
    solanaPollingRef.current = setInterval(checkAttestation, SOLANA_POLL_INTERVAL_MS);

    return () => {
      if (solanaPollingRef.current) {
        clearInterval(solanaPollingRef.current);
        solanaPollingRef.current = null;
      }
    };
  }, [
    shouldPollSolana,
    burnTxHash,
    sourceChainId,
    updateTransaction,
    mintSimulation.messageExpired,
    isAwaitingReattestation,
    isDocumentVisible,
  ]);

  // Setter for external updates (e.g., from claim handler)
  const setAlreadyMinted = useCallback((value: boolean) => {
    setMintSimulation((prev) => ({
      ...prev,
      alreadyMinted: value,
      canMint: value ? false : prev.canMint,
    }));
  }, []);

  // Setter for message expired state (called when claim detects expired attestation)
  const setMessageExpired = useCallback((nonce: string) => {
    setMintSimulation((prev) => ({
      ...prev,
      messageExpired: true,
      nonce,
      canMint: false,
    }));
    if (burnTxHash) {
      updateTransaction(burnTxHash, { nonce });
    }
  }, [burnTxHash, updateTransaction]);

  // Manual re-attestation trigger (fallback if auto-reattest fails)
  const requestReattest = useCallback(async () => {
    if (!sourceChainId || !mintSimulation.nonce) {
      toast({
        title: "Cannot re-attest",
        description: "Missing source chain or nonce information",
        variant: "destructive",
      });
      return;
    }

    setIsReattesting(true);

    try {
      const result = await requestReattestation(sourceChainId, mintSimulation.nonce);

      if (result.success) {
        toast({
          title: "Re-attestation requested",
          description: "Waiting for Circle to process. This may take a minute…",
        });
        setIsAwaitingReattestation(true);
      } else {
        toast({
          title: "Re-attestation failed",
          description: result.error || "Unable to request re-attestation",
          variant: "destructive",
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      toast({
        title: "Re-attestation failed",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsReattesting(false);
    }
  }, [sourceChainId, mintSimulation.nonce, toast]);

  return {
    ...mintSimulation,
    setAlreadyMinted,
    setMessageExpired,
    requestReattest,
    isReattesting,
    isAwaitingReattestation,
  };
}
