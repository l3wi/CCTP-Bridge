import { describe, expect, it } from "vitest";
import { getAllSupportedChains } from "@/lib/bridgeConfig";
import { getBridgeRouteSegment } from "@/lib/bridgeRoute";
import {
  buildPendingTransactionRedirect,
  parsePendingTransactionPrefill,
} from "@/lib/pendingTransactionRoute";
import type { ChainId } from "@/lib/types";

const getFirstSupportedChainId = (): ChainId => {
  const chain = getAllSupportedChains()[0];
  if (!chain) {
    throw new Error("Expected at least one supported chain");
  }

  if (chain.type === "evm") {
    return chain.chainId;
  }

  return chain.chain;
};

describe("pendingTransactionRoute", () => {
  it("parses source/hash/error prefill from query params", () => {
    const chainId = getFirstSupportedChainId();
    const sourceId = getBridgeRouteSegment(chainId);
    const params = new URLSearchParams({
      id: sourceId,
      hash: "0xabc",
      error: "Invalid transaction",
    });

    expect(parsePendingTransactionPrefill(params)).toEqual({
      sourceChainId: chainId,
      txHash: "0xabc",
      error: "Invalid transaction",
    });
  });

  it("ignores blank prefill fields", () => {
    const params = new URLSearchParams({
      id: "   ",
      hash: "",
      error: "\n",
    });

    expect(parsePendingTransactionPrefill(params)).toEqual({
      sourceChainId: null,
      txHash: "",
      error: null,
    });
  });

  it("builds /bridge redirect query using explicit source segment", () => {
    const path = buildPendingTransactionRedirect({
      sourceParam: "0",
      idParam: "0xdeadbeef",
      error: "Could not recover transaction",
    });

    expect(path.startsWith("/bridge?")).toBe(true);

    const [, query] = path.split("?");
    const params = new URLSearchParams(query);

    expect(params.get("id")).toBe("0");
    expect(params.get("hash")).toBe("0xdeadbeef");
    expect(params.get("error")).toBe("Could not recover transaction");
  });

  it("falls back to canonical source segment from chain id", () => {
    const chainId = getFirstSupportedChainId();
    const expectedSource = getBridgeRouteSegment(chainId);

    const path = buildPendingTransactionRedirect({
      sourceChainId: chainId,
      idParam: "12345",
      error: "Invalid route",
    });

    const [, query] = path.split("?");
    const params = new URLSearchParams(query);

    expect(params.get("id")).toBe(expectedSource);
    expect(params.get("hash")).toBe("12345");
    expect(params.get("error")).toBe("Invalid route");
  });

  it("omits hash prefill when redirect has no transaction hash", () => {
    const chainId = getFirstSupportedChainId();

    const path = buildPendingTransactionRedirect({
      sourceChainId: chainId,
      idParam: "",
      error: "Paste the source burn transaction hash.",
    });

    const [, query] = path.split("?");
    const params = new URLSearchParams(query);

    expect(params.get("id")).toBe(getBridgeRouteSegment(chainId));
    expect(params.get("hash")).toBeNull();
    expect(params.get("error")).toBe("Paste the source burn transaction hash.");
  });
});
