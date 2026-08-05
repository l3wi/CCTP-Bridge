import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/events/burn/route";
import { recordBridgeBurnSubmission } from "@/lib/db/bridgeBurnSubmissions";

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return {
    ...actual,
    after: vi.fn((callback: () => void | Promise<void>) => {
      void callback();
    }),
  };
});

vi.mock("@/lib/db/bridgeBurnSubmissions", () => ({
  recordBridgeBurnSubmission: vi.fn(async () => undefined),
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

  it("records a valid bridge burn submission server-side", async () => {
    const response = await POST(
      new Request("http://localhost/api/events/burn", {
        method: "POST",
        body: JSON.stringify({
          burnHash: `0x${"a".repeat(64)}`,
          sourceChainId: 42161,
          targetChainId: 8453,
          fromAddress: `0x${"1".repeat(40)}`,
          toAddress: `0x${"2".repeat(40)}`,
          amount: "100.000000",
          transferType: "fast",
          appFastFee: "0.050000",
          appFeeBps: 5,
          circleFastFee: "0.010000",
        }),
      })
    );

    expect(response.status).toBe(202);
    expect(recordBridgeBurnSubmission).toHaveBeenCalledWith({
      eventId: `42161:0x${"a".repeat(64)}`,
      metadata: {
        version: "v1",
        amount: "100.000000",
        sourceChainId: "42161",
        targetChainId: "8453",
        speed: "f",
        appFastFee: "0.050000",
        circleFastFee: "0.010000",
      },
      fromAddress: `0x${"1".repeat(40)}`,
      toAddress: `0x${"2".repeat(40)}`,
      appFeeBps: 5,
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
  });

  it("records the submission independently of the verified counter flag", async () => {
    process.env.NEXT_PUBLIC_DISABLE_META_ANALYTICS = "1";

    const response = await POST(
      new Request("http://localhost/api/events/burn", {
        method: "POST",
        body: JSON.stringify({
          burnHash: `0x${"a".repeat(64)}`,
          sourceChainId: 1,
          targetChainId: 8453,
          fromAddress: `0x${"1".repeat(40)}`,
          toAddress: `0x${"2".repeat(40)}`,
          amount: "1",
          transferType: "standard",
        }),
      })
    );

    expect(response.status).toBe(202);
    expect(recordBridgeBurnSubmission).toHaveBeenCalled();
  });

  it("returns accepted when database recording fails", async () => {
    vi.mocked(recordBridgeBurnSubmission).mockRejectedValueOnce(new Error("Turso offline"));

    const response = await POST(
      new Request("http://localhost/api/events/burn", {
        method: "POST",
        body: JSON.stringify({
          burnHash: `0x${"b".repeat(64)}`,
          sourceChainId: 1,
          targetChainId: 10,
          fromAddress: `0x${"1".repeat(40)}`,
          toAddress: `0x${"2".repeat(40)}`,
          amount: "1",
          transferType: "standard",
        }),
      })
    );

    expect(response.status).toBe(202);
  });
});
