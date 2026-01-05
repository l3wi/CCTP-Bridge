"use client";

import { FC, ReactNode, useCallback, useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import type { WalletError, Adapter } from "@solana/wallet-adapter-base";
import { BRIDGEKIT_ENV, getSolanaRpcEndpoint } from "@/lib/bridgeKit";

// Import wallet adapter styles
import "@solana/wallet-adapter-react-ui/styles.css";

interface SolanaProviderProps {
  children: ReactNode;
}

/**
 * Solana wallet provider component that wraps the application with
 * ConnectionProvider, WalletProvider, and WalletModalProvider.
 *
 * Uses the appropriate Solana network based on BRIDGEKIT_ENV:
 * - mainnet -> Solana mainnet-beta
 * - testnet -> Solana Devnet
 */
export const SolanaProvider: FC<SolanaProviderProps> = ({ children }) => {
  // Determine Solana chain based on Bridge Kit environment
  const solanaChainId = BRIDGEKIT_ENV === "mainnet" ? "Solana" : "Solana_Devnet";

  // Get RPC endpoint from Bridge Kit (supports overrides)
  const endpoint = useMemo(
    () => getSolanaRpcEndpoint(solanaChainId),
    [solanaChainId]
  );

  // Initialize wallet adapters
  // These will auto-detect installed wallets
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );

  // Error handler for wallet operations
  const onError = useCallback((error: WalletError, adapter?: Adapter) => {
    console.error("Solana wallet error:", error.message, adapter?.name);
  }, []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} onError={onError} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};

export default SolanaProvider;
