# Bridge Kit Cutover Plan (EVM-first)

## Context Snapshot (Jan 2025)
- App: Next.js (app router) with Wagmi/RainbowKit, Zustand store, and TanStack Query for polling.
- Legacy CCTP integration (now deprecated):
  - Execution: direct `depositForBurn` / `receiveMessage` via hardcoded ABIs and contract maps in `constants/contracts.tsx`.
  - Fee/fast-transfer logic: Iris (`constants/endpoints.tsx`) for fast burn fees/allowance; fee math in `components/bridge-card.tsx`.
  - Attestations & claim: Iris polling via `lib/hooks/useAttestation.ts` and manual claim button.
  - UI flow: `components/bridge-card.tsx` (form + fee/ETA math), `components/bridging-state.tsx` (status), guards under `components/guards/*`, history in `components/history-modal.tsx`.
  - Persistence: `lib/store/transactionStore.ts` stores local tx history keyed by tx hash/domain.
- Dependencies already present: `@circle-fin/bridge-kit@^1.1.0` and `@circle-fin/adapter-viem-v2@^1.0.1` in `package.json`.
- Target scope: Cut over entirely to Bridge Kit for EVM↔EVM first. Add Solana later after E2E validation.

## External Docs / Context7 Reference
- Official docs: https://developers.circle.com/bridge-kit (quickstarts, API usage, viem adapter notes, fast vs standard transfers, smart retry).
- Context7: No dedicated Bridge Kit entry discovered yet (resolver did not return a matching library ID). If/when available, search for “Bridge Kit” and record the Context7 ID here for future lookups.

## Progress
- 2025-02-18: Phase 1 complete (Bridge Kit bootstrap, viem pin, README env notes). Phase 2 in-flight: `useBridge` now routes burns through Bridge Kit EVM adapter; bridge UI submits via SDK with fast/standard transfer speed, removes manual fee/allowance fetches, and auto-tracks tx hashes in store. `BridgingState` and history UI render Bridge Kit step statuses; legacy attestation/claim polling removed.
- 2025-11-30: Removed legacy `constants/*` contract/endpoint paths and unused approval/manual-claim flows. Wagmi/RainbowKit chains now derive directly from Bridge Kit-supported EVM chains per env. Bridge form uses Bridge Kit `estimate` for fee/receive math instead of hardcoded block estimates, and transaction store persists the full `BridgeResult` alongside steps.
- 2025-12-01: Team decision check: (1) Manual resume via History → BridgingState claim button is acceptable; no background auto-resume required for cutover. (2) Testnet validation already run by user. (3) Solana support deferred; EVM-only scope is fine for launch. (4) Custom fee/RPC wiring remains available in `lib/bridgeKit.ts`, but defaults will be used unless envs are set. Marking EVM cutover as ready for prod swap.

## Current Repo State (EVM scope)
- Bridge Kit singleton + helpers live in `lib/bridgeKit.ts` (env toggle, RPC overrides, custom fee policy, `getWagmiChainsForEnv`, `getDefaultTransferSpeed`), shared by Wagmi config in `components/crypto.tsx`.
- Bridge submit path runs through `lib/hooks/useBridge.ts` → `kit.bridge` with viem adapter; it persists `BridgeResult`/steps to the Zustand store.
- Bridge UI (`components/bridge-card.tsx`) sources chain options from Bridge Kit, calls `kit.estimate`, and renders steps via `BridgingState`; history modal also renders steps/Explorer links from the stored `BridgeResult`.
- Transaction store (`lib/store/transactionStore.ts`) persists `BridgeResult` + steps and migrates the legacy store, but does not yet resume/refresh pending items or store provider-specific metadata beyond the raw `BridgeResult`.
- Defaults: UI fast/standard toggle is hardcoded to fast; `NEXT_PUBLIC_BRIDGEKIT_TRANSFER_SPEED` isn’t yet plumbed into initial UI state or estimates.

## Next Actions
- (Deferred) Auto-resume/polling for pending history items; manual resume via History is acceptable for launch.
- (Deferred) Persisting user speed preference; default remains Fast, Standard selectable per transfer.
- (Deferred) Smoke script for CI/regression and Solana adapter notes once EVM cutover is validated.

## Short-Term Implementation Checklist (EVM)
- `useBridge` streaming: attach `kit.on('*')` per invocation, map payloads to `{name,state,txHash,explorerUrl}` and persist into `useTransactionStore` (dedupe by `name` + `txHash`). Unregister listeners on settle.
- Pending resume: `useBridgeMonitor` hook to pull pending items, build adapters from the current wallet, call `kit.retry(storedResult, { from: adapter, to: adapter })`, and merge state/steps back into the store. Gate on connected wallet; mark as “connect to resume” when no signer.
- Default speed: hydrate fast/standard toggle from `getDefaultTransferSpeed` + remember last choice in `sessionStorage`; pass into estimate + submit configs.
- History UX: add a “Resume” affordance on pending rows, show latest step status and explorer links even for synthesized results, and surface retry errors via toast.
- Store shape: keep `bridgeResult` canonical, while caching `provider`, `bridgeState`, `steps`, `hash`/`claimHash`, `originChain`/`targetChain`, `transferType`, and `amount`; continue deduping by burn hash.

