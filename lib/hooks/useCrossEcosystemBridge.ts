/**
 * Cross-ecosystem bridge hook for CCTP transfers.
 * Orchestrates burns across EVM and Solana using the unified useBurn hook.
 */

import { useCallback, useRef, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { useWallet } from "@solana/wallet-adapter-react";
import { formatUnits } from "viem";
import { type BridgeResult, type ChainDefinition } from "@circle-fin/bridge-kit";
import { useToast } from "@/components/ui/use-toast";
import { getProviderFromWalletClient, resolveBridgeChainUniversal } from "@/lib/bridgeKit";
import { useBurn, type BurnProgressCallbacks } from "@/lib/cctp/hooks/useBurn";
import {
  createInitialSteps,
  createApprovalPendingSteps,
  updateStepsApprovalComplete,
  deriveBridgeState,
} from "@/lib/cctp/steps";
import {
  BridgeParams,
  UniversalTxHash,
  getChainType,
} from "@/lib/types";
import { getErrorMessage } from "@/lib/cctp/errors";
import { useTransactionStore } from "@/lib/store/transactionStore";

export const useCrossEcosystemBridge = () => {
  // EVM wallet state
  const { data: walletClient } = useWalletClient();
  const evmProvider = getProviderFromWalletClient(walletClient);
  const evmAddress = walletClient?.account?.address;

  // Solana wallet state
  const solanaWallet = useWallet();
  const solanaAddress = solanaWallet.publicKey?.toBase58();

  const { toast } = useToast();
  const { addTransaction, updateTransaction } = useTransactionStore();
  const { executeBurn } = useBurn();

  // Track current burn hash for error handling
  const currentHashRef = useRef<UniversalTxHash | null>(null);
  const currentStepsRef = useRef<BridgeResult["steps"]>([]);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bridge = useCallback(
    async (
      params: BridgeParams,
      opts?: {
        onPendingHash?: (hash: UniversalTxHash) => void;
        onStateChange?: (result: BridgeResult) => void;
        /** Called when EVM approval starts - triggers progress screen early */
        onApprovalStart?: () => void;
      }
    ): Promise<BridgeResult> => {
      const sourceChainType = getChainType(params.sourceChainId);

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
      currentHashRef.current = null;
      currentStepsRef.current = [];

      const transferType: "fast" | "standard" =
        params.transferType === "fast" ? "fast" : "standard";
      const formattedAmount = formatUnits(params.amount, 6);

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
        provider: "CCTPV2BridgingProvider",
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

      try {
        // Create burn progress callbacks for EVM sources
        const burnCallbacks: BurnProgressCallbacks | undefined =
          sourceChainType === "evm"
            ? {
                onApprovalStart: () => {
                  // Show progress screen immediately when approval starts
                  const pendingSteps = createApprovalPendingSteps();
                  currentStepsRef.current = pendingSteps;
                  const pendingResult = buildResult(pendingSteps, "pending");
                  opts?.onApprovalStart?.();
                  opts?.onStateChange?.(pendingResult);
                },
                onApprovalComplete: (approvalTxHash) => {
                  // Update steps with approval hash
                  const updatedSteps = updateStepsApprovalComplete(
                    currentStepsRef.current,
                    approvalTxHash
                  );
                  currentStepsRef.current = updatedSteps;
                  opts?.onStateChange?.(buildResult(updatedSteps, "pending"));
                },
              }
            : undefined;

        // Execute burn using unified hook
        const burnResult = await executeBurn(
          {
            sourceChainId: params.sourceChainId,
            destinationChainId: params.targetChainId,
            amount: params.amount,
            recipientAddress: recipientAddress!,
            transferSpeed: transferType,
          },
          burnCallbacks
        );

        if (!burnResult.success) {
          const errorMsg = burnResult.error || "Burn transaction failed";
          setError(errorMsg);
          toast({
            title:
              errorMsg === "Transaction cancelled by user" ||
              errorMsg === "Approval cancelled by user"
                ? "Transaction cancelled"
                : "Bridge failed",
            description: errorMsg,
            variant: "destructive",
          });
          throw new Error(errorMsg);
        }

        // Get burn hash and fire callback
        const burnHash = burnResult.burnTxHash! as UniversalTxHash;
        currentHashRef.current = burnHash;
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

        // Build initial steps using unified helper
        const initialSteps = createInitialSteps({
          sourceChainType,
          burnTxHash: burnHash,
          approvalTxHash: burnResult.approvalTxHash,
        });
        currentStepsRef.current = initialSteps;

        const initialResult = buildResult(initialSteps, "pending");
        opts?.onStateChange?.(initialResult);

        // Add to transaction store
        addTransaction({
          hash: burnHash,
          status: "pending",
          version: "v3",
          transferType,
          bridgeState: "pending",
          steps: initialSteps,
          bridgeResult: initialResult,
          amount: formattedAmount,
          originChain: params.sourceChainId,
          targetChain: params.targetChainId,
          targetAddress: recipientAddress,
        });

        toast({
          title: "Bridge submitted",
          description: "Burn transaction sent. Waiting for attestation...",
        });

        return initialResult;
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
      executeBurn,
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
