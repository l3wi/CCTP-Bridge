/**
 * Solana CCTP v2 burn transaction builder.
 * Bypasses Bridge Kit SDK to avoid WebSocket confirmation hangs.
 * Builds depositForBurn instruction using Anchor.
 */

import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import type { ChainId, SolanaChainId } from "../types";
import {
  getCctpDomain,
  getSolanaUsdcMint,
  formatMintRecipientPubkey,
  FINALITY_THRESHOLDS,
} from "../shared";

// =============================================================================
// Program IDs
// =============================================================================

/** CCTP V2 Token Messenger Program ID (same for mainnet and devnet) */
export const TOKEN_MESSENGER_PROGRAM_ID = new PublicKey(
  "CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe"
);

/** CCTP V2 Message Transmitter Program ID */
export const MESSAGE_TRANSMITTER_PROGRAM_ID = new PublicKey(
  "CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC"
);

// =============================================================================
// PDA Derivation
// =============================================================================

interface DerivedPdas {
  senderAuthorityPda: PublicKey;
  tokenMessengerPda: PublicKey;
  tokenMinterPda: PublicKey;
  localTokenPda: PublicKey;
  messageTransmitterPda: PublicKey;
  remoteTokenMessengerPda: PublicKey;
}

/**
 * Derive all required PDAs for CCTP depositForBurn instruction.
 */
export function deriveBurnPdas(
  destinationDomain: number,
  usdcMint: PublicKey
): DerivedPdas {
  const [senderAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("sender_authority")],
    TOKEN_MESSENGER_PROGRAM_ID
  );

  const [tokenMessengerPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_messenger")],
    TOKEN_MESSENGER_PROGRAM_ID
  );

  const [tokenMinterPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_minter")],
    TOKEN_MESSENGER_PROGRAM_ID
  );

  const [localTokenPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("local_token"), usdcMint.toBuffer()],
    TOKEN_MESSENGER_PROGRAM_ID
  );

  const [messageTransmitterPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("message_transmitter")],
    MESSAGE_TRANSMITTER_PROGRAM_ID
  );

  // Domain seed as UTF-8 string (matches Bridge Kit SDK)
  const domainSeed = Buffer.from(destinationDomain.toString(), "utf8");
  const [remoteTokenMessengerPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("remote_token_messenger"), domainSeed],
    TOKEN_MESSENGER_PROGRAM_ID
  );

  return {
    senderAuthorityPda,
    tokenMessengerPda,
    tokenMinterPda,
    localTokenPda,
    messageTransmitterPda,
    remoteTokenMessengerPda,
  };
}

// =============================================================================
// Transaction Building
// =============================================================================

export interface SolanaBurnParams {
  connection: Connection;
  user: PublicKey;
  amount: bigint;
  destinationChainId: ChainId;
  mintRecipient: string;
  maxFee: bigint;
  minFinalityThreshold: number;
  sourceChainId: SolanaChainId;
}

export interface SolanaBurnResult {
  transaction: Transaction;
  messageAccount: Keypair;
}

/**
 * Build a CCTP depositForBurn transaction for Solana.
 * Uses Anchor to load program IDL from chain.
 */
