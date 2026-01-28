# Anchor Program Integration

Use this skill when building raw Solana instructions that interact with Anchor programs, especially when bypassing Anchor's method builders.

## Key Concept: What Anchor Method Builders Do

When you use Anchor's method builder pattern:
```typescript
await program.methods['myInstruction'](params)
  .accounts({ ... })
  .remainingAccounts([...])
  .instruction();
```

Anchor automatically:
1. Serializes instruction data with the correct discriminator
2. Orders accounts according to the IDL
3. **Appends macro-injected accounts** (like `#[event_cpi]`)

## #[event_cpi] Macro

The `#[event_cpi]` macro is used for emitting events via CPI (Cross-Program Invocation).

### What It Does

When an instruction has `#[event_cpi]`, Anchor:
1. Expects two additional accounts at the END of the instruction accounts (but BEFORE remaining_accounts when using method builder)
2. These accounts are: `event_authority` PDA and `program` ID

### Account Positions

**With Anchor method builder**: Accounts are auto-appended
**Without method builder (raw instruction)**: You must add them manually at positions [N] and [N+1] where N is the number of main instruction accounts

```typescript
// For an instruction with 7 main accounts:
// [0-6] = main accounts
// [7]   = event_authority (PDA with seed "__event_authority")
// [8]   = program ID
// [9+]  = remaining_accounts
```

### Deriving event_authority

```typescript
const [eventAuthorityPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("__event_authority")],
  PROGRAM_ID  // The program that has #[event_cpi]
);
```

## Instruction Data Serialization

Anchor instructions start with an 8-byte discriminator:

```typescript
// Discriminator = SHA256("global:instruction_name").slice(0, 8)
const discriminator = crypto
  .createHash("sha256")
  .update("global:receive_message")
  .digest()
  .slice(0, 8);
```

For Borsh serialization of Vec<u8> parameters:
```typescript
// Format: [4-byte length (u32 LE)][data bytes]
buffer.writeUInt32LE(data.length, offset);
data.copy(buffer, offset + 4);
```

## Common Pitfalls

1. **Wrong event_authority position**: Must be immediately after main accounts, not at end of all accounts
2. **Wrong program for PDA derivation**: Each program has its OWN event_authority PDA
3. **Missing discriminator**: Raw instructions need the 8-byte discriminator prefix
4. **Wrong Borsh encoding**: Vec<u8> needs length prefix, not raw bytes
