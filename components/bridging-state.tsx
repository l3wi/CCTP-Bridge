"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight, ExternalLink, Loader2, X } from "lucide-react";
import { formatTime } from "@/lib/utils";
import { ChainIcon } from "@/components/chain-icon";
import type { BridgeResult } from "@circle-fin/bridge-kit";
import { useAccount, useSwitchChain } from "wagmi";
import { useWallet } from "@solana/wallet-adapter-react";
import { useToast } from "@/components/ui/use-toast";
import { getExplorerTxUrlUniversal } from "@/lib/bridgeKit";
import { useClaim } from "@/lib/hooks/useClaim";
import { useDirectMint } from "@/lib/hooks/useDirectMint";
import { useDirectMintSolana } from "@/lib/hooks/useDirectMintSolana";
import { useTransactionStore } from "@/lib/store/transactionStore";
import { checkMintReadiness } from "@/lib/simulation";
import { asTxHash, ChainId, isSolanaChain } from "@/lib/types";

// Polling configuration constants
const POLL_START_DELAY_MS = 5 * 60 * 1000; // Start polling after 5 minutes
const POLL_INTERVAL_MS = 10_000; // Poll every 10 seconds
const MAX_POLL_DURATION_MS = 60 * 60 * 1000; // Stop polling after 1 hour of total poll time

const STEP_ORDER = [
  { id: "approve" as const, label: "Approve" },
  { id: "burn" as const, label: "Burn" },
  { id: "fetchAttestation" as const, label: "Fetch Attestation" },
  { id: "mint" as const, label: "Mint" },
];

