import {
  BridgeKit,
  TransferSpeed,
  type ChainDefinition,
  type BridgeParams,
} from "@circle-fin/bridge-kit";
import { createViemAdapterFromProvider } from "@circle-fin/adapter-viem-v2";
import { createPublicClient, http } from "viem";
import type { Chain, EIP1193Provider, Transport, WalletClient } from "viem";
import {
  type ChainId,
  type SolanaChainId,
  type ChainType,
  isSolanaChain,
  getChainType,
} from "./types";

export type BridgeEnvironment = "mainnet" | "testnet";
type EvmChainDefinition = ChainDefinition & {
  type: "evm";
  chainId: number;
  rpcUrls?: { default?: { http?: string[] } };
};

// Solana chain definition from Bridge Kit
// The SDK uses string "solana" as the type, extending ChainDefinition
export interface SolanaChainDefinition {
  type: "solana";
  chain: SolanaChainId;
  name: string;
  isTestnet: boolean;
  explorerUrl?: string;
  usdcAddress?: string;
  eurcAddress?: string; // Required by SDK ChainDefinition
  rpcEndpoints?: string[];
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  cctp?: {
    contracts?: {
      v2?: {
        confirmations?: number;
        fastConfirmations?: number;
      };
    };
  };
}

// Supports both EVM (numeric) and Solana (string) chain IDs
type RpcOverrideMap = Record<number | string, string>;

type CustomFeeConfig = {
  value: string;
  recipient: string;
};

type BridgeKitAdapter = BridgeParams["from"]["adapter"];
type NonEmptyChains = [Chain, ...Chain[]];

const DEFAULT_ENV: BridgeEnvironment =
  process.env.NEXT_PUBLIC_BRIDGEKIT_ENV === "mainnet" ? "mainnet" : "testnet";
export const BRIDGEKIT_ENV: BridgeEnvironment = DEFAULT_ENV;

const rpcOverrides = parseRpcOverrides(
  process.env.NEXT_PUBLIC_BRIDGEKIT_RPC_OVERRIDES
);
const customFeeConfig = parseCustomFeeConfig();

const kitByEnv: Partial<Record<BridgeEnvironment, BridgeKit>> = {};

export const getBridgeKit = (
  env: BridgeEnvironment = DEFAULT_ENV
): BridgeKit => {
  if (!kitByEnv[env]) {
    const kit = new BridgeKit();

    if (customFeeConfig) {
      kit.setCustomFeePolicy({
        computeFee: () => customFeeConfig.value,
        resolveFeeRecipientAddress: () => customFeeConfig.recipient,
      });
    }

    kitByEnv[env] = kit;
  }

  return kitByEnv[env]!;
};

export const getSupportedEvmChains = (
  env: BridgeEnvironment = DEFAULT_ENV
): EvmChainDefinition[] => {
  return getBridgeKit(env)
    .getSupportedChains()
    .filter(
      (chain): chain is EvmChainDefinition =>
        chain.type === "evm" && chain.isTestnet === (env === "testnet")
    );
};

const getBridgeChainById = (
  chainId: number,
  env: BridgeEnvironment = DEFAULT_ENV
) => {
  const primary = getSupportedEvmChains(env).find(
    (chain) => chain.chainId === chainId
  );
  if (primary) return primary;

  const fallbackEnv: BridgeEnvironment = env === "mainnet" ? "testnet" : "mainnet";
  return getSupportedEvmChains(fallbackEnv).find(
    (chain) => chain.chainId === chainId
  );
};

const getChainIdentifier = (
  chainId: number,
  env: BridgeEnvironment = DEFAULT_ENV
) => getBridgeChainById(chainId, env)?.chain;

export const resolveBridgeChain = (
  chainId: number,
  env: BridgeEnvironment = DEFAULT_ENV
): ChainDefinition => {
  const chain = getBridgeChainById(chainId, env);
  if (!chain) {
    throw new Error(`Unsupported chain ${chainId} for Bridge Kit`);
  }
  return chain;
};

const getCctpConfirmations = (
  chainId: number,
  env: BridgeEnvironment = DEFAULT_ENV
): { standard?: number; fast?: number } | null => {
  const chain = getBridgeChainById(chainId, env);
  const contracts = chain?.cctp?.contracts?.v2;
  if (!contracts) return null;
  return {
    standard: contracts.confirmations,
    fast: (contracts as { fastConfirmations?: number }).fastConfirmations,
  };
};

