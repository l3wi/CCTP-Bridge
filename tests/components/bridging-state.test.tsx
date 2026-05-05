/** @vitest-environment jsdom */

import type { BridgeResult } from "@circle-fin/bridge-kit";
import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BridgingState } from "@/components/bridging-state/bridging-state";
import type { BridgingStateProps } from "@/components/bridging-state/types";
import type { useBurnPolling } from "@/lib/hooks/useBurnPolling";

const updateTransactionMock = vi.hoisted(() => vi.fn());
const burnPollingParams = vi.hoisted(() => ({
  current: undefined as Parameters<typeof useBurnPolling>[0] | undefined,
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ chain: { id: 10 } }),
  useSwitchChain: () => ({ isPending: false }),
  useWalletClient: () => ({ data: undefined }),
}));

vi.mock("@solana/wallet-adapter-react", () => ({
  useWallet: () => ({
    connected: false,
    publicKey: null,
  }),
}));

vi.mock("@/lib/store/transactionStore", () => ({
  useTransactionStore: () => ({
    updateTransaction: updateTransactionMock,
  }),
}));

vi.mock("@/lib/hooks/useBurnPolling", () => ({
  useBurnPolling: (params: Parameters<typeof useBurnPolling>[0]) => {
    burnPollingParams.current = params;
    return {
      confirmed: false,
      failed: false,
      timedOut: false,
      checking: false,
      lastChecked: null,
      reset: vi.fn(),
    };
  },
}));

vi.mock("@/lib/hooks/useMintPolling", () => ({
  useMintPolling: () => ({
    canMint: false,
    alreadyMinted: false,
    attestationReady: false,
    checking: false,
    setAlreadyMinted: vi.fn(),
    setMessageExpired: vi.fn(),
    messageExpired: null,
    requestReattest: vi.fn(),
    isReattesting: false,
    isAwaitingReattestation: false,
    reattestTimedOut: false,
  }),
}));

vi.mock("@/lib/hooks/useClaimHandler", () => ({
  useClaimHandler: () => ({
    handleClaim: vi.fn(),
    isClaiming: false,
  }),
}));

vi.mock("@/components/bridging-state/chain-pair", () => ({
  ChainPair: () => <div data-testid="chain-pair" />,
}));

vi.mock("@/components/bridging-state/step-list", () => ({
  StepList: ({ steps }: { steps: BridgeResult["steps"] }) => (
    <div data-testid="step-list">
      {steps.map((step) => `${step.name}:${step.state}`).join(",")}
    </div>
  ),
}));

vi.mock("@/components/bridging-state/claim-section", () => ({
  ClaimSection: () => <div data-testid="claim-section" />,
}));

vi.mock("@/components/bridging-state/bridge-info", () => ({
  BridgeInfo: () => <div data-testid="bridge-info" />,
}));

function makeProps(
  steps: BridgeResult["steps"],
  overrides: Partial<BridgingStateProps> = {}
): BridgingStateProps {
  return {
    fromChain: { value: "1", label: "Ethereum" },
    toChain: { value: "10", label: "Optimism" },
    amount: "1.00",
    onBack: vi.fn(),
    bridgeResult: {
      amount: "1.00",
      token: "USDC",
      state: "pending",
      provider: "CCTPV2BridgingProvider",
      source: {
        address: "0x1111111111111111111111111111111111111111",
        chain: { chainId: 1, type: "evm", name: "Ethereum" } as never,
      },
      destination: {
        address: "0x2222222222222222222222222222222222222222",
        chain: { chainId: 10, type: "evm", name: "Optimism" } as never,
      },
      steps,
    },
    ...overrides,
  };
}

describe("BridgingState burn polling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    burnPollingParams.current = undefined;
  });

  it("keeps burn polling enabled even when a submitted burn step is present", () => {
    render(
      <BridgingState
        {...makeProps([
          { name: "Burn", state: "success", txHash: `0x${"1".repeat(64)}` },
          { name: "Fetch Attestation", state: "pending" },
          { name: "Mint", state: "pending" },
        ])}
      />
    );

    expect(burnPollingParams.current).toEqual(
      expect.objectContaining({
        burnTxHash: `0x${"1".repeat(64)}`,
        sourceChainId: 1,
        disabled: false,
      })
    );
  });

  it("marks burn success only after burn polling confirms the source transaction", async () => {
    const burnTxHash = `0x${"2".repeat(64)}` as const;
    render(
      <BridgingState
        {...makeProps([
          { name: "Burn", state: "pending", txHash: burnTxHash },
          { name: "Fetch Attestation", state: "pending" },
          { name: "Mint", state: "pending" },
        ])}
      />
    );

    await act(async () => {
      burnPollingParams.current?.onBurnConfirmed?.();
    });

    await waitFor(() => {
      expect(updateTransactionMock).toHaveBeenCalledWith(
        burnTxHash,
        expect.objectContaining({
          status: "pending",
          bridgeState: "pending",
          steps: expect.arrayContaining([
            expect.objectContaining({ name: "Burn", state: "success" }),
          ]),
        })
      );
    });
  });

  it("marks burn error when burn polling reports source transaction failure", async () => {
    const burnTxHash = `0x${"3".repeat(64)}` as const;
    render(
      <BridgingState
        {...makeProps([
          { name: "Burn", state: "pending", txHash: burnTxHash },
          { name: "Fetch Attestation", state: "pending" },
          { name: "Mint", state: "pending" },
        ])}
      />
    );

    await act(async () => {
      burnPollingParams.current?.onBurnFailed?.("Burn transaction reverted on-chain");
    });

    await waitFor(() => {
      expect(updateTransactionMock).toHaveBeenCalledWith(
        burnTxHash,
        expect.objectContaining({
          status: "failed",
          bridgeState: "error",
          steps: expect.arrayContaining([
            expect.objectContaining({
              name: "Burn",
              state: "error",
              errorMessage: "Burn transaction reverted on-chain",
            }),
          ]),
        })
      );
    });
  });
});
