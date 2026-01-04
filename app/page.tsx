"use client";

import { useState } from "react";
import { BridgeCard } from "@/components/bridge-card";
import { WalletConnect } from "@/components/wallet-connect";
import { HistoryModal } from "@/components/history-modal";
import { LocalTransaction } from "@/lib/types";
import AnimatedBackground from "@/components/animated-bg";
import ErrorBoundary from "@/components/ErrorBoundary";
import { BridgeErrorFallback } from "@/components/bridge/BridgeErrorFallback";

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
    <AnimatedBackground>
      {/* Top right controls */}
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <HistoryModal onLoadBridging={handleLoadBridging} />
        <WalletConnect />
      </div>

      <div className="w-full max-w-md pt-5">
        {/* Floating Header */}
        <div className="mb-4">
          <h1 className="relative inline-block text-4xl font-bold text-white pb-2 ">
            CCTP Bridge
            <span className="hidden md:block absolute text-xs text-blue-500 -top-3 -right-15 transform rotate-15 bg-slate-800/50 px-2 py-1 rounded-md">
              {`Now using v2!`}
            </span>
          </h1>

          <div className="text-xs text-slate-500">
            {`A native USDC bridge powered by Circle's CCTP infrastructure.`}
          </div>
        </div>
        <ErrorBoundary
          fallback={({ error, retry }) => (
            <BridgeErrorFallback error={error} resetErrorBoundary={retry} />
          )}
        >
          <BridgeCard
            loadedTransaction={loadedTransaction}
            onBackToNew={handleBackToNew}
          />
        </ErrorBoundary>
      </div>
    </AnimatedBackground>
  );
}
