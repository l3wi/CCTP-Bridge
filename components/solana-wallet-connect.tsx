"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Button } from "@/components/ui/button";
import { Wallet } from "lucide-react";

/**
 * Solana wallet connection button component.
 * Shows "Connect Solana" when disconnected, truncated address when connected.
 */
export function SolanaWalletConnect() {
  const { publicKey, disconnect, connected, connecting } = useWallet();
  const { setVisible } = useWalletModal();

  if (!connected) {
    return (
      <Button
        onClick={() => setVisible(true)}
        variant="outline"
        className="bg-purple-800/50 border-purple-600/50 text-white hover:bg-purple-700/50 hover:border-purple-500/50"
        disabled={connecting}
      >
        <Wallet className="h-4 w-4 mr-2" />
        {connecting ? "Connecting..." : "Connect Solana"}
      </Button>
    );
  }

  // Format address: first 4 + ... + last 4
  const displayAddress = publicKey
    ? `${publicKey.toBase58().slice(0, 4)}...${publicKey.toBase58().slice(-4)}`
    : "";

  return (
    <Button
      onClick={() => disconnect()}
      variant="outline"
      className="bg-purple-800/50 border-purple-600/50 text-white hover:bg-purple-700/50 hover:border-purple-500/50"
      title={publicKey?.toBase58()}
    >
      <Wallet className="h-4 w-4 mr-2" />
      {displayAddress}
    </Button>
  );
}

export default SolanaWalletConnect;
