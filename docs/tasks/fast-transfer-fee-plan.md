# Fast Transfer Fee Plan

## Goal

Apply an app-level fee to every fast CCTP transfer without changing Circle's fast-liquidity fee semantics.

The fee should be enabled only when all fee configuration is present:

- `NEXT_PUBLIC_FAST_TX_FEE_BPS` - fee rate in basis points, e.g. `5` for 0.05%.
- `NEXT_PUBLIC_FEE_ADDRESS_EVM` - EVM USDC fee recipient.
- `NEXT_PUBLIC_FEE_ADDRESS_SOL` - Solana USDC fee recipient owner.

If any of those values is missing or invalid, the app-level fee should be disabled and the existing bridge flow should behave as it does today.

## Current Flow

The app no longer routes execution through BridgeKit for transfers. `useCrossEcosystemBridge` calls `useBurn`, and `useBurn` dispatches by source ecosystem.

- EVM source: `lib/cctp/hooks/useBurn.ts` prepares an EVM burn with `prepareEvmBurn`, approves USDC to Circle's TokenMessenger, then sends a direct `depositForBurn` transaction.
- Solana source: `lib/cctp/hooks/useBurn.ts` calculates Circle's fast `maxFee`, then asks `lib/cctp/solana/burn.ts` to build a Solana transaction containing the CCTP burn instructions.
- Estimation: `lib/cctp/estimate.ts` fetches Circle's fast tier, calculates the protocol fee, and returns that fee in `BridgeEstimate.fees`.

Circle's fast fee is already modeled as `maxFee` on the CCTP burn:

- EVM: `buildDepositForBurnData(..., maxFee, minFinalityThreshold)`.
- Solana: Anchor `depositForBurn({ ..., maxFee, minFinalityThreshold })`.

That `maxFee` must remain Circle-only. The app fee should not be added to `maxFee`, because `maxFee` is the maximum Circle fast-liquidity fee that the protocol may execute at mint time. Adding the app fee there would over-authorize Circle's fee path and would not route funds to our fee addresses.

## BridgeKit Fee Logic

BridgeKit already has a custom fee model we should copy conceptually, not reinvent from scratch.

Relevant installed package paths:

- `@circle-fin/bridge-kit`: `CustomFeePolicy`, `setCustomFeePolicy`, and `mergeCustomFeeConfig`.
- `@circle-fin/provider-cctp-v2`: approval, estimation, and provider routing for `config.customFee`.
- `@circle-fin/adapter-viem-v2`: EVM `cctp.v2.customBurn` implementation.
- `@circle-fin/adapter-solana`: Solana `cctp.v2.customBurn` implementation.

BridgeKit's model:

- A custom fee is configured as `config.customFee.value` plus `config.customFee.recipientAddress`.
- The fee is added on top of the bridge amount. Approval is for `amount + customFee`.
- CCTP still burns the original `amount`.
- Circle's fast fee stays in `maxFee`.
- Estimates add Circle's fast fee as `type: "provider"` and the custom fee as `type: "kit"`.
- If a custom fee value is present without a recipient, the provider rejects the transfer.

The important nuance: Circle's custom fee contract splits the custom fee. Their docs and types state that 10% routes to Circle and 90% routes to the configured recipient. So a configured 5 bps custom fee yields 4.5 bps to our fee recipient and 0.5 bps to Circle. If the business requirement is "user pays 5 bps total", use `5`. If the requirement is "our recipient receives 5 bps", either configure `ceil(5 / 0.9) = 5.555... bps` with explicit rounding rules or use our own fee contract instead of Circle's kit fee contract.

EVM implementation details we can copy:

- BridgeKit checks `chain.kitContracts?.bridge` with `hasCustomContractSupport(chain, "bridge")`.
- If present, it calls the bridge contract instead of TokenMessenger.
- The EVM bridge ABI method is `bridgeWithPreapproval((amount,maxFee,fee,mintRecipient,destinationCaller,burnToken,feeRecipient,destinationDomain,minFinalityThreshold))`.
- It validates that `protocolFee > 0n` requires `feeRecipient`.
- It passes `fee` separately from `maxFee`.

Solana implementation details we can copy:

- BridgeKit uses the Solana BridgeKit program `bridge` instruction rather than manually adding a plain SPL token transfer.
- It passes `bridgingKitFee` separately from CCTP `maxFee`.
- It derives both the Circle protocol-fee wallet ATA and developer fee recipient ATA.
- It adds idempotent ATA creation instructions when those fee ATAs are missing.

Current repo gap: our generated metadata strips `kitContracts`, so the app cannot currently resolve Circle's custom bridge contracts from `lib/metadata`. If we use Circle's custom-burn path directly, metadata generation and `lib/metadata/types.ts` need to preserve `kitContracts.bridge`.

## Recommended Design

Add a small fee-policy module and collect the app fee as a separate source-side fee component.

