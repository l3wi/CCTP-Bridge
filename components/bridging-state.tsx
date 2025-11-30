"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight, ExternalLink, Loader2, X } from "lucide-react";
import { formatTime } from "@/lib/utils";
import Image from "next/image";
import type { BridgeResult } from "@circle-fin/bridge-kit";
import { useAccount, useSwitchChain } from "wagmi";
import { useToast } from "@/components/ui/use-toast";
import { getExplorerTxUrl } from "@/lib/bridgeKit";

interface ChainInfo {
  value: string;
  label: string;
}

interface BridgingStateProps {
  fromChain: ChainInfo;
  toChain: ChainInfo;
  amount: string;
  estimatedTime?: number; // in seconds
  recipientAddress?: `0x${string}` | string;
  onBack: () => void;
  bridgeResult?: BridgeResult;
  confirmations?: { standard?: number; fast?: number };
  finalityEstimate?: string;
  transferType?: "fast" | "standard";
  startedAt?: Date;
  estimatedTimeLabel?: string;
}

export function BridgingState({
  fromChain,
  toChain,
  amount,
  estimatedTime,
  recipientAddress,
  onBack,
  bridgeResult,
  confirmations,
  finalityEstimate,
  transferType,
  startedAt,
  estimatedTimeLabel,
}: BridgingStateProps) {
  const { chain } = useAccount();
  const { switchChain, isPending: isSwitchingChain } = useSwitchChain();
  const { toast } = useToast();
  const [timeLeft, setTimeLeft] = useState(estimatedTime ?? 0);

  // Reset countdown when estimate changes
  useEffect(() => {
    setTimeLeft(estimatedTime ?? 0);
  }, [estimatedTime]);

  useEffect(() => {
    if (!estimatedTime || timeLeft <= 0) return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [timeLeft, estimatedTime]);

  const progress = Math.max(
    0,
    Math.min(
      100,
      estimatedTime ? 100 - (timeLeft / estimatedTime) * 100 : 0
    )
  );

  const recipientLabel = recipientAddress
    ? `${recipientAddress.slice(0, 6)}...${recipientAddress.slice(-4)}`
    : "Pending";

  const typeLabel =
    transferType === "fast"
      ? "Fast Bridging"
      : transferType === "standard"
      ? "Standard Bridging"
      : "Bridging";

  const infoTypeLabel = transferType === "fast" ? "Fast" : "Standard";
  const pendingTitle = `${infoTypeLabel} Bridge Pending`;
  const sentAtLabel = startedAt
    ? startedAt.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : new Date().toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
  const etaLabel =
    estimatedTimeLabel || finalityEstimate || (transferType === "fast" ? "~1 minute" : "13-19 minutes");
  const completedLabel =
    bridgeResult?.state === "success" && bridgeResult.completedAt
      ? new Date(bridgeResult.completedAt).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;

  const destinationChainId = useMemo(() => {
    const bridgeDest =
      (bridgeResult?.destination?.chain as { chainId?: number } | undefined)
        ?.chainId;
    if (bridgeDest) return bridgeDest;
    return toChain?.value ? Number(toChain.value) : undefined;
  }, [bridgeResult?.destination?.chain, toChain?.value]);

  const sourceChainId = useMemo(() => {
    const bridgeSource =
      (bridgeResult?.source?.chain as { chainId?: number } | undefined)?.chainId;
    if (bridgeSource) return bridgeSource;
    return fromChain?.value ? Number(fromChain.value) : undefined;
  }, [bridgeResult?.source?.chain, fromChain?.value]);

  const displayFrom = useMemo(() => {
    const chainName =
      (bridgeResult?.source?.chain as { name?: string } | undefined)?.name ||
      fromChain.label;
    const value =
      (bridgeResult?.source?.chain as { chainId?: number } | undefined)?.chainId ||
      (fromChain.value ? Number(fromChain.value) : undefined);
    return {
      label: chainName,
      value: value?.toString() || fromChain.value,
    };
  }, [bridgeResult?.source?.chain, fromChain.label, fromChain.value]);

  const displayTo = useMemo(() => {
    const chainName =
      (bridgeResult?.destination?.chain as { name?: string } | undefined)?.name ||
      toChain.label;
    const value =
      (bridgeResult?.destination?.chain as { chainId?: number } | undefined)
        ?.chainId ||
      (toChain.value ? Number(toChain.value) : undefined);
    return {
      label: chainName,
      value: value?.toString() || toChain.value,
    };
  }, [bridgeResult?.destination?.chain, toChain.label, toChain.value]);

  const onDestinationChain = chain?.id && destinationChainId
    ? chain.id === destinationChainId
    : false;

  if (bridgeResult) {
    const primaryStep =
      bridgeResult.steps.find((step) => step.state === "success" && step.txHash) ||
      bridgeResult.steps.find((step) => step.txHash);
    const primaryHash = primaryStep?.txHash;
    const primaryExplorer = primaryStep?.explorerUrl;
    const stateLabel =
      bridgeResult.state === "success"
        ? "Bridge Completed"
        : pendingTitle;

    return (
      <Card className="bg-gradient-to-br from-slate-800/95 via-slate-800/98 to-slate-900/100 backdrop-blur-sm border-slate-700/50 text-white">
        <CardContent className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">{stateLabel}</h2>
            <Button
              variant="ghost"
              size="icon"
              onClick={onBack}
              className="rounded-full bg-slate-700/50 hover:bg-slate-600/50 border border-slate-600 h-8 w-8"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Image
                src={`/${displayFrom.value}.svg`}
                width={24}
                height={24}
                className="w-6 h-6"
                alt={displayFrom.label}
              />
              <div>
                <div className="font-medium">{displayFrom.label}</div>
                <div className="text-xs text-slate-400">{amount} USDC</div>
              </div>
            </div>
            <ArrowRight className="text-slate-500" />
            <div className="flex items-center gap-2">
              <Image
                src={`/${displayTo.value}.svg`}
                width={24}
                height={24}
                className="w-6 h-6"
                alt={displayTo.label}
              />
              <div>
                <div className="font-medium">{displayTo.label}</div>
                <div className="text-xs text-slate-400">
                  {bridgeResult.state === "success" ? "Minted" : "Pending"}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-3 text-sm">
            {bridgeResult.steps.map((step) => (
              <div
                key={step.name}
                className="flex items-center justify-between rounded-md bg-slate-800/60 px-3 py-2 border border-slate-700/50"
              >
                <div className="flex items-center gap-2">
                  <div
                    className={`h-2 w-2 rounded-full ${
                      step.state === "success"
                        ? "bg-green-400"
                        : (step.name.toLowerCase().includes("mint") &&
                            !step.txHash &&
                            step.state === "error") ||
                          step.state === "pending"
                        ? "bg-yellow-400"
                        : "bg-red-400"
                    }`}
                  />
                  <span>{step.name}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  {step.txHash ? (
                    <>
                      <span>{`${step.txHash.slice(0, 6)}...${step.txHash.slice(-4)}`}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-slate-300 hover:text-white"
                        onClick={() => {
                          const explorer =
                            step.explorerUrl ||
                            (destinationChainId && step.name.toLowerCase().includes("mint")
                              ? getExplorerTxUrl(destinationChainId, step.txHash)
                              : sourceChainId
                              ? getExplorerTxUrl(sourceChainId, step.txHash)
                              : null);
                          if (explorer) {
                            window.open(explorer, "_blank");
                          } else {
                            navigator.clipboard.writeText(step.txHash);
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
                    <span>
                      {(step.name.toLowerCase().includes("mint") &&
                        step.state === "error") ||
                      step.state === "pending"
                        ? "pending"
                        : step.state}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {bridgeResult.state !== "success" && (
            <div className="flex flex-col gap-2">
              <Button
                className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                disabled={isSwitchingChain}
                onClick={() => {
                  if (!destinationChainId) return;
                  if (!onDestinationChain) {
                    switchChain({ chainId: destinationChainId }).catch((err) =>
                      toast({
                        title: "Switch failed",
                        description:
                          err instanceof Error ? err.message : "Could not switch chain",
                        variant: "destructive",
                      })
                    );
                    return;
                  }

                  const claimStep =
                    bridgeResult?.steps.find((step) => /mint|claim/i.test(step.name)) ||
                    bridgeResult?.steps.find((step) => step.txHash);

                  if (claimStep?.txHash) {
                    const explorer =
                      claimStep.explorerUrl ||
                      (destinationChainId
                        ? getExplorerTxUrl(destinationChainId, claimStep.txHash)
                        : null);
                    if (explorer) {
                      window.open(explorer, "_blank");
                      return;
                    }
                  }

                  toast({
                    title: "Claim pending",
                    description: "Circle will prompt you to claim once ready.",
                  });
                }}
              >
                {onDestinationChain
                  ? `Claim ${amount} USDC`
                  : `Switch chain to ${displayTo.label}`}
              </Button>
            </div>
          )}

          <div className="text-sm text-slate-200 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Type</span>
              <span>{infoTypeLabel}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Sent at</span>
              <span>{sentAtLabel}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">
                {bridgeResult?.state === "success" ? "Completed at" : "Estimated time"}
              </span>
              <span>{bridgeResult?.state === "success" ? completedLabel || "—" : etaLabel}</span>
            </div>
          </div>

          <div className="text-center text-xs text-slate-500">
            {bridgeResult.state === "success"
              ? "Your burn & mint has been completed."
              : "Circle is processing your transfer. It’s safe to close the window."}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-gradient-to-br from-slate-800/95 via-slate-800/98 to-slate-900/100 backdrop-blur-sm border-slate-700/50 text-white">
      <CardContent className="p-6 space-y-8">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">{pendingTitle}</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            className="rounded-full bg-slate-700/50 hover:bg-slate-600/50 border border-slate-600 h-8 w-8"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center justify-between mb-8">
          <div className="flex flex-col items-center">
            <div className="text-center">
              <div className="flex items-center justify-center mb-2">
                <Image
                  src={`/${displayFrom.value}.svg`}
                  width={24}
                  height={24}
                  className="w-6 h-6 mr-2"
                  alt={displayFrom.label}
                />
                <div className="font-medium">{displayFrom.label}</div>
              </div>

              <div className="text-sm text-slate-400">{amount} USDC</div>
            </div>
          </div>

          <ArrowRight className="text-slate-500" />

          <div className="flex flex-col items-end">
            <div className="flex items-center justify-center mb-2">
              <Image
                src={`/${displayTo.value}.svg`}
                width={24}
                height={24}
                className="w-6 h-6 mr-2"
                alt={displayTo.label}
              />
              <div className="font-medium">{displayTo.label}</div>
            </div>
            <div className="text-sm text-slate-400">{recipientLabel}</div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="text-sm text-slate-200 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Type</span>
              <span>{infoTypeLabel}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Sent at</span>
              <span>{sentAtLabel}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Estimated time</span>
              <span>{etaLabel}</span>
            </div>
          </div>

          <div className="flex flex-col items-center">
            <div className="relative w-20 h-20 mb-4">
              <div className="absolute inset-0 rounded-full border-4 border-slate-700"></div>
              <div
                className="absolute inset-0 rounded-full border-4 border-blue-500 transition-all duration-1000"
                style={{
                  clipPath: `polygon(50% 50%, 50% 0%, ${
                    progress > 75 ? "100% 0%" : "50% 0%"
                  }, ${
                    progress > 50
                      ? "100% 100%"
                      : progress > 25
                      ? "100% 50%"
                      : "50% 0%"
                  }, ${progress > 25 ? "0% 100%" : "50% 50%"}, ${
                    progress > 0 ? "0% 0%" : "50% 0%"
                  }, 50% 0%)`,
                  transform: "rotate(90deg)",
                }}
              ></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="h-10 w-10 animate-spin text-blue-500" />
              </div>
            </div>

            {estimatedTime ? (
              <div className="text-center mb-4">
                <div className="text-2xl font-bold mb-1">
                  {timeLeft === 0 ? "Still waiting..." : formatTime(timeLeft)}
                </div>
                <div className="text-sm text-slate-400">
                  {timeLeft === 0
                    ? "Waiting for confirmation"
                    : "Estimated time remaining"}
                </div>
              </div>
            ) : (
              <div className="text-center mb-4">
                <div className="text-2xl font-bold mb-1">Bridge in progress</div>
                <div className="text-sm text-slate-400">
                  Circle will update steps automatically.
                </div>
              </div>
            )}
          </div>

          <div className="text-center text-xs text-slate-500">
            Circle is processing your transfer. It’s safe to close the window.
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
