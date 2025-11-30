# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- `yarn dev` or `npm run dev` - Start development server on localhost:3000
- `yarn build` or `npm run build` - Build production bundle
- `yarn start` or `npm start` - Start production server
- `yarn lint` or `npm run lint` - Run ESLint checks

## Architecture Overview

This is a Next.js 13+ app router application for bridging USDC using Circle Bridge Kit (CCTPv2, EVM-first). The app relies on the SDK for routing, approvals, attestation, and minting.

### Core Bridge Flow
1. **Estimate** - Bridge Kit `estimate` provides fees/gas for the selected route
2. **Approve + Burn** - Bridge Kit handles USDC approval and burn on the source chain
3. **Attestation + Mint** - Bridge Kit fetches attestation and mints on the destination chain
4. **Status** - Steps and state are surfaced via Bridge Kit `BridgeResult`; manual claim UI is removed

### Key Architecture Components

**State Management**
- Zustand store (`lib/store/transactionStore.ts`) manages transaction history with localStorage persistence
- React hooks pattern for blockchain interactions (Bridge Kit + Wagmi)

**Blockchain Integration**
- Wagmi v2 + Viem for Ethereum interactions, backed by Bridge Kit viem adapter
- RainbowKit for wallet connections
- Chain metadata (RPCs, explorers, USDC addresses) comes from Bridge Kit; no local contract maps

**Transaction Lifecycle**
- Local transaction tracking with persisted `BridgeResult` + steps
- Bridge Kit retry/resume planned for pending transfers
- Error handling with user-friendly messages

**Multi-Chain Support**
- Bridge Kit-supported EVM chains only (env-driven mainnet/testnet list pulled from SDK)

### Key Files
- `lib/bridgeKit.ts` - Bridge Kit singleton, chain filters, RPC overrides, explorer helpers
- `lib/hooks/useBridge.ts` - Core bridge operations via Bridge Kit
- `components/bridge-card.tsx` - Bridge UI wired to Bridge Kit estimate + status
- `lib/store/transactionStore.ts` - Transaction state management (persisted steps/BridgeResult)
- `lib/types.ts` - TypeScript interfaces for the app

### UI Patterns
- Radix UI components with Tailwind CSS styling
- Toast notifications for transaction feedback
- Loading states and error boundaries
- Responsive design with mobile support

### Important Notes
- All amounts use 6 decimal precision (USDC standard)
- Transaction retries exclude user cancellations
- Vercel Analytics tracks bridge usage metrics
- Path aliases use `@/*` pattern pointing to project root
