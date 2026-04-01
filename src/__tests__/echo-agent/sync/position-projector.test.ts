import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (phase 3.1 — uses captureStatus, order lifecycle, LP actions) ──

const mockUpsertPosition = vi.fn().mockResolvedValue(undefined);
const mockClosePosition = vi.fn().mockResolvedValue(true);

vi.mock("@echo-agent/db/repos/open-positions.js", () => ({
  upsertPosition: (...args: unknown[]) => mockUpsertPosition(...args),
  closePosition: (...args: unknown[]) => mockClosePosition(...args),
}));

const mockOpenLot = vi.fn().mockResolvedValue(1);
const mockGetOpenLots = vi.fn().mockResolvedValue([]);
const mockReduceLot = vi.fn().mockResolvedValue(undefined);

vi.mock("@echo-agent/db/repos/pnl-lots.js", () => ({
  openLot: (...args: unknown[]) => mockOpenLot(...args),
  getOpenLots: (...args: unknown[]) => mockGetOpenLots(...args),
  reduceLot: (...args: unknown[]) => mockReduceLot(...args),
}));

const mockRecordMatchFromLot = vi.fn().mockResolvedValue(1);
const mockRecordShortfall = vi.fn().mockResolvedValue(1);

vi.mock("@echo-agent/db/repos/pnl-matches.js", () => ({
  recordMatchFromLot: (...args: unknown[]) => mockRecordMatchFromLot(...args),
  recordShortfall: (...args: unknown[]) => mockRecordShortfall(...args),
}));

const { projectPosition } = await import("../../../echo-agent/sync/position-projector.js");

function makeActivity(overrides: Record<string, unknown>) {
  return {
    id: 1, namespace: "solana", activityType: "perps", productType: "perps",
    tradeSide: null, chain: "solana", executionId: 100, walletAddress: "0xWallet",
    inputToken: null, inputAmount: null, outputToken: null, outputAmount: null,
    valueUsd: null, inputValueUsd: null, outputValueUsd: null, feeValueUsd: null,
    unitPriceUsd: null, valuationSource: null,
    captureStatus: null, positionKey: null, instrumentKey: null,
    externalRefs: {}, meta: {}, createdAt: new Date().toISOString(),
    captureItemId: null,
    ...overrides,
  } as any;
}

