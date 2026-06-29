import { describe, expect, it, vi } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { fetchFeeRecipient } from "@/lib/cctp/solana/accounts";
import { TOKEN_MESSENGER_PROGRAM_ID } from "@/lib/cctp/solana/pdas";

const TOKEN_MESSENGER_ACCOUNT_DISCRIMINATOR = Buffer.from("a204f23493f3dd60", "hex");
const TOKEN_MESSENGER_FEE_RECIPIENT_OFFSET = 109;
const TOKEN_MESSENGER_FEE_RECIPIENT_END = TOKEN_MESSENGER_FEE_RECIPIENT_OFFSET + 32;
const FORBIDDEN_ERROR = new Error(
  'failed to get info about account: Error: 403 : {"jsonrpc":"2.0","error":{"code":403,"message":"Access forbidden"}}'
);

const [TOKEN_MESSENGER_PDA] = PublicKey.findProgramAddressSync(
  [Buffer.from("token_messenger")],
  TOKEN_MESSENGER_PROGRAM_ID
);

function makeTokenMessengerAccountData(
  feeRecipient: PublicKey,
  size = 177
): Buffer {
  const data = Buffer.alloc(size, 0);
  TOKEN_MESSENGER_ACCOUNT_DISCRIMINATOR.copy(data, 0);
  Buffer.from(feeRecipient.toBytes()).copy(data, TOKEN_MESSENGER_FEE_RECIPIENT_OFFSET);
  return data;
}

function makeConnection(
  getAccountInfo: ReturnType<typeof vi.fn>,
  rpcEndpoint: string
) {
  return {
    rpcEndpoint,
    getAccountInfo,
  } as never;
}

describe("fetchFeeRecipient", () => {
  it("retries with a sliced TokenMessenger account read after an access-forbidden error", async () => {
    const feeRecipient = Keypair.generate().publicKey;
    const slicedData = makeTokenMessengerAccountData(
      feeRecipient,
      TOKEN_MESSENGER_FEE_RECIPIENT_END
    );
    const getAccountInfo = vi
      .fn()
      .mockRejectedValueOnce(FORBIDDEN_ERROR)
      .mockResolvedValueOnce({
        data: slicedData,
        owner: TOKEN_MESSENGER_PROGRAM_ID,
      });

    const result = await fetchFeeRecipient(
      makeConnection(getAccountInfo, "mock://slice-retry"),
      TOKEN_MESSENGER_PDA,
      "devnet"
    );

    expect(result.toBase58()).toBe(feeRecipient.toBase58());
    expect(getAccountInfo).toHaveBeenNthCalledWith(1, TOKEN_MESSENGER_PDA, "confirmed");
    expect(getAccountInfo).toHaveBeenNthCalledWith(
      2,
      TOKEN_MESSENGER_PDA,
      expect.objectContaining({
        commitment: "confirmed",
        dataSlice: { offset: 0, length: TOKEN_MESSENGER_FEE_RECIPIENT_END },
      })
    );
  });

  it("falls back to the verified devnet TokenMessenger fee recipient when RPC account reads are forbidden", async () => {
    const getAccountInfo = vi.fn().mockRejectedValue(FORBIDDEN_ERROR);

    const result = await fetchFeeRecipient(
      makeConnection(getAccountInfo, "mock://devnet-forbidden"),
      TOKEN_MESSENGER_PDA,
      "devnet"
    );

    expect(result.toBase58()).toBe("AYG63YgrKLbp9B23ntcRemU8kSD7rZ7cNFGDo8DbEfTd");
    expect(getAccountInfo).toHaveBeenCalledTimes(2);
  });

  it("falls back to the verified mainnet TokenMessenger fee recipient when RPC account reads are forbidden", async () => {
    const getAccountInfo = vi.fn().mockRejectedValue(FORBIDDEN_ERROR);

    const result = await fetchFeeRecipient(
      makeConnection(getAccountInfo, "mock://mainnet-forbidden"),
      TOKEN_MESSENGER_PDA,
      "mainnet"
    );

    expect(result.toBase58()).toBe("4BPnUzFDibVcWQ5zzixGodRUHwqDxHYpUPdPYus3Bn56");
    expect(getAccountInfo).toHaveBeenCalledTimes(2);
  });

  it("does not use the verified fallback for unrelated accounts", async () => {
    const unrelatedPda = Keypair.generate().publicKey;
    const getAccountInfo = vi.fn().mockRejectedValue(FORBIDDEN_ERROR);

    await expect(
      fetchFeeRecipient(
        makeConnection(getAccountInfo, "mock://unrelated-forbidden"),
        unrelatedPda,
        "devnet"
      )
    ).rejects.toThrow("Access forbidden");
  });
});
