# Repository Guidelines

## Project Structure & Module Organization
- Next.js App Router lives in `app/` (`layout.tsx`, `page.tsx`, `og/`), with global styles in `app/globals.css`.
- UI is split between `components/` (shadcn/Radix-based atoms, wallet/bridge widgets, guards, loading states) and `public/` assets (chain icons, OG image).
- Feature logic and data plumbing sit in `lib/` (`bridgeKit.ts`, `cctpFinality.ts`, Zustand store in `lib/store/`, React hooks in `lib/hooks/`, shared types/utils).
- Architecture notes and tasks belong in `docs/` (e.g., `docs/tasks/bridge-kit-cutover.md`). Keep README aligned when behavior changes.

## Build, Test, and Development Commands
- Install: `bun install` (pref) or your package manager.
- Develop: `bun run dev` (Next.js + Turbopack).
- Lint: `bun run lint` (Next ESLint config).
- Build: `bun run build`; Production serve: `bun run start`.
- No test suite checked in yet; add `bunx vitest`/`bunx jest` when introducing tests and wire scripts accordingly.

## Coding Style & Naming Conventions
- TypeScript-first; prefer small, pure functions and composition. Client/server boundaries must stay explicit in App Router.
- Components and files: PascalCase for React components, camelCase for functions/variables, `useX` for hooks, `<verb><Noun>Guard` for guards.
- State: Zustand slices live under `lib/store/`; async data via TanStack Query with `staleTime: 300_000`, `gcTime: 600_000` unless a tighter window is justified.
- Styling: Tailwind (v4) utilities in components; avoid inline color literals—use semantic classes/tokens.

## Testing Guidelines
- Add tests beside implementation (`*.test.ts` / `*.test.tsx`) when expanding logic; mock BridgeKit/viem/wallet calls to avoid network usage.
- Validate linting before PRs; keep tests deterministic (no real RPCs or wallets).

## Commit & Pull Request Guidelines
- Conventional Commits with context: `git add -A && git commit -m "<type>(<scope>): <summary> — <detail>"`.
- PRs: clear description, linked issue (if any), before/after screenshots for UI changes, and notes on env vars or migrations. Keep `README.md` and any relevant `docs/` entries updated.
- Avoid introducing legacy compatibility without discussion; prefer minimal, forward-looking changes.

## Configuration & Security Tips
- Configure via `.env.local`; key vars: `NEXT_PUBLIC_BRIDGEKIT_ENV` (`testnet`/`mainnet`), optional `NEXT_PUBLIC_BRIDGEKIT_RPC_OVERRIDES`, transfer speed/fees (`NEXT_PUBLIC_BRIDGEKIT_TRANSFER_SPEED`, custom fee/recipient).
- Do not commit secrets or private RPC URLs; rely on Bridge Kit chain metadata instead of hardcoding addresses.
