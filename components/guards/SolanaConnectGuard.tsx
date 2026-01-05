"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import React from "react";
import { Button } from "../ui/button";

interface SolanaConnectGuardProps {
  children?: React.ReactNode;
  /** Custom message to show when not connected */
  message?: string;
}

/**
 * Guard component that shows children only when a Solana wallet is connected.
 * Otherwise shows a connect button.
 */
export default function SolanaConnectGuard({
  children,
  message = "Connect Solana Wallet",
}: SolanaConnectGuardProps) {
  const { connected, connecting } = useWallet();
  const { setVisible } = useWalletModal();

  if (connected) {
    return <>{children}</>;
  }

  return (
    <Button
      className="w-full bg-purple-600 hover:bg-purple-700 text-white font-medium py-3"
      onClick={() => setVisible(true)}
      disabled={connecting}
    >
      {connecting ? "Connecting..." : message}
    </Button>
  );
}

export { SolanaConnectGuard };
