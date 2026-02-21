/** @vitest-environment jsdom */

import { ReactNode, createContext, useContext } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HistoryModal } from "@/components/history-modal";

const fetchAttestationUniversalMock = vi.hoisted(() => vi.fn());
const addTransactionMock = vi.hoisted(() => vi.fn());
const updateTransactionMock = vi.hoisted(() => vi.fn());
const removeTransactionMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock("wagmi", () => ({
  useChains: () => [{ id: 1, name: "Ethereum" }],
  useAccount: () => ({
    address: "0x1111111111111111111111111111111111111111",
  }),
}));

vi.mock("@solana/wallet-adapter-react", () => ({
  useWallet: () => ({
    publicKey: null,
    connected: false,
  }),
}));

vi.mock("@/components/chain-icon", () => ({
  ChainIcon: () => <span data-testid="chain-icon" />,
}));

vi.mock("@/lib/store/transactionStore", () => ({
  useTransactionStore: () => ({
    transactions: [],
    addTransaction: addTransactionMock,
    updateTransaction: updateTransactionMock,
    removeTransaction: removeTransactionMock,
  }),
}));

vi.mock("@/lib/bridgeKit", () => ({
  BRIDGEKIT_ENV: "mainnet",
  getAllSupportedChains: () => [
    { type: "evm", chainId: 1, name: "Ethereum", cctp: { domain: 0 } },
    { type: "solana", chain: "Solana", name: "Solana", cctp: { domain: 5 } },
  ],
  getBridgeChainByIdUniversal: (chainId: number | string) =>
    chainId === "Solana"
      ? { type: "solana", chain: "Solana", name: "Solana", cctp: { domain: 5 } }
      : { type: "evm", chainId: Number(chainId), name: "Ethereum", cctp: { domain: 0 } },
  getExplorerTxUrlUniversal: () => null,
}));

vi.mock("@/lib/chainDefinition", () => ({
  toChainDefinition: (chain: unknown) => chain,
}));

vi.mock("@/lib/contracts", () => ({
  getChainIdFromDomainUniversal: (domain: number) => (domain === 5 ? "Solana" : null),
  getChainInfoFromDomainAllChains: () => null,
  isNonceUsed: vi.fn(),
}));

vi.mock("@/lib/cctp/shared", () => ({
  getSolanaUsdcMint: () => ({ toBase58: () => "So11111111111111111111111111111111111111112" }),
}));

vi.mock("@/lib/iris", () => ({
  fetchAttestationUniversal: fetchAttestationUniversalMock,
}));

const SelectContext = createContext<{ onValueChange?: (value: string) => void }>({});

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children, onValueChange }: { children: ReactNode; onValueChange?: (value: string) => void }) => (
    <SelectContext.Provider value={{ onValueChange }}>{children}</SelectContext.Provider>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectValue: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => {
    const ctx = useContext(SelectContext);
    return <button onClick={() => ctx.onValueChange?.(value)}>{children}</button>;
  },
}));

describe("HistoryModal add transaction", () => {
  beforeEach(() => {
    addTransactionMock.mockReset();
    updateTransactionMock.mockReset();
    removeTransactionMock.mockReset();
    fetchAttestationUniversalMock.mockReset();

    fetchAttestationUniversalMock.mockResolvedValue({
      status: "complete",
      sourceDomain: 0,
      destinationDomain: 5,
      nonce: "123",
      amount: "1000000",
      mintRecipient: "7ZQwQf6V5fP6wX9t7ZQwQf6V5fP6wX9t7ZQwQf6V5fP",
      message: `0x${"1".repeat(300)}`,
      attestation: `0x${"2".repeat(130)}`,
    });
  });

  it("reuses cached attestation when clicking Add Anyway and avoids a second fetch", async () => {
    const user = userEvent.setup();
    render(<HistoryModal open />);

    const addButtons = screen.getAllByRole("button", { name: /Add.*Transaction/i });
    await user.click(addButtons[0]);
    await user.click(screen.getByRole("button", { name: "Ethereum" }));
    await user.type(screen.getByPlaceholderText("0x..."), `0x${"a".repeat(64)}`);

    await user.click(screen.getByRole("button", { name: /^Add Transaction$/ }));

    await screen.findByText(/Connect your Solana wallet to verify/i);
    expect(fetchAttestationUniversalMock).toHaveBeenCalledTimes(1);

    await user.click(
      screen.getByRole("button", {
        name: /Add Anyway \(without wallet verification\)/i,
      })
    );

    await waitFor(() => expect(addTransactionMock).toHaveBeenCalledTimes(1));
    expect(fetchAttestationUniversalMock).toHaveBeenCalledTimes(1);
  });

  it("prevents duplicate Add Anyway submissions on rapid double-click", async () => {
    const user = userEvent.setup();
    render(<HistoryModal open />);

    const addButtons = screen.getAllByRole("button", { name: /Add.*Transaction/i });
    await user.click(addButtons[0]);
    await user.click(screen.getByRole("button", { name: "Ethereum" }));
    await user.type(screen.getByPlaceholderText("0x..."), `0x${"b".repeat(64)}`);
    await user.click(screen.getByRole("button", { name: /^Add Transaction$/ }));

    const addAnywayButton = await screen.findByRole("button", {
      name: /Add Anyway \(without wallet verification\)/i,
    });

    await user.dblClick(addAnywayButton);

    await waitFor(() => expect(addTransactionMock).toHaveBeenCalledTimes(1));
  });
});
