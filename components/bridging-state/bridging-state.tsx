"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight, X } from "lucide-react";
import { ChainIcon } from "@/components/chain-icon";
import type { BridgeResult } from "@circle-fin/bridge-kit";
import { useAccount, useSwitchChain } from "wagmi";
import { useWallet } from "@solana/wallet-adapter-react";
import { useTransactionStore } from "@/lib/store/transactionStore";
import { ChainId, isSolanaChain, asTxHash, asUniversalTxHash } from "@/lib/types";

import { useBridgeSteps } from "@/lib/hooks/useBridgeSteps";
import { useMintPolling } from "@/lib/hooks/useMintPolling";
import { useBurnPolling } from "@/lib/hooks/useBurnPolling";
import { useClaimHandler } from "@/lib/hooks/useClaimHandler";

import { ChainPair } from "./chain-pair";
import { StepList } from "./step-list";
import { ClaimSection } from "./claim-section";
import { BridgeInfo } from "./bridge-info";
import { ProgressSpinner } from "./progress-spinner";
import type { BridgingStateProps, BridgeResultWithMeta, ChainDisplay } from "./types";

const CLAIMED_MESSAGE = "USDC claimed. Check your wallet for the USDC";

export function BridgingState({
  fromChain,
  toChain,
  amount,
  estimatedTime,
  recipientAddress,
  onBack,
  bridgeResult,
  transferType,
  startedAt,
  estimatedTimeLabel,
  finalityEstimate,
  onBridgeResultUpdate,
}: BridgingStateProps) {
  const { chain } = useAccount();
  const { isPending: isSwitchingChain } = useSwitchChain();
  const solanaWallet = useWallet();
  const { updateTransaction } = useTransactionStore();

  // Local state
  const [timeLeft, setTimeLeft] = useState(estimatedTime ?? 0);
  const [localBridgeResult, setLocalBridgeResult] = useState<BridgeResultWithMeta | undefined>(bridgeResult);
  const [burnCompletedAt, setBurnCompletedAt] = useState<Date | null>(null);
  const [mintCompletedAt, setMintCompletedAt] = useState<Date | null>(null);

  // Sync prop to local state
  useEffect(() => {
    setLocalBridgeResult(bridgeResult);
  }, [bridgeResult]);

  const baseResult = localBridgeResult ?? bridgeResult;

  // Normalize nonce-already-used errors to success state
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

  // Extract chain IDs
  const destinationChainId: ChainId | undefined = useMemo(() => {
    const chainDef = displayResult?.destination?.chain as { chainId?: number; chain?: string } | undefined;
    const bridgeChainId = chainDef?.chainId ?? chainDef?.chain;
    if (bridgeChainId) return bridgeChainId as ChainId;
    if (!toChain?.value) return undefined;
    const numValue = Number(toChain.value);
    return !isNaN(numValue) ? numValue : (toChain.value as ChainId);
  }, [displayResult?.destination?.chain, toChain?.value]);

  const sourceChainId: ChainId | undefined = useMemo(() => {
    const chainDef = displayResult?.source?.chain as { chainId?: number; chain?: string } | undefined;
    const bridgeChainId = chainDef?.chainId ?? chainDef?.chain;
    if (bridgeChainId) return bridgeChainId as ChainId;
    if (!fromChain?.value) return undefined;
    const numValue = Number(fromChain.value);
    return !isNaN(numValue) ? numValue : (fromChain.value as ChainId);
  }, [displayResult?.source?.chain, fromChain?.value]);

  // Extract burn tx hash
  const burnTxHash = useMemo(() => {
    if (!displayResult?.steps) return null;
    const burnStep = displayResult.steps.find((s) => /burn/i.test(s.name));
    const burnHash = asUniversalTxHash(burnStep?.txHash);
    if (burnHash) return burnHash;
    const firstWithHash = displayResult.steps.find((s) => s.txHash);
    return asUniversalTxHash(firstWithHash?.txHash) ?? null;
  }, [displayResult?.steps]);

  // Use extracted hooks
  const { derivedSteps, hasFetchAttestation, hasBurnCompleted, hasBurnFailed, hasMintCompleted } = useBridgeSteps({
    bridgeResult: displayResult,
    sourceChainId,
  });

  // Callback to update steps from polling
  const handleStepsUpdate = useCallback((updatedSteps: BridgeResult["steps"]) => {
    setLocalBridgeResult((prev) =>
      prev ? { ...prev, steps: updatedSteps, state: "success" } : prev
    );
  }, []);

  // Handle burn failure detected by polling
  const handleBurnFailed = useCallback(
    (error: string) => {
      // Update local steps to mark burn as failed
      setLocalBridgeResult((prev) => {
        if (!prev) return prev;
        const updatedSteps = prev.steps.map((step) =>
          /burn/i.test(step.name) ? { ...step, state: "error" as const, errorMessage: error } : step
        );
        // BridgeResult uses "error" state, not "failed"
        return { ...prev, steps: updatedSteps, state: "error" as const };
      });

      // Persist to store (LocalTransaction uses "failed" status)
      if (burnTxHash) {
        const txHash = asTxHash(burnTxHash);
        if (txHash) {
          updateTransaction(txHash, { status: "failed", bridgeState: "error" });
        }
      }
    },
    [burnTxHash, updateTransaction]
  );

  // Handle burn confirmation (no-op, just for tracking)
  const handleBurnConfirmed = useCallback(() => {
    // Burn is confirmed - normal flow continues with mint polling
  }, []);

  // Burn transaction polling - detects burn failures
  const { confirmed: burnConfirmed, failed: burnPollingFailed } = useBurnPolling({
    burnTxHash,
    sourceChainId,
    onBurnFailed: handleBurnFailed,
    onBurnConfirmed: handleBurnConfirmed,
    // Disable polling if burn already completed or failed
    disabled: hasBurnCompleted || hasBurnFailed,
  });

  const {
    canMint,
    alreadyMinted,
    attestationReady,
    checking: isCheckingMint,
    setAlreadyMinted,
  } = useMintPolling({
    burnTxHash,
    sourceChainId,
    destinationChainId,
    burnCompletedAt,
    startedAt,
    isSuccess: displayResult?.state === "success",
    hasBurnCompleted,
    hasFetchAttestation,
    displaySteps: displayResult?.steps || [],
    onStepsUpdate: handleStepsUpdate,
  });

  // Check if user is on destination chain
  const onDestinationChain = useMemo(() => {
    if (!destinationChainId) return false;
    if (isSolanaChain(destinationChainId)) {
      return solanaWallet.connected;
    }
    return chain?.id === destinationChainId;
  }, [destinationChainId, chain?.id, solanaWallet.connected]);

  // Claim handler callbacks
  const handleClaimSuccess = useCallback(
    (updatedSteps: BridgeResult["steps"]) => {
      setLocalBridgeResult((prev) =>
        prev ? { ...prev, state: "success", steps: updatedSteps } : prev
      );

      if (displayResult) {
        onBridgeResultUpdate?.({
          ...displayResult,
          state: "success",
          steps: updatedSteps,
        });
      }
    },
    [displayResult, onBridgeResultUpdate]
  );

  const handleAlreadyMinted = useCallback(() => {
    setAlreadyMinted(true);
  }, [setAlreadyMinted]);

  const { handleClaim, isClaiming } = useClaimHandler({
    destinationChainId,
    sourceChainId,
    burnTxHash,
    displayResult,
    onDestinationChain,
    onSuccess: handleClaimSuccess,
    onAlreadyMinted: handleAlreadyMinted,
  });

  // Track burn/mint completion timestamps
  useEffect(() => {
    if (!displayResult) return;

    const burnStep = displayResult.steps.find((step) => /burn/i.test(step.name));
    const mintStep = displayResult.steps.find((step) => /mint|claim|receive/i.test(step.name));

    if (burnStep?.state === "success" && !burnCompletedAt) {
      setBurnCompletedAt(new Date());
    }

    if (
      (mintStep?.state === "success" ||
        /nonce already used/i.test(mintStep?.errorMessage || "") ||
        /nonce already used/i.test(String(mintStep?.error || ""))) &&
      !mintCompletedAt
    ) {
      setMintCompletedAt(new Date());
    }

    // Update store on success
    if (displayResult.state === "success" && burnTxHash) {
      const burnHash = asTxHash(burnTxHash);
      const mintHash = displayResult.steps.find((s) => /mint|claim|receive/i.test(s.name))?.txHash;
      if (burnHash) {
        updateTransaction(burnHash, {
          bridgeResult: displayResult,
          bridgeState: "success",
          status: "claimed",
          steps: displayResult.steps,
          claimHash: mintHash ? asTxHash(mintHash) : undefined,
          completedAt: mintCompletedAt ?? new Date(),
        });
      }
    }
  }, [burnCompletedAt, displayResult, mintCompletedAt, burnTxHash, updateTransaction]);

  // Update parent on state change
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

  // Countdown timer
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

  // Computed display values
  const progress = Math.max(
    0,
    Math.min(100, estimatedTime ? 100 - (timeLeft / estimatedTime) * 100 : 0)
  );

  const recipientLabel = recipientAddress
    ? `${recipientAddress.slice(0, 6)}...${recipientAddress.slice(-4)}`
    : "Pending";

  const infoTypeLabel = transferType === "fast" ? "Fast" : "Standard";
  const pendingTitle = `${infoTypeLabel} Bridge Pending`;

  const sentAtLabel = (burnCompletedAt ?? startedAt ?? null)
    ? (burnCompletedAt ?? startedAt ?? new Date()).toLocaleString(undefined, {
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

  const formatCompletedLabel = (completedAt: Date | null, started?: Date | null) => {
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

  const completedAtDate = useMemo(() => {
    if (mintCompletedAt) return mintCompletedAt;
    if (!displayResult) return null;
    if (displayResult.completedAt) return new Date(displayResult.completedAt);
    if (displayResult.state === "success") return new Date();
    return null;
  }, [displayResult, mintCompletedAt]);

  const completedLabel =
    displayResult?.state === "success" && (mintCompletedAt || completedAtDate)
      ? formatCompletedLabel(mintCompletedAt ?? completedAtDate, startedAt ?? null)
      : null;

  const displayFrom: ChainDisplay = useMemo(() => {
    const chainDef = displayResult?.source?.chain as { name?: string; chainId?: number; chain?: string } | undefined;
    const chainName = chainDef?.name || fromChain.label;
    const chainId: ChainId | undefined = chainDef?.chainId ?? chainDef?.chain as ChainId | undefined;
    const value = chainId ?? (fromChain.value && !isNaN(Number(fromChain.value)) ? Number(fromChain.value) : fromChain.value as ChainId);
    return { label: chainName, value };
  }, [displayResult?.source?.chain, fromChain.label, fromChain.value]);

  const displayTo: ChainDisplay = useMemo(() => {
    const chainDef = displayResult?.destination?.chain as { name?: string; chainId?: number; chain?: string } | undefined;
    const chainName = chainDef?.name || toChain.label;
    const chainId: ChainId | undefined = chainDef?.chainId ?? chainDef?.chain as ChainId | undefined;
    const value = chainId ?? (toChain.value && !isNaN(Number(toChain.value)) ? Number(toChain.value) : toChain.value as ChainId);
    return { label: chainName, value };
  }, [displayResult?.destination?.chain, toChain.label, toChain.value]);

  // Show claim button logic
  const showClaimButton = useMemo(() => {
    // Never show claim button if burn failed
    if (hasBurnFailed || burnPollingFailed) return false;
    if (alreadyMinted) return false;
    if (hasMintCompleted) return false;
    if (canMint) return true;
    if (attestationReady) return true;
    // For Solana destinations: show claim button if burn is complete
    if (destinationChainId && isSolanaChain(destinationChainId) && hasBurnCompleted) {
      return true;
    }
    return hasFetchAttestation;
  }, [
    hasBurnFailed,
    burnPollingFailed,
    alreadyMinted,
    canMint,
    attestationReady,
    hasMintCompleted,
    hasBurnCompleted,
    hasFetchAttestation,
    destinationChainId,
  ]);

  // RENDER: With bridge result
  if (displayResult) {
    const stateLabel =
      hasBurnFailed || burnPollingFailed || displayResult.state === "error"
        ? "Bridge Failed"
        : displayResult.state === "success"
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

          <ChainPair
            from={displayFrom}
            to={displayTo}
            amount={amount}
            status={displayResult.state === "success" ? "success" : "pending"}
          />

          <StepList
            steps={derivedSteps}
            sourceChainId={sourceChainId}
            destinationChainId={destinationChainId}
          />

          <ClaimSection
            showClaimButton={showClaimButton}
            amount={amount}
            destinationLabel={displayTo.label}
            onDestinationChain={onDestinationChain}
            isClaiming={isClaiming}
            isCheckingMint={isCheckingMint}
            isSwitchingChain={isSwitchingChain}
            onClaim={handleClaim}
          />

          <BridgeInfo
            transferType={transferType}
            sentAtLabel={sentAtLabel}
            isSuccess={displayResult.state === "success"}
            completedLabel={completedLabel}
            etaLabel={etaLabel}
          />

          <div className="text-center text-xs text-slate-500">
            {hasBurnFailed || burnPollingFailed || displayResult.state === "error"
              ? "Your burn transaction failed. Please try again."
              : displayResult.state === "success"
                ? "Your burn & mint has been completed."
                : "Circle is processing your transfer. It's safe to close the window."}
          </div>
        </CardContent>
      </Card>
    );
  }

  // RENDER: Without bridge result (waiting state)
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
                <ChainIcon chainId={displayFrom.value} size={24} className="mr-2" />
                <div className="font-medium">{displayFrom.label}</div>
              </div>
              <div className="text-sm text-slate-400">{amount} USDC</div>
            </div>
          </div>

          <ArrowRight className="text-slate-500" />

          <div className="flex flex-col items-end">
            <div className="flex items-center justify-center mb-2">
              <ChainIcon chainId={displayTo.value} size={24} className="mr-2" />
              <div className="font-medium">{displayTo.label}</div>
            </div>
            <div className="text-sm text-slate-400">{recipientLabel}</div>
          </div>
        </div>

        <div className="space-y-4">
          <BridgeInfo
            transferType={transferType}
            sentAtLabel={sentAtLabel}
            isSuccess={false}
            completedLabel={null}
            etaLabel={etaLabel}
          />

          <ProgressSpinner
            timeLeft={timeLeft}
            progress={progress}
            estimatedTime={estimatedTime}
          />

          <div className="text-center text-xs text-slate-500">
            Circle is processing your transfer. It's safe to close the window.
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
