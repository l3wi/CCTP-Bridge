import type { Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_MESSENGER_PROGRAM_ID } from "./pdas";

export type SolanaCctpCluster = "mainnet" | "devnet";

const feeRecipientCache = new Map<string, PublicKey>();
const pendingFeeRecipientLoads = new Map<string, Promise<PublicKey>>();

const TOKEN_MESSENGER_ACCOUNT_DISCRIMINATOR = Buffer.from("a204f23493f3dd60", "hex");
const TOKEN_MESSENGER_ACCOUNT_SIZE = 177;
const TOKEN_MESSENGER_FEE_RECIPIENT_OFFSET = 109;
const TOKEN_MESSENGER_FEE_RECIPIENT_END = TOKEN_MESSENGER_FEE_RECIPIENT_OFFSET + 32;
const TOKEN_MESSENGER_ACCOUNT_SLICE_LENGTH = TOKEN_MESSENGER_FEE_RECIPIENT_END;

const VERIFIED_TOKEN_MESSENGER_FEE_RECIPIENT: Record<SolanaCctpCluster, PublicKey> = {
  devnet: new PublicKey("AYG63YgrKLbp9B23ntcRemU8kSD7rZ7cNFGDo8DbEfTd"),
  mainnet: new PublicKey("4BPnUzFDibVcWQ5zzixGodRUHwqDxHYpUPdPYus3Bn56"),
};

const [TOKEN_MESSENGER_PDA] = PublicKey.findProgramAddressSync(
  [Buffer.from("token_messenger")],
  TOKEN_MESSENGER_PROGRAM_ID
);

function decodeFeeRecipientFromTokenMessengerAccount(
  accountData: Buffer,
  minimumSize = TOKEN_MESSENGER_ACCOUNT_SIZE
): PublicKey {
  if (accountData.length < minimumSize) {
    throw new Error(
      `Invalid TokenMessenger account size: expected at least ${minimumSize} bytes, got ${accountData.length}`
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

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

function isAccessForbiddenError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return /\b403\b/.test(message) || /access forbidden|forbidden/i.test(message);
}

async function fetchTokenMessengerAccountData(
  connection: Connection,
  tokenMessengerPda: PublicKey,
  sliced = false
): Promise<Buffer> {
  const accountInfo = await connection.getAccountInfo(
    tokenMessengerPda,
    sliced
      ? {
          commitment: "confirmed",
          dataSlice: { offset: 0, length: TOKEN_MESSENGER_ACCOUNT_SLICE_LENGTH },
        }
      : "confirmed"
  );

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

  return Buffer.from(accountInfo.data);
}

function getVerifiedFeeRecipientFallback(
  tokenMessengerPda: PublicKey,
  cluster?: SolanaCctpCluster
): PublicKey | null {
  if (!cluster || !tokenMessengerPda.equals(TOKEN_MESSENGER_PDA)) {
    return null;
  }

  return VERIFIED_TOKEN_MESSENGER_FEE_RECIPIENT[cluster];
}

/**
 * Fetch the feeRecipient from the on-chain TokenMessenger state.
 */
export async function fetchFeeRecipient(
  connection: Connection,
  tokenMessengerPda: PublicKey,
  cluster?: SolanaCctpCluster
): Promise<PublicKey> {
  const cacheKey = `${connection.rpcEndpoint}:${tokenMessengerPda.toBase58()}:${cluster ?? "unknown"}`;
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
      const accountData = await fetchTokenMessengerAccountData(
        connection,
        tokenMessengerPda
      );
      return decodeFeeRecipientFromTokenMessengerAccount(accountData);
    } catch (error) {
      if (error instanceof Error && error.message.includes("TokenMessenger")) {
        throw error;
      }

      if (isAccessForbiddenError(error)) {
        try {
          const accountData = await fetchTokenMessengerAccountData(
            connection,
            tokenMessengerPda,
            true
          );
          return decodeFeeRecipientFromTokenMessengerAccount(
            accountData,
            TOKEN_MESSENGER_ACCOUNT_SLICE_LENGTH
          );
        } catch (sliceError) {
          const fallback = getVerifiedFeeRecipientFallback(
            tokenMessengerPda,
            cluster
          );
          if (fallback && isAccessForbiddenError(sliceError)) {
            // Public Solana RPCs can intermittently reject account reads for this
            // stable Circle PDA. Use the verified per-cluster state value rather
            // than blocking claim construction before the wallet can sign.
            return fallback;
          }

          throw sliceError;
        }
      }

      const message = getErrorMessage(error);
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
