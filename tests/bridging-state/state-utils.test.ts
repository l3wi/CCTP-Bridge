import type { BridgeResult } from "@circle-fin/bridge-kit";
import { describe, expect, it } from "vitest";
import type { BridgeResultWithMeta } from "@/components/bridging-state/types";
import {
  CLAIMED_MESSAGE,
  mergeUpdatedSteps,
  normalizeBridgeResult,
} from "@/components/bridging-state/state-utils";

function makeBridgeResult(
  overrides: Partial<BridgeResultWithMeta> = {}
): BridgeResultWithMeta {
  return {
    amount: "1",
    token: "USDC",
    state: "pending",
    provider: "CCTPV2BridgingProvider",
    source: {
      address: "0x1111111111111111111111111111111111111111",
      chain: { chainId: 1, chain: "Ethereum", type: "evm", name: "Ethereum" } as never,
    },
    destination: {
      address: "0x2222222222222222222222222222222222222222",
      chain: { chainId: 10, chain: "Optimism", type: "evm", name: "Optimism" } as never,
    },
    steps: [
      { name: "Burn", state: "success" },
      { name: "Fetch Attestation", state: "success" },
      { name: "Mint", state: "pending" },
    ] as BridgeResult["steps"],
    ...overrides,
  };
}

describe("bridging-state state utils", () => {
  it("keeps bridge state pending when mint step is still pending", () => {
    const base = makeBridgeResult({ state: "success" });

    const normalized = normalizeBridgeResult(base);

    expect(normalized?.state).toBe("pending");
    expect(normalized?.steps.find((step) => /mint/i.test(step.name))?.state).toBe(
      "pending"
    );
  });

  it("normalizes nonce-already-used mint steps to success", () => {
    const base = makeBridgeResult({
      steps: [
        { name: "Burn", state: "success" },
        { name: "Fetch Attestation", state: "success" },
        { name: "Mint", state: "error", errorMessage: "nonce already used" },
      ] as BridgeResult["steps"],
    });

    const normalized = normalizeBridgeResult(base);
    const mintStep = normalized?.steps.find((step) => /mint/i.test(step.name));

    expect(mintStep?.state).toBe("success");
    expect(mintStep?.errorMessage).toBe(CLAIMED_MESSAGE);
    expect(normalized?.state).toBe("success");
  });

  it("derives state from updated steps instead of forcing success", () => {
    const previous = makeBridgeResult({ state: "pending" });
    const updatedSteps: BridgeResult["steps"] = [
      { name: "Burn", state: "success" },
      { name: "Fetch Attestation", state: "success" },
      { name: "Mint", state: "pending" },
    ];

    const merged = mergeUpdatedSteps(previous, updatedSteps);

    expect(merged?.state).toBe("pending");
  });
});
