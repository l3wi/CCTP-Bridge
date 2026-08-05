import { readFileSync } from "node:fs";
import { createPublicClient, formatUnits, http } from "viem";
import { parseBridgeBurnEventMetadata } from "../lib/analytics/bridgeBurnEvent";
import { getChainIdFromDomainUniversal } from "../lib/contracts";
import { fetchAttestationUniversal, isCompleteAttestationData } from "../lib/iris";
import { FINALITY_THRESHOLDS } from "../lib/cctp/shared";
import { getChainType, isSolanaChain, type ChainId } from "../lib/types";

type CsvRow = Record<string, string>;
type Speed = "f" | "s";

const USDC_SCALE = 1_000_000n;
const CCTP_V2_MIN_FINALITY_THRESHOLD_OFFSET = 140;
const UINT32_BYTE_LENGTH = 4;

const alchemySubdomains: Partial<Record<number, string>> = {
  1: "eth-mainnet",
  10: "opt-mainnet",
  137: "polygon-mainnet",
  146: "sonic-mainnet",
  8453: "base-mainnet",
  42161: "arb-mainnet",
  43114: "avax-mainnet",
  59144: "linea-mainnet",
};

interface Summary {
  events: number;
  volume: bigint;
  fastVolume: bigint;
  standardVolume: bigint;
  appFastFees: bigint;
  unresolved: number;
}

const emptySummary = (): Summary => ({
  events: 0,
  volume: 0n,
  fastVolume: 0n,
  standardVolume: 0n,
  appFastFees: 0n,
  unresolved: 0,
});

const parseCsv = (content: string): CsvRow[] => {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (char === "\"" && inQuotes && next === "\"") {
      field += "\"";
      index += 1;
      continue;
    }

    if (char === "\"") {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((value) => value.length > 0)) rows.push(row);

  const [headers, ...dataRows] = rows;
  if (!headers) return [];

  return dataRows.map((values) =>
    headers.reduce<CsvRow>((acc, header, index) => {
      acc[header.trim()] = values[index] ?? "";
      return acc;
    }, {})
  );
};

const decimalToAtomic = (value: string): bigint => {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * USDC_SCALE + BigInt(fraction.padEnd(6, "0").slice(0, 6));
};

const formatAtomic = (value: bigint): string => {
  const whole = value / USDC_SCALE;
  const fraction = (value % USDC_SCALE).toString().padStart(6, "0");
  return `${whole}.${fraction}`;
};

const readUint32FromHexMessage = (
  message: `0x${string}` | undefined,
  byteOffset: number
): number | undefined => {
  if (!message?.startsWith("0x")) return undefined;

  const start = 2 + byteOffset * 2;
  const end = start + UINT32_BYTE_LENGTH * 2;
  if (message.length < end) return undefined;

  const hexValue = message.slice(start, end);
  if (!/^[0-9a-fA-F]{8}$/.test(hexValue)) return undefined;

  return Number.parseInt(hexValue, 16);
};

const resolveSpeed = (
  sourceChainId: ChainId,
  message: `0x${string}` | undefined,
  delayReason?: string
): Speed => {
  if (delayReason) return "s";

  const minFinalityThreshold = readUint32FromHexMessage(
    message,
    CCTP_V2_MIN_FINALITY_THRESHOLD_OFFSET
  );
  const chainType = getChainType(sourceChainId);
  return minFinalityThreshold === FINALITY_THRESHOLDS[chainType].fast ? "f" : "s";
};

const parseChainId = (value: string): ChainId => {
  if (value === "Solana" || value === "Solana_Devnet") return value;
  if (/^\d+$/.test(value)) return Number(value);
  throw new Error(`Invalid source chain id in burn id: ${value}`);
};

const parseBurnId = (value: string): { sourceChainId: ChainId; burnHash: string } => {
  const separator = value.indexOf(":");
  if (separator <= 0) throw new Error(`Invalid burn id: ${value}`);
  return {
    sourceChainId: parseChainId(value.slice(0, separator)),
    burnHash: value.slice(separator + 1).trim(),
  };
};

const getAlchemyRpcUrl = (sourceChainId: ChainId): string | null => {
  if (isSolanaChain(sourceChainId)) return null;
  const subdomain = alchemySubdomains[sourceChainId];
  const key = process.env.ALCHEMY_API_KEY;
  return subdomain && key ? `https://${subdomain}.g.alchemy.com/v2/${key}` : null;
};

