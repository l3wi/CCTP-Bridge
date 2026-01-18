/**
 * Tests for gas estimation utilities.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PublicKey, VersionedTransaction, Transaction } from "@solana/web3.js";
import type { PublicClient } from "viem";
import {
  formatSol,
  formatNative,
  estimateSolanaMintGas,
  estimateEvmMintGas,
  type GasEstimate,
} from "./gasEstimation";

// =============================================================================
// formatSol Tests
// =============================================================================

describe("formatSol", () => {
  it("formats zero lamports", () => {
    expect(formatSol(BigInt(0))).toBe("0.000000");
  });

  it("formats small amounts (< 0.0001 SOL) with 6 decimals", () => {
    // 1000 lamports = 0.000001 SOL
    expect(formatSol(BigInt(1000))).toBe("0.000001");
    // 50000 lamports = 0.00005 SOL
    expect(formatSol(BigInt(50000))).toBe("0.000050");
  });

  it("formats medium amounts (0.0001 - 0.01 SOL) with 5 decimals", () => {
    // 1,000,000 lamports = 0.001 SOL
    expect(formatSol(BigInt(1_000_000))).toBe("0.00100");
    // 5,000,000 lamports = 0.005 SOL
    expect(formatSol(BigInt(5_000_000))).toBe("0.00500");
  });

  it("formats larger amounts (>= 0.01 SOL) with 4 decimals", () => {
    // 10,000,000 lamports = 0.01 SOL
    expect(formatSol(BigInt(10_000_000))).toBe("0.0100");
    // 1,000,000,000 lamports = 1 SOL
    expect(formatSol(BigInt(1_000_000_000))).toBe("1.0000");
    // 2,500,000,000 lamports = 2.5 SOL
    expect(formatSol(BigInt(2_500_000_000))).toBe("2.5000");
  });

  it("handles typical ATA rent amount", () => {
    // ATA rent exemption = 2,039,280 lamports ≈ 0.00204 SOL
    const result = formatSol(BigInt(2_039_280));
    expect(result).toBe("0.00204");
  });

  it("handles typical transaction fee", () => {
    // Typical tx fee = 5000 lamports = 0.000005 SOL
    expect(formatSol(BigInt(5000))).toBe("0.000005");
  });
});

// =============================================================================
// formatNative Tests
// =============================================================================

describe("formatNative", () => {
  it("formats zero wei", () => {
    expect(formatNative(BigInt(0))).toBe("0.000000");
  });

  it("formats small amounts (< 0.0001 ETH) with 6 decimals", () => {
    // 1e12 wei = 0.000001 ETH
    expect(formatNative(BigInt(1e12))).toBe("0.000001");
    // 5e13 wei = 0.00005 ETH
    expect(formatNative(BigInt(5e13))).toBe("0.000050");
  });

  it("formats medium amounts (0.0001 - 0.01 ETH) with 5 decimals", () => {
    // 1e15 wei = 0.001 ETH
    expect(formatNative(BigInt(1e15))).toBe("0.00100");
    // 5e15 wei = 0.005 ETH
    expect(formatNative(BigInt(5e15))).toBe("0.00500");
  });

  it("formats larger amounts (>= 0.01 ETH) with 4 decimals", () => {
    // 1e16 wei = 0.01 ETH
    expect(formatNative(BigInt(1e16))).toBe("0.0100");
    // 1e18 wei = 1 ETH
    expect(formatNative(BigInt(1e18))).toBe("1.0000");
    // 2.5e18 wei = 2.5 ETH
    expect(formatNative(BigInt(25n * 10n ** 17n))).toBe("2.5000");
  });

  it("handles custom decimals", () => {
    // USDC has 6 decimals
    // 1,000,000 = 1 USDC
    expect(formatNative(BigInt(1_000_000), 6)).toBe("1.0000");
    // 500,000 = 0.5 USDC
    expect(formatNative(BigInt(500_000), 6)).toBe("0.5000");
  });

  it("handles typical gas cost", () => {
    // 21000 gas * 20 gwei = 420000 gwei = 0.00042 ETH
    const gasCost = BigInt(21000) * BigInt(20e9);
    expect(formatNative(gasCost)).toBe("0.00042");
  });
});

// =============================================================================
// estimateSolanaMintGas Tests
// =============================================================================

describe("estimateSolanaMintGas", () => {
  // Mock connection
  const mockConnection = {
    getFeeForMessage: vi.fn(),
    getAccountInfo: vi.fn(),
  };

  // Mock versioned transaction with message
  const mockVersionedTx = {
    version: 0,
    message: {
      serialize: vi.fn().mockReturnValue(new Uint8Array(100)),
    },
  } as unknown as VersionedTransaction;

  const mockUserPubkey = new PublicKey("11111111111111111111111111111111");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns sufficient=true when balance covers tx fee (no ATA creation)", async () => {
    // User has enough SOL, ATA exists
    mockConnection.getFeeForMessage.mockResolvedValue({ value: 5000 });
    mockConnection.getAccountInfo.mockResolvedValue({ data: Buffer.alloc(165) }); // ATA exists

    const result = await estimateSolanaMintGas({
      connection: mockConnection as any,
      userPubkey: mockUserPubkey,
      transaction: mockVersionedTx,
      destinationChainId: "Solana",
      userBalance: BigInt(1_000_000_000), // 1 SOL
    });

    expect(result.sufficient).toBe(true);
    expect(result.breakdown.ataCreation).toBeUndefined();
    // 5000 lamports * 1.5 buffer = 7500 lamports
    expect(result.required).toBeLessThan(BigInt(10_000));
  });

  it("returns sufficient=false when balance is too low", async () => {
    mockConnection.getFeeForMessage.mockResolvedValue({ value: 5000 });
    mockConnection.getAccountInfo.mockResolvedValue({ data: Buffer.alloc(165) }); // ATA exists

    const result = await estimateSolanaMintGas({
      connection: mockConnection as any,
      userPubkey: mockUserPubkey,
      transaction: mockVersionedTx,
      destinationChainId: "Solana",
      userBalance: BigInt(1000), // Only 1000 lamports
    });

    expect(result.sufficient).toBe(false);
    expect(result.current).toBe(BigInt(1000));
    expect(result.required).toBeGreaterThan(BigInt(1000));
  });

  it("includes ATA creation cost when ATA does not exist", async () => {
    mockConnection.getFeeForMessage.mockResolvedValue({ value: 5000 });
    mockConnection.getAccountInfo.mockResolvedValue(null); // ATA does not exist

    const result = await estimateSolanaMintGas({
      connection: mockConnection as any,
      userPubkey: mockUserPubkey,
      transaction: mockVersionedTx,
      destinationChainId: "Solana",
      userBalance: BigInt(1_000_000), // 0.001 SOL - not enough for ATA
    });

    // ATA rent is ~2,039,280 lamports
    expect(result.breakdown.ataCreation).toBeDefined();
    expect(result.breakdown.ataCreation).toBe(BigInt(2_039_280));
    expect(result.sufficient).toBe(false);
  });

  it("uses fallback fee when getFeeForMessage fails", async () => {
    mockConnection.getFeeForMessage.mockRejectedValue(new Error("RPC error"));
    mockConnection.getAccountInfo.mockResolvedValue({ data: Buffer.alloc(165) });

    const result = await estimateSolanaMintGas({
      connection: mockConnection as any,
      userPubkey: mockUserPubkey,
      transaction: mockVersionedTx,
      destinationChainId: "Solana",
      userBalance: BigInt(1_000_000_000), // 1 SOL
    });

    // Should still return a valid estimate using fallback
    expect(result.sufficient).toBe(true);
    // Fallback is 10,000 lamports * 1.5 = 15,000
    expect(result.breakdown.txFee).toBe(BigInt(10_000));
  });

  it("handles legacy transaction", async () => {
    mockConnection.getFeeForMessage.mockResolvedValue({ value: 5000 });
    mockConnection.getAccountInfo.mockResolvedValue({ data: Buffer.alloc(165) });

    const mockLegacyTx = {
      compileMessage: vi.fn().mockReturnValue({
        serialize: vi.fn().mockReturnValue(new Uint8Array(100)),
      }),
    } as unknown as Transaction;

    const result = await estimateSolanaMintGas({
      connection: mockConnection as any,
      userPubkey: mockUserPubkey,
      transaction: mockLegacyTx,
      destinationChainId: "Solana",
      userBalance: BigInt(1_000_000_000),
    });

    expect(result.sufficient).toBe(true);
    expect(mockLegacyTx.compileMessage).toHaveBeenCalled();
  });

  it("uses fallback fee when getFeeForMessage returns null value", async () => {
    mockConnection.getFeeForMessage.mockResolvedValue({ value: null });
    mockConnection.getAccountInfo.mockResolvedValue({ data: Buffer.alloc(165) });

    const result = await estimateSolanaMintGas({
      connection: mockConnection as any,
      userPubkey: mockUserPubkey,
      transaction: mockVersionedTx,
      destinationChainId: "Solana",
      userBalance: BigInt(1_000_000_000),
    });

    // Should use fallback of 5000 lamports
    expect(result.breakdown.txFee).toBe(BigInt(5000));
  });

  it("uses fallback fee when getFeeForMessage returns zero", async () => {
    mockConnection.getFeeForMessage.mockResolvedValue({ value: 0 });
    mockConnection.getAccountInfo.mockResolvedValue({ data: Buffer.alloc(165) });

    const result = await estimateSolanaMintGas({
      connection: mockConnection as any,
      userPubkey: mockUserPubkey,
      transaction: mockVersionedTx,
      destinationChainId: "Solana",
      userBalance: BigInt(1_000_000_000),
    });

    // Should use fallback of 5000 lamports
    expect(result.breakdown.txFee).toBe(BigInt(5000));
  });
});

// =============================================================================
// estimateEvmMintGas Tests
// =============================================================================

describe("estimateEvmMintGas", () => {
  const mockPublicClient = {
    estimateGas: vi.fn(),
    getGasPrice: vi.fn(),
  } as unknown as PublicClient;

  const mockUserAddress = "0x1234567890123456789012345678901234567890" as `0x${string}`;
  const mockMessageTransmitter = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as `0x${string}`;
  const mockMessage = "0x1234" as `0x${string}`;
  const mockAttestation = "0x5678" as `0x${string}`;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns sufficient=true when balance covers gas cost", async () => {
    // 100,000 gas units * 20 gwei = 2,000,000 gwei = 0.002 ETH
    (mockPublicClient.estimateGas as any).mockResolvedValue(BigInt(100_000));
    (mockPublicClient.getGasPrice as any).mockResolvedValue(BigInt(20e9)); // 20 gwei

    const result = await estimateEvmMintGas({
      publicClient: mockPublicClient,
      userAddress: mockUserAddress,
      messageTransmitter: mockMessageTransmitter,
      message: mockMessage,
      attestation: mockAttestation,
      userBalance: BigInt(1e18), // 1 ETH
    });

    expect(result.sufficient).toBe(true);
    expect(result.current).toBe(BigInt(1e18));
    // Gas cost with 1.2x buffer = 100000 * 20 gwei * 1.2 = 2.4e15 wei = 0.0024 ETH
    expect(result.required).toBeLessThan(BigInt(1e18));
  });

  it("returns sufficient=false when balance is too low", async () => {
    (mockPublicClient.estimateGas as any).mockResolvedValue(BigInt(100_000));
    (mockPublicClient.getGasPrice as any).mockResolvedValue(BigInt(20e9));

    const result = await estimateEvmMintGas({
      publicClient: mockPublicClient,
      userAddress: mockUserAddress,
      messageTransmitter: mockMessageTransmitter,
      message: mockMessage,
      attestation: mockAttestation,
      userBalance: BigInt(1e12), // Only 0.000001 ETH
    });

    expect(result.sufficient).toBe(false);
    expect(result.current).toBe(BigInt(1e12));
    expect(result.required).toBeGreaterThan(BigInt(1e12));
  });

  it("applies 20% buffer to gas estimate", async () => {
    (mockPublicClient.estimateGas as any).mockResolvedValue(BigInt(100_000));
    (mockPublicClient.getGasPrice as any).mockResolvedValue(BigInt(10e9)); // 10 gwei

    const result = await estimateEvmMintGas({
      publicClient: mockPublicClient,
      userAddress: mockUserAddress,
      messageTransmitter: mockMessageTransmitter,
      message: mockMessage,
      attestation: mockAttestation,
      userBalance: BigInt(1e18),
    });

    // Base cost = 100,000 * 10 gwei = 1e15 wei
    // With 1.2x buffer (6/5) using ceiling division = ceil(1e15 * 6 / 5)
    const baseCost = BigInt(100_000) * BigInt(10e9);
    // Ceiling division: (baseCost * 6 + 5 - 1) / 5
    const expectedWithBuffer = (baseCost * 6n + 4n) / 5n;
    expect(result.required).toBe(expectedWithBuffer);
  });

  it("encodes receiveMessage call data correctly", async () => {
    (mockPublicClient.estimateGas as any).mockResolvedValue(BigInt(100_000));
    (mockPublicClient.getGasPrice as any).mockResolvedValue(BigInt(10e9));

    await estimateEvmMintGas({
      publicClient: mockPublicClient,
      userAddress: mockUserAddress,
      messageTransmitter: mockMessageTransmitter,
      message: mockMessage,
      attestation: mockAttestation,
      userBalance: BigInt(1e18),
    });

    // Verify estimateGas was called with correct params
    expect(mockPublicClient.estimateGas).toHaveBeenCalledWith(
      expect.objectContaining({
        account: mockUserAddress,
        to: mockMessageTransmitter,
        data: expect.any(String), // Encoded function data
      })
    );
  });
});

// =============================================================================
// GasEstimate Type Tests
// =============================================================================

describe("GasEstimate type", () => {
  it("has correct structure for sufficient balance", () => {
    const estimate: GasEstimate = {
      required: BigInt(1000),
      current: BigInt(5000),
      sufficient: true,
      breakdown: {
        txFee: BigInt(1000),
      },
    };

    expect(estimate.sufficient).toBe(true);
    expect(estimate.current).toBeGreaterThan(estimate.required);
    expect(estimate.breakdown.ataCreation).toBeUndefined();
  });

  it("has correct structure for insufficient balance with ATA", () => {
    const estimate: GasEstimate = {
      required: BigInt(3_000_000),
      current: BigInt(1_000_000),
      sufficient: false,
      breakdown: {
        txFee: BigInt(5000),
        ataCreation: BigInt(2_039_280),
      },
    };

    expect(estimate.sufficient).toBe(false);
    expect(estimate.current).toBeLessThan(estimate.required);
    expect(estimate.breakdown.ataCreation).toBeDefined();
    expect(estimate.breakdown.txFee + (estimate.breakdown.ataCreation || BigInt(0)))
      .toBeLessThan(estimate.required); // Required includes buffer
  });
});