Use this formula for fast transfers only:

```ts
appFee = ceil(amount * feeBps / 10_000)
```

Important invariants:

- `amount` remains the user-entered bridge amount.
- `Circle maxFee` remains calculated exactly as it is today from Iris, including the current buffer.
- `appFee` is displayed and collected separately.
- For fast transfers, the user's required source USDC is `amount + appFee`.
- For standard transfers, `appFee` is always `0`.

This means the receiver still gets:

```text
amount - Circle executed fast fee
```

If we use our own fee-transfer path, the app receives:

```text
appFee
```

If we use Circle's BridgeKit custom-burn path, the configured fee recipient receives 90% of `appFee` and Circle receives 10% of `appFee`.

## New Shared Module

Add `lib/cctp/fastTransferFee.ts`:

- Parse `NEXT_PUBLIC_FAST_TX_FEE_BPS` as a non-negative integer bps value.
- Validate `NEXT_PUBLIC_FEE_ADDRESS_EVM` with `isEvmAddress`.
- Validate `NEXT_PUBLIC_FEE_ADDRESS_SOL` with `isSolanaAddress`.
- Export `getFastTransferFeeConfig()`.
- Export `calculateFastTransferFee(amount: bigint, transferSpeed: TransferSpeed)`.
- Export `getFastTransferFeeRecipient(sourceChainId: ChainId)`.

The gate should be all-or-nothing for the feature:

```ts
enabled =
  feeBps > 0 &&
  valid EVM fee address &&
  valid Solana fee address
```

If disabled, return `feeAmount: 0n` and no recipient. This keeps incomplete deployment config from partially charging one ecosystem while silently skipping the other.

Enhancement over BridgeKit: gate by all three env vars and speed. BridgeKit can attach a custom fee to any bridge when a policy exists; this app should only return a non-zero app fee for `transferSpeed === "fast"` and when both ecosystem fee recipients are configured.

## Solana Hook

There are two viable Solana approaches.

Preferred if we accept Circle's 10%/90% custom fee split: port BridgeKit's Solana custom-burn behavior into our direct builder.

Hook point: `lib/cctp/solana/burn.ts`, inside `buildDepositForBurnTransaction`.

Implementation shape:

1. Preserve BridgeKit Solana program IDs and PDAs needed by the BridgeKit custom burn program.
2. Extend `SolanaBurnParams` with:
   - `appFeeAmount?: bigint`
   - `appFeeRecipient?: PublicKey`
3. Use the BridgeKit program `bridge` instruction instead of the TokenMessenger `depositForBurn` instruction when `appFeeAmount > 0n`.
4. Pass:
   - `amount` as the bridge amount.
   - `maxFee` as Circle's CCTP fast fee cap.
   - `bridgingKitFee` as the app fee.
   - the developer fee recipient ATA separately from Circle's protocol fee wallet ATA.
5. Add idempotent ATA creation for missing fee recipient ATAs, matching Circle's adapter.

This keeps behavior aligned with BridgeKit and avoids maintaining a different Solana economics path.

Alternative if we want 100% of the fee to our Solana recipient: keep the current CCTP TokenMessenger instruction and add a separate SPL token transfer instruction in the same Solana transaction.

That implementation shape is:

1. Extend `SolanaBurnParams` with:
   - `appFeeAmount?: bigint`
   - `appFeeRecipient?: PublicKey`
2. Derive the fee recipient's USDC ATA:
   - `feeRecipientUsdcAta = getAssociatedTokenAddress(usdcMint, appFeeRecipient)`
3. Add a SPL token transfer instruction from `userUsdcAta` to `feeRecipientUsdcAta` for `appFeeAmount`.
4. Add it before the CCTP burn instruction in the same transaction:

```ts
const instructions = [fundMessageAccountIx];

if (appFeeAmount > 0n && appFeeRecipient) {
  instructions.push(createTransferInstruction(
    userUsdcAta,
    feeRecipientUsdcAta,
    user,
    appFeeAmount
  ));
}

instructions.push(depositForBurnIx);
const transaction = new Transaction().add(...instructions);
```

This is also atomic because the Solana fee transfer and CCTP burn are part of the same signed transaction. If the transaction fails, neither happens.

One operational detail: decide whether the fee recipient USDC ATA must already exist. The simplest robust version requires it to exist and fails with a clear config/setup error if missing. Creating the recipient ATA inside every user transaction adds rent and extra failure modes to user flow.

## EVM Hook

EVM cannot cleanly do an app USDC transfer and Circle `depositForBurn` atomically from the current direct EOA flow. A normal wallet transaction can call only one contract. The current code calls Circle's TokenMessenger directly, so there is no place to include both:

- `USDC.transferFrom(user, feeRecipient, appFee)`
- `TokenMessenger.depositForBurn(amount, ...)`

