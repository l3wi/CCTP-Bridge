/** @vitest-environment jsdom */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useClaimHandler } from "@/lib/hooks/useClaimHandler";

const switchChainMock = vi.hoisted(() => vi.fn());
const executeMintMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());
const solanaWalletState = vi.hoisted(() => ({
  connected: false,
  publicKey: null as { toBase58: () => string } | null,
}));
const SOLANA_WALLET_ADDRESS = vi.hoisted(
  () => "4Nd1m4h4U6fMeDvfMqk7y6jJxGfSPMaqkN8R7nJxQfQF"
);

vi.mock("wagmi", () => ({
  useSwitchChain: () => ({
    switchChain: switchChainMock,
  }),
}));

vi.mock("@solana/wallet-adapter-react", () => ({
  useWallet: () => solanaWalletState,
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
    solanaWalletState.connected = false;
    solanaWalletState.publicKey = null;
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

  it("allows a connected helper wallet to claim for a different locked Solana recipient", async () => {
    solanaWalletState.connected = true;
    solanaWalletState.publicKey = {
      toBase58: () => "6PUfdZ3YZpHoxnzMhEEg6KfFKByUQmVeN8CzWnpXqj7x",
    };
    executeMintMock.mockResolvedValue({
      success: true,
      mintTxHash: "solanaMintSignature",
    });

    const { result } = renderHook(() =>
      useClaimHandler({
        ...baseParams,
        destinationChainId: "Solana",
        onDestinationChain: true,
        displayResult: {
          destination: { address: SOLANA_WALLET_ADDRESS },
          steps: [{ name: "Fetch Attestation", state: "success" }],
        } as never,
      })
    );

    await act(async () => {
      await result.current.handleClaim();
    });

    expect(executeMintMock).toHaveBeenCalledWith(
      expect.objectContaining({
        burnTxHash: baseParams.burnTxHash,
        sourceChainId: 42161,
        destinationChainId: "Solana",
        targetAddress: SOLANA_WALLET_ADDRESS,
      })
    );
    expect(baseParams.onSuccess).toHaveBeenCalledTimes(1);
  });

  it("passes the locked Solana recipient address into executeMint", async () => {
    solanaWalletState.connected = true;
    solanaWalletState.publicKey = { toBase58: () => SOLANA_WALLET_ADDRESS };
    executeMintMock.mockResolvedValue({
      success: true,
      mintTxHash: "solanaMintSignature",
    });

    const { result } = renderHook(() =>
      useClaimHandler({
        ...baseParams,
        destinationChainId: "Solana",
        onDestinationChain: true,
        displayResult: {
          destination: { address: SOLANA_WALLET_ADDRESS },
          steps: [{ name: "Fetch Attestation", state: "success" }],
        } as never,
      })
    );

    await act(async () => {
      await result.current.handleClaim();
    });

    expect(executeMintMock).toHaveBeenCalledWith(
      expect.objectContaining({
        burnTxHash: baseParams.burnTxHash,
        sourceChainId: 42161,
        destinationChainId: "Solana",
        targetAddress: SOLANA_WALLET_ADDRESS,
      })
    );
    expect(baseParams.onSuccess).toHaveBeenCalledTimes(1);
  });
});
