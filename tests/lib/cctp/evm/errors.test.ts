import { describe, expect, it } from "vitest";
import { parseEvmCctpError } from "@/lib/cctp/evm/errors";

describe("evm CCTP errors", () => {
  it("flags message-expired revert reasons for re-attestation", () => {
    const parsed = parseEvmCctpError(
      new Error("execution reverted: message expired and must be re-signed")
    );

    expect(parsed.info?.title).toBe("Attestation expired");
    expect(parsed.info?.isExpired).toBe(true);
    expect(parsed.info?.needsReattestation).toBe(true);
  });

  it("does not auto-trigger re-attestation for fee-cap errors", () => {
    const parsed = parseEvmCctpError(new Error("execution reverted: fee exceeds max fee"));

    expect(parsed.info?.title).toBe("Fee too high");
    expect(parsed.info?.needsReattestation).toBeUndefined();
  });

  it("detects already-claimed nonce errors", () => {
    const parsed = parseEvmCctpError(new Error("nonce already used"));

    expect(parsed.info?.title).toBe("Already claimed");
    expect(parsed.info?.isAlreadyClaimed).toBe(true);
  });
});
