import { http, type Chain, type Transport } from "viem";
import type {
  BridgeEnvironment,
  EvmChainMetadata,
  SolanaChainMetadata,
  UniversalChainMetadata,
} from "@/lib/metadata/types";
import { BRIDGEKIT_ENV, getSupportedEvmChains } from "@/lib/metadata/index";
import {
  getPreferredEvmRpcUrl,
  getRotatingEvmTransport,
} from "@/lib/rpc/router";

export type {
  BridgeEnvironment,
  EvmChainMetadata,
  SolanaChainMetadata,
  UniversalChainMetadata,
};
export type EvmChainDefinition = EvmChainMetadata;
export type SolanaChainDefinition = SolanaChainMetadata;
export type UniversalChainDefinition = UniversalChainMetadata;

export {
  BRIDGEKIT_ENV,
  getSupportedEvmChains,
  getAllSupportedChains,
  resolveBridgeChain,
  resolveBridgeChainUniversal,
  getBridgeChainByIdUniversal,
  getExplorerTxUrl,
  getExplorerTxUrlUniversal,
  getChainName,
  getUsdcAddressForChain,
  getUsdcAddressByDomain,
  getCctpConfirmationsUniversal,
} from "@/lib/metadata/index";
export { getSolanaRpcEndpoint } from "@/lib/rpc/router";
export { getProviderFromWalletClient } from "@/lib/rpc/clients";

type NonEmptyChains = [Chain, ...Chain[]];

const formatExplorerBaseUrl = (url?: string) => {
  if (!url) return null;
  const [base] = url.split("/tx/");
  return base.replace("{hash}", "").replace(/\/$/, "");
};

const mapMetadataToViemChain = (
  chain: EvmChainMetadata
): Chain => {
  const rpcUrl = getPreferredEvmRpcUrl(chain.chainId);
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

export const getWagmiChainsForEnv = (
  env: BridgeEnvironment = BRIDGEKIT_ENV
): NonEmptyChains => {
  const chains = getSupportedEvmChains(env).map((chain) => mapMetadataToViemChain(chain));
  if (!chains.length) {
    throw new Error(`No supported EVM chains found for env ${env}`);
  }

  const [first, ...rest] = chains;
  return [first, ...rest] as NonEmptyChains;
};

export const getWagmiTransportsForEnv = (
  env: BridgeEnvironment = BRIDGEKIT_ENV
): Record<number, Transport> => {
  const chains = getSupportedEvmChains(env);

  return chains.reduce<Record<number, Transport>>((acc, chain) => {
    const preferred = getPreferredEvmRpcUrl(chain.chainId);
    if (preferred) {
      acc[chain.chainId] = getRotatingEvmTransport(chain.chainId, env);
    } else {
      acc[chain.chainId] = http();
    }
    return acc;
  }, {});
};
