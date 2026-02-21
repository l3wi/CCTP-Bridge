import { describe, expect, it } from "vitest";
import { extractExpirationBlock } from "@/lib/cctp/solana/mint";

const HEADER_BYTES = 148;
const EXPIRATION_FIELD_INDEX = 196;
const U64_OFFSET = 24;
const MESSAGE_BYTES = HEADER_BYTES + EXPIRATION_FIELD_INDEX + 32;
const EXPIRATION_BYTE_OFFSET = HEADER_BYTES + EXPIRATION_FIELD_INDEX + U64_OFFSET;

const toMessageHex = (expiration: bigint): string => {
  const bytes = Buffer.alloc(MESSAGE_BYTES, 0);
  const value = expiration & ((1n << 64n) - 1n);

  for (let i = 0; i < 8; i += 1) {
    const shift = BigInt((7 - i) * 8);
    bytes[EXPIRATION_BYTE_OFFSET + i] = Number((value >> shift) & 0xffn);
  }

  return `0x${bytes.toString("hex")}`;
};

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
