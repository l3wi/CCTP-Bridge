# Refactoring Plan: bridging-state.tsx

> **Status:** COMPLETED
> **Completed:** 2026-01-05
> **Priority:** Medium (technical debt)

## Implementation Summary

Decomposed the 1,317-line `components/bridging-state.tsx` into clean, maintainable modules:

### Files Created

**Hooks (3):**
- `lib/hooks/useBridgeSteps.ts` - Step derivation logic
- `lib/hooks/useMintPolling.ts` - EVM + Solana polling consolidated
- `lib/hooks/useClaimHandler.ts` - Claim execution for both chains

**Components (7):**
- `components/bridging-state/bridging-state.tsx` - Main component (~310 lines)
- `components/bridging-state/types.ts` - Shared types
- `components/bridging-state/chain-pair.tsx` - Chain display
- `components/bridging-state/bridge-info.tsx` - Info section
- `components/bridging-state/progress-spinner.tsx` - Loading spinner
- `components/bridging-state/step-list.tsx` - Step progress list
- `components/bridging-state/claim-section.tsx` - Claim button
- `components/bridging-state/index.tsx` - Re-exports

### Key Decisions
- Skipped `lib/bridgeUtils.ts` - Used existing `findTxHashes()` from `lib/cctp/steps.ts`
- Kept `formatCompletedLabel()` inline (simple date formatter)
- Removed legacy `handleRetry` and `useClaim` dependency

---

## Original Overview

Decompose the 1158-line `components/bridging-state.tsx` into clean, maintainable modules following the established codebase patterns.

## Current State Analysis

The component currently handles:
- Mint readiness polling (lines 97-539)
- Step derivation and normalization (lines 183-233)
- Completion tracking (burn/mint timestamps)
- Claim handling for both EVM and Solana (lines 577-753)
- Two distinct render paths (with/without bridgeResult)
- UI for progress display, step list, claim button, info section

**Issues:**
- 11+ useState, 7+ useEffect, 8+ useMemo hooks in single component
- Polling logic tightly coupled with rendering
- Helper functions defined inside component scope
- Two render paths (1046 vs 1157 lines) are independent but interleaved

---

## Refactoring Strategy

### 1. Extract Custom Hooks

#### `useMintPolling` → `lib/hooks/useMintPolling.ts`
**Responsibility:** Poll for mint readiness on EVM destinations

```typescript
interface UseMintPollingResult {
  canMint: boolean;
  alreadyMinted: boolean;
  attestationReady: boolean;
  checking: boolean;
  lastChecked: Date | null;
  error?: string;
}

export function useMintPolling(params: {
  burnTxHash: `0x${string}` | null;
  sourceChainId: ChainId | undefined;
  destinationChainId: ChainId | undefined;
  burnCompletedAt: Date | null;
  startedAt: Date | undefined;
  isSuccess: boolean;
  displaySteps: BridgeResult["steps"];
}): UseMintPollingResult
```

Extracts: lines 97-539 (polling state, shouldPoll memo, polling useEffect)

#### `useBridgeSteps` → `lib/hooks/useBridgeSteps.ts`
**Responsibility:** Derive normalized step state from bridge result

```typescript
interface UseBridgeStepsResult {
  derivedSteps: DerivedStep[];
  hasFetchAttestation: boolean;
  hasBurnCompleted: boolean;
  hasMintCompleted: boolean;
}

export function useBridgeSteps(bridgeResult?: BridgeResult): UseBridgeStepsResult
```

Extracts: lines 183-233 (derivedSteps), lines 798-818 (completion flags)

#### `useClaimHandler` → `lib/hooks/useClaimHandler.ts`
**Responsibility:** Handle claim execution for both EVM and Solana destinations

```typescript
interface UseClaimHandlerParams {
  destinationChainId: ChainId | undefined;
  sourceChainId: ChainId | undefined;
  burnTxHash: `0x${string}` | null;
  displayResult: BridgeResult | undefined;
  onDestinationChain: boolean;
  onSuccess: (updatedSteps: BridgeResult["steps"]) => void;
}

interface UseClaimHandlerResult {
  handleClaim: () => Promise<void>;
  isClaiming: boolean;
}

export function useClaimHandler(params: UseClaimHandlerParams): UseClaimHandlerResult
```

Extracts: lines 577-753 (handleClaim callback + isClaiming state)

Combines:
- `useDirectMint` for EVM destinations
- `useDirectMintSolana` for Solana destinations
- Chain switching logic
- Step update logic

---

### 2. Extract Utility Functions

#### Move to `lib/bridgeKit.ts` or new `lib/bridgeUtils.ts`

**`extractHashes()`** (lines 131-150)
```typescript
export function extractBridgeHashes(result: BridgeResult): {
  burnHash: `0x${string}` | undefined;
  mintHash: `0x${string}` | undefined;
  completedAt: Date | undefined;
}
```

