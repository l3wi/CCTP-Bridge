import type { Connection, PublicKey } from "@solana/web3.js";
import type { MintParams, UniversalTxHash } from "../../types";

const SOLANA_MINT_CONFIRMATION_TIMEOUT_MS = 45_000;
const SOLANA_MINT_CONFIRMATION_POLL_MS = 2_000;
const SOLANA_ATA_READY_TIMEOUT_MS = 20_000;
const SOLANA_ATA_READY_POLL_MS = 1_000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const normalizeAddress = (address: string | undefined): string | undefined => {
  const trimmed = address?.trim();
  return trimmed ? trimmed : undefined;
};

export const markMintStepPending = (
  existingSteps: MintParams["existingSteps"],
  mintTxHash: UniversalTxHash
): MintParams["existingSteps"] => {
  const steps = existingSteps ? [...existingSteps] : [];
  const mintIndex = steps.findIndex((step) => /mint|claim|receive/i.test(step.name));

  const pendingMintStep = {
    name: "Mint",
    state: "pending" as const,
    txHash: mintTxHash,
  };

  if (mintIndex >= 0) {
    steps[mintIndex] = {
      ...steps[mintIndex],
      ...pendingMintStep,
    };
  } else {
    steps.push(pendingMintStep);
  }

  return steps;
};

export async function waitForSolanaMintConfirmation(
  connection: Connection,
  signature: string
): Promise<boolean> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < SOLANA_MINT_CONFIRMATION_TIMEOUT_MS) {
    try {
      const statusResponse = await connection.getSignatureStatuses(
        [signature],
        { searchTransactionHistory: true }
      );
      const status = statusResponse.value[0];

      if (status?.err) {
        return false;
      }

      if (
        status?.confirmationStatus === "confirmed" ||
        status?.confirmationStatus === "finalized"
      ) {
        return true;
      }
    } catch (error) {
      console.warn("[useMint] Failed to read Solana signature status:", error);
    }

    await sleep(SOLANA_MINT_CONFIRMATION_POLL_MS);
  }

  return false;
}

export async function waitForSolanaAccount(
  connection: Connection,
  account: PublicKey
): Promise<boolean> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < SOLANA_ATA_READY_TIMEOUT_MS) {
    try {
      const accountInfo = await connection.getAccountInfo(account, "confirmed");
      if (accountInfo) {
        return true;
      }
    } catch (error) {
      console.warn("[useMint] Failed to check Solana account readiness:", error);
    }

    await sleep(SOLANA_ATA_READY_POLL_MS);
  }

  return false;
}
