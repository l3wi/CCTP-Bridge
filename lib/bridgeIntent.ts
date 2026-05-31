import { type ChainId } from "@/lib/types";
import { BRIDGEKIT_ENV } from "@/lib/bridgeConfig";
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

export type BridgeIntentParseReason =
  | "missing_source"
  | "invalid_source"
  | "unsupported_source_domain"
  | "missing_target"
  | "invalid_target"
  | "unsupported_target_domain"
  | "same_chain"
  | "invalid_amount"
  | "missing_target_address"
  | "invalid_target_address"
  | "invalid_transfer_type";

export type BridgeIntentParseResult =
  | { ok: true; intent: BridgeIntent }
  | { ok: false; reason: BridgeIntentParseReason };

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
  raw: string | null,
  options?: { allowLegacyFallback?: boolean }
): {
  chainId: ChainId | null;
  hasValue: boolean;
  unsupportedDomain: boolean;
} => {
  const allowLegacyFallback = options?.allowLegacyFallback ?? true;
  if (raw == null) {
    return { chainId: null, hasValue: false, unsupportedDomain: false };
  }

  const decoded = decodeURIComponent(raw).trim();
  if (!decoded) {
    return { chainId: null, hasValue: true, unsupportedDomain: false };
  }

  if (/^\d+$/.test(decoded)) {
    const numericDomain = Number(decoded);
    if (!Number.isInteger(numericDomain)) {
      return { chainId: null, hasValue: true, unsupportedDomain: false };
    }

    const chainFromDomain = getChainIdFromDomainUniversal(
      numericDomain,
      BRIDGEKIT_ENV
    );
    if (chainFromDomain) {
      return { chainId: chainFromDomain, hasValue: true, unsupportedDomain: false };
    }

    if (!allowLegacyFallback) {
      return { chainId: null, hasValue: true, unsupportedDomain: true };
    }
  }

  // Allow fallback to legacy chain identifiers for compatibility.
  return {
    chainId: parseRouteChainId(decoded),
    hasValue: true,
    unsupportedDomain: false,
  };
};

export const parseBridgeIntentResult = (
  params: Pick<URLSearchParams, "get">
): BridgeIntentParseResult => {
  const sourceRaw = params.get(QUERY_KEYS.source);
  const targetRaw = params.get(QUERY_KEYS.target);
  const sourceDomainRaw = params.get(QUERY_KEYS.sourceDomain);
  const targetDomainRaw = params.get(QUERY_KEYS.targetDomain);

  const parsedSourceDomain = parseDomainChainValue(sourceDomainRaw, {
    allowLegacyFallback: false,
  });
  const parsedTargetDomain = parseDomainChainValue(targetDomainRaw, {
    allowLegacyFallback: false,
  });

  const source =
    parsedSourceDomain.chainId ??
    parseRouteChainId(sourceRaw ?? undefined);
  const target =
    parsedTargetDomain.chainId ??
    parseRouteChainId(targetRaw ?? undefined);
  const amount = (params.get(QUERY_KEYS.amount) ?? "").trim();
  const targetAddress = (params.get(QUERY_KEYS.targetAddress) ?? "").trim();
  const transferType = params.get(QUERY_KEYS.transferType);

  if (!source) {
    if (parsedSourceDomain.unsupportedDomain) {
      return { ok: false, reason: "unsupported_source_domain" };
    }
    if (parsedSourceDomain.hasValue || (sourceRaw ?? "").trim()) {
      return { ok: false, reason: "invalid_source" };
    }
    return { ok: false, reason: "missing_source" };
  }

  if (!target) {
    if (parsedTargetDomain.unsupportedDomain) {
      return { ok: false, reason: "unsupported_target_domain" };
    }
    if (parsedTargetDomain.hasValue || (targetRaw ?? "").trim()) {
      return { ok: false, reason: "invalid_target" };
    }
    return { ok: false, reason: "missing_target" };
  }

  if (source === target) {
    return { ok: false, reason: "same_chain" };
  }

  if (!isValidAmount(amount)) {
    return { ok: false, reason: "invalid_amount" };
  }

  if (!targetAddress) {
    return { ok: false, reason: "missing_target_address" };
  }

  if (!isValidTargetAddressForChain(targetAddress, target)) {
    return { ok: false, reason: "invalid_target_address" };
  }

  if (!isValidTransferType(transferType)) {
    return { ok: false, reason: "invalid_transfer_type" };
  }

  return {
    ok: true,
    intent: {
      sourceChainId: source,
      targetChainId: target,
      amount,
      targetAddress,
      transferType,
    },
  };
};

export const parseBridgeIntent = (
  params: Pick<URLSearchParams, "get">
): BridgeIntent | null => {
  const result = parseBridgeIntentResult(params);
  return result.ok ? result.intent : null;
};
