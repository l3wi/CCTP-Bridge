import { describe, expect, it } from "vitest";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  AddressLookupTableAccount,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  buildReceiveMessageTransaction,
  extractExpirationBlock,
  extractMintRecipientFromMessage,
  MESSAGE_TRANSMITTER_PROGRAM_ID,
  TOKEN_MESSENGER_PROGRAM_ID,
} from "@/lib/cctp/solana/mint";
import { getSolanaUsdcMint } from "@/lib/cctp/shared";

const HEADER_BYTES = 148;
const EXPIRATION_FIELD_INDEX = 196;
const U64_OFFSET = 24;
const MINT_RECIPIENT_FIELD_INDEX = 36;
const DESTINATION_CALLER_BYTE_OFFSET = 108;
const MESSAGE_BYTES = HEADER_BYTES + EXPIRATION_FIELD_INDEX + 32;
const LARGE_MESSAGE_BYTES = 800;
const EXPIRATION_BYTE_OFFSET = HEADER_BYTES + EXPIRATION_FIELD_INDEX + U64_OFFSET;
const MINT_RECIPIENT_BYTE_OFFSET = HEADER_BYTES + MINT_RECIPIENT_FIELD_INDEX;
const TOKEN_MESSENGER_ACCOUNT_DISCRIMINATOR = Buffer.from("a204f23493f3dd60", "hex");
const TOKEN_MESSENGER_ACCOUNT_SIZE = 177;
const TOKEN_MESSENGER_FEE_RECIPIENT_OFFSET = 109;

const toMessageHex = (expiration: bigint): string => {
  const bytes = Buffer.alloc(MESSAGE_BYTES, 0);
  const value = expiration & ((1n << 64n) - 1n);

  for (let i = 0; i < 8; i += 1) {
    const shift = BigInt((7 - i) * 8);
    bytes[EXPIRATION_BYTE_OFFSET + i] = Number((value >> shift) & 0xffn);
  }

  return `0x${bytes.toString("hex")}`;
};

const toMessageHexWithMintRecipient = (mintRecipient: Uint8Array): string => {
  const bytes = Buffer.alloc(MESSAGE_BYTES, 0);
  Buffer.from(mintRecipient).copy(bytes, MINT_RECIPIENT_BYTE_OFFSET);
  return `0x${bytes.toString("hex")}`;
};

const toLargeMessageHexWithMintRecipient = (mintRecipient: Uint8Array): string => {
  const bytes = Buffer.alloc(LARGE_MESSAGE_BYTES, 0);
  Buffer.from(mintRecipient).copy(bytes, MINT_RECIPIENT_BYTE_OFFSET);
  return `0x${bytes.toString("hex")}`;
};

const toMessageHexWithRecipientAndCaller = (
  mintRecipient: Uint8Array,
  destinationCaller?: PublicKey
): string => {
  const bytes = Buffer.alloc(MESSAGE_BYTES, 0);
  Buffer.from(mintRecipient).copy(bytes, MINT_RECIPIENT_BYTE_OFFSET);
  if (destinationCaller) {
    Buffer.from(destinationCaller.toBytes()).copy(bytes, DESTINATION_CALLER_BYTE_OFFSET);
  }
  return `0x${bytes.toString("hex")}`;
};

const makeTokenMessengerAccountData = (feeRecipient: PublicKey): Buffer => {
  const data = Buffer.alloc(TOKEN_MESSENGER_ACCOUNT_SIZE, 0);
  TOKEN_MESSENGER_ACCOUNT_DISCRIMINATOR.copy(data, 0);
  Buffer.from(feeRecipient.toBytes()).copy(data, TOKEN_MESSENGER_FEE_RECIPIENT_OFFSET);
  return data;
};

const makeConnection = (params: {
  recipientAta: PublicKey;
  recipientAtaExists?: boolean;
  feeRecipient?: PublicKey;
  blockhashes?: string[];
  addressLookupTable?: AddressLookupTableAccount | null;
}) => {
  const feeRecipient =
    params.feeRecipient ?? Keypair.fromSeed(new Uint8Array(32).fill(9)).publicKey;
  const tokenMessengerData = makeTokenMessengerAccountData(feeRecipient);
  const blockhashes = params.blockhashes ?? ["11111111111111111111111111111111"];
  let blockhashIndex = 0;

  return {
    rpcEndpoint: `mock://${params.recipientAta.toBase58()}`,
    getAccountInfo: async (pubkey: PublicKey) => {
      if (pubkey.equals(params.recipientAta)) {
        return params.recipientAtaExists === false ? null : { data: Buffer.alloc(0) };
      }

      return {
        data: tokenMessengerData,
        owner: TOKEN_MESSENGER_PROGRAM_ID,
      };
    },
    getLatestBlockhash: async () => {
      const blockhash =
        blockhashes[Math.min(blockhashIndex, blockhashes.length - 1)];
      blockhashIndex += 1;
      return {
        blockhash,
        lastValidBlockHeight: 123 + blockhashIndex,
      };
    },
    getAddressLookupTable: async () => ({
      value: params.addressLookupTable ?? null,
    }),
  } as never;
};

