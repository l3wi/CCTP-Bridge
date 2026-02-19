import generatedRpc from "@/lib/metadata/rpc.generated.json";
import type { GeneratedRpcMetadata } from "@/lib/metadata/types";
import type { BridgeEnvironment } from "@/lib/metadata/types";
import type { SolanaChainId } from "@/lib/types";
import { BRIDGEKIT_ENV } from "@/lib/metadata/index";

const DEFAULT_ENV: BridgeEnvironment = BRIDGEKIT_ENV;
const rpcMetadata = generatedRpc as GeneratedRpcMetadata;

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

export const getConfiguredEvmRpcUrls = (
  chainId: number,
  _env: BridgeEnvironment = DEFAULT_ENV
): string[] => {
  const fromGenerated = rpcMetadata.evm.find((entry) => entry.chainId === chainId)?.urls ?? [];
  return dedupe(fromGenerated);
};

export const getConfiguredSolanaRpcUrls = (
  chainId: SolanaChainId,
  _env: BridgeEnvironment = DEFAULT_ENV
): string[] => {
  const fromGenerated =
    rpcMetadata.solana.find((entry) => entry.chain === chainId)?.urls ??
    fallbackSolana[chainId] ??
    [];

  return dedupe(fromGenerated);
};

export const getMissingRpcChainIds = (): number[] => rpcMetadata.missingChainIds ?? [];
