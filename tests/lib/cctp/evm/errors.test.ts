import { describe, expect, it } from "vitest";
import { parseEvmCctpError } from "@/lib/cctp/evm/errors";

describe("evm CCTP errors", () => {
  it("flags message-expired revert reasons for re-attestation", () => {
    const parsed = parseEvmCctpError(
      new Error("execution reverted: message expired and must be re-signed")
    );

    expect(parsed.info?.title).toBe("Attestation expired");
    expect(parsed.info?.isExpired).toBe(true);
  });

  it("detects already-claimed nonce errors", () => {
    const parsed = parseEvmCctpError(new Error("nonce already used"));

    expect(parsed.info?.title).toBe("Already claimed");
    expect(parsed.info?.isAlreadyClaimed).toBe(true);
  });
});
