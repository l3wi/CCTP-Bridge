# CCTP Fees and Hooks

## Fee Structure

### Fast Transfer Fees

Fees are collected at mint time on destination chain, specified in basis points (bps):

| Source Chain | Fee |
|--------------|-----|
| Arbitrum | 1 bps (0.01%) |
| Base | 1 bps (0.01%) |
| Codex | 1 bps (0.01%) |
| Ethereum | 1 bps (0.01%) |
| OP Mainnet | 1 bps (0.01%) |
| Solana | 1 bps (0.01%) |
| Unichain | 1 bps (0.01%) |
| World Chain | 1 bps (0.01%) |
| Ink | 2 bps (0.02%) |
| Plume | 2 bps (0.02%) |
| Linea | 14 bps (0.14%) |
| Starknet | 14 bps (0.14%) |

### Standard Transfer Fees

Currently **0 bps (free)** for all chains.

### Chains Without Fast Transfer Fees

Some chains don't appear in Fast Transfer fee tables because their standard attestation is already fast enough. Fast Transfer provides no benefit when:
- Avalanche (standard: ~8 seconds)
- Polygon PoS (standard: ~8 seconds)
- Sonic (standard: ~8 seconds)
- Sei (standard: ~5 seconds)
- Monad (standard: ~5 seconds)
- HyperEVM (standard: ~5 seconds)

## Fee Calculation

```typescript
interface FeeInfo {
  fastFeeBps: number;
  standardFeeBps: number;
}

async function getFees(
  sourceDomain: number,
  destinationDomain: number
): Promise<FeeInfo> {
  const response = await fetch(
    `https://iris-api.circle.com/v2/burn/USDC/fees?source=${sourceDomain}&destination=${destinationDomain}`
  );
  const data = await response.json();

  return {
    fastFeeBps: data.fast?.minimumFee ?? 0,
    standardFeeBps: data.standard?.minimumFee ?? 0,
  };
}

function calculateFee(amount: bigint, feeBps: number): bigint {
  return (amount * BigInt(feeBps)) / 10000n;
}

// Example: Calculate maxFee for Fast Transfer
const amount = 1000000n; // 1 USDC (6 decimals)
const feeBps = 1; // 1 bps
const maxFee = calculateFee(amount, feeBps); // 100 (0.0001 USDC)
```

## maxFee Parameter Behavior

The `maxFee` parameter in `depositForBurn` controls transfer type eligibility:

| maxFee vs Minimum Fee | minFinalityThreshold | Result |
|----------------------|---------------------|--------|
| maxFee < Standard fee | Any | **Reverts** |
| maxFee >= Standard fee, < Fast fee | <= 1000 | Standard Transfer |
| maxFee >= Fast fee | <= 1000 | Fast Transfer |
| maxFee >= Standard fee | > 1000 | Standard Transfer |

**Best practice:** Always fetch current fees from API before burning. Set `maxFee` to at least the Fast fee if you want Fast Transfer.

## Fee Switch

Some chains have TokenMessengerV2 contracts with a fee switch for enforcing minimum Standard Transfer fees:

**With fee switch support:**
- Sei

**Without fee switch (older contracts):**
- Arbitrum, Avalanche, Base, Codex, Ethereum
- Linea, OP Mainnet, Polygon PoS, Sonic
- Unichain, World Chain

Check fee switch:
```typescript
// Only on chains with fee switch support
const minFee = await tokenMessenger.read.getMinFeeAmount([burnAmount]);
```

## CCTP Hooks

Hooks enable custom logic execution after USDC is minted on the destination chain.

### Design Principles

- Hooks are **opaque metadata** passed with burn message
- CCTP protocol does **not execute** hooks
- Integrators control hook execution entirely
- Maximum flexibility for custom workflows

### Hook Data Structure

`hookData` is a `bytes` field in the BurnMessage body:
- Arbitrary data encoded by the integrator
- Passed through from source to destination
- Decoded and executed by integrator's contracts

### Implementation Pattern

```solidity
// Source chain - encode hook data
function bridgeWithHook(
    uint256 amount,
    uint32 destinationDomain,
    bytes32 mintRecipient,
    bytes calldata hookData
) external {
    // hookData could encode: swap params, deposit instructions, etc.
    tokenMessenger.depositForBurn(
        amount,
        destinationDomain,
        mintRecipient,
        usdc,
        bytes32(0), // destinationCaller
        maxFee,
        minFinalityThreshold,
        hookData
    );
}

// Destination chain - execute hook
function handleReceive(
    bytes calldata message,
    bytes calldata attestation
) external {
    // Receive the mint
    messageTransmitter.receiveMessage(message, attestation);

    // Decode hook data from message
    bytes memory hookData = decodeHookData(message);

    // Execute custom logic based on hook data
    if (hookData.length > 0) {
        executeHook(hookData);
    }
}
```

### Hook Use Cases

1. **Automatic swaps**: Bridge USDC, swap to destination token
2. **DeFi deposits**: Bridge USDC, deposit into lending protocol
3. **NFT purchases**: Bridge USDC, purchase NFT on marketplace
4. **Multi-step workflows**: Chain multiple operations post-mint

### Security Considerations

- Validate hook data thoroughly before execution
- Consider gas limits for hook execution
- Handle failed hooks gracefully (don't block mint)
- Implement access controls on hook execution

### Benefits of External Hook Execution

1. **Flexibility**: Integrators choose execution timing (pre/post mint)
2. **Custom recovery**: Implement own error handling strategies
3. **Cross-chain compatibility**: Works on EVM and non-EVM destinations
4. **Security isolation**: Hook bugs don't affect CCTP core protocol
