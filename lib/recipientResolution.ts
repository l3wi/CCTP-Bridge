export type RecipientResolutionKind =
  | "connected_target_wallet"
  | "manual_input"
  | "source_wallet_default";

export interface ResolveRecipientForSendParams {
  isCrossEcosystem: boolean;
  diffWallet: boolean;
  crossEcosystemTargetAddress?: string;
  validationTargetAddress?: string;
  targetAddress?: string;
  defaultTargetWalletAddress?: string;
  senderAddress?: string;
}

export interface ResolvedRecipient {
  finalTargetAddress?: string;
  displayedRecipient?: string;
  recipientResolution: RecipientResolutionKind;
}

const normalizeAddress = (value?: string): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

/**
 * Resolve destination recipient details from a single click-time snapshot.
 * This is used to lock the recipient before bridge execution begins.
 */
export function resolveRecipientForSend(
  params: ResolveRecipientForSendParams
): ResolvedRecipient {
  const crossTarget = normalizeAddress(params.crossEcosystemTargetAddress);
  const validationTarget = normalizeAddress(params.validationTargetAddress);
  const manualTarget = normalizeAddress(params.targetAddress);
  const defaultTargetWallet = normalizeAddress(params.defaultTargetWalletAddress);
  const sender = normalizeAddress(params.senderAddress);

  if (params.isCrossEcosystem) {
    return {
      finalTargetAddress: crossTarget ?? validationTarget ?? manualTarget,
      displayedRecipient: crossTarget ?? manualTarget ?? validationTarget,
      recipientResolution: crossTarget
        ? "connected_target_wallet"
        : "manual_input",
    };
  }

  if (params.diffWallet) {
    return {
      finalTargetAddress: validationTarget ?? manualTarget,
      displayedRecipient: manualTarget ?? validationTarget,
      recipientResolution: "manual_input",
    };
  }

  return {
    finalTargetAddress: sender,
    displayedRecipient: defaultTargetWallet ?? sender,
    recipientResolution: "source_wallet_default",
  };
}

export interface ResolveRecipientForBridgingStateParams {
  submittedRecipientAddress?: string;
  diffWallet: boolean;
  validationTargetAddress?: string;
  defaultTargetWalletAddress?: string;
}

/**
 * Resolve recipient address shown in bridge progress/history views.
 * Locked submitted recipient always wins to avoid UI drift from wallet changes.
 */
export function resolveRecipientForBridgingState(
  params: ResolveRecipientForBridgingStateParams
): string | undefined {
  const submitted = normalizeAddress(params.submittedRecipientAddress);
  if (submitted) return submitted;

  const validationTarget = normalizeAddress(params.validationTargetAddress);
  const defaultTargetWallet = normalizeAddress(params.defaultTargetWalletAddress);

  if (params.diffWallet && validationTarget) {
    return validationTarget;
  }

  return defaultTargetWallet;
}
