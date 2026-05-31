import type { Chain } from "viem";
import type { BridgeEstimate } from "@/lib/cctp/types";
import { TransferSpeed, type TransferSpeedValue } from "@/lib/cctp/transferSpeed";
import { getCctpConfirmationsUniversal, type UniversalChainDefinition } from "@/lib/bridgeConfig";
import type { AmountState, ChainId } from "@/lib/types";

export type ChainOption = {
  value: string;
  label: string;
  id: ChainId;
  chain?: Chain;
  chainType: "evm" | "solana";
};

export function parseAmountToState(input: string): AmountState | null {
  const cleanStr = input.replace(/[^0-9.]/g, "").trim();
  if (!cleanStr) return null;

  const [integerPart, decimalPart = ""] = cleanStr.split(".");
  const paddedDecimal = decimalPart.padEnd(6, "0").slice(0, 6);

  try {
    return {
      str: cleanStr,
      bigInt: BigInt(`${integerPart}${paddedDecimal}`),
    };
  } catch {
    return null;
  }
}

export function buildChainOptions(params: {
  supportedEvmChains: Chain[];
  allBridgeKitChains: UniversalChainDefinition[];
}): ChainOption[] {
  const evmOptions: ChainOption[] = params.supportedEvmChains.map((chain) => ({
    value: chain.id.toString(),
    label: chain.name,
    id: chain.id,
    chain,
    chainType: "evm",
  }));

  const solanaOptions: ChainOption[] = params.allBridgeKitChains
    .filter((chain) => chain.type === "solana")
    .map((chain) => ({
      value: chain.chain as string,
      label: chain.name || (chain.chain as string),
      id: chain.chain as ChainId,
      chainType: "solana",
    }));

  return [...evmOptions, ...solanaOptions];
}

export function buildChainOptionMap(chainOptions: ChainOption[]): Map<ChainId, ChainOption> {
  const map = new Map<ChainId, ChainOption>();
  chainOptions.forEach((option) => map.set(option.id, option));
  return map;
}

export function buildDestinationOptionsBySource(
  chainOptions: ChainOption[]
): Map<ChainId, ChainOption[]> {
  const map = new Map<ChainId, ChainOption[]>();
  chainOptions.forEach((source) => {
    map.set(
      source.id,
      chainOptions.filter((option) => option.id !== source.id)
    );
  });
  return map;
}

export function sortChainOptionsByConnection(
  options: ChainOption[],
  isChainConnected: (chainOption: ChainOption) => boolean
): ChainOption[] {
  return [...options].sort((a, b) => {
    const aConnected = isChainConnected(a);
    const bConnected = isChainConnected(b);
    if (aConnected && !bConnected) return -1;
    if (!aConnected && bConnected) return 1;
    return a.label.localeCompare(b.label);
  });
}

export function hasCompleteBridgeForm(params: {
  sourceChainType: "evm" | "solana";
  solanaConnected: boolean;
  evmChainConnected: boolean;
  isSourceChainSynced: boolean;
  hasTargetChain: boolean;
  hasAmount: boolean;
}): boolean {
  const hasWalletForSource = params.sourceChainType === "solana"
    ? params.solanaConnected
    : params.evmChainConnected;

  return (
    hasWalletForSource &&
    params.isSourceChainSynced &&
    params.hasTargetChain &&
    params.hasAmount
  );
}

export function getTotalBridgeFee(estimate?: BridgeEstimate | null): number {
  if (!estimate?.fees) return 0;
  return estimate.fees.reduce(
    (acc, fee) => acc + (fee.amount ? Number(fee.amount) : 0),
    0
  );
}

export function getAppFastFee(estimate?: BridgeEstimate | null): number {
  if (!estimate?.fees) return 0;
  return estimate.fees.reduce(
    (acc, fee) => acc + (fee.type === "kit" && fee.amount ? Number(fee.amount) : 0),
    0
  );
}

export const getDestinationDeductedFee = getTotalBridgeFee;
export const getTotalProtocolFee = getTotalBridgeFee;

export function getYouWillReceive(params: {
  amount: AmountState | null;
  feeTotal: number;
}): string {
  if (!params.amount) return "0.00 USDC";
  const numericAmount = Number(params.amount.str);
  if (Number.isNaN(numericAmount)) return "0.00 USDC";
  const received = Math.max(0, numericAmount - (params.feeTotal ?? 0));
  return `${received.toFixed(6)} USDC`;
}

export type EstimateLabels = {
  feeLabel: string;
  receiveLabel: string;
  confirmationLabel: string;
  speedLabel: string;
};

export function getEstimateLabels(params: {
  speed: TransferSpeedValue;
  estimate: BridgeEstimate | null | undefined;
  isEstimating: boolean;
  amountIsValid: boolean;
  chainSelectionValid: boolean;
  hasAmountInput: boolean;
  amount: AmountState | null;
  activeSourceChainId: ChainId | null;
  transferSpeedLabel: string;
}): EstimateLabels {
  const feeTotal = getTotalBridgeFee(params.estimate);
  const blockedEstimateLabel = !params.amountIsValid
    ? "Complete the form"
    : !params.chainSelectionValid
    ? "Select chains"
    : null;

  const feeLabel = !params.hasAmountInput
    ? "—"
    : blockedEstimateLabel
    ? blockedEstimateLabel
    : params.isEstimating
    ? "Fetching..."
    : params.estimate
    ? `${feeTotal.toFixed(6)} USDC`
    : "—";

  const receiveLabel = !params.hasAmountInput
    ? "—"
    : blockedEstimateLabel
    ? blockedEstimateLabel
    : params.estimate
    ? getYouWillReceive({ amount: params.amount, feeTotal })
    : "—";

  const confirmations = params.activeSourceChainId
    ? getCctpConfirmationsUniversal(params.activeSourceChainId)
    : null;
  const blocks =
    params.speed === TransferSpeed.FAST ? confirmations?.fast : confirmations?.standard;
  const confirmationLabel = blocks
    ? `${blocks} ${blocks === 1 ? "Block" : "Blocks"}`
    : "—";

  return {
    feeLabel,
    receiveLabel,
    confirmationLabel,
    speedLabel: params.transferSpeedLabel,
  };
}
