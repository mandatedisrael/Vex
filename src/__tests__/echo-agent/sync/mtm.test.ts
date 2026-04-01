import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock DB
const mockQuery = vi.fn().mockResolvedValue([]);
const mockExecute = vi.fn().mockResolvedValue(0);
vi.mock("@echo-agent/db/client.js", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  execute: (...args: unknown[]) => mockExecute(...args),
}));

// Mock Jupiter prediction market
const mockGetMarket = vi.fn();
vi.mock("@tools/solana-ecosystem/jupiter/jupiter-prediction/prediction-api/service.js", () => ({
  getJupiterPredictionMarket: (...args: unknown[]) => mockGetMarket(...args),
}));

// Mock Polymarket CLOB
const mockGetPrice = vi.fn();
vi.mock("@tools/polymarket/clob/client.js", () => ({
  getPolyClobClient: () => ({ getPrice: mockGetPrice }),
}));

const { refreshPredictionMtm } = await import("../../../echo-agent/sync/mtm.js");

describe("refreshPredictionMtm", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns zeros when no open prediction positions", async () => {
    mockQuery.mockResolvedValueOnce([]);
    const result = await refreshPredictionMtm();
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it("updates Jupiter prediction with exit price", async () => {
    mockQuery.mockResolvedValueOnce([{
      id: 1, namespace: "solana",
      instrument_key: "solana:predict:market1:yes",
      contracts: "5", notional_usd: "3.00",
      data: {},
    }]);
    mockGetMarket.mockResolvedValueOnce({
      pricing: { sellYesPriceUsd: 0.72, sellNoPriceUsd: 0.28 },
    });

    const result = await refreshPredictionMtm();
    expect(result.updated).toBe(1);
    expect(mockExecute).toHaveBeenCalledTimes(1);
    // SQL should have markPrice = 0.72 (sellYes for yes position)
    expect(mockExecute.mock.calls[0][1]).toContain("0.72");
  });

  it("skips position without contracts", async () => {
    mockQuery.mockResolvedValueOnce([{
      id: 2, namespace: "solana",
      instrument_key: "solana:predict:market1:no",
      contracts: null, notional_usd: "2.00", data: {},
    }]);

    const result = await refreshPredictionMtm();
    expect(result.skipped).toBe(1);
    expect(result.updated).toBe(0);
  });

  it("updates Polymarket with public SELL price", async () => {
    mockQuery.mockResolvedValueOnce([{
      id: 3, namespace: "polymarket",
      instrument_key: "polymarket:0xabc:YES",
      contracts: "10", notional_usd: "6.50",
      data: { tokenId: "tok123" },
    }]);
    mockGetPrice.mockResolvedValueOnce({ price: 0.80 });

    const result = await refreshPredictionMtm();
    expect(result.updated).toBe(1);
    expect(mockGetPrice).toHaveBeenCalledWith("tok123", "SELL");
  });

  it("skips Polymarket position without tokenId", async () => {
    mockQuery.mockResolvedValueOnce([{
      id: 4, namespace: "polymarket",
      instrument_key: "polymarket:0xdef:NO",
      contracts: "5", notional_usd: "3.00",
      data: {},
    }]);

    const result = await refreshPredictionMtm();
    expect(result.skipped).toBe(1);
  });

  it("handles market fetch error gracefully", async () => {
    mockQuery.mockResolvedValueOnce([{
      id: 5, namespace: "solana",
      instrument_key: "solana:predict:badmarket:yes",
      contracts: "3", notional_usd: "2.00", data: {},
    }]);
    mockGetMarket.mockRejectedValueOnce(new Error("Market not found"));

    const result = await refreshPredictionMtm();
    expect(result.errors).toBe(1);
    expect(result.updated).toBe(0);
  });
});
