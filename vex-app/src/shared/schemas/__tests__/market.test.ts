import { describe, expect, it } from "vitest";
import {
  vexMarketSnapshotResultSchema,
  vexMarketSnapshotSchema,
} from "../market.js";

function snapshotFixture(overrides: Record<string, unknown> = {}) {
  return {
    priceUsd: 0.000543,
    priceChange: { h1: -1.73, h24: 113 },
    marketCap: 543068,
    fdv: 543068,
    liquidityUsd: 75189.01,
    volumeH24: 464284.04,
    txnsH24: { buys: 1235, sells: 856 },
    holderCount: 354,
    sparkline: [
      [1783166400, 0.000527],
      [1783170000, 0.00055],
    ],
    updatedAt: 1783172700000,
    stale: false,
    ...overrides,
  };
}

describe("vexMarketSnapshotSchema", () => {
  it("parses a full live snapshot", () => {
    expect(vexMarketSnapshotSchema.safeParse(snapshotFixture()).success).toBe(
      true,
    );
  });

  it("accepts an all-null degraded snapshot (feeds unavailable, empty sparkline)", () => {
    const parsed = vexMarketSnapshotSchema.safeParse({
      priceUsd: null,
      priceChange: { h1: null, h24: null },
      marketCap: null,
      fdv: null,
      liquidityUsd: null,
      volumeH24: null,
      txnsH24: null,
      holderCount: null,
      sparkline: [],
      updatedAt: 0,
      stale: true,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown key (strict)", () => {
    expect(
      vexMarketSnapshotSchema.safeParse(snapshotFixture({ extra: true })).success,
    ).toBe(false);
  });

  it("rejects a stray key inside priceChange (strict)", () => {
    expect(
      vexMarketSnapshotSchema.safeParse(
        snapshotFixture({ priceChange: { h1: 1, h24: 2, h6: 3 } }),
      ).success,
    ).toBe(false);
  });

  it("rejects a non-finite priceUsd (NaN/Infinity never cross the boundary)", () => {
    expect(
      vexMarketSnapshotSchema.safeParse(snapshotFixture({ priceUsd: Number.NaN }))
        .success,
    ).toBe(false);
    expect(
      vexMarketSnapshotSchema.safeParse(
        snapshotFixture({ priceUsd: Number.POSITIVE_INFINITY }),
      ).success,
    ).toBe(false);
  });

  it("rejects a negative or fractional txn count", () => {
    expect(
      vexMarketSnapshotSchema.safeParse(
        snapshotFixture({ txnsH24: { buys: -1, sells: 0 } }),
      ).success,
    ).toBe(false);
    expect(
      vexMarketSnapshotSchema.safeParse(
        snapshotFixture({ txnsH24: { buys: 1.5, sells: 0 } }),
      ).success,
    ).toBe(false);
  });

  it("rejects a negative holderCount but accepts null", () => {
    expect(
      vexMarketSnapshotSchema.safeParse(snapshotFixture({ holderCount: -3 }))
        .success,
    ).toBe(false);
    expect(
      vexMarketSnapshotSchema.safeParse(snapshotFixture({ holderCount: null }))
        .success,
    ).toBe(true);
  });

  it("rejects a malformed sparkline point (wrong arity / non-number)", () => {
    expect(
      vexMarketSnapshotSchema.safeParse(
        snapshotFixture({ sparkline: [[1783170000]] }),
      ).success,
    ).toBe(false);
    expect(
      vexMarketSnapshotSchema.safeParse(
        snapshotFixture({ sparkline: [["ts", "close"]] }),
      ).success,
    ).toBe(false);
  });

  it("result schema accepts null (no snapshot polled yet)", () => {
    expect(vexMarketSnapshotResultSchema.safeParse(null).success).toBe(true);
    expect(
      vexMarketSnapshotResultSchema.safeParse(snapshotFixture()).success,
    ).toBe(true);
  });
});
