#!/usr/bin/env bun
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { BridgeKit } from "@circle-fin/bridge-kit";
import type { ChainDefinition } from "@circle-fin/bridge-kit";
import type {
  GeneratedCctpMetadata,
  UniversalChainMetadata,
  EvmChainMetadata,
  SolanaChainMetadata,
  CctpContracts,
} from "../lib/metadata/types";

const OUTPUT_PATH = resolve(process.cwd(), ".generated/metadata/cctp.generated.json");

type ChainWithOptionalRpcUrls = ChainDefinition & {
  rpcUrls?: { default?: { http?: string[] } };
  chainId?: number;
};

function normalizeContracts(value: unknown): CctpContracts | undefined {
  if (!value || typeof value !== "object") return undefined;

  const raw = value as { v1?: unknown; v2?: unknown };
  const normalizeOne = (contract: unknown) => {
    if (!contract || typeof contract !== "object") return undefined;

    const obj = contract as {
      type?: unknown;
      tokenMessenger?: unknown;
      messageTransmitter?: unknown;
      confirmations?: unknown;
      fastConfirmations?: unknown;
    };

    return {
      type: typeof obj.type === "string" ? obj.type : undefined,
      tokenMessenger:
        typeof obj.tokenMessenger === "string" ? obj.tokenMessenger : undefined,
      messageTransmitter:
        typeof obj.messageTransmitter === "string"
          ? obj.messageTransmitter
          : undefined,
      confirmations:
        typeof obj.confirmations === "number" ? obj.confirmations : undefined,
      fastConfirmations:
        typeof obj.fastConfirmations === "number"
          ? obj.fastConfirmations
          : undefined,
    };
  };

  const contracts: CctpContracts = {};
  const v1 = normalizeOne(raw.v1);
  const v2 = normalizeOne(raw.v2);

  if (v1) contracts.v1 = v1;
  if (v2) contracts.v2 = v2;

  return Object.keys(contracts).length > 0 ? contracts : undefined;
}

function getRpcEndpoints(chain: ChainWithOptionalRpcUrls): string[] {
  const rawRpcEndpoints =
    ((chain as unknown as { rpcEndpoints?: readonly string[] }).rpcEndpoints ?? []);
  const rpcEndpoints = Array.from(rawRpcEndpoints);

  const rpcUrls = chain.rpcUrls?.default?.http ?? [];
  const combined = [...rpcEndpoints, ...rpcUrls]
    .map((url) => url.trim())
    .filter((url) => /^https?:\/\//i.test(url));

  return Array.from(new Set(combined));
}

function normalizeChain(chain: ChainWithOptionalRpcUrls): UniversalChainMetadata | null {
  if (chain.type !== "evm" && chain.type !== "solana") {
    return null;
  }

  const cctp = (chain.cctp as { domain?: number; contracts?: unknown } | undefined) ?? {};

  const base = {
    name: chain.name,
    isTestnet: chain.isTestnet,
    explorerUrl: chain.explorerUrl ?? undefined,
    usdcAddress: chain.usdcAddress ?? undefined,
    eurcAddress: chain.eurcAddress ?? undefined,
    nativeCurrency: chain.nativeCurrency,
    cctp: {
      domain: cctp.domain,
      contracts: normalizeContracts(cctp.contracts),
    },
    rpcEndpoints: getRpcEndpoints(chain),
  };

  if (chain.type === "evm") {
    if (typeof chain.chainId !== "number") return null;

    const normalized: EvmChainMetadata = {
      ...base,
      type: "evm",
      chain: String(chain.chain),
      chainId: chain.chainId,
    };
    return normalized;
  }

  const chainKey = String(chain.chain).trim();
  if (!chainKey) return null;

  const normalized: SolanaChainMetadata = {
    ...base,
    type: "solana",
    chain: chainKey as SolanaChainMetadata["chain"],
  };
  return normalized;
}

function sortChains(chains: UniversalChainMetadata[]): UniversalChainMetadata[] {
  return [...chains].sort((a, b) => {
    if (a.type !== b.type) return a.type === "evm" ? -1 : 1;
    if (a.isTestnet !== b.isTestnet) return a.isTestnet ? 1 : -1;

    if (a.type === "evm" && b.type === "evm") {
      return a.chainId - b.chainId;
    }

    return String(a.chain).localeCompare(String(b.chain));
  });
}

async function main() {
  const kit = new BridgeKit();
  const chains = kit
    .getSupportedChains()
    .map((chain) => normalizeChain(chain as ChainWithOptionalRpcUrls))
    .filter((chain): chain is UniversalChainMetadata => chain !== null);

  const payload: GeneratedCctpMetadata = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: "@circle-fin/bridge-kit",
    chains: sortChains(chains),
  };

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(
    `[generate-cctp-metadata] wrote ${payload.chains.length} chains to ${OUTPUT_PATH}`
  );
}

main().catch((error) => {
  console.error("[generate-cctp-metadata] failed:", error);
  process.exit(1);
});
