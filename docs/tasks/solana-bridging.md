# Solana Bridging Support Implementation Plan

## Overview
Add bidirectional USDC bridging between EVM chains and Solana using Circle Bridge Kit's `@circle-fin/adapter-solana`.

## Requirements
- **Bidirectional bridging**: EVM↔Solana in both directions
- **Separate wallet buttons**: RainbowKit (EVM) + Solana wallet adapter (Phantom, etc.)
- **Both Solana networks**: Devnet (testnet mode), Mainnet-beta (mainnet mode)
- **Manual address allowed**: Users can paste destination addresses without connecting receiving wallet

---

## Phase 1: Dependencies & Type System

### 1.1 Install Dependencies
```bash
bun add @circle-fin/adapter-solana \
        @solana/web3.js \
        @solana/spl-token \
        @solana/wallet-adapter-react \
        @solana/wallet-adapter-react-ui \
        @solana/wallet-adapter-wallets \
        @solana/wallet-adapter-base
```

### 1.2 Update Type System
**File**: `lib/types.ts`

Add universal types to support both EVM and Solana:

```typescript
// Chain identification
export type SolanaChainId = "Solana_Devnet" | "Solana";
export type ChainId = number | SolanaChainId;
export type ChainType = "evm" | "solana";

// Address types
export type EvmAddress = `0x${string}`;
export type SolanaAddress = string; // Base58, 32-44 chars
export type UniversalAddress = EvmAddress | SolanaAddress;

// Transaction hash types
export type EvmTxHash = `0x${string}`;
export type SolanaTxHash = string; // Base58, 88 chars
export type UniversalTxHash = EvmTxHash | SolanaTxHash;

// Type guards
export const isSolanaChain = (chainId: ChainId): chainId is SolanaChainId =>
  typeof chainId === "string" && chainId.startsWith("Solana");

export const getChainType = (chainId: ChainId): ChainType =>
  isSolanaChain(chainId) ? "solana" : "evm";
```

Update `LocalTransaction` interface:
- `originChain: ChainId` (was `number`)
- `targetChain?: ChainId` (was `number`)
- `originChainType: ChainType` (new)
- `targetChainType?: ChainType` (new)
- `hash: UniversalTxHash` (was `0x${string}`)
- `targetAddress?: UniversalAddress` (was `0x${string}`)
- `claimHash?: UniversalTxHash` (was `0x${string}`)

Update `BridgeParams` interface:
- `sourceChainId: ChainId` (was `number`)
- `targetChainId: ChainId` (was `number`)
- `sourceChainType: ChainType` (new)
- `targetChainType: ChainType` (new)
- `targetAddress?: UniversalAddress` (was `0x${string}`)

---

## Phase 2: Bridge Kit Extensions

### 2.1 Extend Bridge Kit Utilities
**File**: `lib/bridgeKit.ts`

Add Solana chain utilities:

```typescript
export const getSupportedSolanaChains = (env: BridgeEnvironment = DEFAULT_ENV) =>
  getBridgeKit(env)
    .getSupportedChains()
    .filter((chain) => chain.type === "solana" && chain.isTestnet === (env === "testnet"));

export const getAllSupportedChains = (env: BridgeEnvironment = DEFAULT_ENV) =>
  [...getSupportedEvmChains(env), ...getSupportedSolanaChains(env)];

export const getSolanaRpcEndpoint = (chainId: SolanaChainId): string =>
  chainId === "Solana_Devnet"
    ? "https://api.devnet.solana.com"
    : "https://api.mainnet-beta.solana.com";

export const resolveBridgeChainUniversal = (chainId: ChainId, env = DEFAULT_ENV) =>
  isSolanaChain(chainId)
    ? getSupportedSolanaChains(env).find((c) => c.chain === chainId)
    : resolveBridgeChain(chainId, env);
```

### 2.2 Create Solana Adapter Factory
**File**: `lib/solanaAdapter.ts` (NEW)

```typescript
import { createAdapterFromProvider } from "@circle-fin/adapter-solana";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddress } from "@solana/spl-token";

const USDC_MINT = {
  Solana: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  Solana_Devnet: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
};

export const createSolanaAdapter = async (provider: any) =>
  createAdapterFromProvider({ provider });

export const getSolanaUsdcBalance = async (publicKey: PublicKey, chainId: SolanaChainId) => {
  const connection = new Connection(getSolanaRpcEndpoint(chainId), "confirmed");
  const ata = await getAssociatedTokenAddress(new PublicKey(USDC_MINT[chainId]), publicKey);
  const account = await getAccount(connection, ata);
  return { balance: account.amount, formatted: (Number(account.amount) / 1e6).toFixed(6) };
};

export const isValidSolanaAddress = (address: string): boolean => {
  try { new PublicKey(address); return true; } catch { return false; }
};
```

