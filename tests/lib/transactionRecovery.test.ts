import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AttestationData } from "@/lib/iris";
import {
  isTransactionRecoveryPendingError,
  recoverTransactionFromBurnHash,
  recoverTransactionFromNonce,
  TransactionRecoveryPendingError,
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
  isCompleteAttestationData: (data: AttestationData | null | undefined) =>
    Boolean(
      data &&
        data.status === "complete" &&
        typeof data.message === "string" &&
        data.message.startsWith("0x") &&
        typeof data.attestation === "string" &&
        data.attestation.startsWith("0x") &&
        typeof data.sourceDomain === "number" &&
        Number.isFinite(data.sourceDomain) &&
        typeof data.destinationDomain === "number" &&
        Number.isFinite(data.destinationDomain)
    ),
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

vi.mock("@/lib/bridgeConfig", () => ({
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

const buildCctpV2Message = (minFinalityThreshold: number): `0x${string}` => {
  const messageBytes = new Uint8Array(148);
  const view = new DataView(messageBytes.buffer);
  view.setUint32(140, minFinalityThreshold, false);
  return `0x${Buffer.from(messageBytes).toString("hex")}`;
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

  it("throws a typed recoverable pending error when Iris has not indexed the burn yet", async () => {
    const burnHash = `0x${"a".repeat(64)}`;
    fetchAttestationUniversalMock.mockResolvedValue(null);

    try {
      await recoverTransactionFromBurnHash(1, burnHash);
      throw new Error("Expected recovery to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(TransactionRecoveryPendingError);
      expect(isTransactionRecoveryPendingError(error)).toBe(true);
      expect(error).toMatchObject({
        code: "TRANSACTION_RECOVERY_PENDING",
        recoverable: true,
        reason: "not_found",
      });
    }
  });

  it("throws a typed recoverable pending error for pending Iris attestation statuses", async () => {
    const burnHash = `0x${"a".repeat(64)}`;
    fetchAttestationUniversalMock.mockResolvedValue({
      status: "pending_confirmations",
      nonce: "123",
      delayReason: "confirmations",
    } satisfies AttestationData);

    await expect(recoverTransactionFromBurnHash(1, burnHash)).rejects.toMatchObject({
      code: "TRANSACTION_RECOVERY_PENDING",
      recoverable: true,
      reason: "pending_confirmations",
      status: "pending_confirmations",
      nonce: "123",
    });
  });

  it("throws a typed recoverable pending error for incomplete complete attestations", async () => {
    const burnHash = `0x${"a".repeat(64)}`;
    fetchAttestationUniversalMock.mockResolvedValue({
      ...baseAttestation,
      destinationDomain: undefined,
    });

    await expect(recoverTransactionFromBurnHash(1, burnHash)).rejects.toMatchObject({
      code: "TRANSACTION_RECOVERY_PENDING",
      recoverable: true,
      reason: "incomplete_attestation",
      status: "complete",
    });
  });

  it("treats nonce lookups with pending attestation and no burn hash as recoverable", async () => {
    fetchAttestationByNonceUniversalMock.mockResolvedValue({
      attestation: {
        status: "pending",
        nonce: "123",
      },
      burnTxHash: undefined,
    });

    await expect(recoverTransactionFromNonce(1, "123")).rejects.toMatchObject({
      code: "TRANSACTION_RECOVERY_PENDING",
      recoverable: true,
      reason: "pending",
      status: "pending",
      nonce: "123",
    });
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

  it("continues recovery when nonce-status check throws and preserves 6-decimal USDC precision", async () => {
    const burnHash = `0x${"a".repeat(64)}`;
    fetchAttestationUniversalMock.mockResolvedValue(baseAttestation);
    checkNonceUsedMock.mockRejectedValue(new Error("rpc down"));

    const result = await recoverTransactionFromBurnHash(1, burnHash);

    expect(result.transaction.hash).toBe(burnHash);
    expect(result.transaction.status).toBe("pending");
    expect(result.transaction.amount).toBe("123456789012345678901234.567890");
    expect(result.transaction.bridgeResult?.source.address).toBe("");
    expect(result.transaction.bridgeResult?.destination.address).toBe(
      "0x1111111111111111111111111111111111111111"
    );
    expect(checkNonceUsedMock).toHaveBeenCalledTimes(1);
  });

  it("derives fast EVM transfers from the recovered CCTP min finality threshold", async () => {
    const burnHash = `0x${"a".repeat(64)}`;
    fetchAttestationUniversalMock.mockResolvedValue({
      ...baseAttestation,
      message: buildCctpV2Message(1000),
    });

    const result = await recoverTransactionFromBurnHash(1, burnHash);

    expect(result.transaction.transferType).toBe("fast");
  });

  it("derives fast Solana transfers from the recovered CCTP min finality threshold", async () => {
    const burnHash = "5Za4L7SolanaSignature";
    fetchAttestationUniversalMock.mockResolvedValue({
      ...baseAttestation,
      message: buildCctpV2Message(1000),
    });

    const result = await recoverTransactionFromBurnHash("Solana", burnHash);

    expect(result.transaction.transferType).toBe("fast");
  });

  it("derives standard Solana transfers from the recovered CCTP min finality threshold", async () => {
    const burnHash = "5Za4L7SolanaSignature";
    fetchAttestationUniversalMock.mockResolvedValue({
      ...baseAttestation,
      message: buildCctpV2Message(2000),
    });

    const result = await recoverTransactionFromBurnHash("Solana", burnHash);

    expect(result.transaction.transferType).toBe("standard");
  });

  it("treats delayed fast attestations as standard fallback transfers", async () => {
    const burnHash = `0x${"a".repeat(64)}`;
    fetchAttestationUniversalMock.mockResolvedValue({
      ...baseAttestation,
      message: buildCctpV2Message(1000),
      delayReason: "insufficient_fee",
    });

    const result = await recoverTransactionFromBurnHash(1, burnHash);

    expect(result.transaction.transferType).toBe("standard");
  });

  it("does not treat a recovered Solana token account as the claimant wallet", async () => {
    const burnHash = `0x${"a".repeat(64)}`;
    const solanaTokenAccount = "Gd7rN5ZcVdVnqmwN5Mw5n7EMmDxXqZ1x64UsdcAta111";
    getChainIdFromDomainUniversalMock.mockReturnValue("Solana_Devnet");
    fetchAttestationUniversalMock.mockResolvedValue({
      ...baseAttestation,
      mintRecipient: solanaTokenAccount,
    });

    const result = await recoverTransactionFromBurnHash(1, burnHash);

    expect(result.transaction.targetChain).toBe("Solana_Devnet");
    expect(result.transaction.targetAddress).toBeUndefined();
    expect(result.transaction.bridgeResult?.destination.address).toBe("");
  });
});
