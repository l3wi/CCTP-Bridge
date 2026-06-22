import { Suspense } from "react";
import { BridgeCardSkeleton } from "@/components/bridge-card-skeleton";
import { BridgePageShell } from "@/components/bridge-page-shell";
import HomeClientPage from "./home-client";

export default function HomePage() {
  return (
    <BridgePageShell>
      <Suspense fallback={<BridgeCardSkeleton />}>
        <HomeClientPage />
      </Suspense>
    </BridgePageShell>
  );
}
