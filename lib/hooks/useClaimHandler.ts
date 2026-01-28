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

      if (result.success || result.alreadyMinted) {
        const updatedSteps = buildUpdatedSteps(result.mintTxHash, result.alreadyMinted ?? false);
        onSuccess(updatedSteps);

        if (result.alreadyMinted) {
          onAlreadyMinted?.();
        }
      } else if (result.error) {
        toast({
          title: "Claim failed",
          description: result.error,
          variant: "destructive",
        });
      }
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

      if (result.success || result.alreadyMinted) {
        const updatedSteps = buildUpdatedSteps(result.mintTxHash, result.alreadyMinted ?? false);
        onSuccess(updatedSteps);

        if (result.alreadyMinted) {
          onAlreadyMinted?.();
        }
      } else if (result.messageExpired && result.nonce) {
        // Message expired - trigger re-attestation flow
        onMessageExpired?.(result.nonce);
        toast({
          title: "Attestation expired",
          description: "Please request re-attestation to continue.",
          variant: "destructive",
        });
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
