import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Position } from "../../../vex-agent/db/repos/open-positions.js";
import type { LoopWakeRequest } from "../../../vex-agent/db/repos/loop-wake.js";
import type { MissionRun } from "../../../vex-agent/db/repos/mission-runs.js";
import type { MessageWithId } from "../../../vex-agent/db/repos/messages.js";
import type { HyperliquidReconcilerDeps } from "../../../vex-agent/sync/hyperliquid-reconciler.js";
import { reconcileHyperliquid, recordHyperliquidUserEvent } from "../../../vex-agent/sync/hyperliquid-reconciler.js";

function position(overrides: Partial<Position> = {}): Position {
  return {
    id: 1, namespace: "hyperliquid", positionType: "perps", chain: "hyperliquid",
    externalId: "hyperliquid:perp:BTC:0x1111111111111111111111111111111111111111",
    walletAddress: "0x1111111111111111111111111111111111111111",
    instrumentKey: "hyperliquid:perp:BTC",
    positionKey: "hyperliquid:perp:BTC:0x1111111111111111111111111111111111111111",
    entryPriceUsd: "80", currentValueUsd: null, unrealizedPnlUsd: null,
    notionalUsd: "800", feeUsd: null, contracts: "10", settlementAssetKey: "USDC",
    data: { coin: "BTC" }, status: "open", openedAt: null, closedAt: null,
    ...overrides,
  };
}

function state(szi = "10") {
  return {
    marginSummary: { accountValue: "1000" },
    withdrawable: "750",
    assetPositions: [{ position: {
      coin: "BTC", szi, entryPx: "80", unrealizedPnl: "18",
      cumFunding: { sinceOpen: "2" },
    } }],
  };
}

function metaAndAssetCtxs() {
  return [{ universe: [
    { name: "BTC" }, { name: "ETH" }, { name: "SOL" }, { name: "HYPE" },
  ] }, [
    { markPx: "100", openInterest: "1000", prevDayPx: "80" },
    { markPx: "50", openInterest: "900" },
    { markPx: "20", openInterest: "800" },
    { markPx: "10", openInterest: "700" },
  ]];
}

function fixedSizeStop() {
  return [{ coin: "BTC", reduceOnly: true, isTrigger: true, triggerCondition: "stop", isBuy: false, oid: 7, triggerPx: "70", origSz: "10" }];
}

function missionRun(): MissionRun {
  return {
    id: "run-1", missionId: "mission-1", sessionId: "session-1", status: "paused_wake",
    startedAt: "2026-07-11T11:00:00.000Z", endedAt: null, lastCheckpointAt: null,
    stopReason: null, stopSummary: null, stopEvidenceJson: null, iterationCount: 0,
    contractSnapshotJson: null, recoveredFromRunId: null, errorRetryCount: 0, autoRetryUnsafe: false,
  };
}

function pendingWake(): LoopWakeRequest {
  return {
    id: "wake-1", sessionId: "session-1", missionRunId: "run-1", dueAt: "2026-07-11T12:00:00.000Z",
    status: "pending", reason: "wait", payload: null, createdAt: "2026-07-11T11:00:00.000Z",
    consumedAt: null, cancelledAt: null, cancelledReason: null,
  };
}

function engineMessage(): MessageWithId {
  return { id: 1, role: "system", content: "notice", timestamp: "2026-07-11T11:00:00.000Z" };
}

