/**
 * Unified hook for executing CCTP mint transactions.
 * Supports both EVM and Solana destinations.
 * Routes to the appropriate implementation based on destination chain.
 */

import { useCallback, useState } from "react";
import { useWalletClient, usePublicClient } from "wagmi";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useTransactionStore } from "@/lib/store/transactionStore";
import { useToast } from "@/components/ui/use-toast";
import {
  fetchAttestationUniversal,
  requestReattestation,
  pollForReattestatedData,
} from "@/lib/iris";
import { isMessageExpired } from "../errors";
import { simulateMint } from "@/lib/simulation";
import {
  getMessageTransmitterAddress,
  MESSAGE_TRANSMITTER_ABI,
} from "@/lib/contracts";
import { getExplorerTxUrl, getExplorerTxUrlUniversal, BRIDGEKIT_ENV } from "@/lib/bridgeKit";
import { getCctpDomain } from "../shared";
import { checkNonceUsed } from "../nonce";
import { updateStepsWithMint } from "../steps";
import {
  buildReceiveMessageTransaction,
  sendTransactionNoConfirm,
} from "../solana/mint";
import {
  isSolanaChain,
  getChainType,
  type ChainId,
  type SolanaChainId,
  type MintParams,
  type MintResult,
  type UniversalTxHash,
} from "../types";
import { isUserRejection, extractErrorMessage } from "../shared";

// =============================================================================
// Hook
// =============================================================================

