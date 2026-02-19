import { http, type Chain, type Transport, type WalletClient } from "viem";
import type { ChainId, SolanaChainId } from "@/lib/types";
import type {
  BridgeEnvironment,
  EvmChainMetadata,
  SolanaChainMetadata,
  UniversalChainMetadata,
} from "@/lib/metadata/types";
import {
  BRIDGEKIT_ENV as METADATA_ENV,
  getAllSupportedChains as getAllSupportedChainsFromMetadata,
  getSupportedEvmChains as getSupportedEvmChainsFromMetadata,
  resolveBridgeChain as resolveBridgeChainFromMetadata,
  resolveBridgeChainUniversal as resolveBridgeChainUniversalFromMetadata,
  getBridgeChainByIdUniversal as getBridgeChainByIdUniversalFromMetadata,
  getExplorerTxUrl as getExplorerTxUrlFromMetadata,
  getExplorerTxUrlUniversal as getExplorerTxUrlUniversalFromMetadata,
  getChainName as getChainNameFromMetadata,
  getUsdcAddressByDomain as getUsdcAddressByDomainFromMetadata,
  getUsdcAddressForChain as getUsdcAddressForChainFromMetadata,
  getCctpConfirmationsUniversal as getCctpConfirmationsUniversalFromMetadata,
} from "@/lib/metadata/index";
import {
  getPreferredEvmRpcUrl as getPreferredEvmRpcUrlFromRouter,
  getRotatingEvmTransport,
  getSolanaRpcEndpoint as getSolanaRpcEndpointFromRouter,
} from "@/lib/rpc/router";
import { getProviderFromWalletClient as getProviderFromWalletClientFromRpc } from "@/lib/rpc/clients";

export type {
  BridgeEnvironment,
  EvmChainMetadata,
  SolanaChainMetadata,
  UniversalChainMetadata,
};
export type EvmChainDefinition = EvmChainMetadata;
export type SolanaChainDefinition = SolanaChainMetadata;
export type UniversalChainDefinition = UniversalChainMetadata;

type NonEmptyChains = [Chain, ...Chain[]];
export const BRIDGEKIT_ENV: BridgeEnvironment = METADATA_ENV;

const formatExplorerBaseUrl = (url?: string) => {
  if (!url) return null;
  const [base] = url.split("/tx/");
  return base.replace("{hash}", "").replace(/\/$/, "");
};

const mapMetadataToViemChain = (
  chain: EvmChainMetadata,
  env: BridgeEnvironment = BRIDGEKIT_ENV
): Chain => {
  const rpcUrl = getPreferredEvmRpcUrlFromRouter(chain.chainId, env);
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

export const getSupportedEvmChains = (
  env: BridgeEnvironment = BRIDGEKIT_ENV
): EvmChainMetadata[] => getSupportedEvmChainsFromMetadata(env);

export const getAllSupportedChains = (
  env: BridgeEnvironment = BRIDGEKIT_ENV
): UniversalChainMetadata[] => getAllSupportedChainsFromMetadata(env);

export const resolveBridgeChain = (
  chainId: number,
  env: BridgeEnvironment = BRIDGEKIT_ENV
): EvmChainMetadata => resolveBridgeChainFromMetadata(chainId, env);

export const resolveBridgeChainUniversal = (
  chainId: ChainId,
  env: BridgeEnvironment = BRIDGEKIT_ENV
): UniversalChainMetadata => resolveBridgeChainUniversalFromMetadata(chainId, env);

export const getBridgeChainByIdUniversal = (
  chainId: ChainId,
  env: BridgeEnvironment = BRIDGEKIT_ENV
): UniversalChainMetadata | undefined =>
  getBridgeChainByIdUniversalFromMetadata(chainId, env);

export const getExplorerTxUrl = (
  chainId: number,
  txHash: string,
  env: BridgeEnvironment = BRIDGEKIT_ENV
): string | null => getExplorerTxUrlFromMetadata(chainId, txHash, env);

export const getExplorerTxUrlUniversal = (
  chainId: ChainId,
  txHash: string,
  env: BridgeEnvironment = BRIDGEKIT_ENV
): string | null => getExplorerTxUrlUniversalFromMetadata(chainId, txHash, env);

export const getChainName = (
  chainId: ChainId,
  env: BridgeEnvironment = BRIDGEKIT_ENV
): string => getChainNameFromMetadata(chainId, env);

export const getUsdcAddressForChain = (
  chainId: number,
  env: BridgeEnvironment = BRIDGEKIT_ENV
): `0x${string}` | undefined => getUsdcAddressForChainFromMetadata(chainId, env);

export const getUsdcAddressByDomain = (
  domain: number,
  env: BridgeEnvironment = BRIDGEKIT_ENV
): `0x${string}` | undefined => getUsdcAddressByDomainFromMetadata(domain, env);

export const getCctpConfirmationsUniversal = (
  chainId: ChainId,
  env: BridgeEnvironment = BRIDGEKIT_ENV
): { standard?: number; fast?: number } | null =>
  getCctpConfirmationsUniversalFromMetadata(chainId, env);

export const getWagmiChainsForEnv = (
  env: BridgeEnvironment = BRIDGEKIT_ENV
): NonEmptyChains => {
  const chains = getSupportedEvmChainsFromMetadata(env).map((chain) =>
    mapMetadataToViemChain(chain, env)
  );
  if (!chains.length) {
    throw new Error(`No supported EVM chains found for env ${env}`);
  }

  const [first, ...rest] = chains;
  return [first, ...rest] as NonEmptyChains;
};

export const getWagmiTransportsForEnv = (
  env: BridgeEnvironment = BRIDGEKIT_ENV
): Record<number, Transport> => {
  const chains = getSupportedEvmChainsFromMetadata(env);

  return chains.reduce<Record<number, Transport>>((acc, chain) => {
    const preferred = getPreferredEvmRpcUrlFromRouter(chain.chainId, env);
    if (preferred) {
      acc[chain.chainId] = getRotatingEvmTransport(chain.chainId, env);
    } else {
      acc[chain.chainId] = http();
    }
    return acc;
  }, {});
};

export const getPreferredEvmRpcUrl = (
  chainId: number,
  env: BridgeEnvironment = BRIDGEKIT_ENV
): string | undefined => getPreferredEvmRpcUrlFromRouter(chainId, env);

export const getSolanaRpcEndpoint = (
  chainId: SolanaChainId,
  env: BridgeEnvironment = BRIDGEKIT_ENV
): string => getSolanaRpcEndpointFromRouter(chainId, env);

export const getProviderFromWalletClient = (
  walletClient?: WalletClient
) => getProviderFromWalletClientFromRpc(walletClient);
