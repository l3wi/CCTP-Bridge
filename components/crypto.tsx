"use client";
import "@rainbow-me/rainbowkit/styles.css";

import { getDefaultConfig, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { http, WagmiProvider } from "wagmi";

import {
  mainnet,
  arbitrum,
  avalanche,
  worldchain,
  sonic,
  linea,
  unichain,
  goerli,
  avalancheFuji,
  arbitrumGoerli,
  optimism,
  polygon,
  base,
  localhost,
} from "wagmi/chains";

import { Toaster } from "./ui/toaster";

const config = getDefaultConfig({
  appName: "Vanilla CCTP",
  projectId: "0986356cfc85b6c59c45557e11c24451",
  chains: [
    mainnet,
    arbitrum,
    avalanche,
    optimism,
    polygon,
    base,
    localhost,
    worldchain,
    sonic,
    linea,
    unichain,
  ],
  batch: {
    multicall: true,
  },
  ssr: true,
});
const queryClient = new QueryClient();

export default function CryptoProivders({
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
