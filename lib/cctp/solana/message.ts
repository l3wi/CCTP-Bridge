import type { Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";

/**
 * CCTP v2 message header size (bytes).
 * version(4) + sourceDomain(4) + destinationDomain(4) + nonce(32)
 * + sender(32) + recipient(32) + destinationCaller(32)
 * + minFinalityThreshold(4) + finalityThresholdExecuted(4)
 */
const CCTP_V2_HEADER_SIZE = 148;
const CCTP_HEADER_DESTINATION_CALLER_INDEX = 108;
const BURN_MSG_MINT_RECIPIENT_INDEX = 36; // version(4) + burnToken(32)
const BURN_MSG_EXPIRATION_BLOCK_INDEX = 196; // Offset within burn message body
const EVM_U256_TO_U64_OFFSET = 24; // Skip 24 leading zero bytes to get u64

/**
 * Extract eventNonce from CCTP message bytes.
 * Message format: version(4) + sourceDomain(4) + destinationDomain(4) + nonce(32) + ...
 * Nonce is at bytes 12-44 (0-indexed).
 */
export function extractEventNonceFromMessage(message: string): string {
  const hex = message.replace(/^0x/, "");
  const nonceStart = 12 * 2;
  const nonceEnd = nonceStart + 32 * 2;
  return hex.slice(nonceStart, nonceEnd);
}

/**
 * Extract the mintRecipient token account from a CCTP v2 BurnMessage body.
 * For Solana destinations this must be the recipient owner's USDC ATA.
 */
export function extractMintRecipientFromMessage(message: string): PublicKey {
  const hex = message.replace(/^0x/, "");
  const mintRecipientStart =
    (CCTP_V2_HEADER_SIZE + BURN_MSG_MINT_RECIPIENT_INDEX) * 2;
  const mintRecipientEnd = mintRecipientStart + 32 * 2;
  const mintRecipientHex = hex.slice(mintRecipientStart, mintRecipientEnd);

  if (mintRecipientHex.length !== 64) {
    throw new Error(
      `Invalid CCTP message: missing 32-byte mintRecipient at byte offset ` +
      `${CCTP_V2_HEADER_SIZE + BURN_MSG_MINT_RECIPIENT_INDEX}.`
    );
  }

  return new PublicKey(Buffer.from(mintRecipientHex, "hex"));
}

/**
 * Extract destinationCaller from the fixed CCTP message header.
 * PublicKey.default means receiveMessage is permissionless for any caller.
 */
export function extractDestinationCallerFromMessage(message: string): PublicKey {
  const hex = message.replace(/^0x/, "");
  const callerStart = CCTP_HEADER_DESTINATION_CALLER_INDEX * 2;
  const callerEnd = callerStart + 32 * 2;
  const callerHex = hex.slice(callerStart, callerEnd);

  if (callerHex.length !== 64) {
    throw new Error(
      `Invalid CCTP message: missing 32-byte destinationCaller at byte offset ` +
      `${CCTP_HEADER_DESTINATION_CALLER_INDEX}.`
    );
  }

  return new PublicKey(Buffer.from(callerHex, "hex"));
}

/**
 * Extract the expirationBlock (Solana slot) from a CCTP v2 message.
 * Returns 0 if no expiration is set (meaning the message never expires).
 */
export function extractExpirationBlock(message: string): number {
  const hex = message.replace(/^0x/, "");
  const totalBytes = hex.length / 2;

  const minRequired = CCTP_V2_HEADER_SIZE + BURN_MSG_EXPIRATION_BLOCK_INDEX + 32;
  if (totalBytes < minRequired) {
    return 0;
  }

  const byteOffset =
    CCTP_V2_HEADER_SIZE + BURN_MSG_EXPIRATION_BLOCK_INDEX + EVM_U256_TO_U64_OFFSET;
  const hexStart = byteOffset * 2;
  const hexEnd = hexStart + 16;
  const expirationHex = hex.slice(hexStart, hexEnd);

  if (!expirationHex || expirationHex.length !== 16) {
    return 0;
  }

  try {
    const parsed = BigInt(`0x${expirationHex}`);
    if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
      return Number.MAX_SAFE_INTEGER;
    }
    return Number(parsed);
  } catch {
    return 0;
  }
}

/**
 * Check if a CCTP v2 message has expired based on the current Solana slot.
 */
export async function checkMessageExpiration(
  connection: Connection,
  message: string
): Promise<{
  isExpired: boolean;
  expirationBlock: number;
  currentSlot: number;
}> {
  const expirationBlock = extractExpirationBlock(message);

  if (expirationBlock === 0) {
    return { isExpired: false, expirationBlock: 0, currentSlot: 0 };
  }

  const currentSlot = await connection.getSlot("confirmed");

  return {
    isExpired: currentSlot >= expirationBlock,
    expirationBlock,
    currentSlot,
  };
}
