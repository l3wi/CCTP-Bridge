import { Connection, PublicKey } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddress } from "@solana/spl-token";
import { getSolanaRpcEndpoint, BRIDGEKIT_ENV } from "./bridgeConfig";
import type { SolanaChainId } from "./types";
export { createSolanaConnection } from "@/lib/rpc/clients";

// USDC token mint addresses on Solana
const USDC_MINT: Record<SolanaChainId, string> = {
  Solana: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // Mainnet
  Solana_Devnet: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", // Devnet
};


/**
 * Get the USDC balance for a Solana account
 * @param publicKey - The Solana public key
 * @param chainId - The Solana chain identifier
 */
export const getSolanaUsdcBalance = async (
  publicKey: PublicKey,
  chainId: SolanaChainId = BRIDGEKIT_ENV === "mainnet" ? "Solana" : "Solana_Devnet"
): Promise<{ balance: bigint; formatted: string }> => {
  const endpoint = getSolanaRpcEndpoint(chainId);
  const connection = new Connection(endpoint, "confirmed");
  const usdcMint = new PublicKey(USDC_MINT[chainId]);

  try {
    const ata = await getAssociatedTokenAddress(usdcMint, publicKey);
    const account = await getAccount(connection, ata);
    const balance = account.amount;
    // USDC has 6 decimals
    const formatted = (Number(balance) / 1_000_000).toFixed(6);
    return { balance, formatted };
  } catch (error) {
    // Account doesn't exist or has no USDC
    return { balance: BigInt(0), formatted: "0.000000" };
  }
};

/**
 * Get the native SOL balance for a Solana account
 * @param publicKey - The Solana public key
 * @param chainId - The Solana chain identifier
 */
export const getSolanaNativeBalance = async (
  publicKey: PublicKey,
  chainId: SolanaChainId = BRIDGEKIT_ENV === "mainnet" ? "Solana" : "Solana_Devnet"
): Promise<{ balance: bigint; formatted: string }> => {
  const endpoint = getSolanaRpcEndpoint(chainId);
  const connection = new Connection(endpoint, "confirmed");

  try {
    const lamports = await connection.getBalance(publicKey);
    const balance = BigInt(lamports);
    // SOL has 9 decimals
    const formatted = (lamports / 1_000_000_000).toFixed(9);
    return { balance, formatted };
  } catch {
    return { balance: BigInt(0), formatted: "0.000000000" };
  }
};

/**
 * Validate a Solana wallet address using ed25519 curve validation.
 * Uses PublicKey.isOnCurve() to ensure the address is a valid wallet (not a PDA).
 *
 * - Returns true for wallet addresses (generated from Keypair, on-curve)
 * - Returns false for PDAs (program-derived addresses, off-curve)
 * - Throws are caught and return false for invalid Base58 strings
 *
 * @param address - The address string to validate
 */
export const isValidSolanaAddress = (address: string): boolean => {
  if (!address || typeof address !== "string") {
    return false;
  }

  const trimmed = address.trim();

  try {
    // isOnCurve validates:
    // 1. Valid Base58 encoding
    // 2. Decodes to 32 bytes
    // 3. Is a valid point on the ed25519 curve (real wallet, not a PDA)
    return PublicKey.isOnCurve(trimmed);
  } catch {
    // Invalid Base58 or other parsing error
    return false;
  }
};

/**
 * Get the USDC mint address for a Solana chain
 */
export const getSolanaUsdcMint = (chainId: SolanaChainId): string => {
  return USDC_MINT[chainId];
};

// Re-export PublicKey for convenience
export { PublicKey } from "@solana/web3.js";