---

## Phase 3: Provider Architecture

### 3.1 Create Solana Provider
**File**: `components/solana-provider.tsx` (NEW)

```typescript
"use client";
import { useMemo, FC, ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import "@solana/wallet-adapter-react-ui/styles.css";

export const SolanaProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const endpoint = useMemo(() => getSolanaRpcEndpoint(BRIDGEKIT_ENV === "mainnet" ? "Solana" : "Solana_Devnet"), []);
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};
```

### 3.2 Update Root Provider Composition
**File**: `components/crypto.tsx`

Wrap children with SolanaProvider inside RainbowKitProvider:
```typescript
<RainbowKitProvider>
  <SolanaProvider>
    {children}
    <Toaster />
  </SolanaProvider>
</RainbowKitProvider>
```

---

## Phase 4: Wallet UI Components

### 4.1 Create Solana Wallet Connect Button
**File**: `components/solana-wallet-connect.tsx` (NEW)

Button that uses `useWallet()` and `useWalletModal()` from Solana wallet adapter.
Shows "Connect Solana" when disconnected, truncated address when connected.

### 4.2 Create Solana Connect Guard
**File**: `components/guards/SolanaConnectGuard.tsx` (NEW)

Gates content behind Solana wallet connection, similar to existing `ConnectGuard.tsx`.

### 4.3 Update Page Header
**File**: `app/page.tsx`

Add Solana wallet button next to EVM wallet button:
```tsx
<div className="absolute top-4 right-4 flex items-center gap-2">
  <HistoryModal onLoadBridging={handleLoadBridging} />
  <SolanaWalletConnect />
  <WalletConnect />
</div>
```

---

## Phase 5: Balance & Validation Hooks

### 5.1 Create Solana Balance Hook
**File**: `lib/hooks/useSolanaBalance.ts` (NEW)

Uses `useWallet()` from Solana adapter + TanStack Query to fetch USDC balance.

### 5.2 Update Validation
**File**: `lib/validation.ts`

Add `validateUniversalAddress(address, chainType)` that uses:
- `isAddress()` from viem for EVM
- `isValidSolanaAddress()` for Solana

---

## Phase 6: Bridge Logic

### 6.1 Create Cross-Ecosystem Bridge Hook
**File**: `lib/hooks/useCrossEcosystemBridge.ts` (NEW)

Key logic:
1. Get both wallet states (`useWalletClient()` for EVM, `useWallet()` for Solana)
2. Create appropriate adapter based on source chain type
3. Create appropriate adapter for destination (if connected) or use same adapter
4. Call `kit.bridge()` with correct adapters:
   ```typescript
   kit.bridge({
     from: { adapter: sourceAdapter, chain: sourceChainDef },
     to: { adapter: destAdapter, chain: destChainDef, address?: targetAddress },
     amount, token: "USDC", config: { transferSpeed }
   });
   ```

### 6.2 Update Transaction Store
**File**: `lib/store/transactionStore.ts`

Update `normalizeTransaction()` to:
- Infer `chainType` from chainId if not provided
- Handle both numeric (EVM) and string (Solana) chain identifiers
- Migrate existing EVM transactions by adding `chainType: "evm"`

---

## Phase 7: UI Integration

### 7.1 Update Bridge Card
**File**: `components/bridge-card.tsx`

Major changes:
1. Use `getAllSupportedChains()` instead of `getSupportedEvmChains()`
2. Add `useWallet()` from Solana adapter
3. Add `useSolanaBalance()` hook
4. Conditionally show correct balance based on source chain type
5. Conditionally show correct connect guard based on source chain type
6. Update address validation for target chain type
7. Use `useCrossEcosystemBridge()` for cross-ecosystem transfers

### 7.2 Update Chain Selection
**File**: `lib/hooks/useChainSelection.ts`

Update to support mixed chain types in options:
- `ChainOption.id` becomes `ChainId` (was `number`)
- Add `ChainOption.type: ChainType`
- Update filtering logic to prevent same-chain bridging across types

### 7.3 Update Chain Icon
**File**: `components/chain-icon.tsx`

Add Solana chain icon support using `@web3icons/react` or custom SVG.

### 7.4 Update Bridging State Display
**File**: `components/bridging-state.tsx`

Handle Solana transaction hash format (Base58 instead of hex).

### 7.5 Update History Modal
**File**: `components/history-modal.tsx`

Support displaying transactions with Solana chains and addresses.

---

## Files Summary

