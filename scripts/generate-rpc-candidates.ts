#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
  GeneratedCctpMetadata,
  GeneratedRpcMetadata,
  EvmRpcEntry,
  SolanaRpcEntry,
  EvmChainMetadata,
} from "../lib/metadata/types";

const CCTP_METADATA_PATH = resolve(
  process.cwd(),
  "lib/metadata/cctp.generated.json"
);
const RPC_METADATA_PATH = resolve(process.cwd(), "lib/metadata/rpc.generated.json");
const REPORT_PATH = resolve(
  process.cwd(),
  "reports/rpc-validation-report.json"
);
const CHAINLIST_URL = "https://chainlist.org/rpcs.json";
const CORS_ORIGIN = "https://cctp.io";
const REQUEST_TIMEOUT_MS = 1_500;
const MAX_LATENCY_MS = 500;
const MAX_CANDIDATES_PER_CHAIN = 8;
const MAX_VALID_URLS_PER_CHAIN = 4;
const CHAIN_CONCURRENCY = 6;

type ChainlistRpcUrl = string | { url?: string };
type ChainlistEntry = {
  chainId?: number;
  rpc?: ChainlistRpcUrl[];
  isTestnet?: boolean;
  name?: string;
};

type CorsCheckResult = {
  ok: boolean;
  reason?: string;
  latencyMs?: number;
};

const DEFAULT_SOLANA_RPCS: SolanaRpcEntry[] = [
  {
    chain: "Solana",
    urls: [
      "https://solana-rpc.publicnode.com",
      "https://api.mainnet-beta.solana.com",
    ],
  },
  {
    chain: "Solana_Devnet",
    urls: ["https://api.devnet.solana.com"],
  },
];

function withTimeout(signal: AbortSignal, timeoutMs: number): AbortController {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  signal.addEventListener("abort", () => controller.abort());
  controller.signal.addEventListener("abort", () => clearTimeout(timeout), {
    once: true,
  });
  return controller;
}

function allowsOrigin(response: Response): boolean {
  const allowOrigin = response.headers.get("access-control-allow-origin");
  if (!allowOrigin) return false;

  return allowOrigin === "*" || allowOrigin === CORS_ORIGIN;
}

function allowsPostMethod(response: Response): boolean {
  const allowMethods = response.headers.get("access-control-allow-methods");
  if (!allowMethods) return false;

  const methods = allowMethods.toUpperCase();
  return methods.includes("POST") || methods.includes("*");
}

async function checkCorsForEndpoint(
  url: string,
  chainId: number
): Promise<CorsCheckResult> {
  const rootController = new AbortController();
  const chainIdHex = `0x${chainId.toString(16)}`.toLowerCase();

  try {
    const preflightController = withTimeout(rootController.signal, REQUEST_TIMEOUT_MS);
    const preflight = await fetch(url, {
      method: "OPTIONS",
      headers: {
        Origin: CORS_ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
      signal: preflightController.signal,
    });

    if (!preflight.ok) {
      return { ok: false, reason: `preflight status ${preflight.status}` };
    }
    if (!allowsOrigin(preflight)) {
      return { ok: false, reason: "preflight missing allow-origin" };
    }
    if (!allowsPostMethod(preflight)) {
      return { ok: false, reason: "preflight missing POST allow-method" };
    }

    const postController = withTimeout(rootController.signal, REQUEST_TIMEOUT_MS);
    const postStartedAt = performance.now();
    const post = await fetch(url, {
      method: "POST",
      headers: {
        Origin: CORS_ORIGIN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_chainId",
        params: [],
      }),
      signal: postController.signal,
    });
    const postElapsedMs = Math.round(performance.now() - postStartedAt);

    if (!post.ok) {
      return { ok: false, reason: `post status ${post.status}` };
    }
    if (!allowsOrigin(post)) {
      return { ok: false, reason: "post missing allow-origin" };
    }

    const payload = (await post.json()) as { result?: string; error?: unknown };
    if (!payload.result || typeof payload.result !== "string") {
      return { ok: false, reason: "post missing chainId result" };
    }

    if (payload.result.toLowerCase() !== chainIdHex) {
      return {
        ok: false,
        reason: `chainId mismatch (${payload.result} !== ${chainIdHex})`,
      };
    }

    if (postElapsedMs > MAX_LATENCY_MS) {
      return {
        ok: false,
        reason: `latency ${postElapsedMs}ms exceeds ${MAX_LATENCY_MS}ms`,
        latencyMs: postElapsedMs,
      };
    }

    return { ok: true, latencyMs: postElapsedMs };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: message };
  } finally {
    rootController.abort();
  }
}

function normalizeChainlistRpcUrl(value: ChainlistRpcUrl): string | null {
  const raw = typeof value === "string" ? value : value.url;
  if (!raw || typeof raw !== "string") return null;

  const url = raw.trim();
  if (!url.startsWith("https://")) return null;
  if (url.includes("${") || url.includes("{INFURA") || url.includes("<")) return null;
  return url.replace(/\/$/, "");
}

function dedupeUrls(urls: string[]): string[] {
  return Array.from(new Set(urls));
}

