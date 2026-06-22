"use client";

import { ChangelogModal } from "@/components/changelog-modal";
import { HistoryModal } from "@/components/history-modal";
import { SolanaWalletConnect } from "@/components/solana-wallet-connect";
import { WalletConnect } from "@/components/wallet-connect";

export function BridgeShellActions() {
  return (
    <div className="absolute right-4 top-4 z-20 flex items-center gap-2">
      <ChangelogModal />
      <HistoryModal />
      <SolanaWalletConnect />
      <WalletConnect />
    </div>
  );
}
