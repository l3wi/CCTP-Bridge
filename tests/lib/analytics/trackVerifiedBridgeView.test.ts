import { beforeEach, describe, expect, it, vi } from "vitest";
import { track } from "@vercel/analytics/server";
import {
  classifyBridgeRouteId,
  parseBridgeRouteSource,
} from "@/lib/bridgeRoute";
import {
  recoverTransactionFromBurnHash,
  recoverTransactionFromNonce,
} from "@/lib/transactionRecovery";
import { trackVerifiedBridgeView } from "@/lib/analytics/trackVerifiedBridgeView";

vi.mock("@vercel/analytics/server", () => ({
  track: vi.fn(async () => undefined),
}));

vi.mock("@/lib/bridgeRoute", () => ({
  parseBridgeRouteSource: vi.fn(),
  classifyBridgeRouteId: vi.fn(),
}));

vi.mock("@/lib/transactionRecovery", () => ({
  recoverTransactionFromBurnHash: vi.fn(),
  recoverTransactionFromNonce: vi.fn(),
}));

describe("trackVerifiedBridgeView", () => {
  const originalDisableFlag = process.env.NEXT_PUBLIC_DISABLE_META_ANALYTICS;

  beforeEach(() => {
    vi.clearAllMocks();
    if (originalDisableFlag === undefined) {
      delete process.env.NEXT_PUBLIC_DISABLE_META_ANALYTICS;
    } else {
      process.env.NEXT_PUBLIC_DISABLE_META_ANALYTICS = originalDisableFlag;
    }
  });

  it("tracks verified tx-hash lookups using Iris-derived values", async () => {
    vi.mocked(parseBridgeRouteSource).mockReturnValue({
      sourceChainId: 11155111,
      sourceDomain: 0,
      canonicalSegment: "0",
      isLegacy: false,
    });
    vi.mocked(classifyBridgeRouteId).mockReturnValue({
      kind: "txHash",
      normalizedId: "0xabc123",
    });
    vi.mocked(recoverTransactionFromBurnHash).mockResolvedValue({
      transaction: {
        originChain: 11155111,
        targetChain: 8453,
        amount: "12.50",
        transferType: "fast",
      },
    } as never);

    await trackVerifiedBridgeView({
      sourceChainSegment: "0",
      routeIdSegment: "0xabc123",
    });

    expect(recoverTransactionFromBurnHash).toHaveBeenCalledWith(
      11155111,
      "0xabc123"
    );
    expect(recoverTransactionFromNonce).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith("bridge", {
      amount: "12.50",
      meta: "12.50,11155111,8453,1",
      recipientResolution: "verified_from_iris",
      sourceChainId: 11155111,
      targetChainId: 8453,
    });
  });

  it("tracks verified nonce lookups", async () => {
    vi.mocked(parseBridgeRouteSource).mockReturnValue({
      sourceChainId: "Solana_Devnet",
      sourceDomain: 5,
      canonicalSegment: "5",
      isLegacy: false,
    });
    vi.mocked(classifyBridgeRouteId).mockReturnValue({
      kind: "nonce",
      normalizedId: "12345",
    });
    vi.mocked(recoverTransactionFromNonce).mockResolvedValue({
      transaction: {
        originChain: "Solana_Devnet",
        targetChain: 11155111,
        amount: "1.00",
        transferType: "standard",
      },
    } as never);

    await trackVerifiedBridgeView({
      sourceChainSegment: "5",
      routeIdSegment: "12345",
    });

    expect(recoverTransactionFromNonce).toHaveBeenCalledWith(
      "Solana_Devnet",
      "12345"
    );
    expect(recoverTransactionFromBurnHash).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith("bridge", {
      amount: "1.00",
      meta: "1.00,Solana_Devnet,11155111,0",
      recipientResolution: "verified_from_iris",
      sourceChainId: "Solana_Devnet",
      targetChainId: 11155111,
    });
  });

  it("does nothing when source segment is invalid", async () => {
    vi.mocked(parseBridgeRouteSource).mockReturnValue(null);

    await trackVerifiedBridgeView({
      sourceChainSegment: "not-a-domain",
      routeIdSegment: "abc",
    });

    expect(classifyBridgeRouteId).not.toHaveBeenCalled();
    expect(recoverTransactionFromBurnHash).not.toHaveBeenCalled();
    expect(recoverTransactionFromNonce).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });

  it("does nothing when route id is invalid", async () => {
    vi.mocked(parseBridgeRouteSource).mockReturnValue({
      sourceChainId: 1,
      sourceDomain: 0,
      canonicalSegment: "0",
      isLegacy: false,
    });
    vi.mocked(classifyBridgeRouteId).mockReturnValue({
      kind: "invalid",
      normalizedId: "bad-id",
    });

    await trackVerifiedBridgeView({
      sourceChainSegment: "0",
      routeIdSegment: "bad-id",
    });

    expect(recoverTransactionFromBurnHash).not.toHaveBeenCalled();
    expect(recoverTransactionFromNonce).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });

  it("does not throw when Iris recovery fails", async () => {
    vi.mocked(parseBridgeRouteSource).mockReturnValue({
      sourceChainId: 1,
      sourceDomain: 0,
      canonicalSegment: "0",
      isLegacy: false,
    });
    vi.mocked(classifyBridgeRouteId).mockReturnValue({
      kind: "txHash",
      normalizedId: "0xdeadbeef",
    });
    vi.mocked(recoverTransactionFromBurnHash).mockRejectedValue(
      new Error("iris unavailable")
    );

    await expect(
      trackVerifiedBridgeView({
        sourceChainSegment: "0",
        routeIdSegment: "0xdeadbeef",
      })
    ).resolves.toBeUndefined();

    expect(track).not.toHaveBeenCalled();
  });

  it("respects analytics disable flag", async () => {
    process.env.NEXT_PUBLIC_DISABLE_META_ANALYTICS = "1";

    await trackVerifiedBridgeView({
      sourceChainSegment: "0",
      routeIdSegment: "0xabc",
    });

    expect(parseBridgeRouteSource).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });
});
