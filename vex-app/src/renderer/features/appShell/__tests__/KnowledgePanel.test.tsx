/**
 * KnowledgePanel render tests (stage 7-2a).
 *
 * Verifies: the global knowledge section renders sanitized rows; the
 * session-scoped sections show a clear empty state AND issue NO session-scoped
 * query when no session is active; with an active session, memory + compaction
 * history render from their DTOs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

const mockSetAppShellView = vi.hoisted(() => vi.fn());
const uiState = vi.hoisted(() => ({ activeSessionId: null as string | null }));

vi.mock("../../../stores/uiStore.js", () => ({
  useUiStore: (
    selector: (s: {
      setAppShellView: typeof mockSetAppShellView;
      activeSessionId: string | null;
    }) => unknown,
  ) =>
    selector({
      setAppShellView: mockSetAppShellView,
      activeSessionId: uiState.activeSessionId,
    }),
}));

const { KnowledgePanel } = await import("../KnowledgePanel.js");

const SESSION = "00000000-0000-4000-8000-0000000000d1";
const ISO = "2026-05-21T10:00:00.000Z";

function ok<T>(data: T) {
  return { ok: true as const, data };
}

const knowledgeListMock = vi.fn();
const updateStatusMock = vi.fn();
const listSessionMock = vi.fn();
const getStatsMock = vi.fn();
const listHistoryMock = vi.fn();
const modelsListMock = vi.fn();

function setVex(): void {
  Object.defineProperty(window, "vex", {
    configurable: true,
    writable: true,
    value: {
      knowledge: { list: knowledgeListMock, updateStatus: updateStatusMock },
      memory: { listSession: listSessionMock, getStats: getStatsMock },
      compaction: { listHistory: listHistoryMock },
      models: { listAvailable: modelsListMock },
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
  vi.clearAllMocks();
  uiState.activeSessionId = null;
  // @ts-expect-error — test cleanup
  delete window.vex;
});

beforeEach(() => {
  // Default: no model configured → the privacy section shows its idle copy.
  // Tests that exercise the configured path override this.
  modelsListMock.mockResolvedValue(
    ok({ source: "unconfigured", models: [], fetchedAt: null }),
  );
});

describe("KnowledgePanel", () => {
  it("renders knowledge audit fields (tags / source / created) without leaking raw narrative", async () => {
    knowledgeListMock.mockResolvedValue(
      ok([
        {
          id: 1,
          kind: "risk_rule",
          title: "Avoid X",
          summary: "Keep slippage low",
          tags: ["risk"],
          confidence: 0.8,
          status: "active",
          source: "observed",
          sourceSession: "sess-1234abcd",
          pinned: false,
          createdAt: ISO,
          updatedAt: ISO,
          // Injected raw column the panel must NEVER render even if present.
          content_md: "SECRET_KNOWLEDGE_BODY",
        },
      ]),
    );
    setVex();
    const { container } = render(createElement(KnowledgePanel), {
      wrapper: makeWrapper(freshClient()),
    });

    await waitFor(() => {
      expect(screen.getByText("Avoid X")).not.toBeNull();
    });
    expect(screen.getByText("Keep slippage low")).not.toBeNull();
    // Audit fields required by 7-2a.
    expect(screen.getByText("#risk")).not.toBeNull();
    expect(screen.getByText(/src sess-123/i)).not.toBeNull();
    expect(container.querySelector("[data-vex-created]")).not.toBeNull();
    // Raw narrative must never reach the DOM.
    expect(screen.queryByText("SECRET_KNOWLEDGE_BODY")).toBeNull();
  });

  it("shows empty hints AND issues no session-scoped query when no session is active", async () => {
    uiState.activeSessionId = null;
    knowledgeListMock.mockResolvedValue(ok([]));
    setVex();
    render(createElement(KnowledgePanel), { wrapper: makeWrapper(freshClient()) });

    await waitFor(() => {
      expect(screen.getByText(/Open a session to view its memory/i)).not.toBeNull();
    });
    expect(
      screen.getByText(/Open a session to view its compaction history/i),
    ).not.toBeNull();
    // The session-scoped hooks must be disabled — no IPC for memory/compaction.
    expect(listSessionMock).not.toHaveBeenCalled();
    expect(getStatsMock).not.toHaveBeenCalled();
    expect(listHistoryMock).not.toHaveBeenCalled();
  });

  it("renders memory + compaction history for the active session", async () => {
    uiState.activeSessionId = SESSION;
    knowledgeListMock.mockResolvedValue(ok([]));
    getStatsMock.mockResolvedValue(
      ok({
        activeCount: 2,
        compactCount: 3,
        unresolvedOutstandingCount: 1,
        recentThemes: ["kyber"],
      }),
    );
    listSessionMock.mockResolvedValue(
      ok([
        {
          id: 7,
          theme: "kyber_timeout",
          themeSource: "chunker",
          entities: [],
          protocols: [],
          errorClasses: [],
          chains: [],
          tasks: [],
          importance: 7,
          confidence: 0.9,
          status: "active",
          checkpointGeneration: 3,
          sourceStartMessageId: 10,
          sourceEndMessageId: 40,
          outstandingOpenCount: 2,
          outstandingResolvedCount: 1,
          createdAt: ISO,
          // Injected raw narrative the panel must never render.
          body_md: "SECRET_MEMORY_BODY",
        },
      ]),
    );
    listHistoryMock.mockResolvedValue(
      ok([
        {
          checkpointGeneration: 3,
          status: "completed",
          sourceStartMessageId: 10,
          sourceEndMessageId: 40,
          chunksInserted: 2,
          createdAt: ISO,
          startedAt: ISO,
          completedAt: ISO,
        },
      ]),
    );
    setVex();
    const { container } = render(createElement(KnowledgePanel), {
      wrapper: makeWrapper(freshClient()),
    });

    await waitFor(() => {
      expect(screen.getByText("kyber_timeout")).not.toBeNull();
    });
    // Outstanding shown as counts (never raw item text).
    expect(screen.getByText(/2 open \/ 1 done/i)).not.toBeNull();
    // Audit fields: confidence + a created-at element.
    expect(screen.getByText("conf 0.90")).not.toBeNull();
    expect(container.querySelector("[data-vex-created]")).not.toBeNull();
    // Raw narrative must never reach the DOM.
    expect(screen.queryByText("SECRET_MEMORY_BODY")).toBeNull();
    expect(listSessionMock).toHaveBeenCalled();
    expect(listHistoryMock).toHaveBeenCalled();
  });

  it("Back returns to the chat view", async () => {
    knowledgeListMock.mockResolvedValue(ok([]));
    setVex();
    render(createElement(KnowledgePanel), { wrapper: makeWrapper(freshClient()) });
    fireEvent.click(screen.getByRole("button", { name: /Back to chat/i }));
    expect(mockSetAppShellView).toHaveBeenCalledWith("session");
  });

  it("archives an active entry through the destructive confirm dialog (7-2b)", async () => {
    knowledgeListMock.mockResolvedValue(
      ok([
        {
          id: 1,
          kind: "risk_rule",
          title: "Avoid X",
          summary: "s",
          tags: [],
          confidence: null,
          status: "active",
          source: "observed",
          sourceSession: null,
          pinned: false,
          createdAt: ISO,
          updatedAt: ISO,
        },
      ]),
    );
    updateStatusMock.mockResolvedValue(ok({ id: 1, status: "archived" }));
    setVex();
    render(createElement(KnowledgePanel), { wrapper: makeWrapper(freshClient()) });

    await waitFor(() => {
      expect(screen.getByText("Avoid X")).not.toBeNull();
    });
    // Row action opens the destructive confirm. `/re-activated/` is unique to
    // the dialog copy (the section intro also mentions "one-way").
    fireEvent.click(screen.getByRole("button", { name: "Archive Avoid X" }));
    await waitFor(() => {
      expect(screen.getByText(/re-activated/i)).not.toBeNull();
    });
    // jsdom does not implement <dialog>.showModal(), so the modal's buttons
    // live in the hidden a11y tree — query with `hidden: true`.
    fireEvent.click(
      screen.getByRole("button", { name: "Archive", hidden: true }),
    );
    await waitFor(() => {
      expect(updateStatusMock).toHaveBeenCalledWith({
        id: 1,
        status: "archived",
      });
    });
  });

  it("shows no disable actions on non-active rows", async () => {
    knowledgeListMock.mockResolvedValue(
      ok([
        {
          id: 2,
          kind: "k",
          title: "Old Note",
          summary: "s",
          tags: [],
          confidence: null,
          status: "archived",
          source: "observed",
          sourceSession: null,
          pinned: false,
          createdAt: ISO,
          updatedAt: ISO,
        },
      ]),
    );
    setVex();
    render(createElement(KnowledgePanel), { wrapper: makeWrapper(freshClient()) });

    await waitFor(() => {
      expect(screen.getByText("Old Note")).not.toBeNull();
    });
    expect(
      screen.queryByRole("button", { name: "Archive Old Note" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Invalidate Old Note" }),
    ).toBeNull();
  });

  it("explains the Track-2 remote path and names the configured model (7-4)", async () => {
    knowledgeListMock.mockResolvedValue(ok([]));
    modelsListMock.mockResolvedValue(
      ok({
        source: "global_default",
        models: [
          {
            providerId: "openrouter",
            modelId: "anthropic/claude-opus-4-7",
            displayName: "Claude Opus 4.7",
            brand: "anthropic",
            contextLength: null,
            pricingInputPerMillion: null,
            pricingOutputPerMillion: null,
          },
        ],
        fetchedAt: null,
      }),
    );
    setVex();
    render(createElement(KnowledgePanel), { wrapper: makeWrapper(freshClient()) });

    // Live model — the same AGENT_MODEL the chunker calls — named via OpenRouter.
    await waitFor(() => {
      expect(screen.getByText("anthropic/claude-opus-4-7")).not.toBeNull();
    });
    expect(screen.getByText(/via OpenRouter/i)).not.toBeNull();
    // Redaction disclosure: exact tiers, and the no-unredacted-payloads claim.
    // The copy must NOT imply zero transcript-derived text leaves the machine.
    expect(screen.getByText(/wallet seeds, private keys/i)).not.toBeNull();
    // A redacted transcript copy IS sent — the disclosure must not imply
    // that nothing transcript-derived leaves the machine. The emphasized
    // word lives in its own span; the surrounding phrase is contiguous.
    expect(screen.getByText("redacted")).not.toBeNull();
    expect(
      screen.getByText(/copy of that archived transcript/i),
    ).not.toBeNull();
    expect(
      screen.getByText(/never include unredacted memory payloads/i),
    ).not.toBeNull();
  });

  it("shows the memory builder as idle when no model is configured (7-4)", async () => {
    knowledgeListMock.mockResolvedValue(ok([]));
    modelsListMock.mockResolvedValue(
      ok({ source: "unconfigured", models: [], fetchedAt: null }),
    );
    setVex();
    render(createElement(KnowledgePanel), { wrapper: makeWrapper(freshClient()) });

    await waitFor(() => {
      expect(
        screen.getByText(/idle until an OpenRouter model is configured/i),
      ).not.toBeNull();
    });
  });
});
