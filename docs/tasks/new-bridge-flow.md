# CCTP Bridge Refactor - New Bridge Flow

## Overview

Refactoring the cross-ecosystem CCTP bridge into a clean, maintainable library with unified interfaces for all 3 bridging scenarios:
- **EVM ↔ EVM**
- **EVM → Solana**
- **Solana → EVM**

## Constraints

- Keep Bridge Kit SDK for chain metadata only (contract addresses, CCTP domains, RPC URLs)
- Support existing users with IndexedDB/localStorage migration (v2 → v3)
- Achieve consistent UX across all bridge directions

---

## Current Progress

### ✅ Phase 1: Shared Infrastructure (COMPLETED)

#### 1.1 `lib/cctp/types.ts` - Unified Type Definitions
- Chain types: `EvmChainId`, `SolanaChainId`, `ChainId`, `ChainType`
- Address types: `EvmAddress`, `SolanaAddress`, `UniversalAddress`
- Transaction hash types: `EvmTxHash`, `SolanaTxHash`, `UniversalTxHash`
- Type guards: `isSolanaChain()`, `getChainType()`, `isEvmAddress()`, `isValidTxHash()`
- Unified interfaces: `BurnParams`, `BurnResult`, `MintParams`, `MintResult`
- Attestation types: `AttestationData`, `IrisAttestationResponse`
- Transaction store types: `LocalTransaction` (v3), `LegacyV2Transaction`

#### 1.2 `lib/cctp/shared.ts` - Shared Utilities
- `SOLANA_USDC_MINT` - Single source of truth (was duplicated 3x)
- `getCctpDomain()` - Unified domain resolution using Bridge Kit
- `FINALITY_THRESHOLDS` - EVM (1000/2000) and Solana (3/32)
- `formatMintRecipientHex()` - For EVM contract calls
- `formatMintRecipientPubkey()` - For Solana instructions
- `isUserRejection()` - Detect wallet rejections
- `normalizeHash()` - Hash normalization by chain type
- `IRIS_API_ENDPOINTS` - API URLs

#### 1.3 `lib/cctp/errors.ts` - Error Handling
- `BridgeError` class with code and phase
- Error detection: `isUserRejection()`, `isInsufficientBalance()`, `isNonceAlreadyUsed()`
- `handleBurnError()` - Consistent burn error handling
- `handleMintError()` - Consistent mint error handling
- `formatErrorForToast()` - User-friendly error messages

---

### ✅ Phase 2: Burn Flow Consolidation (COMPLETED)

#### 2.1 `lib/cctp/evm/burn.ts` - EVM Burn Builder
- `ERC20_ABI`, `TOKEN_MESSENGER_ABI` - Contract ABIs
- `getTokenMessengerAddress()`, `getUsdcAddress()` - From Bridge Kit
- `checkAllowance()`, `buildApprovalData()` - Approval flow
- `buildDepositForBurnData()` - CCTP v2 depositForBurn
- `fetchFastBurnFee()`, `calculateMaxFee()` - Fee calculation from IRIS
- `prepareEvmBurn()` - High-level config preparation

#### 2.2 `lib/cctp/solana/burn.ts` - Solana Burn Builder
- `TOKEN_MESSENGER_PROGRAM_ID`, `MESSAGE_TRANSMITTER_PROGRAM_ID`
- `deriveBurnPdas()` - PDA derivation for CCTP accounts
- `buildDepositForBurnTransaction()` - Anchor-based transaction builder
- `sendTransactionNoConfirm()` - Avoid WebSocket hangs
- Uses shared `getCctpDomain()`, `getSolanaUsdcMint()`, `formatMintRecipientPubkey()`

#### 2.3 `lib/cctp/hooks/useBurn.ts` - Unified Burn Hook
```typescript
function useBurn(): {
  executeBurn: (params: BurnParams) => Promise<BurnResult>;
  isBurning: boolean;
}
```
- Routes to EVM or Solana based on `sourceChainId`
- Consistent `BurnResult` return type for both paths
- Uses shared error handling
- EVM: approval → wait → verify allowance → burn
- Solana: build tx → sign → partial sign message account → send

---

### ✅ Phase 3: Mint Flow Consolidation (COMPLETED)

#### 3.1 `lib/cctp/nonce.ts` - Unified Nonce Checking (COMPLETED)
- `extractNonceFromMessage()` - Extract 32-byte nonce from CCTP message
- `extractSourceDomainFromMessage()` - Extract source domain
- `checkNonceUsed()` - Unified interface, routes to EVM or Solana
- EVM: `keccak256(sourceDomain + nonce)` → `usedNonces` mapping
- Solana: Check if `usedNonce` PDA account exists

