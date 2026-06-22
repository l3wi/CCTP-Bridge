import {
  getChainType,
  isValidEvmTxHash,
  isValidSolanaTxHash,
  type ChainId,
  type UniversalTxHash,
} from "@/lib/types";

export const BRIDGE_BURN_EVENT_NAME = "bridge_burn_submitted";
export const BRIDGE_BURN_EVENT_VERSION = "v1";
export const VERCEL_CUSTOM_PROPERTY_LIMIT = 255;

export type BridgeBurnTransferType = "fast" | "standard";
export type BridgeBurnEventSpeed = "f" | "s";

export interface BridgeBurnEventInput {
  burnHash: UniversalTxHash;
  sourceChainId: ChainId;
  targetChainId: ChainId;
  amount: string;
  transferType: BridgeBurnTransferType;
  appFastFee?: string;
  circleFastFee?: string;
}

export interface BridgeBurnEventPayload {
  id: string;
  m: string;
}

export interface ParsedBridgeBurnEventMetadata {
  version: typeof BRIDGE_BURN_EVENT_VERSION;
  amount: string;
  sourceChainId: string;
  targetChainId: string;
  speed: BridgeBurnEventSpeed;
  appFastFee: string;
  circleFastFee: string;
}

const DECIMAL_USDC_PATTERN = /^\d+(?:\.\d{1,6})?$/;
const SOLANA_CHAIN_IDS = new Set(["Solana", "Solana_Devnet"]);

export class BridgeBurnEventValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BridgeBurnEventValidationError";
  }
}

const isValidDecimalUsdc = (value: unknown): value is string =>
  typeof value === "string" && DECIMAL_USDC_PATTERN.test(value.trim());

const normalizeDecimal = (value: unknown, fallback = "0"): string => {
  if (value === undefined || value === null || value === "") return fallback;
  if (!isValidDecimalUsdc(value)) {
    throw new BridgeBurnEventValidationError("Invalid decimal USDC value");
  }
  return value.trim();
};

const normalizeChainId = (value: unknown): ChainId => {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (SOLANA_CHAIN_IDS.has(trimmed)) return trimmed as ChainId;
    if (/^\d+$/.test(trimmed)) {
      const parsed = Number(trimmed);
      if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
    }
  }

  throw new BridgeBurnEventValidationError("Invalid chain id");
};

const stringifyChainId = (chainId: ChainId): string => String(chainId);

const normalizeBurnHash = (value: unknown, sourceChainId: ChainId): UniversalTxHash => {
  if (typeof value !== "string") {
    throw new BridgeBurnEventValidationError("Invalid burn hash");
  }

  const trimmed = value.trim();
  if (getChainType(sourceChainId) === "evm") {
    if (!isValidEvmTxHash(trimmed)) {
      throw new BridgeBurnEventValidationError("Invalid EVM burn hash");
    }
    return trimmed.toLowerCase() as UniversalTxHash;
  }

  if (!isValidSolanaTxHash(trimmed)) {
    throw new BridgeBurnEventValidationError("Invalid Solana burn hash");
  }
  return trimmed as UniversalTxHash;
};

const normalizeTransferType = (value: unknown): BridgeBurnTransferType => {
  if (value === "fast" || value === "standard") return value;
  throw new BridgeBurnEventValidationError("Invalid transfer type");
};

const assertVercelPropertyLimit = (name: string, value: string): void => {
  if (value.length > VERCEL_CUSTOM_PROPERTY_LIMIT) {
    throw new BridgeBurnEventValidationError(
      `${name} exceeds ${VERCEL_CUSTOM_PROPERTY_LIMIT} characters`
    );
  }
};

export const buildBridgeBurnEventPayload = (
  input: BridgeBurnEventInput
): BridgeBurnEventPayload => {
  const sourceChainId = normalizeChainId(input.sourceChainId);
  const targetChainId = normalizeChainId(input.targetChainId);
  const burnHash = normalizeBurnHash(input.burnHash, sourceChainId);
  const amount = normalizeDecimal(input.amount);
  const transferType = normalizeTransferType(input.transferType);
  const appFastFee = normalizeDecimal(input.appFastFee, "0");
  const circleFastFee = normalizeDecimal(input.circleFastFee, "0");
  const speed: BridgeBurnEventSpeed = transferType === "fast" ? "f" : "s";

  const id = `${stringifyChainId(sourceChainId)}:${burnHash}`;
  const m = [
    BRIDGE_BURN_EVENT_VERSION,
    amount,
    stringifyChainId(sourceChainId),
    stringifyChainId(targetChainId),
    speed,
    appFastFee,
    circleFastFee,
  ].join(",");

  assertVercelPropertyLimit("id", id);
  assertVercelPropertyLimit("m", m);

  return { id, m };
};

export const parseBridgeBurnEventMetadata = (
  metadata: string
): ParsedBridgeBurnEventMetadata => {
  const [version, amount, sourceChainId, targetChainId, speed, appFastFee, circleFastFee] =
    metadata.split(",");

  if (
    version !== BRIDGE_BURN_EVENT_VERSION ||
    !isValidDecimalUsdc(amount) ||
    !sourceChainId ||
    !targetChainId ||
    (speed !== "f" && speed !== "s") ||
    !isValidDecimalUsdc(appFastFee) ||
    !isValidDecimalUsdc(circleFastFee)
  ) {
    throw new BridgeBurnEventValidationError("Invalid bridge burn event metadata");
  }

  return {
    version,
    amount,
    sourceChainId,
    targetChainId,
    speed,
    appFastFee,
    circleFastFee,
  };
};
