# CCTP Bridge

Cross-chain USDC bridge supporting **EVM ↔ EVM**, **EVM → Solana**, and **Solana → EVM** transfers using Circle's CCTP v2 protocol.

Built with Next.js App Router, Wagmi/RainbowKit (EVM), Solana Wallet Adapter, Zustand, and a custom CCTP library.

## Getting Started

```bash
bun install        # Install dependencies
bun run dev        # Start dev server (localhost:3000)
bun run lint       # Run TypeScript & ESLint checks
bun run build      # Build production bundle
```

## Supported Bridge Routes

| Source | Destination | Implementation |
|--------|-------------|----------------|
| EVM | EVM | Circle Bridge Kit SDK |
| EVM | Solana | Direct CCTP v2 (custom library) |
| Solana | EVM | Direct CCTP v2 (custom library) |

## Environment Variables

```bash
NEXT_PUBLIC_BRIDGEKIT_ENV=testnet|mainnet        # Chain environment (default: testnet)
NEXT_PUBLIC_BRIDGEKIT_RPC_OVERRIDES=chainId=url  # Optional RPC overrides (comma-separated)
NEXT_PUBLIC_BRIDGEKIT_TRANSFER_SPEED=FAST|SLOW   # Default transfer speed (default: FAST)
NEXT_PUBLIC_BRIDGEKIT_CUSTOM_FEE=<amount>        # Optional integrator fee (USDC)
NEXT_PUBLIC_BRIDGEKIT_CUSTOM_FEE_RECIPIENT=<addr> # Fee recipient address
```

## Architecture

- **`lib/cctp/`** — Custom CCTP v2 library with unified interfaces for EVM and Solana
- **`lib/bridgeKit.ts`** — Circle Bridge Kit singleton for EVM-only routes and chain metadata
- **`components/bridging-state/`** — Modular bridge progress UI (decomposed into hooks + sub-components)

See `CLAUDE.md` for detailed architecture documentation.
