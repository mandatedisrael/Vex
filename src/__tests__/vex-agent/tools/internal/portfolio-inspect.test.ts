import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetOpen = vi.fn().mockResolvedValue([]);
const mockGetActivities = vi.fn().mockResolvedValue([]);
const mockGetByNamespace = vi.fn().mockResolvedValue([]);
const mockGetTotalUsd = vi.fn().mockResolvedValue(0);
const mockGetLatestAggregateSnapshot = vi.fn().mockResolvedValue(null);
const mockGetAggregateSnapshots = vi.fn().mockResolvedValue([]);
const mockResolveSet = vi.fn().mockReturnValue({ evm: "0xEVM", solana: "SOL", all: ["0xEVM", "SOL"] });

vi.mock("@vex-agent/db/repos/open-positions.js", () => ({
  getOpen: (...a: unknown[]) => mockGetOpen(...a),
}));
vi.mock("@vex-agent/db/repos/activity.js", () => ({
  getActivities: (...a: unknown[]) => mockGetActivities(...a),
}));
vi.mock("@vex-agent/db/repos/executions.js", () => ({
  getByNamespace: (...a: unknown[]) => mockGetByNamespace(...a),
}));
vi.mock("@vex-agent/db/repos/balances.js", () => ({
  getTotalUsd: (...a: unknown[]) => mockGetTotalUsd(...a),
  getLatestAggregateSnapshot: (...a: unknown[]) => mockGetLatestAggregateSnapshot(...a),
  getAggregateSnapshots: (...a: unknown[]) => mockGetAggregateSnapshots(...a),
}));

// Mock ONLY resolveSelectedAddressSet so the handler test controls the wallet
// set; keep the REAL walletScopeErrorToResult so fail-closed behaviour is real.
vi.mock("../../../../vex-agent/tools/internal/wallet/resolve.js", async () => {
  const actual = await vi.importActual<typeof import("../../../../vex-agent/tools/internal/wallet/resolve.js")>(
    "../../../../vex-agent/tools/internal/wallet/resolve.js",
  );
  return { ...actual, resolveSelectedAddressSet: (...a: unknown[]) => mockResolveSet(...a) };
});

const mockGetTotalRealizedPnl = vi.fn().mockResolvedValue(null);
vi.mock("@vex-agent/db/repos/pnl-matches.js", () => ({
  getTotalRealizedPnl: (...a: unknown[]) => mockGetTotalRealizedPnl(...a),
}));

const mockResolvePortfolioChainIds = vi.fn().mockResolvedValue(new Map());
vi.mock("@vex-agent/sync/portfolio-chain-map.js", () => ({
  resolvePortfolioChainIds: (...a: unknown[]) => mockResolvePortfolioChainIds(...a),
  getPortfolioChainId: (chainIds: ReadonlyMap<string, number>, chain: string) =>
    chainIds.get(chain.trim().toLowerCase()),
}));

vi.mock("@vex-agent/db/client.js", () => ({
  execute: vi.fn(), query: vi.fn().mockResolvedValue([]), queryOne: vi.fn().mockResolvedValue(null),
}));

const { handlePortfolioInspect } = await import("../../../../vex-agent/tools/internal/portfolio-inspect.js");
import { makeTestContext } from "../_test-context.js";
import { VexError, ErrorCodes } from "../../../../errors.js";

const ctx = makeTestContext({ sessionId: "s1" });

