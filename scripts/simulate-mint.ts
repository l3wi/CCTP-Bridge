import { createPublicClient, http, parseAbi, decodeFunctionResult } from "viem";
import { mainnet } from "viem/chains";

// CCTPv2 MessageTransmitter on Ethereum mainnet
const MESSAGE_TRANSMITTER = "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64" as const;

const MESSAGE_TRANSMITTER_ABI = parseAbi([
  "function receiveMessage(bytes message, bytes attestation) external returns (bool success)",
  "function usedNonces(bytes32 sourceNonceHash) external view returns (uint256)",
]);

// Data from the Iris API response
const message =
  "0x000000010000000600000000d4d6513acd76814050d26dfd9de17d316b1f3dd807b6ca2cf1a5c4730934aac700000000000000000000000028b5a0e9c621a5badaa536219b3a228c8168cf5d00000000000000000000000028b5a0e9c621a5badaa536219b3a228c8168cf5d0000000000000000000000000000000000000000000000000000000000000000000007d0000007d000000001000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda029130000000000000000000000006778b84d06804ecc154998b3fc73e557a4f1062d000000000000000000000000000000000000000000000000000000048a4a6300000000000000000000000000b3fa262d0fb521cc93be83d87b322b8a23daf3f0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000" as const;

const attestation =
  "0xfd1600ee1ea6be508c1153795b1b36441d01eec5c1714bf445be9fa9a76466442eb01dabeaa8b4c2ce19c82948c446f51b59b66d2adc30301fc8b0dc88c96c491b6e6422887a5d513c571ffeb5ec0577a20785924d56907701d7f869d21a6ecc305c4694379da04b4c87bc14b0e35f54b1c83747486401993010952c37da56a8311c" as const;

// Nonce from the message
const eventNonce = "0xd4d6513acd76814050d26dfd9de17d316b1f3dd807b6ca2cf1a5c4730934aac7" as const;

async function main() {
  console.log("Creating Ethereum mainnet client...");

  const client = createPublicClient({
    chain: mainnet,
    transport: http("https://eth.llamarpc.com"),
  });

  console.log("\n=== Transaction Details ===");
  console.log("Source Domain: 6 (Base)");
  console.log("Destination Domain: 0 (Ethereum)");
  console.log("Mint Recipient: 0x6778b84d06804ecc154998b3fc73e557a4f1062d");
  console.log("Amount: 19,500 USDC (19500000000 / 1e6)");
  console.log("Nonce:", eventNonce);
  console.log("MessageTransmitter:", MESSAGE_TRANSMITTER);

  // First, check if the nonce has already been used
  // The nonce hash is computed as keccak256(abi.encodePacked(sourceDomain, nonce))
  // Source domain is 6 (Base)
  console.log("\n=== Checking if nonce is already used ===");

  try {
    // Create the source nonce hash: keccak256(abi.encodePacked(uint32(sourceDomain), bytes32(nonce)))
    const { keccak256, encodePacked } = await import("viem");
    const sourceNonceHash = keccak256(
      encodePacked(["uint32", "bytes32"], [6, eventNonce])
    );
    console.log("Source nonce hash:", sourceNonceHash);

    const usedNonce = await client.readContract({
      address: MESSAGE_TRANSMITTER,
      abi: MESSAGE_TRANSMITTER_ABI,
      functionName: "usedNonces",
      args: [sourceNonceHash],
    });
    console.log("Nonce usage status:", usedNonce.toString());
    console.log("Nonce already used:", usedNonce > 0n ? "YES ✓" : "NO");

    if (usedNonce > 0n) {
      console.log("\n⚠️  This nonce has already been used! The mint was likely already executed.");
      console.log("The USDC should already be in the recipient's wallet.");

      // Let's check the recipient's USDC balance
      const USDC_ADDRESS = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" as const;
      const ERC20_ABI = parseAbi([
        "function balanceOf(address account) external view returns (uint256)",
      ]);

      const balance = await client.readContract({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: ["0x6778b84d06804ecc154998b3fc73e557a4f1062d"],
      });
      console.log("\nRecipient USDC balance:", (Number(balance) / 1e6).toLocaleString(), "USDC");
      return;
    }
  } catch (error) {
    console.log("Error checking nonce:", error);
  }

  // Simulate the receiveMessage call
  console.log("\n=== Simulating receiveMessage ===");

  try {
    const result = await client.simulateContract({
      address: MESSAGE_TRANSMITTER,
      abi: MESSAGE_TRANSMITTER_ABI,
      functionName: "receiveMessage",
      args: [message, attestation],
      account: "0x6778b84d06804ecc154998b3fc73e557a4f1062d", // Mint recipient as caller
    });

    console.log("Simulation SUCCESS ✓");
    console.log("Result:", result.result);
    console.log("\nThe mint transaction would succeed if executed now.");
  } catch (error: any) {
    console.log("\n❌ Simulation FAILED");
    console.log("Error:", error.message || error);

    if (error.cause?.data) {
      console.log("Error data:", error.cause.data);
    }

    // Check for specific error patterns
    if (error.message?.includes("nonce already used")) {
      console.log("\n⚠️  The nonce has already been used - mint was already executed!");
    } else if (error.message?.includes("invalid attestation")) {
      console.log("\n⚠️  The attestation signature is invalid or expired.");
    } else if (error.message?.includes("message already received")) {
      console.log("\n⚠️  This message has already been processed.");
    }
  }
}

main().catch(console.error);
