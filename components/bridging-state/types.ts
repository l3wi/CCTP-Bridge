import type { BridgeResult } from "@circle-fin/bridge-kit";
import type { DerivedStep } from "@/lib/hooks/useBridgeSteps";
import type { ChainId } from "@/lib/types";

export type BridgeResultWithMeta = BridgeResult & { completedAt?: Date };

export interface ChainInfo {
  value: string;
  label: string;
}

export interface ChainDisplay {
  label: string;
  value: ChainId;
}

export interface BridgingStateProps {
  fromChain: ChainInfo;
  toChain: ChainInfo;
  amount: string;
  estimatedTime?: number; // in seconds
  recipientAddress?: `0x${string}` | string;
  onBack: () => void;
  bridgeResult?: BridgeResultWithMeta;
  confirmations?: { standard?: number; fast?: number };
  finalityEstimate?: string;
  transferType?: "fast" | "standard";
  startedAt?: Date;
  estimatedTimeLabel?: string;
  onBridgeResultUpdate?: (result: BridgeResultWithMeta) => void;
}

export interface StepListProps {
  steps: DerivedStep[];
  sourceChainId: ChainId | undefined;
  destinationChainId: ChainId | undefined;
}

export interface ClaimSectionProps {
  showClaimButton: boolean;
  amount: string;
  destinationLabel: string;
  onDestinationChain: boolean;
  isClaiming: boolean;
  isCheckingMint: boolean;
  isSwitchingChain: boolean;
  onClaim: () => void;
  /** True if the message attestation has expired and needs re-signing */
  messageExpired?: boolean;
  /** Callback to request re-attestation */
  onReattest?: () => void;
  /** True if re-attestation is in progress */
  isReattesting?: boolean;
}

export interface BridgeInfoProps {
  transferType: "fast" | "standard" | undefined;
  sentAtLabel: string;
  isSuccess: boolean;
  completedLabel: string | null;
  etaLabel: string;
}

export interface ChainPairProps {
  from: ChainDisplay;
  to: ChainDisplay;
  amount: string;
  status: "success" | "pending";
}

export interface ProgressSpinnerProps {
  timeLeft: number;
  progress: number;
  estimatedTime: number | undefined;
}
