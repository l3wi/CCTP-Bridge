import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData } from "viem";
import {
  BRIDGE_WITH_PREAPPROVAL_ABI,
  buildBridgeWithPreapprovalData,
  prepareEvmBurn,
} from "@/lib/cctp/evm/burn";

const VALID_EVM_RECIPIENT = "0x1111111111111111111111111111111111111111";
const VALID_SOLANA_RECIPIENT = "11111111111111111111111111111111";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("EVM burn fee support", () => {
  it("encodes bridgeWithPreapproval with app fee separate from Circle maxFee", () => {
    const data = buildBridgeWithPreapprovalData(
      "0xB3FA262d0fB521cc93bE83d87b322b8A23DAf3F0",
      {
        amount: 1_000_000n,
        maxFee: 100n,
        fee: 400n,
        destinationDomain: 6,
        mintRecipient: `0x${"0".repeat(24)}2222222222222222222222222222222222222222`,
        burnToken: "0x3333333333333333333333333333333333333333",
        feeRecipient: VALID_EVM_RECIPIENT,
        minFinalityThreshold: 1000,
      }
    );

    const decoded = decodeFunctionData({
      abi: BRIDGE_WITH_PREAPPROVAL_ABI,
      data: data.data,
    });

    expect(decoded.functionName).toBe("bridgeWithPreapproval");
    expect(decoded.args[0]).toEqual(
      expect.objectContaining({
        amount: 1_000_000n,
        maxFee: 100n,
        fee: 400n,
        feeRecipient: VALID_EVM_RECIPIENT,
        destinationDomain: 6,
        minFinalityThreshold: 1000,
      })
    );
  });

  it("prepares BridgeKit bridge approval for the input amount and burns input minus app fee", async () => {
    vi.stubEnv("NEXT_PUBLIC_FAST_TX_FEE_BPS", "4");
    vi.stubEnv("NEXT_PUBLIC_FEE_ADDRESS_EVM", VALID_EVM_RECIPIENT);
    vi.stubEnv("NEXT_PUBLIC_FEE_ADDRESS_SOL", VALID_SOLANA_RECIPIENT);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [{ finalityThreshold: 1000, minimumFee: "1" }],
      })
    );

    const prepared = await prepareEvmBurn({
      sourceChainId: 1,
      destinationChainId: 10,
      amount: 1_000_000n,
      recipientAddress: VALID_EVM_RECIPIENT,
      transferSpeed: "fast",
      env: "mainnet",
    });

    expect(prepared.bridgeContractAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(prepared.approvalSpender).toBe(prepared.bridgeContractAddress);
    expect(prepared.appFeeAmount).toBe(400n);
    expect(prepared.bridgeAmount).toBe(999_600n);
    expect(prepared.approvalAmount).toBe(1_000_000n);
    expect(prepared.maxFee).toBeGreaterThan(0n);
  });

  it("keeps the direct TokenMessenger approval path when disabled", async () => {
    const prepared = await prepareEvmBurn({
      sourceChainId: 1,
      destinationChainId: 10,
      amount: 1_000_000n,
      recipientAddress: VALID_EVM_RECIPIENT,
      transferSpeed: "standard",
      env: "mainnet",
    });

    expect(prepared.bridgeContractAddress).toBeUndefined();
    expect(prepared.approvalSpender).toBe(prepared.tokenMessenger);
    expect(prepared.appFeeAmount).toBe(0n);
    expect(prepared.bridgeAmount).toBe(1_000_000n);
    expect(prepared.approvalAmount).toBe(1_000_000n);
    expect(prepared.maxFee).toBe(0n);
  });
});
