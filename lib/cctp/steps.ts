/**
 * Step management utilities for CCTP bridge operations.
 * Consolidated from multiple hooks to eliminate duplication.
 */

import type { BridgeResult } from "@circle-fin/bridge-kit";
import type { ChainType, UniversalTxHash, EvmTxHash } from "./types";

type Step = BridgeResult["steps"][number];
type Steps = BridgeResult["steps"];

// =============================================================================
// Step Creation
// =============================================================================

interface CreateInitialStepsParams {
  sourceChainType: ChainType;
  burnTxHash: UniversalTxHash;
  approvalTxHash?: EvmTxHash;
}

/**
 * Create initial step array when a bridge starts.
 * EVM sources include an optional approval step.
 */
export function createInitialSteps(params: CreateInitialStepsParams): Steps {
  const { sourceChainType, burnTxHash, approvalTxHash } = params;

  const steps: Steps = [];

  // EVM sources may have an approval step
  if (sourceChainType === "evm" && approvalTxHash) {
    steps.push({
      name: "Approve",
      state: "success",
      txHash: approvalTxHash,
    });
  }

  steps.push(
    { name: "Burn", state: "success", txHash: burnTxHash },
    { name: "Fetch Attestation", state: "pending" },
    { name: "Mint", state: "pending" }
  );

  return steps;
}

// =============================================================================
// Step Updates
// =============================================================================

/**
 * Update steps to mark attestation as successful.
 */
export function updateStepsWithAttestation(
  existingSteps: Steps | undefined
): Steps {
  const steps = existingSteps ? [...existingSteps] : [];

  const attestationIndex = steps.findIndex((s) =>
    /attestation|attest/i.test(s.name)
  );

  if (attestationIndex >= 0) {
    steps[attestationIndex] = {
      ...steps[attestationIndex],
      state: "success",
    };
  }

  return steps;
}

/**
 * Update steps with mint completion.
 * Marks attestation as success and creates/updates mint step.
 */
export function updateStepsWithMint(
  existingSteps: Steps | undefined,
  mintTxHash: UniversalTxHash | undefined,
  alreadyMinted: boolean
): Steps {
  const steps = existingSteps ? [...existingSteps] : [];

  // Update attestation step to success if present
  const attestationIndex = steps.findIndex((s) =>
    /attestation|attest/i.test(s.name)
  );
  if (attestationIndex >= 0) {
    steps[attestationIndex] = {
      ...steps[attestationIndex],
      state: "success",
    };
  }

  // Find or create mint step
  const mintIndex = steps.findIndex((s) =>
    /mint|claim|receive/i.test(s.name)
  );

  const mintStep: Step = {
    name: "Mint",
    state: "success",
    txHash: mintTxHash,
    errorMessage: alreadyMinted
      ? "USDC claimed. Check your wallet for the USDC"
      : undefined,
  };

  if (mintIndex >= 0) {
    steps[mintIndex] = { ...steps[mintIndex], ...mintStep };
  } else {
    steps.push(mintStep);
  }

  return steps;
}

// =============================================================================
// Step Merging
// =============================================================================

/**
 * Merge a new step into existing steps array.
 * If a step with the same name exists, update it. Otherwise append.
 */
export function mergeSteps(existing: Steps = [], incoming?: Step): Steps {
  if (!incoming) return existing;

  const index = existing.findIndex(
    (step) => step.name.toLowerCase() === incoming.name.toLowerCase()
  );

  if (index === -1) {
    return [...existing, incoming];
  }

  const updated = [...existing];
  updated[index] = {
    ...updated[index],
    ...incoming,
  };

  return updated;
}

// =============================================================================
// Step Name Normalization
// =============================================================================

/**
 * Normalize step name from various sources to standard display names.
 */
export function normalizeStepName(
  name?: string,
  method?: string
): string | undefined {
  const fallback = method || name;
  if (!fallback) return undefined;

  const slug = fallback
    .replace(/^[^.]*\./, "")
    .replace(/[:]/g, " ")
    .replace(/-/g, " ")
    .trim();

  if (!slug) return undefined;

  const known = slug.toLowerCase();
  if (known.includes("approve")) return "Approve";
  if (known.includes("burn")) return "Burn";
  if (known.includes("attestation")) return "Fetch Attestation";
  if (known.includes("mint")) return "Mint";
  if (known.includes("receive")) return "Receive";

  return slug.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Normalize step state to valid BridgeResult state.
 */
export function normalizeState(
  state?: unknown
): BridgeResult["state"] | "pending" {
  if (typeof state !== "string") return "pending";
  const normalized = state.toLowerCase();
  if (normalized === "success") return "success";
  if (normalized === "error") return "error";
  if (normalized === "pending" || normalized === "ready") return "pending";
  return "pending";
}

// =============================================================================
// Step Analysis
// =============================================================================

/**
 * Check if a step's error indicates nonce was already used.
 */
export function isNonceAlreadyUsedStep(step: Step): boolean {
  const message = `${step.errorMessage ?? ""} ${step.error ?? ""}`.toLowerCase();
  return message.includes("nonce already used");
}

/**
 * Derive overall bridge state from steps array.
 */
export function deriveBridgeState(
  steps: Steps,
  fallback?: BridgeResult["state"]
): BridgeResult["state"] | "pending" {
  if (!steps.length) return fallback ?? "pending";

  const hasNonceClaimed = steps.some(isNonceAlreadyUsedStep);
  const hasMintSuccess = steps.some(
    (step) =>
      (/mint|receive|claim/i.test(step.name) ||
        step.name.toLowerCase().includes("mint")) &&
      (step.state === "success" || isNonceAlreadyUsedStep(step))
  );

  if (hasMintSuccess || hasNonceClaimed) {
    return "success" as const;
  }

  const hasError = steps.some((step) => step.state === "error");
  if (hasError) return "error";

  return fallback ?? "pending";
}

/**
 * Find transaction hashes from steps array.
 */
export function findTxHashes(steps: Steps): {
  burnHash?: UniversalTxHash;
  mintHash?: UniversalTxHash;
  completedAt?: Date;
} {
  let burnHash: UniversalTxHash | undefined;
  let mintHash: UniversalTxHash | undefined;
  let completedAt: Date | undefined;

  for (const step of steps) {
    const txHash = step.txHash as UniversalTxHash | undefined;
    if (!burnHash && txHash) {
      burnHash = txHash;
    }
    if (txHash && /mint|receive/i.test(step.name)) {
      mintHash = txHash;
    }
    if (step.state === "success") {
      completedAt = new Date();
    }
  }

  return { burnHash, mintHash, completedAt };
}
