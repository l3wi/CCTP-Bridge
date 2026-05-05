/** @vitest-environment jsdom */

import { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BridgeCard } from "@/components/bridge-card";
import type { BridgeIntent } from "@/lib/bridgeIntent";

const mockState = vi.hoisted(() => ({
  evmAddress: "0x8fc8ac124be6cbf4b54aa1b24d27e04156979b7d",
  evmConnected: true,
  solanaRecipient: "4Nd1m4h4U6fMeDvfMqk7y6jJxGfSPMaqkN8R7nJxQfQF" as string | undefined,
}));

const bridgeMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());
const switchChainMock = vi.hoisted(() => vi.fn());
const lastBridgingStateProps = vi.hoisted(() => ({
  value: null as Record<string, unknown> | null,
}));

const ARB_CHAIN = { id: 42161, name: "Arbitrum" };
const ARB_DEF = {
  type: "evm",
  chainId: 42161,
  name: "Arbitrum",
  cctp: { domain: 3 },
};
const SOL_DEF = {
  type: "solana",
  chain: "Solana",
  name: "Solana",
  cctp: { domain: 5 },
};

vi.mock("wagmi", () => ({
  useAccount: () => ({
    address: mockState.evmConnected ? mockState.evmAddress : undefined,
    chain: mockState.evmConnected ? ARB_CHAIN : undefined,
  }),
  useChains: () => [ARB_CHAIN],
  useSwitchChain: () => ({
    switchChain: switchChainMock,
  }),
}));

vi.mock("@solana/wallet-adapter-react", () => ({
  useWallet: () => ({
    connected: true,
    wallet: { adapter: {} },
    publicKey: mockState.solanaRecipient
      ? {
          toBase58: () => mockState.solanaRecipient as string,
        }
      : null,
    signTransaction: vi.fn(),
  }),
}));

vi.mock("@/lib/hooks/useCrossEcosystemBridge", () => ({
  useCrossEcosystemBridge: () => ({
    bridge: bridgeMock,
    isLoading: false,
  }),
}));

vi.mock("@/lib/bridgeKit", () => ({
  getAllSupportedChains: () => [ARB_DEF, SOL_DEF],
  resolveBridgeChainUniversal: (chainId: string | number) =>
    chainId === "Solana" ? SOL_DEF : ARB_DEF,
  getBridgeChainByIdUniversal: (chainId: string | number) =>
    chainId === "Solana" ? SOL_DEF : ARB_DEF,
  getCctpConfirmationsUniversal: () => ({ fast: 3, standard: 32 }),
}));

vi.mock("@/lib/cctpFinality", () => ({
  getFinalityEstimate: () => ({ averageTime: "~1 minute" }),
}));

vi.mock("@/lib/validation", () => ({
  validateAmount: (value: string) => ({
    isValid: value.trim().length > 0,
    parsedAmount: value.trim().length > 0 ? 1n : undefined,
  }),
  validateChainSelection: () => ({ isValid: true }),
  validateBridgeParams: (params: {
    amount?: { bigInt: bigint } | null;
    targetChain?: string | number | null;
    userAddress?: string;
    isCustomAddress?: boolean;
    targetAddress?: string;
  }) => {
    const resolvedAddress = params.isCustomAddress
      ? params.targetAddress
      : params.userAddress;
    if (!params.amount || !params.targetChain || !resolvedAddress) {
      return {
        isValid: false,
        errors: ["Enter Address"],
      };
    }
    return {
      isValid: true,
      errors: [],
      data: {
        amount: params.amount.bigInt,
        targetChain: params.targetChain,
        targetAddress: resolvedAddress,
      },
    };
  },
}));

vi.mock("@/lib/cctp/estimate", () => ({
  estimateBridgeFee: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: null,
    isFetching: false,
    error: null,
    isError: false,
  }),
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({
    toast: toastMock,
  }),
}));

vi.mock("@/components/guards/ConnectGuard", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/guards/SolanaConnectGuard", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/bridging-state", () => ({
  BridgingState: (props: Record<string, unknown>) => {
    lastBridgingStateProps.value = props;
    return <div data-testid="bridging-state" />;
  },
}));

vi.mock("@/components/chain-icon", () => ({
  ChainIcon: () => <span data-testid="chain-icon" />,
}));

vi.mock("@/lib/hooks/useBalance", () => ({
  useBalance: () => ({
    usdcBalance: 10_000_000n,
    usdcFormatted: "10.000000",
    isUsdcLoading: false,
  }),
}));

vi.mock("@/lib/hooks/useSolanaBalance", () => ({
  useSolanaBalance: () => ({
    usdcBalance: 10_000_000n,
    usdcFormatted: "10.000000",
    isLoading: false,
  }),
}));

vi.mock("@/lib/hooks/useDebouncedAddressValidation", () => ({
  useDebouncedAddressValidation: () => ({
    isValidating: false,
    error: null,
    warning: null,
  }),
}));

