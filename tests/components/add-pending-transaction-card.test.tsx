/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Keypair } from "@solana/web3.js";
import { AddPendingTransactionCard } from "@/components/add-pending-transaction-card";
import { verifyRecoveredSolanaRecipient } from "@/lib/cctp/solana/recipient";

const addTransactionMock = vi.hoisted(() => vi.fn());
const fetchAttestationUniversalMock = vi.hoisted(() => vi.fn());
const fetchAttestationByNonceUniversalMock = vi.hoisted(() => vi.fn());
const isNonceUsedMock = vi.hoisted(() => vi.fn());
const getChainIdFromDomainUniversalMock = vi.hoisted(() => vi.fn());
const getAssociatedTokenAddressSyncMock = vi.hoisted(() => vi.fn());
const solanaWalletState = vi.hoisted(() => ({
  publicKey: null as { toBase58: () => string } | null,
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({
    address: "0x1111111111111111111111111111111111111111",
  }),
}));

vi.mock("@solana/wallet-adapter-react", () => ({
  useWallet: () => solanaWalletState,
}));

vi.mock("@solana/spl-token", () => ({
  getAssociatedTokenAddressSync: getAssociatedTokenAddressSyncMock,
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

vi.mock("@/lib/bridgeConfig", () => ({
  BRIDGEKIT_ENV: "testnet",
  getAllSupportedChains: () => [
    { type: "evm", chainId: 11155111, name: "Ethereum Sepolia", cctp: { domain: 0 } },
    { type: "evm", chainId: 84532, name: "Base Sepolia", cctp: { domain: 6 } },
    { type: "solana", chain: "Solana_Devnet", name: "Solana Devnet", cctp: { domain: 5 } },
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
  getCctpDomainIdUniversal: (chainId: number | string) =>
    chainId === 11155111 ? 0 : chainId === 84532 ? 6 : 5,
  getChainIdFromDomainUniversal: getChainIdFromDomainUniversalMock,
  getChainInfoFromDomainAllChains: () => null,
  isNonceUsed: isNonceUsedMock,
}));

vi.mock("@/lib/iris", () => ({
  fetchAttestationByNonceUniversal: fetchAttestationByNonceUniversalMock,
  fetchAttestationUniversal: fetchAttestationUniversalMock,
}));

vi.mock("@/lib/cctp/shared", () => ({
  getSolanaUsdcMint: () => ({ toBuffer: () => Buffer.alloc(32), toBase58: () => "usdcMint" }),
}));

describe("AddPendingTransactionCard", () => {
  const helperWallet = Keypair.fromSeed(new Uint8Array(32).fill(3)).publicKey;
  const recipientWallet = Keypair.fromSeed(new Uint8Array(32).fill(4)).publicKey;

  beforeEach(() => {
    vi.clearAllMocks();
    solanaWalletState.publicKey = null;
    getChainIdFromDomainUniversalMock.mockReturnValue(84532);
    getAssociatedTokenAddressSyncMock.mockImplementation((_, owner: { toBase58: () => string }) => ({
      toBase58: () =>
        owner.toBase58() === recipientWallet.toBase58()
          ? "recipientUsdcAta"
          : "helperUsdcAta",
    }));
    isNonceUsedMock.mockResolvedValue(false);
    fetchAttestationByNonceUniversalMock.mockResolvedValue(null);
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
    const onTransactionAdded = vi.fn();
    const burnHash = `0x${"a".repeat(64)}`;

    render(
      <AddPendingTransactionCard
        initialSourceChainId={11155111}
        initialTxHash={burnHash}
        onTransactionAdded={onTransactionAdded}
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
    expect(onTransactionAdded).toHaveBeenCalledWith({
      sourceChainId: 11155111,
      routeId: burnHash,
      hash: burnHash,
    });
  });

  it("requires and stores the Solana recipient wallet owner for assisted recovery", async () => {
    const user = userEvent.setup();
    solanaWalletState.publicKey = helperWallet;
    getChainIdFromDomainUniversalMock.mockReturnValue("Solana_Devnet");
    fetchAttestationUniversalMock.mockResolvedValue({
      status: "complete",
      sourceDomain: 0,
      destinationDomain: 5,
      nonce: "43",
      amount: "1000000",
      mintRecipient: "recipientUsdcAta",
      message: `0x${"1".repeat(300)}`,
      attestation: `0x${"2".repeat(130)}`,
    });

    render(
      <AddPendingTransactionCard
        initialSourceChainId={11155111}
        initialTxHash={`0x${"b".repeat(64)}`}
      />
    );

    await user.click(screen.getByRole("button", { name: /add transaction/i }));

    expect(await screen.findByText(/does not match the recipient encoded/i)).toBeTruthy();
    expect(addTransactionMock).not.toHaveBeenCalled();

    await user.type(
      screen.getByLabelText(/recipient solana wallet/i),
      recipientWallet.toBase58()
    );
    await user.click(screen.getByRole("button", { name: /add transaction/i }));

    await waitFor(() => {
      expect(addTransactionMock).toHaveBeenCalledTimes(1);
    });

    const added = addTransactionMock.mock.calls[0][0] as {
      bridgeResult?: { destination?: { address?: string } };
      targetAddress?: string;
    };

    expect(added.targetAddress).toBe(recipientWallet.toBase58());
    expect(added.bridgeResult?.destination?.address).toBe(recipientWallet.toBase58());
    expect(added.targetAddress).not.toBe("recipientUsdcAta");
  });

  it("verifies recovered Solana recipient owners against the attested ATA", () => {
    const result = verifyRecoveredSolanaRecipient({
      candidateRecipientAddress: recipientWallet.toBase58(),
      mintRecipientAta: "recipientUsdcAta",
      destinationChainId: "Solana_Devnet",
    });

    expect(result).toEqual({
      ok: true,
      recipientAddress: recipientWallet.toBase58(),
    });
  });

  it("shows an actionable CCTP source-chain error when Iris has no message", async () => {
    const user = userEvent.setup();
    fetchAttestationUniversalMock.mockResolvedValue(null);

    render(
      <AddPendingTransactionCard
        initialSourceChainId={11155111}
        initialTxHash={`0x${"c".repeat(64)}`}
      />
    );

    await user.click(screen.getByRole("button", { name: /add transaction/i }));

    expect(
      await screen.findByText(/No Circle CCTP v2 message was found for Ethereum Sepolia testnet, CCTP domain 0/i)
    ).toBeTruthy();
    expect(
      screen.getByText(/source burn transaction hash, not the destination wallet or claim transaction/i)
    ).toBeTruthy();
    expect(addTransactionMock).not.toHaveBeenCalled();
  });

  it("explains when a CCTP nonce was submitted instead of the burn transaction hash", async () => {
    const user = userEvent.setup();
    const nonce = `0x${"d".repeat(64)}`;
    fetchAttestationUniversalMock.mockResolvedValue(null);
    fetchAttestationByNonceUniversalMock.mockResolvedValue({
      burnTxHash: undefined,
      attestation: {
        status: "complete",
        sourceDomain: 0,
        destinationDomain: 5,
        nonce,
        amount: "1000000",
        mintRecipient: "recipientUsdcAta",
        message: `0x${"1".repeat(300)}`,
        attestation: `0x${"2".repeat(130)}`,
      },
    });

    render(
      <AddPendingTransactionCard
        initialSourceChainId={11155111}
        initialTxHash={nonce}
      />
    );

    await user.click(screen.getByRole("button", { name: /add transaction/i }));

    expect(await screen.findByText(/CCTP nonce/i)).toBeTruthy();
    expect(screen.getByText(/source burn transaction hash/i)).toBeTruthy();
    expect(addTransactionMock).not.toHaveBeenCalled();
  });
});
