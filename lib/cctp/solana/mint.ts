/**
 * Solana CCTP v2 receiveMessage transaction builder.
 * Bypasses Bridge Kit SDK to avoid WebSocket confirmation hangs.
 * Matches the exact implementation from @circle-fin/adapter-solana.
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  AddressLookupTableAccount,
  SystemProgram,
  AccountMeta,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { Program, AnchorProvider, utils } from "@coral-xyz/anchor";
import { getSolanaUsdcMint, getCctpAltAddress } from "../shared";
import type { SolanaChainId } from "../types";

// =============================================================================
// Program IDs
// =============================================================================

/** CCTP v2 MessageTransmitter Program ID (same for mainnet and devnet) */
export const MESSAGE_TRANSMITTER_PROGRAM_ID = new PublicKey(
  "CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC"
);

/** CCTP v2 TokenMessenger Program ID (same for mainnet and devnet) */
export const TOKEN_MESSENGER_PROGRAM_ID = new PublicKey(
  "CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe"
);

// =============================================================================
// Source USDC Addresses (EVM)
// =============================================================================

/**
 * Source USDC addresses by CCTP domain (EVM addresses as hex).
 * Used for token pair PDA derivation.
 */
const SOURCE_USDC_BY_DOMAIN: Record<number, string> = {
  // Mainnet domains
  0: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // Ethereum Mainnet USDC
  1: "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e", // Avalanche USDC
  2: "0x0b2c639c533813f4aa9d7837caf62653d097ff85", // Optimism USDC
  3: "0xaf88d065e77c8cc2239327c5edb3a432268e5831", // Arbitrum USDC
  6: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // Base USDC
  7: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359", // Polygon USDC
};

/** Testnet source USDC addresses by CCTP domain */
const SOURCE_USDC_BY_DOMAIN_TESTNET: Record<number, string> = {
  0: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", // Ethereum Sepolia USDC
  1: "0x5425890298aed601595a70AB815c96711a31Bc65", // Avalanche Fuji USDC
  2: "0x5fd84259d66Cd46123540766Be93DFE6D43130D7", // Optimism Sepolia USDC
  3: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d", // Arbitrum Sepolia USDC
  6: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // Base Sepolia USDC
  7: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582", // Polygon Amoy USDC
};

// =============================================================================
// Address Conversion
// =============================================================================

/**
 * Convert EVM address to 32-byte pubkey for Solana.
 * Left-pads the 20-byte EVM address with zeros to 32 bytes.
 */
function evmAddressToSolanaPubkey(evmAddress: string): PublicKey {
  const cleanAddress = evmAddress.toLowerCase().replace("0x", "");
  const padded = cleanAddress.padStart(64, "0");
  return new PublicKey(Buffer.from(padded, "hex"));
}

/**
 * Get source USDC address as Solana pubkey for a CCTP domain.
 */
function getSourceUsdcPubkey(
  sourceDomain: number,
  isTestnet: boolean
): PublicKey {
  const addresses = isTestnet
    ? SOURCE_USDC_BY_DOMAIN_TESTNET
    : SOURCE_USDC_BY_DOMAIN;
  const address = addresses[sourceDomain];
  if (!address) {
    throw new Error(`Unknown source USDC address for domain ${sourceDomain}`);
  }
  return evmAddressToSolanaPubkey(address);
}

// =============================================================================
// PDA Derivation
// =============================================================================

interface MintPdas {
  tokenMessengerPda: PublicKey;
  messageTransmitterPda: PublicKey;
  tokenMinterPda: PublicKey;
  localTokenPda: PublicKey;
  remoteTokenMessengerPda: PublicKey;
  tokenPairPda: PublicKey;
  custodyPda: PublicKey;
  messageTransmitterAuthorityPda: PublicKey;
  eventAuthorityPda: PublicKey;
}

/**
 * Derive all required PDAs for CCTP receiveMessage.
 * Matches the derivePdas function from adapter-solana.
 */
