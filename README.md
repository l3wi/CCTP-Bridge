# CCTP Bridge

Cross-chain USDC bridge supporting **EVM ↔ EVM**, **EVM → Solana**, and **Solana → EVM** transfers using Circle's CCTP v2 protocol.

Built with Next.js App Router, Wagmi/RainbowKit (EVM), Solana Wallet Adapter, Zustand, and a custom CCTP library.

## Getting Started

```bash
bun install        # Install dependencies
bun run dev        # Start dev server (localhost:3000)
bun run lint       # Run TypeScript & ESLint checks
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
```

## Architecture

- **`lib/cctp/`** — Custom CCTP v2 library with unified interfaces for EVM and Solana
- **`lib/metadata/`** — generated chain/domain/contracts metadata (BridgeKit-sourced)
- **`lib/rpc/`** — app-owned wallet-first RPC routing and rotating fallback transports
- **`lib/bridgeKit.ts`** — compatibility facade backed by local metadata + RPC modules
- **`components/bridging-state/`** — Modular bridge progress UI (decomposed into hooks + sub-components)

## Routes

- **`/`** — bridge setup form and pre-burn pending (query-driven)
- **`/bridge/<source_chain_id>/<tx_hash_or_nonce>`** — shareable tracking/recovery route

## Metadata & RPC Generation

- `scripts/generate-cctp-metadata.ts` builds `lib/metadata/cctp.generated.json` from BridgeKit.
- `scripts/generate-rpc-candidates.ts` fetches Chainlist RPCs, runs CORS validation with `Origin: https://cctp.io`, and writes:
  - `lib/metadata/rpc.generated.json`
  - `reports/rpc-validation-report.json`
- A pre-commit hook refreshes and stages these generated artifacts automatically.

See `CLAUDE.md` for detailed architecture documentation.
