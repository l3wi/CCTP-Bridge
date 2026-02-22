import { describe, expect, it } from "vitest";
import { extractCctpErrorCode, parseSolanaCctpError } from "@/lib/cctp/solana/errors";

describe("solana CCTP errors", () => {
  it("zero-pads decimal custom codes before lookup", () => {
    expect(extractCctpErrorCode('{"Custom": 255}')).toBe("00ff");
  });

  it("maps known expiry codes to structured error info", () => {
    const parsed = parseSolanaCctpError(new Error("custom program error: 0x1780"));

    expect(parsed.code).toBe("1780");
    expect(parsed.info?.title).toBe("Attestation expired");
    expect(parsed.info?.isExpired).toBe(true);
  });
});
