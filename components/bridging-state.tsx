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
import { useClaim } from "@/lib/hooks/useClaim";
import { useTransactionStore } from "@/lib/store/transactionStore";

type BridgeResultWithMeta = BridgeResult & { completedAt?: Date };

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
  bridgeResult?: BridgeResultWithMeta;
  confirmations?: { standard?: number; fast?: number };
  finalityEstimate?: string;
  transferType?: "fast" | "standard";
  startedAt?: Date;
  estimatedTimeLabel?: string;
  onBridgeResultUpdate?: (result: BridgeResultWithMeta) => void;
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
  onBridgeResultUpdate,
}: BridgingStateProps) {
  const { chain } = useAccount();
  const { switchChain, isPending: isSwitchingChain } = useSwitchChain();
  const { toast } = useToast();
  const { retryClaim, isClaiming } = useClaim();
  const { updateTransaction } = useTransactionStore();
  const [timeLeft, setTimeLeft] = useState(estimatedTime ?? 0);
  const [localBridgeResult, setLocalBridgeResult] = useState<
    BridgeResultWithMeta | undefined
  >(bridgeResult);

  useEffect(() => {
    setLocalBridgeResult(bridgeResult);
  }, [bridgeResult]);

  const baseResult = localBridgeResult ?? bridgeResult;

  const CLAIMED_MESSAGE = "USDC claimed. Check your wallet for the USDC";

  const extractHashes = (res: BridgeResultWithMeta) => {
    let burnHash: `0x${string}` | undefined;
    let mintHash: `0x${string}` | undefined;
    let completedAt: Date | undefined;

    for (const step of res.steps) {
      if (!burnHash && step.txHash) {
        burnHash = step.txHash as `0x${string}`;
      }
      if (step.txHash && /mint|claim|receive/i.test(step.name)) {
        mintHash = step.txHash as `0x${string}`;
      }
      if (step.state === "success") {
        completedAt = new Date();
      }
    }

    return { burnHash, mintHash, completedAt };
  };

  const displayResult = useMemo(() => {
    if (!baseResult) return undefined;
    const hasNonceUsed = baseResult.steps.some(
      (step) =>
        /nonce already used/i.test(step.errorMessage || "") ||
        /nonce already used/i.test(String(step.error || ""))
    );
    if (!hasNonceUsed) return baseResult;

    const normalizedSteps = baseResult.steps.map((step) => {
      const nonceUsed =
        /nonce already used/i.test(step.errorMessage || "") ||
        /nonce already used/i.test(String(step.error || ""));

      if (nonceUsed && /mint/i.test(step.name)) {
        return {
          ...step,
          state: "success" as const,
          errorMessage: CLAIMED_MESSAGE,
        };
      }
      return step;
    });

    return {
      ...baseResult,
      state: "success" as const,
      steps: normalizedSteps,
    };
  }, [baseResult]);

  const completedAtDate = useMemo(() => {
    if (!displayResult) return null;
    if (displayResult.completedAt) return new Date(displayResult.completedAt);
    const hashes = extractHashes(displayResult);
    if (hashes.completedAt) return hashes.completedAt;
    if (displayResult.state === "success") return new Date();
    return null;
  }, [displayResult]);

  const formatCompletedLabel = (
    completedAt: Date | null,
    started?: Date | null
  ) => {
    if (!completedAt) return null;
    const datePart = completedAt.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    const timePart = completedAt.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const formattedTime = `${datePart} ${timePart}`;
    if (!started) return formattedTime;
    const durationMs = completedAt.getTime() - started.getTime();
    if (Number.isFinite(durationMs) && durationMs > 0) {
      const minutes = Math.max(1, Math.round(durationMs / 60000));
      return `${formattedTime} (${minutes}min)`;
    }
    return formattedTime;
  };

  useEffect(() => {
    if (
      baseResult &&
      displayResult &&
      baseResult.state !== displayResult.state &&
      onBridgeResultUpdate
    ) {
      onBridgeResultUpdate(displayResult);
    }
  }, [baseResult, displayResult, onBridgeResultUpdate]);

  useEffect(() => {
    if (!displayResult) return;
    const { burnHash, mintHash, completedAt } = extractHashes(displayResult);
    if (!burnHash) return;

    if (displayResult.state === "success") {
      updateTransaction(burnHash, {
        bridgeResult: displayResult,
        bridgeState: "success",
        status: "claimed",
        steps: displayResult.steps,
        claimHash: mintHash,
        completedAt: displayResult.completedAt ?? completedAtDate ?? completedAt ?? new Date(),
      });
    }
  }, [completedAtDate, displayResult, updateTransaction]);

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
    Math.min(100, estimatedTime ? 100 - (timeLeft / estimatedTime) * 100 : 0)
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
    estimatedTimeLabel ||
    finalityEstimate ||
    (transferType === "fast" ? "~1 minute" : "13-19 minutes");
  const completedLabel =
    displayResult?.state === "success"
      ? formatCompletedLabel(completedAtDate, startedAt ?? null)
      : null;

  const destinationChainId = useMemo(() => {
    const bridgeDest = (
      displayResult?.destination?.chain as { chainId?: number } | undefined
    )?.chainId;
    if (bridgeDest) return bridgeDest;
    return toChain?.value ? Number(toChain.value) : undefined;
  }, [displayResult?.destination?.chain, toChain?.value]);

  const sourceChainId = useMemo(() => {
    const bridgeSource = (
      displayResult?.source?.chain as { chainId?: number } | undefined
    )?.chainId;
    if (bridgeSource) return bridgeSource;
    return fromChain?.value ? Number(fromChain.value) : undefined;
  }, [displayResult?.source?.chain, fromChain?.value]);

  const displayFrom = useMemo(() => {
    const chainName =
      (displayResult?.source?.chain as { name?: string } | undefined)?.name ||
      fromChain.label;
    const value =
      (displayResult?.source?.chain as { chainId?: number } | undefined)
        ?.chainId || (fromChain.value ? Number(fromChain.value) : undefined);
    return {
      label: chainName,
      value: value?.toString() || fromChain.value,
    };
  }, [displayResult?.source?.chain, fromChain.label, fromChain.value]);

  const displayTo = useMemo(() => {
    const chainName =
      (displayResult?.destination?.chain as { name?: string } | undefined)
        ?.name || toChain.label;
    const value =
      (displayResult?.destination?.chain as { chainId?: number } | undefined)
        ?.chainId || (toChain.value ? Number(toChain.value) : undefined);
    return {
      label: chainName,
      value: value?.toString() || toChain.value,
    };
  }, [displayResult?.destination?.chain, toChain.label, toChain.value]);

  const onDestinationChain =
    chain?.id && destinationChainId ? chain.id === destinationChainId : false;

  const handleRetry = async (options?: { forceRetry?: boolean }) => {
    if (!destinationChainId || !displayResult) return;
    try {
      if (!onDestinationChain) {
        await switchChain({ chainId: destinationChainId });
      }

      const claimStep =
        displayResult?.steps.find((step) => /mint|claim/i.test(step.name)) ||
        displayResult?.steps.find((step) => step.txHash);

      if (claimStep?.txHash && !options?.forceRetry) {
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

      const retryResult = await retryClaim(displayResult, {
        onStep: (steps) => {
          setLocalBridgeResult((prev) => (prev ? { ...prev, steps } : prev));
        },
      });
      setLocalBridgeResult(retryResult);
      onBridgeResultUpdate?.(retryResult);
    } catch (err) {
      console.error("Claim retry failed", err);
      toast({
        title: "Claim failed",
        description:
          err instanceof Error ? err.message : "Unable to submit claim",
        variant: "destructive",
      });
    }
  };

  if (displayResult) {
    const primaryStep =
      displayResult.steps.find(
        (step) => step.state === "success" && step.txHash
      ) || displayResult.steps.find((step) => step.txHash);
    const primaryHash = primaryStep?.txHash;
    const primaryExplorer = primaryStep?.explorerUrl;
    const stateLabel =
      displayResult.state === "success" ? "Bridge Completed" : pendingTitle;

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
                  {displayResult.state === "success" ? "Minted" : "Pending"}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-3 text-sm">
            {displayResult.steps.map((step, idx) => {
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
                            ? "bg-yellow-400"
                            : "bg-red-400"
                        }`}
                      />
                      <span>{step.name}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      {step.txHash ? (
                        <>
                          <span>{`${step.txHash.slice(
                            0,
                            6
                          )}...${step.txHash.slice(-4)}`}</span>
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
                                  ? getExplorerTxUrl(destinationChainId, txHash)
                                  : sourceChainId
                                  ? getExplorerTxUrl(sourceChainId, txHash)
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

          <div className="flex flex-col gap-2">
            <Button
              className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              disabled={
                isSwitchingChain ||
                isClaiming ||
                displayResult.state === "success"
              }
              onClick={() => handleRetry()}
            >
              {displayResult.state === "success" ? (
                "Claimed"
              ) : isClaiming ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Claiming...
                </span>
              ) : onDestinationChain ? (
                `Claim ${amount} USDC`
              ) : (
                `Switch chain to ${displayTo.label}`
              )}
            </Button>
          </div>

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
                {displayResult?.state === "success"
                  ? "Completed at"
                  : "Estimated time"}
              </span>
              <span>
                {displayResult?.state === "success"
                  ? completedLabel || "—"
                  : etaLabel}
              </span>
            </div>
          </div>

          <div className="text-center text-xs text-slate-500">
            {displayResult.state === "success"
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
                <div className="text-2xl font-bold mb-1">
                  Bridge in progress
                </div>
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
