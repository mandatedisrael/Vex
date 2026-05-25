/**
 * SessionRuntimeBar render tests (puzzle 06).
 *
 * The three facts render independently — crucially, usage is NOT gated on
 * model configuration (usage rows persist across config changes), so an
 * unconfigured model must still show historical usage. Context meter:
 * `null` result → no meter; `null` limit → token count without a bar;
 * both present → percentage bar.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

import { SessionRuntimeBar } from "../SessionRuntimeBar.js";

// Isolate from the @thesvg/@hugeicons brand-icon SVG lib.
vi.mock("../../wizard/steps/provider/ModelBrandIcon.js", () => ({
  ModelBrandIcon: () =>
    createElement("span", { "data-testid": "brand-icon" }),
}));

const SESSION = "00000000-0000-4000-8000-0000000000c1";
const ISO = "2026-05-21T10:00:00.000Z";

function ok<T>(data: T) {
  return { ok: true as const, data };
}

interface VexStub {
  readonly getModel: ReturnType<typeof vi.fn>;
  readonly getLastTurn: ReturnType<typeof vi.fn>;
  readonly getSessionTotals: ReturnType<typeof vi.fn>;
  readonly getContextWindow: ReturnType<typeof vi.fn>;
}

function setVex(stub: VexStub): void {
  Object.defineProperty(window, "vex", {
    configurable: true,
    writable: true,
    value: {
      sessions: { getModel: stub.getModel },
      usage: {
        getLastTurn: stub.getLastTurn,
        getSessionTotals: stub.getSessionTotals,
        getContextWindow: stub.getContextWindow,
      },
    },
  });
}

const MODEL_CONFIGURED = {
  sessionId: SESSION,
  provider: "openrouter",
  modelId: "anthropic/claude-opus-4.7",
  source: "global_default" as const,
  updatedAt: null,
};
const MODEL_UNCONFIGURED = {
  sessionId: SESSION,
  provider: null,
  modelId: null,
  source: "unconfigured" as const,
  updatedAt: null,
};

function totals(requestCount: number, totalCost: number | null) {
  return {
    sessionId: SESSION,
    totalPromptTokens: 50,
    totalCompletionTokens: 25,
    totalTokens: 75,
    totalCost,
    currency: "USD",
    requestCount,
    lastRequestAt: requestCount > 0 ? ISO : null,
  };
}

function lastTurn() {
  return {
    sessionId: SESSION,
    promptTokens: 50,
    completionTokens: 25,
    totalTokens: 75,
    cachedTokens: 0,
    reasoningTokens: 0,
    cost: 0.01,
    currency: "USD",
    provider: "openrouter",
    model: "anthropic/claude-opus-4.7",
    createdAt: ISO,
  };
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

describe("SessionRuntimeBar", () => {
  it("shows usage even when the model is unconfigured (usage not gated on model)", async () => {
    setVex({
      getModel: vi.fn().mockResolvedValue(ok(MODEL_UNCONFIGURED)),
      getLastTurn: vi.fn().mockResolvedValue(ok(lastTurn())),
      getSessionTotals: vi.fn().mockResolvedValue(ok(totals(1, 0.01))),
      getContextWindow: vi
        .fn()
        .mockResolvedValue(ok({ sessionId: SESSION, tokensUsed: 1000, contextLimit: 128000 })),
    });
    const { container } = render(
      createElement(SessionRuntimeBar, { sessionId: SESSION }),
      { wrapper: makeWrapper(freshClient()) },
    );

    await waitFor(() => {
      expect(
        container.querySelector(
          '[data-vex-area="session-model-indicator"][data-state="unconfigured"]',
        ),
      ).not.toBeNull();
      expect(
        container.querySelector('[data-vex-area="session-usage-chip"]'),
      ).not.toBeNull();
      expect(
        container.querySelector('[data-vex-area="session-context-meter"]'),
      ).not.toBeNull();
    });
  });

  it("shows the model name when configured and hides the usage chip with no turns", async () => {
    setVex({
      getModel: vi.fn().mockResolvedValue(ok(MODEL_CONFIGURED)),
      getLastTurn: vi.fn().mockResolvedValue(ok(null)),
      getSessionTotals: vi.fn().mockResolvedValue(ok(totals(0, null))),
      getContextWindow: vi.fn().mockResolvedValue(ok(null)),
    });
    const { container } = render(
      createElement(SessionRuntimeBar, { sessionId: SESSION }),
      { wrapper: makeWrapper(freshClient()) },
    );

    await waitFor(() => {
      const indicator = container.querySelector(
        '[data-vex-area="session-model-indicator"][data-state="configured"]',
      );
      expect(indicator).not.toBeNull();
      expect(indicator?.textContent).toContain("anthropic/claude-opus-4.7");
    });
    // No turns yet → no usage chip, and a null context result → no meter.
    expect(
      container.querySelector('[data-vex-area="session-usage-chip"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-vex-area="session-context-meter"]'),
    ).toBeNull();
  });

  it("renders a percentage bar when the context limit is present", async () => {
    setVex({
      getModel: vi.fn().mockResolvedValue(ok(MODEL_CONFIGURED)),
      getLastTurn: vi.fn().mockResolvedValue(ok(lastTurn())),
      getSessionTotals: vi.fn().mockResolvedValue(ok(totals(1, 0.01))),
      getContextWindow: vi
        .fn()
        .mockResolvedValue(ok({ sessionId: SESSION, tokensUsed: 64000, contextLimit: 128000 })),
    });
    const { container } = render(
      createElement(SessionRuntimeBar, { sessionId: SESSION }),
      { wrapper: makeWrapper(freshClient()) },
    );

    await waitFor(() => {
      const meter = container.querySelector(
        '[data-vex-area="session-context-meter"][data-state="ok"]',
      );
      expect(meter).not.toBeNull();
      expect(meter?.textContent).toContain("50%");
    });
  });

  it("shows token count without a bar when the context limit is null (invalid config)", async () => {
    setVex({
      getModel: vi.fn().mockResolvedValue(ok(MODEL_CONFIGURED)),
      getLastTurn: vi.fn().mockResolvedValue(ok(null)),
      getSessionTotals: vi.fn().mockResolvedValue(ok(totals(0, null))),
      getContextWindow: vi
        .fn()
        .mockResolvedValue(ok({ sessionId: SESSION, tokensUsed: 4096, contextLimit: null })),
    });
    const { container } = render(
      createElement(SessionRuntimeBar, { sessionId: SESSION }),
      { wrapper: makeWrapper(freshClient()) },
    );

    await waitFor(() => {
      const meter = container.querySelector(
        '[data-vex-area="session-context-meter"][data-state="no-limit"]',
      );
      expect(meter).not.toBeNull();
      expect(meter?.textContent).not.toContain("%");
    });
  });
});