export function useMint() {
  // EVM wallet state
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();

  // Solana wallet state
  const solanaWallet = useWallet();
  const { connection } = useConnection();

  // Shared state
  const { updateTransaction } = useTransactionStore();
  const { toast } = useToast();
  const [isMinting, setIsMinting] = useState(false);

  /**
   * Execute a mint operation.
   * Routes to EVM or Solana based on destination chain.
   */
  const executeMint = useCallback(
    async (params: MintParams): Promise<MintResult> => {
      const { burnTxHash, sourceChainId, destinationChainId, existingSteps } =
        params;

      setIsMinting(true);

      try {
        // Route based on destination chain type
        if (isSolanaChain(destinationChainId)) {
          return await executeSolanaMint(
            burnTxHash,
            sourceChainId,
            destinationChainId,
            existingSteps
          );
        } else {
          return await executeEvmMint(
            burnTxHash,
            sourceChainId,
            destinationChainId,
            existingSteps
          );
        }
      } finally {
        setIsMinting(false);
      }
    },
    [walletClient, publicClient, solanaWallet, connection, updateTransaction, toast]
  );

  /**
   * Execute mint on EVM destination chain.
   */
  async function executeEvmMint(
    burnTxHash: UniversalTxHash,
    sourceChainId: ChainId,
    destinationChainId: number,
    existingSteps?: MintParams["existingSteps"]
  ): Promise<MintResult> {
    // Validate EVM wallet connection
    if (!walletClient) {
      return { success: false, error: "EVM wallet not connected" };
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

    try {
      // 1. Fetch attestation from Iris
      const attestationData = await fetchAttestationUniversal(
        sourceChainId,
        burnTxHash
      );

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
    } catch (error: unknown) {
      return handleMintError(error, burnTxHash, existingSteps, updateTransaction, toast);
    }
  }

  /**
   * Execute mint on Solana destination chain.
   * Supports automatic re-attestation if message has expired.
   */
  async function executeSolanaMint(
    burnTxHash: UniversalTxHash,
    sourceChainId: ChainId,
    destinationChainId: SolanaChainId,
    existingSteps?: MintParams["existingSteps"],
    isRetry = false
  ): Promise<MintResult> {
    // Validate Solana wallet connection
    if (
      !solanaWallet.connected ||
      !solanaWallet.publicKey ||
      !solanaWallet.signTransaction
    ) {
      return {
        success: false,
        error: "Solana wallet not connected. Please connect your wallet.",
      };
    }

    // Validate source is EVM (we need domain for CCTP)
    if (typeof sourceChainId !== "number") {
      return {
        success: false,
        error: "Source chain must be an EVM chain for Solana destination.",
      };
    }

    try {
      // 1. Fetch attestation
      toast({
        title: isRetry ? "Fetching new attestation" : "Fetching attestation",
        description: "Retrieving Circle attestation for your transfer...",
      });

      const attestationData = await fetchAttestationUniversal(
        sourceChainId,
        burnTxHash
      );

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

      // 2. Proactively check if message has expired (Fast Transfers only)
      if (attestationData.expirationBlock && !isRetry) {
        const currentSlot = await connection.getSlot("confirmed");
        if (currentSlot > attestationData.expirationBlock) {
          console.log(
            `Message expired: current slot ${currentSlot} > expiration ${attestationData.expirationBlock}`
          );
          // Trigger re-attestation flow proactively
          return await handleMessageExpiredWithRetry(
            new Error("Message expired (proactive check)"),
            burnTxHash,
            sourceChainId,
            destinationChainId,
            existingSteps
          );
        }
      }

      // 3. Check if already minted using nonce check
      const nonceResult = await checkNonceUsed(
        destinationChainId,
        attestationData.message
      );

      if (nonceResult.isUsed) {
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

      // 4. Build the receiveMessage transaction
      toast({
        title: "Preparing mint transaction",
        description: "Building transaction...",
      });

      const isTestnet = BRIDGEKIT_ENV === "testnet";
      const sourceDomain = getCctpDomain(sourceChainId);
      const transaction = await buildReceiveMessageTransaction({
        connection,
        user: solanaWallet.publicKey,
        message: attestationData.message,
        attestation: attestationData.attestation,
        sourceDomain,
        destinationChainId,
        isTestnet,
        // Use mintRecipient from attestation - MUST match what's encoded in the message
        mintRecipient: attestationData.mintRecipient,
      });

      // 5. Sign transaction with wallet
      toast({
        title: "Sign transaction",
        description: "Please approve the transaction in your wallet...",
      });

      const signedTransaction = await solanaWallet.signTransaction(transaction);

      // 6. Send transaction without waiting for confirmation
      toast({
        title: "Sending transaction",
        description: "Submitting transaction to the network...",
      });

      const txSignature = await sendTransactionNoConfirm(connection, signedTransaction);

      // 7. Update transaction store
      const updatedSteps = updateStepsWithMint(existingSteps, txSignature, false);
      const explorerUrl = getExplorerTxUrlUniversal(
        destinationChainId,
        txSignature,
        BRIDGEKIT_ENV
      );

      updateTransaction(burnTxHash, {
        claimHash: txSignature,
        status: "claimed",
        bridgeState: "success",
        completedAt: new Date(),
        steps: updatedSteps,
      });

      toast({
        title: "Transaction sent!",
        description: explorerUrl
          ? "Your mint transaction has been submitted."
          : `Mint tx: ${txSignature.slice(0, 20)}...`,
      });

      return { success: true, mintTxHash: txSignature };
    } catch (error: unknown) {
      // Check if message expired and we haven't retried yet
      if (isMessageExpired(error) && !isRetry) {
        return await handleMessageExpiredWithRetry(
          error,
          burnTxHash,
          sourceChainId,
          destinationChainId,
          existingSteps
        );
      }

      return handleSolanaMintError(error, burnTxHash, existingSteps, updateTransaction, toast);
    }
  }

  /**
   * Handle MessageExpired error by requesting re-attestation and retrying.
   */
  async function handleMessageExpiredWithRetry(
    originalError: unknown,
    burnTxHash: UniversalTxHash,
    sourceChainId: ChainId,
    destinationChainId: SolanaChainId,
    existingSteps?: MintParams["existingSteps"]
  ): Promise<MintResult> {
    // Get nonce and sourceDomain from attestation for re-attestation request
    const attestationData = await fetchAttestationUniversal(sourceChainId, burnTxHash);
    if (!attestationData?.nonce || attestationData.sourceDomain === undefined) {
      console.error("Cannot re-attest: no nonce/sourceDomain found in attestation data");
      return handleSolanaMintError(originalError, burnTxHash, existingSteps, updateTransaction, toast);
    }

    toast({
      title: "Refreshing attestation",
      description: "Message expired. Requesting new attestation from Circle...",
    });

    const isTestnet = BRIDGEKIT_ENV === "testnet";
    const reattestResult = await requestReattestation(attestationData.nonce, isTestnet);

    if (!reattestResult.success) {
      console.error("Re-attestation failed:", reattestResult.error);
      return {
        success: false,
        error: reattestResult.error || "Failed to refresh attestation. Please try again later.",
      };
    }

    toast({
      title: "Waiting for new attestation",
      description: "Circle is generating a new attestation...",
    });

    // Poll for updated attestation using NONCE endpoint (not txHash)
    const newAttestation = await pollForReattestatedData(
      attestationData.sourceDomain,
      attestationData.nonce,
      isTestnet,
      10,
      3000
    );

    if (!newAttestation) {
      return {
        success: false,
        error: "Timed out waiting for new attestation. Please try again.",
      };
    }

    toast({
      title: "Attestation refreshed",
      description: "Retrying mint with new attestation...",
    });

    // Retry mint with new attestation (isRetry=true to prevent infinite loop)
    return executeSolanaMint(
      burnTxHash,
      sourceChainId,
      destinationChainId,
      existingSteps,
      true // isRetry
    );
  }

  return {
    executeMint,
    isMinting,
  };
}

// =============================================================================
// Error Handling
// =============================================================================

import type { LocalTransaction } from "@/lib/types";

type UpdateTransactionFn = (
  hash: UniversalTxHash,
  updates: Partial<LocalTransaction>
) => void;
type ToastFn = (opts: { title: string; description: string }) => void;

/**
 * Handle EVM mint errors with consistent behavior.
 */
function handleMintError(
  error: unknown,
  burnTxHash: UniversalTxHash,
  existingSteps: MintParams["existingSteps"],
  updateTransaction: UpdateTransactionFn,
  toast: ToastFn
): MintResult {
  const errorMessage = extractErrorMessage(error);

  // Check for user rejection
  if (isUserRejection(error)) {
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

  console.error("EVM mint failed:", {
    ecosystem: "evm",
    error: errorMessage,
    context: {
      burnTxHash,
      timestamp: new Date().toISOString(),
    },
    rawError: error,
  });
  return {
    success: false,
    error: errorMessage,
  };
}

/**
 * Handle Solana mint errors with consistent behavior.
 */
function handleSolanaMintError(
  error: unknown,
  burnTxHash: UniversalTxHash,
  existingSteps: MintParams["existingSteps"],
  updateTransaction: UpdateTransactionFn,
  toast: ToastFn
): MintResult {
  const errorMessage = extractErrorMessage(error);
  const errorLogs = (error as { logs?: string[] })?.logs ?? [];
  const logsText = errorLogs.join("\n");

  // Handle user rejection
  if (isUserRejection(error)) {
    return { success: false, error: "Transaction cancelled by user" };
  }

  // Check if nonce already used (transaction already claimed)
  if (
    /already in use/i.test(errorMessage) ||
    /already in use/i.test(logsText) ||
    /"Custom":\s*0\b/.test(errorMessage) ||
    /account.*already.*allocated/i.test(errorMessage)
  ) {
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

  console.error("Solana mint failed:", {
    ecosystem: "solana",
    error: errorMessage,
    context: {
      burnTxHash,
      timestamp: new Date().toISOString(),
    },
    logs: errorLogs.length > 0 ? errorLogs : undefined,
    rawError: error,
  });
  return {
    success: false,
    error: errorMessage,
  };
}
