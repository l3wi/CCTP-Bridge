import { describe, expect, it } from "vitest";
import {
  getConfiguredEvmRpcUrls,
  getConfiguredSolanaRpcUrls,
} from "@/lib/rpc/config";

describe("rpc config", () => {
  it("exposes generated EVM RPC URLs for Ethereum", () => {
    const urls = getConfiguredEvmRpcUrls(1);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((url) => url.startsWith("http"))).toBe(true);
  });

  it("exposes Solana RPC URLs", () => {
    const mainnet = getConfiguredSolanaRpcUrls("Solana");
    const devnet = getConfiguredSolanaRpcUrls("Solana_Devnet");
    expect(mainnet.length).toBeGreaterThan(0);
    expect(devnet.length).toBeGreaterThan(0);
  });
});
