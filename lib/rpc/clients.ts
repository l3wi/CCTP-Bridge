import { Connection } from "@solana/web3.js";
import { createPublicClient, type Chain, type EIP1193Provider } from "viem";
import type { WalletClient } from "viem";
import type { BridgeEnvironment, EvmChainMetadata } from "@/lib/metadata/types";
import { BRIDGEKIT_ENV, resolveBridgeChain } from "@/lib/metadata/index";
import { getWalletFirstEvmTransport, getSolanaRpcEndpoint } from "@/lib/rpc/router";
import type { SolanaChainId } from "@/lib/types";

const DEFAULT_ENV: BridgeEnvironment = BRIDGEKIT_ENV;

const formatExplorerBaseUrl = (url?: string) => {
  if (!url) return undefined;
  const [base] = url.split("/tx/");
  return base.replace("{hash}", "").replace(/\/$/, "");
};

const mapChainToViem = (
  chain: EvmChainMetadata,
  rpcUrl?: string
): Chain => {
  const explorerBase = formatExplorerBaseUrl(chain.explorerUrl);

  return {
    id: chain.chainId,
    name: chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: {
      default: { http: rpcUrl ? [rpcUrl] : [] },
      public: { http: rpcUrl ? [rpcUrl] : [] },
    },
    blockExplorers: explorerBase
      ? {
          default: {
            name: `${chain.name} Explorer`,
            url: explorerBase,
          },
        }
      : undefined,
    testnet: chain.isTestnet,
  };
};

export const getProviderFromWalletClient = (
  walletClient?: WalletClient
): EIP1193Provider | undefined => {
  if (!walletClient) return undefined;

  const transportProvider = walletClient.transport as unknown as EIP1193Provider;
  if (transportProvider && typeof transportProvider.request === "function") {
    return transportProvider;
  }

  const maybeValue = (walletClient.transport as { value?: unknown })?.value;
  if (
    maybeValue &&
    typeof maybeValue === "object" &&
    "request" in maybeValue &&
    typeof (maybeValue as { request?: unknown }).request === "function"
  ) {
    return maybeValue as EIP1193Provider;
  }

  return undefined;
};

export const createEvmPublicClient = (
  chainId: number,
  opts?: {
    walletClient?: WalletClient;
    env?: BridgeEnvironment;
  }
) => {
  const env = opts?.env ?? DEFAULT_ENV;
  const chain = resolveBridgeChain(chainId, env);
  const walletProvider = getProviderFromWalletClient(opts?.walletClient);
  const walletChainId = opts?.walletClient?.chain?.id;
  const transport = getWalletFirstEvmTransport(
    chainId,
    walletProvider,
    walletChainId,
    env
  );
  const viemChain = mapChainToViem(chain);

  return createPublicClient({
    chain: viemChain,
    transport,
  });
};

export const createSolanaConnection = (
  chainId: SolanaChainId,
  commitment: "processed" | "confirmed" | "finalized" = "confirmed",
  env: BridgeEnvironment = DEFAULT_ENV
) => {
  const endpoint = getSolanaRpcEndpoint(chainId, env);
  return new Connection(endpoint, commitment);
};