export const getExplorerTxUrl = (
  chainId: number,
  txHash: string,
  env: BridgeEnvironment = DEFAULT_ENV
) => {
  const chain = getBridgeChainById(chainId, env);
  if (!chain?.explorerUrl) return null;
  return chain.explorerUrl.replace("{hash}", txHash);
};

export const getUsdcAddressForChain = (
  chainId: number,
  env: BridgeEnvironment = DEFAULT_ENV
) => getBridgeChainById(chainId, env)?.usdcAddress as
  | `0x${string}`
  | undefined;

const formatExplorerBaseUrl = (url?: string) => {
  if (!url) return null;
  const [base] = url.split("/tx/");
  return base.replace("{hash}", "").replace(/\/$/, "");
};

const mapBridgeChainToViem = (chain: EvmChainDefinition): Chain => {
  const rpcUrls = chain.rpcEndpoints?.length
    ? chain.rpcEndpoints
    : chain.rpcUrls?.default?.http ?? [];

  const explorerBase = formatExplorerBaseUrl(chain.explorerUrl);

  return {
    id: chain.chainId,
    name: chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: {
      default: { http: rpcUrls },
      public: { http: rpcUrls },
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
  env: BridgeEnvironment = DEFAULT_ENV
): NonEmptyChains => {
  const uniqueChains = new Map<number, Chain>();

  getSupportedEvmChains(env).forEach((bridgeChain) => {
    uniqueChains.set(bridgeChain.chainId, mapBridgeChainToViem(bridgeChain));
  });

  const wagmiChains = Array.from(uniqueChains.values());

  if (!wagmiChains.length) {
    throw new Error(`No Bridge Kit EVM chains found for env ${env}`);
  }

  const [first, ...rest] = wagmiChains;

  return [first, ...rest] as NonEmptyChains;
};

export const getWagmiTransportsForEnv = (
  env: BridgeEnvironment = DEFAULT_ENV
): Record<number, Transport> => {
  const chains = getWagmiChainsForEnv(env);

  return chains.reduce<Record<number, Transport>>((acc, chain) => {
    const rpcUrl = resolveRpcUrl(chain);
    acc[chain.id] = rpcUrl ? http(rpcUrl) : http();
    return acc;
  }, {});
};

const getDefaultTransferSpeed = () => {
  const configured = process.env.NEXT_PUBLIC_BRIDGEKIT_TRANSFER_SPEED;
  return configured === TransferSpeed.SLOW ? TransferSpeed.SLOW : TransferSpeed.FAST;
};

const createViemAdapter = async (
  provider: EIP1193Provider,
  env: BridgeEnvironment = DEFAULT_ENV
): Promise<BridgeKitAdapter> => {
  const supportedChains = getSupportedEvmChains(env);

  const adapter = await createViemAdapterFromProvider({
    provider,
    capabilities: { supportedChains },
    getPublicClient: ({ chain }) => createRpcClient(chain),
  });

  return adapter as BridgeKitAdapter;
};

const createReadonlyProvider = (chain: Chain | EvmChainDefinition) => {
  const rpcUrl = resolveRpcUrl(chain);
  const viemChain =
    "id" in chain
      ? (chain as Chain)
      : {
          id: chain.chainId,
          name: chain.name,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: {
            default: { http: rpcUrl ? [rpcUrl] : [] },
            public: { http: rpcUrl ? [rpcUrl] : [] },
          },
          blockExplorers: undefined,
          testnet: chain.isTestnet,
        };

  const client = createPublicClient({
    chain: viemChain,
    transport: rpcUrl ? http(rpcUrl) : http(),
  });

  const placeholderAccount = "0x0000000000000000000000000000000000000000";

  return {
    request: async ({ method, params }: { method: string; params?: any[] }) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts") {
        return [placeholderAccount];
      }
      /**
       * Cast required: EIP1193Provider.request() expects `readonly unknown[]` for params,
       * but viem's PublicClient.request() uses stricter generic types. The runtime
       * behavior is identical; this bridges the type incompatibility.
       */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return client.request({ method, params } as any);
    },
  } as EIP1193Provider;
};

export const createReadonlyAdapter = async (
  chainId: number,
  env: BridgeEnvironment = DEFAULT_ENV
): Promise<BridgeKitAdapter> => {
  const supportedChains = getSupportedEvmChains(env);
  const preferredChain = supportedChains.find((chain) => chain.chainId === chainId);
  if (!preferredChain) {
    throw new Error(`Unsupported EVM chain ${chainId} for Bridge Kit`);
  }
  const provider = createReadonlyProvider(preferredChain);

  const adapter = await createViemAdapterFromProvider({
    provider,
    capabilities: { supportedChains },
    getPublicClient: ({ chain }) => createRpcClient(chain),
  });

  return adapter as BridgeKitAdapter;
};

