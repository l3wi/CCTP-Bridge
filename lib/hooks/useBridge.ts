import { useCallback, useMemo, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { formatUnits } from "viem";
import { TransferSpeed, type BridgeResult } from "@circle-fin/bridge-kit";
import { track } from "@vercel/analytics/react";
import { useToast } from "@/components/ui/use-toast";
import {
  getBridgeKit,
  createViemAdapter,
  resolveBridgeChain,
  getProviderFromWalletClient,
} from "@/lib/bridgeKit";
import { BridgeParams, LocalTransaction } from "@/lib/types";
import { getErrorMessage } from "@/lib/errors";
import { useTransactionStore } from "@/lib/store/transactionStore";

const findTxHashes = (result: BridgeResult) => {
  let burnHash: `0x${string}` | undefined;
  let mintHash: `0x${string}` | undefined;
  let completedAt: Date | undefined;

  for (const step of result.steps) {
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

export const useBridge = () => {
  const { chain } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { toast } = useToast();
  const { addTransaction, updateTransaction } = useTransactionStore();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const provider = getProviderFromWalletClient(walletClient);
  const address = walletClient?.account?.address;

  const bridge = useCallback(
    async (
      params: BridgeParams,
      opts?: { onPendingHash?: (hash: `0x${string}`) => void }
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

      try {
        const kit = getBridgeKit();
        const adapter = await createViemAdapter(provider);
        const transferSpeed: TransferSpeed =
          transferType === "fast" ? TransferSpeed.FAST : TransferSpeed.SLOW;

        const result = await kit.bridge({
          from: {
            adapter,
            chain: sourceChainDef,
          },
          to: {
            adapter,
            chain: destinationChainDef,
          },
          amount: formattedAmount,
          token: "USDC",
          config: {
            transferSpeed,
          },
        });

        const { burnHash, mintHash, completedAt } = findTxHashes(result);

        if (!burnHash) {
          console.error("Bridge Kit returned no burn hash; result:", result);
          throw new Error("Transaction was cancelled by user");
        }

        opts?.onPendingHash?.(burnHash);

        addTransaction({
          hash: burnHash,
          claimHash: mintHash,
          status: result.state === "success" ? "claimed" : "pending",
          version: "v2",
          transferType,
          provider: result.provider,
          bridgeState: result.state,
          steps: result.steps,
          bridgeResult: result,
          completedAt,
          amount: formattedAmount,
          originChain: params.sourceChainId,
          targetChain: params.targetChainId,
          targetAddress: address as `0x${string}` | undefined,
        });

        track("bridge", {
          amount: formatUnits(params.amount, 6),
          from: params.sourceChainId,
          to: params.targetChainId,
          transferType: params.transferType ?? "standard",
          state: result.state,
        });

        toast({
          title:
            result.state === "success"
              ? "Bridge completed"
              : "Bridge submitted",
          description:
            result.state === "success"
              ? "USDC mint executed on destination chain."
              : "Processing bridge steps with Circle Bridge Kit.",
        });

        return result;
      } catch (err) {
        console.error("Bridge transaction error", err);
        const errorMessage = getErrorMessage(err);
        setError(errorMessage);
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
    [provider, walletClient, addTransaction, toast, address]
  );

  return {
    bridge,
    burn: bridge,
    isLoading,
    error,
  };
};
