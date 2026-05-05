import { AlertCircle, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { LoadingButton } from "@/components/loading/LoadingStates";

interface IntentStatusCardProps {
  state: "submitting-burn" | "preparing" | "not-started" | "waiting";
  onBack: () => void;
}

export function IntentStatusCard({ state, onBack }: IntentStatusCardProps) {
  const didNotStart = state === "not-started";
  const title =
    state === "submitting-burn"
      ? "Submitting Burn Transaction"
      : didNotStart
      ? "Bridge Transaction Not Started"
      : state === "preparing"
      ? "Preparing Bridge Transaction"
      : "Waiting for Bridge Request";
  const description =
    state === "submitting-burn"
      ? "Approval and burn are in progress. You will be redirected to a shareable bridge URL once the burn hash is available."
      : didNotStart
      ? "The burn transaction did not start. Check your wallet connection and selected network, then go back to review or cancel this request."
      : state === "preparing"
      ? "Waiting for wallet confirmations before submitting burn transaction."
      : "Bridge request data is being initialized.";

  return (
    <Card className="min-h-[360px] bg-gradient-to-br from-slate-800/95 via-slate-800/98 to-slate-900/100 backdrop-blur-sm border-slate-700/50 text-white">
      <CardContent className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          {didNotStart ? (
            <AlertCircle className="h-4 w-4 text-amber-400" />
          ) : (
            <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
          )}
          <h2 className="text-lg font-semibold">{title}</h2>
        </div>
        <p className="text-sm text-slate-400">{description}</p>
        {didNotStart ? (
          <div className="flex flex-wrap gap-2">
            <LoadingButton
              variant="outline"
              className="border-slate-600 text-slate-300 hover:bg-slate-700 bg-transparent"
              onClick={onBack}
              isLoading={false}
            >
              Back
            </LoadingButton>
            <LoadingButton
              variant="ghost"
              className="text-slate-300 hover:bg-slate-700 hover:text-white"
              onClick={onBack}
              isLoading={false}
            >
              Cancel
            </LoadingButton>
          </div>
        ) : (
          <div>
            <LoadingButton
              variant="outline"
              className="border-slate-600 text-slate-300 hover:bg-slate-700 bg-transparent"
              onClick={onBack}
              isLoading={false}
            >
              Cancel
            </LoadingButton>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
