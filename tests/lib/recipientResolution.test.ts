import { describe, expect, it } from "vitest";
import {
  resolveRecipientForSend,
  resolveRecipientForBridgingState,
} from "@/lib/recipientResolution";

describe("resolveRecipientForSend", () => {
  it("prefers connected target wallet for cross-ecosystem transfers", () => {
    const result = resolveRecipientForSend({
      isCrossEcosystem: true,
      diffWallet: true,
      crossEcosystemTargetAddress: "0x1111111111111111111111111111111111111111",
      validationTargetAddress: "0x2222222222222222222222222222222222222222",
      targetAddress: "0x3333333333333333333333333333333333333333",
      senderAddress: "8WLbPDgtMevhYGZtCsGJirdpsVHxq7QsAZLDipNg7Wtw",
    });

    expect(result.finalTargetAddress).toBe(
      "0x1111111111111111111111111111111111111111"
    );
    expect(result.displayedRecipient).toBe(
      "0x1111111111111111111111111111111111111111"
    );
    expect(result.recipientResolution).toBe("connected_target_wallet");
  });

  it("ignores stale manual address when connected cross-ecosystem wallet exists", () => {
    const result = resolveRecipientForSend({
      isCrossEcosystem: true,
      diffWallet: true,
      crossEcosystemTargetAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      validationTargetAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      targetAddress: "0xcccccccccccccccccccccccccccccccccccccccc",
      senderAddress: "8WLbPDgtMevhYGZtCsGJirdpsVHxq7QsAZLDipNg7Wtw",
    });

    expect(result.finalTargetAddress).toBe(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    );
    expect(result.recipientResolution).toBe("connected_target_wallet");
  });

  it("uses manual/validated address for cross-ecosystem transfers when no target wallet is connected", () => {
    const result = resolveRecipientForSend({
      isCrossEcosystem: true,
      diffWallet: true,
      validationTargetAddress: "0x4444444444444444444444444444444444444444",
      targetAddress: "0x5555555555555555555555555555555555555555",
      senderAddress: "8WLbPDgtMevhYGZtCsGJirdpsVHxq7QsAZLDipNg7Wtw",
    });

    expect(result.finalTargetAddress).toBe(
      "0x4444444444444444444444444444444444444444"
    );
    expect(result.displayedRecipient).toBe(
      "0x5555555555555555555555555555555555555555"
    );
    expect(result.recipientResolution).toBe("manual_input");
  });

  it("returns undefined final recipient when cross-ecosystem recipient is missing", () => {
    const result = resolveRecipientForSend({
      isCrossEcosystem: true,
      diffWallet: true,
      senderAddress: "8WLbPDgtMevhYGZtCsGJirdpsVHxq7QsAZLDipNg7Wtw",
    });

    expect(result.finalTargetAddress).toBeUndefined();
    expect(result.recipientResolution).toBe("manual_input");
  });

  it("uses sender for same-ecosystem default recipient flow", () => {
    const result = resolveRecipientForSend({
      isCrossEcosystem: false,
      diffWallet: false,
      senderAddress: "0x6666666666666666666666666666666666666666",
      defaultTargetWalletAddress: "0x7777777777777777777777777777777777777777",
    });

    expect(result.finalTargetAddress).toBe(
      "0x6666666666666666666666666666666666666666"
    );
    expect(result.displayedRecipient).toBe(
      "0x7777777777777777777777777777777777777777"
    );
    expect(result.recipientResolution).toBe("source_wallet_default");
  });

  it("uses manual target for same-ecosystem diff wallet flow", () => {
    const result = resolveRecipientForSend({
      isCrossEcosystem: false,
      diffWallet: true,
      targetAddress: "0x8888888888888888888888888888888888888888",
      validationTargetAddress: "0x9999999999999999999999999999999999999999",
      senderAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });

    expect(result.finalTargetAddress).toBe(
      "0x9999999999999999999999999999999999999999"
    );
    expect(result.displayedRecipient).toBe(
      "0x8888888888888888888888888888888888888888"
    );
    expect(result.recipientResolution).toBe("manual_input");
  });

  it("normalizes whitespace-only addresses to undefined", () => {
    const result = resolveRecipientForSend({
      isCrossEcosystem: true,
      diffWallet: true,
      crossEcosystemTargetAddress: "   ",
      validationTargetAddress: " \t ",
      targetAddress: "\n",
      senderAddress: "8WLbPDgtMevhYGZtCsGJirdpsVHxq7QsAZLDipNg7Wtw",
    });

    expect(result.finalTargetAddress).toBeUndefined();
    expect(result.displayedRecipient).toBeUndefined();
  });

  it("trims surrounding whitespace for valid addresses", () => {
    const result = resolveRecipientForSend({
      isCrossEcosystem: false,
      diffWallet: true,
      validationTargetAddress: "  0xabcabcabcabcabcabcabcabcabcabcabcabcabca  ",
    });

    expect(result.finalTargetAddress).toBe(
      "0xabcabcabcabcabcabcabcabcabcabcabcabcabca"
    );
  });
});

describe("resolveRecipientForBridgingState", () => {
  it("keeps locked recipient stable after connected wallet changes", () => {
    const locked = resolveRecipientForSend({
      isCrossEcosystem: true,
      diffWallet: true,
      crossEcosystemTargetAddress: "0x1212121212121212121212121212121212121212",
      senderAddress: "8WLbPDgtMevhYGZtCsGJirdpsVHxq7QsAZLDipNg7Wtw",
    }).finalTargetAddress;

    const result = resolveRecipientForBridgingState({
      submittedRecipientAddress: locked,
      diffWallet: false,
      // Simulate wallet account swap after submit
      defaultTargetWalletAddress: "0x3434343434343434343434343434343434343434",
      validationTargetAddress: "0x5656565656565656565656565656565656565656",
    });

    expect(result).toBe("0x1212121212121212121212121212121212121212");
  });

  it("keeps submitted recipient locked even if wallet/default changes later", () => {
    const result = resolveRecipientForBridgingState({
      submittedRecipientAddress: "0x1234123412341234123412341234123412341234",
      diffWallet: false,
      defaultTargetWalletAddress: "0x9999999999999999999999999999999999999999",
    });

    expect(result).toBe("0x1234123412341234123412341234123412341234");
  });

  it("falls back to manual validated recipient when no submitted lock exists", () => {
    const result = resolveRecipientForBridgingState({
      diffWallet: true,
      validationTargetAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      defaultTargetWalletAddress: "0x9999999999999999999999999999999999999999",
    });

    expect(result).toBe("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
  });

  it("falls back to default target wallet when not using manual recipient", () => {
    const result = resolveRecipientForBridgingState({
      diffWallet: false,
      defaultTargetWalletAddress: "0xdddddddddddddddddddddddddddddddddddddddd",
    });

    expect(result).toBe("0xdddddddddddddddddddddddddddddddddddddddd");
  });

  it("returns undefined when no recipient sources exist", () => {
    const result = resolveRecipientForBridgingState({
      diffWallet: false,
    });

    expect(result).toBeUndefined();
  });

  it("normalizes submitted recipient whitespace", () => {
    const result = resolveRecipientForBridgingState({
      submittedRecipientAddress: "  0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee  ",
      diffWallet: true,
      validationTargetAddress: "0xffffffffffffffffffffffffffffffffffffffff",
    });

    expect(result).toBe("0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
  });
});