function toMapByChainId(entries: ChainlistEntry[]): Map<number, ChainlistEntry> {
  const map = new Map<number, ChainlistEntry>();
  for (const entry of entries) {
    if (typeof entry.chainId !== "number") continue;
    map.set(entry.chainId, entry);
  }
  return map;
}

async function main() {
  const cctpRaw = await readFile(CCTP_METADATA_PATH, "utf8");
  const cctpMetadata = JSON.parse(cctpRaw) as GeneratedCctpMetadata;
  const evmChains = cctpMetadata.chains.filter(
    (chain): chain is EvmChainMetadata => chain.type === "evm"
  );

  const chainlistResponse = await fetch(CHAINLIST_URL);
  if (!chainlistResponse.ok) {
    throw new Error(
      `Failed to fetch chainlist RPCs (${chainlistResponse.status})`
    );
  }

  const chainlistData = (await chainlistResponse.json()) as ChainlistEntry[];
  const chainlistById = toMapByChainId(chainlistData);

  const missingChainIds: number[] = [];
  const warningsReport: Record<string, string[]> = {};

  const processChain = async (chain: EvmChainMetadata): Promise<EvmRpcEntry> => {
    const chainWarnings: string[] = [];
    const chainlist = chainlistById.get(chain.chainId);
    console.log(
      `[generate-rpc-candidates] start chain=${chain.chainId} (${chain.name})`
    );

    if (!chainlist) {
      chainWarnings.push("chain missing from chainlist");
      const result: EvmRpcEntry = {
        chainId: chain.chainId,
        chainName: chain.name,
        isTestnet: chain.isTestnet,
        urls: [],
        testedCount: 0,
        passedCount: 0,
        warnings: chainWarnings,
      };
      console.log(
        `[generate-rpc-candidates] done chain=${chain.chainId} checked=0 passed=0`
      );
      return result;
    }

    const candidates = dedupeUrls(
      (chainlist.rpc ?? [])
        .map((rpc) => normalizeChainlistRpcUrl(rpc))
        .filter((url): url is string => !!url)
    ).slice(0, MAX_CANDIDATES_PER_CHAIN);

    let testedCount = 0;
    const validUrls: string[] = [];

    for (const candidate of candidates) {
      if (validUrls.length >= MAX_VALID_URLS_PER_CHAIN) break;

      testedCount += 1;
      const check = await checkCorsForEndpoint(candidate, chain.chainId);
      if (check.ok) {
        validUrls.push(candidate);
      } else {
        chainWarnings.push(
          `${candidate} -> ${check.reason ?? "unknown failure"}`
        );
      }
    }

    if (validUrls.length === 0) {
      chainWarnings.push("no CORS-compatible RPC endpoints passed validation");
    }

    const result: EvmRpcEntry = {
      chainId: chain.chainId,
      chainName: chain.name,
      isTestnet: chain.isTestnet,
      urls: validUrls,
      testedCount,
      passedCount: validUrls.length,
      warnings: chainWarnings,
    };
    console.log(
      `[generate-rpc-candidates] done chain=${chain.chainId} checked=${testedCount} passed=${validUrls.length}`
    );
    return result;
  };

  const evmEntries: EvmRpcEntry[] = [];
  const queue = [...evmChains];
  const workers = Array.from({ length: CHAIN_CONCURRENCY }).map(async () => {
    while (queue.length > 0) {
      const chain = queue.shift();
      if (!chain) return;
      const entry = await processChain(chain);
      evmEntries.push(entry);
    }
  });
  await Promise.all(workers);

  evmEntries.sort((a, b) => a.chainId - b.chainId);

  for (const entry of evmEntries) {
    if (entry.urls.length === 0) {
      missingChainIds.push(entry.chainId);
    }
    if (entry.warnings.length > 0) {
      warningsReport[String(entry.chainId)] = entry.warnings;
    }
  }

  const payload: GeneratedRpcMetadata = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: CHAINLIST_URL,
    validation: {
      corsOrigin: CORS_ORIGIN,
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
      maxCandidatesPerChain: MAX_CANDIDATES_PER_CHAIN,
      maxValidUrlsPerChain: MAX_VALID_URLS_PER_CHAIN,
    },
    evm: evmEntries,
    solana: DEFAULT_SOLANA_RPCS,
    missingChainIds: Array.from(new Set(missingChainIds)).sort((a, b) => a - b),
  };

  const report = {
    generatedAt: payload.generatedAt,
    source: CHAINLIST_URL,
    totalChains: evmEntries.length,
    missingChainIds: payload.missingChainIds,
    warnings: warningsReport,
  };

  await mkdir(dirname(RPC_METADATA_PATH), { recursive: true });
  await mkdir(dirname(REPORT_PATH), { recursive: true });
  await writeFile(RPC_METADATA_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (payload.missingChainIds.length > 0) {
    console.warn(
      `[generate-rpc-candidates] warning: missing RPCs for chainIds: ${payload.missingChainIds.join(
        ", "
      )}`
    );
  }

  console.log(
    `[generate-rpc-candidates] wrote ${payload.evm.length} EVM chain entries to ${RPC_METADATA_PATH}`
  );
}

main().catch((error) => {
  console.error("[generate-rpc-candidates] failed:", error);
  process.exit(1);
});
