import { describe, expect, it } from "vitest";
import { resolveEstimatedTimeLabel } from "@/lib/estimatedTime";

describe("resolveEstimatedTimeLabel", () => {
  it("uses chain-aware fast estimate for Solana source", () => {
    const label = resolveEstimatedTimeLabel({
      transferType: "fast",
      sourceChainId: "Solana",
    });

    expect(label).toBe("~8 seconds");
  });

  it("corrects legacy generic label for fast transfers", () => {
    const label = resolveEstimatedTimeLabel({
      transferType: "fast",
      sourceChainId: "Solana",
      estimatedTime: "13-19 minutes",
    });

    expect(label).toBe("~8 seconds");
  });

  it("corrects legacy generic label for standard Solana transfers", () => {
    const label = resolveEstimatedTimeLabel({
      transferType: "standard",
      sourceChainId: "Solana",
      estimatedTime: "13-19 minutes",
    });

    expect(label).toBe("~25 seconds");
  });

  it("keeps explicit non-generic estimate labels", () => {
    const label = resolveEstimatedTimeLabel({
      transferType: "fast",
      sourceChainId: "Solana",
      estimatedTime: "~42 seconds",
    });

    expect(label).toBe("~42 seconds");
  });

  it("falls back when source chain is unavailable", () => {
    const fast = resolveEstimatedTimeLabel({
      transferType: "fast",
      sourceChainId: null,
    });
    const standard = resolveEstimatedTimeLabel({
      transferType: "standard",
      sourceChainId: null,
    });

    expect(fast).toBe("~1 minute");
    expect(standard).toBe("13-19 minutes");
  });
});
