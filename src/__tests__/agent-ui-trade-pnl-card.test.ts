import { describe, expect, it } from "vitest";
import { buildTradePnlCardModel, buildTradeShareText, canGenerateTradePnlCard } from "../agent/ui/src/trade-pnl-card.js";
import type { TradeEntry } from "../agent/ui/src/types.js";

const BASE_TRADE: TradeEntry = {
  id: "trade-1",
  timestamp: "2026-03-24T18:00:00.000Z",
  type: "swap",
  chain: "solana",
  status: "closed",
  input: { token: "SOL", amount: "0.76", valueUsd: 100 },
  output: { token: "USDC", amount: "150", valueUsd: 150 },
  pnl: { amountUsd: 50, percentChange: 50, realized: true },
  meta: {},
  signature: "0xabc123456789",
  explorerUrl: "https://solscan.io/tx/0xabc123456789",
};

describe("trade pnl card model", () => {
  it("builds poster-ready values from a closed trade", () => {
    const model = buildTradePnlCardModel(BASE_TRADE);
    expect(model).toMatchObject({
      headline: "$SOL",
      subtitle: "SOL → USDC · SOLANA",
      pnlDisplay: "+$50.00",
      pnlPercentDisplay: "+50.00%",
      investedDisplay: "$100.00",
      positionDisplay: "$150.00",
      tone: "profit",
    });
  });

  it("rejects open or pnl-less trades", () => {
    expect(canGenerateTradePnlCard({ ...BASE_TRADE, status: "open" })).toBe(false);
    expect(canGenerateTradePnlCard({ ...BASE_TRADE, pnl: undefined })).toBe(false);
  });

  it("builds share text with explorer url", () => {
    const model = buildTradePnlCardModel(BASE_TRADE);
    expect(model).not.toBeNull();
    expect(buildTradeShareText(BASE_TRADE, model!)).toContain("Every action echoes.");
    expect(buildTradeShareText(BASE_TRADE, model!)).toContain("https://solscan.io/tx/0xabc123456789");
  });
});
