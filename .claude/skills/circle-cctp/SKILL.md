---
name: circle-cctp
description: This skill should be used when implementing CCTP (Cross-Chain Transfer Protocol) for USDC bridging, working with Circle's attestation API, understanding CCTP domains and finality, or building crosschain transfer features. Use for "burn and mint", "CCTP transfer", "attestation", "crosschain USDC", "Bridge Kit", "fast transfer", "TokenMessenger", "MessageTransmitter", or "Iris API" tasks.
license: MIT
metadata:
  author: cctp-bridge
  version: "1.0"
  category: blockchain
allowed-tools: Read Write Edit Glob Grep Bash WebFetch
---

# Circle Cross-Chain Transfer Protocol (CCTP)

CCTP is a permissionless onchain utility that securely transfers USDC between supported blockchains by burning tokens on the source chain and minting them on the destination chain. Circle created CCTP to improve capital efficiency and reduce trust assumptions compared to traditional lock-and-mint bridges.

## When to Use This Skill

Use this skill when:
- Implementing USDC crosschain transfers with burn-and-mint
- Working with Circle's Attestation Service (Iris API)
- Understanding CCTP domains and chain mappings
- Choosing between Fast Transfer and Standard Transfer
- Calculating fees for crosschain transfers
- Implementing hooks for post-transfer automation
- Debugging attestation or finality issues
- Integrating with Bridge Kit SDK

## Transfer Methods

### Fast Transfer

Fast Transfer enables faster-than-finality transfers using Circle's Fast Transfer Allowance:

1. User burns USDC on source chain
2. Attestation Service attests after soft finality (~8-20 seconds)
3. Fast Transfer Allowance backs the transfer until hard finality
4. USDC mints on destination chain with fee deduction
5. Allowance replenishes after source chain finalizes

**Best for:** Speed-sensitive use cases, typical transfers under 30 seconds.

### Standard Transfer

Standard Transfer waits for hard finality before attestation:

1. User burns USDC on source chain
2. Attestation Service waits for hard finality (13 minutes to 32 hours)
3. Attestation issued after full confirmation
4. USDC mints on destination chain

**Best for:** Large transfers, when finality guarantees are critical.

## Critical Concepts

### CCTP Domains

Domains are Circle-issued identifiers for blockchains. They do not map to public chain IDs.

| Domain | Chain |
|--------|-------|
| 0 | Ethereum |
| 1 | Avalanche |
| 2 | OP Mainnet |
| 3 | Arbitrum |
| 5 | Solana |
| 6 | Base |
| 7 | Polygon PoS |

See [references/domains-and-chains.md](references/domains-and-chains.md) for complete list.

### Finality Thresholds

CCTP uses finality thresholds to control attestation timing:

| Threshold | Value | Description |
|-----------|-------|-------------|
| Confirmed | 1000 | Fast Transfer eligible (soft finality) |
| Finalized | 2000 | Standard Transfer (hard finality) |

Set `minFinalityThreshold` to 1000 or below for Fast Transfer eligibility.

### Message Format

CCTP messages contain a header and body:

**Header fields:**
- `sourceDomain` / `destinationDomain` - Chain identifiers
- `nonce` - Unique message identifier (assigned by Circle)
- `sender` / `recipient` - Contract addresses
- `minFinalityThreshold` - Minimum finality for attestation
- `finalityThresholdExecuted` - Actual finality achieved

**Body (BurnMessage) fields:**
- `burnToken` - Token address burned
- `mintRecipient` - Destination wallet
- `amount` - Transfer amount
- `maxFee` - Maximum fee willing to pay
- `hookData` - Optional automation data

## Quick Reference

### Iris API Endpoints

| Environment | Base URL |
|-------------|----------|
| Mainnet | `https://iris-api.circle.com` |
| Testnet | `https://iris-api-sandbox.circle.com` |

**Key endpoints:**
- `GET /v2/messages/{sourceDomain}?transactionHash={hash}` - Fetch attestation
- `GET /v2/burn/USDC/fees?source={domain}&destination={domain}` - Get fee rates
- `GET /v2/fastBurn/USDC/allowance` - Check Fast Transfer allowance
- `POST /v2/reattest` - Re-attest expired or soft-finality messages

