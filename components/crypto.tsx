"use client";
import "@rainbow-me/rainbowkit/styles.css";

import { getDefaultConfig, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";

import {
  mainnet,
  arbitrum,
  avalanche,
  goerli,
  avalancheFuji,
  arbitrumGoerli,
  optimism,
  polygon,
  base,
  localhost,
} from "wagmi/chains";

import { Toaster } from "./ui/toaster";
import { rpcs } from "@/constants/endpoints";

const config = getDefaultConfig({
  appName: "Vanilla CCTP",
  projectId: "0986356cfc85b6c59c45557e11c24451",
  // @ts-ignore
  chains: [
    mainnet,
    arbitrum,
    avalanche,
    optimism,
    polygon,
    base,
    localhost,
  ].map((chain) =>
    rpcs[chain.id]
      ? {
          ...chain,
          rpcUrls: {
            default: { http: [rpcs[chain.id]] },
          },
        }
      : chain
  ),
  ssr: true, // If your dApp uses server side rendering (SSR)
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
