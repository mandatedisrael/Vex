import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { discoverProtocolCapabilities } from "../../../vex-agent/tools/protocols/runtime.js";

describe("protocol discovery — metadata v1 wiring (PR3)", () => {
  const ENV_KEYS = [
    "JUPITER_API_KEY",
    "POLYMARKET_API_KEY",
    "EMBEDDING_BASE_URL",
    "EMBEDDING_MODEL",
    "EMBEDDING_DIM",
    "EMBEDDING_PROVIDER",
  ] as const;
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) original[k] = process.env[k];
    process.env.JUPITER_API_KEY = "test-jupiter-key";
    process.env.POLYMARKET_API_KEY = "test-polymarket-key";
    delete process.env.EMBEDDING_BASE_URL;
    delete process.env.EMBEDDING_MODEL;
    delete process.env.EMBEDDING_DIM;
    delete process.env.EMBEDDING_PROVIDER;
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  });

  it("canonicalSummary from metadata contributes to scoring", async () => {
    const result = await discoverProtocolCapabilities({
      query: "prediction market orderbook bids asks",
    });
    expect(result.success).toBe(true);
    const clobOrderbook = result.tools.find((t) => t.toolId === "polymarket.clob.orderbook");
    expect(clobOrderbook).toBeDefined();
    expect(clobOrderbook!.whyMatched).toContain("canonicalSummary");
  });

  it("prediction market orderbook ranks clob.orderbook above data.closedPositions", async () => {
    const result = await discoverProtocolCapabilities({
      query: "prediction market orderbook",
      limit: 10,
    });
    expect(result.success).toBe(true);
    const ids = result.tools.map((t) => t.toolId);
    const clobIdx = ids.findIndex((id) => id === "polymarket.clob.orderbook");
    const closedIdx = ids.findIndex((id) => id === "polymarket.data.closedPositions");
    expect(clobIdx, `clob.orderbook should appear (got ${JSON.stringify(ids)})`).toBeGreaterThanOrEqual(0);
    if (closedIdx >= 0) {
      expect(clobIdx, `clob.orderbook (idx=${clobIdx}) should rank above data.closedPositions (idx=${closedIdx})`).toBeLessThan(closedIdx);
    }
  });

  it("unfilled tools still score via inherited metadata fields", async () => {
    const result = await discoverProtocolCapabilities({
      query: "swap",
      namespace: "kyberswap",
      limit: 50,
    });
    expect(result.success).toBe(true);
    expect(result.count).toBeGreaterThan(0);
    const swapTool = result.tools.find((t) => t.toolId.startsWith("kyberswap.swap"));
    expect(swapTool).toBeDefined();
    expect(swapTool!.score).toBeGreaterThan(0);
  });
});