const createRpcClient = (chain: Chain | EvmChainDefinition) => {
  const chainId = "id" in chain ? chain.id : chain.chainId;

  const rpcUrl = resolveRpcUrl(chain);

  const isTestnet = "isTestnet" in chain ? chain.isTestnet : !!chain.testnet;

  const viemChain: Chain = {
    id: chainId,
    name: chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: {
      default: { http: rpcUrl ? [rpcUrl] : [] },
      public: { http: rpcUrl ? [rpcUrl] : [] },
    },
    blockExplorers: undefined,
    testnet: isTestnet,
  };

  return createPublicClient({
    chain: viemChain,
    transport: rpcUrl ? http(rpcUrl) : http(),
  });
};

function isValidUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function parseRpcOverrides(raw: string | undefined): RpcOverrideMap | null {
  if (!raw) return null;

  return raw.split(",").reduce<RpcOverrideMap>((acc, entry) => {
    const [rawId, url] = entry.split("=").map((value) => value.trim());

    if (!rawId || !url) return acc;

    if (!isValidUrl(url)) {
      console.warn(`Invalid RPC URL for chain ${rawId}: ${url}`);
      return acc;
    }

    // Check if it's a Solana chain ID (string like "Solana" or "Solana_Devnet")
    if (rawId.startsWith("Solana")) {
      acc[rawId] = url;
    } else {
      // EVM chain ID (numeric)
      const parsedId = Number(rawId);
      if (!Number.isNaN(parsedId)) {
        acc[parsedId] = url;
      }
    }

    return acc;
  }, {});
}

function parseCustomFeeConfig(): CustomFeeConfig | null {
  const value = process.env.NEXT_PUBLIC_BRIDGEKIT_CUSTOM_FEE;
  const recipient = process.env.NEXT_PUBLIC_BRIDGEKIT_CUSTOM_FEE_RECIPIENT;

  if (!value || !recipient) return null;

  return { value, recipient };
}

function resolveRpcUrl(chain: Chain | EvmChainDefinition) {
  const chainId = "id" in chain ? chain.id : chain.chainId;

  return (
    (rpcOverrides && rpcOverrides[chainId]) ||
    ("rpcEndpoints" in chain && chain.rpcEndpoints?.[0]) ||
    ("rpcUrls" in chain && chain.rpcUrls?.default?.http?.[0])
  );
}

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

// =============================================================================
// Solana Chain Utilities
// =============================================================================

/**
 * Get all supported Solana chains from Bridge Kit for the current environment
 */
const getSupportedSolanaChains = (
  env: BridgeEnvironment = DEFAULT_ENV
): SolanaChainDefinition[] => {
  const allChains = getBridgeKit(env).getSupportedChains();
  // Cast through unknown because SDK types may not explicitly include "solana" type
  return allChains
    .filter((chain) => chain.type === "solana" && chain.isTestnet === (env === "testnet"))
    .map((chain) => chain as unknown as SolanaChainDefinition);
};

// Union type for all supported chain definitions
export type UniversalChainDefinition = EvmChainDefinition | SolanaChainDefinition;

/**
 * Get all supported chains (EVM + Solana) from Bridge Kit
 */
export const getAllSupportedChains = (
  env: BridgeEnvironment = DEFAULT_ENV
): UniversalChainDefinition[] => {
  return [...getSupportedEvmChains(env), ...getSupportedSolanaChains(env)];
};

/**
 * Get the Solana chain definition by chain identifier
 */
const getSolanaChainById = (
  chainId: SolanaChainId,
  env: BridgeEnvironment = DEFAULT_ENV
): SolanaChainDefinition | undefined => {
  return getSupportedSolanaChains(env).find((chain) => chain.chain === chainId);
};

// Default Solana RPC endpoints (PublicNode - reliable public RPCs)
const DEFAULT_SOLANA_RPC: Record<SolanaChainId, string> = {
  Solana: "https://solana-rpc.publicnode.com",
  Solana_Devnet: "https://api.devnet.solana.com",
};

/**
 * Get RPC endpoint for a Solana chain.
 * Priority: 1) RPC override from env, 2) Our defaults, 3) Bridge Kit chain definition
 *
 * Configure via NEXT_PUBLIC_BRIDGEKIT_RPC_OVERRIDES:
 *   e.g., Solana=https://my-rpc.example.com,Solana_Devnet=https://my-devnet-rpc.example.com
 */