describe("portfolio_inspect tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolvePortfolioChainIds.mockResolvedValue(new Map());
    mockResolveSet.mockReturnValue({ evm: "0xEVM", solana: "SOL", all: ["0xEVM", "SOL"] });
  });

  it("rejects invalid view", async () => {
    const r = await handlePortfolioInspect({ view: "invalid" }, ctx);
    expect(r.success).toBe(false);
    expect(r.output).toContain("Invalid view");
  });

  describe("open_positions", () => {
    it("returns empty when no positions", async () => {
      const r = await handlePortfolioInspect({ view: "open_positions" }, ctx);
      expect(r.success).toBe(true);
      expect(r.data!.count).toBe(0);
    });

    it("returns positions with correct fields", async () => {
      mockGetOpen.mockResolvedValueOnce([{
        namespace: "solana", positionType: "perps", chain: "solana",
        walletAddress: "0x1", instrumentKey: "SOL-PERP", positionKey: "pk1",
        entryPriceUsd: 150, currentValueUsd: 160, unrealizedPnlUsd: 10,
        status: "open", openedAt: "2026-03-29",
      }]);
      const r = await handlePortfolioInspect({ view: "open_positions" }, ctx);
      expect(r.data!.count).toBe(1);
      const pos = (r.data!.positions as any[])[0];
      expect(pos.namespace).toBe("solana");
      expect(pos.unrealizedPnl).toBe(10);
    });

    it("passes namespace filter", async () => {
      await handlePortfolioInspect({ view: "open_positions", namespace: "solana" }, ctx);
      expect(mockGetOpen).toHaveBeenCalledWith(["0xEVM", "SOL"], "solana");
    });
  });

  describe("activity", () => {
    it("passes the wallet set + filters to getActivities", async () => {
      await handlePortfolioInspect({ view: "activity", namespace: "khalani", productType: "bridge", limit: 5 }, ctx);
      expect(mockGetActivities).toHaveBeenCalledWith({ addresses: ["0xEVM", "SOL"], namespace: "khalani", productType: "bridge", limit: 5 });
    });
  });

  describe("executions", () => {
    it("works without namespace (full history)", async () => {
      const r = await handlePortfolioInspect({ view: "executions" }, ctx);
      expect(r.success).toBe(true);
    });

    it("passes namespace and limit", async () => {
      await handlePortfolioInspect({ view: "executions", namespace: "solana", limit: 10 }, ctx);
      expect(mockGetByNamespace).toHaveBeenCalledWith("solana", 10);
    });
  });

  describe("balances", () => {
    it("returns totalUsd", async () => {
      mockGetTotalUsd.mockResolvedValueOnce(1234.56);
      const r = await handlePortfolioInspect({ view: "balances" }, ctx);
      expect(r.data!.totalUsd).toBe(1234.56);
    });
  });

  describe("snapshots", () => {
    it("calls getAggregateSnapshots with the wallet set + 7d", async () => {
      await handlePortfolioInspect({ view: "snapshots" }, ctx);
      expect(mockGetAggregateSnapshots).toHaveBeenCalledWith(["0xEVM", "SOL"], "7d");
    });
  });

  describe("summary", () => {
    it("aggregates data from multiple repos", async () => {
      mockGetTotalUsd.mockResolvedValueOnce(5000);
      mockGetOpen.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);
      mockGetLatestAggregateSnapshot.mockResolvedValueOnce({
        totalUsd: 4900, pnlVsPrev: 100, pnlPctVsPrev: 2.08,
        activeChains: ["1"], at: "2026-03-29",
      });
      mockGetTotalRealizedPnl.mockResolvedValueOnce(null);
      const { query } = await import("@vex-agent/db/client.js");
      // prediction MTM aggregate
      (query as any).mockResolvedValueOnce([{ total: null }]);
      // open spot lot count
      (query as any).mockResolvedValueOnce([{ count: "0" }]);
      // distinct spot lot chains
      (query as any).mockResolvedValueOnce([]);
      const r = await handlePortfolioInspect({ view: "summary" }, ctx);
      expect(r.data!.totalBalanceUsd).toBe(5000);
      expect(r.data!.openPositionCount).toBe(2);
      expect(r.data!.openSpotLotCount).toBe(0);
      expect(r.data!.realizedPnlUsd).toBeNull();
      expect(r.data!.unrealizedPnlUsd).toBeNull();
    });

    it("shows realized PnL when matches exist", async () => {
      mockGetTotalUsd.mockResolvedValueOnce(1000);
      mockGetOpen.mockResolvedValueOnce([]);
      mockGetLatestAggregateSnapshot.mockResolvedValueOnce(null);
      mockGetTotalRealizedPnl.mockResolvedValueOnce("42.50");
      const { query } = await import("@vex-agent/db/client.js");
      (query as any).mockResolvedValueOnce([{ total: null }]);
      (query as any).mockResolvedValueOnce([{ count: "0" }]);
      (query as any).mockResolvedValueOnce([]);
      const r = await handlePortfolioInspect({ view: "summary" }, ctx);
      expect(r.data!.realizedPnlUsd).toBe(42.50);
    });
  });

  describe("lots", () => {
    it("returns empty lots list", async () => {
      const r = await handlePortfolioInspect({ view: "lots" }, ctx);
      expect(r.success).toBe(true);
      expect(r.data!.view).toBe("lots");
      expect(r.data!.count).toBe(0);
    });

    it("returns lots with economics when DB has rows", async () => {
      const { query } = await import("@vex-agent/db/client.js");
      (query as any).mockResolvedValueOnce([{
        id: 1, instrument_key: "solana:BONK", namespace: "solana", chain: "solana",
        side: "buy", quantity_raw: "1000000", remaining_quantity_raw: "500000",
        cost_basis_usd: "5.25", price_usd: "0.00000525", status: "partial",
        opened_at: "2026-04-01", closed_at: null,
      }]);
      const r = await handlePortfolioInspect({ view: "lots", instrumentKey: "solana:BONK" }, ctx);
      expect(r.success).toBe(true);
      expect(r.data!.count).toBe(1);
      const lot = (r.data!.lots as any[])[0];
      expect(lot.costBasisUsd).toBe(5.25);
      expect(lot.priceUsd).toBe(0.00000525);
      expect(lot.status).toBe("partial");
    });
  });

  describe("profits", () => {
    it("returns empty profits list", async () => {
      const r = await handlePortfolioInspect({ view: "profits" }, ctx);
      expect(r.success).toBe(true);
      expect(r.data!.view).toBe("profits");
      expect(r.data!.count).toBe(0);
    });

    it("returns per-instrument realized PnL", async () => {
      const { query } = await import("@vex-agent/db/client.js");
      (query as any).mockResolvedValueOnce([{
        group_key: "solana:BONK",
        matched_count: "3", shortfall_count: "1",
        realized_pnl_usd: "1.25", total_cost_basis: "4.00", total_proceeds: "5.25",
        realized_pnl_native: null, benchmark_asset_key: "SOL",
      }]);
      const r = await handlePortfolioInspect({ view: "profits", instrumentKey: "solana:BONK" }, ctx);
      expect(r.success).toBe(true);
      expect(r.data!.count).toBe(1);
      const item = (r.data!.items as any[])[0];
      expect(item.realizedPnlUsd).toBe(1.25);
      expect(item.matchedCount).toBe(3);
      expect(item.shortfallCount).toBe(1);
    });
  });

  describe("closed_positions", () => {
    it("returns empty closed positions", async () => {
      const r = await handlePortfolioInspect({ view: "closed_positions" }, ctx);
      expect(r.success).toBe(true);
      expect(r.data!.view).toBe("closed_positions");
    });

    it("returns closed positions with economics", async () => {
      const { query } = await import("@vex-agent/db/client.js");
      (query as any).mockResolvedValueOnce([{
        namespace: "solana", position_type: "prediction", chain: "solana",
        instrument_key: "solana:predict:abc:yes", position_key: "pk1",
        entry_price_usd: "0.65", notional_usd: "2.00", status: "closed",
        opened_at: "2026-04-01", closed_at: "2026-04-01",
      }]);
      const r = await handlePortfolioInspect({ view: "closed_positions" }, ctx);
      expect(r.data!.count).toBe(1);
      const pos = (r.data!.positions as any[])[0];
      expect(pos.entryPrice).toBe(0.65);
      expect(pos.notionalUsd).toBe(2.00);
      expect(pos.status).toBe("closed");
    });
  });

  describe("non_trading_history", () => {
    it("returns empty non-trading history", async () => {
      const r = await handlePortfolioInspect({ view: "non_trading_history" }, ctx);
      expect(r.success).toBe(true);
      expect(r.data!.view).toBe("non_trading_history");
    });

    it("returns audit activities for non-trading flows", async () => {
      const { query } = await import("@vex-agent/db/client.js");
      (query as any).mockResolvedValueOnce([{
        namespace: "khalani", activity_type: "bridge", product_type: "bridge",
        chain: "ethereum", wallet_address: "0x1", capture_status: "executed",
        created_at: "2026-04-01",
      }]);
      const r = await handlePortfolioInspect({ view: "non_trading_history" }, ctx);
      expect(r.data!.count).toBe(1);
      const act = (r.data!.activities as any[])[0];
      expect(act.product).toBe("bridge");
      expect(act.namespace).toBe("khalani");
    });
  });

  describe("bridges", () => {
    it("returns bridge history", async () => {
      const { query } = await import("@vex-agent/db/client.js");
      (query as any).mockResolvedValueOnce([{
        namespace: "khalani", chain: "ethereum", wallet_address: "0x1",
        input_token: "USDC", input_amount: "1000000", output_token: "USDC",
        output_amount: "999000", capture_status: "executed", created_at: "2026-04-01",
      }]);
      const r = await handlePortfolioInspect({ view: "bridges" }, ctx);
      expect(r.success).toBe(true);
      expect(r.data!.view).toBe("bridges");
      expect(r.data!.count).toBe(1);
    });
  });

  describe("lp_history", () => {
    it("returns LP events", async () => {
      const { query } = await import("@vex-agent/db/client.js");
      (query as any).mockResolvedValueOnce([{
        namespace: "kyberswap", chain: "ethereum", instrument_key: "ethereum:lp:0xPool",
        position_key: "LP1", capture_status: "executed", meta: { action: "zap-in" },
        created_at: "2026-04-01",
      }]);
      const r = await handlePortfolioInspect({ view: "lp_history" }, ctx);
      expect(r.success).toBe(true);
      expect(r.data!.view).toBe("lp_history");
      expect(r.data!.count).toBe(1);
    });
  });

  describe("orders", () => {
    it("returns order lifecycle", async () => {
      const { query } = await import("@vex-agent/db/client.js");
      (query as any).mockResolvedValueOnce([{
        namespace: "kyberswap", chain: "polygon", instrument_key: "polygon:lo:0xA:0xB",
        position_key: "123", status: "open", opened_at: "2026-04-01", closed_at: null,
      }]);
      const r = await handlePortfolioInspect({ view: "orders" }, ctx);
      expect(r.success).toBe(true);
      expect(r.data!.view).toBe("orders");
      expect(r.data!.count).toBe(1);
    });
  });

  describe("unrealized", () => {
    it("returns empty when no open lots", async () => {
      const { query } = await import("@vex-agent/db/client.js");
      (query as any).mockResolvedValueOnce([]);
      const r = await handlePortfolioInspect({ view: "unrealized" }, ctx);
      expect(r.success).toBe(true);
      expect(r.data!.view).toBe("unrealized");
      expect(r.data!.count).toBe(0);
    });

    it("uses dynamic Khalani chain ids for Solana spot prices", async () => {
      const { query } = await import("@vex-agent/db/client.js");
      (query as any).mockResolvedValueOnce([{
        instrument_key: "solana:BonkMint",
        wallet_address: "SolWallet",
        namespace: "solana",
        chain: "solana",
        total_remaining_raw: "1000000",
        total_quantity_raw: "1000000",
        total_cost_basis_usd: "1.00",
        remaining_cost_basis_usd: "1.00",
        remaining_cost_basis_native: null,
        benchmark_asset_key: "SOL",
      }]);
      mockResolvePortfolioChainIds.mockResolvedValueOnce(new Map([["solana", 20011000000]]));
      (query as any).mockResolvedValueOnce([{ price_usd: "0.000002", decimals: 6 }]);

      const r = await handlePortfolioInspect({ view: "unrealized" }, ctx);

      expect(r.success).toBe(true);
      expect((query as any).mock.calls[1][1]).toEqual(["SolWallet", "BonkMint", 20011000000]);
      const item = (r.data!.instruments as any[])[0];
      expect(item.currentValueUsd).toBe(0.000002);
    });

    it("does not cross-chain match prices when chain is unresolved", async () => {
      const { query } = await import("@vex-agent/db/client.js");
      (query as any).mockResolvedValueOnce([{
        instrument_key: "unknown:Token",
        wallet_address: "0xWallet",
        namespace: "test",
        chain: "unknown",
        total_remaining_raw: "1000000",
        total_quantity_raw: "1000000",
        total_cost_basis_usd: "1.00",
        remaining_cost_basis_usd: "1.00",
        remaining_cost_basis_native: null,
        benchmark_asset_key: null,
      }]);
      mockResolvePortfolioChainIds.mockResolvedValueOnce(new Map());

      const r = await handlePortfolioInspect({ view: "unrealized" }, ctx);

      expect(r.success).toBe(true);
      expect((query as any).mock.calls).toHaveLength(1);
      const item = (r.data!.instruments as any[])[0];
      expect(item.currentPrice).toBeNull();
      expect(item.unrealizedPnlUsd).toBeNull();
    });
  });

  describe("summary with unrealized", () => {
    it("aggregates prediction MTM + spot unrealized", async () => {
      mockGetTotalUsd.mockResolvedValueOnce(1000);
      mockGetOpen.mockResolvedValueOnce([]);
      mockGetLatestAggregateSnapshot.mockResolvedValueOnce(null);
      mockGetTotalRealizedPnl.mockResolvedValueOnce("50.00");
      const { query } = await import("@vex-agent/db/client.js");
      // prediction MTM aggregate
      (query as any).mockResolvedValueOnce([{ total: "12.50" }]);
      // open spot lot count
      (query as any).mockResolvedValueOnce([{ count: "1" }]);
      // distinct spot lot chains
      (query as any).mockResolvedValueOnce([{ chain: "solana" }]);
      mockResolvePortfolioChainIds.mockResolvedValueOnce(new Map([["solana", 20011000000]]));
      // spot unrealized aggregate
      (query as any).mockResolvedValueOnce([{ total: "7.25" }]);
      const r = await handlePortfolioInspect({ view: "summary" }, ctx);
      expect(r.data!.unrealizedPnlUsd).toBe(19.75);
      expect(r.data!.openSpotLotCount).toBe(1);
    });
  });

  describe("per-session wallet scoping", () => {
    it("scopes reads to ONLY the session's selected wallet set", async () => {
      mockResolveSet.mockReturnValueOnce({ evm: "0xEVM", solana: "SOL", all: ["0xEVM", "SOL"] });
      mockGetTotalUsd.mockResolvedValueOnce(777);
      const r = await handlePortfolioInspect({ view: "balances" }, ctx);
      expect(mockGetTotalUsd).toHaveBeenCalledWith(["0xEVM", "SOL"]);
      expect(r.data!.totalUsd).toBe(777);
    });

    it("a session with no selected wallets passes an EMPTY set (never global)", async () => {
      mockResolveSet.mockReturnValueOnce({ evm: null, solana: null, all: [] });
      await handlePortfolioInspect({ view: "summary" }, ctx);
      expect(mockGetTotalUsd).toHaveBeenCalledWith([]);
    });

    it("fails closed on invalid wallet policy / scope drift (no repo query)", async () => {
      mockResolveSet.mockImplementationOnce(() => {
        throw new VexError(ErrorCodes.WALLET_SCOPE_MISMATCH, "contract drift");
      });
      const r = await handlePortfolioInspect({ view: "summary" }, ctx);
      expect(r.success).toBe(false);
      expect(mockGetTotalUsd).not.toHaveBeenCalled();
    });
  });
});
