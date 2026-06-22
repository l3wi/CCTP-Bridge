import { after } from "next/server";
import { BridgePageShell } from "@/components/bridge-page-shell";
import BridgeTrackingPageClient from "./bridge-tracking-page-client";
import { trackVerifiedBridgeView } from "@/lib/analytics/trackVerifiedBridgeView";

interface BridgeTrackingPageProps {
  params: Promise<{
    sourceChainId: string;
    id: string;
  }>;
}

export default async function BridgeTrackingPage({
  params,
}: BridgeTrackingPageProps) {
  const { sourceChainId, id } = await params;

  after(async () => {
    await trackVerifiedBridgeView({
      sourceChainSegment: sourceChainId,
      routeIdSegment: id,
    });
  });

  return (
    <BridgePageShell>
      <BridgeTrackingPageClient sourceParam={sourceChainId} idParam={id} />
    </BridgePageShell>
  );
}
