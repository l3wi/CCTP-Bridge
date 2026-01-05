import type { BridgeInfoProps } from "./types";

export function BridgeInfo({
  transferType,
  sentAtLabel,
  isSuccess,
  completedLabel,
  etaLabel,
}: BridgeInfoProps) {
  const typeLabel = transferType === "fast" ? "Fast" : "Standard";

  return (
    <div className="text-sm text-slate-200 space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-slate-400">Type</span>
        <span>{typeLabel}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-slate-400">Sent at</span>
        <span>{sentAtLabel}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-slate-400">
          {isSuccess ? "Completed at" : "Estimated time"}
        </span>
        <span>{isSuccess ? completedLabel || "—" : etaLabel}</span>
      </div>
    </div>
  );
}
