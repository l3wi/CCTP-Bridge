import { Suspense } from "react";
import { BridgeCardSkeleton } from "@/components/bridge-card-skeleton";
import { BridgePageShell } from "@/components/bridge-page-shell";
import BridgeAddPageClient from "./bridge-add-page-client";

export default function BridgeAddPage() {
  return (
    <BridgePageShell>
      <Suspense fallback={<BridgeCardSkeleton />}>
        <BridgeAddPageClient />
      </Suspense>
    </BridgePageShell>
  );
}