**`formatCompletedLabel()`** (lines 245-267)
```typescript
export function formatCompletedLabel(
  completedAt: Date | null,
  started?: Date | null
): string | null
```

---

### 3. Extract Sub-Components

All sub-components go in `components/bridging-state/` directory.

#### `components/bridging-state/step-list.tsx`
**Responsibility:** Render the list of bridge steps with status indicators

Props:
```typescript
interface StepListProps {
  steps: DerivedStep[];
  sourceChainId: ChainId | undefined;
  destinationChainId: ChainId | undefined;
}
```

Extracts: lines 896-988

#### `components/bridging-state/claim-section.tsx`
**Responsibility:** Claim button and status

Props:
```typescript
interface ClaimSectionProps {
  showClaimButton: boolean;
  amount: string;
  destinationLabel: string;
  onDestinationChain: boolean;
  isClaimPending: boolean;
  isCheckingMint: boolean;
  onClaim: () => void;
}
```

Extracts: lines 990-1014

#### `components/bridging-state/bridge-info.tsx`
**Responsibility:** Type, Sent at, ETA/Completed info display

Props:
```typescript
interface BridgeInfoProps {
  transferType: "fast" | "standard" | undefined;
  sentAtLabel: string;
  isSuccess: boolean;
  completedLabel: string | null;
  etaLabel: string;
}
```

Extracts: lines 1016-1037, 1088-1101

#### `components/bridging-state/chain-pair.tsx`
**Responsibility:** Source/destination chain display with icons

Props:
```typescript
interface ChainPairProps {
  from: { label: string; value: ChainId };
  to: { label: string; value: ChainId };
  amount: string;
  status: "success" | "pending";
}
```

Extracts: lines 875-893, 1064-1085

#### `components/bridging-state/progress-spinner.tsx`
**Responsibility:** Loading spinner with countdown (pre-result view only)

Props:
```typescript
interface ProgressSpinnerProps {
  timeLeft: number;
  progress: number;
  estimatedTime: number | undefined;
}
```

Extracts: lines 1103-1149

---

### 4. Final Component Structure

After refactoring, `bridging-state.tsx` becomes:

```typescript
// components/bridging-state/index.tsx (re-export main component)
// components/bridging-state/bridging-state.tsx (~200 lines)

export function BridgingState(props: BridgingStateProps) {
  // Custom hooks for state
  const mintPolling = useMintPolling({ ... });
  const { derivedSteps, hasBurnCompleted, hasMintCompleted } = useBridgeSteps(displayResult);
  const { handleClaim, isClaiming } = useClaimHandler({
    destinationChainId,
    sourceChainId,
    burnTxHash,
    displayResult,
    onDestinationChain,
    onSuccess: (updatedSteps) => {
      setLocalBridgeResult(prev => prev ? { ...prev, state: "success", steps: updatedSteps } : prev);
      onBridgeResultUpdate?.({ ...displayResult!, state: "success", steps: updatedSteps });
    },
  });

  // Minimal local state (completion tracking)
  const [burnCompletedAt, setBurnCompletedAt] = useState<Date | null>(null);
  const [mintCompletedAt, setMintCompletedAt] = useState<Date | null>(null);
  const [localBridgeResult, setLocalBridgeResult] = useState(bridgeResult);

  // Conditional render
  if (displayResult) {
    return (
      <Card>
        <ChainPair from={displayFrom} to={displayTo} amount={amount} status={...} />
        <StepList steps={derivedSteps} sourceChainId={...} destinationChainId={...} />
        <ClaimSection
          showClaimButton={showClaimButton}
          amount={amount}
          onClaim={handleClaim}
          isClaiming={isClaiming}
          {...otherProps}
        />
        <BridgeInfo {...infoProps} />
      </Card>
    );
  }

  return (
    <Card>
      <ChainPair from={displayFrom} to={displayTo} amount={amount} status="pending" />
      <ProgressSpinner timeLeft={timeLeft} progress={progress} />
      <BridgeInfo {...infoProps} />
    </Card>
  );
}
```

---

## File Structure After Refactoring

```
components/
  bridging-state/
    index.tsx           # Re-exports BridgingState
    bridging-state.tsx  # Main component (~200 lines)
    step-list.tsx       # Step rendering (~100 lines)
    claim-section.tsx   # Claim button (~50 lines)
    bridge-info.tsx     # Info display (~40 lines)
    chain-pair.tsx      # Chain icons/labels (~50 lines)
    progress-spinner.tsx # Loading spinner (~60 lines)
    types.ts            # Shared types for sub-components

lib/
  hooks/
    useMintPolling.ts   # Polling logic (~150 lines)
    useBridgeSteps.ts   # Step derivation (~80 lines)
    useClaimHandler.ts  # Claim execution for EVM + Solana (~180 lines)
  bridgeUtils.ts        # extractBridgeHashes, formatCompletedLabel
```

