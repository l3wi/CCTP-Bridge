import type { BridgeBurnStatistics } from "@/lib/db/bridgeBurnSubmissions";

export const BRIDGE_STATISTICS_DAY_OPTIONS = [7, 30, 90, 120] as const;
export type BridgeStatisticsDays = (typeof BRIDGE_STATISTICS_DAY_OPTIONS)[number];

const USDC_SCALE = 1_000_000n;

export const parseBridgeStatisticsDays = (
  args: readonly string[]
): BridgeStatisticsDays => {
  if (args.length !== 2 || args[0] !== "--days") {
    throw new Error("Usage: bun run db:bridge-report -- --days 7|30|90|120");
  }

  const days = Number(args[1]);
  if (
    !Number.isInteger(days) ||
    !BRIDGE_STATISTICS_DAY_OPTIONS.includes(days as BridgeStatisticsDays)
  ) {
    throw new Error("--days must be one of: 7, 30, 90, 120");
  }

  return days as BridgeStatisticsDays;
};

export const formatAtomicUsdc = (value: number): string => {
  const atomic = BigInt(value);
  const whole = atomic / USDC_SCALE;
  const fraction = (atomic % USDC_SCALE).toString().padStart(6, "0");
  const groupedWhole = whole.toLocaleString("en-US");
  return `${groupedWhole}.${fraction}`;
};

const formatCount = (value: number): string => value.toLocaleString("en-US");

const formatMetric = (label: string, value: string): string =>
  `  ${label.padEnd(8)} ${value.padStart(20)}`;

const formatCountMetric = (label: string, value: number): string =>
  `  ${label.padEnd(8)} ${formatCount(value).padStart(20)}`;

const formatSectionMetric = (label: string, value: string): string =>
  `${label.padEnd(10)} ${value.padStart(20)}`;

const formatSectionCountMetric = (label: string, value: number): string =>
  formatSectionMetric(label, formatCount(value));

export const renderBridgeStatistics = ({
  days,
  statistics,
}: {
  days: BridgeStatisticsDays;
  statistics: BridgeBurnStatistics;
}): string =>
  [
    `Bridge statistics · last ${days} days`,
    "────────────────────────────────────────",
    formatSectionMetric("Volume", `${formatAtomicUsdc(statistics.totalVolumeAtomic)} USDC`),
    formatMetric("Fast", `${formatAtomicUsdc(statistics.fastVolumeAtomic)} USDC`),
    formatMetric("Standard", `${formatAtomicUsdc(statistics.standardVolumeAtomic)} USDC`),
    "",
    formatSectionMetric("Fees", `${formatAtomicUsdc(statistics.totalFeesAtomic)} USDC`),
    formatMetric("Fast", `${formatAtomicUsdc(statistics.fastFeesAtomic)} USDC`),
    formatMetric("Standard", `${formatAtomicUsdc(statistics.supportFeesAtomic)} USDC`),
    "",
    formatSectionCountMetric("Bridges", statistics.totalBridges),
    formatCountMetric("Fast", statistics.fastBridges),
    formatCountMetric("Standard", statistics.standardBridges),
  ].join("\n");
