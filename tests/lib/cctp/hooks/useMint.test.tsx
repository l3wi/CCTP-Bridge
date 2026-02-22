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
const sendTransactionNoConfirmMock = vi.hoisted(() => vi.fn());
const estimateSolanaMintGasMock = vi.hoisted(() => vi.fn());

const getBalanceMock = vi.hoisted(() => vi.fn());
const getSignatureStatusesMock = vi.hoisted(() => vi.fn());
const signTransactionMock = vi.hoisted(() => vi.fn());

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
    publicKey: { toBase58: () => "4Nd1m4h4U6fMeDvfMqk7y6jJxGfSPMaqkN8R7nJxQfQF" },
    signTransaction: signTransactionMock,
    wallet: { adapter: {} },
  }),
  useConnection: () => ({
    connection: {
      getBalance: getBalanceMock,
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
  extractDestinationDomainFromMessage: vi.fn(() => 3),
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
    buildReceiveMessageTransactionMock.mockResolvedValue({});
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
  });

  it("keeps transaction pending until Solana signature is confirmed", async () => {
    const { result } = renderHook(() => useMint());

    const params: MintParams = {
      burnTxHash: `0x${"a".repeat(64)}`,
      sourceChainId: 11155111,
      destinationChainId: "Solana",
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
  });
});
