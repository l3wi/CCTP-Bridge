import { afterEach, describe, expect, it, vi } from "vitest";
import { estimateBridgeFee } from "@/lib/cctp/estimate";

const VALID_EVM_RECIPIENT = "0x1111111111111111111111111111111111111111";
const VALID_SOLANA_RECIPIENT = "11111111111111111111111111111111";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("estimateBridgeFee app fees", () => {
  it("includes Circle provider fee and app fee in the deducted fee total", async () => {
    vi.stubEnv("NEXT_PUBLIC_FAST_TX_FEE_BPS", "4");
    vi.stubEnv("NEXT_PUBLIC_FEE_ADDRESS_EVM", VALID_EVM_RECIPIENT);
    vi.stubEnv("NEXT_PUBLIC_FEE_ADDRESS_SOL", VALID_SOLANA_RECIPIENT);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [{ finalityThreshold: 1000, minimumFee: "1" }],
      })
    );

    const estimate = await estimateBridgeFee({
      sourceChainId: 84532,
      destinationChainId: 11155111,
      amount: "1.000001",
      speed: "fast",
    });

    expect(estimate.fees).toEqual([
      { amount: "0.000100", type: "provider" },
      { amount: "0.000401", type: "kit" },
    ]);
    expect(estimate.receivedAmount).toBe("0.999500");
    expect(estimate.sourceAmount).toBe("1.000001");
  });

  it("does not include app fees for standard estimates", async () => {
    vi.stubEnv("NEXT_PUBLIC_FAST_TX_FEE_BPS", "4");
    vi.stubEnv("NEXT_PUBLIC_FEE_ADDRESS_EVM", VALID_EVM_RECIPIENT);
    vi.stubEnv("NEXT_PUBLIC_FEE_ADDRESS_SOL", VALID_SOLANA_RECIPIENT);

    const estimate = await estimateBridgeFee({
      sourceChainId: 84532,
      destinationChainId: 11155111,
      amount: "1.000001",
      speed: "standard",
    });

    expect(estimate.fees).toEqual([]);
    expect(estimate.receivedAmount).toBe("1.000001");
    expect(estimate.sourceAmount).toBe("1.000001");
  });
});
