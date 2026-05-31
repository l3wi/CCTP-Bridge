import type { BridgeResult } from "@circle-fin/bridge-kit";
import {
  BRIDGEKIT_ENV,
  getBridgeChainByIdUniversal,
} from "@/lib/bridgeConfig";
import {
  getChainIdFromDomainUniversal,
  getChainInfoFromDomainAllChains,
} from "@/lib/contracts";
import {
  fetchAttestationUniversal,
  fetchAttestationByNonceUniversal,
  isCompleteAttestationData,
  type AttestationData,
} from "@/lib/iris";
import { checkNonceUsed } from "@/lib/cctp/nonce";
import { FINALITY_THRESHOLDS } from "@/lib/cctp/shared";
import { toChainDefinition } from "@/lib/chainDefinition";
import {
  type ChainId,
  type LocalTransaction,
  type UniversalAddress,
  type UniversalTxHash,
  getChainType,
  isSolanaChain,
} from "@/lib/types";
import { normalizeTxHashForChain } from "@/lib/bridgeRoute";

const CCTP_V2_MIN_FINALITY_THRESHOLD_OFFSET = 140;
const UINT32_BYTE_LENGTH = 4;

const formatAmount = (rawAmount?: string): string | undefined => {
  if (!rawAmount) return undefined;

  try {
    const amountBigInt = BigInt(rawAmount);
    if (amountBigInt <= BigInt(0)) {
      return undefined;
    }

    const scale = 1_000_000n;
    const whole = amountBigInt / scale;
    const fractional = (amountBigInt % scale).toString().padStart(6, "0");
    return `${whole.toString()}.${fractional}`;
  } catch {
    return undefined;
  }
};

const resolveTargetAddress = (
  targetChainId: ChainId,
  mintRecipient?: string
): UniversalAddress | undefined => {
  if (!mintRecipient) return undefined;

  if (isSolanaChain(targetChainId)) {
    // Iris exposes the Solana token account recipient, not the wallet owner.
    // Claiming requires the connected wallet to be the original intended wallet,
    // so route recovery must not treat the token account as a claimant address.
    return undefined;
  }

  const normalized = mintRecipient.trim().toLowerCase();
  const hex = normalized.startsWith("0x")
    ? normalized.slice(2)
    : normalized;

  if (/^[0-9a-f]+$/.test(hex) && hex.length >= 40) {
    return `0x${hex.slice(-40)}` as UniversalAddress;
  }

  return undefined;
};

const readUint32FromHexMessage = (
  message: `0x${string}` | undefined,
  byteOffset: number
): number | undefined => {
  if (!message?.startsWith("0x")) return undefined;

  const start = 2 + byteOffset * 2;
  const end = start + UINT32_BYTE_LENGTH * 2;
  if (message.length < end) return undefined;

  const hexValue = message.slice(start, end);
  if (!/^[0-9a-fA-F]{8}$/.test(hexValue)) return undefined;

  return Number.parseInt(hexValue, 16);
};

const resolveRecoveredTransferType = (
  sourceChainId: ChainId,
  attestationData: AttestationData
): NonNullable<LocalTransaction["transferType"]> => {
  if (attestationData.delayReason) {
    return "standard";
  }

  const minFinalityThreshold = readUint32FromHexMessage(
    attestationData.message,
    CCTP_V2_MIN_FINALITY_THRESHOLD_OFFSET
  );
  const chainType = getChainType(sourceChainId);

  return minFinalityThreshold === FINALITY_THRESHOLDS[chainType].fast
    ? "fast"
    : "standard";
};

export interface RecoverTransactionResult {
  transaction: Omit<LocalTransaction, "date">;
}

export class TransactionRecoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransactionRecoveryError";
  }
}

export type TransactionRecoveryPendingReason =
  | "not_found"
  | "pending"
  | "pending_confirmations"
  | "incomplete_attestation";

