/**
 * Unified CCTP type definitions.
 * Single source of truth for all cross-chain bridging types.
 */

import type { BridgeResult } from "@circle-fin/bridge-kit";

// =============================================================================
// Chain Types
// =============================================================================

/** EVM chain identifier (numeric) */
export type EvmChainId = number;

/** Solana chain identifiers */
export type SolanaChainId = "Solana" | "Solana_Devnet";

/** Universal chain identifier - number for EVM, string for Solana */
export type ChainId = EvmChainId | SolanaChainId;

/** Chain ecosystem type */
export type ChainType = "evm" | "solana";

// =============================================================================
// Address Types
// =============================================================================

/** EVM address format (0x-prefixed, 40 hex chars) */
export type EvmAddress = `0x${string}`;

/** Solana address format (Base58 encoded, 32-44 chars) */
export type SolanaAddress = string;

/** Universal address supporting both ecosystems */
export type UniversalAddress = EvmAddress | SolanaAddress;

// =============================================================================
// Transaction Hash Types
// =============================================================================

/** EVM transaction hash (0x + 64 hex chars) */
export type EvmTxHash = `0x${string}`;

/** Solana transaction signature (Base58, ~88 chars) */
export type SolanaTxHash = string;

/** Universal transaction hash */
export type UniversalTxHash = EvmTxHash | SolanaTxHash;

// =============================================================================
// Type Guards
// =============================================================================

/** Check if chain is Solana */
export const isSolanaChain = (chainId: ChainId): chainId is SolanaChainId =>
  typeof chainId === "string" && chainId.startsWith("Solana");

/** Get chain type from chain identifier */
export const getChainType = (chainId: ChainId): ChainType =>
  isSolanaChain(chainId) ? "solana" : "evm";

/** Check if address is EVM format */
export const isEvmAddress = (address: string): address is EvmAddress =>
  /^0x[a-fA-F0-9]{40}$/.test(address);

/** Check if address is valid Solana format (Base58) */
export const isSolanaAddress = (address: string): boolean =>
  /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);

// =============================================================================
// Transaction Hash Validation
// =============================================================================

/** Validate EVM transaction hash (0x + 64 hex chars) */
export const isValidEvmTxHash = (value: unknown): value is EvmTxHash =>
  typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value);

/** Validate Solana transaction signature (Base58, 80-90 chars) */
export const isValidSolanaTxHash = (value: unknown): value is SolanaTxHash =>
  typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(value);

/** Validate any transaction hash (EVM or Solana) */
export const isValidTxHash = (value: unknown): value is UniversalTxHash =>
  isValidEvmTxHash(value) || isValidSolanaTxHash(value);

// =============================================================================
// Transfer Speed
// =============================================================================

/** Transfer speed for CCTP v2 */
export type TransferSpeed = "fast" | "standard";

// =============================================================================
// Burn Interface
// =============================================================================

/** Parameters for initiating a burn (source chain operation) */
export interface BurnParams {
  sourceChainId: ChainId;
  destinationChainId: ChainId;
  amount: bigint;
  recipientAddress: string;
  transferSpeed: TransferSpeed;
}

/** Result from burn operation */
export interface BurnResult {
  success: boolean;
  burnTxHash?: UniversalTxHash;
  /** EVM only - approval transaction hash */
  approvalTxHash?: EvmTxHash;
  error?: string;
}

// =============================================================================
// Mint Interface
// =============================================================================

/** Parameters for executing a mint (destination chain operation) */
export interface MintParams {
  burnTxHash: UniversalTxHash;
  sourceChainId: ChainId;
  destinationChainId: ChainId;
  /** Optional - existing steps from transaction store */
  existingSteps?: BridgeResult["steps"];
}

/** Result from mint operation */
export interface MintResult {
  success: boolean;
  mintTxHash?: UniversalTxHash;
  error?: string;
  /** True if mint was already executed (nonce used) */
  alreadyMinted?: boolean;
}

// =============================================================================
// Attestation Types
// =============================================================================