function deriveMintPdas(
  sourceDomain: number,
  sourceUsdcPubkey: PublicKey,
  destinationUsdcMint: PublicKey
): MintPdas {
  const [tokenMessengerPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_messenger")],
    TOKEN_MESSENGER_PROGRAM_ID
  );

  const [messageTransmitterPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("message_transmitter")],
    MESSAGE_TRANSMITTER_PROGRAM_ID
  );

  const [tokenMinterPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_minter")],
    TOKEN_MESSENGER_PROGRAM_ID
  );

  const [localTokenPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("local_token"), destinationUsdcMint.toBuffer()],
    TOKEN_MESSENGER_PROGRAM_ID
  );

  // Domain seed as UTF-8 string (matches Bridge Kit)
  const domainSeed = Buffer.from(sourceDomain.toString(), "utf8");

  const [remoteTokenMessengerPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("remote_token_messenger"), domainSeed],
    TOKEN_MESSENGER_PROGRAM_ID
  );

  // tokenPairPda uses the source USDC pubkey buffer (32 bytes)
  const [tokenPairPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_pair"), domainSeed, sourceUsdcPubkey.toBuffer()],
    TOKEN_MESSENGER_PROGRAM_ID
  );

  const [custodyPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("custody"), destinationUsdcMint.toBuffer()],
    TOKEN_MESSENGER_PROGRAM_ID
  );

  // messageTransmitterAuthorityPda - includes tokenMessenger program ID
  const [messageTransmitterAuthorityPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("message_transmitter_authority"),
      TOKEN_MESSENGER_PROGRAM_ID.toBuffer(),
    ],
    MESSAGE_TRANSMITTER_PROGRAM_ID
  );

  // Event authority PDA for remaining accounts
  const [eventAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    TOKEN_MESSENGER_PROGRAM_ID
  );

  return {
    tokenMessengerPda,
    messageTransmitterPda,
    tokenMinterPda,
    localTokenPda,
    remoteTokenMessengerPda,
    tokenPairPda,
    custodyPda,
    messageTransmitterAuthorityPda,
    eventAuthorityPda,
  };
}

// =============================================================================
// Nonce PDA Derivation
// =============================================================================

/**
 * Derive the usedNonce PDA from eventNonce.
 * eventNonce is a 64-char hex string (32 bytes) from the attestation.
 */
export function deriveUsedNoncePda(eventNonce: string): PublicKey {
  const nonceHex = eventNonce.replace(/^0x/, "");
  if (nonceHex.length !== 64) {
    throw new Error(
      `Invalid eventNonce: expected 64 hex chars, got ${nonceHex.length}`
    );
  }
  const nonceBuf = Buffer.from(nonceHex, "hex");

  const [usedNoncePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("used_nonce"), nonceBuf],
    MESSAGE_TRANSMITTER_PROGRAM_ID
  );

  return usedNoncePda;
}

/**
 * Extract eventNonce from CCTP message bytes.
 * Message format: version(4) + sourceDomain(4) + destinationDomain(4) + nonce(32) + ...
 * Nonce is at bytes 12-44 (0-indexed).
 */
export function extractEventNonceFromMessage(message: string): string {
  const hex = message.replace(/^0x/, "");
  // Nonce is at byte offset 12, length 32 bytes = 64 hex chars
  const nonceStart = 12 * 2;
  const nonceEnd = nonceStart + 32 * 2;
  return hex.slice(nonceStart, nonceEnd);
}

// =============================================================================
// Transaction Building
// =============================================================================

export interface SolanaMintParams {
  connection: Connection;
  /** User wallet pubkey (payer/signer) */
  user: PublicKey;
  /** CCTP message hex string */
  message: string;
  /** Attestation hex string */
  attestation: string;
  /** CCTP source domain (from EVM chain) */
  sourceDomain: number;
  /** Destination Solana chain */
  destinationChainId: SolanaChainId;
  /** Whether using testnet */
  isTestnet: boolean;
  /**
   * The mintRecipient from attestation data (token account where USDC is minted).
   * This is the ATA that was encoded during burn - MUST match what's in the message.
   * If not provided, will compute from user's wallet (may cause "Invalid mint recipient" error).
   */
  mintRecipient?: string;
}

