/**
 * DecisionsSection render tests (memory-system S10).
 *
 * Verifies: the decision-type filter pills drive the query (default = all),
 * rows render sanitized audit fields only (injected raw `evidence_refs` /
 * `decision_hash` never reach the DOM), the section stays READ-ONLY (no row
 * action buttons), and empty/error states render.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

const { DecisionsSection } = await import("../DecisionsSection.js");

const ISO = "2026-05-21T10:00:00.000Z";
const UUID = "11112222-0000-4000-8000-0000000000c1";

function ok<T>(data: T) {
  return { ok: true as const, data };
}

function decision(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "42",
    candidateId: UUID,
    reconcileEntryId: null,
    jobId: 7,
    decisionVersion: 0,
    decisionType: "promote",
    rejectReason: null,
    promotedKnowledgeId: 12,
    supersedesKnowledgeId: null,
    mergeTargetKnowledgeId: null,
    outcomeVersion: null,
    inferenceProvider: "openrouter",
    inferenceModel: "m",
    costUsd: 0.0123,
    decidedBy: "manager",
    decidedAt: ISO,
    ...overrides,
  };
}

const listDecisionsMock = vi.fn();

function setVex(): void {
  Object.defineProperty(window, "vex", {
    configurable: true,
    writable: true,
    value: { memoryInspector: { listDecisions: listDecisionsMock } },
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
  vi.clearAllMocks();
  // @ts-expect-error — test cleanup
  delete window.vex;
});

describe("DecisionsSection", () => {
  it("renders sanitized decision rows without mutation buttons", async () => {
    listDecisionsMock.mockResolvedValue(
      ok([
        decision({
          // Injected raw columns the panel must NEVER render even if present.
          evidence_refs: "SECRET_EVIDENCE_REFS",
          decision_hash: "SECRET_DECISION_HASH",
        }),
      ]),
    );
    setVex();
    const { container } = render(createElement(DecisionsSection), {
      wrapper: makeWrapper(freshClient()),
    });

    await waitFor(() => {
      expect(listDecisionsMock).toHaveBeenCalledWith({ limit: 100 });
    });
    await waitFor(() => {
      expect(
        container.querySelector("[data-vex-decision-type]"),
      ).not.toBeNull();
    });
    // Sanitized audit fields render: type, short candidate id, outcome link,
    // actor, cost, decided-at.
    expect(screen.getByText("promote")).not.toBeNull();
    expect(screen.getByText("cand 11112222")).not.toBeNull();
    expect(screen.getByText("→ memory #12")).not.toBeNull();
    expect(screen.getByText("by manager")).not.toBeNull();
    expect(screen.getByText("$0.0123")).not.toBeNull();
    expect(container.querySelector("[data-vex-decided]")).not.toBeNull();
    // Raw audit internals must never reach the DOM.
    expect(screen.queryByText("SECRET_EVIDENCE_REFS")).toBeNull();
    expect(screen.queryByText("SECRET_DECISION_HASH")).toBeNull();
    // READ-ONLY: rows never carry an action button — only filter pills exist.
    expect(container.querySelectorAll("li button")).toHaveLength(0);
  });

  it("shows rejectReason and supersede/merge outcome links when present", async () => {
    listDecisionsMock.mockResolvedValue(
      ok([
        decision({
          id: "43",
          decisionType: "reject",
          rejectReason: "low_confidence",
          promotedKnowledgeId: null,
          supersedesKnowledgeId: 5,
          mergeTargetKnowledgeId: 6,
          costUsd: null,
        }),
      ]),
    );
    setVex();
    render(createElement(DecisionsSection), {
      wrapper: makeWrapper(freshClient()),
    });

    await waitFor(() => {
      expect(screen.getByText("low_confidence")).not.toBeNull();
    });
    expect(screen.getByText("supersedes #5")).not.toBeNull();
    expect(screen.getByText("merged into #6")).not.toBeNull();
  });

  it("decision-type filter pills re-query with the chosen type", async () => {
    listDecisionsMock.mockResolvedValue(ok([]));
    setVex();
    render(createElement(DecisionsSection), {
      wrapper: makeWrapper(freshClient()),
    });

    await waitFor(() => {
      expect(listDecisionsMock).toHaveBeenCalledWith({ limit: 100 });
    });
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    await waitFor(() => {
      expect(listDecisionsMock).toHaveBeenCalledWith({
        decisionType: "reject",
        limit: 100,
      });
    });
  });

  it("shows the empty state when nothing matches", async () => {
    listDecisionsMock.mockResolvedValue(ok([]));
    setVex();
    render(createElement(DecisionsSection), {
      wrapper: makeWrapper(freshClient()),
    });

    await waitFor(() => {
      expect(screen.getByText(/No decisions match/i)).not.toBeNull();
    });
  });

  it("surfaces a list error", async () => {
    listDecisionsMock.mockResolvedValue({
      ok: false as const,
      error: {
        code: "internal.unexpected",
        domain: "memory",
        message: "Unable to load memory inspector data.",
        retryable: true,
        userActionable: false,
        redacted: true,
      },
    });
    setVex();
    render(createElement(DecisionsSection), {
      wrapper: makeWrapper(freshClient()),
    });

    await waitFor(() => {
      expect(
        screen.getByText("Unable to load memory inspector data."),
      ).not.toBeNull();
    });
  });
});
