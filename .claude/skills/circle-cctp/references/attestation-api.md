# CCTP Attestation API (Iris)

Circle's Attestation Service (Iris) provides the cryptographic signatures needed to mint USDC on destination chains.

## API Hosts

| Environment | URL |
|-------------|-----|
| Mainnet | `https://iris-api.circle.com` |
| Testnet | `https://iris-api-sandbox.circle.com` |

**Rate limit:** 35 requests/second. Exceeding triggers 5-minute block with HTTP 429.

## Endpoints

### GET /v2/messages

Fetch attestation for a burn transaction.

**Query parameters:**
- `transactionHash` - Burn transaction hash (required)

**Request:**
```
GET /v2/messages/{sourceDomain}?transactionHash={txHash}
```

**Response:**
```json
{
  "messages": [{
    "attestation": "0x...",
    "message": "0x...",
    "eventNonce": "12345",
    "status": "complete",
    "cctpVersion": 2,
    "decodedMessage": {
      "sourceDomain": "0",
      "destinationDomain": "3",
      "nonce": "12345",
      "sender": "0x...",
      "recipient": "0x...",
      "messageBody": "0x...",
      "decodedMessageBody": {
        "burnToken": "0x...",
        "mintRecipient": "0x...",
        "amount": "1000000",
        "messageSender": "0x..."
      }
    }
  }]
}
```

**Status values:**
- `pending` - Waiting for finality/attestation
- `complete` - Ready for mint

### GET /v2/burn/USDC/fees

Get current fee rates for transfers.

**Query parameters:**
- `source` - Source domain ID
- `destination` - Destination domain ID

**Response:**
```json
{
  "fast": {
    "minimumFee": 1,
    "feeUnit": "bps"
  },
  "standard": {
    "minimumFee": 0,
    "feeUnit": "bps"
  }
}
```

### GET /v2/fastBurn/USDC/allowance

Check remaining Fast Transfer allowance.

**Response:**
```json
{
  "allowance": "50000000000000",
  "unit": "USDC"
}
```

### POST /v2/reattest

Re-attest a message (for expired or upgrading soft to hard finality).

**Request body:**
```json
{
  "sourceDomain": 0,
  "nonce": "12345",
  "minFinalityThreshold": 2000
}
```

## Message Format

### Header (148 bytes fixed)

| Field | Offset | Type | Length | Description |
|-------|--------|------|--------|-------------|
| version | 0 | uint32 | 4 | Always 1 for CCTP |
| sourceDomain | 4 | uint32 | 4 | Source chain domain |
| destinationDomain | 8 | uint32 | 4 | Destination chain domain |
| nonce | 12 | bytes32 | 32 | Unique message ID |
| sender | 44 | bytes32 | 32 | MessageTransmitter caller |
| recipient | 76 | bytes32 | 32 | Message handler on dest |
| destinationCaller | 108 | bytes32 | 32 | Allowed receiver (0x0 = any) |
| minFinalityThreshold | 140 | uint32 | 4 | Min finality for attestation |
| finalityThresholdExecuted | 144 | uint32 | 4 | Actual finality achieved |
| messageBody | 148 | bytes | dynamic | Application-specific data |

### BurnMessage Body

| Field | Offset | Type | Length | Description |
|-------|--------|------|--------|-------------|
| version | 0 | uint32 | 4 | Always 1 |
| burnToken | 4 | bytes32 | 32 | Burned token address |
| mintRecipient | 36 | bytes32 | 32 | Recipient on destination |
| amount | 68 | uint256 | 32 | Burned amount |
| messageSender | 100 | bytes32 | 32 | Original caller |
| maxFee | 132 | uint256 | 32 | Max fee willing to pay |
| feeExecuted | 164 | uint256 | 32 | Actual fee charged |
| expirationBlock | 196 | uint256 | 32 | Expiry (24h from burn) |
| hookData | 228 | bytes | dynamic | Custom hook payload |

## Attestation Polling Pattern

```typescript
interface AttestationData {
  message: `0x${string}`;
  attestation: `0x${string}`;
  status: "pending" | "complete";
  sourceDomain: number;
  destinationDomain: number;
  nonce: string;
  amount?: string;
  mintRecipient?: string;
}

async function fetchAttestation(
  sourceChainId: number,
  burnTxHash: string
): Promise<AttestationData | null> {
  const sourceDomain = chainIdToDomain(sourceChainId);
  if (sourceDomain === null) return null;

  const isTestnet = isTestnetChain(sourceChainId);
  const baseUrl = isTestnet
    ? "https://iris-api-sandbox.circle.com"
    : "https://iris-api.circle.com";

  const normalizedHash = burnTxHash.toLowerCase().startsWith("0x")
    ? burnTxHash.toLowerCase()
    : `0x${burnTxHash.toLowerCase()}`;

  const url = `${baseUrl}/v2/messages/${sourceDomain}?transactionHash=${normalizedHash}`;

  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();
    if (!data.messages?.length) return null;

    const msg = data.messages[0];
    if (!msg.decodedMessage) return null;

    return {
      message: ensureHexPrefix(msg.message),
      attestation: ensureHexPrefix(msg.attestation),
      status: msg.status,
      sourceDomain: parseInt(msg.decodedMessage.sourceDomain, 10),
      destinationDomain: parseInt(msg.decodedMessage.destinationDomain, 10),
      nonce: msg.eventNonce,
      amount: msg.decodedMessage.decodedMessageBody?.amount,
      mintRecipient: msg.decodedMessage.decodedMessageBody?.mintRecipient,
    };
  } catch {
    return null;
  }
}
```

## Polling Best Practices

1. **Initial delay**: Wait 5-10 seconds after burn before first poll
2. **Poll interval**: 5-10 seconds for most chains
3. **Timeout handling**: Set maximum poll duration based on expected finality
4. **Error handling**: Retry on network errors, stop on 404 (invalid tx)

```typescript
async function waitForAttestation(
  sourceChainId: number,
  burnTxHash: string,
  maxWaitMs = 30 * 60 * 1000 // 30 minutes default
): Promise<AttestationData> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const attestation = await fetchAttestation(sourceChainId, burnTxHash);

    if (attestation?.status === "complete") {
      return attestation;
    }

    await new Promise(r => setTimeout(r, 5000));
  }

  throw new Error("Attestation timeout");
}
```

## Solana Transaction Hash Format

Solana uses Base58-encoded signatures instead of hex hashes:

```typescript
function isValidSolanaTxHash(hash: string): boolean {
  // Base58 characters only, 87-88 chars typical
  return /^[1-9A-HJ-NP-Za-km-z]{43,88}$/.test(hash);
}

function isValidEvmTxHash(hash: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(hash);
}
```

For Solana burns, pass the signature directly without 0x prefix.

## Error Handling

| Status | Meaning | Action |
|--------|---------|--------|
| 200 + empty messages | Not yet indexed | Retry after delay |
| 200 + pending status | Awaiting finality | Continue polling |
| 404 | Invalid tx or domain | Check parameters |
| 429 | Rate limited | Wait 5 minutes |
| 5xx | Server error | Retry with backoff |
