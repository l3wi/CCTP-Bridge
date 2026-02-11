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

interface CctpErrorInfo {
  /** Internal error name */
  name: string;
  /** Program that most likely emitted this during receiveMessage */
  program: "MessageTransmitter" | "TokenMessenger" | "TokenMinter";
  /** Short user-facing message */
  userMessage: string;
  /** Longer explanation shown in console / debug UI */
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
    userMessage: "Internal CCTP authority error. Please try again later.",
    detail: "The authority PDA check failed in the TokenMessenger CPI.",
  },
  "1772": {
    name: "TokenMessenger::InvalidTokenMessenger",
    program: "TokenMessenger",
    userMessage: "CCTP configuration error — remote token messenger mismatch.",
    detail: "The remote_token_messenger.token_messenger does not match params.sender.",
  },
  "1774": {
    name: "TokenMessenger::MalformedMessage",
    program: "TokenMessenger",
    userMessage: "The burn message is malformed. This transfer may be invalid.",
    detail: "BurnMessage could not be parsed — wrong length or version.",
  },
  "1775": {
    name: "TokenMessenger::InvalidMessageBodyVersion",
    program: "TokenMessenger",
    userMessage: "Unsupported CCTP message version. The bridge may have been upgraded.",
    detail: "BurnMessage version doesn't match the on-chain expected version.",
  },
  "1776": {
    name: "TokenMessenger::InvalidAmount",
    program: "TokenMessenger",
    userMessage: "Invalid transfer amount in the burn message.",
    detail: "The amount field in the BurnMessage is zero or overflows.",
  },
  "1777": {
    name: "TokenMessenger::InvalidDestinationDomain",
    program: "TokenMessenger",
    userMessage: "This transfer is not destined for this chain.",
    detail: "remote_token_messenger.domain != params.remote_domain.",
  },
  "1779": {
    name: "TokenMessenger::InvalidMintRecipient",
    program: "TokenMessenger",
    userMessage:
      "Your connected wallet doesn't match the destination address for this transfer. " +
      "Please connect the wallet that was set as the recipient when the transfer was initiated.",
    detail:
      "recipient_token_account.key() != burn_message.mint_recipient(). " +
      "The ATA derived from the connected wallet doesn't match the mintRecipient encoded in the burn message.",
  },
  "177b": {
    name: "TokenMessenger::InvalidTokenPair",
    program: "TokenMessenger",
    userMessage: "Unsupported token pair for this route. The bridge configuration may have changed.",
    detail: "token_pair.local_token != local_token.key().",
  },
  "177d": {
    name: "TokenMessenger::InvalidHookData",
    program: "TokenMessenger",
    userMessage: "Invalid hook data in the burn message.",
    detail: "The hookData section of the BurnMessage failed validation.",
  },
  "177e": {
    name: "TokenMessenger::FeeExceedsAmount",
    program: "TokenMessenger",
    userMessage: "The relay fee exceeds the transfer amount. Request re-attestation for a fresh quote.",
    detail: "fee_executed >= amount in BurnMessage.",
  },
  "177f": {
    name: "TokenMessenger::FeeExceedsMaxFee",
    program: "TokenMessenger",
    userMessage: "The relay fee exceeds the maximum fee. Request re-attestation for a fresh quote.",
    detail: "fee_executed > max_fee in BurnMessage.",
  },
  "1780": {
    name: "TokenMessenger::MessageExpired",
    program: "TokenMessenger",
    userMessage: "This transfer's attestation has expired. Automatically requesting a new one…",
    detail: "expiration_block != 0 && current_slot >= expiration_block.",
    isExpired: true,
  },
  "1781": {
    name: "TokenMessenger::UnsupportedFinalityThreshold",
    program: "TokenMessenger",
    userMessage: "Unsupported finality threshold. Please try again with different transfer settings.",
    detail: "The finality_threshold_executed value is not accepted by the handler.",
  },
  "1785": {
    name: "TokenMessenger::DenylistedAccount",
    program: "TokenMessenger",
    userMessage: "This account has been restricted by Circle and cannot receive USDC via CCTP.",
    detail: "The recipient or fee_recipient is on the denylist.",
  },
  "1786": {
    name: "TokenMessenger::InvalidFeeRecipient",
    program: "TokenMessenger",
    userMessage: "Fee recipient configuration error. Please try again later.",
    detail: "fee_recipient_token_account doesn't match token_messenger.fee_recipient ATA.",
  },
  "178a": {
    name: "TokenMessenger::InsufficientMaxFee",
    program: "TokenMessenger",
    userMessage: "The maximum fee is too low for this transfer. Try increasing the fee or using standard speed.",
    detail: "max_fee is below the required minimum for this route.",
  },

  // =========================================================================
  // MessageTransmitterV2 errors (pre-CPI checks in receiveMessage)
  // =========================================================================
  "1771": {
    name: "MessageTransmitter::ProgramPaused",
    program: "MessageTransmitter",
    userMessage: "CCTP is temporarily paused for maintenance. Please try again later.",
    detail: "message_transmitter.paused == true.",
  },
  "176e": {
    name: "MessageTransmitter::InvalidDestinationCaller",
    program: "MessageTransmitter",
    userMessage:
      "Only a specific address can claim this transfer. " +
      "If you set a destination caller when burning, connect that wallet.",
    detail: "destination_caller != Pubkey::default() && destination_caller != caller.key().",
  },
  "1772_mt": {
    // Note: 0x1772 from MT = InvalidDestinationDomain, from TM = InvalidTokenMessenger
    // We store MT version under a suffixed key; lookup logic tries TM first.
    name: "MessageTransmitter::InvalidDestinationDomain",
    program: "MessageTransmitter",
    userMessage: "This transfer is not destined for this chain. Check the destination chain.",
    detail: "message.destination_domain != message_transmitter.local_domain.",
  },
  "1775_mt": {
    name: "MessageTransmitter::InvalidRecipientProgram",
    program: "MessageTransmitter",
    userMessage: "Internal routing error — the recipient program doesn't match.",
    detail: "message.recipient() != receiver.key(). The receiver account is wrong.",
  },
  "1777_mt": {
    name: "MessageTransmitter::NonceAlreadyUsed",
    program: "MessageTransmitter",
    userMessage: "This transfer has already been claimed. Check your wallet for the USDC.",
    detail: "The nonce PDA already exists (account already in use = init failed).",
    isAlreadyClaimed: true,
  },
  "1779_mt": {
    name: "MessageTransmitter::MalformedMessage",
    program: "MessageTransmitter",
    userMessage: "The CCTP message is malformed or corrupted.",
    detail: "Message parsing failed in MessageTransmitter.",
  },
  "177b_mt": {
    name: "MessageTransmitter::InvalidAttesterSignature",
    program: "MessageTransmitter",
    userMessage: "Invalid attestation signature. The attestation may be corrupted — try re-fetching.",
    detail: "ECDSA signature verification failed for one or more attesters.",
  },
  "177c": {
    name: "MessageTransmitter::InvalidAttestationLength",
    program: "MessageTransmitter",
    userMessage: "Invalid attestation data. Try refreshing and claiming again.",
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
 *   - "Custom:6016"
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
    return parseInt(decMatch[1], 10).toString(16).toLowerCase();
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

  const searchText = parts.join("\n");
  const code = extractCctpErrorCode(searchText);

  return {
    code,
    info: code ? lookupCctpError(code) : null,
    searchText,
  };
}
