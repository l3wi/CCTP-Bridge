# Task: Add Gas Balance Check Before Mint/Claim

## Status: Completed

## Problem Statement

When users try to claim/mint on Solana (or EVM) with insufficient native token balance for gas fees, Phantom wallet shows a "malicious website" warning instead of a friendly error. This creates a poor user experience and makes the site appear untrustworthy.

**User Report:** "If your wallet SOL balance is not enough, you click claim, you will be warned by phantom that your website is not secure"

## Solution Implemented

Added pre-flight gas cost estimation using **dynamic simulation** before attempting mint transactions. The check happens after attestation is fetched and transaction is built, but BEFORE the wallet signing prompt appears.

## Files Changed

### New Files

| File | Purpose |
|------|---------|
| `lib/cctp/gasEstimation.ts` | Dynamic gas estimation utilities for EVM and Solana |

### Modified Files

| File | Changes |
|------|---------|
| `lib/cctp/hooks/useMint.ts` | Added gas balance checks in both `executeEvmMint` and `executeSolanaMint` |

## Implementation Details

### Gas Estimation Utilities (`lib/cctp/gasEstimation.ts`)

Created new utility module with:

1. **`estimateSolanaMintGas()`** - Estimates Solana transaction fees
   - Uses `connection.getFeeForMessage()` for accurate fee calculation
   - Checks if USDC ATA needs creation (adds ~0.00204 SOL rent)
   - Returns breakdown of costs (txFee + optional ataCreation)

2. **`estimateEvmMintGas()`** - Estimates EVM gas costs
   - Uses `publicClient.estimateGas()` with actual receiveMessage call data
   - Multiplies by current gas price from `publicClient.getGasPrice()`
   - Returns required amount with buffer

3. **Formatting utilities**
   - `formatSol(lamports)` - Formats lamports to human-readable SOL
   - `formatNative(wei)` - Formats wei to human-readable ETH/native token

### Buffer Constants

| Constant | Value | Rationale |
|----------|-------|-----------|
| `ATA_RENT_LAMPORTS` | 2,039,280 | Fixed by Solana runtime for token accounts |
| `EVM_GAS_BUFFER` | 1.2 (20%) | Buffer for gas price fluctuation |
| `SOL_FEE_BUFFER` | 1.5 (50%) | Buffer for priority fees and computation units |

### Integration in `useMint.ts`

**Solana Flow:**
1. Fetch attestation
2. Check if already minted (nonce check)
3. Build receiveMessage transaction
4. **NEW: Check SOL balance** - fetches balance, estimates gas, returns error if insufficient
5. Sign transaction
6. Send transaction
7. Update transaction store

**EVM Flow:**
1. Fetch attestation
2. Simulate to verify mint will succeed
3. **NEW: Check native balance** - estimates gas, returns error if insufficient
4. Execute mint transaction
5. Wait for confirmation
6. Update transaction store

### Error Messages

**Solana (with ATA creation needed):**
> "Insufficient SOL for gas. You need ~0.00307 SOL for creating your USDC account and transaction fees. Current: 0.001 SOL."

**Solana (ATA exists):**
> "Insufficient SOL for gas. You need ~0.00002 SOL for transaction fees. Current: 0.00001 SOL."

**EVM:**
> "Insufficient ETH for gas. You need ~0.00015 ETH but have 0.00001 ETH."

## Verification

- `bun run lint` - Passes
- `bun run build` - Passes
- `bun run test:run` - 23 tests pass

### Test Coverage

Created comprehensive unit tests in `lib/cctp/gasEstimation.test.ts`:

**formatSol tests (6 tests):**
- Zero lamports formatting
- Small amounts (< 0.0001 SOL) with 6 decimals
- Medium amounts (0.0001 - 0.01 SOL) with 5 decimals
- Large amounts (>= 0.01 SOL) with 4 decimals
- Typical ATA rent amount
- Typical transaction fee

**formatNative tests (6 tests):**
- Zero wei formatting
- Small amounts (< 0.0001 ETH) with 6 decimals
- Medium amounts (0.0001 - 0.01 ETH) with 5 decimals
- Large amounts (>= 0.01 ETH) with 4 decimals
- Custom decimals (e.g., USDC with 6 decimals)
- Typical gas cost

**estimateSolanaMintGas tests (5 tests):**
- Sufficient balance without ATA creation
- Insufficient balance detection
- ATA creation cost inclusion
- Fallback fee when RPC fails
- Legacy transaction handling

**estimateEvmMintGas tests (4 tests):**
- Sufficient balance detection
- Insufficient balance detection
- 20% buffer application
- Correct function call encoding

**GasEstimate type tests (2 tests):**
- Correct structure for sufficient balance
- Correct structure for insufficient balance with ATA

## Manual Testing Checklist

- [ ] **Solana (no ATA):** New wallet with low SOL, attempt claim, verify toast shows estimate with "creating your USDC account"
- [ ] **Solana (has ATA):** Existing wallet with very low SOL (< 0.0001), verify toast shows tx fee only
- [ ] **Solana (sufficient):** Wallet with adequate SOL, verify claim proceeds normally
- [ ] **EVM:** Wallet with very low ETH, attempt claim, verify toast shows gas estimate
- [ ] **EVM (sufficient):** Wallet with adequate ETH, verify claim proceeds normally

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Gas estimation RPC call fails | Caught with try/catch, logs warning, proceeds anyway (let wallet handle) |
| Gas price spikes between estimate and execution | 20% buffer for EVM, 50% for Solana |
| Estimation adds latency | Minimal - runs during claim flow anyway; attestation fetch is slower |
