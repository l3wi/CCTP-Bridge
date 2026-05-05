import type { Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_MESSENGER_PROGRAM_ID } from "./pdas";

const feeRecipientCache = new Map<string, PublicKey>();
const pendingFeeRecipientLoads = new Map<string, Promise<PublicKey>>();

const TOKEN_MESSENGER_ACCOUNT_DISCRIMINATOR = Buffer.from("a204f23493f3dd60", "hex");
const TOKEN_MESSENGER_ACCOUNT_SIZE = 177;
const TOKEN_MESSENGER_FEE_RECIPIENT_OFFSET = 109;
const TOKEN_MESSENGER_FEE_RECIPIENT_END = TOKEN_MESSENGER_FEE_RECIPIENT_OFFSET + 32;

function decodeFeeRecipientFromTokenMessengerAccount(
  accountData: Buffer
): PublicKey {
  if (accountData.length < TOKEN_MESSENGER_ACCOUNT_SIZE) {
    throw new Error(
      `Invalid TokenMessenger account size: expected at least ${TOKEN_MESSENGER_ACCOUNT_SIZE} bytes, got ${accountData.length}`
    );
  }

  const discriminator = accountData.subarray(0, 8);
  if (!discriminator.equals(TOKEN_MESSENGER_ACCOUNT_DISCRIMINATOR)) {
    throw new Error(
      "TokenMessenger account discriminator mismatch. " +
      "The program layout may have changed and requires an update."
    );
  }

  const feeRecipientBytes = accountData.subarray(
    TOKEN_MESSENGER_FEE_RECIPIENT_OFFSET,
    TOKEN_MESSENGER_FEE_RECIPIENT_END
  );

  if (feeRecipientBytes.length !== 32) {
    throw new Error(
      `Invalid feeRecipient field size in TokenMessenger account: expected 32 bytes, got ${feeRecipientBytes.length}`
    );
  }

  return new PublicKey(feeRecipientBytes);
}

/**
 * Fetch the feeRecipient from the on-chain TokenMessenger state.
 */
export async function fetchFeeRecipient(
  connection: Connection,
  tokenMessengerPda: PublicKey
): Promise<PublicKey> {
  const cacheKey = `${connection.rpcEndpoint}:${tokenMessengerPda.toBase58()}`;
  const cached = feeRecipientCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const pending = pendingFeeRecipientLoads.get(cacheKey);
  if (pending) {
    return pending;
  }

  const loadPromise = (async () => {
    try {
      const accountInfo = await connection.getAccountInfo(tokenMessengerPda, "confirmed");

      if (!accountInfo) {
        throw new Error(
          `TokenMessenger account not found at ${tokenMessengerPda.toBase58()}`
        );
      }

      if (!accountInfo.owner.equals(TOKEN_MESSENGER_PROGRAM_ID)) {
        throw new Error(
          `Invalid TokenMessenger account owner: expected ${TOKEN_MESSENGER_PROGRAM_ID.toBase58()}, got ${accountInfo.owner.toBase58()}`
        );
      }

      return decodeFeeRecipientFromTokenMessengerAccount(Buffer.from(accountInfo.data));
    } catch (error) {
      if (error instanceof Error && error.message.includes("TokenMessenger")) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to fetch feeRecipient from TokenMessenger: ${message}`
      );
    }
  })();

  pendingFeeRecipientLoads.set(cacheKey, loadPromise);
  try {
    const feeRecipient = await loadPromise;
    feeRecipientCache.set(cacheKey, feeRecipient);
    return feeRecipient;
  } finally {
    pendingFeeRecipientLoads.delete(cacheKey);
  }
}
