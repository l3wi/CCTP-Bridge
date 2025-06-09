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
  targetAddress: `0x${string}`;
  sourceTokenAddress: `0x${string}`;
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
  diffWallet: boolean;
  targetAddress: string | undefined;
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
  burn: (params: BridgeParams) => Promise<`0x${string}`>;
  claim: (
    message: `0x${string}`,
    attestation: `0x${string}`
  ) => Promise<`0x${string}`>;
  isLoading: boolean;
  error: BridgeError | null;
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
