/**
 * EVM CCTP v2 burn transaction builder.
 * Uses Bridge Kit for chain metadata, direct contract calls for execution.
 */

import { encodeFunctionData, type PublicClient } from "viem";
import {
  getSupportedEvmChains,
  type BridgeEnvironment,
  BRIDGEKIT_ENV,
} from "../../bridgeKit";
import type { ChainId, EvmAddress, DepositForBurnParams } from "../types";
import {
  getCctpDomain,
  formatMintRecipientHex,
  FINALITY_THRESHOLDS,
  ZERO_BYTES32,
  IRIS_API_ENDPOINTS,
} from "../shared";

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

// =============================================================================
// Fee Calculation
// =============================================================================

interface FeeResponse {
  finalityThreshold: number;
  minimumFee: string | number;
}

/**
 * Fetch the fast burn fee from Circle's IRIS API.
 * Returns fee in basis points (bps).
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

  return BigInt(fastTier.minimumFee);
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

  // Fetch base fee in bps
  const baseFeeInBps = await fetchFastBurnFee(
    sourceDomain,
    destinationDomain,
    isTestnet
  );

  // Calculate fee: (baseFeeInBps * amount + 9999) / 10000 (ceiling division)
  const baseFee = (baseFeeInBps * amount + 9999n) / 10000n;

  // Add 10% buffer for fee fluctuations
  const maxFee = baseFee + baseFee / 10n;

  // Safety check: ensure fee doesn't exceed amount
  if (maxFee >= amount) {
    throw new Error("Calculated fee exceeds transfer amount");
  }

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
  env?: BridgeEnvironment;
}

/**
 * Prepare all data needed for an EVM burn transaction.
 * Returns contract addresses, domains, formatted recipient, and calculated fee.
 */
export async function prepareEvmBurn(config: EvmBurnConfig): Promise<{
  tokenMessenger: EvmAddress;
  usdcAddress: EvmAddress;
  sourceDomain: number;
  destinationDomain: number;
  mintRecipient: `0x${string}`;
  maxFee: bigint;
  minFinalityThreshold: number;
}> {
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

  // Calculate max fee (may throw on network error)
  let maxFee = 0n;
  try {
    maxFee = await calculateMaxFee(
      sourceDomain,
      destinationDomain,
      config.amount,
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

  return {
    tokenMessenger,
    usdcAddress,
    sourceDomain,
    destinationDomain,
    mintRecipient,
    maxFee,
    minFinalityThreshold,
  };
}

