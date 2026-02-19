# CCTP Bridge

Cross-chain USDC bridge supporting **EVM ↔ EVM**, **EVM → Solana**, and **Solana → EVM** transfers using Circle's CCTP v2 protocol.

Built with Next.js App Router, Wagmi/RainbowKit (EVM), Solana Wallet Adapter, Zustand, and a custom CCTP library.

## Getting Started

```bash
bun install        # Install dependencies
bun run dev        # Start dev server (localhost:3000)
bun run lint       # Run TypeScript checks (auto-creates placeholder generated metadata if missing)
bun run build      # Build production bundle
bun run metadata:refresh # Regenerate CCTP metadata + validated RPC candidates
```

## Supported Bridge Routes

| Source | Destination | Implementation |
|--------|-------------|----------------|
| EVM | EVM | Direct CCTP v2 (custom library) |
| EVM | Solana | Direct CCTP v2 (custom library) |
| Solana | EVM | Direct CCTP v2 (custom library) |

## Environment Variables

```bash
NEXT_PUBLIC_BRIDGEKIT_ENV=testnet|mainnet        # Chain environment (default: testnet)
NEXT_PUBLIC_BRIDGEKIT_TRANSFER_SPEED=FAST|SLOW   # Default transfer speed (default: FAST)
NEXT_PUBLIC_BRIDGEKIT_CUSTOM_FEE=<amount>        # Optional integrator fee (USDC)
NEXT_PUBLIC_BRIDGEKIT_CUSTOM_FEE_RECIPIENT=<addr> # Fee recipient address
NEXT_PUBLIC_DISABLE_META_ANALYTICS=1             # Optional: disable bridge analytics event emission
```

`/api/meta` analytics events include aggregate transfer metadata only (no raw wallet/recipient addresses).

## Architecture

- **`lib/cctp/`** — Custom CCTP v2 library with unified interfaces for EVM and Solana
- **`lib/metadata/`** — metadata loaders/types (generated JSON lives under `.generated/metadata/`)
- **`lib/rpc/`** — app-owned wallet-first RPC routing and rotating fallback transports
- **`lib/bridgeKit.ts`** — compatibility facade backed by local metadata + RPC modules
- **`components/bridging-state/`** — Modular bridge progress UI (decomposed into hooks + sub-components)

## Routes

- **`/`** — bridge setup form and pre-burn pending (query-driven)
- **`/bridge/<source_chain_id>/<tx_hash_or_nonce>`** — shareable tracking/recovery route

## Metadata & RPC Generation

- `scripts/generate-cctp-metadata.ts` builds `.generated/metadata/cctp.generated.json` from BridgeKit.
- `scripts/generate-rpc-candidates.ts` fetches Chainlist RPCs, runs CORS validation with `Origin: https://cctp.io`, and writes:
  - `.generated/metadata/rpc.generated.json`
  - `.generated/reports/rpc-validation-report.json`
- `bun run build` runs `metadata:refresh` automatically via `prebuild`.

See `CLAUDE.md` for detailed architecture documentation.
