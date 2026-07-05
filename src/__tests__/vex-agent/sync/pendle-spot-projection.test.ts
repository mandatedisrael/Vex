/**
 * Pendle capture → spot lot projection regression (Codex fix): the handlers emit
 * RAW base-unit amount strings, because `projectSpotLot` BigInt()s the sell
 * `inputAmount` and opens buy lots with `outputAmount` as `quantityRaw` — a
 * human decimal ("1.5") would throw, an integer human amount would corrupt lot
 * quantities. This runs a decimal-PT-amount sell/redeem end-to-end through the
 * spot projection (mocked repos) and pins the raw quantities.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseUnits } from "viem";

vi.mock("@utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const mockOpenLot = vi.fn();
vi.mock("@vex-agent/db/repos/pnl-lots.js", () => ({
  openLot: (...a: unknown[]) => mockOpenLot(...a),
}));

// Transactional sell path — projectSpotSell dynamically imports getPool().
const mockQuery = vi.fn();
const mockClient = { query: (...a: unknown[]) => mockQuery(...a), release: vi.fn() };
vi.mock("@vex-agent/db/client.js", () => ({
  getPool: () => ({ connect: async () => mockClient }),
}));

const { projectSpotLot } = await import("../../../vex-agent/sync/projectors/spot.js");
import type { Activity } from "@vex-agent/db/repos/activity.js";

const PT = "0x1a69154f6f6247e4457332860fb173251a36e03f";
const WALLET = "0x742d35cc6634c0532925a3b844bc454e4438f44e";
// A DECIMAL human amount (1.5 PT) — the handler converts it to raw wei exactly
// like `handlers/pt.ts` does (parseUnits(amountIn, ptDecimals).toString()).
const RAW_1_5_PT = parseUnits("1.5", 18).toString(); // "1500000000000000000"

function pendleActivity(over: Partial<Record<keyof Activity, unknown>>): Activity {
  return {
    id: 7,
    executionId: 42,
    namespace: "pendle",
    chain: "ethereum",
    instrumentKey: `ethereum:${PT}`,
    walletAddress: WALLET,
    inputValueUsd: "1.49",
    outputValueUsd: "1.49",
    ...over,
  } as unknown as Activity;
}

beforeEach(() => {
  vi.clearAllMocks();
  // BEGIN → SELECT lots → UPDATE → INSERT match → COMMIT.
  mockQuery.mockImplementation(async (sql: string) => {
    if (typeof sql === "string" && sql.includes("FOR UPDATE")) {
      return {
        rows: [
          { id: 1, remaining_quantity_raw: parseUnits("2", 18).toString(), quantity_raw: parseUnits("2", 18).toString() },
        ],
      };
    }
    return { rows: [] };
  });
});

describe("pendle spot projection (raw base-unit amounts)", () => {
  it("a decimal-amount SELL/redeem projects without throwing and reduces the lot by the exact raw quantity", async () => {
    await projectSpotLot(
      pendleActivity({ tradeSide: "sell", inputAmount: RAW_1_5_PT, outputAmount: "1487000" }),
    );

    const calls = mockQuery.mock.calls;
    // Reduce: 2.0 PT lot − 1.5 PT = 0.5 PT remaining (exact raw arithmetic).
    const update = calls.find((c) => typeof c[0] === "string" && (c[0] as string).includes("UPDATE proj_pnl_lots"));
    expect(update).toBeDefined();
    expect((update![1] as unknown[])[1]).toBe(parseUnits("0.5", 18).toString());
    // Match ledger got the exact raw quantity sold.
    const insert = calls.find((c) => typeof c[0] === "string" && (c[0] as string).includes("INSERT INTO proj_pnl_matches"));
    expect(insert).toBeDefined();
    expect((insert![1] as unknown[])[4]).toBe(RAW_1_5_PT);
    // Transaction committed (no throw → no ROLLBACK).
    expect(calls.some((c) => c[0] === "COMMIT")).toBe(true);
    expect(calls.some((c) => c[0] === "ROLLBACK")).toBe(false);
  });

  it("a BUY opens the lot with the raw PT output quantity", async () => {
    await projectSpotLot(
      pendleActivity({ tradeSide: "buy", inputAmount: "1500000", outputAmount: RAW_1_5_PT }),
    );
    expect(mockOpenLot).toHaveBeenCalledTimes(1);
    expect((mockOpenLot.mock.calls[0]![0] as { quantityRaw: string }).quantityRaw).toBe(RAW_1_5_PT);
  });

  it("negative control: the OLD human-decimal format would throw in the sell path", async () => {
    await expect(
      projectSpotLot(pendleActivity({ tradeSide: "sell", inputAmount: "1.5", outputAmount: "1.487" })),
    ).rejects.toThrow();
  });
});
