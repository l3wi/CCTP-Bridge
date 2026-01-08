#!/usr/bin/env bun
/**
 * Deploy CCTP Address Lookup Table (ALT) for Solana receiveMessage transactions.
 *
 * ALTs reduce transaction size by replacing 32-byte addresses with 1-byte indices,
 * allowing larger CCTP messages that would exceed the 1232-byte limit.
 *
 * Usage:
 *   bun run scripts/deploy-cctp-alt.ts mainnet
 *   bun run scripts/deploy-cctp-alt.ts devnet
 *
 * Environment:
 *   SOLANA_KEYPAIR_PATH - Path to keypair JSON file (default: ~/.config/solana/id.json)
 *
 * After deployment, update CCTP_ALT_ADDRESSES in lib/cctp/shared.ts with the output address.
 */

import {
  Connection,
  PublicKey,
  Keypair,
  AddressLookupTableProgram,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  clusterApiUrl,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

// =============================================================================
// Configuration
// =============================================================================

type Network = "mainnet" | "devnet";

const RPC_ENDPOINTS: Record<Network, string> = {
  mainnet: process.env.SOLANA_MAINNET_RPC || clusterApiUrl("mainnet-beta"),
  devnet: process.env.SOLANA_DEVNET_RPC || clusterApiUrl("devnet"),
};

// CCTP v2 Program IDs (same for mainnet and devnet)
const MESSAGE_TRANSMITTER_PROGRAM_ID = new PublicKey(
  "CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC"
);

const TOKEN_MESSENGER_PROGRAM_ID = new PublicKey(
  "CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe"
);

// USDC mint addresses
const USDC_MINT: Record<Network, PublicKey> = {
  mainnet: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
  devnet: new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"),
};

// =============================================================================
// PDA Derivation (matches mint.ts)
// =============================================================================

function deriveCctpPdas(network: Network) {
  const usdcMint = USDC_MINT[network];

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

  // Event authority PDA (derived from MessageTransmitter, not TokenMessenger)
  const [eventAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    MESSAGE_TRANSMITTER_PROGRAM_ID
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
// Keypair Loading
// =============================================================================

function loadKeypair(): Keypair {
  // Default to the deployer keypair in scripts directory
  const defaultPath = path.join(process.cwd(), "scripts", "deployer-keypair.json");
  const keypairPath = process.env.SOLANA_KEYPAIR_PATH || defaultPath;

  if (!fs.existsSync(keypairPath)) {
    throw new Error(
      `Keypair not found at ${keypairPath}. ` +
        "Set SOLANA_KEYPAIR_PATH or run 'solana-keygen new'"
    );
  }

  const keypairData = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(keypairData));
}

// =============================================================================
// ALT Deployment
// =============================================================================

async function deployCctpAlt(network: Network): Promise<PublicKey> {
  const connection = new Connection(RPC_ENDPOINTS[network], "confirmed");
  const payer = loadKeypair();

  console.log(`\n=== CCTP ALT Deployment ===`);
  console.log(`Network: ${network}`);
  console.log(`RPC: ${RPC_ENDPOINTS[network]}`);
  console.log(`Payer: ${payer.publicKey.toBase58()}`);

  // Check balance
  const balance = await connection.getBalance(payer.publicKey);
  console.log(`Balance: ${balance / 1e9} SOL`);

  if (balance < 0.05 * 1e9) {
    throw new Error(
      "Insufficient balance. Need at least 0.05 SOL for ALT creation and rent."
    );
  }

  // Derive all static CCTP PDAs
  const pdas = deriveCctpPdas(network);

  // Addresses to include in ALT (static accounts that don't change per-tx)
  const staticAddresses: PublicKey[] = [
    // Program IDs
    MESSAGE_TRANSMITTER_PROGRAM_ID,
    TOKEN_MESSENGER_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    SystemProgram.programId,
    // PDAs
    pdas.tokenMessengerPda,
    pdas.messageTransmitterPda,
    pdas.tokenMinterPda,
    pdas.localTokenPda,
    pdas.custodyPda,
    pdas.messageTransmitterAuthorityPda,
    pdas.eventAuthorityPda,
  ];

  console.log(`\nAddresses to include in ALT (${staticAddresses.length}):`);
  staticAddresses.forEach((addr, i) => {
    console.log(`  [${i}] ${addr.toBase58()}`);
  });

  // Get recent slot for ALT creation
  const slot = await connection.getSlot("finalized");
  console.log(`\nUsing slot: ${slot}`);

  // Create ALT
  console.log("\nCreating Address Lookup Table...");
  const [createIx, altAddress] = AddressLookupTableProgram.createLookupTable({
    authority: payer.publicKey,
    payer: payer.publicKey,
    recentSlot: slot,
  });

  console.log(`ALT Address: ${altAddress.toBase58()}`);

  // Extend ALT with addresses
  const extendIx = AddressLookupTableProgram.extendLookupTable({
    payer: payer.publicKey,
    authority: payer.publicKey,
    lookupTable: altAddress,
    addresses: staticAddresses,
  });

  // Build and send transaction
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");

  const messageV0 = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: [createIx, extendIx],
  }).compileToV0Message();

  const tx = new VersionedTransaction(messageV0);
  tx.sign([payer]);

  console.log("\nSending transaction...");
  const signature = await connection.sendTransaction(tx, {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });

  console.log(`Signature: ${signature}`);

  // Wait for confirmation
  console.log("Waiting for confirmation...");
  const confirmation = await connection.confirmTransaction(
    {
      signature,
      blockhash,
      lastValidBlockHeight,
    },
    "confirmed"
  );

  if (confirmation.value.err) {
    throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
  }

  console.log("\n=== Deployment Complete ===");
  console.log(`ALT Address: ${altAddress.toBase58()}`);
  console.log(`\nUpdate lib/cctp/shared.ts:`);
  console.log(`  ${network === "mainnet" ? "Solana" : "Solana_Devnet"}: "${altAddress.toBase58()}",`);

  return altAddress;
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const network = process.argv[2] as Network;

  if (!network || !["mainnet", "devnet"].includes(network)) {
    console.error("Usage: bun run scripts/deploy-cctp-alt.ts <mainnet|devnet>");
    process.exit(1);
  }

  try {
    await deployCctpAlt(network);
  } catch (error) {
    console.error("\nError:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
