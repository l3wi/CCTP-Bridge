import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { getSolanaUsdcMint } from "../shared";
import type { SolanaChainId } from "../types";

export type RecoveredSolanaRecipientVerification =
  | { ok: true; recipientAddress: string }
  | { ok: false; warning: string };

export function verifyRecoveredSolanaRecipient(params: {
  candidateRecipientAddress: string;
  mintRecipientAta: string | undefined;
  destinationChainId: SolanaChainId;
}): RecoveredSolanaRecipientVerification {
  const { candidateRecipientAddress, mintRecipientAta, destinationChainId } = params;

  if (!mintRecipientAta) {
    return {
      ok: false,
      warning: "Transaction data incomplete - Solana recipient token account not available",
    };
  }

  if (!candidateRecipientAddress) {
    return {
      ok: false,
      warning:
        "Enter the recipient Solana wallet owner. A helper wallet can add the transfer and pay claim fees, but the recipient ATA must match Circle's message.",
    };
  }

  try {
    const usdcMint = getSolanaUsdcMint(destinationChainId);
    const recipientOwner = new PublicKey(candidateRecipientAddress);
    const derivedAta = getAssociatedTokenAddressSync(usdcMint, recipientOwner);

    if (derivedAta.toBase58() !== mintRecipientAta) {
      return {
        ok: false,
        warning:
          "That Solana wallet's USDC token account does not match the recipient encoded in Circle's message. Enter the actual recipient wallet owner.",
      };
    }

    return {
      ok: true,
      recipientAddress: recipientOwner.toBase58(),
    };
  } catch {
    return {
      ok: false,
      warning:
        "Enter a valid Solana recipient wallet address. Do not enter the USDC token account address from Iris.",
    };
  }
}