const getStepId = (name: string) => {
  const lower = name.toLowerCase();
  if (lower.includes("approve")) return "approve" as const;
  if (lower.includes("burn")) return "burn" as const;
  if (lower.includes("attestation") || lower.includes("attest"))
    return "fetchAttestation" as const;
  if (lower.includes("mint") || lower.includes("claim") || lower.includes("receive"))
    return "mint" as const;
  return null;
};

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
  const solanaWallet = useWallet();
  const { toast } = useToast();
  const { retryClaim, isClaiming } = useClaim();
  const { executeMint, isMinting } = useDirectMint();
  const { executeMintSolana, isMinting: isMintingSolana } = useDirectMintSolana();
  const { updateTransaction } = useTransactionStore();
  const [timeLeft, setTimeLeft] = useState(estimatedTime ?? 0);
  const [localBridgeResult, setLocalBridgeResult] = useState<
    BridgeResultWithMeta | undefined
  >(bridgeResult);
  const [burnCompletedAt, setBurnCompletedAt] = useState<Date | null>(null);
  const [mintCompletedAt, setMintCompletedAt] = useState<Date | null>(null);

  // Mint simulation state for polling
  const [mintSimulation, setMintSimulation] = useState<{
    canMint: boolean;
    alreadyMinted: boolean;
    checking: boolean;
    attestationReady: boolean;
    lastChecked: Date | null;
    error?: string;
  }>({
    canMint: false,
    alreadyMinted: false,
    checking: false,
    attestationReady: false,
    lastChecked: null,
  });
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  // Track component mounted state to prevent setState after unmount
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

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
      const validatedHash = asTxHash(step.txHash);
      if (!burnHash && validatedHash) {
        burnHash = validatedHash;
      }
      if (validatedHash && /mint|claim|receive/i.test(step.name)) {
        mintHash = validatedHash;
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

  const derivedSteps = useMemo(() => {
    const existingSteps = (displayResult?.steps || []).flatMap((step) => {
      const id = getStepId(step.name);
      if (!id) return [];
      return [
        {
          ...step,
          id,
          label: STEP_ORDER.find((entry) => entry.id === id)?.label || step.name,
        },
      ];
    });

    // Check if burn step exists and is successful (implies approval succeeded)
    const burnStep = existingSteps.find((s) => s.id === "burn");
    const burnSucceeded = burnStep?.state === "success" || burnStep?.state === "noop";

    let previousCompleted = true;
    const filled: Array<
      (typeof existingSteps)[number] & { id: (typeof STEP_ORDER)[number]["id"]; label: string }
    > = [];

    for (const entry of STEP_ORDER) {
      const existing = existingSteps.find((s) => s.id === entry.id);
      if (existing) {
        filled.push(existing as any);
        previousCompleted = existing.state === "success" || existing.state === "noop";
      } else if (previousCompleted) {
        // If approve step is missing but burn succeeded, infer approve succeeded
        if (entry.id === "approve" && burnSucceeded) {
          filled.push({
            id: entry.id,
            label: entry.label,
            name: entry.label,
            state: "success" as const,
          } as any);
          previousCompleted = true;
        } else {
          filled.push({
            id: entry.id,
            label: entry.label,
            name: entry.label,
            state: "pending" as const,
          } as any);
          previousCompleted = false;
        }
      }
    }

    return filled;
  }, [displayResult?.steps]);

  const completedAtDate = useMemo(() => {
    if (mintCompletedAt) return mintCompletedAt;
    if (!displayResult) return null;
    if (displayResult.completedAt) return new Date(displayResult.completedAt);
    const hashes = extractHashes(displayResult);
    if (hashes.completedAt) return hashes.completedAt;
    if (displayResult.state === "success") return new Date();
    return null;
  }, [displayResult, mintCompletedAt]);

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
  }, [burnCompletedAt, completedAtDate, displayResult, mintCompletedAt, updateTransaction]);

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
  const completedLabel =
    displayResult?.state === "success" && (mintCompletedAt || completedAtDate)
      ? formatCompletedLabel(mintCompletedAt ?? completedAtDate, startedAt ?? null)
      : null;

  const destinationChainId: ChainId | undefined = useMemo(() => {
    // Handle both EVM (chainId: number) and Solana (chain: string) identifiers
    const chainDef = displayResult?.destination?.chain as { chainId?: number; chain?: string } | undefined;
    const bridgeChainId = chainDef?.chainId ?? chainDef?.chain;
    if (bridgeChainId) return bridgeChainId as ChainId;
    // Fallback to prop value - check if it's numeric (EVM) or string (Solana)
    if (!toChain?.value) return undefined;
    const numValue = Number(toChain.value);
    return !isNaN(numValue) ? numValue : (toChain.value as ChainId);
  }, [displayResult?.destination?.chain, toChain?.value]);

  const sourceChainId: ChainId | undefined = useMemo(() => {
    // Handle both EVM (chainId: number) and Solana (chain: string) identifiers
    const chainDef = displayResult?.source?.chain as { chainId?: number; chain?: string } | undefined;
    const bridgeChainId = chainDef?.chainId ?? chainDef?.chain;
    if (bridgeChainId) return bridgeChainId as ChainId;
    // Fallback to prop value - check if it's numeric (EVM) or string (Solana)
    if (!fromChain?.value) return undefined;
    const numValue = Number(fromChain.value);
    return !isNaN(numValue) ? numValue : (fromChain.value as ChainId);
  }, [displayResult?.source?.chain, fromChain?.value]);

  // Extract burn transaction hash for polling
  const burnTxHash = useMemo(() => {
    if (!displayResult?.steps) return null;
    // Find the burn step or first step with a tx hash
    const burnStep = displayResult.steps.find((s) => /burn/i.test(s.name));
    const burnHash = asTxHash(burnStep?.txHash);
    if (burnHash) return burnHash;
    // Fallback to first tx hash
    const firstWithHash = displayResult.steps.find((s) => s.txHash);
    return asTxHash(firstWithHash?.txHash) ?? null;
  }, [displayResult?.steps]);

  // Check if we should poll for mint readiness (>5 min old, not completed, within time limit)
  // Note: Polling only works for EVM destinations (uses contract simulation)
  const shouldPoll = useMemo(() => {
    // Don't poll if already successful
    if (displayResult?.state === "success") return false;
    if (mintSimulation.alreadyMinted) return false;

    // Don't poll if we don't have required data
    if (!burnTxHash || !sourceChainId || !destinationChainId) return false;

    // Don't poll for Solana destinations - checkMintReadiness is EVM-only
    if (isSolanaChain(destinationChainId)) return false;

    // Check if bridge is old enough to start polling
    const referenceTime = burnCompletedAt ?? startedAt;
    if (!referenceTime) return false;

    const ageMs = Date.now() - referenceTime.getTime();

    // Don't poll if not yet old enough
    if (ageMs < POLL_START_DELAY_MS) return false;

    // Stop polling after max duration (1 hour after poll start time)
    const pollDurationMs = ageMs - POLL_START_DELAY_MS;
    if (pollDurationMs >= MAX_POLL_DURATION_MS) return false;

    return true;
  }, [
    displayResult?.state,
    mintSimulation.alreadyMinted,
    burnTxHash,
    sourceChainId,
    destinationChainId,
    burnCompletedAt,
    startedAt,
  ]);

  // Poll for mint readiness at configured interval
  useEffect(() => {
    if (!shouldPoll) {
      // Clear any existing polling
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }

    // Capture steps at effect start to avoid stale closure
    const currentSteps = displayResult?.steps || [];

    const checkMint = async () => {
      if (!burnTxHash || !sourceChainId || !destinationChainId) return;
      if (!isMountedRef.current) return;
      // Skip for Solana destinations - checkMintReadiness is EVM-only
      if (isSolanaChain(destinationChainId)) return;

      setMintSimulation((prev) => ({ ...prev, checking: true }));

      try {
        const result = await checkMintReadiness(
          sourceChainId as number,
          destinationChainId as number,
          burnTxHash
        );

        // Check if still mounted after async operation
        if (!isMountedRef.current) return;

        setMintSimulation({
          canMint: result.canMint,
          alreadyMinted: result.alreadyMinted,
          checking: false,
          attestationReady: result.attestationReady,
          lastChecked: new Date(),
          error: result.error,
        });

        // If already minted, update the transaction
        if (result.alreadyMinted && burnTxHash) {
          const updatedSteps = currentSteps.map((step) => {
            if (/attestation|attest/i.test(step.name)) {
              return { ...step, state: "success" as const };
            }
            if (/mint|claim|receive/i.test(step.name)) {
              return {
                ...step,
                state: "success" as const,
                errorMessage: "USDC claimed. Check your wallet for the USDC",
              };
            }
            return step;
          });

          updateTransaction(burnTxHash, {
            status: "claimed",
            bridgeState: "success",
            completedAt: new Date(),
            steps: updatedSteps,
          });

          if (isMountedRef.current) {
            setLocalBridgeResult((prev) =>
              prev ? { ...prev, state: "success", steps: updatedSteps } : prev
            );
          }
        }
      } catch (error) {
        console.error("Mint readiness check failed:", error);
        if (!isMountedRef.current) return;
        setMintSimulation((prev) => ({
          ...prev,
          checking: false,
          error: "Failed to check mint status",
        }));
      }
    };

    // Check immediately
    checkMint();

    // Then poll at configured interval
    pollingRef.current = setInterval(checkMint, POLL_INTERVAL_MS);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [
    shouldPoll,
    burnTxHash,
    sourceChainId,
    destinationChainId,
    displayResult?.steps,
    updateTransaction,
  ]);

  const displayFrom = useMemo(() => {
    const chainDef = displayResult?.source?.chain as { name?: string; chainId?: number; chain?: string } | undefined;
    const chainName = chainDef?.name || fromChain.label;
    // Handle both EVM (numeric chainId) and Solana (string chain identifier)
    const chainId: ChainId | undefined = chainDef?.chainId ?? chainDef?.chain as ChainId | undefined;
    const value = chainId ?? (fromChain.value && !isNaN(Number(fromChain.value)) ? Number(fromChain.value) : fromChain.value as ChainId);
    return {
      label: chainName,
      value,
    };
  }, [displayResult?.source?.chain, fromChain.label, fromChain.value]);

  const displayTo = useMemo(() => {
    const chainDef = displayResult?.destination?.chain as { name?: string; chainId?: number; chain?: string } | undefined;
    const chainName = chainDef?.name || toChain.label;
    // Handle both EVM (numeric chainId) and Solana (string chain identifier)
    const chainId: ChainId | undefined = chainDef?.chainId ?? chainDef?.chain as ChainId | undefined;
    const value = chainId ?? (toChain.value && !isNaN(Number(toChain.value)) ? Number(toChain.value) : toChain.value as ChainId);
    return {
      label: chainName,
      value,
    };
  }, [displayResult?.destination?.chain, toChain.label, toChain.value]);

  const onDestinationChain = useMemo(() => {
    if (!destinationChainId) return false;

    if (isSolanaChain(destinationChainId)) {
      // For Solana destinations, check Solana wallet is connected
      return solanaWallet.connected;
    }
    // For EVM destinations, check EVM chain matches
    return chain?.id === destinationChainId;
  }, [destinationChainId, chain?.id, solanaWallet.connected]);

  // Direct mint handler - uses SDK for Solana, direct mint for EVM
  const handleClaim = useCallback(async () => {
    if (!destinationChainId || !sourceChainId || !burnTxHash) {
      toast({
        title: "Cannot claim",
        description: "Missing transaction details",
        variant: "destructive",
      });
      return;
    }

    const isDestSolana = isSolanaChain(destinationChainId);

    if (isDestSolana) {
      // SOLANA DESTINATION: Use direct mint via adapter's prepareAction
      if (!solanaWallet.connected) {
        toast({
          title: "Connect Solana wallet",
          description: "Please connect your Solana wallet to claim",
          variant: "destructive",
        });
        return;
      }

      // Execute direct mint on Solana
      const result = await executeMintSolana(
        burnTxHash,
        sourceChainId,
        destinationChainId as import("@/lib/types").SolanaChainId,
        displayResult?.steps
      );

      if (result.success || result.alreadyMinted) {
        // Update local state
        const updatedSteps = (displayResult?.steps || []).map((step) => {
          if (/attestation|attest/i.test(step.name)) {
            return { ...step, state: "success" as const };
          }
          if (/mint|claim|receive/i.test(step.name)) {
            return {
              ...step,
              state: "success" as const,
              txHash: result.mintTxHash,
              errorMessage: result.alreadyMinted
                ? "USDC claimed. Check your wallet for the USDC"
                : undefined,
            };
          }
          return step;
        });

        // Add mint step if it doesn't exist
        if (!updatedSteps.some((s) => /mint|claim|receive/i.test(s.name))) {
          updatedSteps.push({
            name: "Mint",
            state: "success",
            txHash: result.mintTxHash,
            errorMessage: result.alreadyMinted
              ? "USDC claimed. Check your wallet for the USDC"
              : undefined,
          });
        }

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
      } else if (result.error) {
        toast({
          title: "Claim failed",
          description: result.error,
          variant: "destructive",
        });
      }
    } else {
      // EVM DESTINATION: Use direct mint (existing logic)
      if (!onDestinationChain) {
        try {
          await switchChain({ chainId: destinationChainId as number });
          // Wait a moment for chain switch to complete
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } catch (err) {
          toast({
            title: "Chain switch required",
            description: `Please switch to the destination chain to claim`,
            variant: "destructive",
          });
          return;
        }
      }

      // Execute direct mint for EVM
      const result = await executeMint(
        burnTxHash,
        sourceChainId as number,
        destinationChainId as number,
        displayResult?.steps
      );

      if (result.success || result.alreadyMinted) {
        // Update local state - handle both successful mint and already minted cases
        const updatedSteps = (displayResult?.steps || []).map((step) => {
          if (/attestation|attest/i.test(step.name)) {
            return { ...step, state: "success" as const };
          }
          if (/mint|claim|receive/i.test(step.name)) {
            return {
              ...step,
              state: "success" as const,
              txHash: result.mintTxHash,
              errorMessage: result.alreadyMinted
                ? "USDC claimed. Check your wallet for the USDC"
                : undefined,
            };
          }
          return step;
        });

        // Add mint step if it doesn't exist
        if (!updatedSteps.some((s) => /mint|claim|receive/i.test(s.name))) {
          updatedSteps.push({
            name: "Mint",
            state: "success",
            txHash: result.mintTxHash,
            errorMessage: result.alreadyMinted
              ? "USDC claimed. Check your wallet for the USDC"
              : undefined,
          });
        }

        setLocalBridgeResult((prev) =>
          prev ? { ...prev, state: "success", steps: updatedSteps } : prev
        );

        // Sync mintSimulation state to stop polling
        if (result.alreadyMinted) {
          setMintSimulation((prev) => ({
            ...prev,
            alreadyMinted: true,
            canMint: false,
          }));
        }

        if (displayResult) {
          onBridgeResultUpdate?.({
            ...displayResult,
            state: "success",
            steps: updatedSteps,
          });
        }
      } else {
        toast({
          title: "Claim failed",
          description: result.error || "Unable to complete mint",
          variant: "destructive",
        });
      }
    }
  }, [
    destinationChainId,
    sourceChainId,
    burnTxHash,
    onDestinationChain,
    solanaWallet.connected,
    switchChain,
    executeMint,
    executeMintSolana,
    displayResult,
    onBridgeResultUpdate,
    toast,
  ]);

  // Legacy retry handler (fallback)
  const handleRetry = async (options?: { forceRetry?: boolean }) => {
    if (!destinationChainId || !displayResult) return;
    try {
      // For Solana destinations, don't try to switch chain (Solana wallet handles this)
      if (!onDestinationChain && !isSolanaChain(destinationChainId)) {
        await switchChain({ chainId: destinationChainId as number });
      }

      const claimStep =
        displayResult?.steps.find((step) => /mint|claim/i.test(step.name)) ||
        displayResult?.steps.find((step) => step.txHash);

      if (claimStep?.txHash && !options?.forceRetry) {
        const explorer =
          claimStep.explorerUrl ||
          (destinationChainId
            ? getExplorerTxUrlUniversal(destinationChainId, claimStep.txHash)
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

  const hasFetchAttestation = useMemo(
    () =>
      derivedSteps.some(
        (step) => step.id === "fetchAttestation" && step.state === "success"
      ),
    [derivedSteps]
  );

  const hasBurnCompleted = useMemo(
    () =>
      derivedSteps.some(
        (step) => step.id === "burn" && (step.state === "success" || step.state === "noop")
      ),
    [derivedSteps]
  );

  const hasMintCompleted = useMemo(
    () =>
      derivedSteps.some((step) => step.id === "mint" && step.state === "success"),
    [derivedSteps]
  );

  // Show claim button based on simulation results OR attestation step success
  const showClaimButton = useMemo(() => {
    // Already minted - don't show
    if (mintSimulation.alreadyMinted) return false;
    if (hasMintCompleted) return false;

    // If simulation says we can mint, show button
    if (mintSimulation.canMint) return true;

    // If attestation is ready (from simulation check), show button
    if (mintSimulation.attestationReady) return true;

    // For Solana destinations: show claim button if burn is complete
    // useDirectMintSolana will fetch attestation and handle errors gracefully
    if (destinationChainId && isSolanaChain(destinationChainId) && hasBurnCompleted) {
      return true;
    }

    // Fallback: show if attestation step is success (original behavior)
    return hasFetchAttestation;
  }, [
    mintSimulation.alreadyMinted,
    mintSimulation.canMint,
    mintSimulation.attestationReady,
    hasMintCompleted,
    hasBurnCompleted,
    hasFetchAttestation,
    destinationChainId,
  ]);

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
              <ChainIcon chainId={displayFrom.value} size={24} />
              <div>
                <div className="font-medium">{displayFrom.label}</div>
                <div className="text-xs text-slate-400">{amount} USDC</div>
              </div>
            </div>
            <ArrowRight className="text-slate-500" />
            <div className="flex items-center gap-2">
              <ChainIcon chainId={displayTo.value} size={24} />
              <div>
                <div className="font-medium">{displayTo.label}</div>
                <div className="text-xs text-slate-400">
                  {displayResult.state === "success" ? "Minted" : "Pending"}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-3 text-sm">
            {derivedSteps.map((step, idx) => {
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

          {showClaimButton && (
            <div className="flex flex-col gap-2">
              <Button
                className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                disabled={isSwitchingChain || isClaiming || isMinting || isMintingSolana}
                onClick={handleClaim}
              >
                {isClaiming || isMinting || isMintingSolana ? (
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
              {mintSimulation.checking && (
                <p className="text-xs text-slate-500 text-center">
                  Checking mint status...
                </p>
              )}
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
