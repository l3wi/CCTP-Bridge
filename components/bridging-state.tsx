"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight, Loader2, X, CheckCircle } from "lucide-react";
import { formatTime } from "@/lib/utils";
import Image from "next/image";
import ClaimButton, { SwitchGuard } from "@/components/claimButton";
import { useAttestation } from "@/lib/hooks/useAttestation";
import { Chain as ViemChain } from "viem";

interface ChainInfo {
  value: string;
  label: string;
}

interface BridgingStateProps {
  fromChain: ChainInfo;
  toChain: ChainInfo;
  amount: string;
  estimatedTime: number; // in seconds
  recipientAddress?: `0x${string}` | string;
  onViewHistory: () => void;
  onBack: () => void;
  // Transaction hash to fetch attestation for
  hash?: `0x${string}`;
  // Chain IDs for attestation fetching
  originChainId?: number;
  destinationChain?: ViemChain; // viem Chain type for destination
  version?: "v1" | "v2";
  onClaimComplete?: () => void; // Callback when claim is completed
}

export function BridgingState({
  fromChain,
  toChain,
  amount,
  estimatedTime,
  recipientAddress,
  onViewHistory,
  onBack,
  hash,
  originChainId,
  destinationChain,
  version = "v2",
  onClaimComplete,
}: BridgingStateProps) {
  const [timeLeft, setTimeLeft] = useState(estimatedTime);
  const [isBurning, setIsBurning] = useState(false);
  const [prevBurningState, setPrevBurningState] = useState(false);

  // Use the attestation hook to fetch attestation data
  const {
    data: attestationData,
    isLoading: isAttestationLoading,
    error: attestationError,
    refetch,
  } = useAttestation(
    hash || ("0x" as `0x${string}`),
    originChainId || 0,
    destinationChain,
    {
      enabled: !!(hash && originChainId && hash !== "0x" && originChainId > 0),
      version,
    }
  );

  // Reset countdown when estimate changes
  useEffect(() => {
    setTimeLeft(estimatedTime);
  }, [estimatedTime]);

  useEffect(() => {
    if (timeLeft <= 0) return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [timeLeft]);

  // Check if attestation is available from the hook
  const isAttestationReady =
    attestationData &&
    attestationData.attestation &&
    attestationData.message &&
    hash;

  // Handle claim completion when burning state changes from true to false
  useEffect(() => {
    if (
      prevBurningState &&
      !isBurning &&
      isAttestationReady &&
      onClaimComplete
    ) {
      // When burning transitions from true to false, claim is completed
      onClaimComplete();
    }
    setPrevBurningState(isBurning);
  }, [isBurning, prevBurningState, isAttestationReady, onClaimComplete]);

  // Debug history button handler
  const handleViewHistory = () => {
    console.log("History button clicked, calling onViewHistory");
    onViewHistory();
  };

  const progress = Math.max(
    0,
    Math.min(100, 100 - (timeLeft / estimatedTime) * 100)
  );

  const recipientLabel = recipientAddress
    ? `${recipientAddress.slice(0, 6)}...${recipientAddress.slice(-4)}`
    : "Pending";

  // Show claim interface when attestation is ready
  if (isAttestationReady && attestationData) {
    return (
      <Card className="bg-gradient-to-br from-slate-800/95 via-slate-800/98 to-slate-900/100 backdrop-blur-sm border-slate-700/50 text-white">
        <CardContent className="p-6 space-y-8">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Ready to Claim</h2>
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
                <div className="text-sm text-slate-400">Ready to Receive</div>
              </div>
            </div>
          </div>

          <div className="flex flex-col items-center">
            <div className="relative w-20 h-20 mb-4">
              <div className="absolute inset-0 rounded-full border-4 border-green-500 bg-green-500/10">
                <div className="absolute inset-0 flex items-center justify-center">
                  <CheckCircle className="h-10 w-10 text-green-500" />
                </div>
              </div>
            </div>

            <div className="text-center mb-8">
              <div className="text-xl font-bold mb-1 text-green-400">
                Attestation Ready
              </div>
              <div className="text-sm text-slate-400">
                Click below to claim your USDC
              </div>
            </div>

            <div className="w-full space-y-4">
              <SwitchGuard bytes={attestationData.message} hash={hash}>
                <ClaimButton
                  hash={hash}
                  bytes={attestationData.message}
                  attestation={attestationData.attestation}
                  cctpVersion={attestationData.cctpVersion}
                  eventNonce={attestationData.eventNonce}
                  onBurn={setIsBurning}
                  onAttestationUpdate={() => {
                    // Trigger refetch of attestation data
                    refetch();
                  }}
                />
              </SwitchGuard>
            </div>
          </div>

          <div className="text-center text-xs text-slate-500">
            <p>Circle has provided attestation for your transaction</p>
            <p>You can now claim your USDC on {toChain.label}</p>
          </div>
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

          <div className="text-center mb-8">
            <div className="text-2xl font-bold mb-1">
              {isAttestationLoading
                ? "Fetching attestation..."
                : timeLeft === 0
                ? "Still waiting..."
                : formatTime(timeLeft)}
            </div>
            <div className="text-sm text-slate-400">
              {isAttestationLoading
                ? "Checking Circle's attestation service"
                : timeLeft === 0
                ? "Waiting for confirmation"
                : "Estimated time remaining"}
            </div>
            {attestationError && (
              <div className="text-sm text-red-400 mt-2">
                Error fetching attestation: {attestationError.message}
              </div>
            )}
          </div>
        </div>

        <div className="text-center text-xs text-slate-500">
          <p>
            Your transaction is being processed via CCTP{" "}
            {version?.toUpperCase()}
          </p>
          <p>Once Circle provides an attestation, you can claim your USDC</p>
        </div>
      </CardContent>
    </Card>
  );
}
