import { afterEach, describe, expect, it, vi } from "vitest";

const VALID_EVM_RECIPIENT = "0x1111111111111111111111111111111111111111";
const VALID_SOLANA_RECIPIENT = "11111111111111111111111111111111";

async function loadModule() {
  vi.resetModules();
  return import("@/lib/cctp/fastTransferFee");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("fastTransferFee", () => {
  it("is disabled when any env value is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_FAST_TX_FEE_BPS", "4");
    vi.stubEnv("NEXT_PUBLIC_FEE_ADDRESS_EVM", VALID_EVM_RECIPIENT);
    vi.stubEnv("NEXT_PUBLIC_FEE_ADDRESS_SOL", undefined);

    const { getFastTransferFeeConfig, getFastTransferFeeQuote } = await loadModule();

    expect(getFastTransferFeeConfig()).toEqual(
      expect.objectContaining({ enabled: false, feeBps: 4 })
    );
    expect(
      getFastTransferFeeQuote({
        amount: 1_000_000n,
        transferSpeed: "fast",
        sourceChainId: 1,
      }).feeAmount
    ).toBe(0n);
  });

  it("is disabled for invalid EVM or Solana addresses", async () => {
    vi.stubEnv("NEXT_PUBLIC_FAST_TX_FEE_BPS", "4");
    vi.stubEnv("NEXT_PUBLIC_FEE_ADDRESS_EVM", "not-an-evm-address");
    vi.stubEnv("NEXT_PUBLIC_FEE_ADDRESS_SOL", "not-a-solana-address");

    const { getFastTransferFeeConfig } = await loadModule();

    expect(getFastTransferFeeConfig()).toEqual(
      expect.objectContaining({ enabled: false, evmRecipient: undefined, solanaRecipient: undefined })
    );
  });

  it("calculates 4 bps with ceiling division", async () => {
    vi.stubEnv("NEXT_PUBLIC_FAST_TX_FEE_BPS", "4");
    vi.stubEnv("NEXT_PUBLIC_FEE_ADDRESS_EVM", VALID_EVM_RECIPIENT);
    vi.stubEnv("NEXT_PUBLIC_FEE_ADDRESS_SOL", VALID_SOLANA_RECIPIENT);

    const { getFastTransferFeeQuote } = await loadModule();

    expect(
      getFastTransferFeeQuote({
        amount: 1_000_001n,
        transferSpeed: "fast",
        sourceChainId: 1,
      })
    ).toEqual(
      expect.objectContaining({
        feeAmount: 401n,
        feeBps: 4,
        recipient: VALID_EVM_RECIPIENT,
      })
    );
  });

  it("returns zero for standard transfers", async () => {
    vi.stubEnv("NEXT_PUBLIC_FAST_TX_FEE_BPS", "4");
    vi.stubEnv("NEXT_PUBLIC_FEE_ADDRESS_EVM", VALID_EVM_RECIPIENT);
    vi.stubEnv("NEXT_PUBLIC_FEE_ADDRESS_SOL", VALID_SOLANA_RECIPIENT);

    const { getFastTransferFeeQuote } = await loadModule();

    expect(
      getFastTransferFeeQuote({
        amount: 1_000_000n,
        transferSpeed: "standard",
        sourceChainId: "Solana_Devnet",
      })
    ).toEqual(expect.objectContaining({ feeAmount: 0n, recipient: undefined }));
  });

  it("quotes an optional 2 bps contribution for standard transfers at 100,000 USDC", async () => {
    vi.stubEnv("NEXT_PUBLIC_FAST_TX_FEE_BPS", "4");
    vi.stubEnv("NEXT_PUBLIC_FEE_ADDRESS_EVM", VALID_EVM_RECIPIENT);
    vi.stubEnv("NEXT_PUBLIC_FEE_ADDRESS_SOL", VALID_SOLANA_RECIPIENT);

    const { getStandardTransferSupportQuote } = await loadModule();

    expect(
      getStandardTransferSupportQuote({
        amount: 100_000_000_000n,
        sourceChainId: 1,
      })
    ).toEqual(
      expect.objectContaining({
        eligible: true,
        feeAmount: 20_000_000n,
        feeBps: 2,
        recipient: VALID_EVM_RECIPIENT,
      })
    );
  });

  it("does not quote support below 100,000 USDC", async () => {
    vi.stubEnv("NEXT_PUBLIC_FAST_TX_FEE_BPS", "4");
    vi.stubEnv("NEXT_PUBLIC_FEE_ADDRESS_EVM", VALID_EVM_RECIPIENT);
    vi.stubEnv("NEXT_PUBLIC_FEE_ADDRESS_SOL", VALID_SOLANA_RECIPIENT);

    const { getStandardTransferSupportQuote } = await loadModule();

    expect(
      getStandardTransferSupportQuote({
        amount: 99_999_999_999n,
        sourceChainId: "Solana_Devnet",
      })
    ).toEqual(expect.objectContaining({ eligible: false, feeAmount: 0n }));
  });

  it("allows standard support when fast-transfer fees are disabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_FAST_TX_FEE_BPS", "0");
    vi.stubEnv("NEXT_PUBLIC_FEE_ADDRESS_EVM", VALID_EVM_RECIPIENT);
    vi.stubEnv("NEXT_PUBLIC_FEE_ADDRESS_SOL", VALID_SOLANA_RECIPIENT);

    const { getStandardTransferSupportQuote } = await loadModule();

    expect(
      getStandardTransferSupportQuote({
        amount: 100_000_000_000n,
        sourceChainId: 1,
      })
    ).toEqual(expect.objectContaining({ eligible: true, feeAmount: 20_000_000n }));
  });
});
