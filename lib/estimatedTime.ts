import { TransferSpeed, type TransferSpeedValue } from "@/lib/cctp/transferSpeed";
import { getFinalityEstimate } from "@/lib/cctpFinality";
import { getBridgeChainByIdUniversal } from "@/lib/bridgeConfig";
import type { ChainId } from "@/lib/types";

export type BridgeTransferType = "fast" | "standard";

const FALLBACK_ESTIMATED_TIME: Record<BridgeTransferType, string> = {
  fast: "~1 minute",
  standard: "13-19 minutes",
};

const LEGACY_GENERIC_ETA_LABELS = new Set([
  "13-19 minutes",
  "~13-19 minutes",
  "~13 to 19 minutes",
  "13 to 19 minutes",
  "~15 minutes",
  "~1 minute",
]);

const normalizeEtaLabel = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, " ");

const resolveChainFinalityEstimate = (
  sourceChainId: ChainId | null | undefined,
  transferType: BridgeTransferType
): string | undefined => {
  if (!sourceChainId) return undefined;

  const sourceChain = getBridgeChainByIdUniversal(sourceChainId);
  if (!sourceChain) return undefined;

  const speed: TransferSpeedValue =
    transferType === "fast" ? TransferSpeed.FAST : TransferSpeed.SLOW;
  const chainName = sourceChain.name || String(sourceChain.chain);
  return getFinalityEstimate(chainName, speed)?.averageTime;
};

export const resolveEstimatedTimeLabel = (params: {
  transferType: BridgeTransferType;
  sourceChainId?: ChainId | null;
  estimatedTime?: string | null;
}): string => {
  const { transferType, sourceChainId, estimatedTime } = params;
  const chainEstimate = resolveChainFinalityEstimate(sourceChainId, transferType);
  const explicitEstimate = estimatedTime?.trim();

  if (!explicitEstimate) {
    return chainEstimate ?? FALLBACK_ESTIMATED_TIME[transferType];
  }

  // Legacy records stored generic labels that can disagree with transfer type.
  // Prefer chain-aware estimate when we detect those generic placeholders.
  if (
    chainEstimate &&
    LEGACY_GENERIC_ETA_LABELS.has(normalizeEtaLabel(explicitEstimate))
  ) {
    return chainEstimate;
  }

  return explicitEstimate;
};