Do not implement this as "fee transfer tx, then burn tx" if the requirement is robust. That can collect the app fee while the burn later fails or is rejected.

Clean EVM implementation should use Circle's deployed BridgeKit bridge contract where `kitContracts.bridge` exists. This is better than deploying our own router unless we need 100% of the fee to our recipient.

Circle's EVM bridge call shape:

```ts
bridgeWithPreapproval({
  amount,
  maxFee: circleMaxFee,
  fee: appFee,
  mintRecipient,
  destinationCaller,
  burnToken,
  feeRecipient,
  destinationDomain,
  minFinalityThreshold,
});
```

Then update the EVM app flow:

1. Preserve `kitContracts.bridge` in generated metadata.
2. Resolve a `bridgeContractAddress` for the source chain when the fast fee config is enabled.
3. In `prepareEvmBurn`, include `appFeeAmount`, `appFeeRecipient`, and `bridgeContractAddress`.
4. In `useBurn.executeEvmBurn`, approve `amount + appFeeAmount` to `bridgeContractAddress` when the fee path is active.
5. Replace direct `buildDepositForBurnData(tokenMessenger, ...)` with `buildBridgeWithPreapprovalData(bridgeContractAddress, ...)`.
6. Keep the old direct TokenMessenger path when the fee config is disabled.

If a supported EVM chain lacks `kitContracts.bridge`, fast fee mode should either be disabled for that route or use our own deployed router contract. It should not fall back to a non-atomic fee transfer.

## Estimation and UI

Hook point: `lib/cctp/estimate.ts`.

For fast estimates:

1. Calculate Circle's protocol fee exactly as today.
2. Calculate `appFee` from `amount` and fee bps when config is enabled.
3. Return both fee items in `BridgeEstimate.fees`.

`EstimateFee.type` currently only allows `"protocol"`. Change it to match the distinction BridgeKit uses:

```ts
type EstimateFeeType = "provider" | "kit";
```

Use `provider` for Circle's fast fee and `kit` for the app fee. The existing UI already totals all `estimate.fees` via `getTotalProtocolFee`, so it will subtract both fees from "You will receive" unless we change the model. Because the app fee is charged on top of the bridge amount, the UI should not subtract it from the destination receive amount.

Recommended UI model:

- Rename UI helper from `getTotalProtocolFee` to `getDestinationDeductedFee`.
- Only subtract `provider` fees from "You will receive".
- Show app fee separately as "Fast tx fee".
- Show total source USDC required as `amount + appFee`.

This distinction matters because Circle's fee reduces destination proceeds, while the app fee is an additional source-side charge.

## Store and Analytics

`LocalTransaction.fee` is currently described as "Fast transfer fee (USDC)" in the shared transaction types, but it does not distinguish Circle fee from app fee.

Use explicit fields for future auditability:

- `circleFastFee?: string`
- `appFastFee?: string`
- `appFeeBps?: number`
- `appFeeRecipient?: string`

Keep the existing `fee` field only as a legacy display/migration value. New writes should use explicit fields.

The Meta analytics event already encodes fast txs as `1` in `lib/analytics/trackVerifiedBridgeView.ts`; no routing change is needed, but adding `app_fee_amount` and `app_fee_bps` would make fee reconciliation easier.

## Tests

Add focused unit tests before implementation:

- `tests/lib/cctp/fastTransferFee.test.ts`
  - disabled when any env value is missing.
  - rejects invalid EVM/Solana addresses.
  - calculates 5 bps with ceiling division.
  - returns zero for standard transfers.
- `tests/lib/cctp/estimate.test.ts`
  - keeps Circle fee separate from app fee.
  - standard estimates do not include app fee.
- `tests/lib/cctp/solana/burn.test.ts`
  - custom-burn BridgeKit instruction is used for fast Solana burns when config is enabled, or the manual SPL transfer instruction is included if we choose the 100% recipient path.
  - fee instruction is omitted when disabled.
- `tests/lib/cctp/evm/burn.test.ts`
  - BridgeKit bridge approval uses `amount + appFee`.
  - direct TokenMessenger path remains unchanged when disabled.
  - Circle `maxFee` passed to CCTP is not increased by `appFee`.

## Rollout

1. Add fee config parsing and tests.
2. Update estimates and UI copy so users see destination-deducted Circle fee separately from source-side app fee.
3. Preserve `kitContracts.bridge` in generated metadata.
4. Implement EVM fast fee burns through Circle's BridgeKit bridge contract.
5. Implement Solana fast fee burns by porting Circle's custom-burn instruction path, or explicitly choose the manual SPL fee-transfer path if we need 100% recipient economics.
6. Add a small reconciliation note to transaction persistence and analytics.

This keeps standard transfers untouched and keeps Circle's `maxFee` as the protocol fee cap, while applying the app fee uniformly to every fast transfer once both ecosystem fee recipients and required bridge contracts are configured.
