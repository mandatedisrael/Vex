/**
 * polymarket.clob.cancelOrders / cancelAll / cancelMarket — ToolResult honesty.
 *
 * Before this fix, all three bulk-cancel handlers hardcoded `success: true`
 * regardless of the venue's `not_canceled` map — the exact bug class fixed for
 * clob.cancel (single) in the "partial-cancel correctness guard" suite, but
 * left unfixed here. `_tradeCapture`/`_tradeCaptureItems` were also emitted
 * unconditionally, including a phantom "cancelled" entry with count 0 when
 * NOTHING was actually cancelled.
 *
 * Policy (mirrors clob.cancel's not_canceled check, extended to N ids):
 *   - total rejection (canceled: [], not_canceled non-empty) → success:false,
 *     no _tradeCapture / _tradeCaptureItems at all;
 *   - partial success (some canceled, some not_canceled)     → success:true,
 *     capture ONLY the ids that actually cancelled (ledger trace preserved,
 *     mirrors relay.bridge's "pending" precedent of not losing a real trace);
 *   - "nothing to cancel" (both empty — e.g. cancelAll with no open orders)
 *     → success:true, no capture (legitimate no-op, not a failure).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCancelOrders = vi.fn();
const mockCancelAll = vi.fn();
const mockCancelMarketOrders = vi.fn();

vi.mock("@tools/polymarket/clob/client.js", () => ({
  getPolyClobClient: () => ({
    cancelOrders: (...a: unknown[]) => mockCancelOrders(...a),
    cancelAll: (...a: unknown[]) => mockCancelAll(...a),
    cancelMarketOrders: (...a: unknown[]) => mockCancelMarketOrders(...a),
  }),
}));
vi.mock("@vex-agent/tools/internal/wallet/resolve.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vex-agent/tools/internal/wallet/resolve.js")>();
  return {
    ...actual,
    resolveSelectedAddress: () => "0x1111111111111111111111111111111111111111",
  };
});

const { POLYMARKET_HANDLERS } = await import("../../../vex-agent/tools/protocols/polymarket/handlers.js");

const SIGNING_CTX = {
  sessionPermission: "full" as const,
  approved: true,
  walletResolution: { source: "session" as const, evm: null, solana: null },
  walletPolicy: { kind: "none" as const },
};

beforeEach(() => {
  mockCancelOrders.mockReset();
  mockCancelAll.mockReset();
  mockCancelMarketOrders.mockReset();
});

describe("polymarket.clob.cancelOrders — bulk correctness guard", () => {
  it("total rejection (nothing cancelled) — success:false, no capture", async () => {
    mockCancelOrders.mockResolvedValue({ canceled: [], not_canceled: { a: "order not found", b: "order not found" } });
    const r = await POLYMARKET_HANDLERS["polymarket.clob.cancelOrders"]!({ orderIds: "a,b" }, SIGNING_CTX);
    expect(r.success).toBe(false);
    expect(r.data?._tradeCapture).toBeUndefined();
    expect(r.data?._tradeCaptureItems).toBeUndefined();
  });

  it("partial success — success:true, capture only the ids that cancelled", async () => {
    mockCancelOrders.mockResolvedValue({ canceled: ["a"], not_canceled: { b: "order not found" } });
    const r = await POLYMARKET_HANDLERS["polymarket.clob.cancelOrders"]!({ orderIds: "a,b" }, SIGNING_CTX);
    expect(r.success).toBe(true);
    expect(r.data?._tradeCapture).toBeDefined();
    const items = r.data?._tradeCaptureItems as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0]?.positionKey).toBe("a");
    // The rejection reason is still visible in the raw output for diagnostics.
    const out = JSON.parse(r.output);
    expect(out.not_canceled.b).toBe("order not found");
  });

  it("full success — success:true, all ids captured", async () => {
    mockCancelOrders.mockResolvedValue({ canceled: ["a", "b"], not_canceled: {} });
    const r = await POLYMARKET_HANDLERS["polymarket.clob.cancelOrders"]!({ orderIds: "a,b" }, SIGNING_CTX);
    expect(r.success).toBe(true);
    const items = r.data?._tradeCaptureItems as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2);
  });
});

describe("polymarket.clob.cancelAll — bulk correctness guard", () => {
  it("total rejection — success:false, no capture", async () => {
    mockCancelAll.mockResolvedValue({ canceled: [], not_canceled: { a: "order not found" } });
    const r = await POLYMARKET_HANDLERS["polymarket.clob.cancelAll"]!({}, SIGNING_CTX);
    expect(r.success).toBe(false);
    expect(r.data?._tradeCapture).toBeUndefined();
  });

  it("nothing to cancel (no open orders) — success:true, no capture (legitimate no-op)", async () => {
    mockCancelAll.mockResolvedValue({ canceled: [], not_canceled: {} });
    const r = await POLYMARKET_HANDLERS["polymarket.clob.cancelAll"]!({}, SIGNING_CTX);
    expect(r.success).toBe(true);
    expect(r.data?._tradeCapture).toBeUndefined();
    expect(r.data?._tradeCaptureItems).toBeUndefined();
  });

  it("full success — success:true, captures all cancelled ids", async () => {
    mockCancelAll.mockResolvedValue({ canceled: ["a", "b"], not_canceled: {} });
    const r = await POLYMARKET_HANDLERS["polymarket.clob.cancelAll"]!({}, SIGNING_CTX);
    expect(r.success).toBe(true);
    expect(r.data?._tradeCapture).toMatchObject({ meta: { action: "cancelAll", count: 2 } });
  });
});

describe("polymarket.clob.cancelMarket — bulk correctness guard", () => {
  const PARAMS = { market: "0xCOND", assetId: "tok-1" };

  it("total rejection — success:false, no capture, conditionId still on data", async () => {
    mockCancelMarketOrders.mockResolvedValue({ canceled: [], not_canceled: { a: "order not found" } });
    const r = await POLYMARKET_HANDLERS["polymarket.clob.cancelMarket"]!(PARAMS, SIGNING_CTX);
    expect(r.success).toBe(false);
    expect(r.data?._tradeCapture).toBeUndefined();
    expect(r.data?.conditionId).toBe("0xCOND");
  });

  it("partial success — success:true, capture only cancelled ids", async () => {
    mockCancelMarketOrders.mockResolvedValue({ canceled: ["a"], not_canceled: { b: "order not found" } });
    const r = await POLYMARKET_HANDLERS["polymarket.clob.cancelMarket"]!(PARAMS, SIGNING_CTX);
    expect(r.success).toBe(true);
    const items = r.data?._tradeCaptureItems as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
  });
});
