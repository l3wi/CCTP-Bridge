/**
 * Hook for executing CCTP mint transactions directly.
 * Bypasses Bridge Kit SDK to avoid creating duplicate transactions.
 * Updates the existing transaction in the store instead of creating a new one.
 * Supports both EVM and Solana source chains claiming to EVM destinations.
 */

import { useCallback, useState } from "react";
import { useWalletClient, usePublicClient } from "wagmi";
import { useTransactionStore } from "@/lib/store/transactionStore";
import { useToast } from "@/components/ui/use-toast";
import { fetchAttestationUniversal } from "@/lib/iris";
import { simulateMint } from "@/lib/simulation";
import {
  getMessageTransmitterAddress,
  MESSAGE_TRANSMITTER_ABI,
} from "@/lib/contracts";
import { getExplorerTxUrl } from "@/lib/bridgeKit";
import type { BridgeResult } from "@circle-fin/bridge-kit";
import type { ChainId, UniversalTxHash } from "@/lib/types";

interface DirectMintResult {
  success: boolean;
  mintTxHash?: `0x${string}`;
  error?: string;
  alreadyMinted?: boolean;
}

export function useDirectMint() {
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const { updateTransaction } = useTransactionStore();
  const { toast } = useToast();
  const [isMinting, setIsMinting] = useState(false);

  /**
   * Execute a direct mint by fetching attestation from Iris and calling receiveMessage.
   * Updates the existing transaction in the store.
   * Supports both EVM and Solana source chains.
   */
  const executeMint = useCallback(
    async (
      burnTxHash: UniversalTxHash,
      sourceChainId: ChainId,
      destinationChainId: number,
      existingSteps?: BridgeResult["steps"]
    ): Promise<DirectMintResult> => {
      if (!walletClient) {
        return { success: false, error: "Wallet not connected" };
      }

      if (!publicClient) {
        return { success: false, error: "Public client not available" };
      }

      const messageTransmitter = getMessageTransmitterAddress(destinationChainId);
      if (!messageTransmitter) {
        return {
          success: false,
          error: `No MessageTransmitter for chain ${destinationChainId}`,
        };
      }

      setIsMinting(true);

      try {
        // 1. Fetch attestation from Iris (supports both EVM and Solana sources)
        const attestationData = await fetchAttestationUniversal(sourceChainId, burnTxHash);

        if (!attestationData) {
          return {
            success: false,
            error: "Attestation not found. Please wait for Circle to process the burn.",
          };
        }

        if (attestationData.status !== "complete") {
          return {
            success: false,
            error: "Attestation not ready yet. Please wait a few more minutes.",
          };
        }

        // 2. Simulate to verify it will succeed
        const simResult = await simulateMint(
          destinationChainId,
          attestationData.message,
          attestationData.attestation
        );

        if (simResult.alreadyMinted) {
          // Update transaction as already completed
          const updatedSteps = updateStepsWithMint(existingSteps, undefined, true);
          updateTransaction(burnTxHash, {
            status: "claimed",
            bridgeState: "success",
            completedAt: new Date(),
            steps: updatedSteps,
          });

          toast({
            title: "Already Claimed",
            description: "This transfer was already minted. Check your wallet for the USDC.",
          });

          return { success: true, alreadyMinted: true };
        }

        if (!simResult.canMint) {
          return {
            success: false,
            error: simResult.error || "Simulation failed - mint may not be ready",
          };
        }

        // 3. Execute the mint transaction
        toast({
          title: "Claiming USDC",
          description: "Please confirm the transaction in your wallet.",
        });

        const hash = await walletClient.writeContract({
          address: messageTransmitter,
          abi: MESSAGE_TRANSMITTER_ABI,
          functionName: "receiveMessage",
          args: [attestationData.message, attestationData.attestation],
          chain: walletClient.chain,
        });

        toast({
          title: "Transaction Submitted",
          description: "Waiting for confirmation...",
        });

        // 4. Wait for confirmation
        const receipt = await publicClient.waitForTransactionReceipt({
          hash,
          confirmations: 1,
        });

        if (receipt.status === "reverted") {
          return {
            success: false,
            error: "Transaction reverted. The mint may have already been claimed.",
          };
        }

        // 5. Update the existing transaction in store
        const updatedSteps = updateStepsWithMint(existingSteps, hash, false);
        const explorerUrl = getExplorerTxUrl(destinationChainId, hash);

        updateTransaction(burnTxHash, {
          claimHash: hash,
          status: "claimed",
          bridgeState: "success",
          completedAt: new Date(),
          steps: updatedSteps,
        });

        toast({
          title: "USDC Claimed!",
          description: explorerUrl
            ? "Your USDC has been minted successfully."
            : `Mint tx: ${hash.slice(0, 10)}...`,
        });

        return { success: true, mintTxHash: hash };
      } catch (error: any) {
        const errorMessage = error?.message || String(error);

        // Check for user rejection
        if (
          /user rejected/i.test(errorMessage) ||
          /user denied/i.test(errorMessage)
        ) {
          return { success: false, error: "Transaction cancelled by user" };
        }

        // Check for nonce already used (race condition)
        if (/nonce already used/i.test(errorMessage)) {
          const updatedSteps = updateStepsWithMint(existingSteps, undefined, true);
          updateTransaction(burnTxHash, {
            status: "claimed",
            bridgeState: "success",
            completedAt: new Date(),
            steps: updatedSteps,
          });

          toast({
            title: "Already Claimed",
            description: "This transfer was already minted. Check your wallet.",
          });

          return { success: true, alreadyMinted: true };
        }

        console.error("Direct mint failed:", error);
        return {
          success: false,
          error: errorMessage.slice(0, 200),
        };
      } finally {
        setIsMinting(false);
      }
    },
    [walletClient, publicClient, updateTransaction, toast]
  );

  return {
    executeMint,
    isMinting,
  };
}

/**
 * Update steps array with mint completion
 */
function updateStepsWithMint(
  existingSteps: BridgeResult["steps"] | undefined,
  mintTxHash: `0x${string}` | undefined,
  alreadyMinted: boolean
): BridgeResult["steps"] {
  const steps = existingSteps ? [...existingSteps] : [];

  // Update attestation step to success if present
  const attestationIndex = steps.findIndex((s) =>
    /attestation|attest/i.test(s.name)
  );
  if (attestationIndex >= 0) {
    steps[attestationIndex] = {
      ...steps[attestationIndex],
      state: "success",
    };
  }

  // Find or create mint step
  const mintIndex = steps.findIndex((s) =>
    /mint|claim|receive/i.test(s.name)
  );

  const mintStep: BridgeResult["steps"][number] = {
    name: "Mint",
    state: "success",
    txHash: mintTxHash,
    errorMessage: alreadyMinted
      ? "USDC claimed. Check your wallet for the USDC"
      : undefined,
  };

  if (mintIndex >= 0) {
    steps[mintIndex] = { ...steps[mintIndex], ...mintStep };
  } else {
    steps.push(mintStep);
  }

  return steps;
}
