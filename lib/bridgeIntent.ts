import { type ChainId } from "@/lib/types";
import { BRIDGEKIT_ENV } from "@/lib/bridgeKit";
import { getChainIdFromDomainUniversal } from "@/lib/contracts";
import { getSourceDomainForChain, parseRouteChainId } from "@/lib/bridgeRoute";
import { validateAddressForChain } from "@/lib/validation";

export interface BridgeIntent {
  sourceChainId: ChainId;
  targetChainId: ChainId;
  amount: string;
  targetAddress: string;
  transferType: "fast" | "standard";
}

const QUERY_KEYS = {
  source: "source",
  target: "target",
  sourceDomain: "sourceDomain",
  targetDomain: "targetDomain",
  amount: "amount",
  targetAddress: "targetAddress",
  transferType: "transferType",
} as const;

export const serializeBridgeIntent = (intent: BridgeIntent): URLSearchParams => {
  const params = new URLSearchParams();
  const sourceDomain = getSourceDomainForChain(intent.sourceChainId);
  const targetDomain = getSourceDomainForChain(intent.targetChainId);

  if (sourceDomain != null) {
    params.set(QUERY_KEYS.sourceDomain, String(sourceDomain));
  } else {
    params.set(QUERY_KEYS.source, String(intent.sourceChainId));
  }

  if (targetDomain != null) {
    params.set(QUERY_KEYS.targetDomain, String(targetDomain));
  } else {
    params.set(QUERY_KEYS.target, String(intent.targetChainId));
  }

  params.set(QUERY_KEYS.amount, intent.amount);
  params.set(QUERY_KEYS.targetAddress, intent.targetAddress);
  params.set(QUERY_KEYS.transferType, intent.transferType);
  return params;
};

const isValidAmount = (value: string): boolean => {
  if (!value) return false;
  return /^\d+(\.\d{1,6})?$/.test(value);
};

const isValidTransferType = (
  value: string | null
): value is BridgeIntent["transferType"] => value === "fast" || value === "standard";

const isValidTargetAddressForChain = (
  targetAddress: string,
  targetChainId: ChainId
): boolean => validateAddressForChain(targetAddress, targetChainId).isValid;

const parseDomainChainValue = (
  raw: string | null
): ChainId | null => {
  if (!raw) return null;

  const decoded = decodeURIComponent(raw).trim();
  if (!decoded) return null;

  if (/^\d+$/.test(decoded)) {
    const numericDomain = Number(decoded);
    if (!Number.isInteger(numericDomain)) {
      return null;
    }

    const chainFromDomain = getChainIdFromDomainUniversal(
      numericDomain,
      BRIDGEKIT_ENV
    );
    if (chainFromDomain) {
      return chainFromDomain;
    }
  }

  // Allow fallback to legacy chain identifiers for compatibility.
  return parseRouteChainId(decoded);
};

export const parseBridgeIntent = (
  params: Pick<URLSearchParams, "get">
): BridgeIntent | null => {
  const source =
    parseDomainChainValue(params.get(QUERY_KEYS.sourceDomain)) ??
    parseRouteChainId(params.get(QUERY_KEYS.source) ?? undefined);
  const target =
    parseDomainChainValue(params.get(QUERY_KEYS.targetDomain)) ??
    parseRouteChainId(params.get(QUERY_KEYS.target) ?? undefined);
  const amount = (params.get(QUERY_KEYS.amount) ?? "").trim();
  const targetAddress = (params.get(QUERY_KEYS.targetAddress) ?? "").trim();
  const transferType = params.get(QUERY_KEYS.transferType);

  if (!source || !target) return null;
  if (source === target) return null;
  if (!isValidAmount(amount)) return null;
  if (!targetAddress) return null;
  if (!isValidTargetAddressForChain(targetAddress, target)) return null;
  if (!isValidTransferType(transferType)) return null;

  return {
    sourceChainId: source,
    targetChainId: target,
    amount,
    targetAddress,
    transferType,
  };
};
