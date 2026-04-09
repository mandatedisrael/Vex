import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFetchJson = vi.fn();
function callMock<T>(mock: unknown, args: unknown[]): T {
  return (mock as (...innerArgs: unknown[]) => T)(...args);
}
vi.mock("@utils/http.js", () => ({
  fetchJson: (...args: unknown[]) => callMock(mockFetchJson, args),
}));

const {
  jupiterSwapOrder,
  jupiterSwapBuild,
  jupiterSwapExecute,
} = await import("@tools/solana-ecosystem/jupiter/jupiter-swaps/client.js");

describe("jupiter swap v2 client", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, JUPITER_API_KEY: "test-jupiter-key" };
  });

  it("calls /swap/v2/order with normalized query params and x-api-key", async () => {
    mockFetchJson.mockResolvedValueOnce({ requestId: "req-1", routePlan: [], transaction: null, mode: "ultra", inAmount: "1", outAmount: "2", otherAmountThreshold: "2" });

    await jupiterSwapOrder({
      inputMint: "So11111111111111111111111111111111111111112",
      outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      amount: "1000000000",
      taker: "GkwFnmMDvn3HGMpJpWBg8tgJxr3NxNvg3AXxvXVPbRGJ",
      slippageBps: 50,
      referralAccount: "GkwFnmMDvn3HGMpJpWBg8tgJxr3NxNvg3AXxvXVPbRGJ",
      referralFee: 75,
      payer: "gasTzr94Pmp4Gf8vknQnqxeYxdgwFjbgdJa4msYRpnB",
      excludeRouters: ["jupiterz", "dflow"],
      excludeDexes: ["Raydium", "Orca+V2"],
    });

    const [url, opts] = mockFetchJson.mock.calls[0];
    expect(url).toContain("https://api.jup.ag/swap/v2/order?");
    expect(url).toContain("inputMint=So11111111111111111111111111111111111111112");
    expect(url).toContain("outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    expect(url).toContain("amount=1000000000");
    expect(url).toContain("taker=GkwFnmMDvn3HGMpJpWBg8tgJxr3NxNvg3AXxvXVPbRGJ");
    expect(url).toContain("slippageBps=50");
    expect(url).toContain("referralFee=75");
    expect(url).toContain("excludeRouters=jupiterz%2Cdflow");
    expect(url).toContain("excludeDexes=Raydium%2COrca%2BV2");
    expect(opts.headers).toEqual({ "x-api-key": "test-jupiter-key" });
  });

  it("calls /swap/v2/build with full advanced params", async () => {
    mockFetchJson.mockResolvedValueOnce({
      routePlan: [],
      computeBudgetInstructions: [],
      setupInstructions: [],
      swapInstruction: { programId: "prog", accounts: [], data: "data" },
      cleanupInstruction: null,
      otherInstructions: [],
      inputMint: "a",
      outputMint: "b",
      inAmount: "1",
      outAmount: "2",
      otherAmountThreshold: "2",
    });

    await jupiterSwapBuild({
      inputMint: "So11111111111111111111111111111111111111112",
      outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      amount: "1000000000",
      taker: "GkwFnmMDvn3HGMpJpWBg8tgJxr3NxNvg3AXxvXVPbRGJ",
      slippageBps: 25,
      mode: "fast",
      dexes: ["Raydium", "Orca+V2"],
      platformFeeBps: 50,
      feeAccount: "9xQeWvG816bUx9EPfBZzKPGd5b7za2qrn1K8GxP2bQan",
      maxAccounts: 32,
      payer: "gasTzr94Pmp4Gf8vknQnqxeYxdgwFjbgdJa4msYRpnB",
      wrapAndUnwrapSol: false,
      destinationTokenAccount: "5Q544fKrFoe6tsEb7kRcsM2VY7bUHmM2wRVRmbCVb5GV",
      blockhashSlotsToExpiry: 120,
    });

    const [url, opts] = mockFetchJson.mock.calls[0];
    expect(url).toContain("https://api.jup.ag/swap/v2/build?");
    expect(url).toContain("mode=fast");
    expect(url).toContain("dexes=Raydium%2COrca%2BV2");
    expect(url).toContain("platformFeeBps=50");
    expect(url).toContain("maxAccounts=32");
    expect(url).toContain("wrapAndUnwrapSol=false");
    expect(url).toContain("blockhashSlotsToExpiry=120");
    expect(opts.headers).toEqual({ "x-api-key": "test-jupiter-key" });
  });

  it("calls /swap/v2/execute with POST body and json headers", async () => {
    mockFetchJson.mockResolvedValueOnce({ status: "Success", signature: "sig-1", code: 0, inputAmountResult: "1", outputAmountResult: "2" });

    await jupiterSwapExecute({
      signedTransaction: "signed-base64",
      requestId: "req-123",
      lastValidBlockHeight: "999",
    });

    const [url, opts] = mockFetchJson.mock.calls[0];
    expect(url).toBe("https://api.jup.ag/swap/v2/execute");
    expect(opts.method).toBe("POST");
    expect(opts.headers).toEqual({
      "x-api-key": "test-jupiter-key",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(opts.body)).toEqual({
      signedTransaction: "signed-base64",
      requestId: "req-123",
      lastValidBlockHeight: "999",
    });
  });

  it("rejects when JUPITER_API_KEY is missing", async () => {
    delete process.env.JUPITER_API_KEY;

    await expect(
      jupiterSwapOrder({
        inputMint: "So11111111111111111111111111111111111111112",
        outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        amount: "1000000000",
      }),
    ).rejects.toMatchObject({ code: "SOLANA_SWAP_FAILED" });

    expect(mockFetchJson).not.toHaveBeenCalled();
  });

  it("rejects invalid build param combinations before the request", async () => {
    await expect(
      jupiterSwapBuild({
        inputMint: "So11111111111111111111111111111111111111112",
        outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        amount: "1000000000",
        taker: "GkwFnmMDvn3HGMpJpWBg8tgJxr3NxNvg3AXxvXVPbRGJ",
        dexes: "Raydium",
        excludeDexes: "Orca+V2",
      }),
    ).rejects.toMatchObject({ code: "SOLANA_SWAP_FAILED" });

    expect(mockFetchJson).not.toHaveBeenCalled();
  });
});