/** Attestation data from Circle's Iris API */
export interface AttestationData {
  /** Raw CCTP message bytes */
  message: `0x${string}`;
  /** Attestation signature bytes */
  attestation: `0x${string}`;
  /** Attestation status */
  status: "pending" | "complete";
  /** CCTP source domain */
  sourceDomain: number;
  /** CCTP destination domain */
  destinationDomain: number;
  /** Event nonce (unique identifier) */
  nonce: string;
  /** Transfer amount (from decoded message) */
  amount?: string;
  /** Mint recipient address (from decoded message) */
  mintRecipient?: string;
}

/** Raw Iris API response shape */
export interface IrisAttestationResponse {
  messages: Array<{
    attestation: string;
    message: string;
    eventNonce: string;
    status: "pending" | "complete";
    cctpVersion: number;
    decodedMessage?: {
      sourceDomain: string;
      destinationDomain: string;
      nonce: string;
      sender: string;
      recipient: string;
      messageBody: string;
      decodedMessageBody?: {
        burnToken: string;
        mintRecipient: string;
        amount: string;
        messageSender: string;
      };
    };
  }>;
}

// =============================================================================
// Nonce Checking
// =============================================================================

/** Result from nonce check operation */
export interface NonceCheckResult {
  /** True if nonce has been used (mint already executed) */
  isUsed: boolean;
  /** Error message if check failed */
  error?: string;
}

// =============================================================================
// Transaction Store Types
// =============================================================================

/** Persisted transaction record */
export interface LocalTransaction {
  date: Date;
  /** Source chain (EVM chainId or Solana identifier) */
  originChain: ChainId;
  /** Burn transaction hash */
  hash: UniversalTxHash;
  status: "pending" | "claimed" | "failed";
  bridgeState?: BridgeResult["state"];
  steps?: BridgeResult["steps"];
  amount?: string;
  /** Destination chain */
  targetChain?: ChainId;
  /** Recipient address on destination */
  targetAddress?: UniversalAddress;
  /** Mint transaction hash (when claimed) */
  claimHash?: UniversalTxHash;
  /** Schema version for migrations */
  version: "v3";
  transferType?: TransferSpeed;
  /** Fast transfer fee (USDC) */
  fee?: string;
  /** Estimated completion time */
  estimatedTime?: string;
  /** Actual completion timestamp */
  completedAt?: Date;
  /** Full bridge result from SDK */
  bridgeResult?: BridgeResult;
  /** Transfer ID from Bridge Kit */
  transferId?: string;
}

/** Legacy v2 transaction for migration */
export interface LegacyV2Transaction {
  date: Date;
  originChain: ChainId;
  originChainType?: ChainType;
  hash: UniversalTxHash;
  status: "pending" | "claimed" | "failed";
  provider?: string;
  bridgeState?: BridgeResult["state"];
  steps?: BridgeResult["steps"];
  amount?: string;
  chain?: ChainId;
  targetChain?: ChainId;
  targetChainType?: ChainType;
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

// =============================================================================
// Contract Types (EVM)
// =============================================================================

/** EVM contract configuration for a chain */
export interface EvmContractConfig {
  readonly tokenMessenger: EvmAddress;
  readonly messageTransmitter: EvmAddress;
  readonly tokenMinter?: EvmAddress;
  readonly usdc: EvmAddress;
}

/** depositForBurn parameters for CCTP v2 */
export interface DepositForBurnParams {
  amount: bigint;
  destinationDomain: number;
  /** 32-byte padded recipient */
  mintRecipient: `0x${string}`;
  burnToken: EvmAddress;
  /** 32-byte caller restriction (ZERO_BYTES32 for any caller) */
  destinationCaller?: `0x${string}`;
  /** Fee for fast liquidity (0 for standard) */
  maxFee?: bigint;
  /** 1000 for FAST, 2000 for STANDARD */
  minFinalityThreshold?: number;
}

/** receiveMessage parameters */
export interface ReceiveMessageParams {
  message: `0x${string}`;
  attestation: `0x${string}`;
}

// =============================================================================
// Re-exports for convenience
// =============================================================================

export type { BridgeResult } from "@circle-fin/bridge-kit";
