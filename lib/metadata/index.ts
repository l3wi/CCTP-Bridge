import generatedCctp from "@/lib/metadata/cctp.generated.json";
import type {
  BridgeEnvironment,
  GeneratedCctpMetadata,
  UniversalChainMetadata,
  EvmChainMetadata,
  SolanaChainMetadata,
} from "@/lib/metadata/types";
import type { ChainId, SolanaChainId } from "@/lib/types";
import { isSolanaChain } from "@/lib/types";

export type {
  BridgeEnvironment,
  UniversalChainMetadata,
  EvmChainMetadata,
  SolanaChainMetadata,
} from "@/lib/metadata/types";

const DEFAULT_ENV: BridgeEnvironment =
  process.env.NEXT_PUBLIC_BRIDGEKIT_ENV === "mainnet" ? "mainnet" : "testnet";

export const BRIDGEKIT_ENV: BridgeEnvironment = DEFAULT_ENV;

const metadata = generatedCctp as GeneratedCctpMetadata;

const byEnv = (env: BridgeEnvironment): UniversalChainMetadata[] =>
  metadata.chains.filter((chain) => chain.isTestnet === (env === "testnet"));

const findEvmChainById = (
  chainId: number,
  env: BridgeEnvironment = DEFAULT_ENV
): EvmChainMetadata | undefined => {
  const primary = byEnv(env).find(
    (chain): chain is EvmChainMetadata =>
      chain.type === "evm" && chain.chainId === chainId
  );
  if (primary) return primary;

  const fallbackEnv: BridgeEnvironment = env === "mainnet" ? "testnet" : "mainnet";
  return byEnv(fallbackEnv).find(
    (chain): chain is EvmChainMetadata =>
      chain.type === "evm" && chain.chainId === chainId
  );
};

const findSolanaChainById = (
  chainId: SolanaChainId,
  env: BridgeEnvironment = DEFAULT_ENV
): SolanaChainMetadata | undefined => {
  const primary = byEnv(env).find(
    (chain): chain is SolanaChainMetadata =>
      chain.type === "solana" && chain.chain === chainId
  );
  if (primary) return primary;

  const fallbackEnv: BridgeEnvironment = env === "mainnet" ? "testnet" : "mainnet";
  return byEnv(fallbackEnv).find(
    (chain): chain is SolanaChainMetadata =>
      chain.type === "solana" && chain.chain === chainId
  );
};

export const getAllSupportedChains = (
  env: BridgeEnvironment = DEFAULT_ENV
): UniversalChainMetadata[] => byEnv(env);

export const getSupportedEvmChains = (
  env: BridgeEnvironment = DEFAULT_ENV
): EvmChainMetadata[] =>
  byEnv(env).filter((chain): chain is EvmChainMetadata => chain.type === "evm");

export const getSupportedSolanaChains = (
  env: BridgeEnvironment = DEFAULT_ENV
): SolanaChainMetadata[] =>
  byEnv(env).filter(
    (chain): chain is SolanaChainMetadata => chain.type === "solana"
  );

export const resolveBridgeChain = (
  chainId: number,
  env: BridgeEnvironment = DEFAULT_ENV
): EvmChainMetadata => {
  const chain = findEvmChainById(chainId, env);
  if (!chain) {
    throw new Error(`Unsupported chain ${chainId}`);
  }
  return chain;
};

export const resolveBridgeChainUniversal = (
  chainId: ChainId,
  env: BridgeEnvironment = DEFAULT_ENV
): UniversalChainMetadata => {
  if (isSolanaChain(chainId)) {
    const chain = findSolanaChainById(chainId, env);
    if (!chain) {
      throw new Error(`Unsupported Solana chain ${chainId}`);
    }
    return chain;
  }

  return resolveBridgeChain(chainId, env);
};

export const getBridgeChainByIdUniversal = (
  chainId: ChainId,
  env: BridgeEnvironment = DEFAULT_ENV
): UniversalChainMetadata | undefined => {
  if (isSolanaChain(chainId)) return findSolanaChainById(chainId, env);
  return findEvmChainById(chainId, env);
};

export const getChainName = (
  chainId: ChainId,
  env: BridgeEnvironment = DEFAULT_ENV
): string => {
  const chain = getBridgeChainByIdUniversal(chainId, env);
  return chain?.name ?? String(chainId);
};

export const getExplorerTxUrl = (
  chainId: number,
  txHash: string,
  env: BridgeEnvironment = DEFAULT_ENV
): string | null => {
  const chain = findEvmChainById(chainId, env);
  if (!chain?.explorerUrl) return null;
  return chain.explorerUrl.replace("{hash}", txHash);
};

export const getExplorerTxUrlUniversal = (
  chainId: ChainId,
  txHash: string,
  env: BridgeEnvironment = DEFAULT_ENV
): string | null => {
  const chain = getBridgeChainByIdUniversal(chainId, env);
  if (!chain?.explorerUrl) return null;
  return chain.explorerUrl.replace("{hash}", txHash);
};

export const getUsdcAddressForChain = (
  chainId: number,
  env: BridgeEnvironment = DEFAULT_ENV
): `0x${string}` | undefined => {
  const chain = findEvmChainById(chainId, env);
  return chain?.usdcAddress as `0x${string}` | undefined;
};

export const getCctpConfirmationsUniversal = (
  chainId: ChainId,
  env: BridgeEnvironment = DEFAULT_ENV
): { standard?: number; fast?: number } | null => {
  const chain = getBridgeChainByIdUniversal(chainId, env);
  const v2 = chain?.cctp?.contracts?.v2;

  if (!v2) return null;
  return {
    standard: v2.confirmations,
    fast: v2.fastConfirmations,
  };
};

export const getChainIdFromDomainUniversal = (
  domain: number,
  env: BridgeEnvironment = DEFAULT_ENV
): ChainId | null => {
  const chain = byEnv(env).find((item) => item.cctp?.domain === domain);
  if (!chain) return null;
  if (chain.type === "solana") return chain.chain;
  return chain.chainId;
};

export const getCctpDomainIdUniversal = (
  chainId: ChainId,
  env: BridgeEnvironment = DEFAULT_ENV
): number | null => {
  const chain = getBridgeChainByIdUniversal(chainId, env);
  return chain?.cctp?.domain ?? null;
};