### New Files (7)
| File | Purpose |
|------|---------|
| `lib/solanaAdapter.ts` | Solana adapter factory + balance utilities |
| `lib/hooks/useSolanaBalance.ts` | Solana USDC balance hook |
| `lib/hooks/useCrossEcosystemBridge.ts` | Cross-ecosystem bridge hook |
| `components/solana-provider.tsx` | Solana wallet adapter providers |
| `components/solana-wallet-connect.tsx` | Solana connect button |
| `components/guards/SolanaConnectGuard.tsx` | Solana connection gate |
| `public/solana.svg` | Solana chain icon |

### Modified Files (10)
| File | Changes |
|------|---------|
| `lib/types.ts` | Universal type definitions |
| `lib/bridgeKit.ts` | Solana chain utilities |
| `lib/validation.ts` | Universal address validation |
| `lib/store/transactionStore.ts` | Support universal types + migration |
| `lib/hooks/useChainSelection.ts` | Mixed chain type support |
| `components/crypto.tsx` | Compose SolanaProvider |
| `components/chain-icon.tsx` | Solana icon support |
| `components/bridge-card.tsx` | Cross-ecosystem UI logic |
| `components/bridging-state.tsx` | Solana tx display |
| `components/history-modal.tsx` | Universal chain support |
| `app/page.tsx` | Add Solana wallet button |

---

## Implementation Order

| Step | Phase | Description |
|------|-------|-------------|
| 1 | Dependencies | `bun add` all Solana packages |
| 2 | Types | Update `lib/types.ts` with universal types |
| 3 | Bridge Kit | Extend `lib/bridgeKit.ts`, create `lib/solanaAdapter.ts` |
| 4 | Providers | Create `solana-provider.tsx`, update `crypto.tsx` |
| 5 | Wallet UI | Create Solana wallet components, update `page.tsx` |
| 6 | Balance | Create `useSolanaBalance.ts`, update `validation.ts` |
| 7 | Bridge Hook | Create `useCrossEcosystemBridge.ts` |
| 8 | Store | Update `transactionStore.ts` |
| 9 | UI | Update `bridge-card.tsx`, `useChainSelection.ts` |
| 10 | Polish | Update history modal, bridging state, chain icons |

---

## Testing Checklist
- [ ] EVM to EVM bridging still works
- [ ] EVM to Solana bridging works
- [ ] Solana to EVM bridging works
- [ ] Solana to Solana (devnet↔mainnet) works
- [ ] Balance displays correctly for both ecosystems
- [ ] Manual destination address entry works
- [ ] Transaction history shows correct chain icons
- [ ] Explorer links work for both ecosystems
- [ ] Testnet mode uses Devnet, Mainnet mode uses Mainnet-beta

---

## Progress Log

### Step 1: Dependencies (Completed)
- Installed `@circle-fin/adapter-solana`, `@solana/web3.js`, `@solana/spl-token`
- Installed `@solana/wallet-adapter-react`, `@solana/wallet-adapter-react-ui`, `@solana/wallet-adapter-wallets`, `@solana/wallet-adapter-base`

### Step 2: Type System (Completed)
- Added universal types to `lib/types.ts`: `ChainId`, `SolanaChainId`, `ChainType`, `UniversalAddress`, `UniversalTxHash`
- Added type guards: `isSolanaChain()`, `getChainType()`, `isEvmAddress()`
- Updated `LocalTransaction` with optional `originChainType` and `targetChainType` fields
- Updated `BridgeParams` with optional chain type fields
- Added Solana tx hash validation alongside EVM

### Step 3: Bridge Kit Extensions (Completed)
- Extended `lib/bridgeKit.ts` with Solana utilities
- Added `SolanaChainDefinition` interface
- Added `getSupportedSolanaChains()`, `getAllSupportedChains()`, `getSolanaChainById()`
- Added `getSolanaRpcEndpoint()`, `resolveBridgeChainUniversal()`
- Added `getExplorerTxUrlUniversal()`, `getChainName()`, `getUsdcAddressUniversal()`

### Step 4: Solana Adapter (Completed)
- Created `lib/solanaAdapter.ts`
- Implemented `createSolanaAdapter()` for Bridge Kit integration
- Implemented `getSolanaUsdcBalance()`, `getSolanaNativeBalance()`
- Implemented `isValidSolanaAddress()`, `createSolanaConnection()`

### Step 5: Provider Architecture (Completed)
- Created `components/solana-provider.tsx` with Phantom and Solflare wallet support
- Updated `components/crypto.tsx` to compose SolanaProvider inside RainbowKitProvider

