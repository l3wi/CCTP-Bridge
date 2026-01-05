import { useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddress } from "@solana/spl-token";
import { BRIDGEKIT_ENV } from "@/lib/bridgeKit";
import type { SolanaChainId } from "@/lib/types";

// USDC token mint addresses on Solana
const USDC_MINT: Record<SolanaChainId, string> = {
  Solana: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // Mainnet
  Solana_Devnet: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", // Devnet
};

interface UseSolanaBalanceOptions {
  /** Polling interval in ms (default: 30000) */
  refetchInterval?: number;
  /** Whether to enable the query (default: true) */
  enabled?: boolean;
}

interface SolanaBalanceResult {
  /** Raw balance in USDC base units (6 decimals) */
  usdcBalance: bigint | undefined;
  /** Formatted balance string (e.g., "100.000000") */
  usdcFormatted: string | undefined;
  /** Native SOL balance in lamports */
  solBalance: bigint | undefined;
  /** Formatted SOL balance (e.g., "1.5") */
  solFormatted: string | undefined;
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
  /** Refetch function */
  refetch: () => void;
  /** Connected Solana public key as Base58 string */
  publicKey: string | undefined;
  /** Whether Solana wallet is connected */
  connected: boolean;
  /** Check if balance >= amount (in USDC base units) */
  hasSufficientBalance: (amount: bigint) => boolean;
}

/**
 * Hook for fetching Solana USDC and SOL balances.
 * Uses the connected Solana wallet from wallet-adapter.
 */
export const useSolanaBalance = (
  options: UseSolanaBalanceOptions = {}
): SolanaBalanceResult => {
  const { refetchInterval = 30000, enabled = true } = options;
  const { publicKey, connected } = useWallet();
  const { connection } = useConnection();
  const queryClient = useQueryClient();

  // Determine Solana chain based on environment
  const solanaChainId: SolanaChainId =
    BRIDGEKIT_ENV === "mainnet" ? "Solana" : "Solana_Devnet";
  const usdcMint = USDC_MINT[solanaChainId];

  // Query for USDC balance
  const {
    data: usdcData,
    isLoading: usdcLoading,
    error: usdcError,
  } = useQuery({
    queryKey: ["solana-usdc-balance", publicKey?.toBase58(), solanaChainId],
    queryFn: async () => {
      if (!publicKey) return null;

      try {
        const mint = new PublicKey(usdcMint);
        const ata = await getAssociatedTokenAddress(mint, publicKey);
        const account = await getAccount(connection, ata);
        const balance = account.amount;
        const formatted = (Number(balance) / 1_000_000).toFixed(6);
        return { balance, formatted };
      } catch {
        // Account doesn't exist or has no USDC
        return { balance: BigInt(0), formatted: "0.000000" };
      }
    },
    enabled: enabled && connected && !!publicKey,
    refetchInterval,
    staleTime: 15000,
    gcTime: 60000,
  });

  // Query for native SOL balance
  const {
    data: solData,
    isLoading: solLoading,
    error: solError,
  } = useQuery({
    queryKey: ["solana-sol-balance", publicKey?.toBase58()],
    queryFn: async () => {
      if (!publicKey) return null;

      try {
        const lamports = await connection.getBalance(publicKey);
        const balance = BigInt(lamports);
        const formatted = (lamports / 1_000_000_000).toFixed(9);
        return { balance, formatted };
      } catch {
        return { balance: BigInt(0), formatted: "0.000000000" };
      }
    },
    enabled: enabled && connected && !!publicKey,
    refetchInterval,
    staleTime: 15000,
    gcTime: 60000,
  });

  // Refetch both balances
  const refetch = useCallback(() => {
    if (publicKey) {
      queryClient.invalidateQueries({
        queryKey: ["solana-usdc-balance", publicKey.toBase58()],
      });
      queryClient.invalidateQueries({
        queryKey: ["solana-sol-balance", publicKey.toBase58()],
      });
    }
  }, [publicKey, queryClient]);

  // Check if USDC balance is sufficient
  const hasSufficientBalance = useCallback(
    (amount: bigint) => {
      return usdcData?.balance ? usdcData.balance >= amount : false;
    },
    [usdcData?.balance]
  );

  return {
    usdcBalance: usdcData?.balance,
    usdcFormatted: usdcData?.formatted,
    solBalance: solData?.balance,
    solFormatted: solData?.formatted,
    isLoading: usdcLoading || solLoading,
    error: (usdcError || solError) as Error | null,
    refetch,
    publicKey: publicKey?.toBase58(),
    connected,
    hasSufficientBalance,
  };
};
