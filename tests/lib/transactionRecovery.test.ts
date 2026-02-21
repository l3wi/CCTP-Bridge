import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AttestationData } from "@/lib/iris";
import {
  recoverTransactionFromBurnHash,
  recoverTransactionFromNonce,
} from "@/lib/transactionRecovery";

const fetchAttestationUniversalMock = vi.hoisted(() => vi.fn());
const fetchAttestationByNonceUniversalMock = vi.hoisted(() => vi.fn());
const checkNonceUsedMock = vi.hoisted(() => vi.fn());
const normalizeTxHashForChainMock = vi.hoisted(() => vi.fn());
const getChainIdFromDomainUniversalMock = vi.hoisted(() => vi.fn());
const getChainInfoFromDomainAllChainsMock = vi.hoisted(() => vi.fn());
const getBridgeChainByIdUniversalMock = vi.hoisted(() => vi.fn());
const toChainDefinitionMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/iris", () => ({
  fetchAttestationUniversal: fetchAttestationUniversalMock,
  fetchAttestationByNonceUniversal: fetchAttestationByNonceUniversalMock,
}));

vi.mock("@/lib/cctp/nonce", () => ({
  checkNonceUsed: checkNonceUsedMock,
}));

vi.mock("@/lib/bridgeRoute", () => ({
  normalizeTxHashForChain: normalizeTxHashForChainMock,
}));

vi.mock("@/lib/contracts", () => ({
  getChainIdFromDomainUniversal: getChainIdFromDomainUniversalMock,
  getChainInfoFromDomainAllChains: getChainInfoFromDomainAllChainsMock,
}));

vi.mock("@/lib/bridgeKit", () => ({
  BRIDGEKIT_ENV: "mainnet",
  getBridgeChainByIdUniversal: getBridgeChainByIdUniversalMock,
}));

vi.mock("@/lib/chainDefinition", () => ({
  toChainDefinition: toChainDefinitionMock,
}));

const baseAttestation: AttestationData = {
  status: "complete",
  nonce: "123",
  sourceDomain: 0,
  destinationDomain: 3,
  message: `0x${"1".repeat(300)}`,
  attestation: `0x${"2".repeat(130)}`,
  amount: "123456789012345678901234567890",
  mintRecipient: "0x1111111111111111111111111111111111111111",
};

describe("transactionRecovery", () => {
  beforeEach(() => {
    fetchAttestationUniversalMock.mockReset();
    fetchAttestationByNonceUniversalMock.mockReset();
    checkNonceUsedMock.mockReset();
    normalizeTxHashForChainMock.mockReset();
    getChainIdFromDomainUniversalMock.mockReset();
    getChainInfoFromDomainAllChainsMock.mockReset();
    getBridgeChainByIdUniversalMock.mockReset();
    toChainDefinitionMock.mockReset();

    normalizeTxHashForChainMock.mockImplementation((_, value: string) => value);
    getChainIdFromDomainUniversalMock.mockReturnValue(42161);
    getChainInfoFromDomainAllChainsMock.mockReturnValue(null);
    getBridgeChainByIdUniversalMock.mockImplementation((chainId: number | string) => {
      if (typeof chainId === "number") {
        return { type: "evm", chainId, name: `EVM-${chainId}` };
      }
      return { type: "solana", chain: chainId, name: chainId };
    });
    toChainDefinitionMock.mockImplementation((chain: unknown) => chain);
    checkNonceUsedMock.mockResolvedValue({ isUsed: false });
  });

  it("throws a clear error when Iris nonce lookup does not include burn hash", async () => {
    fetchAttestationByNonceUniversalMock.mockResolvedValue({
      attestation: baseAttestation,
      burnTxHash: undefined,
    });

    await expect(recoverTransactionFromNonce(1, "123")).rejects.toThrow(
      "burn transaction hash is unavailable"
    );
  });

  it("throws invalid-format error when nonce lookup burn hash fails normalization", async () => {
    fetchAttestationByNonceUniversalMock.mockResolvedValue({
      attestation: baseAttestation,
      burnTxHash: "invalid-hash",
    });
    normalizeTxHashForChainMock.mockReturnValue(null);

    await expect(recoverTransactionFromNonce(1, "123")).rejects.toThrow(
      "invalid format"
    );
  });

  it("continues recovery when nonce-status check throws and formats large amounts safely", async () => {
    const burnHash = `0x${"a".repeat(64)}`;
    fetchAttestationUniversalMock.mockResolvedValue(baseAttestation);
    checkNonceUsedMock.mockRejectedValue(new Error("rpc down"));

    const result = await recoverTransactionFromBurnHash(1, burnHash);

    expect(result.transaction.hash).toBe(burnHash);
    expect(result.transaction.status).toBe("pending");
    expect(result.transaction.amount).toBe("123456789012345678901234.56");
    expect(result.transaction.bridgeResult?.source.address).toBe("");
    expect(result.transaction.bridgeResult?.destination.address).toBe(
      "0x1111111111111111111111111111111111111111"
    );
    expect(checkNonceUsedMock).toHaveBeenCalledTimes(1);
  });
});
