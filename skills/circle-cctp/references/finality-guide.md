# CCTP Finality Guide

## Finality Thresholds

CCTP uses finality thresholds to control when attestations are issued:

| Threshold | Value | Transfer Type | Description |
|-----------|-------|---------------|-------------|
| Confirmed | 1000 | Fast Transfer | Soft finality |
| Finalized | 2000 | Standard Transfer | Hard finality |

Set `minFinalityThreshold` in `depositForBurn`:
- 1000 or below = Fast Transfer eligible
- Above 1000 = Standard Transfer only

## Fast Transfer Attestation Times

| Source Chain | Blocks | Average Time |
|--------------|--------|--------------|
| Ethereum | 2 | ~20 seconds |
| Arbitrum | 1 | ~8 seconds |
| Base | 1 | ~8 seconds |
| Codex | 1 | ~8 seconds |
| Ink | 1 | ~8 seconds |
| Linea | 1 | ~8 seconds |
| OP Mainnet | 1 | ~8 seconds |
| Plume | 1 | ~8 seconds |
| Solana | 2-3 | ~8 seconds |
| Starknet | 1 | ~8 seconds |
| Unichain | 1 | ~8 seconds |
| World Chain | 1 | ~8 seconds |

## Standard Transfer Attestation Times

| Source Chain | Blocks | Average Time |
|--------------|--------|--------------|
| Ethereum | ~65 | 13-19 minutes |
| Arbitrum | ~65 ETH blocks | 13-19 minutes |
| Base | ~65 ETH blocks | 13-19 minutes |
| Codex | ~65 ETH blocks | 13-19 minutes |
| OP Mainnet | ~65 ETH blocks | 13-19 minutes |
| Unichain | ~65 ETH blocks | 13-19 minutes |
| World Chain | ~65 ETH blocks | 13-19 minutes |
| Plume | ~65 ETH blocks | 13-19 minutes |
| Ink | ~65 ETH blocks | ~30 minutes |
| Linea | 1 | 6-32 hours |
| Starknet | ~65 ETH blocks | 4-8 hours |
| Avalanche | 1 | ~8 seconds |
| Polygon PoS | 2-3 | ~8 seconds |
| Solana | 32 | ~25 seconds |
| Sonic | 1 | ~8 seconds |
| Sei | 1 | ~5 seconds |
| Monad | 1 | ~5 seconds |
| HyperEVM | 1 | ~5 seconds |
| XDC | 3 | ~10 seconds |
| BNB Smart Chain | 3 | ~2 seconds |
| Arc Testnet | 1 | ~0.5 seconds |

## L2 Finality Considerations

L2 chains post state to Ethereum L1 in batches. Hard finality requires:

1. L2 batch posted to Ethereum
2. Ethereum block containing batch reaches finality (~65 blocks)

**OP Stack chains (Base, OP, Codex, etc.):**
- Batches posted every ~15 minutes via EIP-4844 blobs
- Total time: batch interval + L1 finality = 13-19 minutes

**Linea:**
- ZK rollup with longer proof generation
- Typical finality: 6-32 hours

**Starknet:**
- ZK rollup proof posted to Ethereum
- Typical finality: 4-8 hours

## Finality Threshold Implementation

```typescript
import { TransferSpeed } from "@circle-fin/bridge-kit";

interface FinalityEstimate {
  blocks: number;
  averageTime: string;
}

const FINALITY_BY_CHAIN: Record<string, {
  fast?: FinalityEstimate;
  standard?: FinalityEstimate;
}> = {
  ethereum: {
    fast: { blocks: 2, averageTime: "~20 seconds" },
    standard: { blocks: 65, averageTime: "~13 to 19 minutes" },
  },
  arbitrum: {
    fast: { blocks: 1, averageTime: "~8 seconds" },
    standard: { blocks: 65, averageTime: "~13 to 19 minutes" },
  },
  // ... etc
};

function getFinalityEstimate(
  chainName: string,
  speed: TransferSpeed
): FinalityEstimate | undefined {
  const key = chainName.toLowerCase().trim();
  const entry = FINALITY_BY_CHAIN[key];
  if (!entry) return undefined;

  return speed === TransferSpeed.FAST
    ? entry.fast ?? entry.standard
    : entry.standard;
}
```

## Fast Transfer Allowance

Circle maintains a Fast Transfer Allowance that:
- Backs in-flight transfers before hard finality
- Gets debited when Fast Transfer mint occurs
- Replenishes when source chain burn finalizes

If allowance is depleted, Fast Transfers may be delayed until replenishment.

Check allowance:
```typescript
const response = await fetch(
  "https://iris-api.circle.com/v2/fastBurn/USDC/allowance"
);
const { allowance } = await response.json();
```

## Timeout Recommendations

Based on chain finality times:

| Transfer Type | Recommended Timeout |
|---------------|-------------------|
| Fast Transfer (most chains) | 2 minutes |
| Fast Transfer (Ethereum) | 3 minutes |
| Standard Transfer (L2s) | 30 minutes |
| Standard Transfer (Linea) | 36 hours |
| Standard Transfer (Starknet) | 12 hours |

## Message Expiration

CCTP messages include a 24-hour expiration block:
- Encoded in message before attestation signing
- Enforced on destination chain
- Use `/v2/reattest` to refresh expired messages
