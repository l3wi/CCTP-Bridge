import { beforeEach, describe, expect, it, vi } from "vitest";
import { track } from "@vercel/analytics/server";
import { POST } from "@/app/api/events/burn/route";
import { BRIDGE_BURN_EVENT_NAME } from "@/lib/analytics/bridgeBurnEvent";

vi.mock("@vercel/analytics/server", () => ({
  track: vi.fn(async () => undefined),
}));

describe("POST /api/events/burn", () => {
  const originalDisableFlag = process.env.NEXT_PUBLIC_DISABLE_META_ANALYTICS;

  beforeEach(() => {
    vi.clearAllMocks();
    if (originalDisableFlag === undefined) {
      delete process.env.NEXT_PUBLIC_DISABLE_META_ANALYTICS;
    } else {
      process.env.NEXT_PUBLIC_DISABLE_META_ANALYTICS = originalDisableFlag;
    }
  });

  it("tracks a valid bridge burn event server-side", async () => {
    const response = await POST(
      new Request("http://localhost/api/events/burn", {
        method: "POST",
        body: JSON.stringify({
          burnHash: `0x${"a".repeat(64)}`,
          sourceChainId: 42161,
          targetChainId: 8453,
          amount: "100.000000",
          transferType: "fast",
          appFastFee: "0.050000",
          circleFastFee: "0.010000",
        }),
      })
    );

    expect(response.status).toBe(202);
    expect(track).toHaveBeenCalledWith(BRIDGE_BURN_EVENT_NAME, {
      id: `42161:0x${"a".repeat(64)}`,
      m: "v1,100.000000,42161,8453,f,0.050000,0.010000",
    });
  });

  it("rejects invalid burn payloads", async () => {
    const response = await POST(
      new Request("http://localhost/api/events/burn", {
        method: "POST",
        body: JSON.stringify({
          burnHash: "0xabc",
          sourceChainId: 1,
          targetChainId: 8453,
          amount: "1",
          transferType: "fast",
        }),
      })
    );

    expect(response.status).toBe(400);
    expect(track).not.toHaveBeenCalled();
  });

  it("respects the analytics disable flag", async () => {
    process.env.NEXT_PUBLIC_DISABLE_META_ANALYTICS = "1";

    const response = await POST(
      new Request("http://localhost/api/events/burn", {
        method: "POST",
        body: JSON.stringify({
          burnHash: `0x${"a".repeat(64)}`,
          sourceChainId: 1,
          targetChainId: 8453,
          amount: "1",
          transferType: "standard",
        }),
      })
    );

    expect(response.status).toBe(204);
    expect(track).not.toHaveBeenCalled();
  });
});
