import generatedRpc from "../../.generated/metadata/rpc.generated.json";
import type { GeneratedRpcMetadata } from "@/lib/metadata/types";
import type { SolanaChainId } from "@/lib/types";
const rpcMetadata = generatedRpc as GeneratedRpcMetadata;
const warnedSolanaFallback = new Set<SolanaChainId>();

function isValidHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

const fallbackSolana: Record<SolanaChainId, string[]> = {
  Solana: ["https://solana-rpc.publicnode.com", "https://api.mainnet-beta.solana.com"],
  Solana_Devnet: ["https://api.devnet.solana.com"],
};

const dedupe = (urls: string[]) =>
  Array.from(
    new Set(urls.map((url) => url.trim()).filter((url) => isValidHttpUrl(url)))
  );

const warnSolanaFallback = (chainId: SolanaChainId) => {
  if (warnedSolanaFallback.has(chainId)) return;
  warnedSolanaFallback.add(chainId);
  console.warn(
    `[rpc/config] Missing generated Solana RPC URLs for ${chainId}; using bundled fallback endpoints.`
  );
};

export const getConfiguredEvmRpcUrls = (
  chainId: number
): string[] => {
  const fromGenerated = rpcMetadata.evm.find((entry) => entry.chainId === chainId)?.urls ?? [];
  return dedupe(fromGenerated);
};

export const getConfiguredSolanaRpcUrls = (
  chainId: SolanaChainId
): string[] => {
  const generatedEntry = rpcMetadata.solana.find((entry) => entry.chain === chainId);
  const fromGenerated = generatedEntry?.urls ?? [];
  const shouldUseFallback = fromGenerated.length === 0 && Boolean(fallbackSolana[chainId]);
  if (shouldUseFallback) {
    warnSolanaFallback(chainId);
  }

  const resolved = shouldUseFallback
    ? fallbackSolana[chainId] ?? []
    : fromGenerated;

  return dedupe(resolved);
};

export const getMissingRpcChainIds = (): number[] => rpcMetadata.missingChainIds ?? [];
