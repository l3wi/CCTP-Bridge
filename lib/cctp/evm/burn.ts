/**
 * EVM CCTP v2 burn transaction builder.
 * Uses Bridge Kit for chain metadata, direct contract calls for execution.
 */

import { encodeFunctionData, type PublicClient } from "viem";
import {
  getSupportedEvmChains,
  type BridgeEnvironment,
  BRIDGEKIT_ENV,
} from "../../bridgeConfig";
import type {
  ChainId,
  EvmAddress,
  DepositForBurnParams,
  BridgeWithPreapprovalParams,
} from "../types";
import {
  getCctpDomain,
  formatMintRecipientHex,
  FINALITY_THRESHOLDS,
  ZERO_BYTES32,
  IRIS_API_ENDPOINTS,
} from "../shared";
import { getFastTransferFeeQuote } from "../fastTransferFee";

// =============================================================================
// ABIs
// =============================================================================

/** ERC20 ABI - minimal for approval flow */
export const ERC20_ABI = [
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    name: "allowance",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

/** TokenMessenger ABI - depositForBurn for CCTP v2 */
export const TOKEN_MESSENGER_ABI = [
  {
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "burnToken", type: "address" },
      { name: "destinationCaller", type: "bytes32" },
      { name: "maxFee", type: "uint256" },
      { name: "minFinalityThreshold", type: "uint32" },
    ],
    name: "depositForBurn",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

/** Circle BridgeKit bridge ABI - bridgeWithPreapproval for atomic custom fees. */
export const BRIDGE_WITH_PREAPPROVAL_ABI = [
  {
    type: "function",
    name: "bridgeWithPreapproval",
    inputs: [
      {
        name: "bridgeParams",
        type: "tuple",
        components: [
          { name: "amount", type: "uint256" },
          { name: "maxFee", type: "uint256" },
          { name: "fee", type: "uint256" },
          { name: "mintRecipient", type: "bytes32" },
          { name: "destinationCaller", type: "bytes32" },
          { name: "burnToken", type: "address" },
          { name: "feeRecipient", type: "address" },
          { name: "destinationDomain", type: "uint32" },
          { name: "minFinalityThreshold", type: "uint32" },
        ],
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

// =============================================================================
// Contract Address Resolution
// =============================================================================

/**
 * Get TokenMessenger v2 address for a chain from Bridge Kit.
 */
export function getTokenMessengerAddress(
  chainId: number,
  env: BridgeEnvironment = BRIDGEKIT_ENV
): EvmAddress {
  const chains = getSupportedEvmChains(env);
  const chain = chains.find((c) => c.chainId === chainId);

  if (!chain?.cctp?.contracts) {
    throw new Error(`No CCTP contracts found for chain ${chainId}`);
  }

  const contracts = chain.cctp.contracts;
  const v2 = contracts.v2 as { tokenMessenger?: string } | undefined;

  if (v2?.tokenMessenger) {
    return v2.tokenMessenger as EvmAddress;
  }

  throw new Error(`No TokenMessenger v2 found for chain ${chainId}`);
}

/**
 * Get USDC contract address for a chain from Bridge Kit.
 */
export function getUsdcAddress(
  chainId: number,
  env: BridgeEnvironment = BRIDGEKIT_ENV
): EvmAddress {
  const chains = getSupportedEvmChains(env);
  const chain = chains.find((c) => c.chainId === chainId);

  if (!chain?.usdcAddress) {
    throw new Error(`No USDC address found for chain ${chainId}`);
  }

  return chain.usdcAddress as EvmAddress;
}

/**
 * Get Circle BridgeKit bridge contract address for a chain.
 */
export function getBridgeContractAddress(
  chainId: number,
  env: BridgeEnvironment = BRIDGEKIT_ENV
): EvmAddress | undefined {
  const chains = getSupportedEvmChains(env);
  const chain = chains.find((c) => c.chainId === chainId);
  const bridge = chain?.kitContracts?.bridge;
  return bridge as EvmAddress | undefined;
}

// =============================================================================
// Allowance Checking
// =============================================================================

/**
 * Check current USDC allowance for a spender.
 */
export async function checkAllowance(
  client: PublicClient,
  usdcAddress: EvmAddress,
  owner: EvmAddress,
  spender: EvmAddress
): Promise<bigint> {
  const allowance = await client.readContract({
    address: usdcAddress,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [owner, spender],
  });

  return allowance;
}

// =============================================================================
// Transaction Data Builders
// =============================================================================

/**
 * Build ERC20 approve transaction data.
 */
export function buildApprovalData(
  usdcAddress: EvmAddress,
  spender: EvmAddress,
  amount: bigint
): { to: EvmAddress; data: `0x${string}` } {
  const data = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: "approve",
    args: [spender, amount],
  });

  return { to: usdcAddress, data };
}

/**
 * Build TokenMessenger.depositForBurn transaction data for CCTP v2.
 */
export function buildDepositForBurnData(
  tokenMessengerAddress: EvmAddress,
  params: DepositForBurnParams
): { to: EvmAddress; data: `0x${string}` } {
  const data = encodeFunctionData({
    abi: TOKEN_MESSENGER_ABI,
    functionName: "depositForBurn",
    args: [
      params.amount,
      params.destinationDomain,
      params.mintRecipient,
      params.burnToken,
      params.destinationCaller ?? ZERO_BYTES32,
      params.maxFee ?? 0n,
      params.minFinalityThreshold ?? FINALITY_THRESHOLDS.evm.fast,
    ],
  });

  return { to: tokenMessengerAddress, data };
}

/**
 * Build Circle BridgeKit bridgeWithPreapproval transaction data for atomic EVM app fees.
 */
export function buildBridgeWithPreapprovalData(
  bridgeContractAddress: EvmAddress,
  params: BridgeWithPreapprovalParams
): { to: EvmAddress; data: `0x${string}` } {
  const data = encodeFunctionData({
    abi: BRIDGE_WITH_PREAPPROVAL_ABI,
    functionName: "bridgeWithPreapproval",
    args: [
      {
        amount: params.amount,
        maxFee: params.maxFee ?? 0n,
        fee: params.fee,
        mintRecipient: params.mintRecipient,
        destinationCaller: params.destinationCaller ?? ZERO_BYTES32,
        burnToken: params.burnToken,
        feeRecipient: params.feeRecipient,
        destinationDomain: params.destinationDomain,
        minFinalityThreshold: params.minFinalityThreshold ?? FINALITY_THRESHOLDS.evm.fast,
      },
    ],
  });

  return { to: bridgeContractAddress, data };
}

// =============================================================================
// Fee Calculation
// =============================================================================

interface FeeResponse {
  finalityThreshold: number;
  minimumFee: string | number;
}

// Precision multiplier for handling decimal bps values (supports up to 4 decimal places)
const BPS_PRECISION = 10000n;
const BPS_DIVISOR = 10000n * BPS_PRECISION; // 100_000_000n

/**
 * Fetch the fast burn fee from Circle's IRIS API.
 * Returns fee in scaled basis points (bps * 10000) to handle decimals.
 * E.g., 1.3 bps becomes 13000n
 */
export async function fetchFastBurnFee(
  sourceDomain: number,
  destinationDomain: number,
  isTestnet: boolean
): Promise<bigint> {
  const baseUrl = isTestnet
    ? IRIS_API_ENDPOINTS.testnet
    : IRIS_API_ENDPOINTS.mainnet;

  const url = `${baseUrl}/v2/burn/USDC/fees/${sourceDomain}/${destinationDomain}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch burn fee: ${response.status}`);
  }

  const data: FeeResponse[] = await response.json();

  if (!Array.isArray(data)) {
    throw new Error("Invalid fee response format");
  }

  // Find the FAST tier (finalityThreshold === 1000)
  const fastTier = data.find((tier) => tier.finalityThreshold === 1000);
  if (!fastTier) {
    throw new Error("Fast tier (finalityThreshold: 1000) not found");
  }

  // Convert to number first to handle decimals (e.g., 1.3 bps)
  // Scale by BPS_PRECISION to preserve decimal places
  const feeAsNumber =
    typeof fastTier.minimumFee === "string"
      ? parseFloat(fastTier.minimumFee)
      : fastTier.minimumFee;

  // Round to avoid floating point issues and convert to BigInt
  return BigInt(Math.round(feeAsNumber * Number(BPS_PRECISION)));
}

/**
 * Calculate maxFee for a transfer.
 * FAST: fetch from API + 10% buffer
 * STANDARD: 0n
 */
export async function calculateMaxFee(
  sourceDomain: number,
  destinationDomain: number,
  amount: bigint,
  transferSpeed: "fast" | "standard",
  isTestnet: boolean
): Promise<bigint> {
  if (transferSpeed === "standard") {
    return 0n;
  }

  // Fetch scaled fee in bps (already multiplied by BPS_PRECISION)
  const scaledFeeInBps = await fetchFastBurnFee(
    sourceDomain,
    destinationDomain,
    isTestnet
  );

  // Calculate fee with ceiling division using the scaled divisor
  // fee = (scaledBps * amount + divisor - 1) / divisor
  const baseFee = (scaledFeeInBps * amount + BPS_DIVISOR - 1n) / BPS_DIVISOR;

  // Safety check BEFORE adding buffer - prevents unexpected failures for small amounts
  // Check if fee with 10% buffer would exceed amount
  if ((baseFee * 11n) / 10n >= amount) {
    throw new Error("Transfer amount too small for fast transfer fee");
  }

  // Add 10% buffer for fee fluctuations
  const maxFee = baseFee + baseFee / 10n;

  return maxFee;
}

// =============================================================================
// High-Level Burn Helpers
// =============================================================================

export interface EvmBurnConfig {
  sourceChainId: number;
  destinationChainId: ChainId;
  amount: bigint;
  recipientAddress: string;
  transferSpeed: "fast" | "standard";
  appFeeAmount?: bigint;
  appFeeBps?: number;
  appFeeRecipient?: EvmAddress;
  env?: BridgeEnvironment;
}

/**
 * Prepare all data needed for an EVM burn transaction.
 * Returns contract addresses, domains, formatted recipient, and calculated fee.
 */
export async function prepareEvmBurn(config: EvmBurnConfig): Promise<{
  tokenMessenger: EvmAddress;
  usdcAddress: EvmAddress;
  approvalSpender: EvmAddress;
  approvalAmount: bigint;
  bridgeAmount: bigint;
  bridgeContractAddress?: EvmAddress;
  appFeeAmount: bigint;
  appFeeBps?: number;
  appFeeRecipient?: EvmAddress;
  sourceDomain: number;
  destinationDomain: number;
  mintRecipient: `0x${string}`;
  maxFee: bigint;
  minFinalityThreshold: number;
}> {
  if (config.amount <= 0n) {
    throw new Error("Burn amount must be positive");
  }

  const env = config.env ?? BRIDGEKIT_ENV;

  // Get contract addresses
  const tokenMessenger = getTokenMessengerAddress(config.sourceChainId, env);
  const usdcAddress = getUsdcAddress(config.sourceChainId, env);

  // Get CCTP domains
  const sourceDomain = getCctpDomain(config.sourceChainId, env);
  const destinationDomain = getCctpDomain(config.destinationChainId, env);

  // Format mint recipient (handles both EVM and Solana destinations)
  const mintRecipient = formatMintRecipientHex(
    config.recipientAddress,
    config.destinationChainId
  );

  // Determine if testnet
  const isTestnet = env === "testnet";

  const fastTransferFeeQuote = getFastTransferFeeQuote({
    amount: config.amount,
    transferSpeed: config.transferSpeed,
    sourceChainId: config.sourceChainId,
  });
  const appFeeAmount = config.appFeeAmount ?? fastTransferFeeQuote.feeAmount;
  const appFeeRecipient = config.appFeeRecipient ?? fastTransferFeeQuote.recipient as EvmAddress | undefined;
  const appFeeBps = config.appFeeBps ?? fastTransferFeeQuote.feeBps;
  if (appFeeAmount < 0n) {
    throw new Error("App fee amount cannot be negative");
  }
  if (!Number.isFinite(appFeeBps) || appFeeBps < 0) {
    throw new Error("App fee basis points must be a non-negative number");
  }
  if (appFeeAmount > 0n && !appFeeRecipient) {
    throw new Error("App fee recipient is required when an app fee is charged");
  }
  const bridgeAmount = config.amount - appFeeAmount;

  if (bridgeAmount <= 0n) {
    throw new Error("Transfer amount too small for app fee");
  }

  // Calculate max fee (may throw on network error)
  let maxFee = 0n;
  try {
    maxFee = await calculateMaxFee(
      sourceDomain,
      destinationDomain,
      bridgeAmount,
      config.transferSpeed,
      isTestnet
    );
  } catch (error) {
    // Log but don't fail - fall back to standard (0 fee)
    console.warn("Failed to calculate max fee, falling back to standard:", error);
  }

  // Get finality threshold
  const minFinalityThreshold =
    config.transferSpeed === "fast"
      ? FINALITY_THRESHOLDS.evm.fast
      : FINALITY_THRESHOLDS.evm.standard;

  const bridgeContractAddress =
    appFeeAmount > 0n ? getBridgeContractAddress(config.sourceChainId, env) : undefined;

  if (appFeeAmount > 0n && !bridgeContractAddress) {
    throw new Error(
      `App fee collection is enabled, but chain ${config.sourceChainId} has no Circle bridge contract for atomic fee collection.`
    );
  }

  return {
    tokenMessenger,
    usdcAddress,
    approvalSpender: bridgeContractAddress ?? tokenMessenger,
    approvalAmount: config.amount,
    bridgeAmount,
    bridgeContractAddress,
    appFeeAmount,
    appFeeBps: appFeeAmount > 0n ? appFeeBps : undefined,
    appFeeRecipient,
    sourceDomain,
    destinationDomain,
    mintRecipient,
    maxFee,
    minFinalityThreshold,
  };
}