**Rate limit:** 35 requests/second (HTTP 429 blocks for 5 minutes if exceeded)

### Contract Pattern (EVM)

```typescript
// TokenMessengerV2 - Entry point for burns
depositForBurn(
  amount: uint256,
  destinationDomain: uint32,
  mintRecipient: bytes32,
  burnToken: address,
  destinationCaller: bytes32,
  maxFee: uint256,
  minFinalityThreshold: uint32
)

// MessageTransmitterV2 - Receives attestations
receiveMessage(
  message: bytes,
  attestation: bytes
)
```

### Fee Structure

Fast Transfer fees (source chain dependent):
- Most chains: 1 bps (0.01%)
- Ink, Plume: 2 bps (0.02%)
- Linea, Starknet: 14 bps (0.14%)

Standard Transfer: 0 bps (free)

**Fee calculation:**
```typescript
const feeAmount = (amount * feeBps) / 10000;
// Set maxFee >= calculated fee for Fast Transfer eligibility
```

## Integration Patterns

### Direct Contract Interaction

For custom implementations bypassing Bridge Kit:

1. **Approve USDC** to TokenMessenger contract
2. **Call depositForBurn** with parameters
3. **Poll Iris API** for attestation status
4. **Call receiveMessage** on destination MessageTransmitter

### Using Bridge Kit SDK

Bridge Kit abstracts the complexity:

```typescript
import { createBridgeKit } from "@circle-fin/bridge-kit";

const kit = createBridgeKit({ environment: "mainnet" });

// Estimate transfer
const estimate = await kit.estimate({
  amount: "100",
  sourceChain: "ethereum",
  destinationChain: "arbitrum",
});

// Execute bridge
const result = await kit.bridge({
  amount: "100",
  sourceChain: "ethereum",
  destinationChain: "arbitrum",
  recipient: "0x...",
  speed: "FAST",
});
```

### Attestation Polling

```typescript
async function waitForAttestation(
  sourceDomain: number,
  txHash: string,
  isTestnet: boolean
): Promise<{ message: string; attestation: string }> {
  const baseUrl = isTestnet
    ? "https://iris-api-sandbox.circle.com"
    : "https://iris-api.circle.com";

  const url = `${baseUrl}/v2/messages/${sourceDomain}?transactionHash=${txHash}`;

  while (true) {
    const response = await fetch(url);
    const data = await response.json();

    if (data.messages?.[0]?.status === "complete") {
      return {
        message: data.messages[0].message,
        attestation: data.messages[0].attestation,
      };
    }

    await new Promise(r => setTimeout(r, 5000)); // Poll every 5s
  }
}
```

### Nonce Verification

Check if a transfer has already been claimed:

```typescript
const sourceAndNonce = keccak256(
  encodePacked(["uint32", "uint64"], [sourceDomain, BigInt(nonce)])
);

const isUsed = await messageTransmitter.read.usedNonces([sourceAndNonce]);
// isUsed === 1n means already claimed
```

## Common Issues

### Attestation Not Found

- Wait for block confirmations (varies by chain)
- Verify correct source domain for chain
- Check transaction actually emitted burn event

### Transfer Stuck in Pending

- Fast Transfer: Check if Fast Transfer Allowance depleted
- Standard Transfer: L2 chains may take hours for finality
- Use `/v2/reattest` for expired attestations

### Fee Errors

- Ensure `maxFee` >= minimum fee for transfer type
- If `maxFee` < Fast fee but >= Standard fee, falls back to Standard
- Always fetch current fees from API before burning

## Reference Files

- [Domains and Chains](references/domains-and-chains.md) - Complete domain mappings, chain support
- [Attestation API](references/attestation-api.md) - Iris API details, message format
- [Finality Guide](references/finality-guide.md) - Block confirmations by chain
- [Fees and Hooks](references/fees-and-hooks.md) - Fee rates, hooks implementation
