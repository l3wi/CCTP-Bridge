import { useCallback, useRef, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { useWallet } from "@solana/wallet-adapter-react";
import { formatUnits } from "viem";
import { TransferSpeed, type BridgeResult, type ChainDefinition } from "@circle-fin/bridge-kit";
import { useToast } from "@/components/ui/use-toast";
import {
  getBridgeKit,
  createViemAdapter,
  getProviderFromWalletClient,
  resolveBridgeChainUniversal,
} from "@/lib/bridgeKit";
import { createSolanaAdapter } from "@/lib/solanaAdapter";
import {
  BridgeParams,
  LocalTransaction,
  UniversalTxHash,
  getChainType,
  isSolanaChain,
} from "@/lib/types";
import { getErrorMessage } from "@/lib/errors";
import { useTransactionStore } from "@/lib/store/transactionStore";

// Validate and coerce tx hash to standard format
const asTxHash = (value: unknown): `0x${string}` | string | undefined => {
  if (typeof value !== "string" || !value) return undefined;
  // EVM hash (0x prefix + 64 hex chars)
  if (/^0x[a-fA-F0-9]{64}$/.test(value)) {
    return value as `0x${string}`;
  }
  // Solana signature (Base58, typically 88 chars)
  if (/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(value)) {
    return value;
  }
  return undefined;
};

const findTxHashes = (steps: BridgeResult["steps"]) => {
  let burnHash: UniversalTxHash | undefined;
  let mintHash: UniversalTxHash | undefined;
  let completedAt: Date | undefined;

  for (const step of steps) {
    const validatedHash = asTxHash(step.txHash);
    if (!burnHash && validatedHash) {
      burnHash = validatedHash as UniversalTxHash;
    }
    if (validatedHash && /mint|receive/i.test(step.name)) {
      mintHash = validatedHash as UniversalTxHash;
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

export const useCrossEcosystemBridge = () => {
  // EVM wallet state
  const { chain } = useAccount();
  const { data: walletClient } = useWalletClient();
  const evmProvider = getProviderFromWalletClient(walletClient);
  const evmAddress = walletClient?.account?.address;

  // Solana wallet state
  const solanaWallet = useWallet();
  const solanaAddress = solanaWallet.publicKey?.toBase58();

  const { toast } = useToast();
  const { addTransaction, updateTransaction } = useTransactionStore();

  const currentStepsRef = useRef<BridgeResult["steps"]>([]);
  const currentHashRef = useRef<UniversalTxHash | null>(null);
  const pendingHashRef = useRef<UniversalTxHash | null>(null);
  const approveToastShownRef = useRef(false);
  const providerNameRef = useRef<string | null>(null);
  const addedHashesRef = useRef<Set<string>>(new Set());

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bridge = useCallback(
    async (
      params: BridgeParams,
      opts?: {
        onPendingHash?: (hash: UniversalTxHash) => void;
        onStateChange?: (result: BridgeResult) => void;
      }
    ): Promise<BridgeResult> => {
      const sourceChainType = getChainType(params.sourceChainId);
      const targetChainType = getChainType(params.targetChainId);

      // Validate wallet connection based on source chain type
      if (sourceChainType === "solana") {
        if (!solanaWallet.connected || !solanaWallet.wallet?.adapter) {
          throw new Error("Solana wallet not connected");
        }
      } else {
        if (!evmProvider || !walletClient) {
          throw new Error("EVM wallet not connected");
        }
      }

      const sourceChainDef = resolveBridgeChainUniversal(params.sourceChainId);
      const destinationChainDef = resolveBridgeChainUniversal(params.targetChainId);

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
      addedHashesRef.current.clear();

      // Determine sender address based on source chain type
      const senderAddress = sourceChainType === "solana" ? solanaAddress : evmAddress;

      // Use custom target address if provided, otherwise fall back to sender
      const recipientAddress = params.targetAddress ?? senderAddress;

      const buildResult = (
        steps: BridgeResult["steps"],
        stateOverride?: BridgeResult["state"]
      ): BridgeResult => ({
        amount: formattedAmount,
        token: "USDC",
        state: stateOverride ?? deriveBridgeState(steps),
        provider: providerNameRef.current ?? "CCTPV2BridgingProvider",
        source: {
          address: senderAddress ?? "",
          chain: sourceChainDef as unknown as ChainDefinition,
        },
        destination: {
          address: recipientAddress ?? "",
          chain: destinationChainDef as unknown as ChainDefinition,
        },
        steps,
      });

      const handleEvent = (payload: unknown) => {
        const raw = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
        const method = typeof raw?.method === "string" ? raw.method : undefined;
        const values = (raw?.values ?? raw) as Record<string, unknown> | null;

        const name = normalizeStepName(
          (values?.name as string | undefined) || undefined,
          method || (typeof raw?.action === "string" ? raw.action : undefined)
        );
        if (!name) return;

        const state = normalizeState(values?.state ?? raw?.state);
        const txHash = asTxHash(values?.txHash) ?? asTxHash(raw?.txHash);
        const explorerUrl = values?.explorerUrl as string | undefined;
        const errorMessage = values?.errorMessage as string | undefined;
        const errorVal = values?.error;

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
          error: errorVal,
          data: values?.data,
        };

        const mergedSteps = mergeSteps(currentStepsRef.current, normalizedStep);
        currentStepsRef.current = mergedSteps;

        const bridgeState = deriveBridgeState(mergedSteps, state === "error" ? "error" : undefined);
        const { burnHash, mintHash, completedAt } = findTxHashes(mergedSteps);

        if (burnHash && !pendingHashRef.current) {
          pendingHashRef.current = burnHash;
          opts?.onPendingHash?.(burnHash);

          // Server-side analytics
          const roundedAmount = Math.round(Number(formattedAmount));
          const txType = transferType === "fast" ? 1 : 0;
          fetch("/api/meta", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              amount: roundedAmount,
              meta: `${roundedAmount},${params.sourceChainId},${params.targetChainId},${txType}`,
            }),
          }).catch(() => {});
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

          if (!addedHashesRef.current.has(burnHash)) {
            addedHashesRef.current.add(burnHash);
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
              targetAddress: recipientAddress,
              // originChainType and targetChainType are auto-inferred by normalizeTransaction
            });
          } else {
            updateTransaction(burnHash, {
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
        // Create SOURCE adapter based on source chain type
        const sourceAdapter = sourceChainType === "solana"
          ? await createSolanaAdapter(solanaWallet.wallet!.adapter)
          : await createViemAdapter(evmProvider!);

        const transferSpeed: TransferSpeed =
          transferType === "fast" ? TransferSpeed.FAST : TransferSpeed.SLOW;

        // Create DESTINATION adapter for cross-ecosystem bridges
        const isCrossEcosystem = sourceChainType !== targetChainType;
        let destinationAdapter: Awaited<ReturnType<typeof createViemAdapter>> | undefined;

        if (isCrossEcosystem) {
          // Cross-ecosystem: create destination adapter if wallet connected
          if (targetChainType === "solana" && solanaWallet.connected && solanaWallet.wallet?.adapter) {
            destinationAdapter = await createSolanaAdapter(solanaWallet.wallet.adapter);
          } else if (targetChainType === "evm" && evmProvider) {
            destinationAdapter = await createViemAdapter(evmProvider);
          }
          // If no wallet connected for target chain, adapter will be undefined
        } else {
          // Same ecosystem: reuse source adapter
          destinationAdapter = sourceAdapter;
        }

        // Build destination config - use adapter if available, otherwise address-only
        // SDK rule: With adapter → auto-resolves address from wallet, do NOT pass address
        //           Without adapter → MUST pass address (manual recipient)
        const destinationConfig = destinationAdapter
          ? {
              adapter: destinationAdapter,
              chain: destinationChainDef as unknown as ChainDefinition,
            }
          : {
              chain: destinationChainDef as unknown as ChainDefinition,
              address: recipientAddress,
            };

        const result = await kit.bridge({
          from: {
            adapter: sourceAdapter,
            chain: sourceChainDef as unknown as ChainDefinition,
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

          if (!addedHashesRef.current.has(burnHash)) {
            addedHashesRef.current.add(burnHash);
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
              targetAddress: recipientAddress,
              // originChainType and targetChainType are auto-inferred by normalizeTransaction
            });
          } else {
            updateTransaction(burnHash, {
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
    [
      evmProvider,
      walletClient,
      solanaWallet.connected,
      solanaWallet.wallet,
      evmAddress,
      solanaAddress,
      addTransaction,
      updateTransaction,
      toast,
    ]
  );

  return {
    bridge,
    isLoading,
    error,
    // Expose wallet connection status for UI checks
    isEvmConnected: !!walletClient,
    isSolanaConnected: solanaWallet.connected,
  };
};
