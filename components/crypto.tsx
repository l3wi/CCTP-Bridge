"use client";
import "@rainbow-me/rainbowkit/styles.css";
import { getDefaultWallets, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { configureChains, createConfig, WagmiConfig } from "wagmi";
import {
  mainnet,
  arbitrum,
  avalanche,
  goerli,
  avalancheFuji,
  arbitrumGoerli,
} from "wagmi/chains";
import { publicProvider } from "wagmi/providers/public";
import { Toaster } from "./ui/toaster";

const { chains, publicClient } = configureChains(
  [mainnet, arbitrum, avalanche, goerli, avalancheFuji, arbitrumGoerli],
  [publicProvider()]
);

const { connectors } = getDefaultWallets({
  appName: "Vanilla CCTP",
  projectId: "0986356cfc85b6c59c45557e11c24451",
  chains,
});

const wagmiConfig = createConfig({
  autoConnect: true,
  connectors,
  publicClient,
});

export default function CryptoProivders({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <WagmiConfig config={wagmiConfig}>
      <RainbowKitProvider chains={chains}>
        {children}
        <Toaster />
      </RainbowKitProvider>
    </WagmiConfig>
  );
}
