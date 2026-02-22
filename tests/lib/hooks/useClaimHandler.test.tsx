/** @vitest-environment jsdom */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useClaimHandler } from "@/lib/hooks/useClaimHandler";

const switchChainMock = vi.hoisted(() => vi.fn());
const executeMintMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());

vi.mock("wagmi", () => ({
  useSwitchChain: () => ({
    switchChain: switchChainMock,
  }),
}));

vi.mock("@solana/wallet-adapter-react", () => ({
  useWallet: () => ({
    connected: false,
  }),
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({
    toast: toastMock,
  }),
}));

vi.mock("@/lib/cctp/hooks/useMint", () => ({
  useMint: () => ({
    executeMint: executeMintMock,
    isMinting: false,
  }),
}));

describe("useClaimHandler", () => {
  const baseParams = {
    sourceChainId: 42161 as const,
    destinationChainId: 1 as const,
    burnTxHash: `0x${"1".repeat(64)}`,
    displayResult: {
      steps: [{ name: "Fetch Attestation", state: "success" }],
    } as never,
    onSuccess: vi.fn(),
    onDestinationChain: false,
  };

  beforeEach(() => {
    switchChainMock.mockReset();
    executeMintMock.mockReset();
    toastMock.mockReset();
    baseParams.onSuccess.mockReset();
  });

  it("switches chain and returns without auto-claiming when user is on the wrong EVM chain", async () => {
    switchChainMock.mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useClaimHandler({
        ...baseParams,
      })
    );

    await act(async () => {
      await result.current.handleClaim();
    });

    expect(switchChainMock).toHaveBeenCalledWith({ chainId: 1 });
    expect(executeMintMock).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Network switched",
      })
    );
  });

  it("claims immediately when already on destination EVM chain", async () => {
    executeMintMock.mockResolvedValue({
      success: true,
      mintTxHash: `0x${"2".repeat(64)}`,
    });

    const { result } = renderHook(() =>
      useClaimHandler({
        ...baseParams,
        onDestinationChain: true,
      })
    );

    await act(async () => {
      await result.current.handleClaim();
    });

    expect(switchChainMock).not.toHaveBeenCalled();
    expect(executeMintMock).toHaveBeenCalledWith(
      expect.objectContaining({
        burnTxHash: baseParams.burnTxHash,
        sourceChainId: 42161,
        destinationChainId: 1,
      })
    );
    expect(baseParams.onSuccess).toHaveBeenCalledTimes(1);
  });
});
