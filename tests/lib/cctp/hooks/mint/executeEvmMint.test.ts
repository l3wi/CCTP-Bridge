import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeEvmMint } from "@/lib/cctp/hooks/mint/executeEvmMint";

const fetchAttestationUniversalMock = vi.hoisted(() => vi.fn());
const isCompleteAttestationDataMock = vi.hoisted(() => vi.fn());
const simulateMintMock = vi.hoisted(() => vi.fn());
const getMessageTransmitterAddressMock = vi.hoisted(() => vi.fn());
const getCctpDomainSafeMock = vi.hoisted(() => vi.fn());
const estimateEvmMintGasMock = vi.hoisted(() => vi.fn());
const waitForTransactionReceiptMock = vi.hoisted(() => vi.fn());
const getCodeMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/iris", () => ({
  fetchAttestationUniversal: fetchAttestationUniversalMock,
  isCompleteAttestationData: isCompleteAttestationDataMock,
}));

vi.mock("@/lib/simulation", () => ({
  simulateMint: simulateMintMock,
  extractDestinationDomainFromMessage: vi.fn(() => 6),
}));

vi.mock("@/lib/contracts", () => ({
  getMessageTransmitterAddress: getMessageTransmitterAddressMock,
  MESSAGE_TRANSMITTER_ABI: [],
}));

vi.mock("@/lib/cctp/shared", () => ({
  getCctpDomainSafe: getCctpDomainSafeMock,
}));

vi.mock("@/lib/cctp/gasEstimation", () => ({
  estimateEvmMintGas: estimateEvmMintGasMock,
  formatNative: (value: bigint) => value.toString(),
}));

vi.mock("@/lib/rpc/clients", () => ({
  createEvmPublicClient: () => ({
    getCode: getCodeMock,
    waitForTransactionReceipt: waitForTransactionReceiptMock,
  }),
}));

vi.mock("@/lib/bridgeConfig", () => ({
  getExplorerTxUrl: () => null,
}));

const createWalletClient = () => ({
  account: { address: "0x1111111111111111111111111111111111111111" as const },
  chain: { id: 84532, nativeCurrency: { symbol: "ETH" } },
  writeContract: vi.fn().mockResolvedValue(`0x${"b".repeat(64)}`),
});

describe("executeEvmMint gas preflight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchAttestationUniversalMock.mockResolvedValue({
      status: "complete",
      nonce: "42",
      sourceDomain: 0,
      destinationDomain: 6,
      message: `0x${"1".repeat(300)}`,
      attestation: `0x${"2".repeat(130)}`,
    });
    isCompleteAttestationDataMock.mockReturnValue(true);
    simulateMintMock.mockResolvedValue({
      success: true,
      canMint: true,
      alreadyMinted: false,
    });
    getMessageTransmitterAddressMock.mockReturnValue(
      "0x2222222222222222222222222222222222222222"
    );
    getCctpDomainSafeMock.mockReturnValue(6);
    waitForTransactionReceiptMock.mockResolvedValue({ status: "success" });
  });

  it("does not block zero-native smart contract accounts before sponsored gas wallets can submit", async () => {
    const walletClient = createWalletClient();
    getCodeMock.mockResolvedValue("0x1234");

    const result = await executeEvmMint({
      burnTxHash: `0x${"a".repeat(64)}`,
      sourceChainId: 11155111,
      destinationChainId: 84532,
      userNativeBalance: 0n,
      walletClient: walletClient as never,
      updateTransaction: vi.fn(),
      toast: vi.fn(),
    });

    expect(estimateEvmMintGasMock).not.toHaveBeenCalled();
    expect(walletClient.writeContract).toHaveBeenCalledTimes(1);
    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        mintTxHash: `0x${"b".repeat(64)}`,
      })
    );
  });

  it("still blocks zero-native EOA accounts before submitting", async () => {
    const walletClient = createWalletClient();
    getCodeMock.mockResolvedValue("0x");
    estimateEvmMintGasMock.mockResolvedValue({
      sufficient: false,
      required: 10n,
      current: 0n,
    });

    const result = await executeEvmMint({
      burnTxHash: `0x${"a".repeat(64)}`,
      sourceChainId: 11155111,
      destinationChainId: 84532,
      userNativeBalance: 0n,
      walletClient: walletClient as never,
      updateTransaction: vi.fn(),
      toast: vi.fn(),
    });

    expect(estimateEvmMintGasMock).toHaveBeenCalledTimes(1);
    expect(walletClient.writeContract).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining("Insufficient ETH for gas"),
      })
    );
  });
});
