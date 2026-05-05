/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MintParams } from "@/lib/cctp/types";
import { useMint } from "@/lib/cctp/hooks/useMint";

const updateTransactionMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());
const fetchAttestationUniversalMock = vi.hoisted(() => vi.fn());
const isCompleteAttestationDataMock = vi.hoisted(() => vi.fn());
const checkNonceUsedMock = vi.hoisted(() => vi.fn());
const checkMessageExpirationMock = vi.hoisted(() => vi.fn());
const buildReceiveMessageTransactionMock = vi.hoisted(() => vi.fn());
const refreshMintTransactionMock = vi.hoisted(() => vi.fn());
const sendTransactionNoConfirmMock = vi.hoisted(() => vi.fn());
const estimateSolanaMintGasMock = vi.hoisted(() => vi.fn());
const extractSourceDomainFromMessageMock = vi.hoisted(() => vi.fn());
const extractDestinationDomainFromMessageMock = vi.hoisted(() => vi.fn());

const getBalanceMock = vi.hoisted(() => vi.fn());
const getAccountInfoMock = vi.hoisted(() => vi.fn());
const getSignatureStatusesMock = vi.hoisted(() => vi.fn());
const signTransactionMock = vi.hoisted(() => vi.fn());
const SOLANA_WALLET_ADDRESS = vi.hoisted(
  () => "4Nd1m4h4U6fMeDvfMqk7y6jJxGfSPMaqkN8R7nJxQfQF"
);

vi.mock("wagmi", () => ({
  useWalletClient: () => ({
    data: {
      account: { address: "0x1111111111111111111111111111111111111111" },
      chain: { id: 1, nativeCurrency: { symbol: "ETH" } },
      writeContract: vi.fn(),
      transport: { request: vi.fn() },
    },
  }),
  useBalance: () => ({ data: { value: 1_000_000_000_000_000_000n } }),
}));

vi.mock("@solana/wallet-adapter-react", () => ({
  useWallet: () => ({
    connected: true,
    publicKey: { toBase58: () => SOLANA_WALLET_ADDRESS },
    signTransaction: signTransactionMock,
    wallet: { adapter: {} },
  }),
  useConnection: () => ({
    connection: {
      getBalance: getBalanceMock,
      getAccountInfo: getAccountInfoMock,
      getSignatureStatuses: getSignatureStatusesMock,
    },
  }),
}));

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

vi.mock("@/lib/iris", () => ({
  fetchAttestationUniversal: fetchAttestationUniversalMock,
  isCompleteAttestationData: isCompleteAttestationDataMock,
}));

vi.mock("@/lib/simulation", () => ({
  simulateMint: vi.fn(),
  extractSourceDomainFromMessage: extractSourceDomainFromMessageMock,
  extractDestinationDomainFromMessage: extractDestinationDomainFromMessageMock,
}));

vi.mock("@/lib/cctp/nonce", () => ({
  checkNonceUsed: checkNonceUsedMock,
}));

vi.mock("@/lib/cctp/solana/mint", () => ({
  buildReceiveMessageTransaction: buildReceiveMessageTransactionMock,
  sendTransactionNoConfirm: sendTransactionNoConfirmMock,
  isVersionedTransaction: vi.fn(() => false),
  checkMessageExpiration: checkMessageExpirationMock,
}));

vi.mock("@/lib/cctp/gasEstimation", () => ({
  estimateSolanaMintGas: estimateSolanaMintGasMock,
  estimateEvmMintGas: vi.fn(),
  formatSol: (value: bigint) => value.toString(),
  formatNative: (value: bigint) => value.toString(),
}));

