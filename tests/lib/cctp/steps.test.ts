import { describe, expect, it } from "vitest";
import {
  createInitialSteps,
  updateStepsBurnComplete,
  updateStepsBurnFailed,
} from "@/lib/cctp/steps";

describe("CCTP bridge steps", () => {
  it("keeps burn pending when the source transaction has only been submitted", () => {
    const burnTxHash = `0x${"1".repeat(64)}` as const;

    const steps = createInitialSteps({
      sourceChainType: "evm",
      burnTxHash,
      approvalTxHash: `0x${"2".repeat(64)}`,
    });

    expect(steps).toEqual([
      {
        name: "Approve",
        state: "success",
        txHash: `0x${"2".repeat(64)}`,
      },
      { name: "Burn", state: "pending", txHash: burnTxHash },
      { name: "Fetch Attestation", state: "pending" },
      { name: "Mint", state: "pending" },
    ]);
  });

  it("marks burn success only when confirmation polling completes", () => {
    const burnTxHash = `0x${"3".repeat(64)}` as const;
    const steps = createInitialSteps({
      sourceChainType: "solana",
      burnTxHash,
    });

    const updated = updateStepsBurnComplete(steps, burnTxHash);

    expect(updated.find((step) => step.name === "Burn")).toEqual({
      name: "Burn",
      state: "success",
      txHash: burnTxHash,
    });
  });

  it("marks burn error when confirmation polling observes source-chain failure", () => {
    const burnTxHash = `0x${"4".repeat(64)}` as const;
    const steps = createInitialSteps({
      sourceChainType: "evm",
      burnTxHash,
    });

    const updated = updateStepsBurnFailed(
      steps,
      "Burn transaction reverted on-chain",
      burnTxHash
    );

    expect(updated.find((step) => step.name === "Burn")).toEqual({
      name: "Burn",
      state: "error",
      txHash: burnTxHash,
      errorMessage: "Burn transaction reverted on-chain",
    });
  });
});
