"use client";

import { useState } from "react";
import { BridgeCard } from "@/components/bridge-card";
import { WalletConnect } from "@/components/wallet-connect";
import { HistoryModal } from "@/components/history-modal";
import { LocalTransaction } from "@/lib/types";

export default function Home() {
  const [loadedTransaction, setLoadedTransaction] =
    useState<LocalTransaction | null>(null);

  const handleLoadBridging = (transaction: LocalTransaction) => {
    setLoadedTransaction(transaction);
  };

  const handleBackToNew = () => {
    setLoadedTransaction(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4 relative">
      {/* Top right controls */}
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <HistoryModal onLoadBridging={handleLoadBridging} />
        <WalletConnect />
      </div>

      <div className="w-full max-w-md">
        {/* Floating Header */}
        <div className="mb-4">
          <h1 className="relative inline-block text-3xl font-bold text-white pb-2 ">
            USDC Bridge
            <span className="absolute text-xs text-blue-500 -top-3 -right-18 transform rotate-15 bg-slate-800/50 px-2 py-1 rounded-md">
              Now with CCTP v2!
            </span>
          </h1>

          <div className="text-xs text-slate-500">
            A fast USDC bridge directly powered by CCTP.
          </div>
        </div>
        <BridgeCard
          loadedTransaction={loadedTransaction}
          onBackToNew={handleBackToNew}
        />
      </div>
    </div>
  );
}