**Total new files: 11** (6 components, 3 hooks, 1 utils, 1 types)

---

## Implementation Order

1. **Extract utilities** → `lib/bridgeUtils.ts` (low risk, no UI changes)
2. **Extract `useBridgeSteps`** → test step derivation works correctly
3. **Extract `useMintPolling`** → test polling behavior unchanged
4. **Extract `useClaimHandler`** → test EVM and Solana claim paths
5. **Create types file** → `components/bridging-state/types.ts`
6. **Extract sub-components** (in order):
   - `chain-pair.tsx` (simplest, pure presentational)
   - `bridge-info.tsx` (pure presentational)
   - `progress-spinner.tsx` (pure presentational)
   - `step-list.tsx` (has click handlers)
   - `claim-section.tsx` (uses claim handler)
7. **Restructure main component** → compose hooks + sub-components
8. **Create index.tsx** → re-export for clean imports
9. **Update imports** → update bridge-card.tsx import path
10. **Test full flow** → verify EVM and Solana claim paths work

---

## Testing Checklist

- [ ] Standard bridge flow renders correctly
- [ ] Step progress updates in real-time
- [ ] Polling starts after 5 minutes, stops after completion
- [ ] EVM claim button appears when attestation ready
- [ ] Solana claim button appears when burn complete
- [ ] Chain switching works for EVM destinations
- [ ] Already-minted detection works
- [ ] Explorer links open correctly
- [ ] Completion timestamps display correctly

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Polling behavior changes | Extract with same dependencies, test interval timing |
| State sync issues | Keep minimal state in main component, hooks handle derived state |
| Callback prop drilling | Extract handlers to hooks where appropriate |
| Type mismatches | Explicit interfaces at component boundaries |

---

## Expected Outcomes

### LOC Metrics

| File | Before | After | Change |
|------|--------|-------|--------|
| `bridging-state.tsx` | 1,158 | ~200 | **-83%** |
| **Total LOC** | 1,158 | ~900 | ~-22% (distribution across files) |

*Note: Total LOC increases slightly due to explicit interfaces and imports, but cognitive load per file drops significantly.*

### File Size Distribution (After)

| File | LOC | Responsibility |
|------|-----|----------------|
| `bridging-state.tsx` | ~200 | Orchestration only |
| `useMintPolling.ts` | ~150 | Polling logic |
| `useClaimHandler.ts` | ~180 | Claim execution |
| `useBridgeSteps.ts` | ~80 | Step derivation |
| `step-list.tsx` | ~100 | Step UI |
| `progress-spinner.tsx` | ~60 | Loading UI |
| `chain-pair.tsx` | ~50 | Chain display |
| `claim-section.tsx` | ~50 | Claim button |
| `bridge-info.tsx` | ~40 | Info display |
| `bridgeUtils.ts` | ~50 | Utilities |
| `types.ts` | ~40 | Shared types |

### Quantified Benefits

| Metric | Before | After |
|--------|--------|-------|
| **Hooks in main component** | 11+ useState, 7+ useEffect, 8+ useMemo | 3 useState, 2 useEffect |
| **Max file size** | 1,158 lines | ~200 lines |
| **Cyclomatic complexity (main)** | High (nested conditionals, polling logic) | Low (composition only) |
| **Testable units** | 1 monolithic component | 9 independently testable units |

### Qualitative Benefits

1. **Single Responsibility Principle**
   - Each hook has one job (polling, steps, claiming)
   - Each component renders one section (chain pair, steps, info)

2. **Improved Testability**
   - `useMintPolling` can be unit tested with mock timers
   - `useBridgeSteps` is a pure derivation - predictable output for given input
   - Sub-components can be tested with shallow rendering

3. **Easier Debugging**
   - Polling issues → check `useMintPolling.ts`
   - Claim failures → check `useClaimHandler.ts`
   - UI bugs → check specific sub-component

4. **Reduced Cognitive Load**
   - Developer reading main component sees composition, not implementation
   - Each file < 200 lines (your 600-line threshold)

5. **Better Code Reuse**
   - `ChainPair` could be reused in history modal
   - `BridgeInfo` pattern could apply to other status displays
   - Utilities (`extractBridgeHashes`, `formatCompletedLabel`) available globally

6. **Cleaner Dependency Graph**
   - Main component depends on hooks and sub-components
   - Hooks depend on lib utilities
   - Sub-components are pure (props → JSX)

---

## Decisions

- **File structure:** Subdirectory `components/bridging-state/` with `index.tsx` re-exporting main component
- **Claim handler:** Extract to `useClaimHandler` hook (encapsulates EVM + Solana paths)
- **Scope:** Full refactor - all hooks, utilities, and sub-components