const verifyEvmReceiptWithAlchemy = async (
  sourceChainId: ChainId,
  burnHash: string
): Promise<boolean | null> => {
  const rpcUrl = getAlchemyRpcUrl(sourceChainId);
  if (!rpcUrl || isSolanaChain(sourceChainId)) return null;

  try {
    const client = createPublicClient({
      transport: http(rpcUrl, { timeout: 12_000, retryCount: 0 }),
    });
    const receipt = await client.getTransactionReceipt({
      hash: burnHash as `0x${string}`,
    });
    return receipt.status === "success";
  } catch {
    return null;
  }
};

const addToSummary = (
  summary: Summary,
  amount: bigint,
  speed: Speed,
  appFastFee = 0n
): void => {
  summary.events += 1;
  summary.volume += amount;
  summary.appFastFees += appFastFee;
  if (speed === "f") summary.fastVolume += amount;
  else summary.standardVolume += amount;
};

const printSummary = (label: string, summary: Summary): void => {
  console.log(label);
  console.log(`  events: ${summary.events}`);
  console.log(`  total volume: ${formatAtomic(summary.volume)} USDC`);
  console.log(`  fast volume: ${formatAtomic(summary.fastVolume)} USDC`);
  console.log(`  standard volume: ${formatAtomic(summary.standardVolume)} USDC`);
  console.log(`  app fast fees: ${formatAtomic(summary.appFastFees)} USDC`);
  if (summary.unresolved) console.log(`  unresolved ids: ${summary.unresolved}`);
};

const args = process.argv.slice(2);
const idsPath = args[args.indexOf("--ids") + 1];
const metadataPath = args[args.indexOf("--metadata") + 1] ?? args[args.indexOf("--m") + 1];
const shouldRecover = args.includes("--recover");

if (!idsPath || !metadataPath) {
  console.error(
    "Usage: bun run scripts/reconcile-bridge-event-exports.ts --ids <id-export.csv> --metadata <m-export.csv> [--recover]"
  );
  process.exit(1);
}

const idRows = parseCsv(readFileSync(idsPath, "utf8"));
const metadataRows = parseCsv(readFileSync(metadataPath, "utf8"));
const ids = new Map<string, number>();
const metadataSummary = emptySummary();

for (const row of idRows) {
  const id = row.Page?.trim();
  if (!id) continue;
  ids.set(id, (ids.get(id) ?? 0) + Number(row.Total || "1"));
}

for (const row of metadataRows) {
  const total = Number(row.Total || "1");
  try {
    const parsed = parseBridgeBurnEventMetadata(row.Page);
    const amount = decimalToAtomic(parsed.amount);
    const appFastFee = decimalToAtomic(parsed.appFastFee);
    for (let index = 0; index < total; index += 1) {
      addToSummary(metadataSummary, amount, parsed.speed, appFastFee);
    }
  } catch {
    metadataSummary.unresolved += total;
  }
}

const idEventCount = [...ids.values()].reduce((sum, count) => sum + count, 0);
const duplicateIdCount = [...ids.values()].reduce(
  (sum, count) => sum + Math.max(0, count - 1),
  0
);

console.log(`Unique ids: ${ids.size}`);
console.log(`ID export event count: ${idEventCount}`);
console.log(`Duplicate id rows/events: ${duplicateIdCount}`);
console.log(`Metadata export event count: ${metadataSummary.events}`);
printSummary("Metadata-derived summary", metadataSummary);

if (!shouldRecover && idEventCount === metadataSummary.events && metadataSummary.unresolved === 0) {
  console.log("Exports reconcile. Use --recover to force canonical Iris recovery from ids.");
  process.exit(0);
}

console.log("Recovering canonical rows from unique ids...");
const recoveredSummary = emptySummary();
let alchemyVerified = 0;

for (const id of ids.keys()) {
  try {
    const { sourceChainId, burnHash } = parseBurnId(id);
    const receiptOk = await verifyEvmReceiptWithAlchemy(sourceChainId, burnHash);
    if (receiptOk) alchemyVerified += 1;

    const attestation = await fetchAttestationUniversal(sourceChainId, burnHash, {
      forceRefresh: true,
    });

    if (!isCompleteAttestationData(attestation) || !attestation.amount) {
      recoveredSummary.unresolved += 1;
      continue;
    }

    const targetChainId = getChainIdFromDomainUniversal(attestation.destinationDomain);
    if (!targetChainId) {
      recoveredSummary.unresolved += 1;
      continue;
    }

    const speed = resolveSpeed(sourceChainId, attestation.message, attestation.delayReason);
    addToSummary(recoveredSummary, BigInt(attestation.amount), speed);
  } catch {
    recoveredSummary.unresolved += 1;
  }
}

console.log(`Alchemy-verified EVM receipts: ${alchemyVerified}`);
printSummary("Canonical recovered summary", recoveredSummary);
