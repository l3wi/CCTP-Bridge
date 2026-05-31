"use client";

import { useMemo } from "react";
import type { BridgeResult } from "@circle-fin/bridge-kit";
import { BridgingState } from "@/components/bridging-state";
import { TransferSpeed } from "@/lib/cctp/transferSpeed";
import { toChainDefinition } from "@/lib/chainDefinition";
import {
  getBridgeChainByIdUniversal,
  getCctpConfirmationsUniversal,
} from "@/lib/bridgeConfig";
import { getFinalityEstimate } from "@/lib/cctpFinality";
import type { ChainId, LocalTransaction } from "@/lib/types";

interface BridgeTrackingCardProps {
  transaction: LocalTransaction;
  onBack: () => void;
  onMessageExpiredNonce?: (payload: {
    sourceChainId: ChainId;
    nonce: string;
  }) => void;
}

export function BridgeTrackingCard({
  transaction,
  onBack,
  onMessageExpiredNonce,
}: BridgeTrackingCardProps) {
  const sourceChainDef = useMemo(
    () => getBridgeChainByIdUniversal(transaction.originChain),
    [transaction.originChain]
  );

  const destinationChainDef = useMemo(
    () =>
      transaction.targetChain
        ? getBridgeChainByIdUniversal(transaction.targetChain)
        : null,
    [transaction.targetChain]
  );

  const effectiveDestinationChain = destinationChainDef ?? sourceChainDef;

  const fromChain = useMemo(
    () => ({
      value: String(transaction.originChain),
      label: sourceChainDef?.name || String(transaction.originChain),
    }),
    [transaction.originChain, sourceChainDef?.name]
  );

  const toChain = useMemo(
    () => ({
      value: String(transaction.targetChain ?? transaction.originChain),
      label:
        effectiveDestinationChain?.name ||
        String(transaction.targetChain ?? transaction.originChain),
    }),
    [
      transaction.originChain,
      transaction.targetChain,
      effectiveDestinationChain?.name,
    ]
  );

  const transferSpeed =
    transaction.transferType === "fast" ? TransferSpeed.FAST : TransferSpeed.SLOW;

  const finalityEstimate = useMemo(() => {
    if (!sourceChainDef) return undefined;

    return getFinalityEstimate(
      sourceChainDef.name || String(sourceChainDef.chain),
      transferSpeed
    )?.averageTime;
  }, [sourceChainDef, transferSpeed]);

  const bridgeResult = useMemo(() => {
    if (transaction.bridgeResult) return transaction.bridgeResult;
    if (!transaction.steps) return undefined;
    if (!sourceChainDef || !effectiveDestinationChain) return undefined;

    return {
      amount: transaction.amount ?? "0",
      token: "USDC",
      state: transaction.bridgeState ?? "pending",
      provider: "CCTPV2BridgingProvider",
      source: {
        address: transaction.targetAddress || "",
        chain: toChainDefinition(sourceChainDef),
      },
      destination: {
        address: transaction.targetAddress || "",
        chain: toChainDefinition(effectiveDestinationChain),
      },
      steps: transaction.steps || [],
    } as BridgeResult;
  }, [
    transaction.bridgeResult,
    transaction.steps,
    transaction.amount,
    transaction.bridgeState,
    transaction.targetAddress,
    sourceChainDef,
    effectiveDestinationChain,
  ]);

  return (
    <BridgingState
      fromChain={fromChain}
      toChain={toChain}
      amount={transaction.amount || "0"}
      recipientAddress={transaction.targetAddress || undefined}
      onBack={onBack}
      confirmations={getCctpConfirmationsUniversal(transaction.originChain) || undefined}
      finalityEstimate={finalityEstimate}
      bridgeResult={bridgeResult}
      transferType={transaction.transferType === "fast" ? "fast" : "standard"}
      startedAt={transaction.date ? new Date(transaction.date) : undefined}
      estimatedTimeLabel={transaction.estimatedTime}
      onMessageExpiredNonce={(nonce) => {
        onMessageExpiredNonce?.({
          sourceChainId: transaction.originChain,
          nonce,
        });
      }}
    />
  );
}
