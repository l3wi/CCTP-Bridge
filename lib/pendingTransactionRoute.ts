import {
  getBridgeRouteSegment,
  parseBridgeRouteSource,
  parseRouteChainId,
} from "@/lib/bridgeRoute";
import type { ChainId } from "@/lib/types";

export interface PendingTransactionPrefill {
  sourceChainId: ChainId | null;
  txHash: string;
  error: string | null;
}

interface BuildPendingTransactionRedirectInput {
  sourceParam?: string | null;
  sourceChainId?: ChainId | null;
  idParam?: string | null;
  error?: string | null;
}

type QueryLike = Pick<URLSearchParams, "get">;

const getTrimmedQueryValue = (searchParams: QueryLike, key: string): string =>
  searchParams.get(key)?.trim() ?? "";

const parseSourceChainId = (value: string): ChainId | null => {
  if (!value) {
    return null;
  }

  const parsedSource = parseBridgeRouteSource(value);
  if (parsedSource) {
    return parsedSource.sourceChainId;
  }

  return parseRouteChainId(value);
};

export const parsePendingTransactionPrefill = (
  searchParams: QueryLike
): PendingTransactionPrefill => {
  const sourceId = getTrimmedQueryValue(searchParams, "id");
  const txHash = getTrimmedQueryValue(searchParams, "hash");
  const error = getTrimmedQueryValue(searchParams, "error");

  return {
    sourceChainId: parseSourceChainId(sourceId),
    txHash,
    error: error || null,
  };
};

export const buildPendingTransactionRedirect = ({
  sourceParam,
  sourceChainId,
  idParam,
  error,
}: BuildPendingTransactionRedirectInput): string => {
  const params = new URLSearchParams();

  const normalizedSourceParam = sourceParam?.trim() ?? "";
  const sourceFallback =
    sourceChainId != null ? getBridgeRouteSegment(sourceChainId) : "";
  const sourceId = normalizedSourceParam || sourceFallback;

  const normalizedId = idParam?.trim() ?? "";
  const normalizedError = error?.trim() ?? "";

  if (sourceId) {
    params.set("id", sourceId);
  }

  if (normalizedId) {
    params.set("hash", normalizedId);
  }

  if (normalizedError) {
    params.set("error", normalizedError);
  }

  const query = params.toString();
  return query ? `/bridge?${query}` : "/bridge";
};
