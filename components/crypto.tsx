"use client";

// Polyfill BigInt serialization for JSON.stringify
// Required for Solana/Bridge Kit SDK which uses BigInt internally
if (typeof BigInt !== "undefined" && !(BigInt.prototype as unknown as { toJSON?: unknown }).toJSON) {
  (BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
    return this.toString();
  };
}

type StorageLike = {
  getItem?: (key: string) => string | null;
  setItem?: (key: string, value: string) => void;
  removeItem?: (key: string) => void;
};

const ensureStorageApi = (storageKey: "localStorage" | "sessionStorage") => {
  try {
    const current = (globalThis as Record<string, unknown>)[storageKey] as StorageLike | undefined;
    if (
      current &&
      typeof current.getItem === "function" &&
      typeof current.setItem === "function" &&
      typeof current.removeItem === "function"
    ) {
      return;
    }

    const noopStorage = {
      getItem: (_key: string) => null,
      setItem: (_key: string, _value: string) => {},
      removeItem: (_key: string) => {},
      clear: () => {},
      key: (_index: number) => null,
      length: 0,
    };

    Object.defineProperty(globalThis, storageKey, {
      configurable: true,
      writable: true,
      value: noopStorage,
    });
  } catch {
    // Ignore: best-effort server-side compatibility shim.
  }
};

if (typeof window === "undefined") {
  ensureStorageApi("localStorage");
  ensureStorageApi("sessionStorage");
}

import "@rainbow-me/rainbowkit/styles.css";

import { getDefaultConfig, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { createConfig, WagmiProvider } from "wagmi";

import { Toaster } from "./ui/toaster";
import { SolanaProvider } from "./solana-provider";
import {
  BRIDGEKIT_ENV,
  getWagmiChainsForEnv,
  getWagmiTransportsForEnv,
} from "@/lib/bridgeKit";

const queryClient = new QueryClient();
let serverWagmiConfig: ReturnType<typeof createConfig> | null = null;
let clientWagmiConfig: ReturnType<typeof getDefaultConfig> | null = null;

const getServerWagmiConfig = () => {
  if (serverWagmiConfig) {
    return serverWagmiConfig;
  }

  serverWagmiConfig = createConfig({
    chains: getWagmiChainsForEnv(BRIDGEKIT_ENV),
    transports: getWagmiTransportsForEnv(BRIDGEKIT_ENV),
    ssr: true,
  });

  return serverWagmiConfig;
};

const getClientWagmiConfig = () => {
  if (clientWagmiConfig) {
    return clientWagmiConfig;
  }

  const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
  if (!walletConnectProjectId) {
    throw new Error(
      "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID environment variable is required"
    );
  }

  clientWagmiConfig = getDefaultConfig({
    appName: "Vanilla CCTP",
    projectId: walletConnectProjectId,
    chains: getWagmiChainsForEnv(BRIDGEKIT_ENV),
    transports: getWagmiTransportsForEnv(BRIDGEKIT_ENV),
    batch: {
      multicall: true,
    },
    ssr: true,
  });

  return clientWagmiConfig;
};

export default function CryptoProviders({
  children,
}: {
  children: React.ReactNode;
}) {
  const config = typeof window === "undefined"
    ? getServerWagmiConfig()
    : getClientWagmiConfig();

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
