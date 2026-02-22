import { http, type EIP1193Provider, type Transport, custom, fallback } from "viem";
import type { BridgeEnvironment } from "@/lib/metadata/types";
import type { SolanaChainId } from "@/lib/types";
import { BRIDGEKIT_ENV } from "@/lib/metadata/index";
import { getConfiguredEvmRpcUrls, getConfiguredSolanaRpcUrls } from "@/lib/rpc/config";

const DEFAULT_ENV: BridgeEnvironment = BRIDGEKIT_ENV;

// Client-side rotation cursor state.
// Important: we avoid mutating this map during SSR so request handling stays deterministic.
const cursorByKey = new Map<string, number>();
const MAX_RETRIES = 3;
const isServerRuntime = () => typeof window === "undefined";
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

  return request.clone().text().catch(() => undefined);
};

function getNextStartIndex(key: string, size: number): number {
  if (size <= 1) return 0;
  if (isServerRuntime()) return 0;

  const current = cursorByKey.get(key) ?? 0;
  const next = (current + 1) % size;
  cursorByKey.set(key, next);
  return current;
}

function buildRotatingFetch(key: string, urls: string[]): typeof fetch {
  const isRetryableStatus = (status: number): boolean => status === 429 || status >= 500;

  return async (input, init) => {
    if (!urls.length) {
      return fetch(input, init);
    }

    const request = input instanceof Request ? input : undefined;
    const method = init?.method ?? request?.method ?? "POST";
    const body = await normalizeRetryBody(input, init);
    const headers = new Headers(init?.headers ?? request?.headers);
    const attempts = Math.min(Math.max(urls.length, 1), MAX_RETRIES);
    const startIndex = getNextStartIndex(key, urls.length);
    let lastError: unknown = new Error(`RPC request failed for ${key}`);

    for (let i = 0; i < attempts; i += 1) {
      const url = urls[(startIndex + i) % urls.length];
      try {
        const response = await fetch(url, {
          ...init,
          method,
          headers,
          body,
        });

        if (response.ok) {
          return response;
        }

        // Retry rate limits and transient server-side failures.
        if (!isRetryableStatus(response.status)) {
          return response;
        }

        lastError = new Error(`RPC ${url} returned status ${response.status}`);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError;
  };
}

export const getPreferredEvmRpcUrl = (
  chainId: number
): string | undefined => {
  const urls = getConfiguredEvmRpcUrls(chainId);
  return urls[0];
};

export const getSolanaRpcEndpoint = (
  chainId: SolanaChainId,
  env: BridgeEnvironment = DEFAULT_ENV
): string => {
  const urls = getConfiguredSolanaRpcUrls(chainId);
  if (!urls.length) {
    throw new Error(`No Solana RPC endpoint configured for ${chainId}`);
  }
  const key = `solana:${env}:${chainId}`;
  const index = getNextStartIndex(key, urls.length);
  return urls[index];
};

export const getRotatingEvmTransport = (
  chainId: number,
  env: BridgeEnvironment = DEFAULT_ENV
): Transport => {
  const urls = getConfiguredEvmRpcUrls(chainId);
  if (!urls.length) {
    throw new Error(
      `No EVM RPC endpoints configured for chain ${chainId}. Run metadata generation or configure RPC sources.`
    );
  }
  const fallbackUrl = urls[0];
  const key = `evm:${env}:${chainId}`;

  return http(fallbackUrl, {
    fetchFn: buildRotatingFetch(key, urls),
  });
};

export const getWalletFirstEvmTransport = (
  chainId: number,
  walletProvider?: EIP1193Provider,
  walletChainId?: number,
  env: BridgeEnvironment = DEFAULT_ENV
): Transport => {
  const rotating = getRotatingEvmTransport(chainId, env);

  if (!walletProvider || walletChainId !== chainId) {
    return rotating;
  }

  return fallback([custom(walletProvider), rotating]);
};