/**
 * Build a CCTP receiveMessage transaction.
 * Uses VersionedTransaction with Address Lookup Tables to reduce transaction size.
 *
 * Returns VersionedTransaction which must be signed with wallet.signTransaction().
 */
export async function buildReceiveMessageTransaction(
  params: SolanaMintParams
): Promise<VersionedTransaction> {
  const {
    connection,
    user,
    message,
    attestation,
    sourceDomain,
    destinationChainId,
    isTestnet,
    mintRecipient,
  } = params;

  const usdcMint = getSolanaUsdcMint(destinationChainId);
  const sourceUsdcPubkey = getSourceUsdcPubkey(sourceDomain, isTestnet);
  const pdas = deriveMintPdas(sourceDomain, sourceUsdcPubkey, usdcMint);

  // Extract eventNonce from message (32 bytes at offset 12)
  const eventNonce = extractEventNonceFromMessage(message);
  const usedNoncePda = deriveUsedNoncePda(eventNonce);

  // Compute the connected user's ATA
  const computedUserAta = utils.token.associatedAddress({
    mint: usdcMint,
    owner: user,
  });

  // If mintRecipient is provided from attestation, verify it matches user's ATA
  // This ensures the user connected with the same wallet they specified during burn
  let userUsdcAta: PublicKey;
  let ataOwner: PublicKey;

  if (mintRecipient) {
    const attestationAta = new PublicKey(mintRecipient);
    // Check if the attestation's mintRecipient matches user's computed ATA
    if (!computedUserAta.equals(attestationAta)) {
      const expectedTrunc = attestationAta.toBase58().slice(0, 15) + "...";
      const yourTrunc = computedUserAta.toBase58().slice(0, 15) + "...";
      throw new Error(
        `Connect the recipient wallet to claim USDC. Your ATA: ${yourTrunc} Expected: ${expectedTrunc}`
      );
    }
    userUsdcAta = attestationAta;
    ataOwner = user; // We verified user's ATA matches, so user is the owner
  } else {
    // No mintRecipient from attestation, use computed ATA
    userUsdcAta = computedUserAta;
    ataOwner = user;
  }

  // Create minimal wallet wrapper for Anchor
  const wallet = {
    publicKey: user,
    signTransaction: async <T>(tx: T): Promise<T> => tx,
    signAllTransactions: async <T>(txs: T[]): Promise<T[]> => txs,
  };

  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  // Load programs from chain
  const [tokenMessengerProgram, messageTransmitterProgram] = await Promise.all([
    Program.at(TOKEN_MESSENGER_PROGRAM_ID, provider),
    Program.at(MESSAGE_TRANSMITTER_PROGRAM_ID, provider),
  ]);

  // Fetch feeRecipient from on-chain tokenMessenger state
  const tokenMessengerState = await (
    tokenMessengerProgram.account as Record<
      string,
      { fetch: (key: PublicKey) => Promise<{ feeRecipient: PublicKey }> }
    >
  ).tokenMessenger.fetch(pdas.tokenMessengerPda);
  const feeRecipient = tokenMessengerState.feeRecipient;

  // Get fee recipient's USDC ATA
  const feeRecipientAta = utils.token.associatedAddress({
    mint: usdcMint,
    owner: feeRecipient,
  });

  // Convert message and attestation to buffers
  const messageBuffer = Buffer.from(message.replace(/^0x/, ""), "hex");
  const attestationBuffer = Buffer.from(attestation.replace(/^0x/, ""), "hex");

  // Build remaining accounts (matches Bridge Kit exactly)
  const remainingAccounts: AccountMeta[] = [
    { pubkey: pdas.tokenMessengerPda, isSigner: false, isWritable: false },
    {
      pubkey: pdas.remoteTokenMessengerPda,
      isSigner: false,
      isWritable: false,
    },
    { pubkey: pdas.tokenMinterPda, isSigner: false, isWritable: true },
    { pubkey: pdas.localTokenPda, isSigner: false, isWritable: true },
    { pubkey: pdas.tokenPairPda, isSigner: false, isWritable: false },
    { pubkey: feeRecipientAta, isSigner: false, isWritable: true },
    { pubkey: userUsdcAta, isSigner: false, isWritable: true },
    { pubkey: pdas.custodyPda, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: pdas.eventAuthorityPda, isSigner: false, isWritable: false },
    { pubkey: TOKEN_MESSENGER_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // Build receiveMessage instruction using Anchor
  const receiveMessageIx = await (
    messageTransmitterProgram.methods as Record<
      string,
      (params: {
        message: Buffer;
        attestation: Buffer;
      }) => {
        accounts: (accounts: Record<string, PublicKey>) => {
          remainingAccounts: (
            accounts: AccountMeta[]
          ) => { instruction: () => Promise<unknown> };
        };
      }
    >
  )
    .receiveMessage({
      message: messageBuffer,
      attestation: attestationBuffer,
    })
    .accounts({
      payer: user,
      caller: user,
      authorityPda: pdas.messageTransmitterAuthorityPda,
      messageTransmitter: pdas.messageTransmitterPda,
      usedNonce: usedNoncePda,
      receiver: TOKEN_MESSENGER_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(remainingAccounts)
    .instruction();

  // Build instructions array
  const instructions: TransactionInstruction[] = [];

  // Check if ATA exists, create if needed
  const userAtaInfo = await connection.getAccountInfo(userUsdcAta);
  if (!userAtaInfo) {
    // We verified the user's wallet matches the mintRecipient's owner, so we can create the ATA
    const createAtaIx = createAssociatedTokenAccountInstruction(
      user, // payer
      userUsdcAta, // ata
      ataOwner, // owner (verified to be the correct owner)
      usdcMint // mint
    );
    instructions.push(createAtaIx);
  }

  instructions.push(receiveMessageIx as TransactionInstruction);

  // Get recent blockhash
  const { blockhash } = await connection.getLatestBlockhash("confirmed");

  // Fetch Address Lookup Table if configured (reduces transaction size)
  const lookupTables: AddressLookupTableAccount[] = [];
  const altAddress = getCctpAltAddress(destinationChainId);
  if (altAddress) {
    const altAccountInfo = await connection.getAddressLookupTable(altAddress);
    if (altAccountInfo.value) {
      lookupTables.push(altAccountInfo.value);
    }
  }

  // Build versioned transaction message
  const messageV0 = new TransactionMessage({
    payerKey: user,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message(lookupTables.length > 0 ? lookupTables : undefined);

  // Return versioned transaction (unsigned - wallet will sign)
  return new VersionedTransaction(messageV0);
}

// =============================================================================
// Transaction Sending
// =============================================================================

/**
 * Send a signed versioned transaction WITHOUT waiting for confirmation.
 * Returns the signature immediately after sending.
 * This avoids WebSocket confirmation hangs in the browser.
 */
export async function sendTransactionNoConfirm(
  connection: Connection,
  signedTransaction: VersionedTransaction
): Promise<string> {
  const rawTransaction = signedTransaction.serialize();

  const signature = await connection.sendRawTransaction(rawTransaction, {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });

  return signature;
}

// =============================================================================
// Legacy Transaction Support (for backward compatibility)
// =============================================================================

/**
 * Build a legacy Transaction for cases where VersionedTransaction isn't supported.
 * @deprecated Use buildReceiveMessageTransaction instead
 */
export async function buildReceiveMessageLegacyTransaction(
  params: SolanaMintParams
): Promise<Transaction> {
  const {
    connection,
    user,
    message,
    attestation,
    sourceDomain,
    destinationChainId,
    isTestnet,
    mintRecipient,
  } = params;

  const usdcMint = getSolanaUsdcMint(destinationChainId);
  const sourceUsdcPubkey = getSourceUsdcPubkey(sourceDomain, isTestnet);
  const pdas = deriveMintPdas(sourceDomain, sourceUsdcPubkey, usdcMint);

  const eventNonce = extractEventNonceFromMessage(message);
  const usedNoncePda = deriveUsedNoncePda(eventNonce);

  // Compute the connected user's ATA
  const computedUserAta = utils.token.associatedAddress({
    mint: usdcMint,
    owner: user,
  });

  // Verify mintRecipient matches user's ATA (if provided)
  let userUsdcAta: PublicKey;
  let ataOwner: PublicKey;

  if (mintRecipient) {
    const attestationAta = new PublicKey(mintRecipient);
    if (!computedUserAta.equals(attestationAta)) {
      const expectedTrunc = attestationAta.toBase58().slice(0, 15) + "...";
      const yourTrunc = computedUserAta.toBase58().slice(0, 15) + "...";
      throw new Error(
        `Connect the recipient wallet to claim USDC. Your ATA: ${yourTrunc} Expected: ${expectedTrunc}`
      );
    }
    userUsdcAta = attestationAta;
    ataOwner = user;
  } else {
    userUsdcAta = computedUserAta;
    ataOwner = user;
  }

  const wallet = {
    publicKey: user,
    signTransaction: async <T>(tx: T): Promise<T> => tx,
    signAllTransactions: async <T>(txs: T[]): Promise<T[]> => txs,
  };

  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  const [tokenMessengerProgram, messageTransmitterProgram] = await Promise.all([
    Program.at(TOKEN_MESSENGER_PROGRAM_ID, provider),
    Program.at(MESSAGE_TRANSMITTER_PROGRAM_ID, provider),
  ]);

  const tokenMessengerState = await (
    tokenMessengerProgram.account as Record<
      string,
      { fetch: (key: PublicKey) => Promise<{ feeRecipient: PublicKey }> }
    >
  ).tokenMessenger.fetch(pdas.tokenMessengerPda);
  const feeRecipient = tokenMessengerState.feeRecipient;

  const feeRecipientAta = utils.token.associatedAddress({
    mint: usdcMint,
    owner: feeRecipient,
  });

  const messageBuffer = Buffer.from(message.replace(/^0x/, ""), "hex");
  const attestationBuffer = Buffer.from(attestation.replace(/^0x/, ""), "hex");

  const remainingAccounts: AccountMeta[] = [
    { pubkey: pdas.tokenMessengerPda, isSigner: false, isWritable: false },
    { pubkey: pdas.remoteTokenMessengerPda, isSigner: false, isWritable: false },
    { pubkey: pdas.tokenMinterPda, isSigner: false, isWritable: true },
    { pubkey: pdas.localTokenPda, isSigner: false, isWritable: true },
    { pubkey: pdas.tokenPairPda, isSigner: false, isWritable: false },
    { pubkey: feeRecipientAta, isSigner: false, isWritable: true },
    { pubkey: userUsdcAta, isSigner: false, isWritable: true },
    { pubkey: pdas.custodyPda, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: pdas.eventAuthorityPda, isSigner: false, isWritable: false },
    { pubkey: TOKEN_MESSENGER_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const receiveMessageIx = await (
    messageTransmitterProgram.methods as Record<
      string,
      (params: { message: Buffer; attestation: Buffer }) => {
        accounts: (accounts: Record<string, PublicKey>) => {
          remainingAccounts: (accounts: AccountMeta[]) => {
            instruction: () => Promise<unknown>;
          };
        };
      }
    >
  )
    .receiveMessage({ message: messageBuffer, attestation: attestationBuffer })
    .accounts({
      payer: user,
      caller: user,
      authorityPda: pdas.messageTransmitterAuthorityPda,
      messageTransmitter: pdas.messageTransmitterPda,
      usedNonce: usedNoncePda,
      receiver: TOKEN_MESSENGER_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(remainingAccounts)
    .instruction();

  const transaction = new Transaction();

  const userAtaInfo = await connection.getAccountInfo(userUsdcAta);
  if (!userAtaInfo) {
    // Create ATA if it doesn't exist (we verified ownership above)
    transaction.add(
      createAssociatedTokenAccountInstruction(user, userUsdcAta, ataOwner, usdcMint)
    );
  }

  transaction.add(receiveMessageIx as TransactionInstruction);

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  transaction.feePayer = user;

  return transaction;
}

/**
 * Send a signed legacy transaction WITHOUT waiting for confirmation.
 */
export async function sendLegacyTransactionNoConfirm(
  connection: Connection,
  signedTransaction: Transaction
): Promise<string> {
  const rawTransaction = signedTransaction.serialize();
  return connection.sendRawTransaction(rawTransaction, {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
}
