import { readFileSync } from "node:fs";
import { parseBridgeBurnEventMetadata } from "../lib/analytics/bridgeBurnEvent";

type CsvRow = Record<string, string>;

const EVENT_NAME = "bridge_burn_submitted";
const USDC_SCALE = 1_000_000n;

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

const firstValue = (row: CsvRow, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = row[key];
    if (value) return value;
  }
  return undefined;
};

const eventDataFromRow = (row: CsvRow): Record<string, unknown> => {
  const raw = firstValue(row, ["eventData", "Event Data", "data", "Data"]);
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
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

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: bun run scripts/report-bridge-events.ts <vercel-events.csv>");
  process.exit(1);
}

const rows = parseCsv(readFileSync(filePath, "utf8"));
const seen = new Set<string>();
let duplicates = 0;
let skipped = 0;
let fastVolume = 0n;
let standardVolume = 0n;
let appFastFees = 0n;
const routes = new Map<string, bigint>();

for (const row of rows) {
  const eventName = firstValue(row, ["eventName", "Event Name", "name", "Name"]);
  if (eventName && eventName !== EVENT_NAME) continue;

  const eventData = eventDataFromRow(row);
  const id = firstValue(row, ["id", "Id"]) ?? (typeof eventData.id === "string" ? eventData.id : "");
  const metadata =
    firstValue(row, ["m", "M"]) ?? (typeof eventData.m === "string" ? eventData.m : "");

  if (!id || !metadata) {
    skipped += 1;
    continue;
  }

  if (seen.has(id)) {
    duplicates += 1;
    continue;
  }
  seen.add(id);

  try {
    const parsed = parseBridgeBurnEventMetadata(metadata);
    const amount = decimalToAtomic(parsed.amount);
    const appFee = decimalToAtomic(parsed.appFastFee);
    const route = `${parsed.sourceChainId}->${parsed.targetChainId}`;

    if (parsed.speed === "f") fastVolume += amount;
    else standardVolume += amount;
    appFastFees += appFee;
    routes.set(route, (routes.get(route) ?? 0n) + amount);
  } catch {
    skipped += 1;
  }
}

console.log(`Unique bridge events: ${seen.size}`);
console.log(`Duplicate rows ignored: ${duplicates}`);
console.log(`Skipped rows: ${skipped}`);
console.log(`Total volume: ${formatAtomic(fastVolume + standardVolume)} USDC`);
console.log(`Fast volume: ${formatAtomic(fastVolume)} USDC`);
console.log(`Standard volume: ${formatAtomic(standardVolume)} USDC`);
console.log(`App fast-fee revenue: ${formatAtomic(appFastFees)} USDC`);
console.log("Route volume:");
for (const [route, volume] of [...routes.entries()].sort((a, b) =>
  a[0].localeCompare(b[0])
)) {
  console.log(`  ${route}: ${formatAtomic(volume)} USDC`);
}
