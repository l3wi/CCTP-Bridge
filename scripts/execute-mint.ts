/**
 * Manual mint execution script for stuck CCTP transactions
 *
 * This script executes the receiveMessage call on Ethereum to complete a stuck bridge.
 *
 * Requirements:
 * - Set PRIVATE_KEY environment variable with the wallet private key
 * - The wallet needs ETH for gas on Ethereum mainnet
 *
 * Usage:
 *   PRIVATE_KEY=0x... bun run scripts/execute-mint.ts
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
} from "viem";
import { mainnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

// CCTPv2 MessageTransmitter on Ethereum mainnet
const MESSAGE_TRANSMITTER = "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64" as const;

const MESSAGE_TRANSMITTER_ABI = parseAbi([
  "function receiveMessage(bytes message, bytes attestation) external returns (bool success)",
]);

// Data from the Iris API response
const message =
  "0x000000010000000600000000d4d6513acd76814050d26dfd9de17d316b1f3dd807b6ca2cf1a5c4730934aac700000000000000000000000028b5a0e9c621a5badaa536219b3a228c8168cf5d00000000000000000000000028b5a0e9c621a5badaa536219b3a228c8168cf5d0000000000000000000000000000000000000000000000000000000000000000000007d0000007d000000001000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda029130000000000000000000000006778b84d06804ecc154998b3fc73e557a4f1062d000000000000000000000000000000000000000000000000000000048a4a6300000000000000000000000000b3fa262d0fb521cc93be83d87b322b8a23daf3f0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000" as const;

const attestation =
  "0xfd1600ee1ea6be508c1153795b1b36441d01eec5c1714bf445be9fa9a76466442eb01dabeaa8b4c2ce19c82948c446f51b59b66d2adc30301fc8b0dc88c96c491b6e6422887a5d513c571ffeb5ec0577a20785924d56907701d7f869d21a6ecc305c4694379da04b4c87bc14b0e35f54b1c83747486401993010952c37da56a8311c" as const;

async function main() {
  const privateKey = process.env.PRIVATE_KEY;

  if (!privateKey) {
    console.log("=== MANUAL EXECUTION INSTRUCTIONS ===\n");
    console.log("No PRIVATE_KEY provided. Here's how to manually mint:\n");
    console.log("Option 1: Use the Bridge Kit UI");
    console.log("  - Go to the transaction history");
    console.log("  - Click 'Claim' on the stuck transaction\n");
    console.log("Option 2: Call receiveMessage directly");
    console.log("  - Contract: 0x81D40F21F12A8F0E3252Bccb954D722d4c464B64 (Ethereum)");
    console.log("  - Function: receiveMessage(bytes message, bytes attestation)");
    console.log("  - Message:", message);
    console.log("  - Attestation:", attestation);
    console.log("\nOption 3: Use this script with a private key");
    console.log("  PRIVATE_KEY=0x... bun run scripts/execute-mint.ts");
    return;
  }

  console.log("Creating wallet client...");

  const account = privateKeyToAccount(privateKey as `0x${string}`);

  const publicClient = createPublicClient({
    chain: mainnet,
    transport: http("https://eth.llamarpc.com"),
  });

  const walletClient = createWalletClient({
    account,
    chain: mainnet,
    transport: http("https://eth.llamarpc.com"),
  });

  console.log("Wallet address:", account.address);

  // Check balance
  const balance = await publicClient.getBalance({ address: account.address });
  console.log("ETH balance:", Number(balance) / 1e18, "ETH");

  if (balance < 10000000000000000n) { // 0.01 ETH
    console.log("WARNING: Low ETH balance. Transaction may fail.");
  }

  console.log("\n=== Executing receiveMessage ===");
  console.log("MessageTransmitter:", MESSAGE_TRANSMITTER);
  console.log("Mint recipient: 0x6778b84d06804ecc154998b3fc73e557a4f1062d");
  console.log("Amount: 19,500 USDC");

  try {
    // First simulate
    console.log("\nSimulating transaction...");
    await publicClient.simulateContract({
      address: MESSAGE_TRANSMITTER,
      abi: MESSAGE_TRANSMITTER_ABI,
      functionName: "receiveMessage",
      args: [message, attestation],
      account: account.address,
    });
    console.log("Simulation passed ✓");

    // Execute
    console.log("\nSending transaction...");
    const hash = await walletClient.writeContract({
      address: MESSAGE_TRANSMITTER,
      abi: MESSAGE_TRANSMITTER_ABI,
      functionName: "receiveMessage",
      args: [message, attestation],
    });

    console.log("\nTransaction submitted!");
    console.log("TX Hash:", hash);
    console.log("Explorer: https://etherscan.io/tx/" + hash);

    // Wait for confirmation
    console.log("\nWaiting for confirmation...");
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    console.log("\n=== TRANSACTION CONFIRMED ===");
    console.log("Status:", receipt.status === "success" ? "SUCCESS ✓" : "FAILED ✗");
    console.log("Block:", receipt.blockNumber);
    console.log("Gas used:", receipt.gasUsed.toString());

    if (receipt.status === "success") {
      console.log("\n🎉 Mint completed! 19,500 USDC has been minted to:");
      console.log("   0x6778b84d06804ecc154998b3fc73e557a4f1062d");
    }
  } catch (error: any) {
    console.log("\n❌ Transaction failed");
    console.log("Error:", error.message || error);

    if (error.message?.includes("nonce already used")) {
      console.log("\n⚠️  Good news: The nonce is already used!");
      console.log("This means the mint was already executed.");
    }
  }
}

main().catch(console.error);
