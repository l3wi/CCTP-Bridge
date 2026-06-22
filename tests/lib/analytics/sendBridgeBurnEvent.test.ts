/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendBridgeBurnEvent } from "@/lib/analytics/sendBridgeBurnEvent";

describe("sendBridgeBurnEvent", () => {
  const input = {
    burnHash: `0x${"a".repeat(64)}` as const,
    sourceChainId: 1,
    targetChainId: 8453,
    amount: "1.000000",
    transferType: "fast" as const,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("uses sendBeacon when available", () => {
    const sendBeacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: sendBeacon,
    });
    const fetchMock = vi.spyOn(window, "fetch");

    sendBridgeBurnEvent(input);

    expect(sendBeacon).toHaveBeenCalledWith(
      "/api/events/burn",
      expect.any(Blob)
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to keepalive fetch when sendBeacon cannot queue", () => {
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: vi.fn(() => false),
    });
    const fetchMock = vi
      .spyOn(window, "fetch")
      .mockResolvedValue(new Response(null, { status: 202 }));

    sendBridgeBurnEvent(input);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/events/burn",
      expect.objectContaining({
        method: "POST",
        keepalive: true,
      })
    );
  });
});
