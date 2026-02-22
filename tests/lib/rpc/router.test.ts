import { beforeEach, describe, expect, it, vi } from "vitest";

const getConfiguredEvmRpcUrlsMock = vi.hoisted(() => vi.fn());
const getConfiguredSolanaRpcUrlsMock = vi.hoisted(() => vi.fn());
const httpMock = vi.hoisted(() =>
  vi.fn((url: string, opts: { fetchFn: typeof fetch }) => ({
    url,
    opts,
  }))
);
const customMock = vi.hoisted(() => vi.fn((provider: unknown) => ({ provider })));
const fallbackMock = vi.hoisted(() => vi.fn((transports: unknown[]) => ({ transports })));

vi.mock("@/lib/rpc/config", () => ({
  getConfiguredEvmRpcUrls: getConfiguredEvmRpcUrlsMock,
  getConfiguredSolanaRpcUrls: getConfiguredSolanaRpcUrlsMock,
}));

vi.mock("viem", () => ({
  http: httpMock,
  custom: customMock,
  fallback: fallbackMock,
}));

import { getRotatingEvmTransport } from "@/lib/rpc/router";

describe("rpc router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConfiguredSolanaRpcUrlsMock.mockReturnValue(["https://solana-rpc.example"]);
  });

  it("retries rate-limited responses on the next RPC endpoint", async () => {
    getConfiguredEvmRpcUrlsMock.mockReturnValue([
      "https://rpc-1.example",
      "https://rpc-2.example",
    ]);

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const transport = getRotatingEvmTransport(1) as unknown as {
      opts: { fetchFn: typeof fetch };
    };

    const response = await transport.opts.fetchFn("https://ignored", {
      method: "POST",
      body: "{}",
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://rpc-1.example",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://rpc-2.example",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("throws a clear error when no EVM RPC URLs are configured", () => {
    getConfiguredEvmRpcUrlsMock.mockReturnValue([]);

    expect(() => getRotatingEvmTransport(1)).toThrow(
      "No EVM RPC endpoints configured for chain 1"
    );
  });
});