describe("position-projector", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  // ── Perps — uses captureStatus from _tradeCapture.status ──────

  describe("perps", () => {
    it("opens position when captureStatus=executed", async () => {
      await projectPosition(makeActivity({
        productType: "perps", positionKey: "PK1", captureStatus: "executed",
        instrumentKey: "solana:perps:SOL",
      }));
      expect(mockUpsertPosition).toHaveBeenCalledTimes(1);
      expect(mockUpsertPosition.mock.calls[0][0].status).toBe("open");
    });

    it("closes position when captureStatus=closed", async () => {
      await projectPosition(makeActivity({
        productType: "perps", positionKey: "PK1", captureStatus: "closed",
      }));
      expect(mockClosePosition).toHaveBeenCalledWith("solana", "perps", "PK1", "closed");
    });

    it("skips when no positionKey", async () => {
      await projectPosition(makeActivity({ productType: "perps", captureStatus: "executed" }));
      expect(mockUpsertPosition).not.toHaveBeenCalled();
    });
  });

  // ── Predictions ───────────────────────────────────────────────

  describe("predictions", () => {
    it("opens on captureStatus=open with entry price", async () => {
      await projectPosition(makeActivity({
        productType: "prediction", positionKey: "PK_pred", captureStatus: "open",
        instrumentKey: "solana:predict:abc:yes",
        unitPriceUsd: "0.65", inputValueUsd: "2.00", feeValueUsd: "0.02",
      }));
      expect(mockUpsertPosition).toHaveBeenCalledTimes(1);
      expect(mockUpsertPosition.mock.calls[0][0].entryPriceUsd).toBe("0.65");
      expect(mockUpsertPosition.mock.calls[0][0].notionalUsd).toBe("2.00");
      expect(mockUpsertPosition.mock.calls[0][0].feeUsd).toBe("0.02");
    });

    it("closes on captureStatus=claimed", async () => {
      await projectPosition(makeActivity({
        productType: "prediction", positionKey: "PK_pred", captureStatus: "claimed",
      }));
      expect(mockClosePosition).toHaveBeenCalledWith("solana", "prediction", "PK_pred", "closed");
    });

    it("cancels on captureStatus=cancelled", async () => {
      await projectPosition(makeActivity({
        productType: "prediction", positionKey: "PK_pred", captureStatus: "cancelled",
      }));
      expect(mockClosePosition).toHaveBeenCalledWith("solana", "prediction", "PK_pred", "cancelled");
    });
  });

  // ── Order lifecycle (DCA/limit) — NOT spot lots ───────────────

  describe("order lifecycle", () => {
    it("opens order position on captureStatus=open", async () => {
      await projectPosition(makeActivity({
        productType: "order", positionKey: "orderKey123", captureStatus: "open",
        instrumentKey: "solana:USDC",
      }));
      expect(mockUpsertPosition).toHaveBeenCalledTimes(1);
      expect(mockUpsertPosition.mock.calls[0][0].positionType).toBe("order");
    });

    it("cancels order on captureStatus=cancelled", async () => {
      await projectPosition(makeActivity({
        productType: "order", positionKey: "orderKey123", captureStatus: "cancelled",
      }));
      expect(mockClosePosition).toHaveBeenCalledWith("solana", "order", "orderKey123", "cancelled");
    });

    it("does NOT open FIFO lot", async () => {
      await projectPosition(makeActivity({
        productType: "order", positionKey: "orderKey123", captureStatus: "open",
        instrumentKey: "solana:USDC",
      }));
      expect(mockOpenLot).not.toHaveBeenCalled();
    });
  });

  // ── LP lifecycle (zap-in/out/migrate) ─────────────────────────

  describe("LP lifecycle", () => {
    it("opens on zap-in", async () => {
      await projectPosition(makeActivity({
        productType: "lp", positionKey: "LP_123", instrumentKey: "ethereum:lp:0xpool",
        meta: { action: "zap-in" }, namespace: "kyberswap", chain: "ethereum",
      }));
      expect(mockUpsertPosition).toHaveBeenCalledTimes(1);
      expect(mockUpsertPosition.mock.calls[0][0].positionType).toBe("lp");
    });

    it("closes on zap-out", async () => {
      await projectPosition(makeActivity({
        productType: "lp", positionKey: "LP_123",
        meta: { action: "zap-out" }, namespace: "kyberswap", chain: "ethereum",
      }));
      expect(mockClosePosition).toHaveBeenCalledWith("kyberswap", "lp", "LP_123", "closed");
    });

    it("close old + open new on zap-migrate", async () => {
      await projectPosition(makeActivity({
        productType: "lp", positionKey: "LP_123", instrumentKey: "ethereum:lp:0xNewPool",
        meta: { action: "zap-migrate", poolTo: "0xNewPool" },
        namespace: "kyberswap", chain: "ethereum",
      }));
      expect(mockClosePosition).toHaveBeenCalledWith("kyberswap", "lp", "LP_123", "migrated");
      expect(mockUpsertPosition).toHaveBeenCalledTimes(1);
    });
  });

  // ── Spot lots ─────────────────────────────────────────────────

  describe("spot lots", () => {
    it("opens lot on buy with economics", async () => {
      await projectPosition(makeActivity({
        productType: "spot", tradeSide: "buy", instrumentKey: "solana:USDC",
        outputAmount: "1000000", inputValueUsd: "5.25", unitPriceUsd: "0.00000525",
      }));
      expect(mockOpenLot).toHaveBeenCalledTimes(1);
      expect(mockOpenLot.mock.calls[0][0].costBasisUsd).toBe("5.25");
      expect(mockOpenLot.mock.calls[0][0].priceUsd).toBe("0.00000525");
    });

    it("opens lot without economics for none valuation", async () => {
      await projectPosition(makeActivity({
        productType: "spot", tradeSide: "buy", instrumentKey: "0g:0xToken",
        outputAmount: "1000000", valuationSource: "none",
      }));
      expect(mockOpenLot).toHaveBeenCalledTimes(1);
      expect(mockOpenLot.mock.calls[0][0].costBasisUsd).toBeUndefined();
    });

    it("skips zero-quantity buy", async () => {
      await projectPosition(makeActivity({
        productType: "spot", tradeSide: "buy", instrumentKey: "solana:USDC",
        outputAmount: "0",
      }));
      expect(mockOpenLot).not.toHaveBeenCalled();
    });

    it("FIFO reduces on sell and records matches", async () => {
      mockGetOpenLots.mockResolvedValueOnce([
        { id: 1, remainingQuantityRaw: "500000", quantityRaw: "500000", costBasisUsd: "2.50" },
        { id: 2, remainingQuantityRaw: "1000000", quantityRaw: "1000000", costBasisUsd: "5.00" },
      ]);
      await projectPosition(makeActivity({
        productType: "spot", tradeSide: "sell", instrumentKey: "solana:USDC",
        inputAmount: "700000", outputValueUsd: "3.50",
      }));
      expect(mockReduceLot).toHaveBeenCalledTimes(2);
      expect(mockReduceLot).toHaveBeenCalledWith(1, 500000n);
      expect(mockReduceLot).toHaveBeenCalledWith(2, 200000n);
      expect(mockRecordMatchFromLot).toHaveBeenCalledTimes(2);
      expect(mockRecordMatchFromLot.mock.calls[0][0].matchedQty).toBe("500000");
      expect(mockRecordMatchFromLot.mock.calls[0][0].sellOutputValueUsd).toBe("3.50");
      expect(mockRecordMatchFromLot.mock.calls[1][0].matchedQty).toBe("200000");
    });

    it("records shortfall when sell exceeds inventory", async () => {
      mockGetOpenLots.mockResolvedValueOnce([
        { id: 1, remainingQuantityRaw: "300000", quantityRaw: "500000", costBasisUsd: "1.50" },
      ]);
      await projectPosition(makeActivity({
        productType: "spot", tradeSide: "sell", instrumentKey: "solana:USDC",
        inputAmount: "500000", outputValueUsd: "2.50",
      }));
      expect(mockReduceLot).toHaveBeenCalledTimes(1);
      expect(mockRecordMatchFromLot).toHaveBeenCalledTimes(1);
      expect(mockRecordShortfall).toHaveBeenCalledTimes(1);
      expect(mockRecordShortfall.mock.calls[0][0].shortfallQty).toBe("200000");
    });
  });

  // ── Non-trading — skip ────────────────────────────────────────

  describe("skip", () => {
    it.each(["bridge", "lend", "stake", "reward"])("%s does nothing", async (type) => {
      await projectPosition(makeActivity({ productType: type }));
      expect(mockUpsertPosition).not.toHaveBeenCalled();
      expect(mockOpenLot).not.toHaveBeenCalled();
    });
  });

  // ── Cross-protocol 0G ─────────────────────────────────────────

  describe("cross-protocol 0G", () => {
    it("slop buy → lot, jaine sell → reduce + match", async () => {
      await projectPosition(makeActivity({
        productType: "spot", tradeSide: "buy", instrumentKey: "0g:0xToken",
        outputAmount: "5000000000000000000", namespace: "slop", chain: "0g",
      }));
      expect(mockOpenLot.mock.calls[0][0].instrumentKey).toBe("0g:0xToken");

      mockGetOpenLots.mockResolvedValueOnce([{ id: 10, remainingQuantityRaw: "5000000000000000000", quantityRaw: "5000000000000000000", costBasisUsd: null }]);
      await projectPosition(makeActivity({
        productType: "spot", tradeSide: "sell", instrumentKey: "0g:0xToken",
        inputAmount: "2000000000000000000", namespace: "jaine", chain: "0g",
      }));
      expect(mockReduceLot).toHaveBeenCalledWith(10, 2000000000000000000n);
      expect(mockRecordMatchFromLot).toHaveBeenCalledTimes(1);
    });
  });
});
