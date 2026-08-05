import { describe, expect, it } from "vitest";
import {
  VERCEL_CUSTOM_PROPERTY_LIMIT,
  buildBridgeBurnEventPayload,
  parseBridgeBurnEventMetadata,
} from "@/lib/analytics/bridgeBurnEvent";

describe("bridge burn event payloads", () => {
  it("compacts fast EVM burns into two Vercel-safe properties", () => {
    const payload = buildBridgeBurnEventPayload({
      burnHash: `0x${"A".repeat(64)}`,
      sourceChainId: 42161,
      targetChainId: 8453,
      fromAddress: `0x${"1".repeat(40)}`,
      toAddress: `0x${"2".repeat(40)}`,
      amount: "1000.000000",
      transferType: "fast",
      appFastFee: "0.500000",
      circleFastFee: "0.120000",
    });

    expect(payload).toEqual({
      id: `42161:0x${"a".repeat(64)}`,
      m: "v1,1000.000000,42161,8453,f,0.500000,0.120000",
    });
    expect(payload.id.length).toBeLessThanOrEqual(VERCEL_CUSTOM_PROPERTY_LIMIT);
    expect(payload.m.length).toBeLessThanOrEqual(VERCEL_CUSTOM_PROPERTY_LIMIT);
    expect(parseBridgeBurnEventMetadata(payload.m)).toEqual({
      version: "v1",
      amount: "1000.000000",
      sourceChainId: "42161",
      targetChainId: "8453",
      speed: "f",
      appFastFee: "0.500000",
      circleFastFee: "0.120000",
    });
  });

  it("compacts standard Solana burns with zero fees", () => {
    const solanaSignature = "1".repeat(88);

    const payload = buildBridgeBurnEventPayload({
      burnHash: solanaSignature,
      sourceChainId: "Solana",
      targetChainId: 1,
      fromAddress: "1".repeat(32),
      toAddress: "2".repeat(32),
      amount: "25.5",
      transferType: "standard",
    });

    expect(payload).toEqual({
      id: `Solana:${solanaSignature}`,
      m: "v1,25.5,Solana,1,s,0,0",
    });
  });

  it("rejects invalid values", () => {
    expect(() =>
      buildBridgeBurnEventPayload({
        burnHash: "0xabc",
        sourceChainId: 1,
        targetChainId: 8453,
        fromAddress: `0x${"1".repeat(40)}`,
        toAddress: `0x${"2".repeat(40)}`,
        amount: "1.00",
        transferType: "fast",
      })
    ).toThrow("Invalid EVM burn hash");

    expect(() =>
      buildBridgeBurnEventPayload({
        burnHash: `0x${"a".repeat(64)}`,
        sourceChainId: 1,
        targetChainId: 8453,
        fromAddress: `0x${"1".repeat(40)}`,
        toAddress: `0x${"2".repeat(40)}`,
        amount: "1.0000001",
        transferType: "fast",
      })
    ).toThrow("Invalid decimal USDC value");
  });
});
