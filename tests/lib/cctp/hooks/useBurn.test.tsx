/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { Keypair, Transaction } from "@solana/web3.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBurn } from "@/lib/cctp/hooks/useBurn";

const sendTransactionMock = vi.hoisted(() => vi.fn());
const waitForTransactionReceiptMock = vi.hoisted(() => vi.fn());
const getTransactionReceiptMock = vi.hoisted(() => vi.fn());
const checkAllowanceMock = vi.hoisted(() => vi.fn());
const calculateMaxFeeMock = vi.hoisted(() => vi.fn());
const createSolanaConnectionMock = vi.hoisted(() => vi.fn());
const buildDepositForBurnTransactionMock = vi.hoisted(() => vi.fn());
const sendSolanaTransactionNoConfirmMock = vi.hoisted(() => vi.fn());
const signSolanaTransactionMock = vi.hoisted(() => vi.fn());
const walletClientState = vi.hoisted(() => ({
  current: undefined as
    | {
        account: { address: `0x${string}` };
        chain: { id: number };
        sendTransaction: typeof sendTransactionMock;
        transport: { request: unknown };
      }
    | undefined,
}));
const solanaWalletState = vi.hoisted(() => ({
  connected: false,
  publicKey: null as ReturnType<typeof Keypair.generate>["publicKey"] | null,
  signTransaction: undefined as typeof signSolanaTransactionMock | undefined,
}));

const createMockSolanaBurnResult = () => {
  const transaction = new Transaction();
  transaction.partialSign = vi.fn();

  return {
    transaction,
    messageAccount: Keypair.generate(),
  };
};

vi.mock("wagmi", () => ({
  useAccount: () => ({
    address: "0x1111111111111111111111111111111111111111",
  }),
  useWalletClient: () => ({
    data: walletClientState.current,
  }),
}));

vi.mock("@solana/wallet-adapter-react", () => ({
  useWallet: () => solanaWalletState,
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/bridgeConfig", () => ({
  BRIDGEKIT_ENV: "testnet",
  getExplorerTxUrlUniversal: () => null,
  getAllSupportedChains: () => [
    { type: "solana", chain: "Solana_Devnet", name: "Solana Devnet", cctp: { domain: 5 } },
    { type: "evm", chainId: 84532, name: "Base Sepolia", cctp: { domain: 6 } },
  ],
}));

vi.mock("@/lib/rpc/clients", () => ({
  createEvmPublicClient: () => ({
    waitForTransactionReceipt: waitForTransactionReceiptMock,
    getTransactionReceipt: getTransactionReceiptMock,
  }),
  createSolanaConnection: createSolanaConnectionMock,
}));

vi.mock("@/lib/cctp/evm/burn", () => ({
  getTokenMessengerAddress: vi.fn(),
  getUsdcAddress: vi.fn(),
  checkAllowance: checkAllowanceMock,
  buildApprovalData: () => ({
    to: "0x2222222222222222222222222222222222222222",
    data: "0xapproval",
  }),
	  buildDepositForBurnData: () => ({
	    to: "0x3333333333333333333333333333333333333333",
	    data: "0xburn",
	  }),
	  buildBridgeWithPreapprovalData: () => ({
	    to: "0x5555555555555555555555555555555555555555",
	    data: "0xbridge",
	  }),
	  calculateMaxFee: calculateMaxFeeMock,
	  prepareEvmBurn: vi.fn().mockResolvedValue({
	    tokenMessenger: "0x2222222222222222222222222222222222222222",
	    usdcAddress: "0x4444444444444444444444444444444444444444",
	    approvalSpender: "0x2222222222222222222222222222222222222222",
	    approvalAmount: 1_000_000n,
	    bridgeAmount: 1_000_000n,
	    destinationDomain: 6,
	    mintRecipient: `0x${"0".repeat(24)}5555555555555555555555555555555555555555`,
	    minFinalityThreshold: 2000,
	    maxFee: 0n,
	    appFeeAmount: 0n,
	  }),
	}));

vi.mock("@/lib/cctp/solana/burn", () => ({
  buildDepositForBurnTransaction: buildDepositForBurnTransactionMock,
  sendTransactionNoConfirm: sendSolanaTransactionNoConfirmMock,
}));

describe("useBurn EVM chain assertions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    walletClientState.current = {
      account: { address: "0x1111111111111111111111111111111111111111" },
      chain: { id: 8453 },
      sendTransaction: sendTransactionMock,
      transport: { request: vi.fn() },
    };
    sendTransactionMock.mockResolvedValue(`0x${"a".repeat(64)}`);
    waitForTransactionReceiptMock.mockResolvedValue({ status: "success" });
    getTransactionReceiptMock.mockResolvedValue({ status: "success" });
    checkAllowanceMock.mockResolvedValue(1_000_000n);
    calculateMaxFeeMock.mockResolvedValue(100n);
    createSolanaConnectionMock.mockReturnValue({});
    buildDepositForBurnTransactionMock.mockResolvedValue(createMockSolanaBurnResult());
    signSolanaTransactionMock.mockImplementation(async (transaction) => transaction);
    sendSolanaTransactionNoConfirmMock.mockResolvedValue("5Za4L7SolanaSignature");
    solanaWalletState.connected = false;
    solanaWalletState.publicKey = null;
    solanaWalletState.signTransaction = undefined;
  });

  it("rejects approval before sending when the wallet is not on the source chain", async () => {
    walletClientState.current!.chain.id = 1;
    const { result } = renderHook(() => useBurn());

    let burnResult: Awaited<ReturnType<typeof result.current.executeBurn>>;
    await act(async () => {
      burnResult = await result.current.executeBurn({
        sourceChainId: 8453,
        destinationChainId: 10,
        amount: 1_000_000n,
        recipientAddress: "0x5555555555555555555555555555555555555555",
        transferSpeed: "standard",
      });
    });

    expect(sendTransactionMock).not.toHaveBeenCalled();
    expect(burnResult!).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining("expected 8453"),
      })
    );
  });

  it("rejects burn before sending when the wallet changes chain after approval", async () => {
    sendTransactionMock.mockImplementation(async () => {
      walletClientState.current!.chain.id = 1;
      return `0x${"b".repeat(64)}`;
    });
    const { result } = renderHook(() => useBurn());

    let burnResult: Awaited<ReturnType<typeof result.current.executeBurn>>;
    await act(async () => {
      burnResult = await result.current.executeBurn({
        sourceChainId: 8453,
        destinationChainId: 10,
        amount: 1_000_000n,
        recipientAddress: "0x5555555555555555555555555555555555555555",
        transferSpeed: "standard",
      });
    });

    expect(sendTransactionMock).toHaveBeenCalledTimes(1);
    expect(burnResult!).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining("expected 8453"),
      })
    );
  });
});

