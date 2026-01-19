# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
bun install          # Install dependencies
bun run dev          # Start dev server (localhost:3000, uses Turbopack)
bun run build        # Build production bundle
bun run lint         # Run TypeScript + ESLint checks
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

Next.js 15 app router application for bridging USDC across **EVM and Solana** using Circle's CCTP v2 protocol.

### Supported Bridge Routes

| Route | Implementation |
|-------|----------------|
| EVM → EVM | Circle Bridge Kit SDK |
| EVM → Solana | Custom CCTP library (`lib/cctp/`) |
| Solana → EVM | Custom CCTP library (`lib/cctp/`) |

### Core Bridge Flow

**EVM → EVM (Bridge Kit):**
1. `kit.estimate` → fees/gas for route
2. Bridge Kit handles approval + burn
3. Bridge Kit fetches attestation + mints
4. Steps surfaced via `BridgeResult`

**Cross-Ecosystem (Custom CCTP):**
1. `useBurn` → direct CCTP v2 depositForBurn
2. Poll Circle Iris API for attestation
3. `useMint` → direct CCTP v2 receiveMessage
4. Steps managed via `useBridgeSteps` hook

---

## CCTP Library (`lib/cctp/`)

Custom CCTP v2 implementation supporting both EVM and Solana. Bypasses Bridge Kit SDK for Solana routes to avoid WebSocket connection issues.

### Directory Structure

```
lib/cctp/
├── types.ts          # Unified types (ChainId, Address, TxHash, BurnParams, MintParams)
├── shared.ts         # Constants, domain resolution, hash normalization
├── errors.ts         # BridgeError class, error detection, handlers
├── steps.ts          # Step creation, updates, normalization, state derivation
├── nonce.ts          # Nonce extraction and verification (EVM + Solana)
├── evm/
│   └── burn.ts       # EVM depositForBurn builder, fee calculation
├── solana/
│   ├── burn.ts       # Solana depositForBurn with PDA derivation
│   └── mint.ts       # Solana receiveMessage with PDA derivation
└── hooks/
    ├── useBurn.ts    # Unified burn hook (routes to EVM or Solana)
    └── useMint.ts    # Unified mint hook (routes to EVM or Solana)
```

### Key Design Patterns

1. **Universal Interfaces** — `BurnParams`/`MintParams` work for both chains via type guards
2. **PDA Derivation** — Solana Program Derived Addresses computed programmatically
3. **Nonce Checking** — Prevents duplicate mints by verifying nonce usage on-chain
4. **No Bridge Kit for Solana** — Direct Anchor calls avoid WebSocket hangs
5. **Step Normalization** — Consistent step tracking across all bridge directions

### Type Guards

```typescript
isSolanaChain(chainId)     // Check if Solana chain
getChainType(chainId)      // Returns "evm" | "solana"
isEvmAddress(address)      // Validate 0x + 40 hex chars
isSolanaAddress(address)   // Validate Base58 format
isValidTxHash(value)       // Universal tx hash validation
```

---

## Key Files

### Bridge Infrastructure
- `lib/bridgeKit.ts` — Bridge Kit singleton, chain metadata, RPC config
- `lib/cctp/hooks/useBurn.ts` — Unified burn hook (EVM + Solana)
- `lib/cctp/hooks/useMint.ts` — Unified mint hook (EVM + Solana)
- `lib/hooks/useCrossEcosystemBridge.ts` — Orchestrates burn + persistence

### UI Hooks
- `lib/hooks/useBridgeSteps.ts` — Step derivation and normalization
- `lib/hooks/useMintPolling.ts` — Attestation polling (EVM + Solana)
- `lib/hooks/useClaimHandler.ts` — Claim button handler

### Components
- `components/bridge-card.tsx` — Main bridge form UI
- `components/bridging-state/` — Modular progress display (7 sub-components)
- `components/solana-wallet-connect.tsx` — Solana wallet button

### State & Types
- `lib/store/transactionStore.ts` — Zustand store with localStorage (v3 format)
- `lib/types.ts` — App-level types (`LocalTransaction`, `ChainId`, etc.)
- `lib/cctp/types.ts` — CCTP-specific types

---

## Wallet Integration

**EVM:** Wagmi v2 + RainbowKit
- Chains generated from `getWagmiChainsForEnv()`
- Viem adapter via Bridge Kit

**Solana:** `@solana/wallet-adapter-react`
- Phantom, Solflare, etc.
- Direct transaction signing (no SDK abstraction)

---

## Important Notes

- All amounts use 6 decimal precision (USDC standard)
- Transaction store persists full `BridgeResult` for resume capability
- Path aliases use `@/*` pointing to project root
- Run `bun run lint` after changes (build not required for every change)
- Solana burn returns immediately after send (no confirmation wait to avoid WebSocket hangs)

---

## Solana Program Integration Guidelines

When implementing Solana program interactions:

1. **Research PDA derivation first** — Verify which program ID each PDA should be derived from before implementation
2. **Check account ordering** — Anchor macros like `#[event_cpi]` expect accounts at specific positions (e.g., [7-8] for event_cpi, not at the end)
3. **Compare against official SDK** — Find and read the official adapter implementation (e.g., `@circle-fin/adapter-solana`) before building custom instructions
4. **Test with simulation first** — Use `simulateTransaction` to catch account mismatches before signing

### Debugging Solana Transaction Failures

For `ConstraintSeeds` or similar account errors:

1. **Map ALL accounts first** — List every account with its expected program derivation source
2. **Compare against official implementation** — Match account order exactly against Circle's adapter
3. **Verify PDAs independently** — Compute each PDA locally and verify against on-chain data
4. **Don't iterate blindly** — Understand the full instruction structure before making changes