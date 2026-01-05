"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { BridgeResult } from "@circle-fin/bridge-kit";
import { ChainId, isSolanaChain } from "@/lib/types";
import { checkMintReadiness } from "@/lib/simulation";
import { fetchAttestationUniversal } from "@/lib/iris";
import { useTransactionStore } from "@/lib/store/transactionStore";

// Polling configuration
const POLL_INTERVAL_MS = 5_000; // Poll every 5 seconds
const MAX_POLL_DURATION_MS = 60 * 60 * 1000; // Stop polling after 1 hour

export interface MintPollingState {
  canMint: boolean;
  alreadyMinted: boolean;
  attestationReady: boolean;
  checking: boolean;
  lastChecked: Date | null;
  error?: string;
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

  const [mintSimulation, setMintSimulation] = useState<MintPollingState>({
    canMint: false,
    alreadyMinted: false,
    checking: false,
    attestationReady: false,
    lastChecked: null,
  });

  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const solanaPollingRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);

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
    burnCompletedAt,
    startedAt,
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

        setMintSimulation({
          canMint: result.canMint,
          alreadyMinted: result.alreadyMinted,
          checking: false,
          attestationReady: result.attestationReady,
          lastChecked: new Date(),
          error: result.error,
        });

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
                errorMessage: "USDC claimed. Check your wallet for the USDC",
              };
            }
            return step;
          });

          updateTransaction(burnTxHash, {
            status: "claimed",
            bridgeState: "success",
            completedAt: new Date(),
            steps: updatedSteps,
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

          updateTransaction(burnTxHash, { steps: updatedSteps });
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
    pollingRef.current = setInterval(checkMint, POLL_INTERVAL_MS);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [shouldPollEvm, burnTxHash, sourceChainId, destinationChainId, updateTransaction]);

  // Solana attestation polling effect
  useEffect(() => {
    if (!shouldPollSolana) {
      if (solanaPollingRef.current) {
        clearInterval(solanaPollingRef.current);
        solanaPollingRef.current = null;
      }
      return;
    }

    const checkAttestation = async () => {
      if (!burnTxHash || !sourceChainId) return;
      if (!isMountedRef.current) return;

      try {
        const result = await fetchAttestationUniversal(sourceChainId, burnTxHash);

        if (!isMountedRef.current) return;

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

          updateTransaction(burnTxHash, { steps: updatedSteps });
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
    solanaPollingRef.current = setInterval(checkAttestation, POLL_INTERVAL_MS);

    return () => {
      if (solanaPollingRef.current) {
        clearInterval(solanaPollingRef.current);
        solanaPollingRef.current = null;
      }
    };
  }, [shouldPollSolana, burnTxHash, sourceChainId, updateTransaction]);

  // Setter for external updates (e.g., from claim handler)
  const setAlreadyMinted = useCallback((value: boolean) => {
    setMintSimulation((prev) => ({
      ...prev,
      alreadyMinted: value,
      canMint: value ? false : prev.canMint,
    }));
  }, []);

  return {
    ...mintSimulation,
    setAlreadyMinted,
  };
}