### Step 6: Wallet UI Components (Completed)
- Created `components/solana-wallet-connect.tsx` - connect button for Solana wallets
- Created `components/guards/SolanaConnectGuard.tsx` - connection gate component
- Updated `app/page.tsx` to show both wallet buttons

### Step 7: Balance Hook (Completed)
- Created `lib/hooks/useSolanaBalance.ts`
- Fetches USDC and SOL balances using TanStack Query
- Supports balance checking and refetching

### Step 8: Validation (Completed)
- Updated `lib/validation.ts` with universal address validation
- Added `validateUniversalAddress()` and `validateAddressForChain()`
- Updated `validateChainSelection()` to use `ChainId`
- Updated `validateBridgeParams()` for universal types

### Step 9: Transaction Store (Completed)
- Updated `lib/store/transactionStore.ts` for universal types
- Updated `normalizeTransaction()` to extract Solana chain identifiers
- Added automatic `originChainType` inference from chainId
- Updated `migrateLegacyTransaction()` to add EVM chain type

### Step 10: Component Updates (Completed)
- Fixed all type errors in components to support universal `ChainId` type
- Updated `lib/hooks/useBridge.ts`:
  - Changed import from `resolveBridgeChain` to `resolveBridgeChainUniversal`
  - Added type assertions for SDK `ChainDefinition` compatibility
- Updated `components/bridge-card.tsx`:
  - Changed imports to use `getBridgeChainByIdUniversal` and `getCctpConfirmationsUniversal`
  - Added `ChainDefinition` import for type assertions
  - Updated all chain definition usages with type assertions
- Updated `components/history-modal.tsx`:
  - Changed imports to use `getExplorerTxUrlUniversal` and `getBridgeChainByIdUniversal`
  - Updated `handleDeleteTransaction` to accept `UniversalTxHash`
  - Updated `TransactionRowProps.onDelete` type to use `UniversalTxHash`
  - Added type assertions for chain definitions
- Updated `components/chain-icon.tsx`:
  - Changed `chainId` prop type from `number` to `ChainId`
  - Added Solana chain icon support using `TokenIcon` from `@web3icons/react` with SOL symbol
- Added new universal functions to `lib/bridgeKit.ts`:
  - `getBridgeChainByIdUniversal()` - works for both EVM and Solana chains
  - `getCctpConfirmationsUniversal()` - works for both EVM and Solana chains
  - Added `eurcAddress` to `SolanaChainDefinition` for SDK compatibility

### Step 11: Solana Chain Icon (Completed)
- Updated `components/chain-icon.tsx` to use `@web3icons/react` for Solana
- Uses `TokenIcon` component with `symbol="SOL"` for Solana chains
- No manual SVG file needed - leverages existing web3icons package
- Fixed Next.js Image warning by adding explicit style dimensions

### Step 12: Cross-Ecosystem Bridge Hook (Completed)
- Created `lib/hooks/useCrossEcosystemBridge.ts`
- Detects source chain type (EVM vs Solana) and creates appropriate adapter
- Uses `createViemAdapter()` for EVM sources, `createSolanaAdapter()` for Solana sources
- Handles both wallet states via `useWalletClient()` (wagmi) and `useWallet()` (Solana adapter)
- Event handling and step merging follows same pattern as `useBridge.ts`
- Transaction persistence via `addTransaction`/`updateTransaction` with auto-inferred chain types
- Exposes `isEvmConnected` and `isSolanaConnected` for UI checks

### Step 13: Bridge Card UI Integration (Completed)
- Updated `components/bridge-card.tsx` with full Solana support:
  - Changed from `getSupportedEvmChains()` to `getAllSupportedChains()` for chain options
  - Added `useWallet()` hook from `@solana/wallet-adapter-react`
  - Added `useSolanaBalance()` hook for Solana USDC balance
  - Created unified balance display (`usdcBalance`, `usdcFormatted`, `isUsdcLoading`) that switches based on source chain type
  - Updated `ChainOption` type to support both EVM (`chain: Chain`) and Solana chains (`chainType: "evm" | "solana"`)
  - Fixed `handleSwitchChain()` to handle Solana chains (no EVM wallet switch needed)
  - Updated `isSourceChainSynced` to check Solana wallet connection for Solana sources
  - Conditional `ConnectGuard` vs `SolanaConnectGuard` based on source chain type
  - Updated `handleSend()` to use correct sender address (EVM or Solana pubkey)
  - Uses `resolveBridgeChainUniversal()` throughout for chain resolution
  - Uses `useCrossEcosystemBridge()` instead of `useBridge()`

