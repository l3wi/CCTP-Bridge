import { describe, expect, it } from "vitest";
import {
  getAllSupportedChains,
  getChainIdFromDomainUniversal,
  resolveBridgeChain,
} from "@/lib/metadata/index";

describe("metadata index", () => {
  it("resolves Ethereum mainnet chain metadata", () => {
    const ethereum = resolveBridgeChain(1, "mainnet");
    expect(ethereum.chainId).toBe(1);
    expect(ethereum.type).toBe("evm");
    expect(ethereum.cctp?.domain).toBeTypeOf("number");
  });

  it("maps known domain IDs back to chain IDs", () => {
    expect(getChainIdFromDomainUniversal(0, "mainnet")).toBe(1);
  });

  it("returns both evm and solana chain entries for an environment", () => {
    const chains = getAllSupportedChains("mainnet");
    expect(chains.some((chain) => chain.type === "evm")).toBe(true);
    expect(chains.some((chain) => chain.type === "solana")).toBe(true);
  });
});
