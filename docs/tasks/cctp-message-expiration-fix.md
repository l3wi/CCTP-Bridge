# Fix: CCTP v2 Message Expiration & Re-Attestation

## Problem Statement

Users are encountering two issues when claiming USDC on Solana from Base:

1. **MessageExpired (Error 6016)**: CCTP v2 Fast transfers have a ~30-minute validity window. When users don't claim within this window, the mint transaction fails with "Message has expired."

2. **Transaction too large (1297 > 1232)**: The Solana mint transaction exceeds the 1232-byte limit.

Currently, users see a cryptic "Claim failed" toast with no actionable guidance.

## Root Cause Analysis

### Why Expiration Happens
- CCTP v2 Fast transfers have a finite validity window (~30 minutes)
- The UI shows "Claim" button even for expired messages
- No pre-mint expiration validation exists
- Circle's Iris API doesn't return expiration timestamps

### Why Transaction Size Exceeds Limit
- Solana max transaction size is 1232 bytes (legacy transactions)
- Our transaction includes: message bytes + attestation bytes + 17 accounts
- Attestation = 65 bytes × N signers
- For this user's transaction: 1297 bytes > 1232 limit
- Requires versioned transactions with Address Lookup Tables (ALTs)

## Recovery Path: Re-Attestation API

Circle provides a re-attestation endpoint that can **revive expired Fast Transfer burns**:

```
POST /v2/reattest/{nonce}
```

**Endpoints:**
- Testnet: `https://iris-api-sandbox.circle.com/v2/reattest/{nonce}`
- Mainnet: `https://iris-api.circle.com/v2/reattest/{nonce}`

**Response:**
```json
{
  "message": "Re-attestation successfully requested for nonce.",
  "nonce": "234"
}
```

After re-attestation, fetch the new attestation and retry mint.

## Proposed Solution

### Phase 1: Detect & Auto-Recover from Expiration
**Goal**: Automatically re-attest and retry when mint fails due to expiration

1. **Add re-attestation API client** (`lib/iris.ts`)
   - Add `requestReattestation(nonce: string, isTestnet: boolean)` function
   - Handle API response and error cases

2. **Add MessageExpired error detection** (`lib/cctp/errors.ts`)
   - Add `MESSAGE_EXPIRED` error code
   - Add detection for error 6016 / "MessageExpired" pattern

3. **Update Solana mint error handler** (`lib/cctp/hooks/useMint.ts`)
   - Detect MessageExpired error in handleSolanaMintError (lines 438-491)
   - Extract nonce from attestation data
   - Call re-attestation API
   - Wait for new attestation (poll)
   - Retry mint with new attestation

4. **Update UI feedback**
   - Show "Refreshing attestation..." during re-attestation
   - Retry claim automatically after success
   - Show clear error if re-attestation fails

### Phase 2: Fix Transaction Size (Versioned Transactions)
**Goal**: Ensure Solana mint transactions fit within size limit

**Key finding**: Bridge Kit SDK imports `VersionedTransaction` + `TransactionMessage` but doesn't use ALTs. Our code uses legacy `Transaction` which is limited to 1232 bytes.

1. **Convert to versioned transactions** (`lib/cctp/solana/mint.ts`)
   - Use `VersionedTransaction` instead of legacy `Transaction`
   - Use `TransactionMessage.compileToV0Message([lookupTable])`
   - Reduces each account reference from 32 bytes to 1 byte

2. **Create ALT for static accounts** (one-time deployment)
   - Static accounts that can go in ALT:
     - `TOKEN_MESSENGER_PROGRAM_ID`
     - `MESSAGE_TRANSMITTER_PROGRAM_ID`
     - `TOKEN_PROGRAM_ID`
     - `SystemProgram.programId`
     - USDC mint (mainnet/testnet)
     - Static PDAs (tokenMessengerPda, messageTransmitterPda, tokenMinterPda)
   - Dynamic accounts that CANNOT go in ALT:
     - User's ATA
     - usedNonce PDA (derived from nonce)
     - Fee recipient ATA
   - Deploy script: `scripts/create-cctp-alt.ts`

3. **Transaction size calculation**:
   - Current: ~17 accounts × 32 bytes = 544 bytes for accounts alone
   - With ALT: ~6 accounts in ALT = 6 bytes + ~10 accounts × 32 = 326 bytes
   - Saves ~218 bytes → should fit within 1232 limit

## Files to Modify

### Phase 1 (Re-Attestation)
| File | Changes |
|------|---------|
| `lib/iris.ts` | Add `requestReattestation()` function |
| `lib/cctp/errors.ts` | Add `MESSAGE_EXPIRED` error code + detection |
| `lib/cctp/hooks/useMint.ts` | Add re-attestation + retry logic in error handler |
| `lib/hooks/useClaimHandler.ts` | Update toast messages for re-attestation flow |

### Phase 2 (Transaction Size)
| File | Changes |
|------|---------|
| `lib/cctp/solana/mint.ts` | Convert to VersionedTransaction + ALT |
| `lib/cctp/shared.ts` | Add ALT addresses for mainnet/testnet |
| `scripts/create-cctp-alt.ts` | New - one-time ALT deployment script |

