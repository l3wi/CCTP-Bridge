"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { BridgePageShell } from "@/components/bridge-page-shell";
import { BridgeTrackingCard } from "@/components/bridge-tracking-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useTransactionStore } from "@/lib/store/transactionStore";
import type { ChainId } from "@/lib/types";
import {
  buildBridgeRoute,
  classifyBridgeRouteId,
  parseBridgeRouteSource,
  type BridgeRouteIdKind,
} from "@/lib/bridgeRoute";
import {
  recoverTransactionFromBurnHash,
  recoverTransactionFromNonce,
  TransactionRecoveryError,
} from "@/lib/transactionRecovery";
import { getErrorMessage } from "@/lib/cctp/errors";

const STORE_GRACE_MS = 1_250;

const normalizeNonceValue = (value: string): string => {
  try {
    return BigInt(value).toString();
  } catch {
    return value.trim();
  }
};

const truncateHashForDisplay = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length <= 24) return trimmed;
  return `${trimmed.slice(0, 10)}...${trimmed.slice(-10)}`;
};

export default function BridgeTrackingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams<{ sourceChainId: string; id: string }>();
  const { transactions, addTransaction, updateTransaction } = useTransactionStore();
  const isFreshNavigation = searchParams.get("fresh") === "1";

  const sourceParam = params.sourceChainId;
  const idParam = params.id;

  const decodedId = decodeURIComponent(idParam ?? "").trim();

  const parsedSource = useMemo(
    () => parseBridgeRouteSource(sourceParam),
    [sourceParam]
  );
  const sourceChainId = parsedSource?.sourceChainId ?? null;

  const routeId = useMemo(
    () =>
      sourceChainId
        ? classifyBridgeRouteId(sourceChainId, decodedId)
        : { kind: "invalid" as BridgeRouteIdKind, normalizedId: decodedId },
    [sourceChainId, decodedId]
  );

  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [isRecovering, setIsRecovering] = useState(false);
  const [manualBurnHash, setManualBurnHash] = useState("");
  const [isStoreHydrated, setIsStoreHydrated] = useState(() =>
    useTransactionStore.persist.hasHydrated()
  );
  const [isInitialLookupPending, setIsInitialLookupPending] = useState(true);

  const recoveryAttemptRef = useRef<string | null>(null);

  useEffect(() => {
    const persistApi = useTransactionStore.persist;

    if (persistApi.hasHydrated()) {
      setIsStoreHydrated(true);
      return;
    }

    const unsubscribeHydrate = persistApi.onHydrate(() => {
      setIsStoreHydrated(false);
    });
    const unsubscribeFinishHydration = persistApi.onFinishHydration(() => {
      setIsStoreHydrated(true);
    });

    return () => {
      unsubscribeHydrate();
      unsubscribeFinishHydration();
    };
  }, []);

  const matchedTransaction = useMemo(() => {
    if (!sourceChainId) return null;

    if (routeId.kind === "txHash") {
      return (
        transactions.find(
          (tx) => tx.originChain === sourceChainId && tx.hash === routeId.normalizedId
        ) ?? null
      );
    }

    if (routeId.kind === "nonce") {
      const routeNonce = normalizeNonceValue(routeId.normalizedId);
      return (
        transactions.find(
          (tx) =>
            tx.originChain === sourceChainId &&
            tx.nonce &&
            normalizeNonceValue(tx.nonce) === routeNonce
        ) ?? null
      );
    }

    return null;
  }, [transactions, sourceChainId, routeId.kind, routeId.normalizedId]);

  const handleMessageExpiredNonce = useCallback(
    ({ sourceChainId: nextSourceChainId, nonce }: { sourceChainId: ChainId; nonce: string }) => {
      if (!nonce.trim()) return;

      const nextPath = buildBridgeRoute(nextSourceChainId, nonce);
      const currentPath = buildBridgeRoute(
        sourceChainId ?? nextSourceChainId,
        decodedId
      );

      if (nextPath !== currentPath) {
        router.replace(nextPath);
      }
    },
    [router, sourceChainId, decodedId]
  );

  const runRecovery = useCallback(
    async (burnHash: string) => {
      if (!sourceChainId) return;

      setRecoveryError(null);
      setIsRecovering(true);

      try {
        const { transaction } = await recoverTransactionFromBurnHash(sourceChainId, burnHash);
        addTransaction(transaction);
        updateTransaction(transaction.hash, transaction);

        const nextId = routeId.kind === "nonce" && transaction.nonce
          ? transaction.nonce
          : transaction.hash;

        router.replace(buildBridgeRoute(sourceChainId, nextId));
      } catch (error) {
        setRecoveryError(getErrorMessage(error));
      } finally {
        setIsRecovering(false);
      }
    },
    [addTransaction, router, routeId.kind, sourceChainId, updateTransaction]
  );

  useEffect(() => {
    if (routeId.kind === "txHash") {
      setManualBurnHash(routeId.normalizedId);
    } else {
      setManualBurnHash("");
    }
  }, [routeId.kind, routeId.normalizedId]);

  useEffect(() => {
    if (!isStoreHydrated) {
      return;
    }

    if (!sourceChainId) {
      setRecoveryError("Invalid source chain in URL.");
      setIsInitialLookupPending(false);
      return;
    }

    if (routeId.kind === "invalid") {
      setRecoveryError("Invalid bridge identifier. Use a burn tx hash or nonce.");
      setIsInitialLookupPending(false);
      return;
    }

    if (matchedTransaction) {
      setRecoveryError(null);
      setIsInitialLookupPending(false);
      return;
    }

    const attemptKey = `${sourceChainId}:${routeId.kind}:${routeId.normalizedId}`;
    if (recoveryAttemptRef.current === attemptKey) {
      setIsInitialLookupPending(false);
      return;
    }

    recoveryAttemptRef.current = attemptKey;
    setIsInitialLookupPending(true);

    let cancelled = false;

    const recoveryDelayMs =
      routeId.kind === "txHash" && isFreshNavigation ? STORE_GRACE_MS : 0;
    const timer = setTimeout(async () => {
      if (cancelled) return;

      try {
        setRecoveryError(null);
        setIsRecovering(true);
        const { transaction } =
          routeId.kind === "txHash"
            ? await recoverTransactionFromBurnHash(
                sourceChainId,
                routeId.normalizedId
              )
            : await recoverTransactionFromNonce(
                sourceChainId,
                routeId.normalizedId
              );

        if (cancelled) return;
        addTransaction(transaction);
        updateTransaction(transaction.hash, transaction);
      } catch (error) {
        if (cancelled) return;

        if (error instanceof TransactionRecoveryError) {
          const baseMessage = error.message;
          const nonceHint =
            routeId.kind === "nonce"
              ? " If needed, paste the burn transaction hash below to rehydrate manually."
              : "";
          setRecoveryError(`${baseMessage}${nonceHint}`);
        } else {
          setRecoveryError(getErrorMessage(error));
        }
      } finally {
        if (!cancelled) {
          setIsRecovering(false);
          setIsInitialLookupPending(false);
        }
      }
    }, recoveryDelayMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    addTransaction,
    isStoreHydrated,
    matchedTransaction,
    routeId.kind,
    routeId.normalizedId,
    sourceChainId,
    isFreshNavigation,
    updateTransaction,
  ]);

  useEffect(() => {
    if (!sourceChainId) return;

    const shouldCanonicalizeSource = parsedSource?.isLegacy ?? false;
    const shouldCanonicalizeId =
      routeId.kind === "txHash" && decodedId !== routeId.normalizedId;

    if (!shouldCanonicalizeSource && !shouldCanonicalizeId) {
      return;
    }

    const canonicalId =
      routeId.kind === "txHash" ? routeId.normalizedId : decodedId;

    const canonicalPath = buildBridgeRoute(sourceChainId, canonicalId);
    router.replace(
      isFreshNavigation ? `${canonicalPath}?fresh=1` : canonicalPath
    );
  }, [
    router,
    sourceChainId,
    parsedSource?.isLegacy,
    routeId.kind,
    routeId.normalizedId,
    decodedId,
    isFreshNavigation,
  ]);

  if (!isStoreHydrated) {
    return (
      <BridgePageShell>
        <Card className="min-h-[360px] bg-gradient-to-br from-slate-800/95 via-slate-800/98 to-slate-900/100 backdrop-blur-sm border-slate-700/50 text-white">
          <CardContent className="p-6 min-h-[360px] flex items-center justify-center">
            <div className="flex items-center gap-2 text-sm text-slate-300">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading local bridge history...
            </div>
          </CardContent>
        </Card>
      </BridgePageShell>
    );
  }

  if (isInitialLookupPending) {
    return (
      <BridgePageShell>
        <Card className="min-h-[360px] bg-gradient-to-br from-slate-800/95 via-slate-800/98 to-slate-900/100 backdrop-blur-sm border-slate-700/50 text-white">
          <CardContent className="p-6 min-h-[360px] flex items-center justify-center">
            <div className="flex items-center gap-2 text-sm text-slate-300">
              <Loader2 className="h-4 w-4 animate-spin" />
              Looking up transaction state...
            </div>
          </CardContent>
        </Card>
      </BridgePageShell>
    );
  }

  return (
    <BridgePageShell>
      {matchedTransaction ? (
        <BridgeTrackingCard
          transaction={matchedTransaction}
          onBack={() => router.replace("/")}
          onMessageExpiredNonce={handleMessageExpiredNonce}
        />
      ) : (
        <Card className="min-h-[360px] bg-gradient-to-br from-slate-800/95 via-slate-800/98 to-slate-900/100 backdrop-blur-sm border-slate-700/50 text-white">
          <CardContent className="p-6 space-y-4">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">Recover Bridge Session</h2>
              <p className="text-sm text-slate-400">
                Source Domain: {parsedSource?.sourceDomain ?? "unknown"} | Source Chain: {sourceChainId ? String(sourceChainId) : "unknown"} | ID: {routeId.kind === "txHash" ? truncateHashForDisplay(decodedId || "n/a") : decodedId || "n/a"}
              </p>
            </div>

            {isRecovering && (
              <div className="flex items-center gap-2 text-sm text-slate-300">
                <Loader2 className="h-4 w-4 animate-spin" />
                Looking up transaction state...
              </div>
            )}

            {recoveryError && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-300">
                {recoveryError}
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm text-slate-300">Burn Transaction Hash</label>
              <Input
                value={manualBurnHash}
                onChange={(event) => setManualBurnHash(event.target.value)}
                placeholder="0x... or Solana signature"
                className="bg-slate-700/50 border-slate-600 text-white"
                disabled={isRecovering}
              />
              <p className="text-xs text-slate-500">
                Use the source-chain burn transaction hash to rehydrate this link for debugging or claiming.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button
                className="bg-blue-600 hover:bg-blue-700 text-white"
                disabled={!manualBurnHash.trim() || isRecovering || !sourceChainId}
                onClick={() => {
                  if (!sourceChainId) return;
                  void runRecovery(manualBurnHash.trim());
                }}
              >
                {isRecovering ? "Recovering..." : "Add Transaction"}
              </Button>
              <Button
                variant="outline"
                className="border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700"
                onClick={() => router.replace("/")}
              >
                Back to Bridge
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </BridgePageShell>
  );
}
