# Solana CCTP v2 Integration

Use this skill when working with Circle's Cross-Chain Transfer Protocol v2 on Solana, including `receiveMessage` (mint) and `depositForBurn` operations.

## Program IDs

```typescript
// Same for mainnet and devnet
const MESSAGE_TRANSMITTER_PROGRAM_ID = "CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC";
const TOKEN_MESSENGER_PROGRAM_ID = "CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe";
```

## PDA Derivation Rules

**Critical**: Each PDA must be derived from the CORRECT program ID.

| PDA | Seed | Program ID |
|-----|------|------------|
| `tokenMessengerPda` | `"token_messenger"` | TOKEN_MESSENGER |
| `messageTransmitterPda` | `"message_transmitter"` | MESSAGE_TRANSMITTER |
| `tokenMinterPda` | `"token_minter"` | TOKEN_MESSENGER |
| `localTokenPda` | `["local_token", mint]` | TOKEN_MESSENGER |
| `remoteTokenMessengerPda` | `["remote_token_messenger", domain]` | TOKEN_MESSENGER |
| `tokenPairPda` | `["token_pair", domain, sourceUsdc]` | TOKEN_MESSENGER |
| `custodyPda` | `["custody", mint]` | TOKEN_MESSENGER |
| `messageTransmitterAuthorityPda` | `["message_transmitter_authority", TOKEN_MESSENGER_ID]` | MESSAGE_TRANSMITTER |
| `usedNoncePda` | `["used_nonce", nonce]` | MESSAGE_TRANSMITTER |
| `messageTransmitterEventAuthorityPda` | `"__event_authority"` | MESSAGE_TRANSMITTER |
| `tokenMessengerEventAuthorityPda` | `"__event_authority"` | TOKEN_MESSENGER |

## receiveMessage Account Order (20 accounts)

When building `receiveMessage` instruction manually (bypassing Anchor method builder):

```typescript
const keys = [
  // === Core MessageTransmitter accounts [0-6] ===
  { pubkey: user, isSigner: true, isWritable: true },                    // [0] payer
  { pubkey: user, isSigner: true, isWritable: false },                   // [1] caller
  { pubkey: messageTransmitterAuthorityPda, ... },                       // [2] authority_pda
  { pubkey: messageTransmitterPda, ... },                                // [3] message_transmitter
  { pubkey: usedNoncePda, isWritable: true },                            // [4] used_nonces
  { pubkey: TOKEN_MESSENGER_PROGRAM_ID, ... },                           // [5] receiver
  { pubkey: SystemProgram.programId, ... },                              // [6] system_program

  // === MessageTransmitter event_cpi accounts [7-8] ===
  // CRITICAL: Must be immediately after main accounts!
  { pubkey: messageTransmitterEventAuthorityPda, ... },                  // [7] MT event_authority
  { pubkey: MESSAGE_TRANSMITTER_PROGRAM_ID, ... },                       // [8] MT program

  // === Remaining accounts for CPI to TokenMessenger [9-19] ===
  { pubkey: tokenMessengerPda, ... },                                    // [9]
  { pubkey: remoteTokenMessengerPda, ... },                              // [10]
  { pubkey: tokenMinterPda, isWritable: true },                          // [11]
  { pubkey: localTokenPda, isWritable: true },                           // [12]
  { pubkey: tokenPairPda, ... },                                         // [13]
  { pubkey: feeRecipientAta, isWritable: true },                         // [14]
  { pubkey: userUsdcAta, isWritable: true },                             // [15]
  { pubkey: custodyPda, isWritable: true },                              // [16]
  { pubkey: TOKEN_PROGRAM_ID, ... },                                     // [17]
  // TokenMessenger event_cpi accounts
  { pubkey: tokenMessengerEventAuthorityPda, ... },                      // [18] TM event_authority
  { pubkey: TOKEN_MESSENGER_PROGRAM_ID, ... },                           // [19] TM program
];
```

## Common Errors

### ConstraintSeeds Error 2006

**Symptom**: `AnchorError caused by account: event_authority. Error Code: ConstraintSeeds`

**Causes**:
1. `event_authority` derived from wrong program ID
2. `event_cpi` accounts at wrong positions (must be [7-8], not at end)

**Fix**: Verify PDA derivation matches table above and accounts are in exact order shown.

## Reference Implementation

See `@circle-fin/adapter-solana` npm package for official implementation. Key file: `buildInstructions` function in the adapter.
