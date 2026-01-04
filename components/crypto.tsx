"use client";
import "@rainbow-me/rainbowkit/styles.css";

import { getDefaultConfig, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";

import { Toaster } from "./ui/toaster";
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
          {children}
          <Toaster />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
