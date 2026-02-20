/**
 * Unified hook for executing CCTP mint transactions.
 * Supports both EVM and Solana destinations.
 * Routes to the appropriate implementation based on destination chain.
 */

import { useCallback, useState } from "react";
import { useWalletClient, useBalance } from "wagmi";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useTransactionStore } from "@/lib/store/transactionStore";
import { useToast } from "@/components/ui/use-toast";
import { createEvmPublicClient } from "@/lib/rpc/clients";
import { fetchAttestationUniversal } from "@/lib/iris";
import { simulateMint } from "@/lib/simulation";
import {
  getMessageTransmitterAddress,
  MESSAGE_TRANSMITTER_ABI,
} from "@/lib/contracts";
import { getExplorerTxUrl, getExplorerTxUrlUniversal, BRIDGEKIT_ENV } from "@/lib/bridgeKit";
import { getCctpDomain, getCctpDomainSafe } from "../shared";
import { checkNonceUsed } from "../nonce";
import { updateStepsWithMint } from "../steps";
import {
  buildReceiveMessageTransaction,
  sendTransactionNoConfirm,
  isVersionedTransaction,
  checkMessageExpiration,
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
import { parseSolanaCctpError, extractCctpErrorCode } from "../solana/errors";
import { parseEvmCctpError } from "../evm/errors";
import {
  estimateSolanaMintGas,
  estimateEvmMintGas,
  formatSol,
  formatNative,
} from "../gasEstimation";
import { extractDestinationDomainFromMessage } from "@/lib/simulation";

// =============================================================================
// Hook
// =============================================================================

const ALREADY_CLAIMED_TOAST_TITLE = "USDC Successfully Claimed";
const ALREADY_CLAIMED_TOAST_DESCRIPTION = "Check your wallet for the USDC.";

export function useMint() {
  // EVM wallet state
  const { data: walletClient } = useWalletClient();

  // EVM native balance for gas checks
  const { data: evmNativeBalance } = useBalance({
    address: walletClient?.account?.address,
    query: {
      enabled: !!walletClient?.account?.address,
    },
  });

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
            existingSteps,
            evmNativeBalance?.value
          );
        }
      } finally {
        setIsMinting(false);
      }
    },
    [walletClient, solanaWallet, connection, updateTransaction, toast, evmNativeBalance?.value]
  );

  /**
   * Execute mint on EVM destination chain.
   */
  async function executeEvmMint(
    burnTxHash: UniversalTxHash,
    sourceChainId: ChainId,
    destinationChainId: number,
    existingSteps?: MintParams["existingSteps"],
    userNativeBalance?: bigint
  ): Promise<MintResult> {
    // Validate EVM wallet connection
    if (!walletClient) {
      return { success: false, error: "EVM wallet not connected" };
    }

    const publicClient = createEvmPublicClient(destinationChainId, { walletClient });

    const messageTransmitter = getMessageTransmitterAddress(destinationChainId);
    if (!messageTransmitter) {
      return {
        success: false,
        error: `No MessageTransmitter for chain ${destinationChainId}`,
      };
    }

    // Track nonce for error handling (re-attestation needs it)
    let evmAttestationNonce: string | undefined;

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
      if (!attestationData.message || !attestationData.attestation) {
        return {
          success: false,
          error: "Attestation payload is incomplete. Please try again.",
        };
      }

      // Store nonce for error handler (needed for re-attestation)
      evmAttestationNonce = attestationData.nonce;

      // 1b. Validate destination domain matches target chain
      try {
        const messageDomain = extractDestinationDomainFromMessage(attestationData.message);
        const expectedDomain = getCctpDomainSafe(destinationChainId);

        if (expectedDomain !== null && messageDomain !== expectedDomain) {
          console.error(
            `[useMint] Domain mismatch detected!\n` +
            `  Message destination domain: ${messageDomain}\n` +
            `  Target chain ${destinationChainId} domain: ${expectedDomain}\n` +
            `  The CCTP message can only be received on the chain with domain ${messageDomain}.\n` +
            `  This indicates the UI is targeting the wrong destination chain.`
          );
          return {
            success: false,
            error: `Wrong destination chain: this transfer was burned for CCTP domain ${messageDomain}, ` +
              `but you are trying to claim on chain ${destinationChainId} (domain ${expectedDomain}). ` +
              `Please switch to the correct chain.`,
          };
        }
      } catch (domainError) {
        console.warn("[useMint] Could not validate destination domain:", domainError);
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
          title: ALREADY_CLAIMED_TOAST_TITLE,
          description: ALREADY_CLAIMED_TOAST_DESCRIPTION,
        });

        return { success: true, alreadyMinted: true };
      }

      if (!simResult.canMint) {
        // Check if message has expired - needs re-attestation
        if (simResult.messageExpired) {
          return {
            success: false,
            messageExpired: true,
            nonce: attestationData.nonce,
            error: "Message expired - please request re-attestation",
          };
        }

        return {
          success: false,
          error: simResult.error || "Simulation failed - mint may not be ready",
        };
      }

      // 3. Check gas balance before prompting user to sign
      if (publicClient && walletClient?.account?.address && userNativeBalance !== undefined) {
        try {
          const gasEstimate = await estimateEvmMintGas({
            publicClient,
            userAddress: walletClient.account.address,
            messageTransmitter,
            message: attestationData.message,
            attestation: attestationData.attestation,
            userBalance: userNativeBalance,
          });

          if (!gasEstimate.sufficient) {
            const nativeSymbol = walletClient.chain?.nativeCurrency?.symbol || "ETH";
            return {
              success: false,
              error: `Insufficient ${nativeSymbol} for gas. You need ~${formatNative(gasEstimate.required)} ${nativeSymbol} but have ${formatNative(gasEstimate.current)} ${nativeSymbol}.`,
            };
          }
        } catch (gasError) {
          // Log but don't block - let the wallet handle it if estimation fails
          console.warn("Gas estimation failed, proceeding anyway:", gasError);
        }
      }

      // 4. Execute the mint transaction
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

      // 5. Wait for confirmation
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

      // 6. Update the existing transaction in store
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
      return handleMintError(error, burnTxHash, existingSteps, updateTransaction, toast, evmAttestationNonce);
    }
  }

  /**
   * Execute mint on Solana destination chain.
   */
  async function executeSolanaMint(
    burnTxHash: UniversalTxHash,
    sourceChainId: ChainId,
    destinationChainId: SolanaChainId,
    existingSteps?: MintParams["existingSteps"]
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

    // Track nonce for error handling (re-attestation needs it)
    let attestationNonce: string | undefined;

    try {
      // 1. Fetch attestation
      toast({
        title: "Fetching attestation",
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
      if (!attestationData.message || !attestationData.attestation) {
        return {
          success: false,
          error: "Attestation payload is incomplete. Please try again.",
        };
      }

      // Store nonce for error handler (needed for re-attestation)
      attestationNonce = attestationData.nonce;

      // 2. Check if already minted using nonce check
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
          title: ALREADY_CLAIMED_TOAST_TITLE,
          description: ALREADY_CLAIMED_TOAST_DESCRIPTION,
        });

        return { success: true, alreadyMinted: true };
      }

      // 3. Check if message has expired before building transaction
      try {
        const expirationCheck = await checkMessageExpiration(
          connection,
          attestationData.message
        );

        if (expirationCheck.isExpired) {
          console.warn(
            `[useMint] CCTP message expired: expirationBlock=${expirationCheck.expirationBlock}, ` +
            `currentSlot=${expirationCheck.currentSlot}. Needs re-attestation.`
          );
          return {
            success: false,
            messageExpired: true,
            nonce: attestationData.nonce,
            error: `Message expired (slot ${expirationCheck.expirationBlock} < current ${expirationCheck.currentSlot}). Please request re-attestation.`,
          };
        }
      } catch (expirationError) {
        // Don't block on expiration check failure - let the transaction try
        console.warn("[useMint] Expiration check failed, proceeding:", expirationError);
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
      });

      // 5. Check gas balance before prompting user to sign
      if (solanaWallet.publicKey) {
        try {
          // Fetch current SOL balance
          const solBalance = await connection.getBalance(solanaWallet.publicKey);
          const userBalance = BigInt(solBalance);

          const gasEstimate = await estimateSolanaMintGas({
            connection,
            userPubkey: solanaWallet.publicKey,
            transaction,
            destinationChainId,
            userBalance,
          });

          if (!gasEstimate.sufficient) {
            const reason = gasEstimate.breakdown.ataCreation
              ? "creating your USDC account and transaction fees"
              : "transaction fees";
            return {
              success: false,
              error: `Insufficient SOL for gas. You need ~${formatSol(gasEstimate.required)} SOL for ${reason}. Current: ${formatSol(gasEstimate.current)} SOL.`,
            };
          }
        } catch (gasError) {
          // Log but don't block - let the wallet handle it if estimation fails
          console.warn("Solana gas estimation failed, proceeding anyway:", gasError);
        }
      }

      // 6. Sign transaction with wallet
      // Note: signTransaction handles both legacy and versioned transactions
      toast({
        title: "Sign transaction",
        description: "Please approve the transaction in your wallet...",
      });

      const signedTransaction = await solanaWallet.signTransaction(transaction);

      // 7. Send transaction without waiting for confirmation
      toast({
        title: "Sending transaction",
        description: "Submitting transaction to the network...",
      });

      const txSignature = await sendTransactionNoConfirm(connection, signedTransaction);

      // 8. Update transaction store
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
      return handleSolanaMintError(error, burnTxHash, existingSteps, updateTransaction, toast, attestationNonce);
    }
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
 *
 * Uses the CCTP EVM error map to provide user-friendly messages for known
 * revert reasons and always logs the full error for debugging.
 */