## Design: Status Refresh / Resume (Phases 3 & 6)
- On submit, register a temporary `kit.on('*')` listener in `useBridge` to stream step updates (state + txHash + explorerUrl) into `useTransactionStore` while `kit.bridge` runs; unregister on completion/error.
- For persisted `pending` items, add a `useBridgeMonitor` hook that, once a wallet client is available, builds a fresh viem adapter and calls `kit.retry(storedResult, { from: adapter, to: adapter })`. Merge returned `BridgeResult` into the store (update `bridgeState`, `steps`, primary tx hashes, and `status` → `claimed`/`failed`).
- When no wallet is connected, display “Connect to resume” in history rows; optionally poll explorer URLs with `getExplorerTxUrl` to mark obvious successes without a retry.
- Normalize stored data to keep: `bridgeResult` (full), `provider`, `steps`, `bridgeState`, `hash`/`claimHash`, `originChain`/`targetChain`, `transferType`, and `amount`. Dedup by burn tx hash.
- UI: show a “Resume” button on pending history rows (wired to `onLoadBridging`) and surface the latest step/state in `BridgingState` even when the result is synthesized from store data.

### Smoke Script Outline (Phase 8)
- Implement `scripts/bridge-smoke.ts` (run via `bunx tsx`) that:
  - Loads `.env.local` for keys, selects testnet chains (e.g., Ethereum Sepolia → Base Sepolia), and builds viem adapters from `PRIVATE_KEY`.
  - Invokes `kit.estimate` then `kit.bridge`, streams events to stdout, and exits non-zero on failure.
  - Accepts flags for `--amount`, `--from`, `--to`, `--recipient`, `--speed` (FAST/SLOW), and `--rpcOverrides`.
- Provide a README snippet showing `bunx tsx scripts/bridge-smoke.ts --amount 0.1 --from 11155111 --to 84532`.

### Solana Parking Lot
- Hold UI support until EVM path is validated. When enabled: wire `@circle-fin/adapter-solana`, add address format guards (base58), disable diff-wallet toggle unless Solana recipient is supported, and gate routes per `BridgeKit.getSupportedChains()` including non-EVM types. Keep selectors EVM-only until then.

## Phased Plan

### Phase 1 — SDK Bootstrap & Configuration
- Add a singleton Bridge Kit factory (e.g., `lib/bridgeKit.ts`) that:
  - Instantiates Bridge Kit with the viem adapter only (EVM scope).
  - Exposes environment selection (mainnet/testnet), custom RPC overrides, and monetization/fee config.
  - Pins viem to a known-good version per docs (viem ≥2.40.3 noted in docs) and ensures Wagmi compatibility in `package.json`.
- Document required env vars and defaults in `README.md` (Bridge Kit section).

### Phase 2 — Replace Bridge Execution Path
- Refactor `lib/hooks/useBridge.ts` to call `kit.bridge` for EVM→EVM; remove direct `depositForBurn`/`receiveMessage` usage and fee math.
- Map UI fast/standard toggle to SDK transfer-speed options; stop calling `getFastTransferFee`/`getFastTransferAllowance`.
- Quarantine or disable legacy contract/domain lookups from `constants/contracts.tsx` for active flow (retain only for reference until cleanup).

### Phase 3 — Status via SDK
- Render status from Bridge Kit monitor/steps in `components/bridging-state.tsx` and history UI; remove Iris polling/claim UI.
- Align toast/error handling to SDK error shapes.

### Phase 4 — Allowance, Balance, and Validation Alignment
- If SDK exposes approval helpers, refactor `components/guards/ApproveGuard` and usage in `components/bridge-card.tsx`; otherwise, wrap SDK guidance. (Current flow relies on Bridge Kit defaults; legacy guard removed.)
- Ensure `lib/hooks/useBalance.ts` and `lib/validation.ts` use SDK token metadata (decimals/limits) where available; remove hardcoded fee/ETA math from `components/bridge-card.tsx` and `constants/endpoints.tsx`. (Done for EVM chains; balance/fees now sourced from Bridge Kit.)

### Phase 5 — UI and Routing Updates (EVM-only)
- Populate chain selectors in `components/bridge-card.tsx` from SDK-supported EVM routes instead of `supportedChains`/`contracts.tsx`.
- Use SDK quote/estimate data for “You will receive” and ETA displays; remove manual calculations.
- Keep fast/standard toggle, but its data should come from SDK quotes.

### Phase 6 — Persistence & History
- Update `lib/store/transactionStore.ts` to store SDK transfer IDs/status payloads (instead of raw tx hash/domain) and adjust `components/history-modal.tsx` / `components/bridging-state.tsx` to render from the new shape.

### Phase 7 — Cleanup & Documentation
- Remove dead code: legacy contract maps, fee helpers, Iris endpoints once SDK path is stable.
- Update `README.md` with Bridge Kit setup, EVM-only scope, and run steps (dev/lint/build).
- Add a short note on future Solana enablement (adapter wiring, non-EVM address UX) but keep disabled until EVM flow is verified.

### Phase 8 — Testing & Verification (EVM routes)
- Add/execute a smoke script (bun/tsx) to bridge a small USDC amount on testnets via SDK.
- Manual QA: connect wallet, bridge EVM→EVM, observe status/claim flow, verify history persistence.
- Run lint/typecheck before signoff.

## Risks / Open Questions
- Context7 library not yet available; may need to rely on direct docs scraping until an ID is published.
- Wagmi/viem compatibility after pinning (verify after bump).
- Non-EVM (Solana) UI adjustments deferred; ensure current UI guards against selecting non-EVM routes until adapters added.

## Success Criteria
- All bridge/claim/status flows use Bridge Kit SDK (no contract ABI calls in app codepaths).
- UI shows SDK-derived fees/ETAs; manual fee math removed.
- Transaction history stores SDK transfer identifiers and statuses.
- No reliance on legacy `constants/*` contract maps, Iris endpoints, or manual claim/approval components in the active EVM flow.
- EVM→EVM testnet smoke passes; lint/typecheck clean.
