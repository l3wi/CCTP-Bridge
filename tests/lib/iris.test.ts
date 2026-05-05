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
  requestReattestation,
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
      expirationBlock?: string;
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
      expirationBlock: "0",
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

  it("returns null for malformed complete payloads", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;

    fetchMock.mockResolvedValue(
      toIrisResponse([
        {
          ...buildCompleteMessage({ eventNonce: "44" }),
          message: "" as unknown as string,
        },
      ])
    );

    const result = await fetchAttestationUniversal(1, makeHash(44));
    expect(result).toBeNull();
  });

  it("returns decoded expirationBlock from universal attestation lookups", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;

    fetchMock.mockResolvedValue(
      toIrisResponse([
        buildCompleteMessage({
          eventNonce: "66",
          decodedMessage: {
            ...buildCompleteMessage().decodedMessage!,
            decodedMessageBody: {
              ...buildCompleteMessage().decodedMessage!.decodedMessageBody!,
              expirationBlock: "123456",
            },
          },
        }),
      ])
    );

    const result = await fetchAttestationUniversal(1, makeHash(66));
    expect(result?.expirationBlock).toBe("123456");
  });

  it("returns decoded expirationBlock from nonce lookups", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;

    fetchMock.mockResolvedValue(
      toIrisResponse([
        buildCompleteMessage({
          eventNonce: "67",
          sourceTxHash: makeHash(67),
          decodedMessage: {
            ...buildCompleteMessage().decodedMessage!,
            decodedMessageBody: {
              ...buildCompleteMessage().decodedMessage!.decodedMessageBody!,
              expirationBlock: "7890",
            },
          },
        }),
      ])
    );

    const result = await fetchAttestationByNonceUniversal(1, "67");
    expect(result?.attestation.expirationBlock).toBe("7890");
  });

  it("bypasses universal attestation cache when forceRefresh is enabled", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const hash = makeHash(77);

    fetchMock
      .mockResolvedValueOnce(toIrisResponse([buildCompleteMessage({ eventNonce: "77" })]))
      .mockResolvedValueOnce(toIrisResponse([buildCompleteMessage({ eventNonce: "78" })]));

    const cachedResult = await fetchAttestationUniversal(1, hash);
    const refreshedResult = await fetchAttestationUniversal(1, hash, {
      forceRefresh: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(cachedResult?.nonce).toBe("77");
    expect(refreshedResult?.nonce).toBe("78");
  });

  it("invalidates cached universal attestations after re-attestation request", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const hash = makeHash(88);

    fetchMock
      .mockResolvedValueOnce(toIrisResponse([buildCompleteMessage({ eventNonce: "88" })]))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ message: "ok", nonce: "88" }),
      } as Response)
      .mockResolvedValueOnce(toIrisResponse([buildCompleteMessage({ eventNonce: "89" })]));

    const first = await fetchAttestationUniversal(1, hash);
    expect(first?.nonce).toBe("88");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await requestReattestation(1, "88");
    const refreshed = await fetchAttestationUniversal(1, hash);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(refreshed?.nonce).toBe("89");
  });

  it("does not send JSON content-type for bodyless re-attestation POST", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ message: "ok", nonce: "99" }),
    } as Response);

    await requestReattestation(1, "99");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/v2/reattest/99"),
      expect.objectContaining({
        method: "POST",
        headers: expect.not.objectContaining({
          "Content-Type": "application/json",
        }),
      })
    );
  });
});
