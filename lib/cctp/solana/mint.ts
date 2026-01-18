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
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
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

/**
 * Anchor instruction discriminator for "receive_message".
 *
 * Computation: SHA256("global:receive_message").slice(0, 8)
 * Pre-computed to avoid crypto dependency and Anchor method builder issues.
 *
 * Verification (Node.js):
 *   const crypto = require("crypto");
 *   const hash = crypto.createHash("sha256").update("global:receive_message").digest();
 *   console.log(Array.from(hash.slice(0, 8)).map(b => "0x" + b.toString(16).padStart(2, "0")).join(", "));
 *   // Output: 0x26, 0x90, 0x7f, 0xe1, 0x1f, 0xe1, 0xee, 0x19
 *
 * Source: Circle CCTP v2 Solana contracts - MessageTransmitter program
 * @see https://github.com/circlefin/solana-cctp-contracts
 */
const RECEIVE_MESSAGE_DISCRIMINATOR = Buffer.from([
  0x26, 0x90, 0x7f, 0xe1, 0x1f, 0xe1, 0xee, 0x19,
]);

/**
 * Verify the discriminator matches the expected SHA256 hash in development mode.
 * This catches silent failures if the program is upgraded with a new discriminator.
 * Only runs once on module load in development.
 */
async function verifyDiscriminatorInDev(): Promise<void> {
  if (process.env.NODE_ENV === "production") return;

  try {
    // Use Web Crypto API (available in Node.js 15+ and browsers)
    const encoder = new TextEncoder();
    const data = encoder.encode("global:receive_message");
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = new Uint8Array(hashBuffer);
    const expected = hashArray.slice(0, 8);

    const matches = RECEIVE_MESSAGE_DISCRIMINATOR.every(
      (byte, i) => byte === expected[i]
    );

    if (!matches) {
      console.warn(
        "[CCTP] WARNING: receive_message discriminator mismatch!\n" +
        `Expected: ${Array.from(expected).map(b => "0x" + b.toString(16).padStart(2, "0")).join(", ")}\n` +
        `Got: ${Array.from(RECEIVE_MESSAGE_DISCRIMINATOR).map(b => "0x" + b.toString(16).padStart(2, "0")).join(", ")}\n` +
        "The CCTP program may have been upgraded. Update RECEIVE_MESSAGE_DISCRIMINATOR."
      );
    }
  } catch {
    // Silently ignore if crypto.subtle is not available (e.g., non-secure context)
  }
}

// Run verification on module load in development
verifyDiscriminatorInDev();

// =============================================================================
// Instruction Data Serialization
// =============================================================================

/**
 * Expected CCTP message size ranges for CCTP v2.
 *
 * Message structure:
 *   Header (148 bytes fixed):
 *     - version(4) + sourceDomain(4) + destinationDomain(4) + nonce(32)
 *     - sender(32) + recipient(32) + destinationCaller(32)
 *     - minFinalityThreshold(4) + finalityThresholdExecuted(4)
 *
 *   BurnMessage body (228+ bytes):
 *     - version(4) + burnToken(32) + mintRecipient(32) + amount(32)
 *     - messageSender(32) + maxFee(32) + feeExecuted(32) + expirationBlock(32)
 *     - hookData (variable length)
 *
 * With Address Lookup Tables (ALTs), we have ~600 bytes of headroom
 * for message + attestation by reducing account key overhead.
 */
const CCTP_MESSAGE_MIN_SIZE = 140; // Minimum structure without body
const CCTP_MESSAGE_MAX_SIZE = 800; // Allow for hookData with ALT headroom

/**
 * Expected attestation size ranges.
 * CCTP v2 attestations contain ECDSA signatures (65 bytes each) with metadata.
 * Multiple attesters may sign for higher finality thresholds.
 */
const ATTESTATION_MIN_SIZE = 65; // Single ECDSA signature
const ATTESTATION_MAX_SIZE = 400; // Multiple signatures with overhead

/**
 * Serialize receiveMessage instruction data manually using Borsh format.
 * This avoids Anchor's method builder which has buffer size issues with large Vec<u8>.
 *
 * Format: [8-byte discriminator][4-byte msg len][msg bytes][4-byte att len][att bytes]
 *
 * @throws Error if message or attestation sizes are outside expected ranges
 */
