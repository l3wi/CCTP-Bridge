import { useCallback, useRef, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { formatUnits } from "viem";
import { TransferSpeed, type BridgeResult } from "@circle-fin/bridge-kit";
import { track } from "@vercel/analytics/react";
import { useToast } from "@/components/ui/use-toast";
import {
  getBridgeKit,
  createViemAdapter,
  getProviderFromWalletClient,
  resolveBridgeChain,
} from "@/lib/bridgeKit";
import { BridgeParams, LocalTransaction } from "@/lib/types";
import { getErrorMessage } from "@/lib/errors";
import { useTransactionStore } from "@/lib/store/transactionStore";

const findTxHashes = (steps: BridgeResult["steps"]) => {
  let burnHash: `0x${string}` | undefined;
  let mintHash: `0x${string}` | undefined;
  let completedAt: Date | undefined;

  for (const step of steps) {
    if (!burnHash && step.txHash) {
      burnHash = step.txHash as `0x${string}`;
    }
    if (step.txHash && /mint|receive/i.test(step.name)) {
      mintHash = step.txHash as `0x${string}`;
    }
    if (step.state === "success") {
      completedAt = new Date();
    }
  }

  return { burnHash, mintHash, completedAt };
};

const mergeSteps = (
  existing: BridgeResult["steps"] = [],
  incoming?: BridgeResult["steps"][number]
) => {
  if (!incoming) return existing;

  const index = existing.findIndex(
    (step) => step.name.toLowerCase() === incoming.name.toLowerCase()
  );

  if (index === -1) {
    return [...existing, incoming];
  }

  const updated = [...existing];
  updated[index] = {
    ...updated[index],
    ...incoming,
  };

  return updated;
};

const normalizeStepName = (name?: string, method?: string) => {
  const fallback = method || name;
  if (!fallback) return undefined;

  const slug = fallback
    .replace(/^[^.]*\./, "")
    .replace(/[:]/g, " ")
    .replace(/-/g, " ")
    .trim();

  if (!slug) return undefined;
  const known = slug.toLowerCase();
  if (known.includes("approve")) return "Approve";
  if (known.includes("burn")) return "Burn";
  if (known.includes("attestation")) return "Fetch Attestation";
  if (known.includes("mint")) return "Mint";
  if (known.includes("receive")) return "Receive";

  return slug.replace(/\b\w/g, (c) => c.toUpperCase());
};

const normalizeState = (state?: unknown): BridgeResult["state"] | "pending" => {
  if (typeof state !== "string") return "pending";
  const normalized = state.toLowerCase();
  if (normalized === "success") return "success";
  if (normalized === "error") return "error";
  if (normalized === "pending" || normalized === "ready") return "pending";
  return "pending";
};

const isNonceAlreadyUsed = (step: BridgeResult["steps"][number]) => {
  const message = `${step.errorMessage ?? ""} ${step.error ?? ""}`.toLowerCase();
  return message.includes("nonce already used");
};

const deriveBridgeState = (steps: BridgeResult["steps"], fallback?: BridgeResult["state"]) => {
  if (!steps.length) return fallback ?? "pending";

  const hasNonceClaimed = steps.some(isNonceAlreadyUsed);
  const hasMintSuccess = steps.some(
    (step) =>
      (/mint|receive|claim/i.test(step.name) || step.name.toLowerCase().includes("mint")) &&
      (step.state === "success" || isNonceAlreadyUsed(step))
  );

  if (hasMintSuccess || hasNonceClaimed) {
    return "success" as const;
  }

  const hasError = steps.some((step) => step.state === "error");
  if (hasError) return "error";

  return fallback ?? "pending";
};

export const useBridge = () => {
  const { chain } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { toast } = useToast();
  const { addTransaction, updateTransaction } = useTransactionStore();

  const currentStepsRef = useRef<BridgeResult["steps"]>([]);
  const currentHashRef = useRef<`0x${string}` | null>(null);
  const pendingHashRef = useRef<`0x${string}` | null>(null);
  const approveToastShownRef = useRef(false);
  const providerNameRef = useRef<string | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const provider = getProviderFromWalletClient(walletClient);
  const address = walletClient?.account?.address;

  const bridge = useCallback(
    async (
      params: BridgeParams,
      opts?: {
        onPendingHash?: (hash: `0x${string}`) => void;
        onStateChange?: (result: BridgeResult) => void;
      }
    ): Promise<BridgeResult> => {
      if (!provider || !walletClient) {
        throw new Error("Wallet provider not found");
      }

      const sourceChainDef = resolveBridgeChain(params.sourceChainId);
      const destinationChainDef = resolveBridgeChain(params.targetChainId);

      setIsLoading(true);
      setError(null);

      const transferType: "fast" | "standard" =
        params.transferType === "fast" ? "fast" : "standard";
      const formattedAmount = formatUnits(params.amount, 6);

      currentStepsRef.current = [];
      currentHashRef.current = null;
      pendingHashRef.current = null;
      approveToastShownRef.current = false;
      providerNameRef.current = null;

      // Use custom target address if provided, otherwise fall back to sender
      const recipientAddress = params.targetAddress ?? address;

      const buildResult = (
        steps: BridgeResult["steps"],
        stateOverride?: BridgeResult["state"]
      ): BridgeResult => ({
        amount: formattedAmount,
        token: "USDC",
        state: stateOverride ?? deriveBridgeState(steps),
        provider: providerNameRef.current ?? "CCTPV2BridgingProvider",
        source: {
          address: address ?? "",
          chain: sourceChainDef,
        },
        destination: {
          address: recipientAddress ?? "",
          chain: destinationChainDef,
        },
        steps,
      });

      const handleEvent = (payload: unknown) => {
        const raw = payload && typeof payload === "object" ? (payload as Record<string, any>) : null;
        const method = typeof raw?.method === "string" ? raw.method : undefined;
        const values = (raw?.values ?? raw) as Record<string, any> | null;

        const name = normalizeStepName(
          (values?.name as string | undefined) || undefined,
          method || (typeof raw?.action === "string" ? raw.action : undefined)
        );
        if (!name) return;

        const state = normalizeState(values?.state ?? raw?.state);
        const txHash =
          ((values?.txHash as `0x${string}` | undefined) ||
            (typeof raw?.txHash === "string" ? (raw.txHash as `0x${string}`) : undefined)) ??
          undefined;
        const explorerUrl = values?.explorerUrl as string | undefined;
        const errorMessage = values?.errorMessage as string | undefined;
        const error = values?.error;

        if (!approveToastShownRef.current && name.toLowerCase().includes("approve")) {
          toast({
            title: "Approval submitted",
            description: "USDC approval transaction sent.",
          });
          approveToastShownRef.current = true;
        }

        const normalizedStep: BridgeResult["steps"][number] = {
          name,
          state,
          txHash,
          explorerUrl,
          errorMessage,
          error,
          data: values?.data,
        };

        const mergedSteps = mergeSteps(currentStepsRef.current, normalizedStep);
        currentStepsRef.current = mergedSteps;

        const bridgeState = deriveBridgeState(mergedSteps, state === "error" ? "error" : undefined);
        const { burnHash, mintHash, completedAt } = findTxHashes(mergedSteps);

        if (burnHash && !pendingHashRef.current) {
          pendingHashRef.current = burnHash;
          opts?.onPendingHash?.(burnHash);
        }

        const nextResult = buildResult(mergedSteps, bridgeState);
        opts?.onStateChange?.(nextResult);

        if (burnHash) {
          const status: LocalTransaction["status"] = bridgeState === "success"
            ? "claimed"
            : bridgeState === "error"
            ? "failed"
            : "pending";

          const completedTime =
            bridgeState === "success" ? completedAt ?? new Date() : undefined;

          if (!currentHashRef.current) {
            currentHashRef.current = burnHash;
            addTransaction({
              hash: burnHash,
              claimHash: mintHash,
              status,
              version: "v2",
              transferType,
              provider: nextResult.provider,
              bridgeState,
              steps: mergedSteps,
              bridgeResult: nextResult,
              completedAt: completedTime,
              amount: formattedAmount,
              originChain: params.sourceChainId,
              targetChain: params.targetChainId,
              targetAddress: recipientAddress as `0x${string}` | undefined,
            });
          } else {
            updateTransaction(currentHashRef.current, {
              steps: mergedSteps,
              bridgeState,
              status,
              claimHash: mintHash,
              completedAt: completedTime,
              bridgeResult: nextResult,
              provider: nextResult.provider,
            });
          }
        }
      };

      const kit = getBridgeKit();
      kit.on("*", handleEvent);

      try {
        const adapter = await createViemAdapter(provider);
        const transferSpeed: TransferSpeed =
          transferType === "fast" ? TransferSpeed.FAST : TransferSpeed.SLOW;

        // Build destination config - only include address if different from sender
        const hasCustomRecipient = params.targetAddress && params.targetAddress !== address;
        const destinationConfig = hasCustomRecipient
          ? {
              adapter,
              chain: destinationChainDef,
              address: params.targetAddress,
            }
          : {
              adapter,
              chain: destinationChainDef,
            };

        const result = await kit.bridge({
          from: {
            adapter,
            chain: sourceChainDef,
          },
          to: destinationConfig as Parameters<typeof kit.bridge>[0]["to"],
          amount: formattedAmount,
          token: "USDC",
          config: {
            transferSpeed,
          },
        });

        providerNameRef.current = result.provider ?? providerNameRef.current;

        const mergedSteps = result.steps.reduce<BridgeResult["steps"]>(
          (acc, step) => mergeSteps(acc, step),
          currentStepsRef.current
        );
        currentStepsRef.current = mergedSteps;

        const { burnHash, mintHash, completedAt } = findTxHashes(mergedSteps);
        const finalState = deriveBridgeState(mergedSteps, result.state);

        if (burnHash && !pendingHashRef.current) {
          pendingHashRef.current = burnHash;
          opts?.onPendingHash?.(burnHash);
        }

        const finalResult: BridgeResult = {
          ...result,
          provider: providerNameRef.current ?? result.provider,
          steps: mergedSteps,
          state: finalState,
        };

        opts?.onStateChange?.(finalResult);

        const status: LocalTransaction["status"] = finalState === "success"
          ? "claimed"
          : finalState === "error"
          ? "failed"
          : "pending";

        if (burnHash) {
          const completedTime =
            finalState === "success" ? completedAt ?? new Date() : undefined;

          if (!currentHashRef.current) {
            currentHashRef.current = burnHash;
            addTransaction({
              hash: burnHash,
              claimHash: mintHash,
              status,
              version: "v2",
              transferType,
              provider: finalResult.provider,
              bridgeState: finalState,
              steps: mergedSteps,
              bridgeResult: finalResult,
              completedAt: completedTime,
              amount: formattedAmount,
              originChain: params.sourceChainId,
              targetChain: params.targetChainId,
              targetAddress: recipientAddress as `0x${string}` | undefined,
            });
          } else {
            updateTransaction(currentHashRef.current, {
              steps: mergedSteps,
              bridgeState: finalState,
              status,
              claimHash: mintHash,
              completedAt: completedTime,
              bridgeResult: finalResult,
              provider: finalResult.provider,
            });
          }
        }

        track("bridge", {
          amount: formattedAmount,
          from: params.sourceChainId,
          to: params.targetChainId,
          transferType: params.transferType ?? "standard",
          state: finalResult.state,
        });

        toast({
          title:
            finalResult.state === "success"
              ? "Bridge completed"
              : "Bridge submitted",
          description:
            finalResult.state === "success"
              ? "USDC mint executed on destination chain."
              : "Processing bridge steps with Circle Bridge Kit.",
        });

        return finalResult;
      } catch (err) {
        console.error("Bridge transaction error", err);
        const errorMessage = getErrorMessage(err);
        setError(errorMessage);

        if (currentHashRef.current) {
          const steps = currentStepsRef.current;
          const failedResult = buildResult(steps, "error");
          updateTransaction(currentHashRef.current, {
            steps,
            bridgeState: "error",
            status: "failed",
            bridgeResult: failedResult,
            provider: failedResult.provider,
          });
          opts?.onStateChange?.(failedResult);
        }

        toast({
          title:
            errorMessage === "Transaction was cancelled by user"
              ? "Transaction cancelled"
              : "Bridge failed",
          description: errorMessage,
          variant: "destructive",
        });
        throw err;
      } finally {
        kit.off("*", handleEvent);
        setIsLoading(false);
      }
    },
    [provider, walletClient, addTransaction, updateTransaction, toast, address]
  );

  return {
    bridge,
    isLoading,
    error,
  };
};
