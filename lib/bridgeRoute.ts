import { BRIDGEKIT_ENV, getBridgeChainByIdUniversal } from "@/lib/bridgeConfig";
import {
  getChainIdFromDomainUniversal,
  getCctpDomainIdUniversal,
} from "@/lib/contracts";
import {
  type ChainId,
  isSolanaChain,
  isValidEvmTxHash,
  isValidSolanaTxHash,
  type LocalTransaction,
} from "@/lib/types";

const NONCE_PATTERN = /^(0x[0-9a-fA-F]+|\d+)$/;

export type BridgeRouteIdKind = "txHash" | "nonce" | "invalid";

export interface ClassifiedBridgeRouteId {
  kind: BridgeRouteIdKind;
  normalizedId: string;
}

export interface ParsedBridgeRouteSource {
  sourceChainId: ChainId;
  sourceDomain: number;
  canonicalSegment: string;
  isLegacy: boolean;
}

export const isNonceIdentifier = (value: string): boolean =>
  NONCE_PATTERN.test(value.trim());

const getLegacyChainSegment = (chainId: ChainId): string =>
  typeof chainId === "number" ? String(chainId) : chainId;

export const getSourceDomainForChain = (chainId: ChainId): number | null =>
  getCctpDomainIdUniversal(chainId, BRIDGEKIT_ENV);

export const getBridgeRouteSegment = (chainId: ChainId): string => {
  const sourceDomain = getSourceDomainForChain(chainId);
  if (sourceDomain != null) {
    return String(sourceDomain);
  }

  return getLegacyChainSegment(chainId);
};

export const buildBridgeRoute = (chainId: ChainId, id: string): string =>
  `/bridge/${encodeURIComponent(getBridgeRouteSegment(chainId))}/${encodeURIComponent(
    id
  )}`;

export const parseRouteChainId = (raw: string | undefined): ChainId | null => {
  if (!raw) return null;

  const decoded = decodeURIComponent(raw).trim();
  const maybeSolana = decoded as ChainId;

  if (decoded === "Solana" || decoded === "Solana_Devnet") {
    return getBridgeChainByIdUniversal(maybeSolana) ? maybeSolana : null;
  }

  if (!/^\d+$/.test(decoded)) {
    return null;
  }

  const numericChainId = Number(decoded);
  if (!Number.isInteger(numericChainId)) {
    return null;
  }

  return getBridgeChainByIdUniversal(numericChainId)
    ? (numericChainId as ChainId)
    : null;
};

export const parseBridgeRouteSource = (
  raw: string | undefined
): ParsedBridgeRouteSource | null => {
  if (!raw) return null;

  const decoded = decodeURIComponent(raw).trim();

  if (/^\d+$/.test(decoded)) {
    const numericValue = Number(decoded);
    if (!Number.isInteger(numericValue)) {
      return null;
    }

    const chainIdFromDomain = getChainIdFromDomainUniversal(
      numericValue,
      BRIDGEKIT_ENV
    );
    if (chainIdFromDomain) {
      return {
        sourceChainId: chainIdFromDomain,
        sourceDomain: numericValue,
        canonicalSegment: String(numericValue),
        isLegacy: false,
      };
    }

    const legacyChainId = parseRouteChainId(decoded);
    if (!legacyChainId) return null;

    const sourceDomain = getSourceDomainForChain(legacyChainId);
    if (sourceDomain == null) return null;

    return {
      sourceChainId: legacyChainId,
      sourceDomain,
      canonicalSegment: String(sourceDomain),
      isLegacy: true,
    };
  }

  const legacyChainId = parseRouteChainId(decoded);
  if (!legacyChainId) return null;

  const sourceDomain = getSourceDomainForChain(legacyChainId);
  if (sourceDomain == null) return null;

  return {
    sourceChainId: legacyChainId,
    sourceDomain,
    canonicalSegment: String(sourceDomain),
    isLegacy: true,
  };
};

export const normalizeTxHashForChain = (
  sourceChainId: ChainId,
  rawId: string
): string | null => {
  const trimmed = decodeURIComponent(rawId).trim();

  if (isSolanaChain(sourceChainId)) {
    return isValidSolanaTxHash(trimmed) ? trimmed : null;
  }

  const lowered = trimmed.toLowerCase();
  const normalized = lowered.startsWith("0x") ? lowered : `0x${lowered}`;
  return isValidEvmTxHash(normalized) ? normalized : null;
};

export const classifyBridgeRouteId = (
  sourceChainId: ChainId,
  rawId: string
): ClassifiedBridgeRouteId => {
  const normalizedHash = normalizeTxHashForChain(sourceChainId, rawId);
  if (normalizedHash) {
    return { kind: "txHash", normalizedId: normalizedHash };
  }

  const decoded = decodeURIComponent(rawId).trim();
  if (isNonceIdentifier(decoded)) {
    return { kind: "nonce", normalizedId: decoded };
  }

  return { kind: "invalid", normalizedId: decoded };
};

export const getTransactionShareId = (tx: LocalTransaction): string =>
  tx.hash;
