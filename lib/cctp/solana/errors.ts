/**
 * CCTP v2 Solana program error codes and user-friendly messages.
 *
 * Error codes are Anchor custom errors (base 6000 + index).
 * During a receiveMessage CPI chain the error can originate from either:
 *   - MessageTransmitterV2 (CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC)
 *   - TokenMessengerMinterV2 (CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe)
 *
 * Because both programs use Anchor and their custom errors start at 6000,
 * the same numeric code can mean different things depending on the program.
 * We include both interpretations and pick the most likely one for the
 * receiveMessage flow.
 *
 * Sources:
 *   https://github.com/circlefin/solana-cctp-contracts/blob/master/programs/v2/message-transmitter-v2/src/error.rs
 *   https://github.com/circlefin/solana-cctp-contracts/blob/master/programs/v2/token-messenger-minter-v2/src/token_messenger_v2/error.rs
 *   https://github.com/circlefin/solana-cctp-contracts/blob/master/programs/v2/token-messenger-minter-v2/src/token_minter_v2/error.rs
 */

// =============================================================================
// Error code → friendly message mapping
// =============================================================================

export interface CctpErrorInfo {
  /** Internal error name */
  name: string;
  /** Program that most likely emitted this during receiveMessage */
  program: "MessageTransmitter" | "TokenMessenger" | "TokenMinter";
  /** Short toast title (≤ 30 chars) */
  title: string;
  /** Toast description — 1-2 short sentences that fit in 420px */
  userMessage: string;
  /** Longer explanation for console.error / debugging */
  detail: string;
  /** If true, the mint hook should set messageExpired */
  isExpired?: boolean;
  /** If true, treat as already-claimed */
  isAlreadyClaimed?: boolean;
}

/**
 * Map from hex error code (lowercase, no 0x prefix) → error info.
 *
 * Hex values are the raw program error codes seen in
 * "custom program error: 0xNNNN".
 *
 * Only errors that can realistically surface during receiveMessage / CPI
 * are included. Admin-only errors are omitted.
 */
const CCTP_ERROR_MAP: Record<string, CctpErrorInfo> = {
  // =========================================================================
  // TokenMessengerMinterV2 errors (most common during receiveMessage CPI)
  // =========================================================================
  "1770": {
    name: "TokenMessenger::InvalidAuthority",
    program: "TokenMessenger",
    title: "Authority error",
    userMessage: "Internal CCTP authority mismatch. Please try again later.",
    detail: "The authority PDA check failed in the TokenMessenger CPI.",
  },
  "1772": {
    name: "TokenMessenger::InvalidTokenMessenger",
    program: "TokenMessenger",
    title: "Configuration error",
    userMessage: "Remote token messenger mismatch. This route may not be supported yet.",
    detail: "remote_token_messenger.token_messenger != params.sender.",
  },
  "1774": {
    name: "TokenMessenger::MalformedMessage",
    program: "TokenMessenger",
    title: "Invalid message",
    userMessage: "The burn message is malformed. This transfer may be invalid.",
    detail: "BurnMessage could not be parsed — wrong length or version.",
  },
  "1775": {
    name: "TokenMessenger::InvalidMessageBodyVersion",
    program: "TokenMessenger",
    title: "Version mismatch",
    userMessage: "Unsupported message version. The bridge may have been upgraded.",
    detail: "BurnMessage version doesn't match the on-chain expected version.",
  },
  "1776": {
    name: "TokenMessenger::InvalidAmount",
    program: "TokenMessenger",
    title: "Invalid amount",
    userMessage: "The transfer amount in the message is invalid.",
    detail: "The amount field in the BurnMessage is zero or overflows.",
  },
  "1777": {
    name: "TokenMessenger::InvalidDestinationDomain",
    program: "TokenMessenger",
    title: "Wrong chain",
    userMessage: "This transfer is not destined for this chain.",
    detail: "remote_token_messenger.domain != params.remote_domain.",
  },
  "1779": {
    name: "TokenMessenger::InvalidMintRecipient",
    program: "TokenMessenger",
    title: "Wrong wallet",
    userMessage: "Connect the wallet that was set as recipient when this transfer was initiated.",
    detail:
      "recipient_token_account.key() != burn_message.mint_recipient(). " +
      "The ATA derived from the connected wallet doesn't match the mintRecipient encoded in the burn message.",
  },
  "177b": {
    name: "TokenMessenger::InvalidTokenPair",
    program: "TokenMessenger",
    title: "Unsupported route",
    userMessage: "Token pair not supported on this route. Bridge config may have changed.",
    detail: "token_pair.local_token != local_token.key().",
  },
  "177d": {
    name: "TokenMessenger::InvalidHookData",
    program: "TokenMessenger",
    title: "Invalid hook data",
    userMessage: "The burn message contains invalid hook data.",
    detail: "The hookData section of the BurnMessage failed validation.",
  },
  "177e": {
    name: "TokenMessenger::FeeExceedsAmount",
    program: "TokenMessenger",
    title: "Fee too high",
    userMessage: "Relay fee exceeds the transfer amount. Re-attestation needed.",
    detail: "fee_executed >= amount in BurnMessage.",
    isExpired: true, // re-attest to get a fresh fee
  },
  "177f": {
    name: "TokenMessenger::FeeExceedsMaxFee",
    program: "TokenMessenger",
    title: "Fee too high",
    userMessage: "Relay fee exceeds the max fee. Re-attestation needed.",
    detail: "fee_executed > max_fee in BurnMessage.",
    isExpired: true, // re-attest to get a fresh fee
  },
  "1780": {
    name: "TokenMessenger::MessageExpired",
    program: "TokenMessenger",
    title: "Attestation expired",
    userMessage: "Automatically requesting a new attestation…",
    detail: "expiration_block != 0 && current_slot >= expiration_block.",
    isExpired: true,
  },
  "1781": {
    name: "TokenMessenger::UnsupportedFinalityThreshold",
    program: "TokenMessenger",
    title: "Unsupported finality",
    userMessage: "Finality threshold not accepted. Try standard speed.",
    detail: "The finality_threshold_executed value is not accepted by the handler.",
  },
  "1785": {
    name: "TokenMessenger::DenylistedAccount",
    program: "TokenMessenger",
    title: "Account restricted",
    userMessage: "This account has been restricted by Circle and cannot receive USDC.",
    detail: "The recipient or fee_recipient is on the denylist.",
  },
  "1786": {
    name: "TokenMessenger::InvalidFeeRecipient",
    program: "TokenMessenger",
    title: "Fee config error",
    userMessage: "Fee recipient mismatch. Please try again later.",
    detail: "fee_recipient_token_account doesn't match token_messenger.fee_recipient ATA.",
  },
  "178a": {
    name: "TokenMessenger::InsufficientMaxFee",
    program: "TokenMessenger",
    title: "Fee too low",
    userMessage: "Max fee is too low for this route. Try standard speed.",
    detail: "max_fee is below the required minimum for this route.",
  },

  // =========================================================================
  // MessageTransmitterV2 errors (pre-CPI checks in receiveMessage)
  // =========================================================================
  "1771": {
    name: "MessageTransmitter::ProgramPaused",
    program: "MessageTransmitter",
    title: "CCTP paused",
    userMessage: "CCTP is temporarily paused. Please try again later.",
    detail: "message_transmitter.paused == true.",
  },
  "176e": {
    name: "MessageTransmitter::InvalidDestinationCaller",
    program: "MessageTransmitter",
    title: "Wrong caller",
    userMessage: "Only a specific wallet can claim this transfer. Connect that wallet.",
    detail: "destination_caller != Pubkey::default() && destination_caller != caller.key().",
  },
  "177c": {
    name: "MessageTransmitter::InvalidAttestationLength",
    program: "MessageTransmitter",
    title: "Bad attestation",
    userMessage: "Attestation data is invalid. Try refreshing and claiming again.",
    detail: "Attestation byte length doesn't match expected signature count.",
  },
};

