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
  SystemProgram,
  AccountMeta,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { getSolanaUsdcMint } from "../shared";
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

/**
 * Anchor instruction discriminator for "receive_message".
 * Computed as first 8 bytes of SHA256("global:receive_message").
 * Pre-computed to avoid crypto dependency and Anchor method builder issues.
 */
const RECEIVE_MESSAGE_DISCRIMINATOR = Buffer.from([
  0x26, 0x90, 0x7f, 0xe1, 0x1f, 0xe1, 0xee, 0x19,
]);

// =============================================================================
// Instruction Data Serialization
// =============================================================================

/**
 * Serialize receiveMessage instruction data manually using Borsh format.
 * This avoids Anchor's method builder which has buffer size issues with large Vec<u8>.
 *
 * Format: [8-byte discriminator][4-byte msg len][msg bytes][4-byte att len][att bytes]
 */
function serializeReceiveMessageData(
  message: Buffer,
  attestation: Buffer
): Buffer {
  // Calculate total size: discriminator + length prefixes + data
  const totalSize = 8 + 4 + message.length + 4 + attestation.length;
  const data = Buffer.alloc(totalSize);
  let offset = 0;

  // Write discriminator (8 bytes)
  RECEIVE_MESSAGE_DISCRIMINATOR.copy(data, offset);
  offset += 8;

  // Write message as Vec<u8>: length (u32 LE) + bytes
  data.writeUInt32LE(message.length, offset);
  offset += 4;
  message.copy(data, offset);
  offset += message.length;

  // Write attestation as Vec<u8>: length (u32 LE) + bytes
  data.writeUInt32LE(attestation.length, offset);
  offset += 4;
  attestation.copy(data, offset);

  return data;
}

// =============================================================================
// On-Chain State Fetching
// =============================================================================

/**
 * Fetch the feeRecipient from the on-chain TokenMessenger state.
 * Uses Anchor for account deserialization (only account reading, not instruction building).
 */
async function fetchFeeRecipient(
  connection: Connection,
  tokenMessengerPda: PublicKey
): Promise<PublicKey> {
  // Dynamic import to avoid Anchor in the main instruction path
  const { Program, AnchorProvider } = await import("@coral-xyz/anchor");

  // Create minimal wallet wrapper (only used for provider, no signing)
  const wallet = {
    publicKey: PublicKey.default,
    signTransaction: async <T>(tx: T): Promise<T> => tx,
    signAllTransactions: async <T>(txs: T[]): Promise<T[]> => txs,
  };

  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  // Load TokenMessenger program to read account state
  const tokenMessengerProgram = await Program.at(
    TOKEN_MESSENGER_PROGRAM_ID,
    provider
  );

  // Fetch feeRecipient from on-chain state
  const tokenMessengerState = await (
    tokenMessengerProgram.account as Record<
      string,
      { fetch: (key: PublicKey) => Promise<{ feeRecipient: PublicKey }> }
    >
  ).tokenMessenger.fetch(tokenMessengerPda);

  return tokenMessengerState.feeRecipient;
}

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
  /** User wallet pubkey */
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
  /** Optional recipient address (defaults to user) */
  destinationAddress?: string;
}

/**
 * Build a CCTP receiveMessage transaction.
 * Uses manual instruction serialization to avoid Anchor's buffer size limits
 * with large Vec<u8> parameters (message ~285 bytes, attestation ~130 bytes).
 */
export async function buildReceiveMessageTransaction(
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
    destinationAddress,
  } = params;

  const usdcMint = getSolanaUsdcMint(destinationChainId);
  const sourceUsdcPubkey = getSourceUsdcPubkey(sourceDomain, isTestnet);
  const pdas = deriveMintPdas(sourceDomain, sourceUsdcPubkey, usdcMint);

  // Extract eventNonce from message (32 bytes at offset 12)
  const eventNonce = extractEventNonceFromMessage(message);
  const usedNoncePda = deriveUsedNoncePda(eventNonce);

  // Fetch feeRecipient from on-chain tokenMessenger state
  const feeRecipient = await fetchFeeRecipient(connection, pdas.tokenMessengerPda);

  // Get fee recipient's USDC ATA
  const feeRecipientAta = await getAssociatedTokenAddress(usdcMint, feeRecipient);

  // Determine the mint recipient (token receiver)
  const mintRecipientOwner = destinationAddress
    ? new PublicKey(destinationAddress)
    : user;

  // Get user's USDC ATA
  const userUsdcAta = await getAssociatedTokenAddress(usdcMint, mintRecipientOwner);

  // Convert message and attestation to buffers
  const messageBuffer = Buffer.from(message.replace(/^0x/, ""), "hex");
  const attestationBuffer = Buffer.from(attestation.replace(/^0x/, ""), "hex");

  // Serialize instruction data manually to avoid Anchor's buffer size limits
  const instructionData = serializeReceiveMessageData(messageBuffer, attestationBuffer);

  // Build account keys for receiveMessage instruction
  // Order must match the program's instruction account layout exactly
  const keys: AccountMeta[] = [
    { pubkey: user, isSigner: true, isWritable: true }, // payer
    { pubkey: user, isSigner: true, isWritable: false }, // caller
    { pubkey: pdas.messageTransmitterAuthorityPda, isSigner: false, isWritable: false }, // authority_pda
    { pubkey: pdas.messageTransmitterPda, isSigner: false, isWritable: false }, // message_transmitter
    { pubkey: usedNoncePda, isSigner: false, isWritable: true }, // used_nonces
    { pubkey: TOKEN_MESSENGER_PROGRAM_ID, isSigner: false, isWritable: false }, // receiver
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
    // Remaining accounts for CPI to TokenMessengerMinter
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

  // Create receiveMessage instruction manually
  const receiveMessageIx = new TransactionInstruction({
    programId: MESSAGE_TRANSMITTER_PROGRAM_ID,
    keys,
    data: instructionData,
  });

  // Build transaction
  const transaction = new Transaction();

  // Check if user's ATA exists, create if needed
  const userAtaInfo = await connection.getAccountInfo(userUsdcAta);
  if (!userAtaInfo) {
    const createAtaIx = createAssociatedTokenAccountInstruction(
      user, // payer
      userUsdcAta, // ata
      mintRecipientOwner, // owner
      usdcMint // mint
    );
    transaction.add(createAtaIx);
  }

  transaction.add(receiveMessageIx);

  // Get recent blockhash
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  transaction.feePayer = user;

  return transaction;
}

// =============================================================================
// Transaction Sending
// =============================================================================

/**
 * Send a signed transaction WITHOUT waiting for confirmation.
 * Returns the signature immediately after sending.
 * This avoids WebSocket confirmation hangs in the browser.
 */
export async function sendTransactionNoConfirm(
  connection: Connection,
  signedTransaction: Transaction
): Promise<string> {
  const rawTransaction = signedTransaction.serialize();

  const signature = await connection.sendRawTransaction(rawTransaction, {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });

  return signature;
}
