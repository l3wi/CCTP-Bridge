/**
 * Unified burn hook for CCTP transfers.
 * Handles both EVM and Solana source chains with consistent interface.
 */

import { useCallback, useState } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { useWallet } from "@solana/wallet-adapter-react";
import { useToast } from "@/components/ui/use-toast";
import { getExplorerTxUrlUniversal, BRIDGEKIT_ENV } from "@/lib/bridgeKit";
import { createSolanaConnection } from "@/lib/solanaAdapter";
import type { BurnParams, BurnResult, ChainId, SolanaChainId, EvmTxHash } from "../types";
import { isSolanaChain } from "../types";
import { handleBurnError } from "../errors";
import { getCctpDomain, getCctpDomainSafe, FINALITY_THRESHOLDS } from "../shared";

/** Callbacks for burn progress updates - exported for useCrossEcosystemBridge */
export interface BurnProgressCallbacks {
  /** Called when EVM approval tx is sent - triggers progress screen with tx hash */
  onApprovalSent?: (txHash: EvmTxHash) => void;
  /** Called when EVM approval is confirmed */
  onApprovalComplete?: (txHash: EvmTxHash) => void;
}

// EVM burn utilities
import {
  getTokenMessengerAddress,
  getUsdcAddress,
  checkAllowance,
  buildApprovalData,
  buildDepositForBurnData,
  calculateMaxFee,
  prepareEvmBurn,
} from "../evm/burn";
import { formatMintRecipientHex } from "../shared";

// Solana burn utilities
import {
  buildDepositForBurnTransaction,
  sendTransactionNoConfirm,
} from "../solana/burn";

/**
 * Unified hook for burning USDC on any supported source chain.
 * Automatically routes to EVM or Solana implementation based on source chain.
 */
