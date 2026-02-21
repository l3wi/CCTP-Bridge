import { beforeEach, describe, expect, it, vi } from "vitest";

const getMessageTransmitterAddressMock = vi.hoisted(() => vi.fn());
const getCctpDomainSafeMock = vi.hoisted(() => vi.fn());
const createEvmPublicClientMock = vi.hoisted(() => vi.fn());
const createSolanaConnectionMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/contracts", () => ({
  getMessageTransmitterAddress: getMessageTransmitterAddressMock,
  MESSAGE_TRANSMITTER_ABI: [],
}));

vi.mock("@/lib/cctp/shared", () => ({
  getCctpDomainSafe: getCctpDomainSafeMock,
}));

vi.mock("@/lib/rpc/clients", () => ({
  createEvmPublicClient: createEvmPublicClientMock,
  createSolanaConnection: createSolanaConnectionMock,
}));

import {
  checkSolanaMintStatus,
  extractDestinationDomainFromMessage,
  simulateMint,
} from "@/lib/simulation";

const HEADER_BYTES = 148;
const DEST_DOMAIN_OFFSET = 8;
const EXPIRATION_FIELD_INDEX = 196;
const U64_OFFSET = 24;

const buildMessage = ({
  destinationDomain,
  expirationSlot,
}: {
  destinationDomain: number;
  expirationSlot?: bigint;
}): `0x${string}` => {
  const totalBytes =
    expirationSlot === undefined
      ? HEADER_BYTES
      : HEADER_BYTES + EXPIRATION_FIELD_INDEX + 32;
  const bytes = Buffer.alloc(totalBytes, 0);

  bytes.writeUInt32BE(destinationDomain >>> 0, DEST_DOMAIN_OFFSET);

  if (expirationSlot !== undefined) {
    const offset = HEADER_BYTES + EXPIRATION_FIELD_INDEX + U64_OFFSET;
    for (let i = 0; i < 8; i += 1) {
      const shift = BigInt((7 - i) * 8);
      bytes[offset + i] = Number((expirationSlot >> shift) & 0xffn);
    }
  }

  return `0x${bytes.toString("hex")}`;
};

beforeEach(() => {
  vi.clearAllMocks();
  getMessageTransmitterAddressMock.mockReturnValue(
    "0x1111111111111111111111111111111111111111"
  );
  getCctpDomainSafeMock.mockReturnValue(3);
  createEvmPublicClientMock.mockReturnValue({
    readContract: vi.fn(),
    simulateContract: vi.fn(),
  });
});

describe("simulation helpers", () => {
  it("extracts destination domain from the CCTP message header", () => {
    const message = buildMessage({ destinationDomain: 6 });
    expect(extractDestinationDomainFromMessage(message)).toBe(6);
  });

  it("returns a clear error when message destination domain mismatches target chain", async () => {
    const message = buildMessage({ destinationDomain: 6 });

    const result = await simulateMint(42161, message, "0x1234");

    expect(result.success).toBe(false);
    expect(result.canMint).toBe(false);
    expect(result.alreadyMinted).toBe(false);
    expect(result.error).toContain("Destination chain mismatch");
    expect(createEvmPublicClientMock).not.toHaveBeenCalled();
  });

  it("marks Solana mint status as expired when expiration slot has passed", async () => {
    const message = buildMessage({ destinationDomain: 5, expirationSlot: 400n });

    createSolanaConnectionMock.mockReturnValue({
      getSlot: vi.fn().mockResolvedValue(450),
    });

    const result = await checkSolanaMintStatus(1, "Solana", {
      nonce: "1",
      attestation: "0x1234",
      message,
      mintRecipient: "11111111111111111111111111111111",
    });

    expect(createSolanaConnectionMock).toHaveBeenCalledWith("Solana", "confirmed");
    expect(result.success).toBe(false);
    expect(result.canMint).toBe(false);
    expect(result.messageExpired).toBe(true);
    expect(result.error).toContain("Message expired");
  });
});
