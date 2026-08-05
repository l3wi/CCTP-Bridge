import { describe, expect, it } from "vitest";
import {
  formatAtomicUsdc,
  parseBridgeStatisticsDays,
  renderBridgeStatistics,
} from "@/lib/reporting/bridgeStatistics";

describe("bridge statistics reporting", () => {
  it("accepts only the supported reporting windows", () => {
    expect(parseBridgeStatisticsDays(["--days", "30"])).toBe(30);
    expect(() => parseBridgeStatisticsDays(["--days", "14"])).toThrow(
      "--days must be one of: 7, 30, 90, 120"
    );
    expect(() => parseBridgeStatisticsDays(["--days", "30", "extra"])).toThrow(
      "Usage:"
    );
  });

  it("formats atomic USDC without floating-point rounding", () => {
    expect(formatAtomicUsdc(1_234_567_890)).toBe("1,234.567890");
  });

  it("renders the volume, fee, and bridge-count breakdown", () => {
    expect(
      renderBridgeStatistics({
        days: 7,
        statistics: {
          totalVolumeAtomic: 1_500_000_000,
          fastVolumeAtomic: 1_000_000_000,
          standardVolumeAtomic: 500_000_000,
          totalFeesAtomic: 700_000,
          fastFeesAtomic: 200_000,
          supportFeesAtomic: 500_000,
          totalBridges: 3,
          fastBridges: 2,
          standardBridges: 1,
        },
      })
    ).toBe(
      [
        "Bridge statistics · last 7 days",
        "────────────────────────────────────────",
        "Volume        1,500.000000 USDC",
        "  Fast        1,000.000000 USDC",
        "  Standard      500.000000 USDC",
        "",
        "Fees              0.700000 USDC",
        "  Fast            0.200000 USDC",
        "  Standard        0.500000 USDC",
        "",
        "Bridges                       3",
        "  Fast                        2",
        "  Standard                    1",
      ].join("\n")
    );
  });
});