describe("useBurn Solana finality and fast fee safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    walletClientState.current = undefined;
    calculateMaxFeeMock.mockResolvedValue(100n);
    createSolanaConnectionMock.mockReturnValue({});
    buildDepositForBurnTransactionMock.mockResolvedValue(createMockSolanaBurnResult());
    signSolanaTransactionMock.mockImplementation(async (transaction) => transaction);
    sendSolanaTransactionNoConfirmMock.mockResolvedValue("5Za4L7SolanaSignature");
    solanaWalletState.connected = true;
    solanaWalletState.publicKey = Keypair.generate().publicKey;
    solanaWalletState.signTransaction = signSolanaTransactionMock;
  });

  it("builds fast Solana burns with the CCTP v2 fast finality threshold", async () => {
    const { result } = renderHook(() => useBurn());

    let burnResult: Awaited<ReturnType<typeof result.current.executeBurn>>;
    await act(async () => {
      burnResult = await result.current.executeBurn({
        sourceChainId: "Solana_Devnet",
        destinationChainId: 84532,
        amount: 1_000_000n,
        recipientAddress: "0x5555555555555555555555555555555555555555",
        transferSpeed: "fast",
      });
    });

    expect(calculateMaxFeeMock).toHaveBeenCalledWith(5, 6, 1_000_000n, "fast", true);
    expect(buildDepositForBurnTransactionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        minFinalityThreshold: 1000,
        maxFee: 100n,
      })
    );
    expect(signSolanaTransactionMock).toHaveBeenCalledTimes(1);
    expect(sendSolanaTransactionNoConfirmMock).toHaveBeenCalledTimes(1);
    expect(burnResult!).toEqual(
      expect.objectContaining({
        success: true,
        burnTxHash: "5Za4L7SolanaSignature",
      })
    );
  });

  it("builds standard Solana burns with the CCTP v2 standard threshold and no fast fee", async () => {
    const { result } = renderHook(() => useBurn());

    await act(async () => {
      await result.current.executeBurn({
        sourceChainId: "Solana_Devnet",
        destinationChainId: 84532,
        amount: 1_000_000n,
        recipientAddress: "0x5555555555555555555555555555555555555555",
        transferSpeed: "standard",
      });
    });

    expect(calculateMaxFeeMock).not.toHaveBeenCalled();
    expect(buildDepositForBurnTransactionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        minFinalityThreshold: 2000,
        maxFee: 0n,
      })
    );
    expect(signSolanaTransactionMock).toHaveBeenCalledTimes(1);
    expect(sendSolanaTransactionNoConfirmMock).toHaveBeenCalledTimes(1);
  });

  it("blocks fast Solana burns before build/sign/send when fee lookup fails", async () => {
    calculateMaxFeeMock.mockRejectedValue(new Error("fee service unavailable"));
    const { result } = renderHook(() => useBurn());

    let burnResult: Awaited<ReturnType<typeof result.current.executeBurn>>;
    await act(async () => {
      burnResult = await result.current.executeBurn({
        sourceChainId: "Solana_Devnet",
        destinationChainId: 84532,
        amount: 1_000_000n,
        recipientAddress: "0x5555555555555555555555555555555555555555",
        transferSpeed: "fast",
      });
    });

    expect(burnResult!).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining("Unable to fetch"),
      })
    );
    expect(buildDepositForBurnTransactionMock).not.toHaveBeenCalled();
    expect(signSolanaTransactionMock).not.toHaveBeenCalled();
    expect(sendSolanaTransactionNoConfirmMock).not.toHaveBeenCalled();
  });

  it("blocks fast Solana burns before build/sign/send when the fast fee consumes the amount", async () => {
    calculateMaxFeeMock.mockResolvedValue(1_000_000n);
    const { result } = renderHook(() => useBurn());

    let burnResult: Awaited<ReturnType<typeof result.current.executeBurn>>;
    await act(async () => {
      burnResult = await result.current.executeBurn({
        sourceChainId: "Solana_Devnet",
        destinationChainId: 84532,
        amount: 1_000_000n,
        recipientAddress: "0x5555555555555555555555555555555555555555",
        transferSpeed: "fast",
      });
    });

    expect(burnResult!).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining("too small"),
      })
    );
    expect(buildDepositForBurnTransactionMock).not.toHaveBeenCalled();
    expect(signSolanaTransactionMock).not.toHaveBeenCalled();
    expect(sendSolanaTransactionNoConfirmMock).not.toHaveBeenCalled();
  });
});
