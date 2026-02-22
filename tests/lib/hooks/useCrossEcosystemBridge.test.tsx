/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCrossEcosystemBridge } from "@/lib/hooks/useCrossEcosystemBridge";

const executeBurnMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());
const addTransactionMock = vi.hoisted(() => vi.fn());
const updateTransactionMock = vi.hoisted(() => vi.fn());

vi.mock("wagmi", () => ({
  useWalletClient: () => ({
    data: {
      account: { address: "0x1111111111111111111111111111111111111111" },
      chain: { id: 1 },
      transport: { request: vi.fn() },
    },
  }),
}));

vi.mock("@solana/wallet-adapter-react", () => ({
  useWallet: () => ({
    connected: true,
    wallet: { adapter: {} },
    publicKey: {
      toBase58: () => "4Nd1m4h4U6fMeDvfMqk7y6jJxGfSPMaqkN8R7nJxQfQF",
    },
  }),
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@/lib/bridgeKit", () => ({
  getProviderFromWalletClient: () => ({ request: vi.fn() }),
  resolveBridgeChainUniversal: (chainId: number | string) =>
    typeof chainId === "number"
      ? { type: "evm", chainId, name: `EVM-${chainId}` }
      : { type: "solana", chain: chainId, name: String(chainId) },
}));

vi.mock("@/lib/chainDefinition", () => ({
  toChainDefinition: (value: unknown) => value,
}));

vi.mock("@/lib/cctp/hooks/useBurn", () => ({
  useBurn: () => ({ executeBurn: executeBurnMock }),
}));

vi.mock("@/lib/store/transactionStore", () => ({
  useTransactionStore: () => ({
    addTransaction: addTransactionMock,
    updateTransaction: updateTransactionMock,
  }),
}));

describe("useCrossEcosystemBridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits a single failure toast when burn execution returns success=false", async () => {
    executeBurnMock.mockResolvedValue({
      success: false,
      error: "Burn transaction failed",
    });

    const { result } = renderHook(() => useCrossEcosystemBridge());

    await act(async () => {
      await expect(
        result.current.bridge({
          amount: 1_000_000n,
          sourceChainId: 1,
          targetChainId: 8453,
          targetAddress: "0x2222222222222222222222222222222222222222",
          transferType: "standard",
        })
      ).rejects.toThrow("Burn transaction failed");
    });

    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Bridge failed",
      })
    );
  });
});
