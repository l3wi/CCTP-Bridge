import { Connection } from "@solana/web3.js";
import { createPublicClient, type Chain, type EIP1193Provider } from "viem";
import type { WalletClient } from "viem";
import type { BridgeEnvironment, EvmChainMetadata } from "@/lib/metadata/types";
import { BRIDGEKIT_ENV, resolveBridgeChain } from "@/lib/metadata/index";
import { getWalletFirstEvmTransport } from "@/lib/rpc/router";
import type { SolanaChainId } from "@/lib/types";
import { getConfiguredSolanaRpcUrls } from "@/lib/rpc/config";

const DEFAULT_ENV: BridgeEnvironment = BRIDGEKIT_ENV;
const solanaConnectionCache = new Map<string, Connection>();
const SOLANA_RPC_MAX_RETRIES = 3;

const isReadableStreamBody = (value: unknown): value is ReadableStream =>
  typeof ReadableStream !== "undefined" && value instanceof ReadableStream;

const normalizeRetryBody = async (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<BodyInit | undefined> => {
  if (init?.body !== undefined) {
    if (init.body === null) {
      return undefined;
    }
    if (isReadableStreamBody(init.body)) {
      return new Response(init.body).text();
    }
    return init.body;
  }

  const request = input instanceof Request ? input : undefined;
  if (!request) return undefined;

  return request.clone().text();
};

const parseSolanaRpcError = (payload: string): { code?: number; message?: string } => {
  try {
    const parsed = JSON.parse(payload);
    if (parsed && typeof parsed === "object" && "error" in parsed) {
      const error = parsed.error as { code?: number; message?: string };
      return {
        code: typeof error?.code === "number" ? error.code : undefined,
        message: typeof error?.message === "string" ? error.message : undefined,
      };
    }
  } catch {
    // Ignore non-JSON responses
  }
  return {};
};

const shouldRetrySolanaRequest = (
  response: Response,
  bodyText: string | null
): boolean => {
  if (response.status === 403 || response.status === 429 || response.status >= 500) {
    return true;
  }

  if (!response.ok) {
    return false;
  }

  if (!bodyText) return false;

  const { code, message } = parseSolanaRpcError(bodyText);
  if (code === 403) {
    return true;
  }

  return typeof message === "string"
    ? message.includes("Access forbidden") || message.includes("forbidden")
    : false;
};

const buildSolanaFetch = (urls: string[]) => async (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> => {
  if (!urls.length) {
    return fetch(input, init);
  }

  const method = init?.method ?? (input instanceof Request ? input.method : "POST");
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : {}));
  const body = await normalizeRetryBody(input, init);
  const requestInit = { ...init, method, headers, body };
  let lastError: unknown = new Error(`Solana RPC request failed`);

  const attempts = Math.min(urls.length, SOLANA_RPC_MAX_RETRIES);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const endpoint = urls[attempt % urls.length];

    try {
      const response = await fetch(endpoint, requestInit);
      const responseText = response.ok ? await response.clone().text() : null;
      const isTransient = shouldRetrySolanaRequest(response, responseText);

      if (isTransient && attempt < attempts - 1) {
        lastError = new Error(
          `Solana RPC transient error from ${endpoint}: ${response.status}`
        );
        continue;
      }

      if (responseText !== null) {
        return new Response(responseText, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      }

      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        continue;
      }
    }
  }

  throw lastError;
};

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
  const urls = getConfiguredSolanaRpcUrls(chainId);
  if (!urls.length) {
    throw new Error(`No Solana RPC endpoint configured for ${chainId}`);
  }

  const endpoint = urls[0];
  const cacheKey = `solana:${env}:${chainId}:${commitment}`;
  const cached = solanaConnectionCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const connection = new Connection(endpoint, {
    commitment,
    fetch: buildSolanaFetch(urls),
  });
  solanaConnectionCache.set(cacheKey, connection);
  return connection;
};
