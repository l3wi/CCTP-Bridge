"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AddPendingTransactionCard } from "@/components/add-pending-transaction-card";
import { BridgePageShell } from "@/components/bridge-page-shell";
import { buildBridgeRoute } from "@/lib/bridgeRoute";
import { parsePendingTransactionPrefill } from "@/lib/pendingTransactionRoute";

export default function BridgeAddPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const prefill = useMemo(
    () => parsePendingTransactionPrefill(searchParams),
    [searchParams]
  );

  return (
    <BridgePageShell>
      <AddPendingTransactionCard
        initialSourceChainId={prefill.sourceChainId}
        initialTxHash={prefill.txHash}
        initialError={prefill.error}
        onBack={() => {
          router.push("/");
        }}
        onTransactionAdded={({ sourceChainId, routeId }) => {
          router.replace(buildBridgeRoute(sourceChainId, routeId));
        }}
      />
    </BridgePageShell>
  );
}
