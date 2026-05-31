import { PublicKey } from "@solana/web3.js";
import { getUsdcAddressByDomain, type BridgeEnvironment } from "../../bridgeConfig";

/** CCTP v2 MessageTransmitter Program ID (same for mainnet and devnet) */
export const MESSAGE_TRANSMITTER_PROGRAM_ID = new PublicKey(
  "CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC"
);

/** CCTP v2 TokenMessenger Program ID (same for mainnet and devnet) */
export const TOKEN_MESSENGER_PROGRAM_ID = new PublicKey(
  "CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe"
);

export interface MintPdas {
  tokenMessengerPda: PublicKey;
  messageTransmitterPda: PublicKey;
  tokenMinterPda: PublicKey;
  localTokenPda: PublicKey;
  remoteTokenMessengerPda: PublicKey;
  tokenPairPda: PublicKey;
  custodyPda: PublicKey;
  messageTransmitterAuthorityPda: PublicKey;
  tokenMessengerEventAuthorityPda: PublicKey;
  messageTransmitterEventAuthorityPda: PublicKey;
}

function getSourceUsdcAddress(
  sourceDomain: number,
  isTestnet: boolean
): string | null {
  const env: BridgeEnvironment = isTestnet ? "testnet" : "mainnet";
  return getUsdcAddressByDomain(sourceDomain, env) ?? null;
}

function evmAddressToSolanaPubkey(evmAddress: string): PublicKey {
  const cleanAddress = evmAddress.toLowerCase().replace("0x", "");
  const padded = cleanAddress.padStart(64, "0");
  return new PublicKey(Buffer.from(padded, "hex"));
}

export function getSourceUsdcPubkey(
  sourceDomain: number,
  isTestnet: boolean
): PublicKey {
  const address = getSourceUsdcAddress(sourceDomain, isTestnet);
  if (!address) {
    throw new Error(
      `Unknown source USDC address for domain ${sourceDomain}. ` +
      `This chain may not be supported by Bridge Kit SDK yet.`
    );
  }
  return evmAddressToSolanaPubkey(address);
}

/**
 * Derive all required PDAs for CCTP receiveMessage.
 * Matches the derivePdas function from adapter-solana.
 */
export function deriveMintPdas(
  sourceDomain: number,
  sourceUsdcPubkey: PublicKey,
  destinationUsdcMint: PublicKey
): MintPdas {
  const [tokenMessengerPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_messenger")],
    TOKEN_MESSENGER_PROGRAM_ID
  );

  const [messageTransmitterPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("message_transmitter")],
    MESSAGE_TRANSMITTER_PROGRAM_ID
  );

  const [tokenMinterPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_minter")],
    TOKEN_MESSENGER_PROGRAM_ID
  );

  const [localTokenPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("local_token"), destinationUsdcMint.toBuffer()],
    TOKEN_MESSENGER_PROGRAM_ID
  );

  const domainSeed = Buffer.from(sourceDomain.toString(), "utf8");

  const [remoteTokenMessengerPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("remote_token_messenger"), domainSeed],
    TOKEN_MESSENGER_PROGRAM_ID
  );

  const [tokenPairPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_pair"), domainSeed, sourceUsdcPubkey.toBuffer()],
    TOKEN_MESSENGER_PROGRAM_ID
  );

  const [custodyPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("custody"), destinationUsdcMint.toBuffer()],
    TOKEN_MESSENGER_PROGRAM_ID
  );

  const [messageTransmitterAuthorityPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("message_transmitter_authority"),
      TOKEN_MESSENGER_PROGRAM_ID.toBuffer(),
    ],
    MESSAGE_TRANSMITTER_PROGRAM_ID
  );

  const [tokenMessengerEventAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    TOKEN_MESSENGER_PROGRAM_ID
  );

  const [messageTransmitterEventAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("__event_authority")],
    MESSAGE_TRANSMITTER_PROGRAM_ID
  );

  return {
    tokenMessengerPda,
    messageTransmitterPda,
    tokenMinterPda,
    localTokenPda,
    remoteTokenMessengerPda,
    tokenPairPda,
    custodyPda,
    messageTransmitterAuthorityPda,
    tokenMessengerEventAuthorityPda,
    messageTransmitterEventAuthorityPda,
  };
}

/**
 * Derive the usedNonce PDA from eventNonce.
 * eventNonce is a 64-char hex string (32 bytes) from the attestation.
 */
export function deriveUsedNoncePda(eventNonce: string): PublicKey {
  const nonceHex = eventNonce.replace(/^0x/, "");
  if (nonceHex.length !== 64) {
    throw new Error(
      `Invalid eventNonce: expected 64 hex chars, got ${nonceHex.length}`
    );
  }
  const nonceBuf = Buffer.from(nonceHex, "hex");

  const [usedNoncePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("used_nonce"), nonceBuf],
    MESSAGE_TRANSMITTER_PROGRAM_ID
  );

  return usedNoncePda;
}
