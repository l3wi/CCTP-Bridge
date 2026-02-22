/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AddPendingTransactionCard } from "@/components/add-pending-transaction-card";

const addTransactionMock = vi.hoisted(() => vi.fn());
const fetchAttestationUniversalMock = vi.hoisted(() => vi.fn());
const isNonceUsedMock = vi.hoisted(() => vi.fn());

vi.mock("wagmi", () => ({
  useAccount: () => ({
    address: "0x1111111111111111111111111111111111111111",
  }),
}));

vi.mock("@solana/wallet-adapter-react", () => ({
  useWallet: () => ({
    publicKey: null,
  }),
}));

vi.mock("@/components/chain-icon", () => ({
  ChainIcon: () => <span data-testid="chain-icon" />,
}));

vi.mock("@/lib/store/transactionStore", () => ({
  useTransactionStore: () => ({
    transactions: [],
    addTransaction: addTransactionMock,
  }),
}));

vi.mock("@/lib/bridgeKit", () => ({
  BRIDGEKIT_ENV: "testnet",
  getAllSupportedChains: () => [
    { type: "evm", chainId: 11155111, name: "Ethereum Sepolia", cctp: { domain: 0 } },
    { type: "evm", chainId: 84532, name: "Base Sepolia", cctp: { domain: 6 } },
  ],
  getBridgeChainByIdUniversal: (chainId: number | string) =>
    typeof chainId === "number"
      ? { type: "evm", chainId, name: `EVM-${chainId}` }
      : { type: "solana", chain: chainId, name: String(chainId) },
}));

vi.mock("@/lib/chainDefinition", () => ({
  toChainDefinition: (chain: unknown) => chain,
}));

vi.mock("@/lib/contracts", () => ({
  getChainIdFromDomainUniversal: () => 84532,
  getChainInfoFromDomainAllChains: () => null,
  isNonceUsed: isNonceUsedMock,
}));

vi.mock("@/lib/iris", () => ({
  fetchAttestationUniversal: fetchAttestationUniversalMock,
}));

vi.mock("@/lib/cctp/shared", () => ({
  getSolanaUsdcMint: () => ({ toBuffer: () => Buffer.alloc(32) }),
}));

describe("AddPendingTransactionCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isNonceUsedMock.mockResolvedValue(false);
    fetchAttestationUniversalMock.mockResolvedValue({
      status: "complete",
      sourceDomain: 0,
      destinationDomain: 6,
      nonce: "42",
      amount: "1000000",
      mintRecipient: "0x0000000000000000000000002222222222222222222222222222222222222222",
      message: `0x${"1".repeat(300)}`,
      attestation: `0x${"2".repeat(130)}`,
    });
  });

  it("stores recovered fallback bridgeResult with empty source.address and recipient destination", async () => {
    const user = userEvent.setup();

    render(
      <AddPendingTransactionCard
        initialSourceChainId={11155111}
        initialTxHash={`0x${"a".repeat(64)}`}
      />
    );

    await user.click(screen.getByRole("button", { name: /add transaction/i }));

    await waitFor(() => {
      expect(addTransactionMock).toHaveBeenCalledTimes(1);
    });

    const added = addTransactionMock.mock.calls[0][0] as {
      bridgeResult?: { source?: { address?: string }; destination?: { address?: string } };
      targetAddress?: string;
    };

    expect(added.bridgeResult?.source?.address).toBe("");
    expect(added.bridgeResult?.destination?.address).toBe(
      "0x2222222222222222222222222222222222222222"
    );
    expect(added.targetAddress).toBe("0x2222222222222222222222222222222222222222");
  });
});