## Implementation Order

Since the transaction size issue blocks claiming even after re-attestation, we should fix Phase 2 first:

1. **Create ALT deployment script** → Deploy ALT on mainnet/devnet
2. **Update `lib/cctp/solana/mint.ts`** → Use VersionedTransaction + ALT
3. **Test that mint works** → Verify transaction fits < 1232 bytes
4. **Add re-attestation** (`lib/iris.ts`, `lib/cctp/errors.ts`)
5. **Update error handler** (`lib/cctp/hooks/useMint.ts`) → Detect expiration, re-attest, retry
6. **Update UI** (`lib/hooks/useClaimHandler.ts`) → Show progress during re-attestation

## Implementation Details

### 1. `lib/iris.ts` - Add Re-Attestation

```typescript
// Add new function
export async function requestReattestation(
  nonce: string,
  isTestnet: boolean
): Promise<{ success: boolean; error?: string }> {
  const baseUrl = isTestnet ? IRIS_API_ENDPOINTS.testnet : IRIS_API_ENDPOINTS.mainnet;
  const url = `${baseUrl}/v2/reattest/${nonce}`;

  const response = await irisRateLimiter.throttle(() =>
    fetch(url, { method: "POST", headers: { Accept: "application/json" } })
  );

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    return { success: false, error: data.message || `Re-attestation failed: ${response.status}` };
  }

  return { success: true };
}
```

### 2. `lib/cctp/errors.ts` - Add MESSAGE_EXPIRED

```typescript
// Add to BridgeErrorCode type
| "MESSAGE_EXPIRED"

// Add detection function
export function isMessageExpired(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  return (
    lower.includes("messageexpired") ||
    lower.includes("message has expired") ||
    lower.includes("0x1780") ||
    /"custom":\s*6016/i.test(message)
  );
}

// Update getErrorCode
if (isMessageExpired(error)) return "MESSAGE_EXPIRED";
```

### 3. `lib/cctp/solana/mint.ts` - Versioned Transaction + ALT

```typescript
import {
  VersionedTransaction,
  TransactionMessage,
  AddressLookupTableAccount
} from "@solana/web3.js";

// ALT addresses (deployed separately)
const ALT_ADDRESSES = {
  mainnet: new PublicKey("..."),  // Deploy and fill in
  devnet: new PublicKey("..."),   // Deploy and fill in
};

// In buildReceiveMessageTransaction:
// 1. Fetch ALT account
const altAddress = isTestnet ? ALT_ADDRESSES.devnet : ALT_ADDRESSES.mainnet;
const altAccount = await connection.getAddressLookupTable(altAddress);

// 2. Build message with ALT
const messageV0 = new TransactionMessage({
  payerKey: user,
  recentBlockhash: blockhash,
  instructions: [...createAtaIxs, receiveMessageIx],
}).compileToV0Message([altAccount.value!]);

// 3. Return VersionedTransaction
return new VersionedTransaction(messageV0);
```

### 4. `lib/cctp/hooks/useMint.ts` - Re-Attestation Retry

In `handleSolanaMintError` (around line 438):

```typescript
async function handleSolanaMintError(
  error: unknown,
  params: { nonce: string; burnTxHash: string; sourceChainId: ChainId },
  retryMint: () => Promise<MintResult>
): Promise<MintResult> {
  if (isMessageExpired(error)) {
    // Show re-attestation toast
    toast({ title: "Refreshing attestation...", description: "Message expired, requesting new attestation" });

    // Request re-attestation
    const isTestnet = isTestnetChainUniversal(params.sourceChainId);
    const result = await requestReattestation(params.nonce, isTestnet);

    if (!result.success) {
      return { success: false, error: result.error || "Re-attestation failed" };
    }

    // Wait for new attestation (poll)
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Retry mint
    return retryMint();
  }

  // ... existing error handling
}
```

### 5. ALT Deployment Script (`scripts/create-cctp-alt.ts`)

```typescript
import { Connection, PublicKey, Keypair, AddressLookupTableProgram } from "@solana/web3.js";

const STATIC_ACCOUNTS = [
  MESSAGE_TRANSMITTER_PROGRAM_ID,
  TOKEN_MESSENGER_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  SystemProgram.programId,
  // PDAs derived at deploy time
];

// Create ALT, extend with accounts, deploy
```

## Verification

1. **Test transaction size fix**:
   - Deploy ALT on devnet first
   - Attempt Solana mint → should succeed < 1232 bytes
   - Check tx size in explorer

2. **Test expired message recovery**:
   - Wait for Fast transfer to expire (~30 min) OR use testnet with short expiry
   - Click Claim
   - Verify "Refreshing attestation..." toast appears
   - Verify re-attestation API is called
   - Verify mint retries and succeeds

3. **Test error cases**:
   - Disconnect wallet during re-attestation → show clear error
   - Re-attestation API returns 404 → show "Unable to refresh attestation"
   - Limit retries to 1 → don't loop forever

4. **Run lint**: `bun run lint`
