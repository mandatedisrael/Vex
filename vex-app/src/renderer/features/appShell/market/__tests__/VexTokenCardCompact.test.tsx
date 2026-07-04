/**
 * VexTokenCardCompact render-state tests (T1, rail widget).
 *
 * Every state must resolve to a visible surface so the sessions rail is never
 * blank: loading skeleton, error line, the data card, the stale marker, and a
 * graceful empty-sparkline track. Data flows through the mocked
 * `window.vex.market` bridge; the live-sync effect's `onVexUpdate` is a no-op
 * unsubscribe here.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import type { Result } from "@shared/ipc/result.js";
import type { VexMarketSnapshot } from "@shared/schemas/market.js";
import { VexTokenCardCompact } from "../VexTokenCardCompact.js";

type SnapshotResult = Result<VexMarketSnapshot | null>;

function snapshot(overrides: Partial<VexMarketSnapshot> = {}): VexMarketSnapshot {
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

function setMarket(getVexSnapshot: () => Promise<SnapshotResult>): void {
  Object.defineProperty(window, "vex", {
    configurable: true,
    writable: true,
    value: {
      market: {
        getVexSnapshot,
        onVexUpdate: () => () => {},
      },
    },
  });
}

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

function freshClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

afterEach(() => {
  // @ts-expect-error — test cleanup
  delete window.vex;
});

describe("VexTokenCardCompact", () => {
  it("renders the data card with price, delta, the 2x2 stat grid, and a filled sparkline", async () => {
    setMarket(vi.fn().mockResolvedValue({ ok: true, data: snapshot() }));
    const { container } = render(createElement(VexTokenCardCompact), {
      wrapper: makeWrapper(freshClient()),
    });

    await waitFor(() => {
      const card = container.querySelector(
        '[data-vex-area="vex-token-compact"][data-state="data"]',
      );
      expect(card).not.toBeNull();
      expect(card?.getAttribute("aria-label")).toContain("$0.0005430");
    });
    expect(container.textContent).toContain("$0.0005430");
    expect(container.textContent).toContain("+113.00%");
    // The 2×2 micro-grid carries all four figures.
    expect(container.textContent).toContain("MCAP");
    expect(container.textContent).toContain("LIQ");
    expect(container.textContent).toContain("24H VOL");
    expect(container.textContent).toContain("HOLDERS");
    expect(container.textContent).toContain("354");
    expect(
      container.querySelector(
        '[data-vex-area="vex-token-sparkline"][data-empty="false"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-vex-area="vex-token-stale"]'),
    ).toBeNull();
  });

  it("shows a loading skeleton before the first snapshot arrives (ok(null))", async () => {
    setMarket(vi.fn().mockResolvedValue({ ok: true, data: null }));
    const { container } = render(createElement(VexTokenCardCompact), {
      wrapper: makeWrapper(freshClient()),
    });

    await waitFor(() => {
      expect(
        container.querySelector(
          '[data-vex-area="vex-token-compact"][data-state="loading"]',
        ),
      ).not.toBeNull();
    });
    // Never blank — the $VEX label is always present.
    expect(container.textContent).toContain("$VEX");
  });

  it("shows an error line when the bridge returns an error", async () => {
    setMarket(
      vi.fn().mockResolvedValue({
        ok: false,
        error: {
          code: "internal.unexpected",
          domain: "market",
          message: "boom",
          retryable: false,
          userActionable: false,
          redacted: true,
          correlationId: "c",
        },
      } satisfies SnapshotResult),
    );
    const { container } = render(createElement(VexTokenCardCompact), {
      wrapper: makeWrapper(freshClient()),
    });

    await waitFor(() => {
      expect(
        container.querySelector(
          '[data-vex-area="vex-token-compact"][data-state="error"]',
        ),
      ).not.toBeNull();
    });
    expect(container.textContent).toContain("Market data unavailable.");
  });

  it("surfaces the stale marker on a delayed snapshot", async () => {
    setMarket(
      vi.fn().mockResolvedValue({ ok: true, data: snapshot({ stale: true }) }),
    );
    const { container } = render(createElement(VexTokenCardCompact), {
      wrapper: makeWrapper(freshClient()),
    });

    await waitFor(() => {
      const card = container.querySelector(
        '[data-vex-area="vex-token-compact"][data-stale="true"]',
      );
      expect(card).not.toBeNull();
      expect(card?.getAttribute("aria-label")).toContain("data delayed");
    });
    expect(
      container.querySelector('[data-vex-area="vex-token-stale"]'),
    ).not.toBeNull();
  });

  it("renders the same token-driven card under the robinhood theme (sparkline re-tints via --vex-accent)", async () => {
    setMarket(vi.fn().mockResolvedValue({ ok: true, data: snapshot() }));
    const client = freshClient();
    const { container } = render(
      createElement(
        "div",
        { "data-vex-shell": "true", "data-vex-theme": "robinhood" },
        createElement(
          QueryClientProvider,
          { client },
          createElement(VexTokenCardCompact),
        ),
      ),
    );

    await waitFor(() => {
      expect(
        container.querySelector(
          '[data-vex-area="vex-token-compact"][data-state="data"]',
        ),
      ).not.toBeNull();
    });
    // The card carries no raw colour — the sparkline stroke is the theme token,
    // so it becomes neon lime in Robinhood mode with no component change.
    const path = container.querySelector(
      '[data-vex-area="vex-token-sparkline"] path',
    );
    expect(path?.getAttribute("stroke")).toBe("var(--vex-accent)");
  });

  it("degrades to a blank sparkline track when there are no closes", async () => {
    setMarket(
      vi.fn().mockResolvedValue({ ok: true, data: snapshot({ sparkline: [] }) }),
    );
    const { container } = render(createElement(VexTokenCardCompact), {
      wrapper: makeWrapper(freshClient()),
    });

    await waitFor(() => {
      expect(
        container.querySelector(
          '[data-vex-area="vex-token-compact"][data-state="data"]',
        ),
      ).not.toBeNull();
    });
    // Empty track present, no <path> drawn.
    const spark = container.querySelector(
      '[data-vex-area="vex-token-sparkline"][data-empty="true"]',
    );
    expect(spark).not.toBeNull();
    expect(spark?.tagName.toLowerCase()).not.toBe("svg");
  });
});
