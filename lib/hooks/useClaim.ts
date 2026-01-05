import { useCallback, useRef, useState } from "react";
import type { BridgeResult } from "@circle-fin/bridge-kit";
import { useWalletClient } from "wagmi";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  createViemAdapter,
  getBridgeKit,
  getProviderFromWalletClient,
} from "@/lib/bridgeKit";
import { createSolanaAdapter } from "@/lib/solanaAdapter";
import { useTransactionStore } from "@/lib/store/transactionStore";
import { getErrorMessage } from "@/lib/errors";
import { useToast } from "@/components/ui/use-toast";
import { asTxHash, getChainType, type ChainId, type SolanaChainId, type UniversalTxHash } from "@/lib/types";

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
  let burnHash: UniversalTxHash | undefined;
  let mintHash: UniversalTxHash | undefined;
  let completedAt: Date | undefined;

  for (const step of result.steps) {
    const validatedHash = asTxHash(step.txHash);
    if (!burnHash && validatedHash) {
      burnHash = validatedHash as UniversalTxHash;
    }
    if (validatedHash && /mint|claim|receive/i.test(step.name)) {
      mintHash = validatedHash as UniversalTxHash;
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
  const solanaWallet = useWallet();
  const { updateTransaction } = useTransactionStore();
  const { toast } = useToast();
  const [isClaiming, setIsClaiming] = useState(false);
  const currentStepsRef = useRef<BridgeResult["steps"]>([]);

  const retryClaim = useCallback(
    async (result: BridgeResult, options?: RetryClaimOptions) => {
      // Extract chain IDs from result to determine ecosystem types
      const sourceChainDef = result.source?.chain as { chainId?: number; chain?: string } | undefined;
      const destChainDef = result.destination?.chain as { chainId?: number; chain?: string } | undefined;

      const sourceChainId: ChainId | undefined = sourceChainDef?.chainId ?? (sourceChainDef?.chain as ChainId);
      const destChainId: ChainId | undefined = destChainDef?.chainId ?? (destChainDef?.chain as ChainId);

      const sourceType = sourceChainId ? getChainType(sourceChainId) : "evm";
      const destType = destChainId ? getChainType(destChainId) : "evm";

      // Create SOURCE adapter based on chain type
      let sourceAdapter;
      if (sourceType === "solana") {
        if (!solanaWallet.connected || !solanaWallet.wallet?.adapter) {
          throw new Error("Connect your Solana wallet to claim.");
        }
        sourceAdapter = await createSolanaAdapter(solanaWallet.wallet.adapter);
      } else {
        if (!provider || !walletClient) {
          throw new Error("Connect your EVM wallet to claim.");
        }
        sourceAdapter = await createViemAdapter(provider);
      }

      // Create DESTINATION adapter based on chain type
      let destAdapter;
      if (destType === "solana") {
        if (!solanaWallet.connected || !solanaWallet.wallet?.adapter) {
          throw new Error("Connect your Solana wallet to claim on Solana.");
        }
        destAdapter = await createSolanaAdapter(solanaWallet.wallet.adapter);
      } else {
        if (!provider || !walletClient) {
          throw new Error("Connect your EVM wallet to claim.");
        }
        destAdapter = await createViemAdapter(provider);
      }

      const initialHashes = extractHashes(result);
      const baseHash =
        initialHashes.burnHash ||
        (asTxHash(result.steps.find((step) => step.txHash)?.txHash) as UniversalTxHash);

      if (!baseHash) {
        throw new Error("No source transaction hash found for this transfer.");
      }

      const kit = getBridgeKit();
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
        const retryResult = await kit.retry(result, { from: sourceAdapter, to: destAdapter });
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
    [provider, walletClient, solanaWallet.connected, solanaWallet.wallet, updateTransaction, toast]
  );

  return {
    retryClaim,
    isClaiming,
    isSolanaConnected: solanaWallet.connected,
  };
};
