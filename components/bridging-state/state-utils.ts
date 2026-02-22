import type { BridgeResult } from "@circle-fin/bridge-kit";
import { deriveBridgeState } from "@/lib/cctp/steps";
import type { BridgeResultWithMeta } from "./types";

export const CLAIMED_MESSAGE = "success - check wallet";

const isNonceAlreadyUsed = (step: {
  errorMessage?: string;
  error?: unknown;
}): boolean =>
  /nonce already used/i.test(step.errorMessage || "") ||
  /nonce already used/i.test(String(step.error || ""));

/**
 * Keep bridge-level state aligned with step-level state.
 * This prevents "Bridge Completed" from showing while mint is still pending.
 */
export function normalizeBridgeResult(
  baseResult: BridgeResultWithMeta | undefined
): BridgeResultWithMeta | undefined {
  if (!baseResult) return undefined;

  const normalizedSteps = (baseResult.steps ?? []).map((step) => {
    if (isNonceAlreadyUsed(step) && /mint|claim|receive/i.test(step.name)) {
      return {
        ...step,
        state: "success" as const,
        errorMessage: CLAIMED_MESSAGE,
      };
    }
    return step;
  });

  const state =
    normalizedSteps.length > 0
      ? deriveBridgeState(normalizedSteps)
      : (baseResult.state ?? "pending");

  return {
    ...baseResult,
    state,
    steps: normalizedSteps,
  };
}

/**
 * Merge step updates back into local bridge result without forcing success.
 */
export function mergeUpdatedSteps(
  previous: BridgeResultWithMeta | undefined,
  updatedSteps: BridgeResult["steps"]
): BridgeResultWithMeta | undefined {
  if (!previous) return previous;

  const state =
    updatedSteps.length > 0
      ? deriveBridgeState(updatedSteps)
      : (previous.state ?? "pending");

  return {
    ...previous,
    steps: updatedSteps,
    state,
  };
}
