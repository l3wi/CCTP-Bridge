import type { BridgeResult } from "@circle-fin/bridge-kit";
import { Chain } from "viem";

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

// Transaction types
export interface LocalTransaction {
  date: Date;
  originChain: number;
  hash: `0x${string}`;
  status: "pending" | "claimed" | "failed";
  provider?: string;
  bridgeState?: BridgeResult["state"];
  steps?: BridgeResult["steps"];
  amount?: string;
  chain?: number;
  targetChain?: number;
  targetAddress?: `0x${string}`;
  claimHash?: `0x${string}`;
  version: "v2"; // CCTP version used
  transferType?: "standard" | "fast"; // V2 transfer type
  fee?: string; // V2 fast transfer fee
  estimatedTime?: string; // Estimated completion time
  completedAt?: Date; // When mint/claim completed
  bridgeResult?: BridgeResult;
  transferId?: string;
}

// Legacy transaction interface retained for migration from pre-v2 localStorage entries
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

// Bridge operation types
export interface BridgeParams {
  amount: bigint;
  sourceChainId: number;
  targetChainId: number;
  targetAddress?: `0x${string}`; // Optional: recipient address if different from sender
  sourceTokenAddress?: `0x${string}`;
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
    hash: `0x${string}`,
    updates: Partial<LocalTransaction>
  ) => void;
  clearTransactions: () => void;
}

// Transaction hash validation utilities
// Validates that a value is a properly formatted Ethereum transaction hash (0x + 64 hex chars)
export const isValidTxHash = (value: unknown): value is `0x${string}` => {
  return (
    typeof value === "string" &&
    /^0x[a-fA-F0-9]{64}$/.test(value)
  );
};

// Safely converts unknown value to tx hash, returning undefined if invalid
export const asTxHash = (value: unknown): `0x${string}` | undefined => {
  return isValidTxHash(value) ? value : undefined;
};
