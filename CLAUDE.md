# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- `yarn dev` or `npm run dev` - Start development server on localhost:3000
- `yarn build` or `npm run build` - Build production bundle
- `yarn start` or `npm start` - Start production server
- `yarn lint` or `npm run lint` - Run ESLint checks

## Architecture Overview

This is a Next.js 13+ app router application for bridging USDC using Circle's Cross-Chain Transfer Protocol (CCTP). The app enables users to burn USDC on one chain and claim it on another.

### Core Bridge Flow
1. **Approve** - User approves USDC spending to TokenMessenger contract
2. **Burn** - User burns USDC via `depositForBurn` on source chain
3. **Attestation** - Circle API provides attestation for the burn transaction
4. **Claim** - User claims USDC on destination chain via `receiveMessage`

### Key Architecture Components

**State Management**
- Zustand store (`lib/store/transactionStore.ts`) manages transaction history with localStorage persistence
- React hooks pattern for blockchain interactions

**Blockchain Integration**
- Wagmi v2 + Viem for Ethereum interactions
- RainbowKit for wallet connections
- Contract addresses and ABIs centralized in `constants/`

**Transaction Lifecycle**
- Local transaction tracking with optimistic updates
- Retry logic with exponential backoff for failed transactions
- Error handling with user-friendly messages

**Multi-Chain Support**
- Mainnet: Ethereum, Avalanche, Arbitrum, Optimism, Base, Polygon
- Testnet: Goerli, Avalanche Fuji, Arbitrum Goerli
- Domain mapping for CCTP protocol

### Key Files
- `lib/hooks/useBridge.ts` - Core bridge operations (burn/approve/claim)
- `constants/contracts.tsx` - Chain configs and contract addresses
- `lib/store/transactionStore.ts` - Transaction state management
- `lib/types.ts` - TypeScript interfaces for the entire app

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