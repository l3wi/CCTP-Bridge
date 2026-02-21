import { beforeEach, describe, expect, it, vi } from "vitest";

const getCctpDomainIdMock = vi.hoisted(() => vi.fn());
const getCctpDomainIdUniversalMock = vi.hoisted(() => vi.fn());
const isTestnetChainMock = vi.hoisted(() => vi.fn());
const isTestnetChainUniversalMock = vi.hoisted(() => vi.fn());
const throttleMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/contracts", () => ({
  getCctpDomainId: getCctpDomainIdMock,
  getCctpDomainIdUniversal: getCctpDomainIdUniversalMock,
  isTestnetChain: isTestnetChainMock,
  isTestnetChainUniversal: isTestnetChainUniversalMock,
}));

vi.mock("@/lib/utils/rateLimiter", () => ({
  irisRateLimiter: {
    throttle: throttleMock,
  },
}));

vi.mock("../../lib/utils/rateLimiter", () => ({
  irisRateLimiter: {
    throttle: throttleMock,
  },
}));

import {
  fetchAttestationByNonceUniversal,
  fetchAttestationUniversal,
} from "@/lib/iris";
import type { ChainId } from "@/lib/types";

type IrisMessage = {
  attestation: string;
  message: string;
  transactionHash?: string;
  txHash?: string;
  sourceTxHash?: string;
  eventNonce: string;
  status: "pending" | "pending_confirmations" | "complete";
  cctpVersion: number;
  delayReason?: string;
  decodedMessage?: {
    sourceDomain: string;
    destinationDomain: string;
    nonce: string;
    sender: string;
    recipient: string;
    messageBody: string;
    decodedMessageBody?: {
      burnToken: string;
      mintRecipient: string;
      amount: string;
      messageSender: string;
    };
  };
};

const toIrisResponse = (messages: IrisMessage[]): Response =>
  ({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ messages }),
  }) as Response;

const buildCompleteMessage = (overrides: Partial<IrisMessage> = {}): IrisMessage => ({
  attestation: "abcd",
  message: "1234",
  eventNonce: "1",
  status: "complete",
  cctpVersion: 2,
  decodedMessage: {
    sourceDomain: "0",
    destinationDomain: "3",
    nonce: "1",
    sender: "0x0",
    recipient: "0x0",
    messageBody: "0x0",
    decodedMessageBody: {
      burnToken: "0x0",
      mintRecipient: "0x1111111111111111111111111111111111111111",
      amount: "1000000",
      messageSender: "0x0",
    },
  },
  ...overrides,
});

const makeHash = (value: number): string => `0x${value.toString(16).padStart(64, "0")}`;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
  throttleMock.mockImplementation(<T>(fn: () => Promise<T>) => fn());

  getCctpDomainIdMock.mockReturnValue(0);
  getCctpDomainIdUniversalMock.mockImplementation((chainId: ChainId) => {
    if (chainId === 1) return 0;
    if (chainId === "Solana") return 5;
    return null;
  });
  isTestnetChainMock.mockReturnValue(false);
  isTestnetChainUniversalMock.mockReturnValue(false);
});

describe("iris attestation fetching", () => {
  it("dedupes concurrent universal requests by request key", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;

    let resolveFetch: (value: Response) => void = () => {};
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );

    const hash = makeHash(11);
    const requestA = fetchAttestationUniversal(1, hash);
    const requestB = fetchAttestationUniversal(1, hash);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch(toIrisResponse([buildCompleteMessage({ eventNonce: "11" })]));

    const [resultA, resultB] = await Promise.all([requestA, requestB]);
    expect(resultA?.status).toBe("complete");
    expect(resultB?.status).toBe("complete");
  });

  it("normalizes EVM source hash returned by nonce lookup", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const rawHash = "ABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD";

    fetchMock.mockResolvedValue(
      toIrisResponse([
        buildCompleteMessage({
          eventNonce: "22",
          sourceTxHash: rawHash,
        }),
      ])
    );

    const result = await fetchAttestationByNonceUniversal(1, "22");
    expect(result?.burnTxHash).toBe(`0x${rawHash.toLowerCase()}`);
  });

  it("rejects invalid Solana source hash returned by nonce lookup", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;

    fetchMock.mockResolvedValue(
      toIrisResponse([
        buildCompleteMessage({
          eventNonce: "33",
          sourceTxHash: "0xdeadbeef",
        }),
      ])
    );

    const result = await fetchAttestationByNonceUniversal("Solana", "33");
    expect(result?.burnTxHash).toBeUndefined();
  });

  it("evicts oldest cache entries after exceeding max size", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation((_url: string) => {
      return Promise.resolve(toIrisResponse([buildCompleteMessage()]));
    });

    const firstHash = makeHash(999);
    await fetchAttestationUniversal(1, firstHash);

    for (let i = 1000; i <= 1199; i += 1) {
      await fetchAttestationUniversal(1, makeHash(i));
    }

    expect(fetchMock).toHaveBeenCalledTimes(201);

    await fetchAttestationUniversal(1, firstHash);
    expect(fetchMock).toHaveBeenCalledTimes(202);
  }, 20_000);
});
