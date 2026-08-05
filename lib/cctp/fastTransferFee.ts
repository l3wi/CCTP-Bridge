import { PublicKey } from "@solana/web3.js";
import { isEvmAddress, type ChainId, type EvmAddress, type TransferSpeed } from "./types";

const BPS_DENOMINATOR = 10_000n;
export const STANDARD_TRANSFER_SUPPORT_FEE_BPS = 2;
export const STANDARD_TRANSFER_SUPPORT_MINIMUM_AMOUNT = 100_000_000_000n;

export interface FastTransferFeeConfig {
  enabled: boolean;
  feeBps: number;
  evmRecipient?: EvmAddress;
  solanaRecipient?: string;
}

export interface FastTransferFeeQuote {
  feeAmount: bigint;
  feeBps: number;
  recipient?: string;
  config: FastTransferFeeConfig;
}

export interface StandardTransferSupportQuote extends FastTransferFeeQuote {
  eligible: boolean;
}

function parseFeeBps(value: string | undefined): number {
  if (!value?.trim()) return 0;
  if (!/^\d+$/.test(value.trim())) return 0;
  return Number(value);
}

function parseSolanaAddress(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;

  try {
    return new PublicKey(value.trim()).toBase58();
  } catch {
    return undefined;
  }
}

export function getFastTransferFeeConfig(): FastTransferFeeConfig {
  const feeBps = parseFeeBps(process.env.NEXT_PUBLIC_FAST_TX_FEE_BPS);
  const evmValue = process.env.NEXT_PUBLIC_FEE_ADDRESS_EVM?.trim();
  const solanaRecipient = parseSolanaAddress(process.env.NEXT_PUBLIC_FEE_ADDRESS_SOL);
  const evmRecipient = evmValue && isEvmAddress(evmValue) ? evmValue : undefined;

  return {
    enabled: feeBps > 0 && Boolean(evmRecipient) && Boolean(solanaRecipient),
    feeBps,
    evmRecipient,
    solanaRecipient,
  };
}

export function getStandardTransferSupportQuote(params: {
  amount: bigint;
  sourceChainId: ChainId;
}): StandardTransferSupportQuote {
  const config = getFastTransferFeeConfig();
  const recipient = typeof params.sourceChainId === "string"
    ? config.solanaRecipient
    : config.evmRecipient;
  const eligible =
    Boolean(recipient) &&
    params.amount >= STANDARD_TRANSFER_SUPPORT_MINIMUM_AMOUNT;

  return {
    eligible,
    feeAmount: eligible
      ? calculateFastTransferFeeAmount(params.amount, STANDARD_TRANSFER_SUPPORT_FEE_BPS)
      : 0n,
    feeBps: STANDARD_TRANSFER_SUPPORT_FEE_BPS,
    recipient: eligible ? recipient : undefined,
    config,
  };
}

export function calculateFastTransferFeeAmount(amount: bigint, feeBps: number): bigint {
  if (amount <= 0n || feeBps <= 0) return 0n;
  return (amount * BigInt(feeBps) + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR;
}

export function getFastTransferFeeQuote(params: {
  amount: bigint;
  transferSpeed: TransferSpeed;
  sourceChainId: ChainId;
}): FastTransferFeeQuote {
  const config = getFastTransferFeeConfig();
  const recipient = typeof params.sourceChainId === "string"
    ? config.solanaRecipient
    : config.evmRecipient;

  if (!config.enabled || params.transferSpeed !== "fast" || !recipient) {
    return {
      feeAmount: 0n,
      feeBps: config.feeBps,
      recipient: undefined,
      config,
    };
  }

  return {
    feeAmount: calculateFastTransferFeeAmount(params.amount, config.feeBps),
    feeBps: config.feeBps,
    recipient,
    config,
  };
}