### Step 14: UI Bug Fixes (Completed)
- Fixed Solana chain selection not saving:
  - `bridge-card.tsx`: Fixed target chain `onValueChange` to handle string chain IDs (e.g., "Solana_Devnet") instead of only numbers
  - Updated source/target chain display to use `chainOption.label` instead of `chain.name` (Solana chains don't have `chain` property)
  - Green dot now shows for connected Solana wallet in source chain selector
- Added green dot indicator to `solana-wallet-connect.tsx` when wallet is connected
- Cross-ecosystem address input improvements:
  - Added `isCrossEcosystem` detection (EVM↔Solana)
  - Added `crossEcosystemTargetAddress` to pre-fill with connected wallet from target ecosystem
  - Hides checkbox for cross-ecosystem, always shows address input pre-filled
  - Shows "Your connected wallet" note when address matches connected wallet
  - Updated `useDebouncedAddressValidation` hook to accept `chainType` parameter for proper Solana/EVM address validation
  - Placeholder text changes based on target chain type ("Solana address..." vs "0x...")

### Step 15: Estimation & Fast Transfer Fixes (Completed)
- Fixed bridge estimation not working for Solana destinations:
  - `bridge-card.tsx`: Changed `canEstimate` to check `targetChainId != null` instead of `!!targetChain` (Solana chains don't have the `chain` property)
  - Updated `hasCompleteForm` to use `(!!targetChain || !!targetChainId)` for Solana support
  - Updated both estimate query keys to use `targetChainId` instead of `targetChain?.id`
- Disabled Fast Transfer for Solana bridges:
  - The viem adapter only supports EVM chains, so fast transfers fail for Solana
  - Updated `fastTransferSupported` to return `false` when:
    - `isCrossEcosystem` is true (EVM↔Solana)
    - Source chain is Solana (`isSolanaChain(activeSourceChainId)`)
    - Target chain is Solana (`isSolanaChain(targetChainId)`)
  - Only "Standard Bridge" option now shows for any Solana-related transfers
- Fixed `useDebouncedAddressValidation` hook dependency array size warning:
  - Normalized `chainType` parameter to always be `null` (not `undefined`) to ensure consistent dependency tracking
  - Added explicit default parameter: `chainType: ChainType | null | undefined = null`

### Step 16: Estimation Architecture Fix (Completed)
- Fixed estimation to use correct adapter for Solana routes:
  - Added `createSolanaAdapter` import from `@/lib/solanaAdapter`
  - Added `isSolanaRoute` memoized value to detect Solana involvement
  - Added `canEstimateSolana` - requires Solana wallet for Solana routes
  - Updated `hasCompleteForm` to be ecosystem-aware:
    - Checks `solanaWallet.connected` when source is Solana
    - Checks `!!chain` (EVM) when source is EVM
  - Updated `canEstimate` to include `canEstimateSolana` check
  - Updated `estimateBridge` callback:
    - Uses `createSolanaAdapter(solanaWallet.wallet.adapter)` for Solana routes
    - Uses `createReadonlyAdapter(sourceId)` for EVM-only routes
  - Updated fee display to show "Connect Solana wallet" for Solana routes without wallet

### Step 17: Simplified Estimation for Solana Routes (Completed)
- **Simplified approach**: Skip SDK estimation for Solana routes entirely
  - CCTP has no protocol fees for standard bridging, so estimation isn't needed
  - Avoids complex adapter mismatches between EVM and Solana ecosystems
- Changes to `components/bridge-card.tsx`:
  - `canEstimate` now excludes Solana routes (`!isSolanaRoute`)
  - `estimateBridge` only handles EVM-to-EVM routes
  - Removed `createSolanaAdapter` import (not needed for estimation)
  - Fee display shows "No protocol fee" for Solana routes
  - "You will receive" shows full amount for Solana routes (no fees deducted)
- Updated `lib/solanaAdapter.ts`:
  - `createSolanaAdapter` now properly uses raw browser wallet provider
  - Gets provider from `window.phantom.solana`, `window.solflare`, etc.
  - This is only used for actual bridging, not estimation

---

## Architecture Learnings

### Adapter Types in Circle Bridge Kit

Circle's `@circle-fin/adapter-solana` expects **raw browser wallet providers**, NOT the `@solana/wallet-adapter-react` adapters:

| What Circle expects | What wallet-adapter-react provides |
|--------------------|------------------------------------|
| `window.phantom.solana` | `useWallet().wallet?.adapter` |
| `provider.isConnected` | `adapter.connected` |
| `connect()` returns `{ publicKey }` | `connect()` returns `void` |

**Solution**: `createSolanaAdapter` in `lib/solanaAdapter.ts` maps wallet names to their raw browser providers:
- `"Phantom"` → `window.phantom?.solana`
- `"Solflare"` → `window.solflare`
- `"Backpack"` → `window.backpack?.solana`

### Estimation Strategy

Cross-ecosystem estimation (EVM↔Solana) is complex because:
1. Each adapter only supports its own chain type
2. `kit.estimate()` needs adapters for both `from` and `to` chains
3. Solana adapter requires connected wallet (no readonly mode)

**Simplified solution**: Skip SDK estimation for Solana routes entirely:
- CCTP standard bridging has **no protocol fees** anyway
- Show "No protocol fee" for any Solana route
- Only use SDK estimation for EVM-to-EVM routes

---

## Current Status

**Implementation Complete** ✅

### Core Infrastructure
- Universal type system (`ChainId`, `UniversalAddress`, `UniversalTxHash`)
- Type guards: `isSolanaChain()`, `getChainType()`, `isEvmAddress()`
- All helper functions work with both EVM and Solana chain types

### Wallet Integration
- Solana wallet adapter providers (`SolanaProvider` with Phantom + Solflare)
- Dual wallet buttons in header (RainbowKit + Solana)
- `SolanaConnectGuard` component for Solana-gated UI
- Green dot indicator on connected Solana wallet button

### Bridge UI
- Chain selection supports both EVM and Solana chains
- Balance display switches based on source chain type
- Cross-ecosystem bridging pre-fills target address from connected wallet
- Form validation is ecosystem-aware (`hasCompleteForm`)
- Fast Transfer hidden for Solana routes (only Standard shown)

### Estimation
- EVM-to-EVM: Uses SDK estimation via readonly adapter
- Solana routes: Shows "No protocol fee" (CCTP has no fees)
- "You will receive" shows full amount for Solana routes

### Bridging Execution
- `useCrossEcosystemBridge` hook handles both ecosystems
- Creates appropriate adapter based on source chain type
- `createSolanaAdapter` uses raw browser wallet provider

### Step 18: Cross-Ecosystem Adapter Fix (Completed)
- Fixed bridge initiation error: `INPUT_INVALID_CHAIN: Invalid chain 'Solana': Not supported by this adapter`
- **Root cause**: Single adapter was created based on source chain type, then passed to BOTH `from` and `to` in `kit.bridge()`
- **Fix applied** to `lib/hooks/useCrossEcosystemBridge.ts`:
  - Create `sourceAdapter` based on source chain type (unchanged)
  - Create `destinationAdapter` separately for cross-ecosystem bridges:
    - If target is Solana AND Solana wallet connected → `createSolanaAdapter()`
    - If target is EVM AND EVM wallet connected → `createViemAdapter()`
    - If no wallet connected for target chain → omit adapter, pass only `{ chain, address }`
  - Same-ecosystem bridges still reuse the source adapter
  - Updated `kit.bridge()` call to use `sourceAdapter` for `from` and `destinationAdapter`/address-only for `to`

### Step 19: Fix Address with Adapter Error (Completed)
- Fixed error: `Address should not be provided for user-controlled adapters. The address is automatically resolved from the connected wallet.`
- **Root cause**: When `destinationAdapter` exists, code was still conditionally passing an `address`
- **SDK rule discovered**:
  - With adapter → SDK auto-resolves address from connected wallet, do NOT pass `address`
  - Without adapter → MUST pass `address` (manual recipient)
- **Fix**: Removed `address` from destination config when adapter is present

### Step 20: Cross-Ecosystem Destination UI Improvement (Completed)
- **Change**: When destination wallet is connected, show read-only address display instead of input field
- **UI behavior** in `components/bridge-card.tsx`:
  - Cross-ecosystem + destination wallet connected → read-only display: "Destination Wallet on Solana: [address] Connected"
  - Cross-ecosystem + NO destination wallet → show input field for manual address entry
  - Same-ecosystem + diffWallet checked → show input field (unchanged)
- Cleaner UX: users see their connected address clearly, no confusion about editable fields

### Step 21: Enable Fast Transfer for Solana Routes (Completed)
- **Per CCTP docs**: Solana supports Fast Transfer as both source AND destination
- **Previous restriction removed**: Code was blocking Fast Transfer for cross-ecosystem and Solana routes
- **Updated `fastTransferSupported`** in `components/bridge-card.tsx`:
  - Now only checks if source chain has `fastConfirmations` via `getCctpConfirmationsUniversal()`
  - Removed `isCrossEcosystem`, `isSolanaChain(source)`, `isSolanaChain(target)` restrictions
- Fast Transfer now available for: EVM→Solana, Solana→EVM, Solana→Solana (if source supports it)

### Step 22: Enable Fee Estimation for Solana Routes (Completed)
- **SDK requirement discovered**: `kit.estimate()` requires adapters for BOTH source AND destination
- **Updated estimation logic** in `components/bridge-card.tsx`:
  - Added `createSolanaAdapter` import
  - `canEstimate` now requires Solana wallet if source OR destination is Solana
  - `estimateBridge` creates both `sourceAdapter` and `destAdapter` based on chain types
  - EVM chains use readonly adapter, Solana chains use wallet adapter
- **Updated fee display**:
  - Removed `isSolanaRoute` special case showing "No protocol fee"
  - Now shows "Connect Solana wallet" when Solana wallet needed but not connected
  - Shows actual estimated fees once wallet connected
- **Removed unused `isSolanaRoute` variable**

### Step 23: Fix Solana Mint/Claim Flow (Completed)
- **Issue 1**: "Switch chain to Solana" button showed even when Solana wallet was connected
  - **Root cause**: `onDestinationChain` in `bridging-state.tsx` compared EVM `chain.id` (number) to Solana chain ID (string) — always `false`
  - **Fix**: Updated `onDestinationChain` to use `useMemo` and check `solanaWallet.connected` for Solana destinations
- **Issue 2**: `handleClaim` used `useDirectMint` which is EVM-only (calls `MessageTransmitter.receiveMessage()` contract)
  - **Fix**: Branched `handleClaim` to use `retryClaim` from `useClaim` hook for Solana destinations
- **Issue 3**: `useClaim.ts` always created EVM adapter regardless of destination chain type
  - **Fix**: Updated `retryClaim` to detect source/destination chain types from `result.source/destination`
  - Creates `sourceAdapter` and `destAdapter` separately based on chain type
  - Uses `createSolanaAdapter()` for Solana chains, `createViemAdapter()` for EVM chains
  - Updated dependency array to include `solanaWallet.connected` and `solanaWallet.wallet`

**Files modified:**
- `components/bridging-state.tsx`: Added `useWallet` hook, updated `onDestinationChain`, branched `handleClaim`
- `lib/hooks/useClaim.ts`: Added Solana imports, detect chain types, create ecosystem-appropriate adapters

### Step 24: Allow Solana Destinations in Add Transaction Modal (Completed)
- **Issue**: "Add Transaction" modal rejected Solana destinations with error "only EVM chains are supported"
- **Root cause**: `getChainIdFromDomain()` in `lib/contracts.ts` only searched EVM chains
- **Fix**: Created `getChainIdFromDomainUniversal()` function that returns both EVM (number) and Solana (string) chain IDs
- **Updated `history-modal.tsx`**:
  - Replaced `getChainIdFromDomain` with `getChainIdFromDomainUniversal`
  - Removed the "only EVM chains supported" error check
  - Added `isSolanaChain` check to skip `isNonceUsed` verification for Solana destinations (EVM-only contract query)

**Files modified:**
- `lib/contracts.ts`: Added `getChainIdFromDomainUniversal()` function
- `components/history-modal.tsx`: Use universal function, skip nonce check for Solana

### Step 25: Fix Chain ID Extraction for Solana Destinations (Completed)
- **Issue**: "Missing transaction details" error when clicking claim button for Solana destinations
- **Root cause**: `destinationChainId` and `sourceChainId` in `bridging-state.tsx` only extracted numeric `chainId` (EVM)
  - Solana chains use string `chain` property (e.g., `"Solana_Devnet"`) instead of numeric `chainId`
  - `Number("Solana_Devnet")` returns `NaN`, causing undefined chain IDs
- **Fix applied to `bridging-state.tsx`**:
  - Updated `destinationChainId` and `sourceChainId` memos to check both `chainId` (EVM) and `chain` (Solana) properties
  - Added `ChainId` type annotation (union of number | string)
  - Skip mint readiness polling for Solana destinations (`checkMintReadiness` is EVM-only)
  - Updated `handleRetry` to skip EVM chain switch for Solana destinations
  - Replaced all `getExplorerTxUrl` calls with `getExplorerTxUrlUniversal` for universal chain support

**Files modified:**
- `components/bridging-state.tsx`: Universal chain ID extraction, skip polling for Solana, use universal explorer URLs

### Step 26: Direct Mint for Solana Destinations (Completed)
- **Issue**: `kit.retry()` returned "Retry not supported for this result, requires user action" error
- **Root cause**: SDK's retry mechanism doesn't work for all transaction states, particularly when burn succeeds but no mint tx exists
- **Solution**: Created `useDirectMintSolana` hook that directly executes the Solana mint using the adapter's `prepareAction`

**New file: `lib/hooks/useDirectMintSolana.ts`**
- Mirrors `useDirectMint` (EVM) pattern for Solana
- Fetches attestation from Iris API (`fetchAttestation`)
- Gets chain definitions via `getBridgeChainByIdUniversal()`
- Creates Solana adapter from connected wallet
- Calls `adapter.prepareAction('cctp.v2.receiveMessage', params, ctx)` with:
  - `eventNonce` - from Iris attestation
  - `attestation` - from Iris attestation
  - `message` - from Iris attestation
  - `fromChain` - source chain definition
  - `toChain` - destination chain definition
  - `destinationAddress` - user's Solana wallet pubkey
  - `mintRecipient` - from decoded CCTP message
- Executes prepared transaction and updates store on success
- Handles "already minted" detection via nonce used errors

**Updated `components/bridging-state.tsx`:**
- Added `useDirectMintSolana` hook import and usage
- Updated `handleClaim` for Solana destinations:
  - Uses `executeMintSolana()` instead of `retryClaim()`
  - Updates local state with mint result
  - Shows toast on success/error
- Updated button disabled state to include `isMintingSolana`

### Step 27: Fix Block Height Exceeded Error Handling (Completed)
- **Issue**: Solana mint succeeds but app shows "Claim failed" due to confirmation polling timeout ("block height exceeded")
- **Root cause**: Circle SDK's `execute()` method has internal polling that can timeout even when transaction succeeded
- **Solution**: Added simulation-based verification similar to EVM's `checkNonceUsed()`

**New function: `checkSolanaMintStatus()` in `lib/simulation.ts`**
- Simulates the receiveMessage call on Solana
- If simulation fails with "account already in use" → nonce was consumed → mint succeeded
- If simulation succeeds → mint can still be executed
- Key detection pattern: `"Allocate: account Address {...} already in use"`

**Updated `lib/hooks/useDirectMintSolana.ts`:**
- Moved attestation fetch outside try block (needed for error recovery)
- Added "already in use" to nonce detection patterns
- Added block height error handling:
  - Detects "block height exceeded" / "has expired" / "transaction expired" errors
  - Calls `checkSolanaMintStatus()` to verify transaction status via simulation
  - If simulation fails with "already in use" → marks transaction as success
  - If simulation succeeds → suggests retry

---

## Remaining Work

### Testing Checklist
- [ ] EVM to EVM bridging still works (regression test)
- [x] EVM → Solana: Shows "Claim X USDC" when Solana wallet connected (not "Switch chain")
- [x] EVM → Solana: Clicking "Claim" executes mint via `useDirectMintSolana`
- [ ] EVM → Solana: Block height timeout correctly verifies mint status
- [ ] Solana → EVM bridging flow end-to-end
- [ ] Balance display switches correctly when changing source chain
- [ ] Verify transaction history displays Solana transactions correctly
- [ ] Test with Phantom wallet
- [ ] Test with Solflare wallet

### Step 28: Handle WebSocket Malformed Response Error (Completed)
- **Issue**: `signatureSubscribe` fails with "Server response malformed. Response must include either 'result' or 'error', but not both"
- **Root cause**: Some Solana RPC providers return invalid JSON-RPC WebSocket responses during confirmation polling
- **Fix**: Extended error detection in `useDirectMintSolana.ts` to catch malformed response errors
- Added patterns: `/response malformed/i` and `/must include either.*result.*or.*error/i`
- Uses existing recovery logic via `checkSolanaMintStatus()` to verify actual transaction state
- If simulation fails with "already in use" → mint succeeded despite WebSocket error
- If simulation succeeds → mint didn't complete, suggests retry

**File modified:**
- `lib/hooks/useDirectMintSolana.ts`: Extended error handling block (lines 237-243)

### Step 29: Fix CCTP Custom:0 Error Detection (Completed)
- **Issue**: Clicking claim on already-minted transaction shows generic simulation error instead of "Already Claimed"
- **Root cause**: CCTP program returns `{"InstructionError":[0,{"Custom":0}]}` for nonce already used, but our detection patterns only checked for text like "nonce already used"
- **Fix**: Added `/"Custom":\s*0\b/` regex pattern to detect Solana CCTP program's nonce-consumed error code

**Files modified:**
- `lib/hooks/useDirectMintSolana.ts`: Added Custom:0 detection + logs inspection to nonce check
- `lib/simulation.ts`: Added Custom:0 detection + logs inspection to `checkSolanaMintStatus()`

**Error detection sources:**
1. `error.message` - text patterns like "already in use", "nonce already used"
2. `error.logs` - Solana simulation logs containing "Allocate: account Address {...} already in use"
3. `"Custom": 0` - CCTP program error code in JSON response

---

### Known Limitations
- Solana adapter requires browser wallet extension (no readonly mode)