function handleMintError(
  error: unknown,
  burnTxHash: UniversalTxHash,
  existingSteps: MintParams["existingSteps"],
  updateTransaction: UpdateTransactionFn,
  toast: ToastFn,
  attestationNonce?: string
): MintResult {
  const errorMessage = extractErrorMessage(error, 500);

  // ── 0. User rejection ─────────────────────────────────────────────
  if (isUserRejection(error)) {
    return { success: false, error: "Transaction cancelled by user" };
  }

  // ── 1. Always log full debug info for non-user errors ─────────────
  console.error("EVM mint failed:", {
    ecosystem: "evm",
    burnTxHash,
    timestamp: new Date().toISOString(),
    errorMessage,
    shortMessage: (error as { shortMessage?: string })?.shortMessage,
    rawError: error,
  });

  // ── 2. Try to match a known CCTP revert reason ────────────────────
  const { info } = parseEvmCctpError(error);

  if (info) {
    console.warn(
      `[useMint] EVM CCTP error: ${info.title}\n` +
      `  Message: ${info.userMessage}`
    );

    // Already claimed
    if (info.isAlreadyClaimed) {
      const updatedSteps = updateStepsWithMint(existingSteps, undefined, true);
      updateTransaction(burnTxHash, {
        status: "claimed",
        bridgeState: "success",
        completedAt: new Date(),
        steps: updatedSteps,
      });

      toast({
        title: ALREADY_CLAIMED_TOAST_TITLE,
        description: ALREADY_CLAIMED_TOAST_DESCRIPTION,
      });

      return { success: true, alreadyMinted: true };
    }

    // Message expired / fee issues → trigger auto re-attestation
    if (info.isExpired) {
      return {
        success: false,
        messageExpired: true,
        nonce: attestationNonce,
        errorTitle: info.title,
        error: info.userMessage,
      };
    }

    // Known error with specific title + message
    return {
      success: false,
      errorTitle: info.title,
      error: info.userMessage,
    };
  }

  // ── 3. Unknown error ──────────────────────────────────────────────
  return {
    success: false,
    error: errorMessage,
  };
}

