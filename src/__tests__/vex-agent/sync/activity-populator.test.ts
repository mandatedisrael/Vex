import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInsertActivity = vi.fn().mockResolvedValue(1);

vi.mock("@vex-agent/db/repos/activity.js", () => ({
  insertActivity: (...args: unknown[]) => mockInsertActivity(...args),
}));

const { populateActivity } = await import("../../../vex-agent/sync/activity-populator.js");

describe("activity-populator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Product type mapping ────────────────────────────────────────

  it("maps swap → spot", async () => {
    await populateActivity(1, null, "solana.swap.execute", "solana", { type: "swap", chain: "solana", status: "executed" });
    expect(mockInsertActivity.mock.calls[0][0].productType).toBe("spot");
  });

  it("maps perps → perps", async () => {
    await populateActivity(2, null, "solana.perps.open", "solana", { type: "perps", chain: "solana" });
    expect(mockInsertActivity.mock.calls[0][0].productType).toBe("perps");
  });

  it("maps prediction → prediction", async () => {
    await populateActivity(3, null, "polymarket.clob.buy", "polymarket", { type: "prediction", chain: "polygon" });
    expect(mockInsertActivity.mock.calls[0][0].productType).toBe("prediction");
  });

  it("maps bridge → bridge", async () => {
    await populateActivity(4, null, "khalani.bridge", "khalani", { type: "bridge", chain: "1" });
    expect(mockInsertActivity.mock.calls[0][0].productType).toBe("bridge");
  });

  it("maps lp → lp", async () => {
    await populateActivity(5, null, "kyberswap.zap.in", "kyberswap", { type: "lp", chain: "ethereum" });
    expect(mockInsertActivity.mock.calls[0][0].productType).toBe("lp");
  });

  // ── tradeSide rules ─────────────────────────────────────────────

  it("spot buy derives tradeSide=buy from tool name", async () => {
    await populateActivity(10, null, "kyberswap.swap.buy", "kyberswap", { type: "swap", chain: "base", tradeSide: "buy" });
    expect(mockInsertActivity.mock.calls[0][0].tradeSide).toBe("buy");
  });

  it("spot sell derives tradeSide=sell from tool name", async () => {
    await populateActivity(11, null, "kyberswap.swap.sell", "kyberswap", { type: "swap", chain: "base", tradeSide: "sell" });
    expect(mockInsertActivity.mock.calls[0][0].tradeSide).toBe("sell");
  });

  it("perps open with side=long → buy", async () => {
    await populateActivity(12, null, "solana.perps.open", "solana", { type: "perps", chain: "solana", tradeSide: "buy" });
    expect(mockInsertActivity.mock.calls[0][0].tradeSide).toBe("buy");
  });

  it("claim → tradeSide=null (claim is NOT a sell)", async () => {
    await populateActivity(13, null, "solana.predict.claim", "solana", { type: "prediction", chain: "solana", status: "claimed" });
    expect(mockInsertActivity.mock.calls[0][0].tradeSide).toBeNull();
  });

  it("bridge → tradeSide=null", async () => {
    await populateActivity(14, null, "khalani.bridge", "khalani", { type: "bridge", chain: "1" });
    expect(mockInsertActivity.mock.calls[0][0].tradeSide).toBeNull();
  });

  it("lend deposit → tradeSide=null", async () => {
    await populateActivity(15, null, "solana.lend.deposit", "solana", { type: "lend", chain: "solana" });
    expect(mockInsertActivity.mock.calls[0][0].tradeSide).toBeNull();
  });

  it("stake → tradeSide=null", async () => {
    await populateActivity(16, null, "solana.stake.delegate", "solana", { type: "stake", chain: "solana" });
    expect(mockInsertActivity.mock.calls[0][0].tradeSide).toBeNull();
  });

  it("reward → tradeSide=null", async () => {
    await populateActivity(17, null, "polymarket.rewards.claim", "polymarket", { type: "reward", chain: "polygon" });
    expect(mockInsertActivity.mock.calls[0][0].tradeSide).toBeNull();
  });

  // ── Field passthrough ───────────────────────────────────────────

  it("passes walletAddress from capture", async () => {
    await populateActivity(20, null, "solana.swap.execute", "solana", {
      type: "swap", chain: "solana", walletAddress: "0xWallet123",
    });
    expect(mockInsertActivity.mock.calls[0][0].walletAddress).toBe("0xWallet123");
  });

  it("prefers inputTokenAddress over inputToken", async () => {
    await populateActivity(21, null, "kyberswap.swap.sell", "kyberswap", {
      type: "swap", chain: "ethereum", inputToken: "WETH", inputTokenAddress: "0xWETH_ADDR",
    });
    expect(mockInsertActivity.mock.calls[0][0].inputToken).toBe("0xWETH_ADDR");
  });

  it("falls back to inputToken when no address", async () => {
    await populateActivity(22, null, "solana.swap.execute", "solana", {
      type: "swap", chain: "solana", inputToken: "SOL",
    });
    expect(mockInsertActivity.mock.calls[0][0].inputToken).toBe("SOL");
  });

  it("passes instrumentKey and positionKey", async () => {
    await populateActivity(23, null, "solana.perps.close", "solana", {
      type: "perps", chain: "solana", positionKey: "PK123", instrumentKey: "solana:perps:SOL",
    });
    const row = mockInsertActivity.mock.calls[0][0];
    expect(row.positionKey).toBe("PK123");
    expect(row.instrumentKey).toBe("solana:perps:SOL");
  });

  it("passes full externalRefs from capturer", async () => {
    const refs = { txHash: "0xabc", orderId: "123", positionKey: "PK", instrumentKey: "IK", signature: "sig" };
    await populateActivity(24, null, "khalani.bridge", "khalani", { type: "bridge", chain: "1" }, refs);
    const row = mockInsertActivity.mock.calls[0][0];
    expect(row.externalRefs).toEqual(refs);
  });

  // ── captureItemId passthrough ───────────────────────────────────

  it("passes captureItemId to insertActivity", async () => {
    await populateActivity(30, 42, "solana.predict.sell", "solana", {
      type: "prediction", chain: "solana", status: "closed", tradeSide: "sell",
      positionKey: "PK_BATCH", signature: "sig_batch",
    });
    const row = mockInsertActivity.mock.calls[0][0];
    expect(row.captureItemId).toBe(42);
    expect(row.executionId).toBe(30);
  });

  it("passes null captureItemId for single-capture tools", async () => {
    await populateActivity(31, null, "solana.swap.execute", "solana", { type: "swap", chain: "solana" });
    expect(mockInsertActivity.mock.calls[0][0].captureItemId).toBeNull();
  });

  // ── Insert failure ──────────────────────────────────────────────

  it("does not throw when insertActivity returns 0", async () => {
    mockInsertActivity.mockResolvedValueOnce(0);
    await expect(
      populateActivity(99, null, "solana.swap.execute", "solana", { type: "swap", chain: "solana" }),
    ).resolves.not.toThrow();
  });
});