function serializeReceiveMessageData(
  message: Buffer,
  attestation: Buffer
): Buffer {
  // Validate message size
  if (message.length < CCTP_MESSAGE_MIN_SIZE || message.length > CCTP_MESSAGE_MAX_SIZE) {
    throw new Error(
      `Invalid CCTP message size: ${message.length} bytes. ` +
      `Expected ${CCTP_MESSAGE_MIN_SIZE}-${CCTP_MESSAGE_MAX_SIZE} bytes.`
    );
  }

  // Validate attestation size
  if (attestation.length < ATTESTATION_MIN_SIZE || attestation.length > ATTESTATION_MAX_SIZE) {
    throw new Error(
      `Invalid attestation size: ${attestation.length} bytes. ` +
      `Expected ${ATTESTATION_MIN_SIZE}-${ATTESTATION_MAX_SIZE} bytes.`
    );
  }

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
 *
 * @throws Error with descriptive message on network errors or invalid account data
 */
async function fetchFeeRecipient(
  connection: Connection,
  tokenMessengerPda: PublicKey
): Promise<PublicKey> {
  try {
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

    // Fetch TokenMessenger state from chain
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const accounts = tokenMessengerProgram.account as any;
    if (!accounts?.tokenMessenger?.fetch) {
      throw new Error(
        "TokenMessenger account type not found in program IDL. " +
        "The program may have been upgraded or the IDL is outdated."
      );
    }

    const tokenMessengerState = await accounts.tokenMessenger.fetch(tokenMessengerPda);

    // Validate the returned state has feeRecipient
    if (!tokenMessengerState || typeof tokenMessengerState !== "object") {
      throw new Error(
        "Invalid TokenMessenger state: received null or non-object response"
      );
    }

    const feeRecipient = tokenMessengerState.feeRecipient;
    if (!feeRecipient || !(feeRecipient instanceof PublicKey)) {
      throw new Error(
        "Invalid feeRecipient in TokenMessenger state: expected PublicKey"
      );
    }

    return feeRecipient;
  } catch (error) {
    // Re-throw our validation errors as-is
    if (error instanceof Error && error.message.includes("TokenMessenger")) {
      throw error;
    }

    // Wrap network/RPC errors with context
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to fetch feeRecipient from TokenMessenger: ${message}`
    );
  }
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
  /** TokenMessenger's event authority for CPI event emission */
  tokenMessengerEventAuthorityPda: PublicKey;
  /** MessageTransmitter's event authority for #[event_cpi] macro */
  messageTransmitterEventAuthorityPda: PublicKey;
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

  // TokenMessenger's event authority (for CPI into TokenMessenger)
  const [tokenMessengerEventAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    TOKEN_MESSENGER_PROGRAM_ID
  );

  // MessageTransmitter's event authority (for #[event_cpi] on receive_message)
  const [messageTransmitterEventAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    MESSAGE_TRANSMITTER_PROGRAM_ID
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
    tokenMessengerEventAuthorityPda,
    messageTransmitterEventAuthorityPda,
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
 * Fetch Address Lookup Table account from chain.
 * Returns null if ALT is not configured, doesn't exist, or isn't fully populated.
 * Gracefully falls back to legacy transaction if ALT is unavailable.
 */
async function fetchAddressLookupTable(
  connection: Connection,
  destinationChainId: SolanaChainId
): Promise<AddressLookupTableAccount | null> {
  const altAddress = getCctpAltAddress(destinationChainId);
  if (!altAddress) {
    return null;
  }

  try {
    const altAccountInfo = await connection.getAddressLookupTable(altAddress);

    // Validate ALT exists on chain
    if (!altAccountInfo.value) {
      console.warn(
        `[CCTP] ALT ${altAddress.toBase58()} not found. Falling back to legacy tx.`
      );
      return null;
    }

    // Validate ALT has expected 11 static CCTP accounts
    const addressCount = altAccountInfo.value.state.addresses.length;
    if (addressCount < 11) {
      console.warn(
        `[CCTP] ALT has ${addressCount}/11 addresses. Falling back to legacy tx.`
      );
      return null;
    }

    return altAccountInfo.value;
  } catch (error) {
    console.warn(
      `[CCTP] ALT fetch failed:`,
      error instanceof Error ? error.message : error
    );
    return null;
  }
}

/**
 * Build a CCTP receiveMessage transaction.
 * Uses VersionedTransaction with Address Lookup Tables (ALTs) to reduce transaction size,
 * allowing larger CCTP messages that would exceed the 1232-byte limit with legacy transactions.
 *
 * If ALT is not available, falls back to legacy Transaction (may fail for large messages).
 */
export async function buildReceiveMessageTransaction(
  params: SolanaMintParams
): Promise<VersionedTransaction | Transaction> {
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

  // Build account keys for receiveMessage instruction.
  // CRITICAL: Order MUST match the MessageTransmitter program's receive_message instruction layout.
  // Reference: Circle CCTP v2 Solana program (MessageTransmitter)
  // See: https://github.com/circlefin/solana-cctp-contracts
  //
  // Accounts [0-6]: Core MessageTransmitter accounts
  // Accounts [7-17]: Remaining accounts passed via CPI to TokenMessengerMinter
  const keys: AccountMeta[] = [
    // === Core MessageTransmitter accounts (indices 0-6) ===
    { pubkey: user, isSigner: true, isWritable: true },                              // [0] payer - pays for tx fees and rent
    { pubkey: user, isSigner: true, isWritable: false },                             // [1] caller - authorized message caller
    { pubkey: pdas.messageTransmitterAuthorityPda, isSigner: false, isWritable: false }, // [2] authority_pda - program authority
    { pubkey: pdas.messageTransmitterPda, isSigner: false, isWritable: false },      // [3] message_transmitter - program state
    { pubkey: usedNoncePda, isSigner: false, isWritable: true },                     // [4] used_nonces - tracks used nonces (writable)
    { pubkey: TOKEN_MESSENGER_PROGRAM_ID, isSigner: false, isWritable: false },      // [5] receiver - TokenMessenger program
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },         // [6] system_program - Solana System Program

    // === MessageTransmitter event_cpi accounts (required by #[event_cpi] macro) ===
    // These MUST come immediately after main accounts, before remaining_accounts
    { pubkey: pdas.messageTransmitterEventAuthorityPda, isSigner: false, isWritable: false }, // [7] MT event_authority
    { pubkey: MESSAGE_TRANSMITTER_PROGRAM_ID, isSigner: false, isWritable: false },  // [8] MT program

    // === Remaining accounts for CPI to TokenMessengerMinter (indices 9-19) ===
    { pubkey: pdas.tokenMessengerPda, isSigner: false, isWritable: false },          // [9] token_messenger - TokenMessenger state
    { pubkey: pdas.remoteTokenMessengerPda, isSigner: false, isWritable: false },    // [10] remote_token_messenger - source chain config
    { pubkey: pdas.tokenMinterPda, isSigner: false, isWritable: true },              // [11] token_minter - minting authority (writable)
    { pubkey: pdas.localTokenPda, isSigner: false, isWritable: true },               // [12] local_token - USDC token config (writable)
    { pubkey: pdas.tokenPairPda, isSigner: false, isWritable: false },               // [13] token_pair - source/dest token mapping
    { pubkey: feeRecipientAta, isSigner: false, isWritable: true },                  // [14] fee_recipient_ata - receives fees (writable)
    { pubkey: userUsdcAta, isSigner: false, isWritable: true },                      // [15] user_token_account - receives USDC (writable)
    { pubkey: pdas.custodyPda, isSigner: false, isWritable: true },                  // [16] custody - USDC custody account (writable)
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },                // [17] token_program - SPL Token Program
    // TokenMessenger event_cpi accounts (for CPI into TokenMessenger)
    { pubkey: pdas.tokenMessengerEventAuthorityPda, isSigner: false, isWritable: false }, // [18] TM event_authority
    { pubkey: TOKEN_MESSENGER_PROGRAM_ID, isSigner: false, isWritable: false },      // [19] TM program
  ];

  // Create receiveMessage instruction manually
  const receiveMessageIx = new TransactionInstruction({
    programId: MESSAGE_TRANSMITTER_PROGRAM_ID,
    keys,
    data: instructionData,
  });

  // Build instructions array
  const instructions: TransactionInstruction[] = [];

  // Add ComputeBudget instructions for CCTP's high compute requirements
  // CCTP receiveMessage with CPI to TokenMessenger can exceed 200k default limit
  const computeUnitLimitIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: 400_000, // Request 400k CU (CCTP needs ~200k+ with CPIs)
  });
  const computeUnitPriceIx = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: 50_000, // Priority fee: 50k microlamports per CU
  });
  instructions.push(computeUnitLimitIx, computeUnitPriceIx);

  // Check if user's ATA exists, create if needed
  const userAtaInfo = await connection.getAccountInfo(userUsdcAta);
  if (!userAtaInfo) {
    const createAtaIx = createAssociatedTokenAccountInstruction(
      user, // payer
      userUsdcAta, // ata
      mintRecipientOwner, // owner
      usdcMint // mint
    );
    instructions.push(createAtaIx);
  }

  instructions.push(receiveMessageIx);

  // Get recent blockhash
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");

  // Try to use ALT for smaller transaction size
  const addressLookupTable = await fetchAddressLookupTable(connection, destinationChainId);

  if (addressLookupTable) {
    // Use VersionedTransaction with ALT for smaller size
    const messageV0 = new TransactionMessage({
      payerKey: user,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message([addressLookupTable]);

    const versionedTx = new VersionedTransaction(messageV0);
    return versionedTx;
  } else {
    // Fallback to legacy Transaction (may fail for large messages)
    console.warn(
      "[CCTP] No ALT available, using legacy transaction. " +
      "Large messages may exceed the 1232-byte limit."
    );
    const transaction = new Transaction();
    instructions.forEach((ix) => transaction.add(ix));
    transaction.recentBlockhash = blockhash;
    transaction.lastValidBlockHeight = lastValidBlockHeight;
    transaction.feePayer = user;
    return transaction;
  }
}

// =============================================================================
// Transaction Sending
// =============================================================================

/**
 * Send a signed transaction WITHOUT waiting for confirmation.
 * Returns the signature immediately after sending.
 * This avoids WebSocket confirmation hangs in the browser.
 *
 * Supports both legacy Transaction and VersionedTransaction.
 */
export async function sendTransactionNoConfirm(
  connection: Connection,
  signedTransaction: Transaction | VersionedTransaction
): Promise<string> {
  const rawTransaction = signedTransaction.serialize();

  const signature = await connection.sendRawTransaction(rawTransaction, {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });

  return signature;
}

/**
 * Type guard to check if transaction is a VersionedTransaction.
 */
export function isVersionedTransaction(
  tx: Transaction | VersionedTransaction
): tx is VersionedTransaction {
  return "version" in tx;
}