export function useBurn() {
  // EVM wallet state
  const { address: evmAddress } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  // Solana wallet state
  const solanaWallet = useWallet();

  const { toast } = useToast();
  const [isBurning, setIsBurning] = useState(false);

  /**
   * Execute a burn on EVM chain.
   */
  const executeEvmBurn = useCallback(
    async (params: BurnParams, callbacks?: BurnProgressCallbacks): Promise<BurnResult> => {
      const sourceChainId = params.sourceChainId as number;

      // Validate wallet connection
      if (!evmAddress) {
        return { success: false, error: "Wallet not connected. Please connect your wallet." };
      }
      if (!walletClient) {
        return { success: false, error: "Wallet client not available." };
      }
      if (!publicClient) {
        return { success: false, error: "Public client not available." };
      }

      let approvalTxHash: `0x${string}` | undefined;

      try {
        // Prepare burn configuration
        const burnConfig = await prepareEvmBurn({
          sourceChainId,
          destinationChainId: params.destinationChainId,
          amount: params.amount,
          recipientAddress: params.recipientAddress,
          transferSpeed: params.transferSpeed,
        });

        // Step 1: Approval
        toast({
          title: "Approval required",
          description: "Please approve USDC spending in your wallet...",
        });

        const approvalData = buildApprovalData(
          burnConfig.usdcAddress,
          burnConfig.tokenMessenger,
          params.amount
        );

        try {
          approvalTxHash = await walletClient.sendTransaction({
            to: approvalData.to,
            data: approvalData.data,
            chain: walletClient.chain,
            account: evmAddress,
          });

          // Trigger progress screen after approval tx is sent
          callbacks?.onApprovalSent?.(approvalTxHash);

          toast({
            title: "Approval submitted",
            description: "Waiting for approval confirmation...",
          });

          // Wait for approval confirmation (2 blocks for L2 safety)
          await publicClient.waitForTransactionReceipt({
            hash: approvalTxHash,
            confirmations: 2,
          });

          // Verify allowance was set with retry logic
          // ETH approvals can be slow on congested networks, so we retry for up to 1 minute
          const MAX_ALLOWANCE_WAIT_MS = 60_000;
          const INITIAL_BACKOFF_MS = 1_000;
          const MAX_BACKOFF_MS = 10_000;

          let allowance = 0n;
          const startTime = Date.now();
          let backoffMs = INITIAL_BACKOFF_MS;

          while (Date.now() - startTime < MAX_ALLOWANCE_WAIT_MS) {
            allowance = await checkAllowance(
              publicClient,
              burnConfig.usdcAddress,
              evmAddress,
              burnConfig.tokenMessenger
            );

            if (allowance >= params.amount) break;

            // Exponential backoff with cap: 1s -> 2s -> 4s -> 8s -> 10s (cap)
            await new Promise((r) => setTimeout(r, backoffMs));
            backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
          }

          if (allowance < params.amount) {
            return {
              success: false,
              approvalTxHash,
              error: "Approval confirmed but allowance not set after 1 minute. Please try again.",
            };
          }

          toast({
            title: "Approval confirmed",
            description: "Now submitting burn transaction...",
          });

          // Notify approval complete with tx hash
          callbacks?.onApprovalComplete?.(approvalTxHash);
        } catch (approvalError) {
          return handleBurnError(approvalError, "approval");
        }

        // Step 2: Burn
        toast({
          title: "Sign transaction",
          description: "Please approve the burn transaction in your wallet...",
        });

        const burnData = buildDepositForBurnData(burnConfig.tokenMessenger, {
          amount: params.amount,
          destinationDomain: burnConfig.destinationDomain,
          mintRecipient: burnConfig.mintRecipient,
          burnToken: burnConfig.usdcAddress,
          minFinalityThreshold: burnConfig.minFinalityThreshold,
          maxFee: burnConfig.maxFee,
        });

        const burnTxHash = await walletClient.sendTransaction({
          to: burnData.to,
          data: burnData.data,
          chain: walletClient.chain,
          account: evmAddress,
        });

        // Success
        const explorerUrl = getExplorerTxUrlUniversal(sourceChainId, burnTxHash, BRIDGEKIT_ENV);
        toast({
          title: "Transaction sent",
          description: explorerUrl
            ? "Your burn transaction has been submitted."
            : `Burn tx: ${burnTxHash.slice(0, 20)}...`,
        });

        return { success: true, approvalTxHash, burnTxHash };
      } catch (error) {
        return handleBurnError(error, "burn");
      }
    },
    [evmAddress, walletClient, publicClient, toast]
  );

  /**
   * Execute a burn on Solana chain.
   */
  const executeSolanaBurn = useCallback(
    async (params: BurnParams): Promise<BurnResult> => {
      const sourceChainId = params.sourceChainId as SolanaChainId;

      // Validate wallet connection
      if (!solanaWallet.connected || !solanaWallet.publicKey) {
        return { success: false, error: "Solana wallet not connected. Please connect your wallet." };
      }
      if (!solanaWallet.signTransaction) {
        return { success: false, error: "Wallet does not support transaction signing." };
      }

      // Validate destination has CCTP domain
      const destinationDomain = getCctpDomainSafe(params.destinationChainId);
      if (destinationDomain === null) {
        return { success: false, error: `Destination chain ${params.destinationChainId} is not supported by CCTP.` };
      }

      try {
        const connection = createSolanaConnection(sourceChainId);

        // Calculate fee parameters
        const minFinalityThreshold =
          params.transferSpeed === "fast"
            ? FINALITY_THRESHOLDS.solana.fast
            : FINALITY_THRESHOLDS.solana.standard;

        const isTestnet = BRIDGEKIT_ENV === "testnet";
        let maxFee = 0n;

        if (params.transferSpeed === "fast") {
          try {
            const sourceDomain = getCctpDomain(sourceChainId);
            maxFee = await calculateMaxFee(
              sourceDomain,
              destinationDomain,
              params.amount,
              "fast",
              isTestnet
            );

            // Safety check: fee must be less than amount
            if (maxFee >= params.amount) {
              maxFee = params.amount - 1n;
            }
          } catch (feeError) {
            console.warn("Failed to calculate fee, using standard:", feeError);
          }
        }

        toast({
          title: "Building transaction",
          description: "Preparing CCTP burn transaction...",
        });

        // Build transaction
        const { transaction, messageAccount } = await buildDepositForBurnTransaction({
          connection,
          user: solanaWallet.publicKey,
          amount: params.amount,
          destinationChainId: params.destinationChainId,
          mintRecipient: params.recipientAddress,
          maxFee,
          minFinalityThreshold,
          sourceChainId,
        });

        toast({
          title: "Sign transaction",
          description: "Please approve the transaction in your wallet...",
        });

        // Sign with wallet
        const signedTx = await solanaWallet.signTransaction(transaction);

        // Partial sign with message account (required for CCTP)
        signedTx.partialSign(messageAccount);

        // Send WITHOUT waiting for confirmation
        const signature = await sendTransactionNoConfirm(connection, signedTx);

        // Success
        const explorerUrl = getExplorerTxUrlUniversal(sourceChainId, signature, BRIDGEKIT_ENV);
        toast({
          title: "Transaction sent",
          description: explorerUrl
            ? "Your burn transaction has been submitted."
            : `Burn tx: ${signature.slice(0, 20)}...`,
        });

        return { success: true, burnTxHash: signature };
      } catch (error) {
        return handleBurnError(error, "burn");
      }
    },
    [solanaWallet.connected, solanaWallet.publicKey, solanaWallet.signTransaction, toast]
  );

  /**
   * Execute burn - routes to EVM or Solana based on source chain.
   */
  const executeBurn = useCallback(
    async (params: BurnParams, callbacks?: BurnProgressCallbacks): Promise<BurnResult> => {
      setIsBurning(true);

      try {
        if (isSolanaChain(params.sourceChainId)) {
          return await executeSolanaBurn(params);
        } else {
          return await executeEvmBurn(params, callbacks);
        }
      } finally {
        setIsBurning(false);
      }
    },
    [executeEvmBurn, executeSolanaBurn]
  );

  return {
    executeBurn,
    isBurning,
  };
}
