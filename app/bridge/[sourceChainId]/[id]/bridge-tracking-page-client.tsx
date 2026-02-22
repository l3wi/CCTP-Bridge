"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { BridgePageShell } from "@/components/bridge-page-shell";
import { BridgeTrackingCard } from "@/components/bridge-tracking-card";
import { Card, CardContent } from "@/components/ui/card";
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
} from "@/lib/transactionRecovery";
import { getErrorMessage } from "@/lib/cctp/errors";
import { buildPendingTransactionRedirect } from "@/lib/pendingTransactionRoute";

const normalizeNonceValue = (value: string): string => {
  try {
    return BigInt(value).toString();
  } catch {
    return value.trim();
  }
};

interface BridgeTrackingPageClientProps {
  sourceParam: string;
  idParam: string;
}

export default function BridgeTrackingPageClient({
  sourceParam,
  idParam,
}: BridgeTrackingPageClientProps) {
  const router = useRouter();
  const { transactions, upsertTransaction } = useTransactionStore();

  const decodedId = useMemo(() => {
    try {
      return decodeURIComponent(idParam ?? "").trim();
    } catch {
      return (idParam ?? "").trim();
    }
  }, [idParam]);

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
    if (!sourceChainId) {
      return null;
    }

    if (routeId.kind === "txHash") {
      return (
        transactions.find(
          (transaction) =>
            transaction.originChain === sourceChainId &&
            transaction.hash === routeId.normalizedId
        ) ?? null
      );
    }

    if (routeId.kind === "nonce") {
      const routeNonce = normalizeNonceValue(routeId.normalizedId);
      return (
        transactions.find(
          (transaction) =>
            transaction.originChain === sourceChainId &&
            transaction.nonce &&
            normalizeNonceValue(transaction.nonce) === routeNonce
        ) ?? null
      );
    }

    return null;
  }, [transactions, sourceChainId, routeId.kind, routeId.normalizedId]);

  const redirectToPendingForm = useCallback(
    (error: string) => {
      const idForPrefill =
        routeId.kind === "txHash" ? routeId.normalizedId : decodedId;

      const nextPath = buildPendingTransactionRedirect({
        sourceParam,
        sourceChainId,
        idParam: idForPrefill,
        error,
      });

      router.replace(nextPath);
    },
    [router, sourceParam, sourceChainId, routeId.kind, routeId.normalizedId, decodedId]
  );

  const handleMessageExpiredNonce = useCallback(
    ({ sourceChainId: nextSourceChainId, nonce }: { sourceChainId: ChainId; nonce: string }) => {
      if (!nonce.trim()) {
        return;
      }

      const nextPath = buildBridgeRoute(nextSourceChainId, nonce);
      const currentPath = buildBridgeRoute(sourceChainId ?? nextSourceChainId, decodedId);

      if (nextPath !== currentPath) {
        router.replace(nextPath);
      }
    },
    [router, sourceChainId, decodedId]
  );

  useEffect(() => {
    if (!isStoreHydrated) {
      return;
    }

    if (!sourceChainId) {
      redirectToPendingForm("Invalid source chain in URL.");
      return;
    }

    if (routeId.kind === "invalid") {
      redirectToPendingForm("Invalid bridge identifier. Use a burn tx hash or nonce.");
      return;
    }

    if (matchedTransaction) {
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

    void (async () => {
      if (cancelled) {
        return;
      }

      try {
        const { transaction } =
          routeId.kind === "txHash"
            ? await recoverTransactionFromBurnHash(sourceChainId, routeId.normalizedId)
            : await recoverTransactionFromNonce(sourceChainId, routeId.normalizedId);

        if (cancelled) {
          return;
        }

        upsertTransaction(transaction);
      } catch (error) {
        if (cancelled) {
          return;
        }

        redirectToPendingForm(getErrorMessage(error));
      } finally {
        if (!cancelled) {
          setIsInitialLookupPending(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    isStoreHydrated,
    matchedTransaction,
    routeId.kind,
    routeId.normalizedId,
    sourceChainId,
    upsertTransaction,
    redirectToPendingForm,
  ]);

  useEffect(() => {
    if (!sourceChainId || routeId.kind === "invalid") {
      return;
    }

    const shouldCanonicalizeSource = parsedSource?.isLegacy ?? false;
    const shouldCanonicalizeId =
      routeId.kind === "txHash" && decodedId !== routeId.normalizedId;

    if (!shouldCanonicalizeSource && !shouldCanonicalizeId) {
      return;
    }

    const canonicalId = routeId.kind === "txHash" ? routeId.normalizedId : decodedId;
    const canonicalPath = buildBridgeRoute(sourceChainId, canonicalId);
    router.replace(canonicalPath);
  }, [
    router,
    sourceChainId,
    parsedSource?.isLegacy,
    routeId.kind,
    routeId.normalizedId,
    decodedId,
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

  if (!matchedTransaction) {
    return (
      <BridgePageShell>
        <Card className="min-h-[360px] bg-gradient-to-br from-slate-800/95 via-slate-800/98 to-slate-900/100 backdrop-blur-sm border-slate-700/50 text-white">
          <CardContent className="p-6 min-h-[360px] flex items-center justify-center">
            <div className="flex items-center gap-2 text-sm text-slate-300">
              <Loader2 className="h-4 w-4 animate-spin" />
              Redirecting to pending transaction form...
            </div>
          </CardContent>
        </Card>
      </BridgePageShell>
    );
  }

  return (
    <BridgePageShell>
      <BridgeTrackingCard
        transaction={matchedTransaction}
        onBack={() => router.replace("/bridge")}
        onMessageExpiredNonce={handleMessageExpiredNonce}
      />
    </BridgePageShell>
  );
}
