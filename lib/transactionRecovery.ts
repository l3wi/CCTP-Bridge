import type { BridgeResult } from "@circle-fin/bridge-kit";
import {
  BRIDGEKIT_ENV,
  getBridgeChainByIdUniversal,
} from "@/lib/bridgeKit";
import {
  getChainIdFromDomainUniversal,
  getChainInfoFromDomainAllChains,
} from "@/lib/contracts";
import {
  fetchAttestationUniversal,
  fetchAttestationByNonceUniversal,
  type AttestationData,
} from "@/lib/iris";
import { checkNonceUsed } from "@/lib/cctp/nonce";
import { toChainDefinition } from "@/lib/chainDefinition";
import {
  type ChainId,
  type LocalTransaction,
  type UniversalAddress,
  type UniversalTxHash,
  isSolanaChain,
} from "@/lib/types";
import { normalizeTxHashForChain } from "@/lib/bridgeRoute";

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
    return mintRecipient;
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

export interface RecoverTransactionResult {
  transaction: Omit<LocalTransaction, "date">;
}

export class TransactionRecoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransactionRecoveryError";
  }
}

const buildRecoveredTransaction = async (
  sourceChainId: ChainId,
  burnTxHash: string,
  attestationData: AttestationData
): Promise<RecoverTransactionResult> => {
  if (attestationData.status !== "complete") {
    throw new TransactionRecoveryError("Attestation is not ready yet. Please try again shortly.");
  }

  if (attestationData.destinationDomain === undefined) {
    throw new TransactionRecoveryError(
      "Attestation payload is incomplete. Please wait and try recovery again."
    );
  }

  if (attestationData.sourceDomain === undefined) {
    throw new TransactionRecoveryError(
      "Attestation source domain is unavailable. Please try recovery again."
    );
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

  const destinationDisplayAddress = (targetAddress || attestationData.mintRecipient || "") as string;
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
      transferType: "standard",
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
    throw new TransactionRecoveryError(
      "Transaction not found in Circle Iris. Verify source chain and burn tx hash."
    );
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
    throw new TransactionRecoveryError(
      "Nonce not found in Circle Iris. If this transfer was just created, try again shortly."
    );
  }

  const { attestation, burnTxHash } = lookupResult;
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