#### 3.2 `lib/cctp/steps.ts` - Step Management (COMPLETED)
- `createInitialSteps()` - Create initial step array for bridge start
- `updateStepsWithAttestation()` - Mark attestation step as success
- `updateStepsWithMint()` - Unified step update for mint completion
- `mergeSteps()` - Merge new step into existing array (from useCrossEcosystemBridge)
- `normalizeStepName()`, `normalizeState()` - Step normalization utilities
- `deriveBridgeState()` - Derive overall bridge state from steps
- `findTxHashes()` - Extract burn/mint hashes from steps

#### 3.3 `lib/cctp/solana/mint.ts` - Solana Mint Builder (COMPLETED)
- Migrated from `lib/solana/cctpMint.ts`
- Uses `getSolanaUsdcMint()` from `lib/cctp/shared.ts` (single source of truth)
- Exports `buildReceiveMessageTransaction()` - Anchor-based transaction builder
- Exports `sendTransactionNoConfirm()` - Send without WebSocket confirmation
- Exports `deriveUsedNoncePda()`, `extractEventNonceFromMessage()` - Nonce utilities
- Internal PDA derivation matches Bridge Kit adapter exactly

#### 3.4 `lib/cctp/hooks/useMint.ts` - Unified Mint Hook (COMPLETED)
```typescript
function useMint(): {
  executeMint: (params: MintParams) => Promise<MintResult>;
  isMinting: boolean;
}
```
- Routes to EVM or Solana based on `destinationChainId`
- Uses `fetchAttestationUniversal()` for all sources
- Uses `checkNonceUsed()` from `lib/cctp/nonce.ts` for Solana
- Uses `simulateMint()` for EVM destinations
- Unified error handling with `handleMintError()` / `handleSolanaMintError()`
- Updates transaction store and shows toast notifications
- EVM waits for confirmation; Solana returns immediately

---

### ✅ Phase 4: Orchestration Simplification (COMPLETED)

#### 4.1 Simplify `lib/hooks/useCrossEcosystemBridge.ts` (COMPLETED)

**Reduced from ~547 lines to ~231 lines (~316 lines removed):**
- Removed `handleEvent()` function (~105 lines) - never fires with direct burns
- Removed `kit.on('*')` / `kit.off('*')` registration - served no purpose
- Removed 7 duplicate utility functions (~112 lines): `asTxHash`, `findTxHashes`, `mergeSteps`, `normalizeStepName`, `normalizeState`, `isNonceAlreadyUsed`, `deriveBridgeState` (now in `lib/cctp/steps.ts`)
- Removed 5 unused refs

**Updated:**
- Now uses unified `useBurn()` hook from `lib/cctp/hooks/useBurn`
- Uses `createInitialSteps()` from `lib/cctp/steps` for step creation
- Uses `deriveBridgeState()` from `lib/cctp/steps` for state derivation
- Simplified to: call burn → persist transaction → return

#### 4.2 Delete `lib/hooks/useClaim.ts` (DEFERRED to Phase 6)
- Needs UI component migration first (`bridging-state.tsx` still uses it)
- Will be deleted when UI components are updated to use `useMint()`

---

### ✅ Phase 5: Transaction Store Migration (COMPLETED)

#### 5.1 Update `lib/store/transactionStore.ts` ✅
- Bumped storage key: `cctp-transactions-v2` → `cctp-transactions-v3`
- Added `migrateV2Transaction()` function that drops redundant fields
- Updated `migrateLegacyData()` to handle v1, v2 → v3 migration
- Updated `normalizeTransaction()` to always produce v3 format

#### 5.2 Update `lib/types.ts` ✅
- Changed `LocalTransaction.version` from `"v2"` to `"v3"`
- Removed redundant fields: `originChainType`, `targetChainType`, `provider`, `chain`
- Added `LegacyV2Transaction` interface for migration support

#### 5.3 Update UI Components ✅
- `components/bridge-card.tsx` - Hardcoded provider to `"CCTPV2BridgingProvider"`
- `components/history-modal.tsx` - Use `version === "v3"` for Bridge Kit detection
- `lib/hooks/useCrossEcosystemBridge.ts` - Removed `provider` from transaction updates

---

### ✅ Phase 6: Cleanup (COMPLETED)

