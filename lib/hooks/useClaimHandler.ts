"use client";

import { useCallback } from "react";
import type { BridgeResult } from "@circle-fin/bridge-kit";
import { useSwitchChain } from "wagmi";
import { useWallet } from "@solana/wallet-adapter-react";
import { useToast } from "@/components/ui/use-toast";
import { useMint } from "@/lib/cctp/hooks/useMint";
import { ChainId, isSolanaChain } from "@/lib/types";

interface UseClaimHandlerParams {
  destinationChainId: ChainId | undefined;
  sourceChainId: ChainId | undefined;
  burnTxHash: string | null;
  displayResult: BridgeResult | undefined;
  onDestinationChain: boolean;
  onSuccess: (updatedSteps: BridgeResult["steps"]) => void;
  onAlreadyMinted?: () => void;
  /** Called when the message has expired and needs re-attestation */
  onMessageExpired?: (nonce: string) => void;
}

interface UseClaimHandlerResult {
  handleClaim: () => Promise<void>;
  isClaiming: boolean;
}

/**
 * Handles claim execution for both EVM and Solana destinations.
 * Uses the unified useMint hook internally.
 *
 * When a message is expired, sets the expired state via onMessageExpired.
 * The parent (useMintPolling) handles auto re-attestation and polling.
 */
export function useClaimHandler({
  destinationChainId,
  sourceChainId,
  burnTxHash,
  displayResult,
  onDestinationChain,
  onSuccess,
  onAlreadyMinted,
  onMessageExpired,
}: UseClaimHandlerParams): UseClaimHandlerResult {
  const { switchChain } = useSwitchChain();
  const solanaWallet = useWallet();
  const { toast } = useToast();
  const { executeMint, isMinting } = useMint();

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
    const currentSteps = displayResult?.steps || [];

    // Helper to update steps with mint result
    const buildUpdatedSteps = (
      mintTxHash: string | undefined,
      alreadyMinted: boolean
    ): BridgeResult["steps"] => {
      const updatedSteps = currentSteps.map((step) => {
        if (/attestation|attest/i.test(step.name)) {
          return { ...step, state: "success" as const };
        }
        if (/mint|claim|receive/i.test(step.name)) {
          return {
            ...step,
            state: "success" as const,
            txHash: mintTxHash,
            errorMessage: alreadyMinted
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
          txHash: mintTxHash,
          errorMessage: alreadyMinted
            ? "USDC claimed. Check your wallet for the USDC"
            : undefined,
        });
      }

      return updatedSteps;
    };

    /**
     * Handle mint result consistently for both EVM and Solana.
     * If expired, signals the parent to auto re-attest.
     */
    const handleMintResult = (result: Awaited<ReturnType<typeof executeMint>>) => {
      if (result.success || result.alreadyMinted) {
        const updatedSteps = buildUpdatedSteps(result.mintTxHash, result.alreadyMinted ?? false);
        onSuccess(updatedSteps);

        if (result.alreadyMinted) {
          onAlreadyMinted?.();
        }
      } else if (result.messageExpired && result.nonce) {
        // Signal parent — useMintPolling will auto re-attest and poll
        onMessageExpired?.(result.nonce);
      } else {
        toast({
          title: "Claim failed",
          description: result.error || "Unable to complete mint",
          variant: "destructive",
        });
      }
    };

    if (isDestSolana) {
      // SOLANA DESTINATION
      if (!solanaWallet.connected) {
        toast({
          title: "Connect Solana wallet",
          description: "Please connect your Solana wallet to claim",
          variant: "destructive",
        });
        return;
      }

      const result = await executeMint({
        burnTxHash,
        sourceChainId,
        destinationChainId,
        existingSteps: currentSteps,
      });

      handleMintResult(result);
    } else {
      // EVM DESTINATION
      if (!onDestinationChain) {
        try {
          await switchChain({ chainId: destinationChainId as number });
          // Wait for chain switch to complete
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } catch {
          toast({
            title: "Chain switch required",
            description: "Please switch to the destination chain to claim",
            variant: "destructive",
          });
          return;
        }
      }

      const result = await executeMint({
        burnTxHash,
        sourceChainId,
        destinationChainId,
        existingSteps: currentSteps,
      });

      handleMintResult(result);
    }
  }, [
    destinationChainId,
    sourceChainId,
    burnTxHash,
    displayResult?.steps,
    onDestinationChain,
    solanaWallet.connected,
    switchChain,
    executeMint,
    onSuccess,
    onAlreadyMinted,
    onMessageExpired,
    toast,
  ]);

  return {
    handleClaim,
    isClaiming: isMinting,
  };
}
