/**
 * CandidatesSection render tests (memory-system S10).
 *
 * Verifies: the default filter is the manager's pending inbox, the status
 * filter pills drive the query, rows render sanitized fields only (an
 * injected raw `content_md` never reaches the DOM), the section stays
 * READ-ONLY (no row action buttons), and empty/error states render.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

const { CandidatesSection } = await import("../CandidatesSection.js");

const ISO = "2026-05-21T10:00:00.000Z";
const UUID = "00000000-0000-4000-8000-0000000000c1";

function ok<T>(data: T) {
  return { ok: true as const, data };
}

function candidate(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: UUID,
    kind: "risk_rule",
    title: "Candidate Y",
    summary: "Keep slippage low",
    tags: [],
    source: "observed",
    confidence: 0.7,
    importance: 5,
    sensitivity: "normal",
    evidenceStrength: "weak",
    retrievalVisibility: "not_consolidated",
    status: "pending",
    recordedAt: ISO,
    promotedKnowledgeId: null,
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides,
  };
}

const listCandidatesMock = vi.fn();

function setVex(): void {
  Object.defineProperty(window, "vex", {
    configurable: true,
    writable: true,
    value: { memoryInspector: { listCandidates: listCandidatesMock } },
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

describe("CandidatesSection", () => {
  it("defaults to the pending filter and renders sanitized rows without mutation buttons", async () => {
    listCandidatesMock.mockResolvedValue(
      ok([
        candidate({
          // Injected raw column the panel must NEVER render even if present.
          content_md: "SECRET_CANDIDATE_BODY",
          promotedKnowledgeId: 12,
        }),
      ]),
    );
    setVex();
    const { container } = render(createElement(CandidatesSection), {
      wrapper: makeWrapper(freshClient()),
    });

    await waitFor(() => {
      expect(listCandidatesMock).toHaveBeenCalledWith({
        status: "pending",
        limit: 100,
      });
    });
    await waitFor(() => {
      expect(screen.getByText("Candidate Y")).not.toBeNull();
    });
    // Sanitized audit fields render.
    expect(screen.getByText("Keep slippage low")).not.toBeNull();
    expect(screen.getByText("observed")).not.toBeNull();
    expect(screen.getByText("evidence weak")).not.toBeNull();
    expect(screen.getByText("→ memory #12")).not.toBeNull();
    expect(container.querySelector("[data-vex-recorded]")).not.toBeNull();
    // Raw narrative must never reach the DOM.
    expect(screen.queryByText("SECRET_CANDIDATE_BODY")).toBeNull();
    // READ-ONLY: rows never carry an action button — only filter pills exist.
    expect(container.querySelectorAll("li button")).toHaveLength(0);
  });

  it("status filter pills re-query with the chosen status (All = no status)", async () => {
    listCandidatesMock.mockResolvedValue(ok([]));
    setVex();
    render(createElement(CandidatesSection), {
      wrapper: makeWrapper(freshClient()),
    });

    await waitFor(() => {
      expect(listCandidatesMock).toHaveBeenCalledWith({
        status: "pending",
        limit: 100,
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "Rejected" }));
    await waitFor(() => {
      expect(listCandidatesMock).toHaveBeenCalledWith({
        status: "rejected",
        limit: 100,
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    await waitFor(() => {
      expect(listCandidatesMock).toHaveBeenCalledWith({ limit: 100 });
    });
  });

  it("shows the empty state when nothing matches", async () => {
    listCandidatesMock.mockResolvedValue(ok([]));
    setVex();
    render(createElement(CandidatesSection), {
      wrapper: makeWrapper(freshClient()),
    });

    await waitFor(() => {
      expect(screen.getByText(/No candidates match/i)).not.toBeNull();
    });
  });

  it("surfaces a list error", async () => {
    listCandidatesMock.mockResolvedValue({
      ok: false as const,
      error: {
        code: "internal.unexpected",
        domain: "memory",
        message: "Database unavailable. Verify services are running and retry.",
        retryable: true,
        userActionable: true,
        redacted: true,
      },
    });
    setVex();
    render(createElement(CandidatesSection), {
      wrapper: makeWrapper(freshClient()),
    });

    await waitFor(() => {
      expect(
        screen.getByText(/Database unavailable/i),
      ).not.toBeNull();
    });
  });
});
