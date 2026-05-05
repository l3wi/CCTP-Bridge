import type { Connection } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import { fetchAttestationUniversal, isCompleteAttestationData } from "@/lib/iris";
import { getExplorerTxUrlUniversal, BRIDGEKIT_ENV } from "@/lib/bridgeKit";
import {
  extractDestinationDomainFromMessage,
  extractSourceDomainFromMessage,
} from "@/lib/simulation";
import { checkNonceUsed } from "../../nonce";
import { getCctpDomainSafe } from "../../shared";
import { updateStepsWithMint } from "../../steps";
import {
  buildReceiveMessageTransaction,
  checkMessageExpiration,
  sendTransactionNoConfirm,
} from "../../solana/mint";
import {
  estimateSolanaMintGas,
  formatSol,
} from "../../gasEstimation";
import type {
  ChainId,
  MintParams,
  MintResult,
  SolanaChainId,
  UniversalTxHash,
} from "../../types";
import {
  ALREADY_CLAIMED_TOAST_DESCRIPTION,
  ALREADY_CLAIMED_TOAST_TITLE,
  handleSolanaMintError,
  type ToastFn,
  type UpdateTransactionFn,
} from "./errors";
import {
  markMintStepPending,
  normalizeAddress,
  waitForSolanaAccount,
  waitForSolanaMintConfirmation,
} from "./solanaConfirmation";

