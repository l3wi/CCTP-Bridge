"use client";

import type { ReactNode } from "react";
import AnimatedBackground from "@/components/animated-bg";
import ErrorBoundary from "@/components/ErrorBoundary";
import { BridgeErrorFallback } from "@/components/bridge/BridgeErrorFallback";
import { ChangelogModal } from "@/components/changelog-modal";
import { HistoryModal } from "@/components/history-modal";
import { SolanaWalletConnect } from "@/components/solana-wallet-connect";
import { WalletConnect } from "@/components/wallet-connect";

interface BridgePageShellProps {
  children: ReactNode;
}

export function BridgePageShell({ children }: BridgePageShellProps) {
  return (
    <AnimatedBackground>
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <ChangelogModal />
        <HistoryModal />
        <SolanaWalletConnect />
        <WalletConnect />
      </div>

      <div className="w-full max-w-xl min-h-[640px] pt-16 md:pt-5 pb-12 md:pb-0">
        <div className="mb-4">
          <h1 className="relative inline-block text-4xl font-bold text-white pb-2 ">
            CCTP Bridge
            <span className="hidden md:block absolute text-xs text-blue-500 -top-[7px] -right-[70px] transform rotate-15 bg-slate-800/50 px-2 py-1 rounded-md">
              {`Now with Solana!`}
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
          {children}
        </ErrorBoundary>
      </div>
    </AnimatedBackground>
  );
}
