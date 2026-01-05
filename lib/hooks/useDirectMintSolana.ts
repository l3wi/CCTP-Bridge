/**
 * Hook for executing CCTP mint transactions directly on Solana.
 * Uses the Solana adapter's `prepareAction` to call `cctp.v2.receiveMessage`.
 * Updates the existing transaction in the store instead of creating a new one.
 */

import { useCallback, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useTransactionStore } from "@/lib/store/transactionStore";
import { useToast } from "@/components/ui/use-toast";
import { fetchAttestation } from "@/lib/iris";
import { createSolanaAdapter } from "@/lib/solanaAdapter";
import { checkSolanaMintStatus } from "@/lib/simulation";
import {
  getBridgeChainByIdUniversal,
  getExplorerTxUrlUniversal,
  BRIDGEKIT_ENV,
} from "@/lib/bridgeKit";
import type { BridgeResult, ChainDefinition } from "@circle-fin/bridge-kit";
import type { ChainId, SolanaChainId } from "@/lib/types";
import { isSolanaChain } from "@/lib/types";

interface DirectMintSolanaResult {
  success: boolean;
  mintTxHash?: string;
  error?: string;
  alreadyMinted?: boolean;
}

export function useDirectMintSolana() {
  const solanaWallet = useWallet();
  const { updateTransaction } = useTransactionStore();
  const { toast } = useToast();
  const [isMinting, setIsMinting] = useState(false);

  /**
   * Execute a direct mint on Solana by fetching attestation from Iris
   * and calling the cctp.v2.receiveMessage action.
   */
  const executeMintSolana = useCallback(
    async (
      burnTxHash: string,
      sourceChainId: ChainId,
      destinationChainId: SolanaChainId,
      existingSteps?: BridgeResult["steps"]
    ): Promise<DirectMintSolanaResult> => {
      // Validate Solana wallet connection
      if (!solanaWallet.connected || !solanaWallet.wallet?.adapter) {
        return {
          success: false,
          error: "Solana wallet not connected. Please connect your wallet.",
        };
      }

      // Validate destination is Solana
      if (!isSolanaChain(destinationChainId)) {
        return {
          success: false,
          error: `Destination ${destinationChainId} is not a Solana chain. Use useDirectMint for EVM chains.`,
        };
      }

      // Validate source is EVM (numeric chainId)
      if (typeof sourceChainId !== "number") {
        return {
          success: false,
          error: "Source chain must be an EVM chain for this operation.",
        };
      }

      setIsMinting(true);

      // Fetch attestation first (needed for both execution and error recovery)
      toast({
        title: "Fetching attestation",
        description: "Retrieving Circle attestation for your transfer...",
      });

      const attestationData = await fetchAttestation(
        sourceChainId,
        burnTxHash
      );

      if (!attestationData) {
        setIsMinting(false);
        return {
          success: false,
          error:
            "Attestation not found. Please wait for Circle to process the burn.",
        };
      }

      if (attestationData.status !== "complete") {
        setIsMinting(false);
        return {
          success: false,
          error:
            "Attestation not ready yet. Please wait a few more minutes.",
        };
      }

      try {
        // 1. Get chain definitions
        const sourceChain = getBridgeChainByIdUniversal(
          sourceChainId,
          BRIDGEKIT_ENV
        );
        const destChain = getBridgeChainByIdUniversal(
          destinationChainId,
          BRIDGEKIT_ENV
        );

        if (!sourceChain || !destChain) {
          return {
            success: false,
            error: `Could not resolve chain definitions for ${sourceChainId} or ${destinationChainId}`,
          };
        }

        // 3. Create Solana adapter
        const adapter = await createSolanaAdapter(solanaWallet.wallet.adapter);

        // 4. Prepare the receiveMessage action
        toast({
          title: "Preparing mint transaction",
          description: "Please approve the transaction in your wallet...",
        });

        // Get the wallet's public key for the destination address
        const destinationAddress = solanaWallet.publicKey?.toBase58();

        // Cast adapter to access prepareAction method
        const adapterWithActions = adapter as unknown as {
          prepareAction: (
            action: string,
            params: {
              eventNonce: string;
              attestation: string;
              message: string;
              fromChain: ChainDefinition;
              toChain: ChainDefinition;
              destinationAddress?: string;
              mintRecipient?: string;
            },
            ctx: { chain: string }
          ) => Promise<{
            estimate: () => Promise<{ fee: bigint }>;
            execute: () => Promise<string>;
          }>;
        };

        const preparedRequest = await adapterWithActions.prepareAction(
          "cctp.v2.receiveMessage",
          {
            eventNonce: attestationData.nonce,
            attestation: attestationData.attestation,
            message: attestationData.message,
            fromChain: sourceChain as ChainDefinition,
            toChain: destChain as ChainDefinition,
            destinationAddress,
            mintRecipient: attestationData.mintRecipient,
          },
          { chain: destinationChainId }
        );

        // 5. Execute the transaction
        toast({
          title: "Minting USDC",
          description: "Executing mint transaction on Solana...",
        });

        const txSignature = await preparedRequest.execute();

        // 6. Update the transaction in store
        const updatedSteps = updateStepsWithMint(existingSteps, txSignature, false);
        const explorerUrl = getExplorerTxUrlUniversal(
          destinationChainId,
          txSignature,
          BRIDGEKIT_ENV
        );

        updateTransaction(burnTxHash as `0x${string}`, {
          claimHash: txSignature,
          status: "claimed",
          bridgeState: "success",
          completedAt: new Date(),
          steps: updatedSteps,
        });

        toast({
          title: "USDC Claimed!",
          description: explorerUrl
            ? "Your USDC has been minted successfully on Solana."
            : `Mint tx: ${txSignature.slice(0, 20)}...`,
        });

        return { success: true, mintTxHash: txSignature };
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        // Check for user rejection
        if (
          /user rejected/i.test(errorMessage) ||
          /user denied/i.test(errorMessage) ||
          /rejected the request/i.test(errorMessage)
        ) {
          return { success: false, error: "Transaction cancelled by user" };
        }

        // Check for nonce already used (already minted)
        if (
          /nonce already used/i.test(errorMessage) ||
          /already been processed/i.test(errorMessage) ||
          /already in use/i.test(errorMessage)
        ) {
          const updatedSteps = updateStepsWithMint(existingSteps, undefined, true);
          updateTransaction(burnTxHash as `0x${string}`, {
            status: "claimed",
            bridgeState: "success",
            completedAt: new Date(),
            steps: updatedSteps,
          });

          toast({
            title: "Already Claimed",
            description:
              "This transfer was already minted. Check your wallet for the USDC.",
          });

          return { success: true, alreadyMinted: true };
        }

        // Handle block height exceeded / transaction expiration
        // This happens when transaction was sent but confirmation polling timed out
        // Use simulation to verify if the mint actually succeeded
        if (
          /block height exceeded/i.test(errorMessage) ||
          /has expired/i.test(errorMessage) ||
          /transaction expired/i.test(errorMessage)
        ) {
          toast({
            title: "Verifying transaction",
            description: "Confirmation timed out. Checking if mint succeeded...",
          });

          // Use simulation to check if nonce is already used
          const statusCheck = await checkSolanaMintStatus(
            sourceChainId as number,
            destinationChainId,
            {
              nonce: attestationData.nonce,
              attestation: attestationData.attestation,
              message: attestationData.message,
              mintRecipient: attestationData.mintRecipient,
            },
            solanaWallet.wallet!.adapter
          );

          if (statusCheck.alreadyMinted) {
            // Mint succeeded despite timeout error!
            const updatedSteps = updateStepsWithMint(existingSteps, undefined, true);
            updateTransaction(burnTxHash as `0x${string}`, {
              status: "claimed",
              bridgeState: "success",
              completedAt: new Date(),
              steps: updatedSteps,
            });

            toast({
              title: "USDC Claimed!",
              description: "Transaction confirmed. Check your wallet for the USDC.",
            });

            return { success: true, alreadyMinted: true };
          }

          // Mint didn't complete - suggest retry
          return {
            success: false,
            error: statusCheck.canMint
              ? "Transaction may not have completed. Please try claiming again."
              : "Could not verify transaction. Please check your Solana wallet.",
          };
        }

        console.error("Solana direct mint failed:", error);
        return {
          success: false,
          error: errorMessage.slice(0, 200),
        };
      } finally {
        setIsMinting(false);
      }
    },
    [solanaWallet.connected, solanaWallet.wallet, solanaWallet.publicKey, updateTransaction, toast]
  );

  return {
    executeMintSolana,
    isMinting,
    isSolanaConnected: solanaWallet.connected,
  };
}

/**
 * Update steps array with mint completion
 */
function updateStepsWithMint(
  existingSteps: BridgeResult["steps"] | undefined,
  mintTxHash: string | undefined,
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
