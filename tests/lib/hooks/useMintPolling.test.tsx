/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMintPolling } from "@/lib/hooks/useMintPolling";

const updateTransactionMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());
const checkMintReadinessMock = vi.hoisted(() => vi.fn());
const fetchAttestationUniversalMock = vi.hoisted(() => vi.fn());
const requestReattestationMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/store/transactionStore", () => ({
  useTransactionStore: () => ({
    updateTransaction: updateTransactionMock,
  }),
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({
    toast: toastMock,
  }),
}));

vi.mock("@/lib/simulation", () => ({
  checkMintReadiness: checkMintReadinessMock,
}));

vi.mock("@/lib/iris", () => ({
  fetchAttestationUniversal: fetchAttestationUniversalMock,
  requestReattestation: requestReattestationMock,
}));

describe("useMintPolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-21T00:00:00.000Z"));

    updateTransactionMock.mockReset();
    toastMock.mockReset();
    checkMintReadinessMock.mockReset();
    fetchAttestationUniversalMock.mockReset();
    requestReattestationMock.mockReset();

    checkMintReadinessMock.mockResolvedValue({
      success: false,
      canMint: false,
      alreadyMinted: false,
      attestationReady: false,
      error: "not ready",
    });

    fetchAttestationUniversalMock.mockResolvedValue({
      status: "pending",
      nonce: "42",
    });

    requestReattestationMock.mockResolvedValue({
      success: true,
      nonce: "42",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("exits awaiting state and exposes a timeout flag after 10 minutes", async () => {
    const { result } = renderHook(() =>
      useMintPolling({
        burnTxHash: `0x${"1".repeat(64)}`,
        sourceChainId: 1,
        destinationChainId: 1,
        burnCompletedAt: new Date("2026-02-21T00:00:00.000Z"),
        startedAt: new Date("2026-02-21T00:00:00.000Z"),
        isSuccess: false,
        hasBurnCompleted: true,
        hasFetchAttestation: true,
        displaySteps: [
          { name: "Burn", state: "success", txHash: `0x${"1".repeat(64)}` },
          { name: "Fetch Attestation", state: "pending" },
          { name: "Mint", state: "pending" },
        ],
        onStepsUpdate: vi.fn(),
      })
    );

    await act(async () => {
      result.current.setMessageExpired("42");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(requestReattestationMock).toHaveBeenCalledWith(1, "42");
    expect(result.current.isAwaitingReattestation).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(10 * 60 * 1000 + 15_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.isAwaitingReattestation).toBe(false);
    expect(result.current.reattestTimedOut).toBe(true);
    expect(result.current.messageExpired).toBe(true);
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Re-attestation delayed",
      })
    );
  });
});
