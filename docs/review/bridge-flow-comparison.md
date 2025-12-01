# Bridge Flow Comparison (Reference vs Current App)

## Reference: `reference/circle-bridge-kit-transfer`
- **Chain discovery**: Fetches Bridge Kit chains at runtime (`BridgeKit().getSupportedChains()`), filters to testnets, and builds Wagmi config dynamically (`src/App.tsx`, `src/lib/wagmiConfig.ts`, `src/lib/mapChains.ts`). No env switcher; always testnet.
- **Wallet/adapters**: Supports both EVM and Solana. EVM adapter is created from the active Wagmi connector or `window.ethereum` (`src/hooks/useEvmAdapter.ts`). Solana adapter is built directly from `window.solana` (`src/hooks/useSolanaWallet.ts`). Source/destination chain dropdowns are enabled only when the relevant wallet type is connected.
- **Balances**: Reads USDC balances per selected chain using Bridge Kit actions (`usdc.balanceOf`) with the appropriate adapter (`src/hooks/useUsdcBalance.ts`). This allows showing balances for any selectable chain, not just the connected one.
- **Submit path** (`src/App.tsx`):
  - Starts with local UI state: sets `approving` step, logs, and resets success/error flags.
  - If the destination is EVM, attempts to switch the wallet network before bridging; on mint events, auto-switches to the destination chain to sign the mint when needed.
  - Calls `useBridge().bridge(...)` with both adapters; attaches `kit.on('*')` via the hook to stream Bridge Kit events back to the UI.
  - Event handler maps Bridge Kit lifecycle (`approve` → `burn` → `fetchAttestation` → `mint`) into `useProgress` for step state + timestamped logs (`src/hooks/useProgress.ts`).
  - Success: marks success UI, refreshes the source balance, clears amount. Failure: sets failed flag and appends error log. No persistence across reloads.
- **Design choices**: Event-driven progress with live logs, explicit Solana/EVM dual-wallet support, runtime chain list (testnet-only), minimal validation (amount > 0, balance cap), manual reset to restart.

## Current app: `components/bridge-card.tsx` + `lib/hooks/useBridge.ts`
- **Chain discovery**: Uses Bridge Kit chain definitions but filters to EVM only and to the configured env (`BRIDGEKIT_ENV`, default testnet). Wagmi config is built once at module load from `getWagmiChainsForEnv`/`getWagmiTransportsForEnv` (`components/crypto.tsx`, `lib/bridgeKit.ts`).
- **Wallet/adapters**: EVM-only. Builds a single viem adapter from the connected wallet provider; the same adapter is reused for both source and destination in `kit.bridge` (`lib/hooks/useBridge.ts`). Solana is not exposed in the UI.
- **Balances**: Uses Wagmi `useBalance` for USDC/native on the currently connected chain (`lib/hooks/useBalance.ts`). Does not fetch balances for arbitrary selectable chains.
- **Pre-flight UX** (`components/bridge-card.tsx`):
  - Validates amount format/decimals and chain selection; derives supported chain list from Bridge Kit and keeps source/destination dropdowns in sync.
  - Estimates protocol fees and ETA for both Standard and Fast speeds via `kit.estimate` with a readonly adapter and shows “you will receive” math; defaults to Fast if supported.
  - Supports custom fee policy and RPC overrides via env (`lib/bridgeKit.ts`).
- **Submit path**:
  - Requires wallet on the selected source chain; does not attempt destination chain switching pre-submit.
  - Calls `useBridge().bridge(...)` with `transferSpeed` config; no Bridge Kit event subscription. The hook returns once `kit.bridge` resolves, then stores the result in a persisted Zustand transaction log with hashes, steps, status, and analytics tracking.
  - UI moves into `BridgingState` after the call, showing steps from the final result. Live step updates only happen when `retryClaim` is used.
- **Post-submit / recovery**:
  - `BridgingState` can resume from persisted transactions (History modal), normalize “nonce already used” into success, and offers retry/force retry via `kit.retry` (`lib/hooks/useClaim.ts`).
  - Claim flow prompts the user to switch to the destination chain before retrying mint; provides explorer links if hashes exist.
- **Design choices**: Persistent history, fee/ETA estimates, dual-speed (Fast/Standard) selection, error-to-toast UX, analytics, and a manual claim/retry surface. Progress is primarily result-driven rather than event-driven.

## Key Differences and Gaps
- **Event streaming vs. result-driven**: Reference subscribes to Bridge Kit events to show live step transitions and logs; our app waits for `kit.bridge` to resolve and only updates steps afterward (except during manual claim retries).
- **Chain coverage**: Reference supports Solana + EVM with dual adapters and disables unavailable options based on wallet connections. Our app is EVM-only and assumes one adapter can serve both legs.
- **Network switching**: Reference auto-switches to destination around the mint step and pre-bridging for EVM destinations; our flow only enforces being on the source chain and defers destination switching to the claim retry UX.
- **Balances**: Reference fetches USDC balances for whichever chain is selected using Bridge Kit actions; our UI shows balance only for the connected chain via Wagmi.
- **Transfer speed**: Our app exposes Standard vs Fast (configurable and estimated). The reference sample always calls `bridge` without a transfer speed toggle, effectively using the Bridge Kit default.
- **Persistence and resume**: We persist transactions, allow reopening previous transfers, and normalize “nonce already used” into a claimed state. Reference holds everything in component state and relies on manual reset if something fails.
- **Validation and guardrails**: Our form enforces decimal precision and chain compatibility, and blocks submission unless the wallet matches the source chain. The reference form is simpler (amount > 0, destination != source).
- **Config hooks**: Our helper layer adds env switching, RPC override parsing, and custom fee policy wiring; the reference stays close to the default Bridge Kit surfaces.
