# ADR-0001: Store first-party bridge submission statistics in Turso

## Status

Accepted

## Context

Vercel custom-event exports cap high-cardinality event properties, which makes them unsuitable as the authoritative bridge-volume ledger. The burn transaction hash and bridge metadata are already available immediately after the burn transaction is submitted.

## Decision

Record one append-only row in Turso through Drizzle for every submitted burn transaction. Use `sourceChainId:burnHash` as the idempotency key and store atomic USDC amounts plus transfer type, app fee, Circle fee, origin/destination chains, origin/destination addresses, and timestamps. Derive aggregate statistics from this ledger rather than storing mutable counters.

The `/api/events/burn` route validates the payload and returns `202` immediately. Next.js `after()` runs the Turso insert and optional Vercel tracking after the response; each side effect is isolated with `Promise.allSettled`, so a database or Vercel failure cannot block a submitted bridge transaction.

## Consequences

- The database ledger is the authoritative source for bridge-volume statistics.
- Duplicate beacon/fetch delivery is safe because inserts are idempotent.
- A database outage can lose a submission unless a retry/reconciliation process is added later; the bridge transaction itself is unaffected.
- Vercel analytics remains useful for operational event visibility, but not for complete volume reporting.
