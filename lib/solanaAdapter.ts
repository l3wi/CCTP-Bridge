import { createAdapterFromProvider } from "@circle-fin/adapter-solana";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddress } from "@solana/spl-token";
import type { BridgeParams } from "@circle-fin/bridge-kit";
import type { Adapter } from "@solana/wallet-adapter-base";
import { getSolanaRpcEndpoint, BRIDGEKIT_ENV } from "./bridgeKit";
import type { SolanaChainId } from "./types";

// Bridge Kit adapter type (extracted from BridgeParams)
type BridgeKitAdapter = BridgeParams["from"]["adapter"];

// USDC token mint addresses on Solana
const USDC_MINT: Record<SolanaChainId, string> = {
  Solana: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // Mainnet
  Solana_Devnet: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", // Devnet
};

// Type for raw browser wallet providers (Phantom, Solflare, etc.)
interface SolanaWalletProvider {
  isConnected: boolean;
  publicKey: PublicKey | null;
  connect(): Promise<{ publicKey: PublicKey }>;
  disconnect(): Promise<void>;
  signTransaction<T>(transaction: T): Promise<T>;
  signAllTransactions<T>(transactions: T[]): Promise<T[]>;
  signMessage?(message: Uint8Array): Promise<{ signature: Uint8Array }>;
}

// Extend Window to include wallet providers
declare global {
  interface Window {
    phantom?: { solana?: SolanaWalletProvider };
    solflare?: SolanaWalletProvider;
    solana?: SolanaWalletProvider;
    backpack?: { solana?: SolanaWalletProvider };
  }
}

/**
 * Get the raw browser wallet provider based on the wallet adapter name.
 * Circle's SDK expects the raw provider (window.solana, window.phantom.solana, etc.),
 * NOT the @solana/wallet-adapter-react adapter.
 */
const getRawWalletProvider = (walletName: string): SolanaWalletProvider | undefined => {
  if (typeof window === "undefined") return undefined;

  // Check specific wallet providers based on name
  switch (walletName.toLowerCase()) {
    case "phantom":
      return window.phantom?.solana;
    case "solflare":
      return window.solflare;
    case "backpack":
      return window.backpack?.solana;
    default:
      // Fallback to generic window.solana (standard interface)
      return window.solana;
  }
};

/**
 * Create a Bridge Kit adapter from a Solana wallet adapter
 * @param walletAdapter - The connected Solana wallet adapter (e.g., from useWallet().wallet?.adapter)
 *
 * Note: Circle's SDK expects the raw browser wallet provider (window.solana, etc.),
 * not the @solana/wallet-adapter-react adapter. This function finds the correct provider.
 */
export const createSolanaAdapter = async (
  walletAdapter: Adapter
): Promise<BridgeKitAdapter> => {
  // Get the raw wallet provider from window based on wallet name
  const provider = getRawWalletProvider(walletAdapter.name);

  if (!provider) {
    throw new Error(
      `Could not find wallet provider for ${walletAdapter.name}. ` +
      `Make sure the wallet extension is installed and the page has been refreshed.`
    );
  }

  if (!provider.isConnected) {
    throw new Error(
      `Wallet ${walletAdapter.name} is not connected. Please connect your wallet first.`
    );
  }

  const bridgeAdapter = await createAdapterFromProvider({
    provider: provider as Parameters<typeof createAdapterFromProvider>[0]["provider"],
  });

  return bridgeAdapter as BridgeKitAdapter;
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
 * Validate a Solana address (Base58 public key)
 * @param address - The address string to validate
 */
export const isValidSolanaAddress = (address: string): boolean => {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
};

/**
 * Get the USDC mint address for a Solana chain
 */
export const getSolanaUsdcMint = (chainId: SolanaChainId): string => {
  return USDC_MINT[chainId];
};

/**
 * Create a Solana Connection instance for a given chain
 */
export const createSolanaConnection = (
  chainId: SolanaChainId = BRIDGEKIT_ENV === "mainnet" ? "Solana" : "Solana_Devnet"
): Connection => {
  const endpoint = getSolanaRpcEndpoint(chainId);
  return new Connection(endpoint, "confirmed");
};

// Re-export PublicKey for convenience
export { PublicKey } from "@solana/web3.js";