describe("useMint (Solana confirmation flow)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    fetchAttestationUniversalMock.mockResolvedValue({
      status: "complete",
      nonce: "42",
      sourceDomain: 0,
      destinationDomain: 5,
      message: `0x${"1".repeat(300)}`,
      attestation: `0x${"2".repeat(130)}`,
    });
    isCompleteAttestationDataMock.mockReturnValue(true);
    checkNonceUsedMock.mockResolvedValue({ isUsed: false });
    checkMessageExpirationMock.mockResolvedValue({ isExpired: false });
    refreshMintTransactionMock.mockReset();
    buildReceiveMessageTransactionMock.mockResolvedValue({
      mintTransaction: { kind: "mint" },
      recipientOwner: { toBase58: () => SOLANA_WALLET_ADDRESS },
      recipientAta: { toBase58: () => "recipientAta" },
      needsAtaCreation: false,
    });
    extractSourceDomainFromMessageMock.mockReturnValue(0);
    extractDestinationDomainFromMessageMock.mockReturnValue(5);
    signTransactionMock.mockResolvedValue({});
    sendTransactionNoConfirmMock.mockResolvedValue("solanaMintSignature");
    getBalanceMock.mockResolvedValue(2_000_000_000);
    estimateSolanaMintGasMock.mockResolvedValue({
      sufficient: true,
      required: 1n,
      current: 2n,
      breakdown: { ataCreation: false },
    });
    getSignatureStatusesMock.mockResolvedValue({
      value: [{ confirmationStatus: "confirmed" }],
    });
    getAccountInfoMock.mockResolvedValue({ data: Buffer.alloc(0) });
  });

  it("keeps transaction pending until Solana signature is confirmed", async () => {
    const { result } = renderHook(() => useMint());

    const params: MintParams = {
      burnTxHash: `0x${"a".repeat(64)}`,
      sourceChainId: 11155111,
      destinationChainId: "Solana_Devnet",
      targetAddress: SOLANA_WALLET_ADDRESS,
      existingSteps: [
        { name: "Burn", state: "success" },
        { name: "Fetch Attestation", state: "success" },
        { name: "Mint", state: "pending" },
      ],
    };

    let mintResult: unknown;
    await act(async () => {
      mintResult = await result.current.executeMint(params);
    });

    expect(mintResult).toEqual(
      expect.objectContaining({
        success: true,
        mintTxHash: "solanaMintSignature",
      })
    );

    const statusUpdates = updateTransactionMock.mock.calls.filter(
      ([, updates]) => updates?.status
    );

    expect(statusUpdates[0][1]).toEqual(
      expect.objectContaining({
        claimHash: "solanaMintSignature",
        status: "pending",
        bridgeState: "pending",
      })
    );

    expect(statusUpdates[1][1]).toEqual(
      expect.objectContaining({
        claimHash: "solanaMintSignature",
        status: "claimed",
        bridgeState: "success",
      })
    );
    expect(buildReceiveMessageTransactionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationAddress: SOLANA_WALLET_ADDRESS,
      })
    );
  });

  it("rejects a Solana claim with no locked target address before fetching attestation", async () => {
    const { result } = renderHook(() => useMint());

    const params: MintParams = {
      burnTxHash: `0x${"a".repeat(64)}`,
      sourceChainId: 11155111,
      destinationChainId: "Solana_Devnet",
    };

    let mintResult: unknown;
    await act(async () => {
      mintResult = await result.current.executeMint(params);
    });

    expect(mintResult).toEqual(
      expect.objectContaining({
        success: false,
        errorTitle: "Missing recipient wallet",
      })
    );
    expect(fetchAttestationUniversalMock).not.toHaveBeenCalled();
    expect(signTransactionMock).not.toHaveBeenCalled();
  });

  it("allows a helper Solana wallet to claim for a different locked recipient", async () => {
    const { result } = renderHook(() => useMint());
    const recipientAddress = "6PUfdZ3YZpHoxnzMhEEg6KfFKByUQmVeN8CzWnpXqj7x";

    const params: MintParams = {
      burnTxHash: `0x${"a".repeat(64)}`,
      sourceChainId: 11155111,
      destinationChainId: "Solana_Devnet",
      targetAddress: recipientAddress,
    };

    let mintResult: unknown;
    await act(async () => {
      mintResult = await result.current.executeMint(params);
    });

    expect(mintResult).toEqual(
      expect.objectContaining({
        success: true,
        mintTxHash: "solanaMintSignature",
      })
    );
    expect(buildReceiveMessageTransactionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.objectContaining({ toBase58: expect.any(Function) }),
        destinationAddress: recipientAddress,
      })
    );
    expect(signTransactionMock).toHaveBeenCalledWith({ kind: "mint" });
  });

  it("sends split ATA setup before the claim transaction and stores only the claim signature", async () => {
    refreshMintTransactionMock.mockResolvedValue({ kind: "fresh-mint" });
    buildReceiveMessageTransactionMock.mockResolvedValue({
      setupTransaction: { kind: "setup" },
      mintTransaction: { kind: "mint" },
      refreshMintTransaction: refreshMintTransactionMock,
      recipientOwner: { toBase58: () => "recipient" },
      recipientAta: { toBase58: () => "recipientAta" },
      needsAtaCreation: true,
    });
    signTransactionMock
      .mockResolvedValueOnce({ kind: "signed-setup" })
      .mockResolvedValueOnce({ kind: "signed-mint" });
    sendTransactionNoConfirmMock
      .mockResolvedValueOnce("setupSignature")
      .mockResolvedValueOnce("solanaMintSignature");

    const { result } = renderHook(() => useMint());

    const params: MintParams = {
      burnTxHash: `0x${"a".repeat(64)}`,
      sourceChainId: 11155111,
      destinationChainId: "Solana_Devnet",
      targetAddress: SOLANA_WALLET_ADDRESS,
    };

    let mintResult: unknown;
    await act(async () => {
      mintResult = await result.current.executeMint(params);
    });

    expect(mintResult).toEqual(
      expect.objectContaining({
        success: true,
        mintTxHash: "solanaMintSignature",
      })
    );
    expect(signTransactionMock).toHaveBeenNthCalledWith(1, { kind: "setup" });
    expect(refreshMintTransactionMock).toHaveBeenCalledTimes(1);
    expect(signTransactionMock).toHaveBeenNthCalledWith(2, { kind: "fresh-mint" });
    expect(sendTransactionNoConfirmMock).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      { kind: "signed-setup" }
    );
    expect(sendTransactionNoConfirmMock).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      { kind: "signed-mint" }
    );

    const statusUpdates = updateTransactionMock.mock.calls.filter(
      ([, updates]) => updates?.status
    );
    expect(statusUpdates[0][1]).toEqual(
      expect.objectContaining({
        claimHash: "solanaMintSignature",
        status: "pending",
      })
    );
    expect(statusUpdates[1][1]).toEqual(
      expect.objectContaining({
        claimHash: "solanaMintSignature",
        status: "claimed",
      })
    );
  });

  it("rejects Solana source domain mismatch before nonce and transaction build", async () => {
    extractSourceDomainFromMessageMock.mockReturnValue(9);

    const { result } = renderHook(() => useMint());

    const params: MintParams = {
      burnTxHash: `0x${"a".repeat(64)}`,
      sourceChainId: 11155111,
      destinationChainId: "Solana_Devnet",
      targetAddress: SOLANA_WALLET_ADDRESS,
    };

    let mintResult: unknown;
    await act(async () => {
      mintResult = await result.current.executeMint(params);
    });

    expect(mintResult).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining("Wrong source chain"),
      })
    );
    expect(checkNonceUsedMock).not.toHaveBeenCalled();
    expect(buildReceiveMessageTransactionMock).not.toHaveBeenCalled();
  });

  it("rejects Solana destination domain mismatch before nonce and transaction build", async () => {
    extractDestinationDomainFromMessageMock.mockReturnValue(9);

    const { result } = renderHook(() => useMint());

    const params: MintParams = {
      burnTxHash: `0x${"a".repeat(64)}`,
      sourceChainId: 11155111,
      destinationChainId: "Solana_Devnet",
      targetAddress: SOLANA_WALLET_ADDRESS,
    };

    let mintResult: unknown;
    await act(async () => {
      mintResult = await result.current.executeMint(params);
    });

    expect(mintResult).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining("Wrong destination chain"),
      })
    );
    expect(checkNonceUsedMock).not.toHaveBeenCalled();
    expect(buildReceiveMessageTransactionMock).not.toHaveBeenCalled();
  });
});