export const getSolanaRpcEndpoint = (
  chainId: SolanaChainId,
  env: BridgeEnvironment = DEFAULT_ENV
): string => {
  // 1. Check for RPC override from environment
  if (rpcOverrides?.[chainId]) {
    return rpcOverrides[chainId];
  }

  // 2. Use our default endpoints (official Solana public RPCs)
  if (DEFAULT_SOLANA_RPC[chainId]) {
    return DEFAULT_SOLANA_RPC[chainId];
  }

  // 3. Fallback to Bridge Kit chain definition (last resort)
  const chain = getSolanaChainById(chainId, env);
  if (chain?.rpcEndpoints?.[0]) return chain.rpcEndpoints[0];

  // Should never reach here, but provide ultimate fallback
  return "https://api.mainnet.solana.com";
};

/**
 * Resolve a universal chain ID (EVM number or Solana string) to a ChainDefinition
 */
export const resolveBridgeChainUniversal = (
  chainId: ChainId,
  env: BridgeEnvironment = DEFAULT_ENV
): UniversalChainDefinition => {
  if (isSolanaChain(chainId)) {
    const chain = getSolanaChainById(chainId, env);
    if (!chain) {
      throw new Error(`Unsupported Solana chain ${chainId} for Bridge Kit`);
    }
    return chain;
  }
  return resolveBridgeChain(chainId, env) as EvmChainDefinition;
};

/**
 * Get explorer URL for a transaction (works for both EVM and Solana)
 */
export const getExplorerTxUrlUniversal = (
  chainId: ChainId,
  txHash: string,
  env: BridgeEnvironment = DEFAULT_ENV
): string | null => {
  if (isSolanaChain(chainId)) {
    const chain = getSolanaChainById(chainId, env);
    if (!chain?.explorerUrl) return null;
    return chain.explorerUrl.replace("{hash}", txHash);
  }
  return getExplorerTxUrl(chainId, txHash, env);
};

/**
 * Get the chain name for display (works for both EVM and Solana)
 */
export const getChainName = (
  chainId: ChainId,
  env: BridgeEnvironment = DEFAULT_ENV
): string => {
  if (isSolanaChain(chainId)) {
    const chain = getSolanaChainById(chainId, env);
    return chain?.name ?? chainId;
  }
  const chain = getBridgeChainById(chainId, env);
  return chain?.name ?? `Chain ${chainId}`;
};

/**
 * Get the USDC address for a chain (works for both EVM and Solana)
 * For Solana, returns the token mint address
 */
const getUsdcAddressUniversal = (
  chainId: ChainId,
  env: BridgeEnvironment = DEFAULT_ENV
): string | undefined => {
  if (isSolanaChain(chainId)) {
    const chain = getSolanaChainById(chainId, env);
    return chain?.usdcAddress;
  }
  return getUsdcAddressForChain(chainId, env);
};

/**
 * Get chain definition by chain ID (works for both EVM and Solana)
 */
export const getBridgeChainByIdUniversal = (
  chainId: ChainId,
  env: BridgeEnvironment = DEFAULT_ENV
): UniversalChainDefinition | undefined => {
  if (isSolanaChain(chainId)) {
    return getSolanaChainById(chainId, env);
  }
  return getBridgeChainById(chainId, env);
};

/**
 * Get CCTP confirmations for a chain (works for both EVM and Solana)
 */
export const getCctpConfirmationsUniversal = (
  chainId: ChainId,
  env: BridgeEnvironment = DEFAULT_ENV
): { standard?: number; fast?: number } | null => {
  if (isSolanaChain(chainId)) {
    const chain = getSolanaChainById(chainId, env);
    const contracts = chain?.cctp?.contracts?.v2;
    if (!contracts) return null;
    return {
      standard: contracts.confirmations,
      fast: contracts.fastConfirmations,
    };
  }
  return getCctpConfirmations(chainId, env);
};

/**
 * Get USDC address for an EVM chain by its CCTP domain.
 * Used for Solana mint token pair PDA derivation.
 * Dynamically pulls from Bridge Kit so new chains are automatically supported.
 */
export const getUsdcAddressByDomain = (
  domain: number,
  env: BridgeEnvironment = DEFAULT_ENV
): string | null => {
  const chains = getSupportedEvmChains(env);
  const chain = chains.find((c) => c.cctp?.domain === domain);
  return chain?.usdcAddress ?? null;
};

