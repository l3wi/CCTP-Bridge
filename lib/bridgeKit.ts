import {
  BridgeKit,
  TransferSpeed,
  type ChainDefinition,
  type BridgeParams,
} from "@circle-fin/bridge-kit";
import { createAdapterFromProvider } from "@circle-fin/adapter-viem-v2";
import { createPublicClient, http } from "viem";
import type { Chain, EIP1193Provider, Transport, WalletClient } from "viem";

export type BridgeEnvironment = "mainnet" | "testnet";
type EvmChainDefinition = ChainDefinition & {
  type: "evm";
  chainId: number;
  rpcUrls?: { default?: { http?: string[] } };
};

type RpcOverrideMap = Record<number, string>;

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
        calculateFee: () => customFeeConfig.value,
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

export const getBridgeChainById = (
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

export const getChainIdentifier = (
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

export const getCctpConfirmations = (
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

export const getDefaultTransferSpeed = () => {
  const configured = process.env.NEXT_PUBLIC_BRIDGEKIT_TRANSFER_SPEED;
  return configured === TransferSpeed.SLOW ? TransferSpeed.SLOW : TransferSpeed.FAST;
};

export const createViemAdapter = async (
  provider: EIP1193Provider,
  env: BridgeEnvironment = DEFAULT_ENV
): Promise<BridgeKitAdapter> => {
  const supportedChains = getSupportedEvmChains(env);

  const adapter = await createAdapterFromProvider({
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
      return client.request({ method, params } as any);
    },
  } as EIP1193Provider;
};

export const createReadonlyAdapter = async (
  chainId: number,
  env: BridgeEnvironment = DEFAULT_ENV
): Promise<BridgeKitAdapter> => {
  const preferredChain = resolveBridgeChain(chainId, env);
  const supportedChains = getSupportedEvmChains(env);
  const provider = createReadonlyProvider(preferredChain);

  const adapter = await createAdapterFromProvider({
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

function parseRpcOverrides(raw: string | undefined): RpcOverrideMap | null {
  if (!raw) return null;

  return raw.split(",").reduce<RpcOverrideMap>((acc, entry) => {
    const [rawId, url] = entry.split("=").map((value) => value.trim());
    const parsedId = Number(rawId);

    if (!Number.isNaN(parsedId) && url) {
      acc[parsedId] = url;
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
