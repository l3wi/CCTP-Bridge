import type { BridgeResult } from "@circle-fin/bridge-kit";
import { Chain } from "viem";

// =============================================================================
// Universal Chain & Address Types (EVM + Solana)
// =============================================================================

// Solana chain identifiers used by Bridge Kit
export type SolanaChainId = "Solana_Devnet" | "Solana";

// Universal chain identifier - number for EVM, string for Solana
export type ChainId = number | SolanaChainId;

// Chain ecosystem type
export type ChainType = "evm" | "solana";

// EVM address format (0x-prefixed hex)
export type EvmAddress = `0x${string}`;

// Solana address format (Base58 encoded, 32-44 chars)
export type SolanaAddress = string;

// Universal address type supporting both ecosystems
export type UniversalAddress = EvmAddress | SolanaAddress;

// EVM transaction hash format (0x + 64 hex chars)
export type EvmTxHash = `0x${string}`;

// Solana transaction signature format (Base58, ~88 chars)
export type SolanaTxHash = string;

// Universal transaction hash type
export type UniversalTxHash = EvmTxHash | SolanaTxHash;

// Type guard: Check if chain is Solana
export const isSolanaChain = (chainId: ChainId): chainId is SolanaChainId =>
  typeof chainId === "string" && chainId.startsWith("Solana");

// Get chain type from chain identifier
export const getChainType = (chainId: ChainId): ChainType =>
  isSolanaChain(chainId) ? "solana" : "evm";

// Type guard: Check if address looks like EVM format
export const isEvmAddress = (address: string): address is EvmAddress =>
  /^0x[a-fA-F0-9]{40}$/.test(address);

// =============================================================================
// Contract-related types (EVM only)
// =============================================================================

// Contract-related types
export interface ContractConfig {
  readonly TokenMessenger: `0x${string}`;
  readonly MessageTransmitter: `0x${string}`;
  readonly TokenMinter: `0x${string}`;
  readonly Usdc: `0x${string}`;
}

export type ContractsMap = {
  readonly [chainId: number]: ContractConfig;
};

// Transaction types - supports both EVM and Solana chains (v3 schema)
export interface LocalTransaction {
  date: Date;
  originChain: ChainId; // EVM chainId (number) or Solana chain identifier (string)
  hash: UniversalTxHash; // EVM tx hash (0x...) or Solana signature (Base58)
  status: "pending" | "claimed" | "failed";
  bridgeState?: BridgeResult["state"];
  steps?: BridgeResult["steps"];
  amount?: string;
  targetChain?: ChainId;
  targetAddress?: UniversalAddress; // EVM address or Solana pubkey
  claimHash?: UniversalTxHash;
  version: "v3"; // Schema version
  transferType?: "standard" | "fast"; // Transfer speed
  fee?: string; // Fast transfer fee
  estimatedTime?: string; // Estimated completion time
  completedAt?: Date; // When mint/claim completed
  bridgeResult?: BridgeResult;
  transferId?: string;
}

// Legacy v2 transaction interface for migration
export interface LegacyV2Transaction {
  date: Date;
  originChain: ChainId;
  originChainType?: ChainType; // Removed in v3 (derivable)
  hash: UniversalTxHash;
  status: "pending" | "claimed" | "failed";
  provider?: string; // Removed in v3 (redundant)
  bridgeState?: BridgeResult["state"];
  steps?: BridgeResult["steps"];
  amount?: string;
  chain?: ChainId; // Removed in v3 (unused)
  targetChain?: ChainId;
  targetChainType?: ChainType; // Removed in v3 (derivable)
  targetAddress?: UniversalAddress;
  claimHash?: UniversalTxHash;
  version: "v2";
  transferType?: "standard" | "fast";
  fee?: string;
  estimatedTime?: string;
  completedAt?: Date;
  bridgeResult?: BridgeResult;
  transferId?: string;
}

// Legacy v1 transaction interface for migration from pre-v2 localStorage
export interface LegacyLocalTransaction {
  date: Date;
  originChain: number;
  hash: `0x${string}`;
  status: "pending" | "claimed" | "failed";
  amount?: string;
  chain?: number;
  targetChain?: number;
  targetAddress?: `0x${string}`;
  claimHash?: `0x${string}`;
}

// Bridge operation types - supports both EVM and Solana chains
export interface BridgeParams {
  amount: bigint;
  sourceChainId: ChainId; // EVM chainId or Solana chain identifier
  sourceChainType?: ChainType; // "evm" or "solana" - inferred from sourceChainId if not provided
  targetChainId: ChainId;
  targetChainType?: ChainType; // inferred from targetChainId if not provided
  targetAddress?: UniversalAddress; // Optional: recipient address if different from sender
  sourceTokenAddress?: EvmAddress; // EVM only - USDC contract address
  version?: "v1" | "v2";
  transferType?: "standard" | "fast";
}

