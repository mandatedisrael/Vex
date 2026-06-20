/**
 * P0-2 — solana.predict mutating handlers emit a LEAN output (no base64
 * VersionedTransaction / build internals) while keeping `data._tradeCapture`
 * (and `_tradeCaptureItems` for closeAll) byte-intact for the capture pipeline.
 *
 * Regression fence: the projection pattern must trim the model-visible output
 * string ONLY — never the `data` the trade-capture pipeline depends on.
 */

import { describe, it, expect, vi } from "vitest";
import type { ProtocolExecutionContext } from "@vex-agent/tools/protocols/types.js";

const FAKE_TX = "BASE64VERSIONEDTXqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";

const ORDER = {
  positionPubkey: "POSPUB",
  marketId: "MKT",
  isYes: true,
  newSizeUsd: "10",
  newPayoutUsd: "18",
  newContracts: "100",
  contracts: "100",
  newAvgPriceUsd: "0.55",
  orderCostUsd: "10",
  estimatedTotalFeeUsd: "0.1",
};
const POSITION = { positionPubkey: "POSPUB", isYes: false, payoutAmountUsd: "20", contracts: "100" };

const orderResult = { signature: "SIG", explorerUrl: "https://exp/tx/SIG", raw: { order: ORDER, transaction: FAKE_TX, txMeta: { blockhash: "BH" } } };
const claimResult = { signature: "SIG", explorerUrl: "https://exp/tx/SIG", raw: { position: POSITION, transaction: FAKE_TX } };

vi.mock("@tools/solana-ecosystem/jupiter/jupiter-prediction/prediction-api/service.js", () => ({
  executeJupiterPredictionCreateOrder: vi.fn(async () => orderResult),
  executeJupiterPredictionClosePosition: vi.fn(async () => orderResult),
  executeJupiterPredictionClaimPosition: vi.fn(async () => claimResult),
  executeJupiterPredictionCloseAllPositions: vi.fn(async () => ({
    results: [
      { kind: "close", signature: "SIG1", raw: { order: ORDER, transaction: FAKE_TX } },
      { kind: "claim", signature: "SIG2", raw: { position: POSITION, transaction: FAKE_TX } },
    ],
    raw: { transaction: FAKE_TX },
  })),
  // Read functions predict.ts imports but this suite does not exercise.
  getJupiterPredictionEvents: vi.fn(),
  searchJupiterPredictionEvents: vi.fn(),
  getJupiterPredictionMarket: vi.fn(),
  getJupiterPredictionEvent: vi.fn(),
  getJupiterPredictionPosition: vi.fn(),
  getJupiterPredictionPositions: vi.fn(),
  getJupiterPredictionHistory: vi.fn(),
}));

vi.mock("@vex-agent/tools/protocols/solana-jupiter/handlers/core.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vex-agent/tools/protocols/solana-jupiter/handlers/core.js")>();
  return { ...actual, walletAddress: () => "WALLET", walletSecret: () => new Uint8Array([1, 2, 3]) };
});

const { SOLANA_JUPITER_HANDLERS } = await import("@vex-agent/tools/protocols/solana-jupiter/handlers.js");

function ctx(): ProtocolExecutionContext {
  return { sessionPermission: "full", approved: true, walletResolution: { source: "default" }, walletPolicy: { kind: "none" } };
}
function rec(v: unknown): Record<string, unknown> {
  return v as Record<string, unknown>;
}

describe("solana.predict mutating output is lean (P0-2)", () => {
  it("buy: output drops the base64 tx + build internals, keeps the view; data keeps _tradeCapture", async () => {
    const r = await SOLANA_JUPITER_HANDLERS["solana.predict.buy"]!({ marketId: "MKT", side: "yes", amountUsdc: 10 }, ctx());
    expect(r.success).toBe(true);
    expect(r.output).not.toContain(FAKE_TX);
    expect(r.output).not.toContain("txMeta");
    expect(r.output).not.toMatch(/"raw"\s*:/);
    expect(r.output).toContain("SIG");
    expect(r.output).toContain("POSPUB");
    expect(r.output).toContain("sizeUsd");
    const cap = rec(rec(r.data)._tradeCapture);
    expect(cap.positionKey).toBe("POSPUB");
    expect(cap.tradeSide).toBe("buy");
    expect(cap.type).toBe("prediction");
  });

  it("sell: lean output; data._tradeCapture (closed) intact", async () => {
    const r = await SOLANA_JUPITER_HANDLERS["solana.predict.sell"]!({ positionPubkey: "POSPUB" }, ctx());
    expect(r.success).toBe(true);
    expect(r.output).not.toContain(FAKE_TX);
    expect(r.output).not.toMatch(/"raw"\s*:/);
    expect(r.output).toContain("payoutUsd");
    const cap = rec(rec(r.data)._tradeCapture);
    expect(cap.tradeSide).toBe("sell");
    expect(cap.status).toBe("closed");
  });

  it("claim: lean output; data._tradeCapture (claimed) intact", async () => {
    const r = await SOLANA_JUPITER_HANDLERS["solana.predict.claim"]!({ positionPubkey: "POSPUB" }, ctx());
    expect(r.success).toBe(true);
    expect(r.output).not.toContain(FAKE_TX);
    expect(r.output).toContain("payoutAmountUsd");
    const cap = rec(rec(r.data)._tradeCapture);
    expect(cap.status).toBe("claimed");
    expect(cap.positionKey).toBe("POSPUB");
  });

  it("closeAll: output summarises without double-embedding base64; data keeps _tradeCaptureItems", async () => {
    const r = await SOLANA_JUPITER_HANDLERS["solana.predict.closeAll"]!({}, ctx());
    expect(r.success).toBe(true);
    expect(r.output).not.toContain(FAKE_TX);
    expect(r.output).not.toMatch(/"raw"\s*:/);
    expect(r.output).toContain("SIG1");
    expect(r.output).toContain("SIG2");
    expect(r.output).toMatch(/"count":\s*2/);
    const items = rec(r.data)._tradeCaptureItems;
    expect(Array.isArray(items)).toBe(true);
    expect(items as unknown[]).toHaveLength(2);
  });
});
