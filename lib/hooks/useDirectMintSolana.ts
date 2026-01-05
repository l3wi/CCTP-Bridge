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

        // 5. Execute the transaction with timeout + polling fallback
        // The SDK's execute() uses WebSocket for confirmation which can fail.
        // We use a short timeout and fall back to HTTP polling via simulation.
        toast({
          title: "Minting USDC",
          description: "Please approve the transaction in your wallet...",
        });

        const EXECUTE_TIMEOUT_MS = 15000; // 15s timeout for execute (signing + initial confirmation attempt)
        const POLL_INTERVAL_MS = 5000; // Poll every 5 seconds
        const MAX_POLL_TIME_MS = 45000; // Poll for max 45 seconds

        let txSignature: string | undefined;

        // Try execute with timeout - it may fail on WebSocket confirmation
        try {
          const executePromise = preparedRequest.execute();
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("CONFIRMATION_TIMEOUT")), EXECUTE_TIMEOUT_MS)
          );
          txSignature = await Promise.race([executePromise, timeoutPromise]);
        } catch (executeError) {
          const execErrorMsg = executeError instanceof Error ? executeError.message : String(executeError);
          const execErrorLogs = (executeError as { logs?: string[] })?.logs ?? [];
          const execLogsText = execErrorLogs.join("\n");

          // If user rejected, bail immediately
          if (
            /user rejected/i.test(execErrorMsg) ||
            /user denied/i.test(execErrorMsg) ||
            /rejected the request/i.test(execErrorMsg)
          ) {
            return { success: false, error: "Transaction cancelled by user" };
          }

          // Check if nonce already used (transaction already claimed)
          // CCTP logs "Allocate: account Address {...} already in use" when nonce consumed
          if (
            /already in use/i.test(execErrorMsg) ||
            /already in use/i.test(execLogsText) ||
            /"Custom":\s*0\b/.test(execErrorMsg)
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
              description: "This transfer was already minted. Check your wallet for the USDC.",
            });

            return { success: true, alreadyMinted: true };
          }

          // For any other error (timeout, WebSocket failure, etc.), fall through to polling
          console.log("Execute failed/timed out, starting confirmation polling:", execErrorMsg);
        }

        // If execute succeeded, we're done
        if (txSignature) {
          const updatedSteps = updateStepsWithMint(existingSteps, txSignature, false);
          const explorerUrl = getExplorerTxUrlUniversal(destinationChainId, txSignature, BRIDGEKIT_ENV);

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
        }

        // 6. Poll for confirmation using simulation (HTTP-based, no WebSocket)
        toast({
          title: "Confirming transaction",
          description: "Waiting for confirmation...",
        });

        const pollStartTime = Date.now();
        while (Date.now() - pollStartTime < MAX_POLL_TIME_MS) {
          // Wait before checking
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

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
            // Transaction confirmed!
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

          // If simulation shows it can still be minted, keep polling
          if (!statusCheck.canMint && statusCheck.error) {
            // Simulation failed for another reason, stop polling
            console.error("Simulation check failed:", statusCheck.error);
            break;
          }
        }

        // Polling timed out without confirmation
        return {
          success: false,
          error: "Transaction confirmation timed out. Please check your wallet and try again if needed.",
        };
      } catch (error: unknown) {
        // This catches errors from preparation phase (chain resolution, adapter creation, prepareAction)
        // Execute errors are handled in the try block above with polling fallback
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        console.error("Solana mint preparation failed:", error);
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
