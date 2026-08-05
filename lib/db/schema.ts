import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const bridgeBurnSubmissions = sqliteTable(
  "bridge_burn_submissions",
  {
    id: text("id").primaryKey(),
    burnHash: text("burn_hash").notNull(),
    sourceChainId: text("source_chain_id").notNull(),
    targetChainId: text("target_chain_id").notNull(),
    fromAddress: text("from_address").notNull(),
    toAddress: text("to_address").notNull(),
    transferType: text("transfer_type", {
      enum: ["fast", "standard"],
    }).notNull(),
    // USDC atomic amounts remain below SQLite/JavaScript's safe integer range
    // for all supported bridge limits, while keeping SQL aggregation simple.
    amountAtomic: integer("amount_atomic").notNull(),
    appFeeAtomic: integer("app_fee_atomic").notNull(),
    appFeeBps: integer("app_fee_bps"),
    circleFeeAtomic: integer("circle_fee_atomic").notNull(),
    submittedAt: integer("submitted_at", { mode: "timestamp_ms" }).notNull(),
    recordedAt: integer("recorded_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("bridge_burn_submissions_chain_hash_idx").on(
      table.sourceChainId,
      table.burnHash
    ),
    index("bridge_burn_submissions_submitted_at_idx").on(table.submittedAt),
    index("bridge_burn_submissions_transfer_type_idx").on(table.transferType),
    index("bridge_burn_submissions_route_idx").on(
      table.sourceChainId,
      table.targetChainId
    ),
    check(
      "bridge_burn_submissions_transfer_type_check",
      sql`${table.transferType} in ('fast', 'standard')`
    ),
    check(
      "bridge_burn_submissions_amounts_non_negative_check",
      sql`${table.amountAtomic} >= 0 and ${table.appFeeAtomic} >= 0 and ${table.circleFeeAtomic} >= 0`
    ),
  ]
);

export type BridgeBurnSubmission = typeof bridgeBurnSubmissions.$inferSelect;
export type NewBridgeBurnSubmission = typeof bridgeBurnSubmissions.$inferInsert;
