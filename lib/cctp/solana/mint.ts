/**
 * Public façade for Solana CCTP v2 minting helpers.
 *
 * Implementation is split across focused modules to keep protocol parsing,
 * PDA derivation, account decoding, and transaction construction independently
 * reviewable while preserving existing imports from this file.
 */

export {
  extractDestinationCallerFromMessage,
  extractEventNonceFromMessage,
  extractExpirationBlock,
  extractMintRecipientFromMessage,
  checkMessageExpiration,
} from "./message";

export {
  MESSAGE_TRANSMITTER_PROGRAM_ID,
  TOKEN_MESSENGER_PROGRAM_ID,
  deriveMintPdas,
  deriveUsedNoncePda,
} from "./pdas";

export {
  buildReceiveMessageTransaction,
  isVersionedTransaction,
  resolveSolanaMintRecipient,
  sendTransactionNoConfirm,
  simulateSignedTransaction,
  type SolanaMintParams,
  type SolanaMintRecipientResolution,
  type SolanaMintTransactionPlan,
} from "./transactions";