#### 6.1 Delete Obsolete Files ✅
- ~~`lib/hooks/useDirectBurnEvm.ts`~~ → deleted (replaced by `lib/cctp/hooks/useBurn.ts`)
- ~~`lib/hooks/useDirectBurnSolana.ts`~~ → deleted (replaced by `lib/cctp/hooks/useBurn.ts`)
- ~~`lib/hooks/useDirectMint.ts`~~ → deleted (replaced by `lib/cctp/hooks/useMint.ts`)
- ~~`lib/hooks/useDirectMintSolana.ts`~~ → deleted (replaced by `lib/cctp/hooks/useMint.ts`)
- `lib/hooks/useClaim.ts` → **kept** as Bridge Kit fallback mechanism

#### 6.2 Update UI Components ✅
- `components/bridging-state.tsx` - Now uses unified `useMint()` hook
- `components/history-modal.tsx` - Already updated for v3 in Phase 5
- `components/bridge-card.tsx` - Already uses `useCrossEcosystemBridge` → `useBurn()`

#### 6.3 Deferred Tasks (Future Cleanup)
- `lib/contracts.ts` → move EVM-specific parts to `lib/cctp/evm/contracts.ts`
- `lib/simulation.ts` → keep simulation, nonce checking moved to `lib/cctp/nonce.ts`
- `lib/iris.ts` → rename to `lib/cctp/attestation.ts`
- `lib/types.ts` → remove duplicated types after migration period
- `lib/hooks/useClaim.ts` → remove when Bridge Kit fallback no longer needed

---

## Final File Structure

```
lib/
  cctp/
    types.ts           ✅ All CCTP type definitions
    shared.ts          ✅ Shared utilities (domains, addresses, hashes)
    errors.ts          ✅ Error handling
    nonce.ts           ✅ Unified nonce checking
    steps.ts           ✅ Step management utilities
    attestation.ts     ⏳ Circle Iris API (from iris.ts)
    evm/
      burn.ts          ✅ EVM burn transaction builder
      mint.ts          ⏳ EVM mint transaction builder (keep in lib/contracts.ts for now)
      contracts.ts     ⏳ EVM ABIs and contract utilities
    solana/
      burn.ts          ✅ Solana burn transaction builder
      mint.ts          ✅ Solana mint transaction builder
      adapter.ts       ⏳ Wallet adapter utilities (from solanaAdapter.ts)
    hooks/
      useBurn.ts       ✅ Unified burn hook
      useMint.ts       ✅ Unified mint hook
  hooks/
    useCrossEcosystemBridge.ts  ✅ Simplified orchestrator (uses useBurn)
    useBalance.ts               (keep as-is)
    useSolanaBalance.ts         (keep as-is)
  store/
    transactionStore.ts         ✅ Updated with v3 migration
  bridgeKit.ts                  (keep - chain metadata only)
  types.ts                      ✅ Updated with v3 LocalTransaction
  validation.ts                 (keep as-is)
```

---

## Key Issues Fixed

### Duplicated Code Removed
1. **USDC mint addresses** - Was in 3 places, now single source in `shared.ts`
2. **Domain resolution** - Hardcoded in Solana, dynamic in EVM → unified in `shared.ts`
3. **Mint recipient formatting** - Identical logic in both burn files → unified in `shared.ts`
4. **`updateStepsWithMint()`** - Identical in both mint hooks → will be in `steps.ts`
5. **Nonce checking** - 3 different implementations → unified in `nonce.ts`

### Inconsistencies Fixed
1. **Finality thresholds** - EVM used 1000/2000, Solana used 3/32 → both in `FINALITY_THRESHOLDS`
2. **Return types** - `0x${string}` vs `string` → unified `UniversalTxHash`
3. **Error handling** - Different patterns → unified in `errors.ts`
4. **Attestation functions** - `fetchAttestation()` vs `fetchAttestationUniversal()` → use universal only

### Dead Code to Remove
- `handleEvent()` function (~100 lines)
- `kit.on('*')` event registration
- `useClaim.ts` hook
- Duplicate `asTxHash()` functions

---

## Testing Checklist

After each phase, verify:
- [ ] `bun run lint` passes
- [ ] `bun run build` passes
- [ ] EVM → EVM bridge works
- [ ] EVM → Solana bridge works
- [ ] Solana → EVM bridge works
- [ ] Existing transactions migrate correctly
- [ ] Claim/mint works for pending transactions

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking existing user transactions | v2→v3 migration with data preservation |
| Regression in one bridge direction | Test all 3 scenarios after each phase |
| Bridge Kit API changes | Isolate Bridge Kit usage to `bridgeKit.ts` |
| Type errors during migration | Gradual migration with type guards |
