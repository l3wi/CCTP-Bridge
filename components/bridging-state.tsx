"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight, Loader2, X } from "lucide-react";
import { formatTime } from "@/lib/utils";
import Image from "next/image";
import type { BridgeResult } from "@circle-fin/bridge-kit";

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
}: BridgingStateProps) {
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

  if (bridgeResult) {
    const primaryStep =
      bridgeResult.steps.find((step) => step.state === "success" && step.txHash) ||
      bridgeResult.steps.find((step) => step.txHash);
    const primaryHash = primaryStep?.txHash;
    const primaryExplorer = primaryStep?.explorerUrl;
    const stateLabel =
      bridgeResult.state === "success"
        ? "Bridge Completed"
        : bridgeResult.state === "error"
        ? "Bridge Failed"
        : "Bridge Processing";

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
                src={`/${fromChain.value}.svg`}
                width={24}
                height={24}
                className="w-6 h-6"
                alt={fromChain.label}
              />
              <div>
                <div className="font-medium">{fromChain.label}</div>
                <div className="text-xs text-slate-400">{amount} USDC</div>
              </div>
            </div>
            <ArrowRight className="text-slate-500" />
            <div className="flex items-center gap-2">
              <Image
                src={`/${toChain.value}.svg`}
                width={24}
                height={24}
                className="w-6 h-6"
                alt={toChain.label}
              />
              <div>
                <div className="font-medium">{toChain.label}</div>
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
                        : step.state === "pending"
                        ? "bg-yellow-400"
                        : "bg-red-400"
                    }`}
                  />
                  <span>{step.name}</span>
                </div>
                <div className="text-xs text-slate-400">
                  {step.txHash
                    ? `${step.txHash.slice(0, 6)}...${step.txHash.slice(-4)}`
                    : step.state}
                </div>
              </div>
            ))}
          </div>

          {primaryHash && (
            <Button
              variant="outline"
              className="w-full border-blue-700 text-white hover:bg-blue-700/50 hover:text-white bg-blue-800"
              onClick={() => {
                if (primaryExplorer) {
                  window.open(primaryExplorer, "_blank");
                  return;
                }
                navigator.clipboard.writeText(primaryHash);
              }}
            >
              View Transaction
            </Button>
          )}

          <div className="text-center text-xs text-slate-500">
            {bridgeResult.state === "success"
              ? "Bridge Kit completed burn and mint."
              : "Bridge Kit is processing your transfer. Keep this window open."}
          </div>

          {(confirmations?.standard || confirmations?.fast || finalityEstimate) && (
            <div className="text-xs text-slate-400 space-y-1">
              {confirmations?.standard ? (
                <div>Source confirmations (standard): {confirmations.standard} blocks</div>
              ) : null}
              {confirmations?.fast ? (
                <div>Source confirmations (fast): {confirmations.fast} blocks</div>
              ) : null}
              {finalityEstimate ? <div>Typical attestation time: {finalityEstimate}</div> : null}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-gradient-to-br from-slate-800/95 via-slate-800/98 to-slate-900/100 backdrop-blur-sm border-slate-700/50 text-white">
      <CardContent className="p-6 space-y-8">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Bridging in Progress</h2>
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
                  src={`/${fromChain.value}.svg`}
                  width={24}
                  height={24}
                  className="w-6 h-6 mr-2"
                  alt={fromChain.label}
                />
                <div className="font-medium">{fromChain.label}</div>
              </div>

              <div className="text-sm text-slate-400">{amount} USDC</div>
            </div>
          </div>

          <ArrowRight className="text-slate-500" />

          <div className="flex flex-col items-center">
            <div className="text-center">
              <div className="flex items-center justify-center mb-2">
                <Image
                  src={`/${toChain.value}.svg`}
                  width={24}
                  height={24}
                  className="w-6 h-6 mr-2"
                  alt={toChain.label}
                />
                <div className="font-medium">{toChain.label}</div>
              </div>
              <div className="text-sm text-slate-400">{recipientLabel}</div>
            </div>
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
              }}
            ></div>
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="h-10 w-10 animate-spin text-blue-500" />
            </div>
          </div>

          {estimatedTime ? (
            <div className="text-center mb-8">
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
            <div className="text-center mb-8">
              <div className="text-2xl font-bold mb-1">Bridge in progress</div>
              <div className="text-sm text-slate-400">
                Bridge Kit will update steps automatically.
              </div>
            </div>
          )}
        </div>

        <div className="text-center text-xs text-slate-500">
          <p>Your transaction is being processed via Bridge Kit.</p>
          <p>Steps will update automatically once confirmed.</p>
        </div>

        {(confirmations?.standard || confirmations?.fast || finalityEstimate) && (
          <div className="text-xs text-slate-400 space-y-1 text-center">
            {confirmations?.standard ? (
              <div>Source confirmations (standard): {confirmations.standard} blocks</div>
            ) : null}
            {confirmations?.fast ? (
              <div>Source confirmations (fast): {confirmations.fast} blocks</div>
            ) : null}
            {finalityEstimate ? <div>Typical attestation time: {finalityEstimate}</div> : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