export class TransactionRecoveryPendingError extends TransactionRecoveryError {
  readonly code = "TRANSACTION_RECOVERY_PENDING";
  readonly recoverable = true;
  readonly reason: TransactionRecoveryPendingReason;
  readonly status?: AttestationData["status"];
  readonly nonce?: string;
  readonly delayReason?: string;

  constructor({
    reason,
    message,
    status,
    nonce,
    delayReason,
  }: {
    reason: TransactionRecoveryPendingReason;
    message: string;
    status?: AttestationData["status"];
    nonce?: string;
    delayReason?: string;
  }) {
    super(message);
    this.name = "TransactionRecoveryPendingError";
    this.reason = reason;
    this.status = status;
    this.nonce = nonce;
    this.delayReason = delayReason;
  }
}

export const isTransactionRecoveryPendingError = (
  error: unknown
): error is TransactionRecoveryPendingError =>
  error instanceof TransactionRecoveryPendingError ||
  Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "TRANSACTION_RECOVERY_PENDING"
  );

const getPendingRecoveryReason = (
  attestationData: AttestationData | null | undefined
): TransactionRecoveryPendingReason => {
  if (!attestationData) return "not_found";
  if (attestationData.status === "pending") return "pending";
  if (attestationData.status === "pending_confirmations") {
    return "pending_confirmations";
  }
  return "incomplete_attestation";
};

const getPendingRecoveryMessage = (
  reason: TransactionRecoveryPendingReason
): string => {
  switch (reason) {
    case "pending":
      return "Circle Iris is still processing this transfer.";
    case "pending_confirmations":
      return "Circle Iris is waiting for source-chain confirmations.";
    case "incomplete_attestation":
      return "Circle Iris returned an incomplete attestation payload. Waiting for a complete payload.";
    case "not_found":
    default:
      return "Transaction not found in Circle Iris yet. Waiting for Circle to index the burn.";
  }
};

const createPendingRecoveryError = (
  attestationData: AttestationData | null | undefined
): TransactionRecoveryPendingError => {
  const reason = getPendingRecoveryReason(attestationData);

  return new TransactionRecoveryPendingError({
    reason,
    message: getPendingRecoveryMessage(reason),
    status: attestationData?.status,
    nonce: attestationData?.nonce,
    delayReason: attestationData?.delayReason,
  });
};

