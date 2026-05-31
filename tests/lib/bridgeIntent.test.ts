import { describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";

import {
  parseBridgeIntent,
  parseBridgeIntentResult,
  serializeBridgeIntent,
  type BridgeIntent,
} from "@/lib/bridgeIntent";
import { getAllSupportedChains, getSupportedEvmChains } from "@/lib/bridgeConfig";
import type { SolanaChainId } from "@/lib/types";

const getEvmChainPair = (): [number, number] => {
  const evmChains = getSupportedEvmChains();
  if (evmChains.length < 2) {
    throw new Error("Expected at least two supported EVM chains for bridge intent tests");
  }

  return [evmChains[0].chainId, evmChains[1].chainId];
};

const getFirstSupportedSolanaChain = (): SolanaChainId | null => {
  const solanaChain = getAllSupportedChains().find((chain) => chain.type === "solana");
  if (!solanaChain || solanaChain.type !== "solana") {
    return null;
  }

  const chainId = solanaChain.chain;
  if (chainId === "Solana" || chainId === "Solana_Devnet") {
    return chainId;
  }

  return null;
};

describe("parseBridgeIntent", () => {
  it("parses a valid EVM target address", () => {
    const [sourceChainId, targetChainId] = getEvmChainPair();
    const intent: BridgeIntent = {
      sourceChainId,
      targetChainId,
      amount: "12.3456",
      targetAddress: "0x1111111111111111111111111111111111111111",
      transferType: "standard",
    };

    const parsed = parseBridgeIntent(serializeBridgeIntent(intent));
    expect(parsed).toEqual(intent);
  });

  it("rejects an invalid EVM target address", () => {
    const [sourceChainId, targetChainId] = getEvmChainPair();
    const intent: BridgeIntent = {
      sourceChainId,
      targetChainId,
      amount: "1",
      targetAddress: "notanaddress",
      transferType: "fast",
    };

    const parsed = parseBridgeIntent(serializeBridgeIntent(intent));
    expect(parsed).toBeNull();
  });

  it("rejects an invalid Solana target address", () => {
    const solanaChain = getFirstSupportedSolanaChain();
    if (!solanaChain) {
      return;
    }

    const evmChains = getSupportedEvmChains();
    if (evmChains.length === 0) {
      throw new Error("Expected at least one supported EVM chain for bridge intent tests");
    }

    const intent: BridgeIntent = {
      sourceChainId: evmChains[0].chainId,
      targetChainId: solanaChain,
      amount: "10",
      targetAddress: "not-a-solana-address",
      transferType: "standard",
    };

    const parsed = parseBridgeIntent(serializeBridgeIntent(intent));
    expect(parsed).toBeNull();
  });

  it("parses a valid Solana target address", () => {
    const solanaChain = getFirstSupportedSolanaChain();
    if (!solanaChain) {
      return;
    }

    const evmChains = getSupportedEvmChains();
    if (evmChains.length === 0) {
      throw new Error("Expected at least one supported EVM chain for bridge intent tests");
    }

    const intent: BridgeIntent = {
      sourceChainId: evmChains[0].chainId,
      targetChainId: solanaChain,
      amount: "10",
      targetAddress: Keypair.generate().publicKey.toBase58(),
      transferType: "fast",
    };

    const parsed = parseBridgeIntent(serializeBridgeIntent(intent));
    expect(parsed).toEqual(intent);
  });

  it("returns a structured reason for unsupported source domains", () => {
    const [_, targetChainId] = getEvmChainPair();
    const params = new URLSearchParams({
      sourceDomain: "999999",
      target: String(targetChainId),
      amount: "1",
      targetAddress: "0x1111111111111111111111111111111111111111",
      transferType: "fast",
    });

    const parsed = parseBridgeIntentResult(params);
    expect(parsed).toEqual({
      ok: false,
      reason: "unsupported_source_domain",
    });
  });

  it("returns a structured reason for invalid amount", () => {
    const [sourceChainId, targetChainId] = getEvmChainPair();
    const params = new URLSearchParams({
      source: String(sourceChainId),
      target: String(targetChainId),
      amount: "abc",
      targetAddress: "0x1111111111111111111111111111111111111111",
      transferType: "fast",
    });

    const parsed = parseBridgeIntentResult(params);
    expect(parsed).toEqual({
      ok: false,
      reason: "invalid_amount",
    });
  });
});
