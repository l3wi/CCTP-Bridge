"use client";

import { useMemo } from "react";
import type { BridgeResult } from "@circle-fin/bridge-kit";
import { ChainId, isSolanaChain } from "@/lib/types";

const STEP_ORDER = [
  { id: "approve" as const, label: "Approve" },
  { id: "burn" as const, label: "Burn" },
  { id: "fetchAttestation" as const, label: "Fetch Attestation" },
  { id: "mint" as const, label: "Mint" },
];

type StepId = (typeof STEP_ORDER)[number]["id"];

export interface DerivedStep {
  id: StepId;
  label: string;
  name: string;
  state: "success" | "pending" | "error" | "noop";
  txHash?: string;
  explorerUrl?: string;
  errorMessage?: string;
  error?: unknown;
}

function getStepId(name: string): StepId | null {
  const lower = name.toLowerCase();
  if (lower.includes("approve")) return "approve";
  if (lower.includes("burn")) return "burn";
  if (lower.includes("attestation") || lower.includes("attest"))
    return "fetchAttestation";
  if (lower.includes("mint") || lower.includes("claim") || lower.includes("receive"))
    return "mint";
  return null;
}

interface UseBridgeStepsParams {
  bridgeResult?: BridgeResult;
  sourceChainId?: ChainId;
}

interface UseBridgeStepsResult {
  derivedSteps: DerivedStep[];
  hasFetchAttestation: boolean;
  hasBurnCompleted: boolean;
  hasMintCompleted: boolean;
}

/**
 * Derives normalized step state from bridge result.
 * Handles step inference, Solana source detection, and state normalization.
 */
export function useBridgeSteps({
  bridgeResult,
  sourceChainId,
}: UseBridgeStepsParams): UseBridgeStepsResult {
  const derivedSteps = useMemo(() => {
    const existingSteps = (bridgeResult?.steps || []).flatMap((step) => {
      const id = getStepId(step.name);
      if (!id) return [];
      return [
        {
          ...step,
          id,
          label: STEP_ORDER.find((entry) => entry.id === id)?.label || step.name,
        },
      ];
    });

    // Check if burn step exists and is successful (implies approval succeeded)
    const burnStep = existingSteps.find((s) => s.id === "burn");
    const burnSucceeded = burnStep?.state === "success" || burnStep?.state === "noop";

    // Solana sources don't have an approval step - skip it
    const chainDef = bridgeResult?.source?.chain as
      | { chainId?: number; chain?: string }
      | undefined;
    const srcChainId = chainDef?.chainId ?? chainDef?.chain ?? sourceChainId;
    const isSourceSolana = srcChainId && isSolanaChain(srcChainId as ChainId);

    let previousCompleted = true;
    const filled: DerivedStep[] = [];

    for (const entry of STEP_ORDER) {
      // Skip approve step for Solana sources (no approval needed)
      if (entry.id === "approve" && isSourceSolana) {
        continue;
      }

      const existing = existingSteps.find((s) => s.id === entry.id);
      if (existing) {
        filled.push(existing as DerivedStep);
        previousCompleted = existing.state === "success" || existing.state === "noop";
      } else if (previousCompleted) {
        // If approve step is missing but burn succeeded, infer approve succeeded
        if (entry.id === "approve" && burnSucceeded) {
          filled.push({
            id: entry.id,
            label: entry.label,
            name: entry.label,
            state: "success",
          });
          previousCompleted = true;
        } else {
          filled.push({
            id: entry.id,
            label: entry.label,
            name: entry.label,
            state: "pending",
          });
          previousCompleted = false;
        }
      }
    }

    return filled;
  }, [bridgeResult?.steps, bridgeResult?.source?.chain, sourceChainId]);

  const hasFetchAttestation = useMemo(
    () =>
      derivedSteps.some(
        (step) => step.id === "fetchAttestation" && step.state === "success"
      ),
    [derivedSteps]
  );

  const hasBurnCompleted = useMemo(
    () =>
      derivedSteps.some(
        (step) =>
          step.id === "burn" && (step.state === "success" || step.state === "noop")
      ),
    [derivedSteps]
  );

  const hasMintCompleted = useMemo(
    () => derivedSteps.some((step) => step.id === "mint" && step.state === "success"),
    [derivedSteps]
  );

  return {
    derivedSteps,
    hasFetchAttestation,
    hasBurnCompleted,
    hasMintCompleted,
  };
}
