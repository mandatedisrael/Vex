import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetOpen = vi.fn().mockResolvedValue([]);
const mockGetActivities = vi.fn().mockResolvedValue([]);
const mockGetByNamespace = vi.fn().mockResolvedValue([]);
const mockGetTotalUsd = vi.fn().mockResolvedValue(0);
const mockGetLatestSnapshot = vi.fn().mockResolvedValue(null);
const mockGetSnapshotHistory = vi.fn().mockResolvedValue([]);

vi.mock("@echo-agent/db/repos/open-positions.js", () => ({
  getOpen: (...a: unknown[]) => mockGetOpen(...a),
}));
vi.mock("@echo-agent/db/repos/activity.js", () => ({
  getActivities: (...a: unknown[]) => mockGetActivities(...a),
}));
vi.mock("@echo-agent/db/repos/executions.js", () => ({
  getByNamespace: (...a: unknown[]) => mockGetByNamespace(...a),
}));
vi.mock("@echo-agent/db/repos/balances.js", () => ({
  getTotalUsd: () => mockGetTotalUsd(),
  getLatestSnapshot: () => mockGetLatestSnapshot(),
  getSnapshotHistory: (...a: unknown[]) => mockGetSnapshotHistory(...a),
}));

const mockGetTotalRealizedPnl = vi.fn().mockResolvedValue(null);
vi.mock("@echo-agent/db/repos/pnl-matches.js", () => ({
  getTotalRealizedPnl: (...a: unknown[]) => mockGetTotalRealizedPnl(...a),
}));

vi.mock("@echo-agent/db/client.js", () => ({
  execute: vi.fn(), query: vi.fn().mockResolvedValue([]), queryOne: vi.fn().mockResolvedValue(null),
}));

const { handlePortfolioInspect } = await import("../../../../echo-agent/tools/internal/portfolio-inspect.js");

const ctx = { sessionId: "s1", loadedDocuments: new Map<string, string>(), loopMode: "off" as const, approved: false };

describe("portfolio_inspect tool", () => {
  beforeEach(() => vi.clearAllMocks());

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
      expect(mockGetOpen).toHaveBeenCalledWith(undefined, "solana");
    });
  });

  describe("activity", () => {
    it("passes filters to getActivities", async () => {
      await handlePortfolioInspect({ view: "activity", namespace: "khalani", productType: "bridge", limit: 5 }, ctx);
      expect(mockGetActivities).toHaveBeenCalledWith({ namespace: "khalani", productType: "bridge", limit: 5 });
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
    it("calls getSnapshotHistory with 7d", async () => {
      await handlePortfolioInspect({ view: "snapshots" }, ctx);
      expect(mockGetSnapshotHistory).toHaveBeenCalledWith("7d");
    });
  });

  describe("summary", () => {
    it("aggregates data from multiple repos", async () => {
      mockGetTotalUsd.mockResolvedValueOnce(5000);
      mockGetOpen.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);
      mockGetLatestSnapshot.mockResolvedValueOnce({
        totalUsd: 4900, pnlVsPrev: 100, pnlPctVsPrev: 2.08,
        activeChains: 3, createdAt: "2026-03-29",
      });
      mockGetTotalRealizedPnl.mockResolvedValueOnce(null);
      const r = await handlePortfolioInspect({ view: "summary" }, ctx);
      expect(r.data!.totalBalanceUsd).toBe(5000);
      expect(r.data!.openPositionCount).toBe(2);
      expect(r.data!.realizedPnlUsd).toBeNull();
      expect(r.data!.unrealizedPnl).toBe("not_available_yet");
    });

    it("shows realized PnL when matches exist", async () => {
      mockGetTotalUsd.mockResolvedValueOnce(1000);
      mockGetOpen.mockResolvedValueOnce([]);
      mockGetLatestSnapshot.mockResolvedValueOnce(null);
      mockGetTotalRealizedPnl.mockResolvedValueOnce("42.50");
      const r = await handlePortfolioInspect({ view: "summary" }, ctx);
      expect(r.data!.realizedPnlUsd).toBe(42.50);
    });
  });
});
