/**
 * Regression pins for the funding header stat (owner-reported: ticking
 * countdown reflowed the header and the timeframe selector could overlap
 * the funding block at narrower pane widths).
 */

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HyperliquidMarketDto } from "@shared/schemas/hyperliquid.js";
import { MarketStatsStrip } from "../HypervexingChartPane.js";

function market(overrides: Partial<HyperliquidMarketDto> = {}): HyperliquidMarketDto {
  return {
    coin: "CASHCAT",
    maxLeverage: 10,
    markPx: "0.1931",
    change24hPct: "1.23",
    openInterestUsd: "1000000",
    fundingRate8hPct: "0.0001",
    dayNtlVlmUsd: "500000",
    szDecimals: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-14T00:00:01.000Z"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("MarketStatsStrip funding stat", () => {
  it("stacks the countdown above the FUNDING label instead of inline", () => {
    render(<MarketStatsStrip market={market()} />);
    const label = screen.getByText("Funding");
    const countdown = screen.getByText("59:59");
    // Countdown renders as its own element ABOVE (preceding in DOM order)
    // the "Funding" label — never concatenated into one "Funding · 59:59"
    // string.
    expect(countdown).not.toBe(label);
    expect(countdown.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("gives the countdown a fixed width so a per-second tick cannot change its footprint", () => {
    render(<MarketStatsStrip market={market()} />);
    const countdown = screen.getByText("59:59");
    const classNameBefore = countdown.className;
    expect(classNameBefore).toContain("w-[5ch]");
    expect(classNameBefore).toContain("tabular-nums");
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    const tickedCountdown = screen.getByText("59:57");
    expect(tickedCountdown.className).toBe(classNameBefore);
  });

  it("reserves its own full-width row unconditionally, so the timeframe selector can never share a row with it at any pane width", () => {
    const { container } = render(<MarketStatsStrip market={market()} />);
    const strip = container.firstElementChild;
    expect(strip).not.toBeNull();
    // No viewport-breakpoint (`xl:`) classes: the row's width/order must not
    // depend on the browser viewport, since a chart pane's real width can be
    // far narrower than the viewport in a multi-pane layout.
    expect(strip?.className).toMatch(/\bw-full\b/);
    expect(strip?.className).toMatch(/\border-last\b/);
    expect(strip?.className).not.toMatch(/xl:/);
  });
});
