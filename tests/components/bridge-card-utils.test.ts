import { describe, expect, it } from "vitest";
import {
  getEstimateLabels,
  getTotalBridgeFee,
  getYouWillReceive,
} from "@/components/bridge-card/utils";
import type { BridgeEstimate } from "@/lib/cctp/types";

describe("bridge-card estimate fee labels", () => {
  const estimate: BridgeEstimate = {
    fees: [
      { amount: "0.000100", type: "provider" as const },
      { amount: "0.000400", type: "kit" as const },
    ],
    gasFees: [],
    receivedAmount: "0.999500",
    sourceAmount: "1.000000",
    estimatedTime: "~20 seconds",
    speed: "fast" as const,
    sourceDomain: 0,
    destinationDomain: 6,
  };

  it("subtracts both provider and app fees from destination receive amount", () => {
    expect(getTotalBridgeFee(estimate)).toBe(0.0005);
    expect(
      getYouWillReceive({
        amount: { str: "1", bigInt: 1_000_000n },
        feeTotal: getTotalBridgeFee(estimate),
      })
    ).toBe("0.999500 USDC");
  });

  it("collapses app fee and provider fee into one generic fee label", () => {
    const labels = getEstimateLabels({
      speed: "fast",
      estimate,
      isEstimating: false,
      amountIsValid: true,
      chainSelectionValid: true,
      hasAmountInput: true,
      amount: { str: "1", bigInt: 1_000_000n },
      activeSourceChainId: null,
      transferSpeedLabel: "~20 seconds",
    });

    expect(labels.feeLabel).toBe("0.000500 USDC");
    expect(labels.receiveLabel).toBe("0.999500 USDC");
  });
});
