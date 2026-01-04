import { useCallback, useRef, useState } from "react";
import type { BridgeResult } from "@circle-fin/bridge-kit";
import { useWalletClient } from "wagmi";
import {
  createViemAdapter,
  getBridgeKit,
  getProviderFromWalletClient,
} from "@/lib/bridgeKit";
import { useTransactionStore } from "@/lib/store/transactionStore";
import { getErrorMessage } from "@/lib/errors";
import { useToast } from "@/components/ui/use-toast";
import { asTxHash } from "@/lib/types";

type BridgeStep = BridgeResult["steps"][number];

const mergeSteps = (
  existing: BridgeResult["steps"] = [],
  incoming?: BridgeStep
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

const extractHashes = (result: BridgeResult) => {
  let burnHash: `0x${string}` | undefined;
  let mintHash: `0x${string}` | undefined;
  let completedAt: Date | undefined;

  for (const step of result.steps) {
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

interface RetryClaimOptions {
  onStep?: (steps: BridgeResult["steps"]) => void;
}

export const useClaim = () => {
  const { data: walletClient } = useWalletClient();
  const provider = getProviderFromWalletClient(walletClient);
  const { updateTransaction } = useTransactionStore();
  const { toast } = useToast();
  const [isClaiming, setIsClaiming] = useState(false);
  const currentStepsRef = useRef<BridgeResult["steps"]>([]);

  const retryClaim = useCallback(
    async (result: BridgeResult, options?: RetryClaimOptions) => {
      if (!provider || !walletClient) {
        throw new Error("Connect your wallet to claim.");
      }

      const initialHashes = extractHashes(result);
      const baseHash =
        initialHashes.burnHash ||
        asTxHash(result.steps.find((step) => step.txHash)?.txHash);

      if (!baseHash) {
        throw new Error("No source transaction hash found for this transfer.");
      }

      const kit = getBridgeKit();
      const adapter = await createViemAdapter(provider);
      currentStepsRef.current = result.steps || [];
      setIsClaiming(true);

      const handleEvent = (payload: unknown) => {
        const step = (
          payload && typeof payload === "object" && "values" in payload
            ? (payload as { values?: BridgeStep }).values
            : undefined
        ) as BridgeStep | undefined;

        if (!step?.name) return;

        const mergedSteps = mergeSteps(currentStepsRef.current, step);
        currentStepsRef.current = mergedSteps;

        updateTransaction(baseHash, {
          steps: mergedSteps,
          bridgeResult: { ...result, steps: mergedSteps },
          bridgeState: result.state === "error" ? "pending" : result.state,
        });

        options?.onStep?.(mergedSteps);
      };

      kit.on("*", handleEvent);

      try {
        const retryResult = await kit.retry(result, { from: adapter, to: adapter });
        const { burnHash, mintHash, completedAt } = extractHashes(retryResult);

        currentStepsRef.current = retryResult.steps || [];

        updateTransaction(burnHash || baseHash, {
          steps: retryResult.steps,
          claimHash: mintHash,
          bridgeState: retryResult.state,
          status: retryResult.state === "success" ? "claimed" : "pending",
          completedAt:
            retryResult.state === "success"
              ? completedAt ?? new Date()
              : undefined,
          bridgeResult: retryResult,
        });

        toast({
          title:
            retryResult.state === "success"
              ? "Claim completed"
              : "Claim submitted",
          description:
            retryResult.state === "success"
              ? "Mint executed on the destination chain."
              : "Mint transaction submitted. Confirm in your wallet.",
        });

        return retryResult;
      } catch (error) {
        const message = getErrorMessage(error);
        const nonceUsed = /nonce already used/i.test(message);

        if (nonceUsed) {
          const claimedMessage = "USDC claimed. Check your wallet for the USDC";
          const updatedSteps = (result.steps || []).map((step) => {
            const isMint = /mint|claim/i.test(step.name);
            return isMint
              ? {
                  ...step,
                  state: "success" as const,
                  errorMessage: claimedMessage,
                }
              : step;
          });

          const syntheticResult: BridgeResult = {
            ...result,
            state: "success",
            steps: updatedSteps,
          };

          const syntheticHashes = extractHashes(syntheticResult);
          updateTransaction(syntheticHashes.burnHash || baseHash, {
            steps: updatedSteps,
            claimHash: syntheticHashes.mintHash,
            bridgeState: "success",
            status: "claimed",
            completedAt: syntheticHashes.completedAt ?? new Date(),
            bridgeResult: syntheticResult,
          });

          toast({
            title: "Already claimed",
            description: claimedMessage,
          });

          return syntheticResult;
        }

        toast({
          title: "Claim failed",
          description: message,
          variant: "destructive",
        });
        throw error;
      } finally {
        kit.off("*", handleEvent);
        setIsClaiming(false);
      }
    },
    [provider, walletClient, updateTransaction, toast]
  );

  return {
    retryClaim,
    isClaiming,
  };
};
