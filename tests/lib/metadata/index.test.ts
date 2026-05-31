import { describe, expect, it } from "vitest";
import {
  getAllSupportedChains,
  getChainIdFromDomainUniversal,
  getUsdcAddressByDomain,
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

  it("resolves USDC address from CCTP domain for EVM chains", () => {
    expect(getUsdcAddressByDomain(0, "mainnet")).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  it("returns both evm and solana chain entries for an environment", () => {
    const chains = getAllSupportedChains("mainnet");
    expect(chains.some((chain) => chain.type === "evm")).toBe(true);
    expect(chains.some((chain) => chain.type === "solana")).toBe(true);
  });

  it("includes latest Circle-supported mainnet and testnet chains", () => {
    const mainnetChains = getAllSupportedChains("mainnet");
    const testnetChains = getAllSupportedChains("testnet");

    expect(mainnetChains.some((chain) => chain.type === "evm" && chain.chainId === 1672)).toBe(true);
    expect(mainnetChains.some((chain) => chain.type === "evm" && chain.chainId === 1776)).toBe(true);
    expect(testnetChains.some((chain) => chain.type === "evm" && chain.chainId === 688689)).toBe(true);
    expect(testnetChains.some((chain) => chain.type === "evm" && chain.chainId === 1439)).toBe(true);
  });

  it("preserves Circle BridgeKit bridge contracts for custom fee routing", () => {
    const ethereum = resolveBridgeChain(1, "mainnet");

    expect(ethereum.kitContracts?.bridge).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });
});
