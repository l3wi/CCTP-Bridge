"use client";

import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { getExplorerTxUrlUniversal } from "@/lib/bridgeKit";
import type { StepListProps } from "./types";

const CLAIMED_MESSAGE = "USDC claimed. Check your wallet for the USDC";

export function StepList({
  steps,
  sourceChainId,
  destinationChainId,
}: StepListProps) {
  const { toast } = useToast();

  return (
    <div className="space-y-3 text-sm">
      {steps.map((step, idx) => {
        const nonceClaimed =
          /nonce already used/i.test(step.errorMessage || "") ||
          /nonce already used/i.test(String(step.error || ""));
        const shortError = nonceClaimed
          ? CLAIMED_MESSAGE
          : step.errorMessage
          ? step.errorMessage.split("\n")[0]
          : null;
        const statusLabel = nonceClaimed ? "success" : step.state;

        return (
          <div
            key={`${step.name}-${step.txHash ?? idx}`}
            className="rounded-md bg-slate-800/60 px-3 py-2 border border-slate-700/50 space-y-1"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div
                  className={`h-2 w-2 rounded-full ${
                    step.state === "success" || nonceClaimed
                      ? "bg-green-400"
                      : step.state === "pending"
                      ? "bg-orange-400"
                      : "bg-red-400"
                  }`}
                />
                <span>{step.label || step.name}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                {step.txHash ? (
                  <>
                    <span>{`${step.txHash.slice(0, 6)}...${step.txHash.slice(
                      -4
                    )}`}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-slate-300 hover:text-white"
                      onClick={() => {
                        const txHash = step.txHash;
                        if (!txHash) return;

                        const explorer =
                          step.explorerUrl ||
                          (destinationChainId &&
                          step.name.toLowerCase().includes("mint")
                            ? getExplorerTxUrlUniversal(destinationChainId, txHash)
                            : sourceChainId
                            ? getExplorerTxUrlUniversal(sourceChainId, txHash)
                            : null);

                        if (explorer) {
                          window.open(explorer, "_blank");
                        } else {
                          navigator.clipboard.writeText(txHash);
                          toast({
                            title: "Hash copied",
                            description: "No explorer link available",
                          });
                        }
                      }}
                    >
                      <ExternalLink className="h-3 w-3" />
                    </Button>
                  </>
                ) : (
                  <span
                    className={
                      nonceClaimed
                        ? "text-green-300"
                        : step.state === "error"
                        ? "text-red-300"
                        : ""
                    }
                  >
                    {statusLabel}
                  </span>
                )}
              </div>
            </div>
            {shortError && (
              <div
                className={`text-xs ${
                  nonceClaimed ? "text-green-300" : "text-red-300"
                } line-clamp-2`}
              >
                {shortError}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