describe("BridgeCard recipient lock integration", () => {
  beforeEach(() => {
    mockState.evmAddress = "0x8fc8ac124be6cbf4b54aa1b24d27e04156979b7d";
    mockState.evmConnected = true;
    mockState.solanaRecipient = "4Nd1m4h4U6fMeDvfMqk7y6jJxGfSPMaqkN8R7nJxQfQF";
    bridgeMock.mockReset();
    toastMock.mockReset();
    switchChainMock.mockReset();
    lastBridgingStateProps.value = null;

    bridgeMock.mockImplementation(async (params: { targetAddress?: string }) => ({
      amount: "1",
      token: "USDC",
      state: "pending",
      provider: "CCTPV2BridgingProvider",
      source: { address: mockState.evmAddress, chain: ARB_DEF },
      destination: { address: params.targetAddress || "", chain: SOL_DEF },
      steps: [],
    }));
  });

  it("locks the connected destination wallet at click time even if wallet changes right after", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<BridgeCard />);

    const initialRecipient = mockState.solanaRecipient;
    expect(initialRecipient).toBeTruthy();

    await user.type(screen.getByPlaceholderText("0.0"), "1");
    const bridgeFastButtons = screen.getAllByRole("button", {
      name: "Bridge Fast",
    });
    await user.click(bridgeFastButtons[0]);

    // Simulate wallet account swap after submit click
    mockState.solanaRecipient = "H2WfW7Lq2n7e1GvSLjY8qfM4Ad7D2yMkgw3o2DFT8nEA";
    rerender(<BridgeCard />);

    await waitFor(() => expect(bridgeMock).toHaveBeenCalledTimes(1));
    const bridgeParams = bridgeMock.mock.calls[0][0] as { targetAddress?: string };

    expect(bridgeParams.targetAddress).toBe(initialRecipient);
    expect(bridgeParams.targetAddress).not.toBe(mockState.solanaRecipient);
  });

  it("uses newly connected destination wallet instead of stale manual input for cross-ecosystem", async () => {
    const user = userEvent.setup();
    mockState.solanaRecipient = undefined;
    const { rerender } = render(<BridgeCard />);

    await user.type(screen.getByPlaceholderText("0.0"), "1");

    // Manual entry while no destination wallet is connected
    const manualInput = screen.getByPlaceholderText("Solana address...");
    const staleManualAddress = "ManualRecipient11111111111111111111111111111111";
    await user.type(manualInput, staleManualAddress);

    // Destination wallet connects afterwards
    mockState.solanaRecipient = "6fL8jMZg4hJmK2f7gA9wq3pX5rU1vTy3nBk8zQeR4LmP";
    rerender(<BridgeCard />);

    const bridgeFastButtons = screen.getAllByRole("button", {
      name: "Bridge Fast",
    });
    await user.click(bridgeFastButtons[0]);

    await waitFor(() => expect(bridgeMock).toHaveBeenCalledTimes(1));
    const bridgeParams = bridgeMock.mock.calls[0][0] as { targetAddress?: string };

    expect(bridgeParams.targetAddress).toBe(mockState.solanaRecipient);
    expect(bridgeParams.targetAddress).not.toBe(staleManualAddress);
  });

  it("does not copy destination recipient into source.address for loaded fallback bridge result", async () => {
    const loadedTargetAddress = "0x2222222222222222222222222222222222222222";

    render(
      <BridgeCard
        loadedTransaction={{
          hash: `0x${"d".repeat(64)}`,
          originChain: 42161,
          targetChain: "Solana",
          targetAddress: loadedTargetAddress,
          amount: "5.00",
          status: "pending",
          version: "v3",
          date: new Date("2026-02-22T00:00:00.000Z"),
          steps: [
            { name: "Burn", state: "success", txHash: `0x${"d".repeat(64)}` },
            { name: "Fetch Attestation", state: "pending" },
            { name: "Mint", state: "pending" },
          ],
        }}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("bridging-state")).toBeTruthy();
      expect(lastBridgingStateProps.value).toBeTruthy();
    });

    const bridgeResult = lastBridgingStateProps.value?.bridgeResult as
      | { source?: { address?: string }; destination?: { address?: string } }
      | undefined;

    expect(bridgeResult?.source?.address).toBe("");
    expect(bridgeResult?.destination?.address).toBe(loadedTargetAddress);
  });
});

describe("BridgeCard execute intent integration", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  const baseIntent: BridgeIntent = {
    sourceChainId: 42161,
    targetChainId: "Solana",
    amount: "1",
    targetAddress: "4Nd1m4h4U6fMeDvfMqk7y6jJxGfSPMaqkN8R7nJxQfQF",
    transferType: "fast" as const,
  };

  beforeEach(() => {
    mockState.evmAddress = "0x8fc8ac124be6cbf4b54aa1b24d27e04156979b7d";
    mockState.evmConnected = true;
    mockState.solanaRecipient = "4Nd1m4h4U6fMeDvfMqk7y6jJxGfSPMaqkN8R7nJxQfQF";
    bridgeMock.mockReset();
    toastMock.mockReset();
    switchChainMock.mockReset();
    lastBridgingStateProps.value = null;
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("does not retry the same execute intent when bridge submission fails to start", async () => {
    const user = userEvent.setup();
    bridgeMock.mockRejectedValue(new Error("User rejected"));

    render(<BridgeCard mode="executeIntent" initialIntent={baseIntent} />);

    await waitFor(() => expect(bridgeMock).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Bridge Transaction Not Started" })
      ).toBeTruthy();
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(bridgeMock).toHaveBeenCalledTimes(1);
    const backButton = screen.getByRole("button", { name: "Back" });
    expect(backButton).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();

    await user.click(backButton);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(bridgeMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry the same execute intent when source wallet prerequisites are missing", async () => {
    mockState.evmConnected = false;

    render(<BridgeCard mode="executeIntent" initialIntent={baseIntent} />);

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Bridge Transaction Not Started" })
      ).toBeTruthy();
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(bridgeMock).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("attempts again when the execute intent changes", async () => {
    bridgeMock.mockRejectedValue(new Error("User rejected"));

    const { rerender } = render(
      <BridgeCard mode="executeIntent" initialIntent={baseIntent} />
    );

    await waitFor(() => expect(bridgeMock).toHaveBeenCalledTimes(1));

    rerender(
      <BridgeCard
        mode="executeIntent"
        initialIntent={{
          ...baseIntent,
          amount: "2",
        }}
      />
    );

    await waitFor(() => expect(bridgeMock).toHaveBeenCalledTimes(2));
  });
});
