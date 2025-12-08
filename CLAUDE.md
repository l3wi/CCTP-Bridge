# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
bun install          # Install dependencies
bun run dev          # Start dev server (localhost:3000, uses Turbopack)
bun run build        # Build production bundle
bun run lint         # Run ESLint checks
```

## Environment Variables

```bash
NEXT_PUBLIC_BRIDGEKIT_ENV=testnet|mainnet        # Chain environment (default: testnet)
NEXT_PUBLIC_BRIDGEKIT_RPC_OVERRIDES=chainId=url  # Optional RPC overrides (comma-separated)
NEXT_PUBLIC_BRIDGEKIT_TRANSFER_SPEED=FAST|SLOW   # Default transfer speed (default: FAST)
NEXT_PUBLIC_BRIDGEKIT_CUSTOM_FEE=<amount>        # Optional integrator fee (USDC)
NEXT_PUBLIC_BRIDGEKIT_CUSTOM_FEE_RECIPIENT=<addr> # Fee recipient address
```

## Architecture Overview

Next.js 15 app router application for bridging USDC using Circle Bridge Kit (CCTPv2, EVM-only). The SDK handles routing, approvals, attestation, and minting end-to-end.

### Core Bridge Flow
1. **Estimate** - `kit.estimate` provides fees/gas for the selected route
2. **Approve + Burn** - Bridge Kit handles USDC approval and burn on source chain
3. **Attestation + Mint** - Bridge Kit fetches attestation and mints on destination chain
4. **Status** - Steps and state surfaced via `BridgeResult`; real-time updates via `kit.on('*')`

### Key Architecture Components

**State Management**
- Zustand store (`lib/store/transactionStore.ts`) manages transaction history with localStorage persistence
- React hooks pattern for blockchain interactions (Bridge Kit + Wagmi)

**Blockchain Integration**
- Wagmi v2 + Viem for Ethereum interactions via Bridge Kit viem adapter
- RainbowKit for wallet connections
- Chain metadata (RPCs, explorers, USDC addresses) derived from Bridge Kit SDK—no local contract maps

**Transaction Lifecycle**
- Local transaction tracking with persisted `BridgeResult` + steps (deduped by burn tx hash)
- Real-time step updates via Bridge Kit event listeners during active bridges
- Manual resume via history UI for pending transfers

**Multi-Chain Support**
- EVM chains only, filtered by `NEXT_PUBLIC_BRIDGEKIT_ENV` (mainnet vs testnet)
- Wagmi/RainbowKit chains generated from `getWagmiChainsForEnv()`

### Key Files
- `lib/bridgeKit.ts` - Bridge Kit singleton, chain helpers, RPC/fee config, viem adapter factory
- `lib/hooks/useBridge.ts` - Core bridge hook: calls `kit.bridge`, streams events, persists state
- `components/bridge-card.tsx` - Bridge form UI, calls `kit.estimate`, renders step status
- `components/bridging-state.tsx` - Active bridge progress display
- `lib/store/transactionStore.ts` - Transaction state with localStorage persistence and legacy migration
- `lib/types.ts` - TypeScript interfaces (`LocalTransaction`, `BridgeParams`, etc.)

### UI Stack
- Radix UI primitives with Tailwind CSS v4
- Toast notifications via `@radix-ui/react-toast`
- `lucide-react` icons

### Important Notes
- All amounts use 6 decimal precision (USDC standard)
- Transaction store persists full `BridgeResult` for resume capability
- Vercel Analytics tracks bridge usage metrics
- Path aliases use `@/*` pointing to project root
- don't run build after every change. running bun run lint is sufficent