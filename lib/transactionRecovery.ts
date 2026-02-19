import type { BridgeResult, ChainDefinition } from "@circle-fin/bridge-kit";
import {
  BRIDGEKIT_ENV,
  getBridgeChainByIdUniversal,
} from "@/lib/bridgeKit";
import {
  getChainIdFromDomainUniversal,
  getChainInfoFromDomainAllChains,
  isNonceUsed,
} from "@/lib/contracts";
import { fetchAttestationUniversal } from "@/lib/iris";
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

    return (Number(amountBigInt) / 1_000_000).toFixed(2);
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

  if (!mintRecipient.startsWith("0x")) {
    return mintRecipient.toLowerCase();
  }

  return (`0x${mintRecipient.slice(-40)}` as UniversalAddress).toLowerCase() as UniversalAddress;
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
  if (attestationData.status === "complete" && !isSolanaChain(targetChainId)) {
    const nonceUsed = await isNonceUsed(
      targetChainId as number,
      attestationData.sourceDomain,
      attestationData.nonce,
      BRIDGEKIT_ENV
    );
    isAlreadyClaimed = nonceUsed === true;
  }

  const attestationReady = attestationData.status === "complete";
  const steps: BridgeResult["steps"] = [
    {
      name: "Burn",
      state: "success",
      txHash: normalizedHash,
    },
    {
      name: "Fetch Attestation",
      state: attestationReady ? "success" : "pending",
    },
    {
      name: "Mint",
      state: isAlreadyClaimed ? "success" : "pending",
    },
  ];

  const status: LocalTransaction["status"] = isAlreadyClaimed ? "claimed" : "pending";
  const bridgeState: BridgeResult["state"] = isAlreadyClaimed ? "success" : "pending";

  const displayAddress = (targetAddress || attestationData.mintRecipient || "") as string;

  const bridgeResult: BridgeResult = {
    state: bridgeState,
    provider: "CCTPV2BridgingProvider",
    amount: amount || "0",
    token: "USDC",
    source: {
      address: displayAddress,
      chain: sourceChainDef as unknown as ChainDefinition,
    },
    destination: {
      address: displayAddress,
      chain: destinationChainDef as unknown as ChainDefinition,
    },
    steps,
  };

  return {
    transaction: {
      hash: normalizedHash as UniversalTxHash,
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
}
