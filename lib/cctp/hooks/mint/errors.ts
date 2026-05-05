import { parseEvmCctpError } from "../../evm/errors";
import { parseSolanaCctpError, extractCctpErrorCode } from "../../solana/errors";
import { updateStepsWithMint } from "../../steps";
import type { MintParams, MintResult, UniversalTxHash } from "../../types";
import { isUserRejection, extractErrorMessage } from "../../shared";
import type { LocalTransaction } from "@/lib/types";

export const ALREADY_CLAIMED_TOAST_TITLE = "USDC Successfully Claimed";
export const ALREADY_CLAIMED_TOAST_DESCRIPTION = "Check your wallet for the USDC.";

export type UpdateTransactionFn = (
  hash: UniversalTxHash,
  updates: Partial<LocalTransaction>
) => void;

export type ToastFn = (opts: { title: string; description: string }) => void;

export function handleEvmMintError(
  error: unknown,
  burnTxHash: UniversalTxHash,
  existingSteps: MintParams["existingSteps"],
  updateTransaction: UpdateTransactionFn,
  toast: ToastFn,
  attestationNonce?: string
): MintResult {
  const errorMessage = extractErrorMessage(error, 500);

  if (isUserRejection(error)) {
    return { success: false, error: "Transaction cancelled by user" };
  }

  console.error("EVM mint failed:", {
    ecosystem: "evm",
    burnTxHash,
    timestamp: new Date().toISOString(),
    errorMessage,
    shortMessage: (error as { shortMessage?: string })?.shortMessage,
    rawError: error,
  });

  const { info } = parseEvmCctpError(error);

  if (info) {
    console.warn(
      `[useMint] EVM CCTP error: ${info.title}\n` +
      `  Message: ${info.userMessage}`
    );

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

    if (info.needsReattestation) {
      return {
        success: false,
        messageExpired: true,
        nonce: attestationNonce,
        errorTitle: info.title,
        error: info.userMessage,
      };
    }

    return {
      success: false,
      errorTitle: info.title,
      error: info.userMessage,
    };
  }

  return {
    success: false,
    error: errorMessage,
  };
}

export function handleSolanaMintError(
  error: unknown,
  burnTxHash: UniversalTxHash,
  existingSteps: MintParams["existingSteps"],
  updateTransaction: UpdateTransactionFn,
  toast: ToastFn,
  attestationNonce?: string
): MintResult {
  if (isUserRejection(error)) {
    return { success: false, error: "Transaction cancelled by user" };
  }

  const errorMessage = extractErrorMessage(error, 500);
  const simLogs = (error as { simulationLogs?: string[] })?.simulationLogs ?? [];
  const txLogs = (error as { transactionLogs?: string[] })?.transactionLogs ?? [];
  const legacyLogs = (error as { logs?: string[] })?.logs ?? [];
  const allLogs = [...simLogs, ...txLogs, ...legacyLogs];
  const txMessage = (error as { transactionMessage?: string })?.transactionMessage ?? "";

  console.error("Solana mint failed:", {
    ecosystem: "solana",
    burnTxHash,
    timestamp: new Date().toISOString(),
    errorMessage,
    transactionMessage: txMessage,
    logs: allLogs.length > 0 ? allLogs : "(no logs captured)",
    rawError: error,
  });

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

  const { code, info } = parseSolanaCctpError(error);

  if (info) {
    console.warn(
      `[useMint] CCTP error 0x${code}: ${info.name}\n` +
      `  Title: ${info.title}\n` +
      `  Message: ${info.userMessage}\n` +
      `  Detail: ${info.detail}`
    );

    if (info.isExpired) {
      return {
        success: false,
        messageExpired: true,
        nonce: attestationNonce,
        errorTitle: info.title,
        error: info.userMessage,
      };
    }

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

    return {
      success: false,
      errorTitle: info.title,
      error: info.userMessage,
    };
  }

  const unknownCode = extractCctpErrorCode(allText);
  return {
    success: false,
    errorTitle: unknownCode ? `Error 0x${unknownCode}` : undefined,
    error: errorMessage,
  };
}
