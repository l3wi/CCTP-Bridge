import { beforeEach, describe, expect, it, vi } from "vitest";

const getConfiguredSolanaRpcUrlsMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/rpc/config", () => ({
  getConfiguredSolanaRpcUrls: getConfiguredSolanaRpcUrlsMock,
}));

import { getSolanaConnectionOptions } from "@/lib/rpc/clients";

describe("getSolanaConnectionOptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConfiguredSolanaRpcUrlsMock.mockReturnValue([
      "https://solana-rpc-1.example",
      "https://solana-rpc-2.example",
    ]);
  });

  it("retries the next Solana RPC when the browser fetch fails", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { endpoint, config } = getSolanaConnectionOptions("Solana");
    const response = await config.fetch("https://ignored", {
      method: "POST",
      body: "{}",
      headers: { "content-type": "application/json" },
    });

    expect(endpoint).toBe("https://solana-rpc-1.example");
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://solana-rpc-1.example",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://solana-rpc-2.example",
      expect.objectContaining({ method: "POST" })
    );
  });
});
