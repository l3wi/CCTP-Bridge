import { track } from "@vercel/analytics/server";
import {
  classifyBridgeRouteId,
  parseBridgeRouteSource,
} from "@/lib/bridgeRoute";
import {
  recoverTransactionFromBurnHash,
  recoverTransactionFromNonce,
} from "@/lib/transactionRecovery";
import type { ChainId, LocalTransaction } from "@/lib/types";

interface TrackVerifiedBridgeViewParams {
  sourceChainSegment: string;
  routeIdSegment: string;
}

const decodeRouteSegment = (value: string): string => {
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
};

const hasTrackableFields = (
  transaction: Pick<LocalTransaction, "amount" | "targetChain">
): transaction is Pick<LocalTransaction, "amount" | "targetChain"> & {
  amount: string;
  targetChain: ChainId;
} => Boolean(transaction.amount && transaction.targetChain);

export async function trackVerifiedBridgeView({
  sourceChainSegment,
  routeIdSegment,
}: TrackVerifiedBridgeViewParams): Promise<void> {
  if (process.env.NEXT_PUBLIC_DISABLE_META_ANALYTICS === "1") {
    return;
  }

  try {
    const parsedSource = parseBridgeRouteSource(sourceChainSegment);
    if (!parsedSource) return;

    const decodedId = decodeRouteSegment(routeIdSegment);
    const routeId = classifyBridgeRouteId(parsedSource.sourceChainId, decodedId);
    if (routeId.kind === "invalid") return;

    const recovered =
      routeId.kind === "txHash"
        ? await recoverTransactionFromBurnHash(
            parsedSource.sourceChainId,
            routeId.normalizedId
          )
        : await recoverTransactionFromNonce(
            parsedSource.sourceChainId,
            routeId.normalizedId
          );

    if (!hasTrackableFields(recovered.transaction)) return;

    const txType = recovered.transaction.transferType === "fast" ? 1 : 0;
    await track("bridge", {
      amount: recovered.transaction.amount,
      meta: `${recovered.transaction.amount},${String(
        recovered.transaction.originChain
      )},${String(recovered.transaction.targetChain)},${txType}`,
      recipientResolution: "verified_from_iris",
      sourceChainId: recovered.transaction.originChain,
      targetChainId: recovered.transaction.targetChain,
    });
  } catch {
    // Never block rendering for analytics telemetry.
  }
}
