"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BridgeCard, type BridgeSubmissionIntent } from "@/components/bridge-card";
import { BridgePageShell } from "@/components/bridge-page-shell";
import { parseBridgeIntentResult, serializeBridgeIntent } from "@/lib/bridgeIntent";
import { buildBridgeRoute } from "@/lib/bridgeRoute";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const EXECUTE_MODE = "execute";

export default function HomeClientPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const mode = searchParams.get("mode");
  const intentResult = useMemo(
    () => parseBridgeIntentResult(searchParams),
    [searchParams]
  );
  const intent = intentResult.ok ? intentResult.intent : null;

  const executeRequested = mode === EXECUTE_MODE;
  const shouldExecute = executeRequested && intentResult.ok;
  const hasInvalidExecuteIntent = executeRequested && !intentResult.ok;

  const invalidIntentMessage = useMemo(() => {
    if (intentResult.ok) {
      return "The bridge query string is missing required fields. Start from the bridge form.";
    }

    switch (intentResult.reason) {
      case "unsupported_source_domain":
      case "unsupported_target_domain":
        return "This bridge link references a domain that is unavailable in the current environment.";
      case "missing_source":
      case "missing_target":
        return "The bridge query string is missing required chain fields.";
      case "invalid_source":
      case "invalid_target":
        return "The bridge query string includes an invalid chain value.";
      case "invalid_amount":
        return "The bridge query string includes an invalid amount.";
      case "missing_target_address":
      case "invalid_target_address":
        return "The bridge query string includes an invalid recipient address.";
      case "invalid_transfer_type":
        return "The bridge query string includes an invalid transfer type.";
      case "same_chain":
        return "Source and destination chains must be different.";
      default:
        return "The bridge query string is invalid. Start from the bridge form.";
    }
  }, [intentResult]);

  const handleSubmitIntent = (nextIntent: BridgeSubmissionIntent) => {
    const params = serializeBridgeIntent(nextIntent);
    params.set("mode", EXECUTE_MODE);
    router.push(`/?${params.toString()}`);
  };

  const handlePendingHash = ({
    sourceChainId,
    hash,
  }: {
    sourceChainId: BridgeSubmissionIntent["sourceChainId"];
    hash: string;
  }) => {
    router.replace(buildBridgeRoute(sourceChainId, hash));
  };

  if (hasInvalidExecuteIntent) {
    return (
      <BridgePageShell>
        <Card className="min-h-[360px] bg-gradient-to-br from-slate-800/95 via-slate-800/98 to-slate-900/100 backdrop-blur-sm border-slate-700/50 text-white">
          <CardContent className="p-6 space-y-4">
            <h2 className="text-lg font-semibold">Invalid pending bridge request</h2>
            <p className="text-sm text-slate-400">
              {invalidIntentMessage}
            </p>
            <Button
              onClick={() => router.replace("/")}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              Back to Bridge Form
            </Button>
          </CardContent>
        </Card>
      </BridgePageShell>
    );
  }

  return (
    <BridgePageShell>
      <BridgeCard
        mode={shouldExecute ? "executeIntent" : "intentOnly"}
        initialIntent={shouldExecute ? intent : null}
        onSubmitIntent={handleSubmitIntent}
        onPendingHashResolved={handlePendingHash}
        onBackToNew={() => router.replace("/")}
      />
    </BridgePageShell>
  );
}
