import { describe, expect, it } from "vitest";
import { toChainDefinition } from "@/lib/chainDefinition";

describe("toChainDefinition", () => {
  it("maps Bridge Kit forwarder and token metadata onto EVM chain definitions", () => {
    const chain = toChainDefinition({
      type: "evm",
      chain: "Base",
      chainId: 8453,
      name: "Base",
      isTestnet: false,
      explorerUrl: "https://basescan.org/tx/{hash}",
      rpcEndpoints: ["https://mainnet.base.org"],
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      eurcAddress: "0xeurc",
      usdcAddress: "0xusdc",
      usdtAddress: "0xusdt",
      cctp: {
        domain: 6,
        contracts: {
          v2: {
            type: "split",
            tokenMessenger: "0xtokenMessenger",
            messageTransmitter: "0xmessageTransmitter",
            confirmations: 12,
            fastConfirmations: 2,
          },
        },
        forwarderSupported: {
          source: true,
          destination: false,
        },
      },
    });

    expect(chain).toMatchObject({
      type: "evm",
      chainId: 8453,
      usdtAddress: "0xusdt",
      cctp: {
        domain: 6,
        forwarderSupported: {
          source: true,
          destination: false,
        },
      },
    });
  });

  it("defaults missing forwarder and usdt metadata for Solana chain definitions", () => {
    const chain = toChainDefinition({
      type: "solana",
      chain: "Solana",
      name: "Solana",
      isTestnet: false,
      explorerUrl: "https://explorer.solana.com/tx/{hash}",
      rpcEndpoints: ["https://api.mainnet-beta.solana.com"],
      nativeCurrency: { name: "Solana", symbol: "SOL", decimals: 9 },
      usdcAddress: "EPjFWdd5AufqSSqeM2q...",
      cctp: {
        domain: 5,
        contracts: {
          v1: {
            type: "merged",
            contract: "cctp-program",
            confirmations: 1,
          },
        },
      },
    });

    expect(chain).toMatchObject({
      type: "solana",
      usdtAddress: null,
      cctp: {
        domain: 5,
        forwarderSupported: {
          source: false,
          destination: false,
        },
      },
    });
  });
});
