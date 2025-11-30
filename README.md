# CCTP Bridge

Next.js app router bridge UI backed by Wagmi/RainbowKit, Zustand, TanStack Query, and Circle Bridge Kit (EVM-only for now).

## Getting Started
- Install deps: `bun install` (or npm/yarn if preferred).
- Run dev server: `bun run dev`.
- Lint: `bun run lint`.
- Build: `bun run build`.

## Bridge Kit Configuration
- `NEXT_PUBLIC_BRIDGEKIT_ENV` — `testnet` (default) or `mainnet`. Filters supported chains and prevents cross-network routes.
- `NEXT_PUBLIC_BRIDGEKIT_RPC_OVERRIDES` — optional comma list of `chainId=url` pairs to force RPCs (e.g. `421614=https://sepolia-rollup.arbitrum.io/rpc,84532=https://sepolia.base.org`).
- `NEXT_PUBLIC_BRIDGEKIT_TRANSFER_SPEED` — optional `FAST` or `SLOW`; defaults to `FAST`.
- `NEXT_PUBLIC_BRIDGEKIT_CUSTOM_FEE` and `NEXT_PUBLIC_BRIDGEKIT_CUSTOM_FEE_RECIPIENT` — optional absolute USDC fee and payout address for integrator monetization.

Bridge Kit wiring lives in `lib/bridgeKit.ts`; it instantiates a singleton kit, scopes to EVM chains, honors the env-driven RPC overrides, and applies a custom fee policy when configured. See `docs/tasks/bridge-kit-cutover.md` for the migration plan and current status.

## Notes
- Wagmi/RainbowKit chains are generated from Bridge Kit for the selected environment (mainnet or testnet), so no hardcoded contract maps are required.
- Bridge form uses `BridgeKit.estimate` for fee/receive math and relies on Bridge Kit for approvals; manual attestation/claim UI has been removed in favor of SDK step tracking and history storage.
