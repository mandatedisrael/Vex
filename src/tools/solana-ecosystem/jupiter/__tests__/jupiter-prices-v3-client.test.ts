import { beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@solana/web3.js";

const mockFetchJson = vi.fn();
function callMock<T>(mock: unknown, args: unknown[]): T {
  return (mock as (...innerArgs: unknown[]) => T)(...args);
}
vi.mock("@utils/http.js", () => ({
  fetchJson: (...args: unknown[]) => callMock(mockFetchJson, args),
}));

const {
  jupiterPrices,
  jupiterPricesByMint,
} = await import("@tools/solana-ecosystem/jupiter/jupiter-prices/client.js");
const { ErrorCodes } = await import("../../../../errors.js");

describe("jupiter prices v3 client", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, JUPITER_API_KEY: "test-jupiter-key" };
  });

  it("calls /price/v3 with x-api-key", async () => {
    mockFetchJson.mockResolvedValueOnce({});

    await jupiterPrices({
      ids: ["So11111111111111111111111111111111111111112"],
    });

    const [url, opts] = mockFetchJson.mock.calls[0];
    expect(url).toBe("https://api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112");
    expect(opts.headers).toEqual({ "x-api-key": "test-jupiter-key" });
  });

  it("deduplicates mint addresses before fetching", async () => {
    mockFetchJson.mockResolvedValueOnce({});

    await jupiterPricesByMint([
      "So11111111111111111111111111111111111111112",
      "So11111111111111111111111111111111111111112",
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    ]);

    const [url] = mockFetchJson.mock.calls[0];
    expect(url).toBe(
      "https://api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112%2CEPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    );
  });

  it("rejects when JUPITER_API_KEY is missing", async () => {
    delete process.env.JUPITER_API_KEY;

    await expect(
      jupiterPrices({
        ids: ["So11111111111111111111111111111111111111112"],
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.HTTP_REQUEST_FAILED });

    expect(mockFetchJson).not.toHaveBeenCalled();
  });

  it("rejects mint batches larger than 50 before fetching", async () => {
    const mints = Array.from({ length: 51 }, () => Keypair.generate().publicKey.toBase58());

    await expect(
      jupiterPricesByMint(mints),
    ).rejects.toMatchObject({ code: ErrorCodes.HTTP_REQUEST_FAILED });

    expect(mockFetchJson).not.toHaveBeenCalled();
  });

  it("rejects invalid mint addresses before fetching", async () => {
    await expect(
      jupiterPricesByMint(["not-a-solana-address"]),
    ).rejects.toMatchObject({ code: ErrorCodes.SOLANA_INVALID_ADDRESS });

    expect(mockFetchJson).not.toHaveBeenCalled();
  });
});