describe("Hyperliquid reconciler", () => {
  let captures: Array<Record<string, unknown>>;
  let openPositions: Position[];
  let activeTargets: Array<{ walletAddress: string; positionKey: string; instrumentKey: string | null; captureStatus: string }>;
  let stateResponse: unknown;
  let ordersResponse: unknown;
  let promotePendingWakeForSafety: ReturnType<typeof vi.fn>;

  function deps(): HyperliquidReconcilerDeps {
    return {
      createInfoClient: () => ({
        metaAndAssetCtxs: async () => metaAndAssetCtxs(),
        clearinghouseState: async () => stateResponse,
        frontendOpenOrders: async () => ordersResponse,
        userFills: async () => [],
      }),
      getOpenPositions: async () => openPositions,
      getActiveTargets: async () => activeTargets,
      recordSyntheticCapture: async (input) => { captures.push(input.tradeCapture); return captures.length; },
      getLatestSessionIdForPosition: async () => "session-1",
      getActiveRunBySession: async () => missionRun(),
      getPendingForSession: async () => pendingWake(),
      promotePendingWakeForSafety,
      enqueueWake: async () => null,
      appendEngineMessage: async () => engineMessage(),
    };
  }

  beforeEach(() => {
    captures = [];
    openPositions = [position()];
    activeTargets = [];
    stateResponse = state();
    ordersResponse = fixedSizeStop();
    promotePendingWakeForSafety = vi.fn().mockResolvedValue(true);
  });

  it("records a CONSOLIDATING snapshot with capture-derived MTM and promotes its owning wake", async () => {
    const result = await reconcileHyperliquid(deps());
    expect(result).toMatchObject({ checked: 1, captured: 1, consolidating: 1, unprotected: 0 });
    expect(captures[0]).toMatchObject({ currentValueUsd: "1000", unrealizedPnlUsd: "20" });
    expect(captures[0]).toMatchObject({
      meta: {
        protectionState: "CONSOLIDATING",
        accountEquityUsd: "1000",
        accountWithdrawableUsd: "750",
        accountTotalUnrealizedPnlUsd: "18",
        // Wave-1 F1: the strict metaAndAssetCtxs schema now ACCEPTS a null
        // prevDayPx (aligned with the IPC parser), so the required-coin trio
        // flows through with change24hPct null instead of being dropped.
        marketWatchlist: [
          expect.objectContaining({ coin: "BTC", midPx: "100", openInterestUsd: "100000", change24hPct: "25" }),
          expect.objectContaining({ coin: "ETH", change24hPct: null }),
          expect.objectContaining({ coin: "SOL", change24hPct: null }),
          expect.objectContaining({ coin: "HYPE", change24hPct: null }),
        ],
      },
    });
    expect(promotePendingWakeForSafety).toHaveBeenCalledWith("session-1", "run-1");
  });

  it("is idempotent when the stored position already has the same snapshot version", async () => {
    await reconcileHyperliquid(deps());
    const initialCapture = captures[0];
    if (initialCapture === undefined || !isRecord(initialCapture.meta)) throw new Error("Expected reconciliation capture metadata.");
    openPositions[0] = position({ data: initialCapture.meta });
    const result = await reconcileHyperliquid(deps());
    expect(result).toMatchObject({ captured: 0, skipped: 1 });
    expect(captures).toHaveLength(1);
  });

  it("escalates repeated consolidation failures without pretending the fixed-size child vanished", async () => {
    openPositions = [position({
      data: { coin: "BTC", consolidationFailureCount: 2, protectionEscalation: "UNPROTECTED" },
    })];
    const result = await reconcileHyperliquid(deps());
    expect(result).toMatchObject({ captured: 1, consolidating: 0, unprotected: 1 });
    expect(captures[0]).toMatchObject({
      meta: { protectionState: "CONSOLIDATING", protectionEscalation: "UNPROTECTED" },
    });
  });

  it("maps a websocket liquidation followed by an absent position to liquidated", async () => {
    stateResponse = { assetPositions: [] };
    ordersResponse = [];
    recordHyperliquidUserEvent("0x1111111111111111111111111111111111111111", {
      liquidation: { liquidated_user: "0x1111111111111111111111111111111111111111" },
    });
    const result = await reconcileHyperliquid(deps());
    expect(result.liquidated).toBe(1);
    expect(captures[0]?.status).toBe("liquidated");
  });

  it("maps an absent position without liquidation evidence to an external close", async () => {
    stateResponse = { assetPositions: [] };
    ordersResponse = [];
    const result = await reconcileHyperliquid(deps());
    expect(result.closed).toBe(1);
    expect(captures[0]?.status).toBe("closed");
  });

  it("captures a vanished pending entry as cancelled", async () => {
    openPositions = [];
    activeTargets = [{
      walletAddress: "0x1111111111111111111111111111111111111111",
      positionKey: "hyperliquid:perp:BTC:0x1111111111111111111111111111111111111111",
      instrumentKey: "hyperliquid:perp:BTC",
      captureStatus: "pending",
    }];
    stateResponse = { assetPositions: [] };
    ordersResponse = [];
    const result = await reconcileHyperliquid(deps());
    expect(result.cancelled).toBe(1);
    expect(captures[0]?.status).toBe("cancelled");
  });

  it("does not make a venue request when no Hyperliquid state is tracked", async () => {
    openPositions = [];
    activeTargets = [];
    const result = await reconcileHyperliquid(deps());
    expect(result).toMatchObject({ checked: 0, captured: 0, errors: 0 });
  });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
