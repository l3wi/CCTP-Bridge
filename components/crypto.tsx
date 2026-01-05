"use client";

// Polyfill BigInt serialization for JSON.stringify
// Required for Solana/Bridge Kit SDK which uses BigInt internally
if (typeof BigInt !== "undefined" && !(BigInt.prototype as unknown as { toJSON?: unknown }).toJSON) {
  (BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
    return this.toString();
  };
}

import "@rainbow-me/rainbowkit/styles.css";

import { getDefaultConfig, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";

import { Toaster } from "./ui/toaster";
import { SolanaProvider } from "./solana-provider";
import {
  BRIDGEKIT_ENV,
  getWagmiChainsForEnv,
  getWagmiTransportsForEnv,
} from "@/lib/bridgeKit";

const wagmiChains = getWagmiChainsForEnv(BRIDGEKIT_ENV);
const wagmiTransports = getWagmiTransportsForEnv(BRIDGEKIT_ENV);

const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
if (!walletConnectProjectId) {
  throw new Error(
    "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID environment variable is required"
  );
}

const config = getDefaultConfig({
  appName: "Vanilla CCTP",
  projectId: walletConnectProjectId,
  chains: wagmiChains,
  transports: wagmiTransports,
  batch: {
    multicall: true,
  },
  ssr: true,
});
const queryClient = new QueryClient();

export default function CryptoProviders({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          <SolanaProvider>
            {children}
            <Toaster />
          </SolanaProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
