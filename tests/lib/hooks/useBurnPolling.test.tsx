/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBurnPolling } from "@/lib/hooks/useBurnPolling";

const getTransactionReceiptMock = vi.hoisted(() => vi.fn());
const createEvmPublicClientMock = vi.hoisted(() => vi.fn());

vi.mock("wagmi", () => ({
  useWalletClient: () => ({
    data: undefined,
  }),
}));

vi.mock("@/lib/rpc/clients", () => ({
  createEvmPublicClient: createEvmPublicClientMock,
  createSolanaConnection: vi.fn(),
}));

describe("useBurnPolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getTransactionReceiptMock.mockReset();
    createEvmPublicClientMock.mockReset();
    createEvmPublicClientMock.mockReturnValue({
      getTransactionReceipt: getTransactionReceiptMock,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("times out without marking the burn as failed", async () => {
    const onBurnFailed = vi.fn();
    getTransactionReceiptMock.mockResolvedValue(null);

    const { result } = renderHook(() =>
      useBurnPolling({
        burnTxHash: `0x${"1".repeat(64)}`,
        sourceChainId: 1,
        onBurnFailed,
      })
    );

    await act(async () => {
      vi.advanceTimersByTime(61_000);
      await Promise.resolve();
    });

    expect(result.current.timedOut).toBe(true);
    expect(result.current.failed).toBe(false);
    expect(result.current.error).toContain("taking longer than expected");
    expect(onBurnFailed).not.toHaveBeenCalled();
  });

  it("marks burn as failed when chain reports a revert", async () => {
    const onBurnFailed = vi.fn();
    getTransactionReceiptMock.mockResolvedValue({ status: "reverted" });

    const { result } = renderHook(() =>
      useBurnPolling({
        burnTxHash: `0x${"2".repeat(64)}`,
        sourceChainId: 1,
        onBurnFailed,
      })
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.failed).toBe(true);
    expect(result.current.timedOut).toBe(false);
    expect(result.current.error).toContain("reverted");
    expect(onBurnFailed).toHaveBeenCalledTimes(1);
  });

  it("marks burn as confirmed when chain reports success", async () => {
    const onBurnConfirmed = vi.fn();
    getTransactionReceiptMock.mockResolvedValue({ status: "success" });

    const { result } = renderHook(() =>
      useBurnPolling({
        burnTxHash: `0x${"3".repeat(64)}`,
        sourceChainId: 1,
        onBurnConfirmed,
      })
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.confirmed).toBe(true);
    expect(result.current.failed).toBe(false);
    expect(onBurnConfirmed).toHaveBeenCalledTimes(1);
  });
});