export async function buildDepositForBurnTransaction(
  params: SolanaBurnParams
): Promise<SolanaBurnResult> {
  const {
    connection,
    user,
    amount,
    destinationChainId,
    mintRecipient,
    maxFee,
    minFinalityThreshold,
    sourceChainId,
  } = params;

  const destinationDomain = getCctpDomain(destinationChainId);
  const usdcMint = getSolanaUsdcMint(sourceChainId);
  const pdas = deriveBurnPdas(destinationDomain, usdcMint);

  // Get user's USDC ATA
  const userUsdcAta = await getAssociatedTokenAddress(usdcMint, user);

  // Generate keypair for message event data account
  const messageAccount = Keypair.generate();

  // Create minimal wallet wrapper for Anchor (only used to build instructions)
  const wallet = {
    publicKey: user,
    signTransaction: async <T>(tx: T): Promise<T> => tx,
    signAllTransactions: async <T>(txs: T[]): Promise<T[]> => txs,
  };

  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  // Load Token Messenger program from chain (IDL fetched automatically)
  const tokenMessenger = await Program.at(TOKEN_MESSENGER_PROGRAM_ID, provider);

  // Format mint recipient as PublicKey (handles both EVM and Solana destinations)
  const mintRecipientKey = formatMintRecipientPubkey(
    mintRecipient,
    destinationChainId
  );

  // Fund message account for rent (~0.0039 SOL)
  // This is a refundable rent deposit, not a fee
  // Account size: ~250 bytes (8 discriminator + 32 emitter + ~200 message data)
  const MESSAGE_ACCOUNT_SIZE = 250;
  const RENT_FALLBACK = 3_900_000; // Conservative fallback if RPC fails

  let rentExemptLamports: number;
  try {
    rentExemptLamports = await connection.getMinimumBalanceForRentExemption(MESSAGE_ACCOUNT_SIZE);
  } catch {
    // Use conservative fallback if RPC call fails
    rentExemptLamports = RENT_FALLBACK;
  }

  const fundMessageAccountIx = SystemProgram.transfer({
    fromPubkey: user,
    toPubkey: messageAccount.publicKey,
    lamports: rentExemptLamports,
  });

  /**
   * Build depositForBurn instruction using Anchor.
   * Cast required: Anchor generates methods dynamically from IDL at runtime.
   * TypeScript cannot infer these methods from the Program type.
   * The method signature is validated by the IDL, not compile-time types.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const depositForBurnIx = await (tokenMessenger.methods as any)
    .depositForBurn({
      amount: new BN(amount.toString()),
      destinationDomain,
      mintRecipient: mintRecipientKey,
      destinationCaller: PublicKey.default, // No specific caller restriction
      maxFee: new BN(maxFee.toString()),
      minFinalityThreshold,
    })
    .accounts({
      owner: user,
      senderAuthorityPda: pdas.senderAuthorityPda,
      burnTokenAccount: userUsdcAta,
      burnTokenMint: usdcMint,
      tokenMessenger: pdas.tokenMessengerPda,
      tokenMinter: pdas.tokenMinterPda,
      localToken: pdas.localTokenPda,
      remoteTokenMessenger: pdas.remoteTokenMessengerPda,
      messageTransmitter: pdas.messageTransmitterPda,
      messageSentEventData: messageAccount.publicKey,
      eventRentPayer: user,
      messageTransmitterProgram: MESSAGE_TRANSMITTER_PROGRAM_ID,
      tokenMessengerMinterProgram: TOKEN_MESSENGER_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([messageAccount])
    .instruction();

  // Build transaction
  const transaction = new Transaction().add(fundMessageAccountIx, depositForBurnIx);

  // Get recent blockhash
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  transaction.feePayer = user;

  return { transaction, messageAccount };
}

// =============================================================================
// Transaction Sending
// =============================================================================

/**
 * Send a signed transaction WITHOUT waiting for confirmation.
 * Returns the signature immediately after sending.
 *
 * This avoids WebSocket confirmation hangs that occur with
 * connection.confirmTransaction() on some RPC providers.
 */
export async function sendTransactionNoConfirm(
  connection: Connection,
  signedTransaction: Transaction
): Promise<string> {
  const rawTransaction = signedTransaction.serialize();

  try {
    // Send without confirming - returns immediately
    const signature = await connection.sendRawTransaction(rawTransaction, {
      skipPreflight: false, // Still do preflight simulation to catch errors
      preflightCommitment: "confirmed",
    });

    return signature;
  } catch (error) {
    // Provide user-friendly messages for common preflight errors
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("insufficient funds") || message.includes("Insufficient")) {
      throw new Error("Insufficient SOL for transaction fees");
    }
    if (message.includes("insufficient lamports")) {
      throw new Error("Insufficient SOL balance for rent deposit");
    }
    if (message.includes("TokenAccountNotFoundError") || message.includes("could not find account")) {
      throw new Error("USDC token account not found. Please ensure you have USDC in your wallet.");
    }
    if (message.includes("InsufficientFunds") || message.includes("insufficient token")) {
      throw new Error("Insufficient USDC balance for this transfer");
    }
    if (message.includes("blockhash not found") || message.includes("BlockhashNotFound")) {
      throw new Error("Transaction expired. Please try again.");
    }

    // Re-throw with original message for unhandled errors
    throw error;
  }
}

// =============================================================================
// High-Level Burn Helpers
// =============================================================================

export interface SolanaBurnConfig {
  sourceChainId: SolanaChainId;
  destinationChainId: ChainId;
  amount: bigint;
  recipientAddress: string;
  transferSpeed: "fast" | "standard";
}

/**
 * Prepare Solana burn parameters.
 * Returns configuration needed for buildDepositForBurnTransaction.
 */
export function prepareSolanaBurn(config: SolanaBurnConfig): {
  destinationDomain: number;
  minFinalityThreshold: number;
} {
  const destinationDomain = getCctpDomain(config.destinationChainId);

  const minFinalityThreshold =
    config.transferSpeed === "fast"
      ? FINALITY_THRESHOLDS.solana.fast
      : FINALITY_THRESHOLDS.solana.standard;

  return {
    destinationDomain,
    minFinalityThreshold,
  };
}

// Re-export shared utilities for convenience
export {
  getCctpDomain,
  getSolanaUsdcMint,
  formatMintRecipientPubkey,
  FINALITY_THRESHOLDS,
} from "../shared";
