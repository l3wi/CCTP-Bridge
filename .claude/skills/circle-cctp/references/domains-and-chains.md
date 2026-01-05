# CCTP Domains and Supported Chains

## Domain ID Reference

CCTP domains are Circle-assigned identifiers that do not correspond to public chain IDs. Always use domain IDs when interacting with CCTP contracts and APIs.

| Domain | Chain | Fast Transfer Source | Notes |
|--------|-------|---------------------|-------|
| 0 | Ethereum | Yes | Primary L1 |
| 1 | Avalanche | No | Standard only |
| 2 | OP Mainnet | Yes | Optimism L2 |
| 3 | Arbitrum | Yes | Arbitrum L2 |
| 5 | Solana | Yes | Non-EVM |
| 6 | Base | Yes | Base L2 |
| 7 | Polygon PoS | No | Standard only |
| 10 | Unichain | Yes | |
| 11 | Linea | Yes | Higher fees |
| 12 | Codex | Yes | |
| 13 | Sonic | No | Standard only |
| 14 | World Chain | Yes | |
| 15 | Monad | No | Standard only |
| 16 | Sei | No | Standard only |
| 17 | BNB Smart Chain | Yes | USYC only |
| 18 | XDC | No | Standard only |
| 19 | HyperEVM | No | Standard only |
| 21 | Ink | Yes | |
| 22 | Plume | Yes | |
| 25 | Starknet | Yes | Non-EVM, higher fees |
| 26 | Arc Testnet | No | Testnet only |

## Chain Support Matrix

### Fast Transfer Support

Chains where Fast Transfer is available as **source**:
- Ethereum, Arbitrum, Base, Codex, Ink, Linea
- OP Mainnet, Plume, Solana, Starknet, Unichain, World Chain

Chains without Fast Transfer source support (standard attestation already fast):
- Avalanche, Polygon PoS, Sonic, Sei, Monad, HyperEVM, XDC

**All chains support Fast Transfer as destination.**

### Environment Handling

```typescript
// Determine if chain is testnet
function isTestnet(chainId: number): boolean {
  const testnetChainIds = [
    11155111, // Sepolia
    421614,   // Arbitrum Sepolia
    84532,    // Base Sepolia
    11155420, // OP Sepolia
    // ... other testnets
  ];
  return testnetChainIds.includes(chainId);
}

// Select API endpoint based on environment
const IRIS_ENDPOINTS = {
  mainnet: "https://iris-api.circle.com",
  testnet: "https://iris-api-sandbox.circle.com",
};
```

## Contract Address Discovery

### Using Bridge Kit SDK

Bridge Kit SDK is the single source of truth for contract addresses:

```typescript
import { createBridgeKit } from "@circle-fin/bridge-kit";

const kit = createBridgeKit({ environment: "mainnet" });
const chains = kit.getSupportedChains();

// Find MessageTransmitter for a chain
function getMessageTransmitter(chainId: number): string | null {
  const chain = chains.find(c => c.type === "evm" && c.chainId === chainId);
  if (!chain?.cctp?.contracts) return null;

  // Prefer v2, fall back to v1
  const contracts = chain.cctp.contracts;
  return contracts.v2?.messageTransmitter ?? contracts.v1?.messageTransmitter ?? null;
}

// Get CCTP domain for a chain
function getDomain(chainId: number): number | null {
  const chain = chains.find(c => c.type === "evm" && c.chainId === chainId);
  return chain?.cctp?.domain ?? null;
}
```

### Key Contract Types

| Contract | Purpose |
|----------|---------|
| TokenMessengerV2 | Entry point for depositForBurn |
| TokenMinterV2 | Burns/mints USDC |
| MessageTransmitterV2 | Sends/receives CCTP messages |

### EVM vs Non-EVM

- **EVM chains**: Use `chainId` (numeric) for identification
- **Solana**: Use chain identifier string (`"solana"` or `"solana_devnet"`)
- **Starknet**: Uses different contract architecture

```typescript
type ChainId = number | "solana" | "solana_devnet";

function isSolanaChain(chainId: ChainId): boolean {
  return chainId === "solana" || chainId === "solana_devnet";
}
```

## Domain Lookup Utilities

```typescript
// Map chain ID to domain
export function chainIdToDomain(chainId: number): number | null {
  const mapping: Record<number, number> = {
    1: 0,      // Ethereum mainnet
    42161: 3,  // Arbitrum One
    8453: 6,   // Base
    10: 2,     // Optimism
    137: 7,    // Polygon
    43114: 1,  // Avalanche
    // Add more as needed
  };
  return mapping[chainId] ?? null;
}

// Map domain to chain ID
export function domainToChainId(domain: number): number | null {
  const mapping: Record<number, number> = {
    0: 1,      // Ethereum
    1: 43114,  // Avalanche
    2: 10,     // Optimism
    3: 42161,  // Arbitrum
    6: 8453,   // Base
    7: 137,    // Polygon
    // Add more as needed
  };
  return mapping[domain] ?? null;
}
```

## Testnet Domains

Testnet domains mirror mainnet but connect to test networks:

| Domain | Testnet Chain |
|--------|---------------|
| 0 | Ethereum Sepolia |
| 2 | OP Sepolia |
| 3 | Arbitrum Sepolia |
| 5 | Solana Devnet |
| 6 | Base Sepolia |

Use the testnet Iris API (`iris-api-sandbox.circle.com`) for all testnet operations.