const buildRecoveredTransaction = async (
  sourceChainId: ChainId,
  burnTxHash: string,
  attestationData: AttestationData
): Promise<RecoverTransactionResult> => {
  if (!isCompleteAttestationData(attestationData)) {
    throw createPendingRecoveryError(attestationData);
  }

  const targetChainId = getChainIdFromDomainUniversal(
    attestationData.destinationDomain,
    BRIDGEKIT_ENV
  );

  if (!targetChainId) {
    const chainInfo = getChainInfoFromDomainAllChains(attestationData.destinationDomain);
    if (chainInfo) {
      const expectedEnv = BRIDGEKIT_ENV === "testnet" ? "testnet" : "mainnet";
      if (chainInfo.isTestnet !== (BRIDGEKIT_ENV === "testnet")) {
        throw new TransactionRecoveryError(
          `Destination is on ${chainInfo.isTestnet ? "testnet" : "mainnet"}, but app is in ${expectedEnv} mode`
        );
      }

      throw new TransactionRecoveryError(
        `Destination chain ${chainInfo.name} is not supported in this app`
      );
    }

    throw new TransactionRecoveryError(
      `Unknown destination domain (${attestationData.destinationDomain})`
    );
  }

  const sourceChainDef = getBridgeChainByIdUniversal(sourceChainId, BRIDGEKIT_ENV);
  const destinationChainDef = getBridgeChainByIdUniversal(targetChainId, BRIDGEKIT_ENV);

  if (!sourceChainDef || !destinationChainDef) {
    throw new TransactionRecoveryError("Could not resolve source or destination chain metadata");
  }

  const amount = formatAmount(attestationData.amount);
  const targetAddress = resolveTargetAddress(targetChainId, attestationData.mintRecipient);

  let isAlreadyClaimed = false;
  if (attestationData.message) {
    try {
      const nonceResult = await checkNonceUsed(
        targetChainId,
        attestationData.message
      );
      isAlreadyClaimed = nonceResult.isUsed;
    } catch (error) {
      console.warn("Nonce status check failed during recovery, assuming pending:", error);
    }
  }

  const steps: BridgeResult["steps"] = [
    {
      name: "Burn",
      state: "success",
      txHash: burnTxHash,
    },
    {
      name: "Fetch Attestation",
      state: "success",
    },
    {
      name: "Mint",
      state: isAlreadyClaimed ? "success" : "pending",
    },
  ];

  const status: LocalTransaction["status"] = isAlreadyClaimed ? "claimed" : "pending";
  const bridgeState: BridgeResult["state"] = isAlreadyClaimed ? "success" : "pending";
  const transferType = resolveRecoveredTransferType(sourceChainId, attestationData);

  const destinationDisplayAddress = (targetAddress ||
    (isSolanaChain(targetChainId) ? "" : attestationData.mintRecipient) ||
    "") as string;
  // Iris attestation payloads do not include the original burn wallet sender.
  const sourceDisplayAddress = "";

  const bridgeResult: BridgeResult = {
    state: bridgeState,
    provider: "CCTPV2BridgingProvider",
    amount: amount || "0",
    token: "USDC",
    source: {
      address: sourceDisplayAddress,
      chain: toChainDefinition(sourceChainDef),
    },
    destination: {
      address: destinationDisplayAddress,
      chain: toChainDefinition(destinationChainDef),
    },
    steps,
  };

  return {
    transaction: {
      hash: burnTxHash as UniversalTxHash,
      originChain: sourceChainId,
      targetChain: targetChainId,
      targetAddress,
      amount,
      status,
      version: "v3",
      transferType,
      steps,
      bridgeState,
      bridgeResult,
      nonce: attestationData.nonce,
    },
  };
};

export async function recoverTransactionFromBurnHash(
  sourceChainId: ChainId,
  burnTxHash: string
): Promise<RecoverTransactionResult> {
  const normalizedHash = normalizeTxHashForChain(sourceChainId, burnTxHash);
  if (!normalizedHash) {
    throw new TransactionRecoveryError("Invalid burn transaction hash for source chain");
  }

  const attestationData = await fetchAttestationUniversal(sourceChainId, normalizedHash);

  if (!attestationData) {
    throw createPendingRecoveryError(attestationData);
  }

  return buildRecoveredTransaction(sourceChainId, normalizedHash, attestationData);
}

export async function recoverTransactionFromNonce(
  sourceChainId: ChainId,
  nonce: string
): Promise<RecoverTransactionResult> {
  const normalizedNonce = nonce.trim();
  if (!normalizedNonce) {
    throw new TransactionRecoveryError("Invalid nonce");
  }

  const lookupResult = await fetchAttestationByNonceUniversal(
    sourceChainId,
    normalizedNonce
  );

  if (!lookupResult) {
    throw createPendingRecoveryError(null);
  }

  const { attestation, burnTxHash } = lookupResult;
  if (!isCompleteAttestationData(attestation)) {
    throw createPendingRecoveryError(attestation);
  }

  if (!burnTxHash) {
    throw new TransactionRecoveryError(
      "Found nonce in Iris, but burn transaction hash is unavailable for this source chain."
    );
  }
  const normalizedHash = normalizeTxHashForChain(sourceChainId, burnTxHash);

  if (!normalizedHash) {
    throw new TransactionRecoveryError(
      "Found nonce in Iris, but burn transaction hash has an invalid format for this source chain."
    );
  }

  return buildRecoveredTransaction(sourceChainId, normalizedHash, attestation);
}