// =============================================================================
// Error code extraction & lookup
// =============================================================================

/**
 * Extract the hex error code from a Solana error string.
 *
 * Matches patterns like:
 *   - "custom program error: 0x1780"
 *   - "Custom":6016  /  "Custom": 6016
 *
 * Returns lowercase hex string without prefix, e.g. "1780".
 */
export function extractCctpErrorCode(errorText: string): string | null {
  // Pattern 1: "custom program error: 0xNNNN"
  const hexMatch = errorText.match(/custom program error:\s*0x([0-9a-fA-F]+)/i);
  if (hexMatch) {
    return hexMatch[1].toLowerCase();
  }

  // Pattern 2: "Custom": NNNN  (decimal, from JSON-encoded Solana errors)
  const decMatch = errorText.match(/"Custom":\s*(\d+)/);
  if (decMatch) {
    return parseInt(decMatch[1], 10).toString(16).toLowerCase().padStart(4, "0");
  }

  return null;
}

/**
 * Look up a CCTP error by its hex code.
 *
 * During receiveMessage the CPI target is TokenMessengerMinter, so we
 * prefer the TM interpretation when codes overlap with MT.
 */
export function lookupCctpError(hexCode: string): CctpErrorInfo | null {
  const code = hexCode.toLowerCase();
  return CCTP_ERROR_MAP[code] ?? null;
}

/**
 * Parse a Solana error and return structured CCTP error info if possible.
 *
 * Inspects error.message, error.transactionMessage, and error.logs to find
 * the hex error code, then maps it to a user-friendly message.
 */
export function parseSolanaCctpError(error: unknown): {
  code: string | null;
  info: CctpErrorInfo | null;
  /** The full text we searched through (for logging) */
  searchText: string;
} {
  const parts: string[] = [];

  if (error instanceof Error) {
    parts.push(error.message);
  } else {
    parts.push(String(error));
  }

  // SendTransactionError fields
  const txMsg = (error as { transactionMessage?: string })?.transactionMessage;
  if (txMsg) parts.push(txMsg);

  const txLogs = (error as { transactionLogs?: string[] })?.transactionLogs;
  if (Array.isArray(txLogs)) parts.push(...txLogs);

  // Deprecated .logs getter
  const logs = (error as { logs?: string[] })?.logs;
  if (Array.isArray(logs)) parts.push(...logs);

  // Simulation logs from our explicit simulate call
  const simLogs = (error as { simulationLogs?: string[] })?.simulationLogs;
  if (Array.isArray(simLogs)) parts.push(...simLogs);

  const searchText = parts.join("\n");
  const code = extractCctpErrorCode(searchText);

  return {
    code,
    info: code ? lookupCctpError(code) : null,
    searchText,
  };
}
