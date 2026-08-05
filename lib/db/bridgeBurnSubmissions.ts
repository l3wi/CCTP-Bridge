import { sql } from "drizzle-orm";
import { getDatabase } from "./client";
import { bridgeBurnSubmissions } from "./schema";
import type { ParsedBridgeBurnEventMetadata } from "@/lib/analytics/bridgeBurnEvent";

const USDC_SCALE = 1_000_000n;

export interface BridgeBurnStatistics {
  totalVolumeAtomic: number;
  fastVolumeAtomic: number;
  standardVolumeAtomic: number;
  totalFeesAtomic: number;
  fastFeesAtomic: number;
  supportFeesAtomic: number;
  totalBridges: number;
  fastBridges: number;
  standardBridges: number;
}

const decimalUsdcToAtomic = (value: string): bigint => {
  const [whole, fraction = ""] = value.split(".");
  const atomic = BigInt(whole) * USDC_SCALE + BigInt(fraction.padEnd(6, "0"));
  if (atomic > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("USDC amount exceeds the database integer safety range");
  }
  return atomic;
};

export interface RecordBridgeBurnSubmissionInput {
  eventId: string;
  metadata: ParsedBridgeBurnEventMetadata;
  fromAddress: string;
  toAddress: string;
  appFeeBps?: number;
}

export const recordBridgeBurnSubmission = async ({
  eventId,
  metadata,
  fromAddress,
  toAddress,
  appFeeBps,
}: RecordBridgeBurnSubmissionInput): Promise<void> => {
  const separator = eventId.indexOf(":");
  if (separator <= 0 || separator === eventId.length - 1) {
    throw new Error("Invalid bridge burn event id");
  }

  const now = new Date();
  const db = getDatabase();

  await db
    .insert(bridgeBurnSubmissions)
    .values({
      id: eventId,
      burnHash: eventId.slice(separator + 1),
      sourceChainId: metadata.sourceChainId,
      targetChainId: metadata.targetChainId,
      fromAddress,
      toAddress,
      transferType: metadata.speed === "f" ? "fast" : "standard",
      amountAtomic: Number(decimalUsdcToAtomic(metadata.amount)),
      appFeeAtomic: Number(decimalUsdcToAtomic(metadata.appFastFee)),
      appFeeBps: appFeeBps ?? null,
      circleFeeAtomic: Number(decimalUsdcToAtomic(metadata.circleFastFee)),
      submittedAt: now,
      recordedAt: now,
    })
    .onConflictDoNothing({ target: bridgeBurnSubmissions.id });
};

export const getBridgeBurnSummary = async () => {
  const db = getDatabase();

  return db
    .select({
      transferType: bridgeBurnSubmissions.transferType,
      eventCount: sql<number>`count(*)`,
      amountAtomic: sql<number>`coalesce(sum(${bridgeBurnSubmissions.amountAtomic}), 0)`,
      appFeeAtomic: sql<number>`coalesce(sum(${bridgeBurnSubmissions.appFeeAtomic}), 0)`,
      circleFeeAtomic: sql<number>`coalesce(sum(${bridgeBurnSubmissions.circleFeeAtomic}), 0)`,
    })
    .from(bridgeBurnSubmissions)
    .groupBy(bridgeBurnSubmissions.transferType);
};

export const getBridgeBurnStatistics = async ({
  since,
}: {
  since: Date;
}): Promise<BridgeBurnStatistics> => {
  const db = getDatabase();
  const [summary] = await db
    .select({
      totalVolumeAtomic: sql<number>`coalesce(sum(${bridgeBurnSubmissions.amountAtomic}), 0)`,
      fastVolumeAtomic: sql<number>`coalesce(sum(case when ${bridgeBurnSubmissions.transferType} = 'fast' then ${bridgeBurnSubmissions.amountAtomic} else 0 end), 0)`,
      standardVolumeAtomic: sql<number>`coalesce(sum(case when ${bridgeBurnSubmissions.transferType} = 'standard' then ${bridgeBurnSubmissions.amountAtomic} else 0 end), 0)`,
      totalFeesAtomic: sql<number>`coalesce(sum(${bridgeBurnSubmissions.appFeeAtomic}), 0)`,
      fastFeesAtomic: sql<number>`coalesce(sum(case when ${bridgeBurnSubmissions.transferType} = 'fast' then ${bridgeBurnSubmissions.appFeeAtomic} else 0 end), 0)`,
      supportFeesAtomic: sql<number>`coalesce(sum(case when ${bridgeBurnSubmissions.transferType} = 'standard' then ${bridgeBurnSubmissions.appFeeAtomic} else 0 end), 0)`,
      totalBridges: sql<number>`count(*)`,
      fastBridges: sql<number>`coalesce(sum(case when ${bridgeBurnSubmissions.transferType} = 'fast' then 1 else 0 end), 0)`,
      standardBridges: sql<number>`coalesce(sum(case when ${bridgeBurnSubmissions.transferType} = 'standard' then 1 else 0 end), 0)`,
    })
    .from(bridgeBurnSubmissions)
    .where(sql`${bridgeBurnSubmissions.submittedAt} >= ${since}`);

  return {
    totalVolumeAtomic: summary?.totalVolumeAtomic ?? 0,
    fastVolumeAtomic: summary?.fastVolumeAtomic ?? 0,
    standardVolumeAtomic: summary?.standardVolumeAtomic ?? 0,
    totalFeesAtomic: summary?.totalFeesAtomic ?? 0,
    fastFeesAtomic: summary?.fastFeesAtomic ?? 0,
    supportFeesAtomic: summary?.supportFeesAtomic ?? 0,
    totalBridges: summary?.totalBridges ?? 0,
    fastBridges: summary?.fastBridges ?? 0,
    standardBridges: summary?.standardBridges ?? 0,
  };
};
