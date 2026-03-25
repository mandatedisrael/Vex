import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetTradeById = vi.fn();
const mockAddTrade = vi.fn();

vi.mock("../../agent/db/repos/trades.js", () => ({
  getTradeById: (...args: unknown[]) => mockGetTradeById(...args),
  addTrade: (...args: unknown[]) => mockAddTrade(...args),
}));
vi.mock("../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// portfolio-chains has side-effect imports — mock to isolate
vi.mock("../../khalani/chains.js", () => ({ CHAIN_ALIASES: {} }));
vi.mock("../../kyberswap/chains.js", () => ({
  getKyberChains: () => [],
  resolveChainSlug: (s: string) => s,
}));
vi.mock("../../chains/solana/validation.js", () => ({
  solanaExplorerUrl: (sig: string) => `https://solscan.io/tx/${sig}`,
}));

const { detectCapturedTradeCommand, deriveTradeIdFromTrade, captureTradeFromResult } =
  await import("../../agent/trade-capture.js");

beforeEach(() => {
  vi.clearAllMocks();
  mockGetTradeById.mockResolvedValue(null);
  mockAddTrade.mockResolvedValue(undefined);
});

// ── detectCapturedTradeCommand ──────────────────────────────────────

describe("detectCapturedTradeCommand", () => {
  it("detects solana swap execute", () => {
    expect(detectCapturedTradeCommand(["solana", "swap", "execute", "SOL", "USDC"])).toBe("solana_swap_execute");
  });

  it("detects solana predict buy", () => {
    expect(detectCapturedTradeCommand(["solana", "predict", "buy", "mkt-123"])).toBe("solana_predict_buy");
  });

  it("detects khalani bridge", () => {
    expect(detectCapturedTradeCommand(["khalani", "bridge", "--from-chain", "solana"])).toBe("khalani_bridge");
  });

  it("detects jaine swap sell", () => {
    expect(detectCapturedTradeCommand(["jaine", "swap", "sell", "WETH", "USDC"])).toBe("jaine_swap_sell");
  });

  it("detects slop trade buy", () => {
    expect(detectCapturedTradeCommand(["slop", "trade", "buy"])).toBe("slop_trade_buy");
  });

  it("returns null for unknown command", () => {
    expect(detectCapturedTradeCommand(["wallet", "balance"])).toBeNull();
  });

  it("returns null for empty argv", () => {
    expect(detectCapturedTradeCommand([])).toBeNull();
  });

  it("matches longest prefix first", () => {
    // "solana predict buy" is longer than "solana predict"
    expect(detectCapturedTradeCommand(["solana", "predict", "buy", "arg"])).toBe("solana_predict_buy");
  });
});

// ── deriveTradeIdFromTrade ──────────────────────────────────────────

describe("deriveTradeIdFromTrade", () => {
  it("returns hash-based ID from signature", () => {
    const id = deriveTradeIdFromTrade({ type: "swap", chain: "solana", signature: "sig123" });
    expect(id).toMatch(/^trade_[a-f0-9]{20}$/);
  });

  it("returns hash-based ID from positionPubkey", () => {
    const id = deriveTradeIdFromTrade({ type: "prediction", chain: "solana", meta: { positionPubkey: "pub123" } });
    expect(id).toMatch(/^trade_[a-f0-9]{20}$/);
  });

  it("returns hash-based ID from orderId", () => {
    const id = deriveTradeIdFromTrade({ type: "bridge", chain: "solana", meta: { orderId: "ord123" } });
    expect(id).toMatch(/^trade_[a-f0-9]{20}$/);
  });

  it("returns hash-based ID from routeId with sourceChain", () => {
    const id = deriveTradeIdFromTrade({
      type: "bridge", chain: "solana",
      meta: { routeId: "route123", sourceChain: "ethereum" },
    });
    expect(id).toBeTruthy();
  });

  it("returns hash-based ID from explorerUrl", () => {
    const id = deriveTradeIdFromTrade({
      type: "swap", chain: "solana",
      explorerUrl: "https://solscan.io/tx/abc",
    });
    expect(id).toMatch(/^trade_[a-f0-9]{20}$/);
  });

  it("returns null when no identifying field", () => {
    expect(deriveTradeIdFromTrade({ type: "swap", chain: "solana" })).toBeNull();
  });

  it("returns null when missing type", () => {
    expect(deriveTradeIdFromTrade({ chain: "solana", signature: "sig" } as any)).toBeNull();
  });

  it("returns null when missing chain", () => {
    expect(deriveTradeIdFromTrade({ type: "swap", signature: "sig" } as any)).toBeNull();
  });

  it("is deterministic — same inputs produce same ID", () => {
    const trade = { type: "swap" as const, chain: "solana", signature: "abc123" };
    const id1 = deriveTradeIdFromTrade(trade);
    const id2 = deriveTradeIdFromTrade(trade);
    expect(id1).toBe(id2);
  });
});

// ── captureTradeFromResult ──────────────────────────────────────────

describe("captureTradeFromResult", () => {
  it("captures solana swap execute", async () => {
    const output = JSON.stringify({
      success: true,
      inputToken: "SOL", inputAmount: "1.5",
      outputToken: "USDC", outputAmount: "150.0",
      signature: "sig_swap_1",
      explorerUrl: "https://solscan.io/tx/sig_swap_1",
    });

    const trades = await captureTradeFromResult(
      "solana_swap_execute",
      ["solana", "swap", "execute", "SOL", "USDC", "--amount", "1.5", "--json"],
      output,
    );

    expect(trades).toHaveLength(1);
    expect(trades[0].type).toBe("swap");
    expect(trades[0].chain).toBe("solana");
    expect(trades[0].status).toBe("executed");
    expect(trades[0].input.token).toBe("SOL");
    expect(trades[0].output.token).toBe("USDC");
    expect(mockAddTrade).toHaveBeenCalledOnce();
  });

  it("captures solana predict buy", async () => {
    const output = JSON.stringify({
      success: true,
      marketId: "mkt-1",
      side: "yes",
      amount: "10",
      positionPubkey: "pos123",
      signature: "sig_pred_1",
    });

    const trades = await captureTradeFromResult(
      "solana_predict_buy",
      ["solana", "predict", "buy", "mkt-1", "--amount", "10", "--json"],
      output,
    );

    expect(trades).toHaveLength(1);
    expect(trades[0].type).toBe("prediction");
    expect(trades[0].status).toBe("open");
    expect(trades[0].input.token).toBe("USDC");
    expect(trades[0].meta.side).toBe("yes");
  });

  it("captures prediction sell with closed status", async () => {
    const output = JSON.stringify({
      success: true, positionPubkey: "pos123", signature: "sig_sell_1",
    });

    const trades = await captureTradeFromResult(
      "solana_predict_sell",
      ["solana", "predict", "sell", "pos123", "--json"],
      output,
    );

    expect(trades).toHaveLength(1);
    expect(trades[0].status).toBe("closed");
  });

  it("captures khalani bridge", async () => {
    const output = JSON.stringify({
      success: true, routeId: "route_1", orderId: "order_1",
      sourceChainId: 1, destinationChainId: 137,
      signature: "sig_bridge_1",
    });

    const trades = await captureTradeFromResult(
      "khalani_bridge",
      ["khalani", "bridge", "--from-chain", "ethereum", "--to-chain", "polygon", "--from-token", "USDC", "--to-token", "USDC", "--amount", "100", "--json"],
      output,
    );

    expect(trades).toHaveLength(1);
    expect(trades[0].type).toBe("bridge");
    expect(trades[0].status).toBe("pending");
  });

  it("captures jaine swap sell on 0g chain", async () => {
    const output = JSON.stringify({
      success: true,
      tokenIn: "WETH", amountIn: "0.5",
      tokenOut: "USDC", amountOutExpected: "1500",
      signature: "sig_jaine_1",
    });

    const trades = await captureTradeFromResult(
      "jaine_swap_sell",
      ["jaine", "swap", "sell", "WETH", "USDC", "--json"],
      output,
    );

    expect(trades).toHaveLength(1);
    expect(trades[0].chain).toBe("0g");
    expect(trades[0].meta.dex).toBe("jaine");
  });

  it("captures slop trade buy as bonding type", async () => {
    const output = JSON.stringify({
      success: true, symbol: "TEST", token: "TEST",
      quote: { ogUsed: "5.0", tokensOut: "1000" },
      signature: "sig_slop_1",
    });

    const trades = await captureTradeFromResult(
      "slop_trade_buy",
      ["slop", "trade", "buy", "--json"],
      output,
    );

    expect(trades).toHaveLength(1);
    expect(trades[0].type).toBe("bonding");
    expect(trades[0].chain).toBe("0g");
  });

  it("returns empty for non-JSON output", async () => {
    const trades = await captureTradeFromResult(
      "solana_swap_execute",
      ["solana", "swap", "execute", "--json"],
      "Error: not json",
    );
    expect(trades).toEqual([]);
  });

  it("returns empty for success=false output", async () => {
    const trades = await captureTradeFromResult(
      "solana_swap_execute",
      ["solana", "swap", "execute", "--json"],
      JSON.stringify({ success: false, error: "slippage" }),
    );
    expect(trades).toEqual([]);
  });

  it("returns empty for dryRun=true output", async () => {
    const trades = await captureTradeFromResult(
      "solana_swap_execute",
      ["solana", "swap", "execute", "--json"],
      JSON.stringify({ success: true, dryRun: true }),
    );
    expect(trades).toEqual([]);
  });

  it("returns empty for unknown command", async () => {
    const trades = await captureTradeFromResult(
      "wallet_balance",
      ["wallet", "balance", "--json"],
      JSON.stringify({ success: true }),
    );
    expect(trades).toEqual([]);
  });

  it("captures MEV claim with multiple entries", async () => {
    const output = JSON.stringify({
      success: true,
      claimed: [
        { signature: "sig_mev_1", claimedSol: 0.001, stakeAccount: "stake1" },
        { signature: "sig_mev_2", claimedSol: 0.002, stakeAccount: "stake2" },
      ],
    });

    const trades = await captureTradeFromResult(
      "solana_stake_claim-mev",
      ["solana", "stake", "claim-mev", "--json"],
      output,
    );

    expect(trades).toHaveLength(2);
    expect(trades[0].type).toBe("stake");
    expect(trades[1].type).toBe("stake");
  });
});