/**
 * Handle Solana mint errors with consistent behavior.
 *
 * Uses the CCTP error map to provide user-friendly messages for known
 * program errors and always logs full simulation logs for debugging.
 */
function handleSolanaMintError(
  error: unknown,
  burnTxHash: UniversalTxHash,
  existingSteps: MintParams["existingSteps"],
  updateTransaction: UpdateTransactionFn,
  toast: ToastFn,
  attestationNonce?: string
): MintResult {
  // ── 0. User rejection (before any other checks) ───────────────────────
  if (isUserRejection(error)) {
    return { success: false, error: "Transaction cancelled by user" };
  }

  // ── 1. Gather all available error context ──────────────────────────────
  const errorMessage = extractErrorMessage(error, 500);
  const simLogs = (error as { simulationLogs?: string[] })?.simulationLogs ?? [];
  const txLogs = (error as { transactionLogs?: string[] })?.transactionLogs ?? [];
  const legacyLogs = (error as { logs?: string[] })?.logs ?? [];
  const allLogs = [...simLogs, ...txLogs, ...legacyLogs];
  const txMessage = (error as { transactionMessage?: string })?.transactionMessage ?? "";

  // ── 2. Always log full debug info for non-user errors ──────────────────
  console.error("Solana mint failed:", {
    ecosystem: "solana",
    burnTxHash,
    timestamp: new Date().toISOString(),
    errorMessage,
    transactionMessage: txMessage,
    logs: allLogs.length > 0 ? allLogs : "(no logs captured)",
    rawError: error,
  });

  // ── 3. Nonce already used (account-already-in-use from init) ──────────
  const allText = `${errorMessage} ${txMessage} ${allLogs.join("\n")}`;
  if (
    /already in use/i.test(allText) ||
    /account.*already.*allocated/i.test(allText) ||
    /"Custom":\s*0\b/.test(allText)
  ) {
    const updatedSteps = updateStepsWithMint(existingSteps, undefined, true);
    updateTransaction(burnTxHash, {
      status: "claimed",
      bridgeState: "success",
      completedAt: new Date(),
      steps: updatedSteps,
    });

    toast({
      title: ALREADY_CLAIMED_TOAST_TITLE,
      description: ALREADY_CLAIMED_TOAST_DESCRIPTION,
    });

    return { success: true, alreadyMinted: true };
  }

  // ── 4. Try to match a known CCTP error code ───────────────────────────
  const { code, info } = parseSolanaCctpError(error);

  if (info) {
    console.warn(
      `[useMint] CCTP error 0x${code}: ${info.name}\n` +
      `  Title: ${info.title}\n` +
      `  Message: ${info.userMessage}\n` +
      `  Detail: ${info.detail}`
    );

    // Message expired / fee issues → trigger auto re-attestation
    if (info.isExpired) {
      return {
        success: false,
        messageExpired: true,
        nonce: attestationNonce,
        errorTitle: info.title,
        error: info.userMessage,
      };
    }

    // Already claimed via error code
    if (info.isAlreadyClaimed) {
      const updatedSteps = updateStepsWithMint(existingSteps, undefined, true);
      updateTransaction(burnTxHash, {
        status: "claimed",
        bridgeState: "success",
        completedAt: new Date(),
        steps: updatedSteps,
      });

      toast({
        title: ALREADY_CLAIMED_TOAST_TITLE,
        description: ALREADY_CLAIMED_TOAST_DESCRIPTION,
      });

      return { success: true, alreadyMinted: true };
    }

    // Known error with specific title + message
    return {
      success: false,
      errorTitle: info.title,
      error: info.userMessage,
    };
  }

  // ── 5. Unknown error – return raw message with error code if found ────
  const unknownCode = extractCctpErrorCode(allText);
  return {
    success: false,
    errorTitle: unknownCode ? `Error 0x${unknownCode}` : undefined,
    error: errorMessage,
  };
}
