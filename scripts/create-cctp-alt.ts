/**
 * Create Address Lookup Tables (ALTs) for CCTP receiveMessage transactions.
 *
 * ALTs reduce transaction size by replacing 32-byte addresses with 1-byte indices.
 * This is required because Solana mint transactions can exceed the 1232-byte limit.
 *
 * Usage:
 *   # Devnet
 *   SOLANA_KEYPAIR_PATH=~/.config/solana/id.json bun run scripts/create-cctp-alt.ts devnet
 *
 *   # Mainnet
 *   SOLANA_KEYPAIR_PATH=~/.config/solana/id.json bun run scripts/create-cctp-alt.ts mainnet
 */

import {
  Connection,
  PublicKey,
  Keypair,
  AddressLookupTableProgram,
  TransactionMessage,
  VersionedTransaction,
  SystemProgram,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

// =============================================================================
// CCTP Program IDs (same for mainnet and devnet)
// =============================================================================

const MESSAGE_TRANSMITTER_PROGRAM_ID = new PublicKey(
  "CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC"
);

const TOKEN_MESSENGER_PROGRAM_ID = new PublicKey(
  "CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe"
);

// USDC mints
const USDC_MINTS = {
  mainnet: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
  devnet: new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"),
};

// RPC endpoints
const RPC_ENDPOINTS = {
  mainnet: "https://api.mainnet-beta.solana.com",
  devnet: "https://api.devnet.solana.com",
};

// =============================================================================
// PDA Derivation (static PDAs that don't depend on user/nonce)
// =============================================================================

function deriveStaticPdas(usdcMint: PublicKey) {
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
    [Buffer.from("local_token"), usdcMint.toBuffer()],
    TOKEN_MESSENGER_PROGRAM_ID
  );

  const [custodyPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("custody"), usdcMint.toBuffer()],
    TOKEN_MESSENGER_PROGRAM_ID
  );

  const [messageTransmitterAuthorityPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("message_transmitter_authority"),
      TOKEN_MESSENGER_PROGRAM_ID.toBuffer(),
    ],
    MESSAGE_TRANSMITTER_PROGRAM_ID
  );

  const [eventAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    TOKEN_MESSENGER_PROGRAM_ID
  );

  return {
    tokenMessengerPda,
    messageTransmitterPda,
    tokenMinterPda,
    localTokenPda,
    custodyPda,
    messageTransmitterAuthorityPda,
    eventAuthorityPda,
  };
}

// =============================================================================
// ALT Creation
// =============================================================================

async function createAndExtendAlt(
  connection: Connection,
  payer: Keypair,
  addresses: PublicKey[]
): Promise<PublicKey> {
  const slot = await connection.getSlot();

  // Create ALT
  const [createIx, altAddress] = AddressLookupTableProgram.createLookupTable({
    authority: payer.publicKey,
    payer: payer.publicKey,
    recentSlot: slot - 1,
  });

  console.log(`Creating ALT at: ${altAddress.toBase58()}`);

  // Build and send create transaction
  const { blockhash } = await connection.getLatestBlockhash();
  const createMessage = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: [createIx],
  }).compileToV0Message();

  const createTx = new VersionedTransaction(createMessage);
  createTx.sign([payer]);

  const createSig = await connection.sendTransaction(createTx, {
    skipPreflight: false,
  });
  console.log(`Create tx: ${createSig}`);

  // Wait for confirmation
  await connection.confirmTransaction(createSig, "confirmed");
  console.log("ALT created, waiting for activation...");

  // Wait a bit for the ALT to be active (required before extending)
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Extend ALT with addresses (max 30 per instruction)
  const extendIx = AddressLookupTableProgram.extendLookupTable({
    payer: payer.publicKey,
    authority: payer.publicKey,
    lookupTable: altAddress,
    addresses: addresses,
  });

  const { blockhash: extendBlockhash } = await connection.getLatestBlockhash();
  const extendMessage = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: extendBlockhash,
    instructions: [extendIx],
  }).compileToV0Message();

  const extendTx = new VersionedTransaction(extendMessage);
  extendTx.sign([payer]);

  const extendSig = await connection.sendTransaction(extendTx, {
    skipPreflight: false,
  });
  console.log(`Extend tx: ${extendSig}`);

  await connection.confirmTransaction(extendSig, "confirmed");
  console.log("ALT extended successfully");

  return altAddress;
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const network = process.argv[2] as "mainnet" | "devnet";
  if (!network || !["mainnet", "devnet"].includes(network)) {
    console.error("Usage: bun run scripts/create-cctp-alt.ts <mainnet|devnet>");
    process.exit(1);
  }

  const keypairPath =
    process.env.SOLANA_KEYPAIR_PATH || `${process.env.HOME}/.config/solana/id.json`;

  if (!fs.existsSync(keypairPath)) {
    console.error(`Keypair not found at: ${keypairPath}`);
    console.error("Set SOLANA_KEYPAIR_PATH environment variable");
    process.exit(1);
  }

  const keypairData = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const payer = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  console.log(`Payer: ${payer.publicKey.toBase58()}`);

  const rpcUrl = process.env.SOLANA_RPC_URL || RPC_ENDPOINTS[network];
  const connection = new Connection(rpcUrl, "confirmed");
  console.log(`Network: ${network}`);
  console.log(`RPC: ${rpcUrl}`);

  // Check balance
  const balance = await connection.getBalance(payer.publicKey);
  console.log(`Balance: ${balance / 1e9} SOL`);

  if (balance < 0.1 * 1e9) {
    console.error("Insufficient balance. Need at least 0.1 SOL");
    process.exit(1);
  }

  // Get static PDAs
  const usdcMint = USDC_MINTS[network];
  const pdas = deriveStaticPdas(usdcMint);

  console.log("\nStatic PDAs:");
  console.log(`  tokenMessengerPda: ${pdas.tokenMessengerPda.toBase58()}`);
  console.log(`  messageTransmitterPda: ${pdas.messageTransmitterPda.toBase58()}`);
  console.log(`  tokenMinterPda: ${pdas.tokenMinterPda.toBase58()}`);
  console.log(`  localTokenPda: ${pdas.localTokenPda.toBase58()}`);
  console.log(`  custodyPda: ${pdas.custodyPda.toBase58()}`);
  console.log(`  messageTransmitterAuthorityPda: ${pdas.messageTransmitterAuthorityPda.toBase58()}`);
  console.log(`  eventAuthorityPda: ${pdas.eventAuthorityPda.toBase58()}`);

  // Accounts to include in ALT
  const altAddresses = [
    // Program IDs
    MESSAGE_TRANSMITTER_PROGRAM_ID,
    TOKEN_MESSENGER_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    SystemProgram.programId,
    // USDC mint
    usdcMint,
    // Static PDAs
    pdas.tokenMessengerPda,
    pdas.messageTransmitterPda,
    pdas.tokenMinterPda,
    pdas.localTokenPda,
    pdas.custodyPda,
    pdas.messageTransmitterAuthorityPda,
    pdas.eventAuthorityPda,
  ];

  console.log(`\nCreating ALT with ${altAddresses.length} addresses...`);

  const altAddress = await createAndExtendAlt(connection, payer, altAddresses);

  console.log("\n========================================");
  console.log(`ALT Address (${network}): ${altAddress.toBase58()}`);
  console.log("========================================");
  console.log("\nAdd this to lib/cctp/shared.ts:");
  console.log(`  ${network}: new PublicKey("${altAddress.toBase58()}"),`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