// V2 Fast Transfer specific params
export interface FastTransferParams extends BridgeParams {
  version: "v2";
  transferType: "fast";
  fee: bigint; // Maximum fee amount in token wei (calculated from BPS)
}

export interface DepositForBurnArgs {
  amount: bigint;
  destinationDomain: number;
  mintRecipient: `0x${string}`;
  burnToken: `0x${string}`;
}

export interface ReceiveMessageArgs {
  message: `0x${string}`;
  attestation: `0x${string}`;
}

// UI State types
export interface AmountState {
  str: string;
  bigInt: bigint;
}

export interface BridgeFormState {
  targetChain: Chain | null;
  amount: AmountState | null;
  version: "v1" | "v2";
  transferType: "standard" | "fast";
}

// Bridge summary state for confirmation screen
export interface BridgeSummaryState {
  sourceChain: Chain;
  targetChain: Chain;
  amount: AmountState;
  targetAddress: `0x${string}`;
  version: "v1" | "v2";
  transferType: "standard" | "fast";
  estimatedTime: string;
  fee: string;
  totalCost: string;
}

// API Response types
export interface CircleAttestationResponse {
  messages: Array<{
    attestation: string;
    message: string;
    event_nonce: number;
    source_domain: number;
    destination_domain: number;
    source_tx_hash: string;
    destination_tx_hash?: string;
  }>;
}

// V2 API Response types
export interface V2FastBurnAllowanceResponse {
  allowance: number;
  lastUpdated: string;
}

export interface V2FastBurnFeeTier {
  finalityThreshold: number; // The finality threshold used to determine Fast vs Standard Transfer
  minimumFee: number; // Fee in BPS (Basis Points) where 1 = 0.01%
}

export type V2FastBurnFeesResponse = V2FastBurnFeeTier[];

export interface V2PublicKeysResponse {
  publicKeys: Array<{
    version: string;
    publicKey: string;
  }>;
}

export interface V2MessageResponse {
  messages: Array<{
    attestation: string;
    message: string;
    eventNonce: number;
    sourceDomain: number;
    destinationDomain: number;
    sourceTxHash: string;
    destinationTxHash?: string;
    status: "pending" | "attested" | "complete"; // Fixed: API returns "complete" not "completed"
    cctpVersion: number; // The CCTP version of the message (1 or 2)
  }>;
}

// Domain and chain mapping types
export type DomainMap = {
  readonly [chainId: number]: number;
};

export type ChainSupportMap = {
  readonly mainnet: readonly number[];
  readonly testnet: readonly number[];
};

// Error types
export interface BridgeError {
  code: string;
  message: string;
  details?: any;
}

// Hook return types
export interface UseBridgeReturn {
  bridge: (params: BridgeParams) => Promise<BridgeResult>;
  isLoading: boolean;
  error: BridgeError | string | null;
}

export interface UseTransactionHistoryReturn {
  transactions: LocalTransaction[];
  addTransaction: (tx: Omit<LocalTransaction, "date">) => void;
  updateTransaction: (
    hash: UniversalTxHash,
    updates: Partial<LocalTransaction>
  ) => void;
  clearTransactions: () => void;
}

// =============================================================================
// Transaction Hash Validation Utilities
// =============================================================================

// Validates EVM transaction hash (0x + 64 hex chars)
export const isValidEvmTxHash = (value: unknown): value is EvmTxHash => {
  return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value);
};

// Validates Solana transaction signature (Base58, typically 87-88 chars)
export const isValidSolanaTxHash = (value: unknown): value is SolanaTxHash => {
  return (
    typeof value === "string" &&
    /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(value)
  );
};

// Validates any transaction hash (EVM or Solana)
export const isValidTxHash = (value: unknown): value is UniversalTxHash => {
  return isValidEvmTxHash(value) || isValidSolanaTxHash(value);
};

// Safely converts unknown value to EVM tx hash
export const asEvmTxHash = (value: unknown): EvmTxHash | undefined => {
  return isValidEvmTxHash(value) ? value : undefined;
};

// Safely converts unknown value to tx hash (backward compatible alias)
export const asTxHash = (value: unknown): EvmTxHash | undefined => {
  return asEvmTxHash(value);
};

// Safely converts unknown value to universal tx hash
export const asUniversalTxHash = (value: unknown): UniversalTxHash | undefined => {
  if (isValidEvmTxHash(value)) return value;
  if (isValidSolanaTxHash(value)) return value;
  return undefined;
};
