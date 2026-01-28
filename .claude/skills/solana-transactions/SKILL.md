# Solana Transactions and Address Lookup Tables

Use this skill when working with Solana transaction size limits, Address Lookup Tables (ALTs), and VersionedTransactions.

## Transaction Size Limit

Solana transactions have a **hard limit of 1232 bytes**. This includes:
- Signatures (64 bytes each)
- Message header (3 bytes)
- Account addresses (32 bytes each, unless using ALT)
- Instructions (variable)

## When ALT is Needed

Calculate transaction size:
- Each account = 32 bytes (without ALT) or 1 byte (with ALT)
- Large instructions (like CCTP messages ~400+ bytes) leave less room for accounts

**Example**: CCTP receiveMessage with 20 accounts:
- Without ALT: ~1474 bytes (EXCEEDS LIMIT)
- With ALT: ~916 bytes (OK)

## Address Lookup Tables (ALT)

ALTs store frequently-used addresses on-chain. Transactions reference them by 1-byte index instead of 32-byte address.

### Creating an ALT

```typescript
import { AddressLookupTableProgram, Connection, Keypair } from "@solana/web3.js";

// 1. Create the ALT
const [createIx, altAddress] = AddressLookupTableProgram.createLookupTable({
  authority: payer.publicKey,
  payer: payer.publicKey,
  recentSlot: await connection.getSlot(),
});

// 2. Extend with addresses
const extendIx = AddressLookupTableProgram.extendLookupTable({
  payer: payer.publicKey,
  authority: payer.publicKey,
  lookupTable: altAddress,
  addresses: [address1, address2, ...],  // Max ~30 per instruction
});

// 3. Wait for activation (~1 slot)
```

### Using an ALT in Transactions

```typescript
import { TransactionMessage, VersionedTransaction } from "@solana/web3.js";

// Fetch ALT from chain
const altAccountInfo = await connection.getAddressLookupTable(altAddress);
const addressLookupTable = altAccountInfo.value;

// Build VersionedTransaction
const messageV0 = new TransactionMessage({
  payerKey: user,
  recentBlockhash: blockhash,
  instructions,
}).compileToV0Message([addressLookupTable]);

const versionedTx = new VersionedTransaction(messageV0);
```

## Legacy vs Versioned Transactions

| Feature | Legacy Transaction | VersionedTransaction (v0) |
|---------|-------------------|---------------------------|
| ALT support | No | Yes |
| Max accounts | ~35 (size limited) | 256 (with ALT) |
| Wallet support | Universal | Most modern wallets |

### Type Guard

```typescript
function isVersionedTransaction(
  tx: Transaction | VersionedTransaction
): tx is VersionedTransaction {
  return "version" in tx;
}
```

## ALT Best Practices

1. **Include static addresses only** - Program IDs, PDAs that don't change
2. **Don't include dynamic addresses** - User wallets, ATAs vary per transaction
3. **Validate before use** - Check ALT exists and has expected address count
4. **Fallback to legacy** - If ALT unavailable, try legacy (may fail for large txs)

```typescript
async function fetchAlt(connection, altAddress) {
  const info = await connection.getAddressLookupTable(altAddress);
  if (!info.value || info.value.state.addresses.length < expectedCount) {
    return null; // Fallback to legacy
  }
  return info.value;
}
```

## Sending Transactions

```typescript
// Works for both legacy and versioned
const signature = await connection.sendRawTransaction(
  signedTransaction.serialize(),
  { skipPreflight: false, preflightCommitment: "confirmed" }
);
```
