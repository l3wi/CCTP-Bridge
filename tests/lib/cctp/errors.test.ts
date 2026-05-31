import { describe, expect, it } from "vitest";
import { getErrorCode, getErrorMessage } from "@/lib/cctp/errors";

describe("CCTP shared error handling", () => {
  it("maps Circle user rejection categories without string matching", () => {
    const error = {
      errorCategory: "user_rejected",
      errorMessage: "User rejected the request",
    };

    expect(getErrorCode(error)).toBe("USER_REJECTED");
    expect(getErrorMessage(error)).toBe("Transaction was cancelled by user");
  });

  it("maps Circle atomic capability categories to step-by-step guidance", () => {
    const error = {
      errorCategory: "atomic_unsupported",
      errorMessage: "Atomic batch unsupported",
    };

    expect(getErrorCode(error)).toBe("WALLET_CAPABILITY_UNSUPPORTED");
    expect(getErrorMessage(error)).toContain("step-by-step");
  });

  it("maps Circle on-chain revert categories to contract errors", () => {
    const error = {
      errorCategory: "chain_revert",
      errorMessage: "Call reverted",
    };

    expect(getErrorCode(error)).toBe("CONTRACT_ERROR");
    expect(getErrorMessage(error)).toBe("Transaction reverted on-chain");
  });
});