export async function executeSolanaMint(params: {
  burnTxHash: UniversalTxHash;
  sourceChainId: ChainId;
  destinationChainId: SolanaChainId;
  targetAddress?: string;
  existingSteps?: MintParams["existingSteps"];
  solanaWallet: WalletContextState;
  connection: Connection;
  updateTransaction: UpdateTransactionFn;
  toast: ToastFn;
}): Promise<MintResult> {
  const {
    burnTxHash,
    sourceChainId,
    destinationChainId,
    targetAddress,
    existingSteps,
    solanaWallet,
    connection,
    updateTransaction,
    toast,
  } = params;

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

  const lockedTargetAddress = normalizeAddress(targetAddress);

  if (!lockedTargetAddress) {
    return {
      success: false,
      errorTitle: "Missing recipient wallet",
      error:
        "This transfer is missing its locked Solana recipient wallet. Please recover the transfer details before claiming.",
    };
  }

  if (typeof sourceChainId !== "number") {
    return {
      success: false,
      error: "Source chain must be an EVM chain for Solana destination.",
    };
  }

  let attestationNonce: string | undefined;

  try {
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

    if (!isCompleteAttestationData(attestationData)) {
      if (attestationData.status !== "complete") {
        return {
          success: false,
          error: "Attestation not ready yet. Please wait a few more minutes.",
        };
      }

      return {
        success: false,
        error: "Attestation payload is incomplete. Please try again.",
      };
    }

    attestationNonce = attestationData.nonce;

    const expectedSourceDomain = getCctpDomainSafe(sourceChainId);
    const expectedDestinationDomain = getCctpDomainSafe(destinationChainId);

    if (expectedSourceDomain === null) {
      return {
        success: false,
        error: `No CCTP domain found for source chain ${sourceChainId}.`,
      };
    }

    if (expectedDestinationDomain === null) {
      return {
        success: false,
        error: `No CCTP domain found for destination chain ${destinationChainId}.`,
      };
    }

    try {
      const messageSourceDomain = extractSourceDomainFromMessage(attestationData.message);
      const messageDestinationDomain = extractDestinationDomainFromMessage(attestationData.message);

      if (messageSourceDomain !== expectedSourceDomain) {
        console.error(
          `[useMint] Source domain mismatch detected!\n` +
          `  Message source domain: ${messageSourceDomain}\n` +
          `  Source chain ${sourceChainId} domain: ${expectedSourceDomain}\n` +
          `  The CCTP message must originate from the selected source chain.`
        );
        return {
          success: false,
          error:
            `Wrong source chain: this transfer originated from CCTP domain ${messageSourceDomain}, ` +
            `but source chain ${sourceChainId} has domain ${expectedSourceDomain}.`,
        };
      }

      if (messageDestinationDomain !== expectedDestinationDomain) {
        console.error(
          `[useMint] Destination domain mismatch detected!\n` +
          `  Message destination domain: ${messageDestinationDomain}\n` +
          `  Destination chain ${destinationChainId} domain: ${expectedDestinationDomain}\n` +
          `  The CCTP message can only be received on the matching destination domain.`
        );
        return {
          success: false,
          error:
            `Wrong destination chain: this transfer was burned for CCTP domain ${messageDestinationDomain}, ` +
            `but ${destinationChainId} has domain ${expectedDestinationDomain}.`,
        };
      }
    } catch (domainError) {
      console.warn("[useMint] Could not validate Solana CCTP domains:", domainError);
      return {
        success: false,
        error: "Unable to validate CCTP message domains. Please try again.",
      };
    }

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
      console.warn("[useMint] Expiration check failed, proceeding:", expirationError);
    }

    toast({
      title: "Preparing mint transaction",
      description: "Building transaction...",
    });

    const isTestnet = BRIDGEKIT_ENV === "testnet";
    const transactionPlan = await buildReceiveMessageTransaction({
      connection,
      user: solanaWallet.publicKey,
      message: attestationData.message,
      attestation: attestationData.attestation,
      sourceDomain: expectedSourceDomain,
      destinationChainId,
      isTestnet,
      destinationAddress: lockedTargetAddress,
    });
    let mintTransaction = transactionPlan.mintTransaction;

    try {
      const solBalance = await connection.getBalance(solanaWallet.publicKey);
      const userBalance = BigInt(solBalance);

      const gasEstimate = await estimateSolanaMintGas({
        connection,
        userPubkey: solanaWallet.publicKey,
        transaction: transactionPlan.mintTransaction,
        setupTransaction: transactionPlan.setupTransaction,
        destinationChainId,
        userBalance,
        recipientOwnerPubkey: transactionPlan.recipientOwner,
        needsAtaCreation: transactionPlan.needsAtaCreation,
      });

      if (!gasEstimate.sufficient) {
        const reason = gasEstimate.breakdown.ataCreation
          ? "recipient USDC account rent and transaction fees"
          : "transaction fees";
        return {
          success: false,
          error: `Insufficient SOL for gas. You need ~${formatSol(gasEstimate.required)} SOL for ${reason}. Current: ${formatSol(gasEstimate.current)} SOL.`,
        };
      }
    } catch (gasError) {
      console.warn("Solana gas estimation failed, proceeding anyway:", gasError);
    }

    if (transactionPlan.setupTransaction) {
      toast({
        title: "Set up recipient account",
        description:
          "Please approve the recipient USDC account setup. Your wallet pays the Solana fees and rent.",
      });

      const signedSetupTransaction = await solanaWallet.signTransaction(
        transactionPlan.setupTransaction
      );

      toast({
        title: "Sending setup transaction",
        description: "Creating the recipient USDC token account...",
      });

      const setupSignature = await sendTransactionNoConfirm(
        connection,
        signedSetupTransaction
      );
      const setupConfirmed = await waitForSolanaMintConfirmation(
        connection,
        setupSignature
      );

      if (!setupConfirmed) {
        return {
          success: false,
          error:
            "Recipient USDC account setup was submitted but is not yet confirmed on Solana. Please wait and retry claim shortly.",
        };
      }

      const accountReady = await waitForSolanaAccount(
        connection,
        transactionPlan.recipientAta
      );
      if (!accountReady) {
        return {
          success: false,
          error:
            "Recipient USDC account setup confirmed, but the account is not visible yet. Please wait and retry claim shortly.",
        };
      }

      if (transactionPlan.refreshMintTransaction) {
        mintTransaction = await transactionPlan.refreshMintTransaction();
      }
    }

    toast({
      title: "Sign claim transaction",
      description:
        "Please approve the claim. Your wallet pays Solana fees; USDC goes to the transfer recipient.",
    });

    const signedTransaction = await solanaWallet.signTransaction(mintTransaction);

    toast({
      title: "Sending claim transaction",
      description: "Submitting the CCTP claim to the network...",
    });

    const txSignature = await sendTransactionNoConfirm(connection, signedTransaction);
    const pendingSteps = markMintStepPending(existingSteps, txSignature);
    const explorerUrl = getExplorerTxUrlUniversal(
      destinationChainId,
      txSignature,
      BRIDGEKIT_ENV
    );

    updateTransaction(burnTxHash, {
      claimHash: txSignature,
      status: "pending",
      bridgeState: "pending",
      steps: pendingSteps,
    });

    toast({
      title: "Transaction sent",
      description: explorerUrl
        ? "Submitted to Solana. Confirming on-chain status..."
        : `Mint tx: ${txSignature.slice(0, 20)}...`,
    });

    const isConfirmed = await waitForSolanaMintConfirmation(connection, txSignature);
    if (!isConfirmed) {
      return {
        success: false,
        mintTxHash: txSignature,
        error:
          "Mint transaction was submitted but is not yet confirmed on Solana. Please wait and retry claim status shortly.",
      };
    }

    const updatedSteps = updateStepsWithMint(existingSteps, txSignature, false);
    updateTransaction(burnTxHash, {
      claimHash: txSignature,
      status: "claimed",
      bridgeState: "success",
      completedAt: new Date(),
      steps: updatedSteps,
    });

    toast({
      title: "USDC Claimed!",
      description: explorerUrl
        ? "Your USDC mint transaction is confirmed."
        : `Mint tx confirmed: ${txSignature.slice(0, 20)}...`,
    });

    return { success: true, mintTxHash: txSignature };
  } catch (error: unknown) {
    return handleSolanaMintError(
      error,
      burnTxHash,
      existingSteps,
      updateTransaction,
      toast,
      attestationNonce
    );
  }
}