const makeAddressLookupTable = () =>
  new AddressLookupTableAccount({
    key: Keypair.generate().publicKey,
    state: {
      deactivationSlot: (1n << 64n) - 1n,
      lastExtendedSlot: 0,
      lastExtendedSlotStartIndex: 0,
      authority: undefined,
      addresses: Array.from({ length: 11 }, () => Keypair.generate().publicKey),
    },
  });

const makeBlockhash = () => Keypair.generate().publicKey.toBase58();

describe("extractExpirationBlock", () => {
  it("parses a valid u64 expiration block", () => {
    const message = toMessageHex(123_456n);
    expect(extractExpirationBlock(message)).toBe(123_456);
  });

  it("caps values larger than Number.MAX_SAFE_INTEGER", () => {
    const message = toMessageHex(0xffffffffffffffffn);
    expect(extractExpirationBlock(message)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("returns 0 for too-short messages", () => {
    expect(extractExpirationBlock("0x1234")).toBe(0);
  });
});

describe("extractMintRecipientFromMessage", () => {
  it("parses the Solana mintRecipient token account from the CCTP message", () => {
    const recipientOwner = Keypair.fromSeed(new Uint8Array(32).fill(1)).publicKey;
    const recipientAta = getAssociatedTokenAddressSync(
      getSolanaUsdcMint("Solana_Devnet"),
      recipientOwner
    );

    const message = toMessageHexWithMintRecipient(recipientAta.toBytes());

    expect(extractMintRecipientFromMessage(message).toBase58()).toBe(
      recipientAta.toBase58()
    );
  });

  it("rejects messages without an embedded mintRecipient", () => {
    expect(() => extractMintRecipientFromMessage("0x1234")).toThrow(
      "missing 32-byte mintRecipient"
    );
  });
});

describe("buildReceiveMessageTransaction recipient validation", () => {
  it("allows a helper payer that does not match the locked recipient owner", async () => {
    const helperPayer = Keypair.fromSeed(new Uint8Array(32).fill(1)).publicKey;
    const lockedRecipient = Keypair.fromSeed(new Uint8Array(32).fill(2)).publicKey;
    const recipientAta = getAssociatedTokenAddressSync(
      getSolanaUsdcMint("Solana_Devnet"),
      lockedRecipient
    );

    const plan = await buildReceiveMessageTransaction({
      connection: makeConnection({ recipientAta, recipientAtaExists: true }),
      user: helperPayer,
      message: toMessageHexWithMintRecipient(recipientAta.toBytes()),
      attestation: `0x${"2".repeat(130)}`,
      sourceDomain: 0,
      destinationChainId: "Solana_Devnet",
      isTestnet: true,
      destinationAddress: lockedRecipient.toBase58(),
    });

    expect(plan.payer.toBase58()).toBe(helperPayer.toBase58());
    expect(plan.recipientOwner.toBase58()).toBe(lockedRecipient.toBase58());
    expect(plan.recipientAta.toBase58()).toBe(recipientAta.toBase58());
    expect(plan.setupTransaction).toBeUndefined();

    const mintTransaction = plan.mintTransaction as Transaction;
    const receiveMessageIx = mintTransaction.instructions.at(-1);
    expect(receiveMessageIx?.programId.toBase58()).toBe(
      MESSAGE_TRANSMITTER_PROGRAM_ID.toBase58()
    );
    expect(receiveMessageIx?.keys[0]).toEqual(
      expect.objectContaining({
        pubkey: helperPayer,
        isSigner: true,
        isWritable: true,
      })
    );
    expect(receiveMessageIx?.keys[1]).toEqual(
      expect.objectContaining({
        pubkey: helperPayer,
        isSigner: true,
      })
    );
    expect(receiveMessageIx?.keys[15]).toEqual(
      expect.objectContaining({
        pubkey: recipientAta,
        isWritable: true,
      })
    );
  });

  it("rejects a message whose mintRecipient does not match the locked recipient ATA", async () => {
    const lockedRecipient = Keypair.fromSeed(new Uint8Array(32).fill(1)).publicKey;
    const otherRecipient = Keypair.fromSeed(new Uint8Array(32).fill(2)).publicKey;
    const otherAta = getAssociatedTokenAddressSync(
      getSolanaUsdcMint("Solana_Devnet"),
      otherRecipient
    );

    await expect(
      buildReceiveMessageTransaction({
        connection: {} as never,
        user: lockedRecipient,
        message: toMessageHexWithMintRecipient(otherAta.toBytes()),
        attestation: `0x${"2".repeat(130)}`,
        sourceDomain: 0,
        destinationChainId: "Solana_Devnet",
        isTestnet: true,
        destinationAddress: lockedRecipient.toBase58(),
      })
    ).rejects.toThrow("Wrong Solana recipient");
  });

  it("creates a missing recipient ATA with the helper payer and recipient owner", async () => {
    const helperPayer = Keypair.fromSeed(new Uint8Array(32).fill(3)).publicKey;
    const lockedRecipient = Keypair.fromSeed(new Uint8Array(32).fill(4)).publicKey;
    const usdcMint = getSolanaUsdcMint("Solana_Devnet");
    const recipientAta = getAssociatedTokenAddressSync(usdcMint, lockedRecipient);

    const plan = await buildReceiveMessageTransaction({
      connection: makeConnection({ recipientAta, recipientAtaExists: false }),
      user: helperPayer,
      message: toMessageHexWithMintRecipient(recipientAta.toBytes()),
      attestation: `0x${"2".repeat(130)}`,
      sourceDomain: 0,
      destinationChainId: "Solana_Devnet",
      isTestnet: true,
      destinationAddress: lockedRecipient.toBase58(),
    });

    expect(plan.needsAtaCreation).toBe(true);
    const setupOrMint = (plan.setupTransaction ?? plan.mintTransaction) as Transaction;
    const createAtaIx = setupOrMint.instructions.find((ix) =>
      ix.keys.some((key) => key.pubkey.equals(recipientAta))
    );

    expect(createAtaIx?.keys[0]?.pubkey.toBase58()).toBe(helperPayer.toBase58());
    expect(createAtaIx?.keys[1]?.pubkey.toBase58()).toBe(recipientAta.toBase58());
    expect(createAtaIx?.keys[2]?.pubkey.toBase58()).toBe(lockedRecipient.toBase58());
    expect(createAtaIx?.keys[3]?.pubkey.toBase58()).toBe(usdcMint.toBase58());
  });

  it("derives the fee-recipient ATA for off-curve TokenMessenger fee recipients", async () => {
    const helperPayer = Keypair.fromSeed(new Uint8Array(32).fill(11)).publicKey;
    const lockedRecipient = Keypair.fromSeed(new Uint8Array(32).fill(12)).publicKey;
    const usdcMint = getSolanaUsdcMint("Solana_Devnet");
    const recipientAta = getAssociatedTokenAddressSync(usdcMint, lockedRecipient);
    const [feeRecipientPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("fee-recipient")],
      TOKEN_MESSENGER_PROGRAM_ID
    );
    const expectedFeeRecipientAta = getAssociatedTokenAddressSync(
      usdcMint,
      feeRecipientPda,
      true
    );

    const plan = await buildReceiveMessageTransaction({
      connection: makeConnection({
        recipientAta,
        recipientAtaExists: true,
        feeRecipient: feeRecipientPda,
      }),
      user: helperPayer,
      message: toMessageHexWithMintRecipient(recipientAta.toBytes()),
      attestation: `0x${"2".repeat(130)}`,
      sourceDomain: 0,
      destinationChainId: "Solana_Devnet",
      isTestnet: true,
      destinationAddress: lockedRecipient.toBase58(),
    });

    const mintTransaction = plan.mintTransaction as Transaction;
    const receiveMessageIx = mintTransaction.instructions.at(-1);
    expect(receiveMessageIx?.keys[14]).toEqual(
      expect.objectContaining({
        pubkey: expectedFeeRecipientAta,
        isWritable: true,
      })
    );
  });

  it("splits ATA setup when inline ATA creation would make the mint transaction too large", async () => {
    const helperPayer = Keypair.fromSeed(new Uint8Array(32).fill(8)).publicKey;
    const lockedRecipient = Keypair.fromSeed(new Uint8Array(32).fill(10)).publicKey;
    const usdcMint = getSolanaUsdcMint("Solana_Devnet");
    const recipientAta = getAssociatedTokenAddressSync(usdcMint, lockedRecipient);
    const initialBlockhash = makeBlockhash();
    const refreshedBlockhash = makeBlockhash();

    const plan = await buildReceiveMessageTransaction({
      connection: makeConnection({
        recipientAta,
        recipientAtaExists: false,
        blockhashes: [initialBlockhash, refreshedBlockhash],
      }),
      user: helperPayer,
      message: toLargeMessageHexWithMintRecipient(recipientAta.toBytes()),
      attestation: `0x${"2".repeat(800)}`,
      sourceDomain: 0,
      destinationChainId: "Solana_Devnet",
      isTestnet: true,
      destinationAddress: lockedRecipient.toBase58(),
    });

    expect(plan.setupTransaction).toBeInstanceOf(Transaction);

    const setupTransaction = plan.setupTransaction as Transaction;
    const mintTransaction = plan.mintTransaction as Transaction;
    expect(setupTransaction.instructions).toHaveLength(1);
    expect(setupTransaction.instructions[0].keys[1]?.pubkey.toBase58()).toBe(
      recipientAta.toBase58()
    );
    expect(mintTransaction.instructions).toHaveLength(3);
    expect(mintTransaction.instructions.at(-1)?.programId.toBase58()).toBe(
      MESSAGE_TRANSMITTER_PROGRAM_ID.toBase58()
    );
    expect(mintTransaction.recentBlockhash).toBe(initialBlockhash);

    expect(plan.refreshMintTransaction).toEqual(expect.any(Function));
    const refreshedMintTransaction =
      (await plan.refreshMintTransaction?.()) as Transaction;
    expect(refreshedMintTransaction.recentBlockhash).toBe(refreshedBlockhash);
    expect(refreshedMintTransaction.instructions).toHaveLength(3);
    expect(
      refreshedMintTransaction.instructions.some((ix) =>
        ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)
      )
    ).toBe(false);
  });

  it("refreshes ALT split mint transactions with a fresh blockhash and no ATA setup", async () => {
    const helperPayer = Keypair.fromSeed(new Uint8Array(32).fill(13)).publicKey;
    const lockedRecipient = Keypair.fromSeed(new Uint8Array(32).fill(14)).publicKey;
    const usdcMint = getSolanaUsdcMint("Solana");
    const recipientAta = getAssociatedTokenAddressSync(usdcMint, lockedRecipient);
    const initialBlockhash = makeBlockhash();
    const refreshedBlockhash = makeBlockhash();

    const plan = await buildReceiveMessageTransaction({
      connection: makeConnection({
        recipientAta,
        recipientAtaExists: false,
        blockhashes: [initialBlockhash, refreshedBlockhash],
        addressLookupTable: makeAddressLookupTable(),
      }),
      user: helperPayer,
      message: toLargeMessageHexWithMintRecipient(recipientAta.toBytes()),
      attestation: `0x${"2".repeat(800)}`,
      sourceDomain: 0,
      destinationChainId: "Solana",
      isTestnet: false,
      destinationAddress: lockedRecipient.toBase58(),
    });

    expect(plan.setupTransaction).toBeInstanceOf(Transaction);
    expect(plan.mintTransaction).toBeInstanceOf(VersionedTransaction);
    expect((plan.mintTransaction as VersionedTransaction).message.recentBlockhash).toBe(
      initialBlockhash
    );
    expect(plan.refreshMintTransaction).toEqual(expect.any(Function));

    const refreshedMintTransaction =
      (await plan.refreshMintTransaction?.()) as VersionedTransaction;
    expect(refreshedMintTransaction).toBeInstanceOf(VersionedTransaction);
    expect(refreshedMintTransaction.message.recentBlockhash).toBe(
      refreshedBlockhash
    );
    expect(refreshedMintTransaction.message.compiledInstructions).toHaveLength(3);
  });

  it("rejects helper claims when the message restricts destinationCaller", async () => {
    const helperPayer = Keypair.fromSeed(new Uint8Array(32).fill(5)).publicKey;
    const lockedRecipient = Keypair.fromSeed(new Uint8Array(32).fill(6)).publicKey;
    const restrictedCaller = Keypair.fromSeed(new Uint8Array(32).fill(7)).publicKey;
    const recipientAta = getAssociatedTokenAddressSync(
      getSolanaUsdcMint("Solana_Devnet"),
      lockedRecipient
    );

    await expect(
      buildReceiveMessageTransaction({
        connection: {} as never,
        user: helperPayer,
        message: toMessageHexWithRecipientAndCaller(
          recipientAta.toBytes(),
          restrictedCaller
        ),
        attestation: `0x${"2".repeat(130)}`,
        sourceDomain: 0,
        destinationChainId: "Solana_Devnet",
        isTestnet: true,
        destinationAddress: lockedRecipient.toBase58(),
      })
    ).rejects.toThrow("Wrong Solana caller");
  });
});
