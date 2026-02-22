/**
 * CCTP v2 EVM contract revert reason → user-friendly message mapping.
 *
 * EVM contracts use `require(condition, "reason string")`, so errors appear
 * as revert reasons in viem's shortMessage / error.message.
 *
 * Sources:
 *   https://github.com/circlefin/evm-cctp-contracts/blob/master/src/v2/MessageTransmitterV2.sol
 *   https://github.com/circlefin/evm-cctp-contracts/blob/master/src/v2/TokenMessengerV2.sol
 *   https://github.com/circlefin/evm-cctp-contracts/blob/master/src/v2/BaseMessageTransmitter.sol
 */

export interface EvmCctpErrorInfo {
  /** Short toast title */
  title: string;
  /** Toast description — 1-2 short sentences fitting a 420px toast */
  userMessage: string;
  /** If true, the attestation is expired */
  isExpired?: boolean;
  /** If true, auto-trigger a re-attestation request */
  needsReattestation?: boolean;
  /** If true, treat as already-claimed */
  isAlreadyClaimed?: boolean;
}

/**
 * Map of revert reason substrings → error info.
 *
 * Keys are lowercase substrings matched against the full error text.
 * Ordered so the most specific patterns are checked first.
 */
const EVM_CCTP_ERRORS: Array<{
  pattern: RegExp;
  info: EvmCctpErrorInfo;
}> = [
  // ── MessageTransmitterV2 ────────────────────────────────────────────
  {
    pattern: /nonce already used/i,
    info: {
      title: "Already claimed",
      userMessage: "This transfer has already been claimed. Check your wallet for the USDC.",
      isAlreadyClaimed: true,
    },
  },
  {
    pattern: /invalid destination domain/i,
    info: {
      title: "Wrong chain",
      userMessage: "This transfer is for a different chain. Switch to the correct destination.",
    },
  },
  {
    pattern: /invalid caller for message/i,
    info: {
      title: "Wrong wallet",
      userMessage: "Only a specific address can claim this transfer. Connect the designated wallet.",
    },
  },
  {
    pattern: /invalid message version/i,
    info: {
      title: "Version mismatch",
      userMessage: "Unsupported message version. The bridge contract may have been upgraded.",
    },
  },
  {
    pattern: /pausable:\s*paused/i,
    info: {
      title: "CCTP paused",
      userMessage: "CCTP is temporarily paused for maintenance. Please try again later.",
    },
  },
  {
    pattern: /handleReceive(?:Finalized|Unfinalized)Message\(\) failed/i,
    info: {
      title: "Mint handler failed",
      userMessage: "The token mint failed on-chain. The transfer data may be invalid.",
    },
  },

  // ── TokenMessengerV2 ────────────────────────────────────────────────
  {
    pattern: /message expired and must be re-signed/i,
    info: {
      title: "Attestation expired",
      userMessage: "Automatically requesting a new attestation…",
      isExpired: true,
      needsReattestation: true,
    },
  },
  {
    pattern: /message expired/i,
    info: {
      title: "Attestation expired",
      userMessage: "Automatically requesting a new attestation…",
      isExpired: true,
      needsReattestation: true,
    },
  },
  {
    pattern: /fee equals or exceeds amount/i,
    info: {
      title: "Fee too high",
      userMessage: "Relay fee equals or exceeds the transfer amount. Retry with a higher amount.",
    },
  },
  {
    pattern: /fee exceeds max fee/i,
    info: {
      title: "Fee too high",
      userMessage: "Relay fee exceeds the max fee. Retry with standard speed or a higher max fee.",
    },
  },
  {
    pattern: /invalid message body version/i,
    info: {
      title: "Version mismatch",
      userMessage: "Unsupported message body version. The bridge may have been upgraded.",
    },
  },
  {
    pattern: /unsupported finality threshold/i,
    info: {
      title: "Unsupported finality",
      userMessage: "Finality threshold not accepted. Try using standard speed.",
    },
  },
  {
    pattern: /insufficient max fee/i,
    info: {
      title: "Fee too low",
      userMessage: "Max fee is too low for this route. Try standard speed.",
    },
  },

  // ── TokenMinterV2 ──────────────────────────────────────────────────
  {
    pattern: /burn amount exceeded/i,
    info: {
      title: "Amount exceeded",
      userMessage: "Transfer exceeds the per-message burn limit for this token.",
    },
  },

  // ── Generic EVM ────────────────────────────────────────────────────
  {
    pattern: /execution reverted/i,
    info: {
      title: "Transaction reverted",
      userMessage: "The transaction reverted on-chain. It may have already been claimed.",
    },
  },
  {
    pattern: /insufficient funds/i,
    info: {
      title: "Insufficient gas",
      userMessage: "Not enough native token to pay for gas.",
    },
  },
  {
    pattern: /gas required exceeds|out of gas/i,
    info: {
      title: "Out of gas",
      userMessage: "Transaction ran out of gas. Try again with a higher gas limit.",
    },
  },
];

/**
 * Parse an EVM error and return structured CCTP error info if possible.
 *
 * Searches error.message and viem's shortMessage for known revert reasons.
 */
export function parseEvmCctpError(error: unknown): {
  info: EvmCctpErrorInfo | null;
  /** The full text we searched through */
  searchText: string;
} {
  const parts: string[] = [];

  if (error instanceof Error) {
    parts.push(error.message);
  } else {
    parts.push(String(error));
  }

  // Viem errors have shortMessage
  const shortMsg = (error as { shortMessage?: string })?.shortMessage;
  if (shortMsg) parts.push(shortMsg);

  // Some viem errors have details
  const details = (error as { details?: string })?.details;
  if (details) parts.push(details);

  // Walk the cause chain (viem wraps errors)
  let cause = (error as { cause?: unknown })?.cause;
  let depth = 0;
  while (cause && depth < 5) {
    if (cause instanceof Error) {
      parts.push(cause.message);
    }
    const causeShort = (cause as { shortMessage?: string })?.shortMessage;
    if (causeShort) parts.push(causeShort);
    cause = (cause as { cause?: unknown })?.cause;
    depth++;
  }

  const searchText = parts.join("\n");

  for (const { pattern, info } of EVM_CCTP_ERRORS) {
    if (pattern.test(searchText)) {
      return { info, searchText };
    }
  }

  return { info: null, searchText };
}
