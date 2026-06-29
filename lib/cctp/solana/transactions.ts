import {
  AccountMeta,
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddress,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { getCctpAltAddress, getSolanaUsdcMint } from "../shared";
import type { SolanaChainId } from "../types";
import { fetchFeeRecipient } from "./accounts";
import {
  extractDestinationCallerFromMessage,
  extractEventNonceFromMessage,
  extractMintRecipientFromMessage,
} from "./message";
import {
  MESSAGE_TRANSMITTER_PROGRAM_ID,
  TOKEN_MESSENGER_PROGRAM_ID,
  deriveMintPdas,
  deriveUsedNoncePda,
  getSourceUsdcPubkey,
} from "./pdas";

const CCTP_MESSAGE_MIN_SIZE = 140;
const CCTP_MESSAGE_MAX_SIZE = 800;
const ATTESTATION_MIN_SIZE = 65;
const ATTESTATION_MAX_SIZE = 400;
const SOLANA_LEGACY_TX_MAX_SIZE = 1232;
const SOLANA_SIGNATURE_SIZE = 64;

const RECEIVE_MESSAGE_DISCRIMINATOR = Buffer.from([
  0x26, 0x90, 0x7f, 0xe1, 0x1f, 0xe1, 0xee, 0x19,
]);

async function verifyDiscriminatorInDev(): Promise<void> {
  if (process.env.NODE_ENV === "production") return;

  try {
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
    // Ignore environments without Web Crypto.
  }
}

if (process.env.NODE_ENV !== "production") {
  void verifyDiscriminatorInDev();
}

function serializeReceiveMessageData(
  message: Buffer,
  attestation: Buffer
): Buffer {
  if (message.length < CCTP_MESSAGE_MIN_SIZE || message.length > CCTP_MESSAGE_MAX_SIZE) {
    throw new Error(
      `Invalid CCTP message size: ${message.length} bytes. ` +
      `Expected ${CCTP_MESSAGE_MIN_SIZE}-${CCTP_MESSAGE_MAX_SIZE} bytes.`
    );
  }

  if (attestation.length < ATTESTATION_MIN_SIZE || attestation.length > ATTESTATION_MAX_SIZE) {
    throw new Error(
      `Invalid attestation size: ${attestation.length} bytes. ` +
      `Expected ${ATTESTATION_MIN_SIZE}-${ATTESTATION_MAX_SIZE} bytes.`
    );
  }

  const totalSize = 8 + 4 + message.length + 4 + attestation.length;
  const data = Buffer.alloc(totalSize);
  let offset = 0;

  RECEIVE_MESSAGE_DISCRIMINATOR.copy(data, offset);
  offset += 8;

  data.writeUInt32LE(message.length, offset);
  offset += 4;
  message.copy(data, offset);
  offset += message.length;

  data.writeUInt32LE(attestation.length, offset);
  offset += 4;
  attestation.copy(data, offset);

  return data;
}

export interface SolanaMintParams {
  connection: Connection;
  user: PublicKey;
  message: string;
  attestation: string;
  sourceDomain: number;
  destinationChainId: SolanaChainId;
  isTestnet: boolean;
  destinationAddress: string;
}

export interface SolanaMintRecipientResolution {
  payer: PublicKey;
  recipientOwner: PublicKey;
  recipientAta: PublicKey;
  messageMintRecipient: PublicKey;
  destinationCaller: PublicKey;
}

export interface SolanaMintTransactionPlan {
  setupTransaction?: VersionedTransaction | Transaction;
  mintTransaction: VersionedTransaction | Transaction;
  refreshMintTransaction?: () => Promise<VersionedTransaction | Transaction>;
  payer: PublicKey;
  recipientOwner: PublicKey;
  recipientAta: PublicKey;
  messageMintRecipient: PublicKey;
  destinationCaller: PublicKey;
  needsAtaCreation: boolean;
}

export function resolveSolanaMintRecipient(params: {
  payer: PublicKey;
  destinationAddress: string;
  destinationChainId: SolanaChainId;
  message: string;
}): SolanaMintRecipientResolution {
  const normalizedDestinationAddress = params.destinationAddress.trim();

  if (!normalizedDestinationAddress) {
    throw new Error("Missing locked Solana recipient wallet address.");
  }

  const recipientOwner = new PublicKey(normalizedDestinationAddress);
  const usdcMint = getSolanaUsdcMint(params.destinationChainId);
  const recipientAta = getAssociatedTokenAddressSync(usdcMint, recipientOwner);
  const messageMintRecipient = extractMintRecipientFromMessage(params.message);

  if (!messageMintRecipient.equals(recipientAta)) {
    throw new Error(
      `Wrong Solana recipient: message mintRecipient ${messageMintRecipient.toBase58()} ` +
      `does not match the locked recipient ATA ${recipientAta.toBase58()}.`
    );
  }

  const destinationCaller = extractDestinationCallerFromMessage(params.message);
  if (
    !destinationCaller.equals(PublicKey.default) &&
    !destinationCaller.equals(params.payer)
  ) {
    throw new Error(
      `Wrong Solana caller: this transfer can only be claimed by ` +
      `${destinationCaller.toBase58()}, but the connected payer is ${params.payer.toBase58()}.`
    );
  }

  return {
    payer: params.payer,
    recipientOwner,
    recipientAta,
    messageMintRecipient,
    destinationCaller,
  };
}

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

    if (!altAccountInfo.value) {
      console.warn(
        `[CCTP] ALT ${altAddress.toBase58()} not found. Falling back to legacy tx.`
      );
      return null;
    }

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

export async function buildReceiveMessageTransaction(
  params: SolanaMintParams
): Promise<SolanaMintTransactionPlan> {
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
  const recipient = resolveSolanaMintRecipient({
    payer: user,
    destinationAddress,
    destinationChainId,
    message,
  });

  const sourceUsdcPubkey = getSourceUsdcPubkey(sourceDomain, isTestnet);
  const pdas = deriveMintPdas(sourceDomain, sourceUsdcPubkey, usdcMint);
  const eventNonce = extractEventNonceFromMessage(message);
  const usedNoncePda = deriveUsedNoncePda(eventNonce);
  const feeRecipient = await fetchFeeRecipient(
    connection,
    pdas.tokenMessengerPda,
    isTestnet ? "devnet" : "mainnet"
  );
  const feeRecipientAta = await getAssociatedTokenAddress(
    usdcMint,
    feeRecipient,
    true
  );

  const messageBuffer = Buffer.from(message.replace(/^0x/, ""), "hex");
  const attestationBuffer = Buffer.from(attestation.replace(/^0x/, ""), "hex");
  const instructionData = serializeReceiveMessageData(messageBuffer, attestationBuffer);

  const keys: AccountMeta[] = [
    { pubkey: user, isSigner: true, isWritable: true },
    { pubkey: user, isSigner: true, isWritable: false },
    { pubkey: pdas.messageTransmitterAuthorityPda, isSigner: false, isWritable: false },
    { pubkey: pdas.messageTransmitterPda, isSigner: false, isWritable: false },
    { pubkey: usedNoncePda, isSigner: false, isWritable: true },
    { pubkey: TOKEN_MESSENGER_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: pdas.messageTransmitterEventAuthorityPda, isSigner: false, isWritable: false },
    { pubkey: MESSAGE_TRANSMITTER_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: pdas.tokenMessengerPda, isSigner: false, isWritable: false },
    { pubkey: pdas.remoteTokenMessengerPda, isSigner: false, isWritable: false },
    { pubkey: pdas.tokenMinterPda, isSigner: false, isWritable: true },
    { pubkey: pdas.localTokenPda, isSigner: false, isWritable: true },
    { pubkey: pdas.tokenPairPda, isSigner: false, isWritable: false },
    { pubkey: feeRecipientAta, isSigner: false, isWritable: true },
    { pubkey: recipient.recipientAta, isSigner: false, isWritable: true },
    { pubkey: pdas.custodyPda, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: pdas.tokenMessengerEventAuthorityPda, isSigner: false, isWritable: false },
    { pubkey: TOKEN_MESSENGER_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const receiveMessageIx = new TransactionInstruction({
    programId: MESSAGE_TRANSMITTER_PROGRAM_ID,
    keys,
    data: instructionData,
  });

  const instructions: TransactionInstruction[] = [];
  instructions.push(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 })
  );

  const userAtaInfo = await connection.getAccountInfo(recipient.recipientAta);
  const needsAtaCreation = !userAtaInfo;
  let createAtaIx: TransactionInstruction | undefined;
  if (needsAtaCreation) {
    createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
      user,
      recipient.recipientAta,
      recipient.recipientOwner,
      usdcMint
    );
    instructions.push(createAtaIx);
  }

  instructions.push(receiveMessageIx);

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  const addressLookupTable = await fetchAddressLookupTable(connection, destinationChainId);

  if (addressLookupTable) {
    const mintOnlyInstructions = createAtaIx
      ? instructions.filter((ix) => ix !== createAtaIx)
      : instructions;
    const messageV0 = new TransactionMessage({
      payerKey: user,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message([addressLookupTable]);

    const versionedTx = new VersionedTransaction(messageV0);

    if (createAtaIx && estimateVersionedTransactionSize(versionedTx) > SOLANA_LEGACY_TX_MAX_SIZE) {
      const setupTransaction = buildSetupTransaction(
        createAtaIx,
        user,
        blockhash,
        lastValidBlockHeight
      );
      const mintMessageV0 = new TransactionMessage({
        payerKey: user,
        recentBlockhash: blockhash,
        instructions: mintOnlyInstructions,
      }).compileToV0Message([addressLookupTable]);

      return {
        ...recipient,
        setupTransaction,
        mintTransaction: new VersionedTransaction(mintMessageV0),
        refreshMintTransaction: () =>
          buildVersionedMintTransaction(
            connection,
            user,
            mintOnlyInstructions,
            addressLookupTable
          ),
        needsAtaCreation,
      };
    }

    return {
      ...recipient,
      mintTransaction: versionedTx,
      needsAtaCreation,
    };
  }

  console.warn(
    "[CCTP] No ALT available, using legacy transaction. " +
    "Large messages may exceed the 1232-byte limit."
  );
  const transaction = new Transaction();
  instructions.forEach((ix) => transaction.add(ix));
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  transaction.feePayer = user;

  if (createAtaIx && estimateLegacyTransactionSize(transaction) > SOLANA_LEGACY_TX_MAX_SIZE) {
    const setupTransaction = buildSetupTransaction(
      createAtaIx,
      user,
      blockhash,
      lastValidBlockHeight
    );

    const mintTransaction = new Transaction();
    const mintOnlyInstructions = instructions.filter((ix) => ix !== createAtaIx);
    mintOnlyInstructions.forEach((ix) => mintTransaction.add(ix));
    mintTransaction.recentBlockhash = blockhash;
    mintTransaction.lastValidBlockHeight = lastValidBlockHeight;
    mintTransaction.feePayer = user;

    return {
      ...recipient,
      setupTransaction,
      mintTransaction,
      refreshMintTransaction: () =>
        buildLegacyMintTransaction(connection, user, mintOnlyInstructions),
      needsAtaCreation,
    };
  }

  return {
    ...recipient,
    mintTransaction: transaction,
    needsAtaCreation,
  };
}

function buildSetupTransaction(
  createAtaIx: TransactionInstruction,
  user: PublicKey,
  blockhash: string,
  lastValidBlockHeight: number
): Transaction {
  const setupTransaction = new Transaction().add(createAtaIx);
  setupTransaction.recentBlockhash = blockhash;
  setupTransaction.lastValidBlockHeight = lastValidBlockHeight;
  setupTransaction.feePayer = user;
  return setupTransaction;
}

async function buildVersionedMintTransaction(
  connection: Connection,
  user: PublicKey,
  instructions: TransactionInstruction[],
  addressLookupTable: AddressLookupTableAccount
): Promise<VersionedTransaction> {
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const messageV0 = new TransactionMessage({
    payerKey: user,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message([addressLookupTable]);

  return new VersionedTransaction(messageV0);
}

async function buildLegacyMintTransaction(
  connection: Connection,
  user: PublicKey,
  instructions: TransactionInstruction[]
): Promise<Transaction> {
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction();
  instructions.forEach((ix) => transaction.add(ix));
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight;
  transaction.feePayer = user;
  return transaction;
}

function estimateLegacyTransactionSize(transaction: Transaction): number {
  try {
    return transaction.serializeMessage().length + SOLANA_SIGNATURE_SIZE;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function estimateVersionedTransactionSize(transaction: VersionedTransaction): number {
  try {
    return transaction.serialize().length;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

export async function simulateSignedTransaction(
  connection: Connection,
  signedTransaction: Transaction | VersionedTransaction
): Promise<string[]> {
  let result;

  if (isVersionedTransaction(signedTransaction)) {
    result = await connection.simulateTransaction(signedTransaction, {
      commitment: "confirmed",
      replaceRecentBlockhash: false,
    });
  } else {
    result = await connection.simulateTransaction(signedTransaction, undefined, undefined);
  }

  const logs = result.value.logs ?? [];

  if (result.value.err) {
    const errJson = JSON.stringify(result.value.err);
    const error = new Error(
      `Simulation failed: ${errJson}`
    ) as Error & { simulationLogs: string[]; simulationError: unknown };
    error.simulationLogs = logs;
    error.simulationError = result.value.err;
    throw error;
  }

  return logs;
}

export async function sendTransactionNoConfirm(
  connection: Connection,
  signedTransaction: Transaction | VersionedTransaction
): Promise<string> {
  await simulateSignedTransaction(connection, signedTransaction);

  const rawTransaction = signedTransaction.serialize();

  return connection.sendRawTransaction(rawTransaction, {
    skipPreflight: true,
    preflightCommitment: "confirmed",
  });
}

export function isVersionedTransaction(
  tx: Transaction | VersionedTransaction
): tx is VersionedTransaction {
  return "version" in tx;
}
