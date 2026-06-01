import { StrictMode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Result } from "@shared/ipc/result.js";
import type {
  ChatSubmitInput,
  ChatSubmitResult,
} from "@shared/schemas/chat.js";
import type { AbortableInvocation } from "@shared/types/bridge/common.js";
import type {
  SessionCreateInput,
  SessionDeleteResult,
  SessionListItem,
} from "@shared/schemas/sessions.js";
import type { HealthReport } from "@shared/schemas/system.js";
import { sessionKeys } from "../../../lib/api/sessions.js";
import { createQueryClient } from "../../../app/queryClient.js";
import { useUiStore } from "../../../stores/uiStore.js";

vi.mock("@hugeicons/react", () => ({
  HugeiconsIcon: () => null,
}));

vi.mock("@hugeicons/core-free-icons", () => ({
  Add01Icon: "Add01Icon",
  AiChat01Icon: "AiChat01Icon",
  AlertCircleIcon: "AlertCircleIcon",
  Archive02Icon: "Archive02Icon",
  ArrowDown01Icon: "ArrowDown01Icon",
  ArrowLeft01Icon: "ArrowLeft01Icon",
  ArrowRight01Icon: "ArrowRight01Icon",
  ArrowUp01Icon: "ArrowUp01Icon",
  BitcoinWalletIcon: "BitcoinWalletIcon",
  BridgeIcon: "BridgeIcon",
  BubbleChatSparkIcon: "BubbleChatSparkIcon",
  Bug02Icon: "Bug02Icon",
  ChartCandlestickIcon: "ChartCandlestickIcon",
  CheckmarkCircle02Icon: "CheckmarkCircle02Icon",
  Clock03Icon: "Clock03Icon",
  DatabaseLightningIcon: "DatabaseLightningIcon",
  Delete02Icon: "Delete02Icon",
  Exchange01Icon: "Exchange01Icon",
  FilterHorizontalIcon: "FilterHorizontalIcon",
  Knowledge01Icon: "Knowledge01Icon",
  PanelLeftCloseIcon: "PanelLeftCloseIcon",
  PanelLeftOpenIcon: "PanelLeftOpenIcon",
  Search01Icon: "Search01Icon",
  StopCircleIcon: "StopCircleIcon",
  Settings02Icon: "Settings02Icon",
  Shield02Icon: "Shield02Icon",
  SparklesIcon: "SparklesIcon",
  StarIcon: "StarIcon",
  StopCircleIcon: "StopCircleIcon",
  Target02Icon: "Target02Icon",
  Wallet01Icon: "Wallet01Icon",
  ZapIcon: "ZapIcon",
}));

vi.mock("@thesvg/react", () => ({
  Docker: () => null,
  Ethereum: () => null,
  Postgresql: () => null,
}));

// SessionContext now mounts SessionRuntimeBar → ModelBrandIcon, which
// statically imports ~20 brand icons from "@thesvg/react". Mock the
// component so this suite's partial @thesvg mock (AppShell.tsx's own
// icons) stays sufficient and the runtime bar's model-name path is
// isolated from the icon lib.
vi.mock("../../wizard/steps/provider/ModelBrandIcon.js", () => ({
  ModelBrandIcon: () => null,
}));

const { AppShell } = await import("../AppShell.js");

const sessionsListMock = vi.fn<() => Promise<Result<readonly SessionListItem[]>>>();
const sessionsGetMock = vi.fn<
  (input: { readonly id: string }) => Promise<Result<SessionListItem | null>>
>();
const sessionsCreateMock = vi.fn<
  (input: SessionCreateInput) => Promise<Result<SessionListItem>>
>();
const sessionsSetPinnedMock = vi.fn<
  (input: { readonly id: string; readonly pinned: boolean }) => Promise<Result<SessionListItem | null>>
>();
const sessionsDeleteMock = vi.fn<
  (input: { readonly id: string }) => Promise<Result<SessionDeleteResult>>
>();
const chatSubmitMock = vi.fn<
  (input: ChatSubmitInput) => AbortableInvocation<ChatSubmitResult>
>();
const healthMock = vi.fn<() => Promise<Result<HealthReport>>>();
const messagesListMock = vi.fn();
const missionGetDraftMock = vi.fn();
const runtimeGetStateMock = vi.fn();

beforeAll(() => {
  const proto = HTMLDialogElement.prototype as unknown as {
    showModal?: () => void;
    close?: () => void;
    show?: () => void;
  };
  if (typeof proto.showModal !== "function") {
    proto.showModal = function showModalPolyfill(this: HTMLDialogElement): void {
      this.setAttribute("open", "");
    };
  }
  if (typeof proto.close !== "function") {
    proto.close = function closePolyfill(this: HTMLDialogElement): void {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
  }
  if (typeof proto.show !== "function") {
    proto.show = function showPolyfill(this: HTMLDialogElement): void {
      this.setAttribute("open", "");
    };
  }

  // jsdom does not implement ResizeObserver, which SessionsList uses for
  // fit-to-height. The component's effect feature-detects it, so without a
  // stub it just leaves containerHeight at 0 (the planned fallback) — but
  // a stub keeps test failures honest if we ever assert on observed sizes.
  if (typeof globalThis.ResizeObserver === "undefined") {
    class ResizeObserverPolyfill {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver =
      ResizeObserverPolyfill as unknown as typeof ResizeObserver;
  }
});

beforeEach(() => {
  window.localStorage.clear();
  sessionsListMock.mockReset();
  sessionsGetMock.mockReset();
  sessionsCreateMock.mockReset();
  sessionsSetPinnedMock.mockReset();
  sessionsDeleteMock.mockReset();
  chatSubmitMock.mockReset();
  healthMock.mockReset();
  missionGetDraftMock.mockReset();
  runtimeGetStateMock.mockReset();
  // SessionComposer queries mission.getDraft + runtime.getState as soon as a
  // session is active (Send gate moved to activeSessionId). Benign defaults:
  // no draft, no run status (free text allowed).
  missionGetDraftMock.mockResolvedValue({ ok: true, data: null });
  runtimeGetStateMock.mockResolvedValue({ ok: true, data: { status: null } });
  useUiStore.setState({
    sidebarOpen: true,
    currentView: "appShell",
    wizardEntryMode: "setup",
    unlockReturnView: "appShell",
    logBuffer: [],
    sessionModeFilter: "all",
    activeSessionId: null,
    appShellView: "session",
    createSessionOpen: false,
    createSessionInitialMessage: null,
    pendingFirstMessage: null,
  });
  sessionsListMock.mockResolvedValue({ ok: true, data: [] });
  sessionsGetMock.mockResolvedValue({ ok: true, data: null });
  sessionsCreateMock.mockImplementation(async (input) => {
    const row: SessionListItem = {
      id: "a6bf4f85-e645-4df7-9bc5-70ec2eb0bd51",
      mode: input.mode,
      permission: input.permission,
      title: input.name,
      initialGoal: null,
      startedAt: localIsoDaysAgo(0),
      endedAt: null,
      missionStatus: null,
      pinnedAt: null,
    };
    return { ok: true, data: row };
  });
  sessionsSetPinnedMock.mockImplementation(async ({ id, pinned }) => {
    return {
      ok: true,
      data: {
        id,
        mode: "agent",
        permission: "restricted",
        title: "Pinned row",
        initialGoal: null,
        startedAt: localIsoDaysAgo(0),
        endedAt: null,
        missionStatus: null,
        pinnedAt: pinned ? new Date().toISOString() : null,
      },
    };
  });
  sessionsDeleteMock.mockResolvedValue({ ok: true, data: { outcome: "removed" } });
  chatSubmitMock.mockReturnValue({
    promise: Promise.resolve({
      ok: true,
      data: {
        text: "Message sent.",
        toolCallsMade: 0,
        pendingApprovals: [],
        stopReason: null,
        missionStatus: null,
        treatedAsInitialGoal: false,
      },
    }),
    cancel: vi.fn(),
  });
  healthMock.mockResolvedValue({ ok: true, data: makeHealthReport("ok") });
  messagesListMock.mockResolvedValue({
    ok: true,
    data: { items: [], nextCursor: null, hasMore: false },
  });
  Object.defineProperty(window, "vex", {
    configurable: true,
    value: {
      sessions: {
        list: sessionsListMock,
        get: sessionsGetMock,
        create: sessionsCreateMock,
        setPinned: sessionsSetPinnedMock,
        delete: sessionsDeleteMock,
      },
      chat: {
        submit: chatSubmitMock,
      },
      mission: {
        getDraft: missionGetDraftMock,
      },
      runtime: {
        getState: runtimeGetStateMock,
      },
      system: {
        health: healthMock,
      },
      // Stage 8-2b: a selected-session SessionPanel mounts SessionTranscript,
      // which pages through window.vex.messages.list. Default = empty page.
      messages: {
        list: messagesListMock,
      },
      // Agent integration puzzle 2/09 + F5: SessionPanel mounts
      // `useTranscriptLiveSync` + `useStreamPreviewSync` +
      // `useControlStateLiveSync`, which subscribe to the engine bridge. Stubs
      // return a no-op unsubscribe so tests that exercise the panel don't crash
      // on missing bridge surface.
      engine: {
        onTranscriptAppend: () => () => {},
        onStreamDelta: () => () => {},
        onControlState: () => () => {},
      },
    },
  });
});

describe("AppShell", () => {
  it("renders the Vex shell hero and local runtime footer", async () => {
    renderShell();

    expect(
      screen.getByRole("heading", { name: /Your chain\. Your rules\./i }),
    ).not.toBeNull();
    expect(screen.getAllByRole("button", { name: /New session/i }).length).toBeGreaterThan(0);
    await screen.findByText("Connected to local runtime");
    expect(screen.getByText("v0.0.0-test")).not.toBeNull();
  });

  it("groups recent sessions into Today, Yesterday, and Older", async () => {
    sessionsListMock.mockResolvedValueOnce({
      ok: true,
      data: makeSessionRows(),
    });

    renderShell();

    await screen.findByText("Today");
    expect(screen.getByText("Yesterday")).not.toBeNull();
    expect(screen.getByText("Older")).not.toBeNull();
    expect(screen.getAllByText("Arbitrum LP Rebalance").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Open BTC Perp Position").length).toBeGreaterThan(0);
  });

  it("filters the sidebar by mission mode", async () => {
    sessionsListMock.mockResolvedValueOnce({
      ok: true,
      data: makeSessionRows(),
    });

    renderShell();
    await screen.findByText("Portfolio Check");

    fireEvent.click(screen.getByRole("tab", { name: "Mission" }));

    expect(screen.getAllByText("Arbitrum LP Rebalance").length).toBeGreaterThan(0);
    expect(screen.queryByText("Portfolio Check")).toBeNull();
  });

  it("collapses and expands the glass sidebar", async () => {
    const view = renderShell();
    const sidebar = view.container.querySelector("[data-vex-area='sessions-sidebar']");

    expect(sidebar?.getAttribute("data-vex-sidebar-open")).toBe("true");
    fireEvent.click(
      screen.getByRole("button", { name: /Collapse sessions sidebar/i }),
    );
    expect(sidebar?.getAttribute("data-vex-sidebar-open")).toBe("false");
    fireEvent.click(
      screen.getByRole("button", { name: /Expand sessions sidebar/i }),
    );
    expect(sidebar?.getAttribute("data-vex-sidebar-open")).toBe("true");
  });

  it("submits composer text to the active session via chat IPC", async () => {
    const row = makeAgentRow("Quick chat");
    sessionsListMock.mockResolvedValueOnce({ ok: true, data: [row] });
    sessionsGetMock.mockResolvedValue({ ok: true, data: row });
    useUiStore.setState({ activeSessionId: row.id });

    renderShell();
    await screen.findByText("Quick chat");

    const draft = screen.getByLabelText("Session draft") as HTMLTextAreaElement;
    fireEvent.change(draft, {
      target: { value: "Research $TAO liquidity and thesis" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(chatSubmitMock).toHaveBeenCalledTimes(1));
    expect(chatSubmitMock).toHaveBeenCalledWith({
      sessionId: row.id,
      message: "Research $TAO liquidity and thesis",
    });
    await waitFor(() => expect(draft.value).toBe(""));
    // Batch 3: a plain chat send no longer shows a redundant "Message sent."
    // notice — the reply renders in the transcript instead.
    expect(screen.queryByText("Message sent.")).toBeNull();
  });

  it("shows quick-action chips in an empty session and hides them once it has messages", async () => {
    const row = makeAgentRow("Chips");
    sessionsListMock.mockResolvedValueOnce({ ok: true, data: [row] });
    sessionsGetMock.mockResolvedValue({ ok: true, data: row });
    useUiStore.setState({ activeSessionId: row.id });
    // Empty transcript (default mock) → chips are visible as conversation starters.
    renderShell();
    await screen.findByText("Chips");
    expect(await screen.findByRole("button", { name: /Swap/i })).not.toBeNull();
  });

  it("hides quick-action chips once the session transcript has messages", async () => {
    const row = makeAgentRow("Has msgs");
    sessionsListMock.mockResolvedValueOnce({ ok: true, data: [row] });
    sessionsGetMock.mockResolvedValue({ ok: true, data: row });
    useUiStore.setState({ activeSessionId: row.id });
    messagesListMock.mockResolvedValue({
      ok: true,
      data: {
        items: [
          {
            id: 1,
            sessionId: row.id,
            role: "user",
            kind: "text",
            content: "hi vex",
            createdAt: new Date().toISOString(),
            toolCallId: null,
            toolName: null,
            toolCalls: null,
          },
        ],
        nextCursor: null,
        hasMore: false,
      },
    });
    renderShell();
    await screen.findByText("hi vex");
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Swap/i })).toBeNull(),
    );
  });

  it("ENTER in the draft sends the message and clears the input", async () => {
    const row = makeAgentRow("Enter send");
    sessionsListMock.mockResolvedValueOnce({ ok: true, data: [row] });
    sessionsGetMock.mockResolvedValue({ ok: true, data: row });
    useUiStore.setState({ activeSessionId: row.id });

    renderShell();
    await screen.findByText("Enter send");

    const draft = screen.getByLabelText("Session draft") as HTMLTextAreaElement;
    fireEvent.change(draft, { target: { value: "gm vex" } });
    fireEvent.keyDown(draft, { key: "Enter" });

    await waitFor(() => expect(chatSubmitMock).toHaveBeenCalledTimes(1));
    expect(chatSubmitMock).toHaveBeenCalledWith({ sessionId: row.id, message: "gm vex" });
    await waitFor(() => expect(draft.value).toBe(""));
  });

  it("Shift+Enter does NOT send (keeps the draft for a newline)", async () => {
    const row = makeAgentRow("Shift enter");
    sessionsListMock.mockResolvedValueOnce({ ok: true, data: [row] });
    sessionsGetMock.mockResolvedValue({ ok: true, data: row });
    useUiStore.setState({ activeSessionId: row.id });

    renderShell();
    await screen.findByText("Shift enter");

    const draft = screen.getByLabelText("Session draft") as HTMLTextAreaElement;
    fireEvent.change(draft, { target: { value: "line one" } });
    fireEvent.keyDown(draft, { key: "Enter", shiftKey: true });

    expect(chatSubmitMock).not.toHaveBeenCalled();
    expect(draft.value).toBe("line one");
  });

  it("ENTER while a turn is pending does not start a second submit (pending guard, not empty guard)", async () => {
    const row = makeAgentRow("Pending guard");
    sessionsListMock.mockResolvedValueOnce({ ok: true, data: [row] });
    sessionsGetMock.mockResolvedValue({ ok: true, data: row });
    useUiStore.setState({ activeSessionId: row.id });
    // Never settles → the turn stays pending (Stop stays mounted).
    chatSubmitMock.mockReturnValue({
      promise: new Promise<never>(() => {}),
      cancel: vi.fn(),
    });

    renderShell();
    await screen.findByText("Pending guard");

    const draft = screen.getByLabelText("Session draft") as HTMLTextAreaElement;
    fireEvent.change(draft, { target: { value: "first" } });
    fireEvent.keyDown(draft, { key: "Enter" });
    await waitFor(() => expect(chatSubmitMock).toHaveBeenCalledTimes(1));
    await screen.findByRole("button", { name: "Stop generating" });

    // Type a NEW non-empty draft (so the empty-message guard is NOT what blocks)
    // and press Enter again — the pending guard must keep it at one submit.
    fireEvent.change(draft, { target: { value: "second" } });
    fireEvent.keyDown(draft, { key: "Enter" });
    expect(chatSubmitMock).toHaveBeenCalledTimes(1);
  });

  it("arms an inline Retry on a retryable provider error and re-sends the same message", async () => {
    const row = makeAgentRow("Retry chat");
    sessionsListMock.mockResolvedValueOnce({ ok: true, data: [row] });
    sessionsGetMock.mockResolvedValue({ ok: true, data: row });
    useUiStore.setState({ activeSessionId: row.id });
    chatSubmitMock.mockReturnValue({
      promise: Promise.resolve({
        ok: false,
        error: {
          code: "provider.unavailable",
          domain: "chat",
          message: "No inference provider is available.",
          retryable: true,
          userActionable: true,
          redacted: true,
          correlationId: "c",
        },
      }),
      cancel: vi.fn(),
    });

    renderShell();
    await screen.findByText("Retry chat");
    const draft = screen.getByLabelText("Session draft") as HTMLTextAreaElement;
    fireEvent.change(draft, { target: { value: "do the thing" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(chatSubmitMock).toHaveBeenCalledTimes(1));
    await screen.findByText("No inference provider is available.");
    const retry = await screen.findByRole("button", {
      name: "Retry sending the message",
    });
    // Retryable agent error → the message lives behind Retry; draft NOT restored.
    await waitFor(() => expect(draft.value).toBe(""));

    fireEvent.click(retry);
    await waitFor(() => expect(chatSubmitMock).toHaveBeenCalledTimes(2));
    expect(chatSubmitMock).toHaveBeenLastCalledWith({
      sessionId: row.id,
      message: "do the thing",
    });
  });

  it("does not double-submit when Retry is clicked twice before the first settles", async () => {
    const row = makeAgentRow("Retry guard");
    sessionsListMock.mockResolvedValueOnce({ ok: true, data: [row] });
    sessionsGetMock.mockResolvedValue({ ok: true, data: row });
    useUiStore.setState({ activeSessionId: row.id });
    chatSubmitMock.mockReturnValueOnce({
      promise: Promise.resolve({
        ok: false,
        error: {
          code: "provider.unavailable",
          domain: "chat",
          message: "No inference provider is available.",
          retryable: true,
          userActionable: true,
          redacted: true,
          correlationId: "c",
        },
      }),
      cancel: vi.fn(),
    });

    renderShell();
    await screen.findByText("Retry guard");
    const draft = screen.getByLabelText("Session draft") as HTMLTextAreaElement;
    fireEvent.change(draft, { target: { value: "retry me" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    const retry = await screen.findByRole("button", {
      name: "Retry sending the message",
    });

    // The retry submit never settles → the in-flight ref (+ disabled button)
    // guarantee a second click cannot start a second submit.
    chatSubmitMock.mockReturnValue({
      promise: new Promise<never>(() => {}),
      cancel: vi.fn(),
    });
    chatSubmitMock.mockClear();
    fireEvent.click(retry);
    fireEvent.click(retry);
    await waitFor(() => expect(chatSubmitMock).toHaveBeenCalledTimes(1));
    expect(chatSubmitMock).toHaveBeenCalledTimes(1);
  });

  it("does not arm Retry for a non-retryable error and restores the draft", async () => {
    const row = makeAgentRow("No retry");
    sessionsListMock.mockResolvedValueOnce({ ok: true, data: [row] });
    sessionsGetMock.mockResolvedValue({ ok: true, data: row });
    useUiStore.setState({ activeSessionId: row.id });
    chatSubmitMock.mockReturnValue({
      promise: Promise.resolve({
        ok: false,
        error: {
          code: "internal.unexpected",
          domain: "chat",
          message: "Unable to process the message.",
          retryable: false,
          userActionable: false,
          redacted: true,
          correlationId: "c",
        },
      }),
      cancel: vi.fn(),
    });

    renderShell();
    await screen.findByText("No retry");
    const draft = screen.getByLabelText("Session draft") as HTMLTextAreaElement;
    fireEvent.change(draft, { target: { value: "keep me" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await screen.findByText("Unable to process the message.");
    // Non-retryable → no Retry button; the message is restored to the draft.
    expect(
      screen.queryByRole("button", { name: "Retry sending the message" }),
    ).toBeNull();
    await waitFor(() => expect(draft.value).toBe("keep me"));
  });

  it("does not arm Retry for a retryable error in a resolved MISSION session (mode gate fails closed)", async () => {
    const missionRow: SessionListItem = {
      id: "77777777-7777-4777-8777-777777777777",
      mode: "mission",
      permission: "restricted",
      title: "Mission no retry",
      initialGoal: null,
      startedAt: localIsoDaysAgo(0),
      endedAt: null,
      missionStatus: null,
      pinnedAt: null,
    };
    sessionsListMock.mockResolvedValueOnce({ ok: true, data: [missionRow] });
    sessionsGetMock.mockResolvedValue({ ok: true, data: missionRow });
    useUiStore.setState({ activeSessionId: missionRow.id });
    chatSubmitMock.mockReturnValue({
      promise: Promise.resolve({
        ok: false,
        error: {
          code: "provider.unavailable",
          domain: "chat",
          message: "No inference provider is available.",
          retryable: true,
          userActionable: true,
          redacted: true,
          correlationId: "c",
        },
      }),
      cancel: vi.fn(),
    });

    renderShell();
    await screen.findByText("Mission no retry");
    const draft = screen.getByLabelText("Session draft") as HTMLTextAreaElement;
    fireEvent.change(draft, { target: { value: "mission goal" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await screen.findByText("No inference provider is available.");
    // Retryable but mission mode → the agent-mode gate fails closed: no Retry,
    // draft restored (mission error handling is owned by later phases).
    expect(
      screen.queryByRole("button", { name: "Retry sending the message" }),
    ).toBeNull();
    await waitFor(() => expect(draft.value).toBe("mission goal"));
  });

  it("clears the notice + Retry when the session is switched after a failure (no cross-session resend)", async () => {
    const a: SessionListItem = {
      ...makeAgentRow("Session A"),
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    };
    const b: SessionListItem = {
      ...makeAgentRow("Session B"),
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    };
    sessionsListMock.mockResolvedValue({ ok: true, data: [a, b] });
    sessionsGetMock.mockImplementation(async ({ id }) => ({
      ok: true,
      data: id === a.id ? a : b,
    }));
    useUiStore.setState({ activeSessionId: a.id });
    chatSubmitMock.mockReturnValue({
      promise: Promise.resolve({
        ok: false,
        error: {
          code: "provider.unavailable",
          domain: "chat",
          message: "No inference provider is available.",
          retryable: true,
          userActionable: true,
          redacted: true,
          correlationId: "c",
        },
      }),
      cancel: vi.fn(),
    });

    renderShell();
    await screen.findByText("Session A");
    const draft = screen.getByLabelText("Session draft") as HTMLTextAreaElement;
    fireEvent.change(draft, { target: { value: "msg for A" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await screen.findByRole("button", { name: "Retry sending the message" });
    chatSubmitMock.mockClear();

    // Switch to session B via the sidebar → the notice + its Retry must clear,
    // and nothing may resend A's message into B.
    fireEvent.click(screen.getAllByText("Session B")[0]!);
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Retry sending the message" }),
      ).toBeNull(),
    );
    expect(chatSubmitMock).not.toHaveBeenCalled();
  });

  it("swaps Send for a Stop button while a turn streams and cancels it (9-5b)", async () => {
    const row = makeAgentRow("Stoppable chat");
    sessionsListMock.mockResolvedValueOnce({ ok: true, data: [row] });
    sessionsGetMock.mockResolvedValue({ ok: true, data: row });
    useUiStore.setState({ activeSessionId: row.id });

    const cancel = vi.fn();
    // Never settles → the mutation stays pending so the Stop control stays mounted.
    chatSubmitMock.mockReturnValue({
      promise: new Promise<Result<ChatSubmitResult>>(() => {}),
      cancel,
    });

    renderShell();
    await screen.findByText("Stoppable chat");

    const draft = screen.getByLabelText("Session draft") as HTMLTextAreaElement;
    fireEvent.change(draft, { target: { value: "Long-running research" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    const stopBtn = await screen.findByRole("button", { name: "Stop generating" });
    // Pins the fix: a submit-typed Stop would re-run onSubmit (re-sending the
    // draft) instead of only cancelling the turn.
    expect(stopBtn.getAttribute("type")).toBe("button");
    expect(screen.queryByRole("button", { name: "Send message" })).toBeNull();

    fireEvent.click(stopBtn);
    expect(cancel).toHaveBeenCalledTimes(1);
    // type="button": clicking Stop must not fire a second submit.
    expect(chatSubmitMock).toHaveBeenCalledTimes(1);
  });

  it("shows 'Stopped.' (not 'Message sent.') when a turn stops with no partial (9-5b)", async () => {
    const row = makeAgentRow("Stop early");
    sessionsListMock.mockResolvedValueOnce({ ok: true, data: [row] });
    sessionsGetMock.mockResolvedValue({ ok: true, data: row });
    useUiStore.setState({ activeSessionId: row.id });

    chatSubmitMock.mockReturnValue({
      promise: Promise.resolve({
        ok: true,
        data: {
          text: null,
          toolCallsMade: 0,
          pendingApprovals: [],
          stopReason: "user_stopped",
          missionStatus: null,
          treatedAsInitialGoal: false,
        },
      }),
      cancel: vi.fn(),
    });

    renderShell();
    await screen.findByText("Stop early");

    const draft = screen.getByLabelText("Session draft") as HTMLTextAreaElement;
    fireEvent.change(draft, { target: { value: "do something" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await screen.findByText("Stopped.");
    expect(screen.queryByText("Message sent.")).toBeNull();
  });

  it("enables + submits Send via activeSessionId even while the detail query is unresolved (bug A)", async () => {
    const row = makeAgentRow("Detail pending");
    sessionsListMock.mockResolvedValueOnce({ ok: true, data: [row] });
    // sessions.get never resolves → the detail object (activeSession) stays
    // null. Send must still work because it gates on activeSessionId.
    sessionsGetMock.mockReturnValue(new Promise<Result<SessionListItem | null>>(() => {}));
    useUiStore.setState({ activeSessionId: row.id });

    renderShell();
    const draft = (await screen.findByLabelText("Session draft")) as HTMLTextAreaElement;
    fireEvent.change(draft, { target: { value: "hello while loading" } });

    const send = screen.getByRole("button", { name: "Send message" });
    expect((send as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(send);

    await waitFor(() => expect(chatSubmitMock).toHaveBeenCalledTimes(1));
    expect(chatSubmitMock).toHaveBeenCalledWith({
      sessionId: row.id,
      message: "hello while loading",
    });
    // activeSessionId is set but the detail (activeSession) is still unresolved
    // → quick-action chips stay hidden even though the transcript query
    // succeeded empty (gated on a resolved activeSession, no flicker).
    expect(screen.queryByRole("button", { name: /Swap/i })).toBeNull();
  });

  it("enables Send when the detail query errors (bug A)", async () => {
    const row = makeAgentRow("Detail error");
    sessionsListMock.mockResolvedValueOnce({ ok: true, data: [row] });
    sessionsGetMock.mockResolvedValue({
      ok: false,
      error: {
        code: "internal.unexpected",
        domain: "sessions",
        message: "boom",
        retryable: true,
        userActionable: false,
        redacted: true,
        correlationId: "c",
      },
    });
    useUiStore.setState({ activeSessionId: row.id });

    renderShell();
    const draft = (await screen.findByLabelText("Session draft")) as HTMLTextAreaElement;
    fireEvent.change(draft, { target: { value: "send despite error" } });
    const send = screen.getByRole("button", { name: "Send message" });
    expect((send as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(send);
    await waitFor(() =>
      expect(chatSubmitMock).toHaveBeenCalledWith({
        sessionId: row.id,
        message: "send despite error",
      }),
    );
    // Errored detail → activeSession null → chips hidden (no flicker).
    expect(screen.queryByRole("button", { name: /Swap/i })).toBeNull();
  });

  it("welcome composer Send opens the creator with the draft carried + name pre-filled (welcome→create)", async () => {
    sessionsListMock.mockResolvedValueOnce({ ok: true, data: [] });
    useUiStore.setState({ activeSessionId: null });
    renderShell();

    const draft = (await screen.findByLabelText("Session draft")) as HTMLTextAreaElement;
    fireEvent.change(draft, { target: { value: "research TAO liquidity" } });
    const send = screen.getByRole("button", { name: "Send message" });
    // Enabled in welcome with a draft — it is the create entry point now.
    expect((send as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(send);

    await screen.findByRole("heading", { name: "New session" });
    const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
    expect(nameInput.value).toBe("research TAO liquidity");
  });

  it("welcome→create hands the typed first message to the new session's composer", async () => {
    sessionsListMock.mockResolvedValueOnce({ ok: true, data: [] });
    useUiStore.setState({ activeSessionId: null });
    renderShell();

    const draft = (await screen.findByLabelText("Session draft")) as HTMLTextAreaElement;
    fireEvent.change(draft, { target: { value: "research TAO liquidity" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await screen.findByRole("heading", { name: "New session" });

    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(chatSubmitMock).toHaveBeenCalledWith({
        sessionId: "a6bf4f85-e645-4df7-9bc5-70ec2eb0bd51",
        message: "research TAO liquidity",
      }),
    );
  });

  it("welcome→create: a failed first send surfaces the error AND offers Retry (message not lost)", async () => {
    sessionsListMock.mockResolvedValueOnce({ ok: true, data: [] });
    useUiStore.setState({ activeSessionId: null });
    chatSubmitMock.mockReturnValue({
      promise: Promise.resolve({
        ok: false,
        error: {
          code: "internal.unexpected",
          domain: "chat",
          message: "send failed",
          retryable: true,
          userActionable: false,
          redacted: true,
          correlationId: "c",
        },
      }),
      cancel: vi.fn(),
    });
    renderShell();

    const draft = (await screen.findByLabelText("Session draft")) as HTMLTextAreaElement;
    fireEvent.change(draft, { target: { value: "first message" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await screen.findByRole("heading", { name: "New session" });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    // Hand-off submit fails (retryable, agent session) → the composer shows the
    // error + an inline Retry holding the first message (never silently lost);
    // clicking Retry re-sends the same message into the new session.
    await screen.findByText("send failed");
    const retry = await screen.findByRole("button", {
      name: "Retry sending the message",
    });
    fireEvent.click(retry);
    await waitFor(() =>
      expect(chatSubmitMock).toHaveBeenLastCalledWith({
        sessionId: "a6bf4f85-e645-4df7-9bc5-70ec2eb0bd51",
        message: "first message",
      }),
    );
  });

  it("welcome→create under StrictMode: composer returns to idle after the first send settles", async () => {
    // Regression for the RQ v5 MutationObserver detach: the welcome→create
    // hand-off fires `chat.submit` from a mount effect, and StrictMode's dev
    // mount-effect replay unsubscribes the observer mid-flight (detaching it
    // from the in-flight mutation with no reattach). Without the reset() guard
    // in useSubmitChat, the observer misses the settle and `isPending` freezes
    // at true → the composer is stuck as a dead "Stop generating" button and
    // the next message can never be sent. Use the no-provider error so the
    // submit settles immediately (the engine cannot be the slow part).
    sessionsListMock.mockResolvedValueOnce({ ok: true, data: [] });
    useUiStore.setState({ activeSessionId: null });
    chatSubmitMock.mockReturnValue({
      promise: Promise.resolve({
        ok: false,
        error: {
          code: "provider.unavailable",
          domain: "chat",
          message: "No inference provider is available.",
          retryable: true,
          userActionable: true,
          redacted: true,
          correlationId: "c",
        },
      }),
      cancel: vi.fn(),
    });
    renderShellStrict();

    const draft = (await screen.findByLabelText("Session draft")) as HTMLTextAreaElement;
    fireEvent.change(draft, { target: { value: "first message" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await screen.findByRole("heading", { name: "New session" });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    // The turn settled (error surfaced) → the composer must be idle again:
    // Send is back and the Stop control is gone.
    await screen.findByText("No inference provider is available.");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Send message" })).toBeTruthy(),
    );
    expect(screen.queryByRole("button", { name: "Stop generating" })).toBeNull();
  });

  it("new-session modal form is a bounded flex column so the footer/Create stays reachable (bug C)", async () => {
    sessionsListMock.mockResolvedValueOnce({ ok: true, data: [] });
    const view = renderShell();
    fireEvent.click(view.getAllByRole("button", { name: "New session" })[0]!);
    await screen.findByRole("heading", { name: "New session" });

    const form = view.container.querySelector("dialog form");
    expect(form).not.toBeNull();
    expect(form!.classList.contains("flex-1")).toBe(true);
    expect(form!.classList.contains("min-h-0")).toBe(true);
    expect(screen.getByRole("button", { name: "Create" })).not.toBeNull();
  });

  it("creates a mission session without collecting the goal in the modal", async () => {
    renderShell();

    fireEvent.click(screen.getAllByRole("button", { name: "New session" })[0]!);
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "LP rebalance run" },
    });
    fireEvent.click(screen.getByRole("radio", { name: /Mission/i }));
    expect(screen.queryByLabelText("Goal")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(sessionsCreateMock).toHaveBeenCalledTimes(1));
    expect(sessionsCreateMock).toHaveBeenCalledWith({
      mode: "mission",
      name: "LP rebalance run",
      permission: "restricted",
      selectedEvmWalletId: null,
      selectedSolanaWalletId: null,
    });
  });

  it("treats the first mission chat message as the initial goal", async () => {
    const missionRow: SessionListItem = {
      id: "55555555-5555-4555-8555-555555555555",
      mode: "mission",
      permission: "restricted",
      title: "New mission",
      initialGoal: null,
      startedAt: localIsoDaysAgo(0),
      endedAt: null,
      missionStatus: null,
      pinnedAt: null,
    };
    sessionsListMock.mockResolvedValueOnce({ ok: true, data: [missionRow] });
    sessionsGetMock.mockResolvedValue({ ok: true, data: missionRow });
    chatSubmitMock.mockReturnValueOnce({
      promise: Promise.resolve({
        ok: true,
        data: {
          text: null,
          toolCallsMade: 0,
          pendingApprovals: [],
          stopReason: null,
          missionStatus: "draft",
          treatedAsInitialGoal: true,
        },
      }),
      cancel: vi.fn(),
    });
    useUiStore.setState({ activeSessionId: missionRow.id });

    renderShell();
    await screen.findByText("New mission");

    const draft = screen.getByLabelText("Session draft") as HTMLTextAreaElement;
    expect(draft.placeholder).toBe("Describe the mission goal.");
    fireEvent.change(draft, {
      target: { value: "Rebalance Arbitrum LP range" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(chatSubmitMock).toHaveBeenCalledTimes(1));
    expect(chatSubmitMock).toHaveBeenCalledWith({
      sessionId: missionRow.id,
      message: "Rebalance Arbitrum LP range",
    });
    await screen.findByText("Mission goal received.");
  });

  it("blocks Create until the user types a session name", async () => {
    renderShell();

    fireEvent.click(screen.getAllByRole("button", { name: "New session" })[0]!);
    const createBtn = screen.getByRole("button", { name: "Create" }) as HTMLButtonElement;
    expect(createBtn.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Quick chat" },
    });
    expect(createBtn.disabled).toBe(false);
  });

  it("renders the Pinned section above the time buckets", async () => {
    const pinnedNow = new Date().toISOString();
    sessionsListMock.mockResolvedValueOnce({
      ok: true,
      data: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          mode: "agent",
          permission: "restricted",
          title: "Pinned chat",
          initialGoal: null,
          startedAt: localIsoDaysAgo(0),
          endedAt: null,
          missionStatus: null,
          pinnedAt: pinnedNow,
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          mode: "agent",
          permission: "restricted",
          title: "Plain chat",
          initialGoal: null,
          startedAt: localIsoDaysAgo(0),
          endedAt: null,
          missionStatus: null,
          pinnedAt: null,
        },
      ],
    });

    renderShell();
    await screen.findByText("Pinned");
    expect(screen.getByText("Pinned chat")).not.toBeNull();
    // The same row must NOT also appear in Today (no duplication invariant).
    expect(screen.queryAllByText("Pinned chat")).toHaveLength(1);
    expect(screen.getByText("Today")).not.toBeNull();
    expect(screen.getByText("Plain chat")).not.toBeNull();
  });

  it("invokes setPinned when the star button is clicked", async () => {
    sessionsListMock.mockResolvedValueOnce({
      ok: true,
      data: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          mode: "agent",
          permission: "restricted",
          title: "Pin me",
          initialGoal: null,
          startedAt: localIsoDaysAgo(0),
          endedAt: null,
          missionStatus: null,
          pinnedAt: null,
        },
      ],
    });

    renderShell();
    const pinButton = await screen.findByRole("button", { name: "Pin session" });
    fireEvent.click(pinButton);

    await waitFor(() => expect(sessionsSetPinnedMock).toHaveBeenCalledTimes(1));
    expect(sessionsSetPinnedMock).toHaveBeenCalledWith({
      id: "11111111-1111-4111-8111-111111111111",
      pinned: true,
    });
  });

  it("does not select the row when Enter/Space lands on the pin button", async () => {
    sessionsListMock.mockResolvedValueOnce({
      ok: true,
      data: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          mode: "agent",
          permission: "restricted",
          title: "Sibling-safe row",
          initialGoal: null,
          startedAt: localIsoDaysAgo(0),
          endedAt: null,
          missionStatus: null,
          pinnedAt: null,
        },
      ],
    });

    renderShell();
    const pinButton = await screen.findByRole("button", { name: "Pin session" });
    // Sibling structure: pin's keyDown has no ancestor with a row-select
    // handler in its bubble path. Activating the pin must not select the
    // row. The mouse-click test above already covers the IPC contract.
    fireEvent.keyDown(pinButton, { key: "Enter" });
    fireEvent.keyDown(pinButton, { key: " " });

    expect(useUiStore.getState().activeSessionId).toBeNull();
  });

  it("preserves missionStatus in the detail cache when pinning a mission row", async () => {
    const missionRow: SessionListItem = {
      id: "33333333-3333-4333-8333-333333333333",
      mode: "mission",
      permission: "restricted",
      title: "Live mission",
      initialGoal: "Run portfolio rebalance",
      startedAt: localIsoDaysAgo(0),
      endedAt: null,
      missionStatus: "running",
      pinnedAt: null,
    };
    sessionsListMock.mockResolvedValue({ ok: true, data: [missionRow] });
    sessionsGetMock.mockResolvedValue({ ok: true, data: missionRow });
    // The DB helper's loadMissionStatus enrichment guarantees the row
    // returned by setSessionPinned carries the active missionStatus.
    // Mock that contract here so the renderer hook's setQueryData on
    // success cannot wipe the active status.
    sessionsSetPinnedMock.mockImplementationOnce(async ({ id, pinned }) => ({
      ok: true,
      data: {
        ...missionRow,
        id,
        pinnedAt: pinned ? new Date().toISOString() : null,
      },
    }));

    useUiStore.setState({ activeSessionId: missionRow.id });
    const { queryClient } = renderShell();

    const pinBtn = await screen.findByRole("button", { name: "Pin session" });
    fireEvent.click(pinBtn);
    await waitFor(() => expect(sessionsSetPinnedMock).toHaveBeenCalledTimes(1));

    await waitFor(() => {
      const cached = queryClient.getQueryData<Result<SessionListItem | null>>(
        sessionKeys.detail(missionRow.id),
      );
      expect(cached?.ok).toBe(true);
      if (cached?.ok) {
        expect(cached.data?.missionStatus).toBe("running");
        expect(cached.data?.pinnedAt).not.toBeNull();
      }
    });
  });

  it("switches to the library view via Browse all and returns to session on row select", async () => {
    sessionsListMock.mockResolvedValueOnce({
      ok: true,
      data: makeSessionRows(),
    });

    renderShell();
    const browseBtn = await screen.findByRole("button", {
      name: /Open sessions library|Browse all/i,
    });
    fireEvent.click(browseBtn);
    expect(useUiStore.getState().appShellView).toBe("sessionsLibrary");

    // Selecting any row from the sidebar (which is still visible) must
    // return the panel area to the session view (codex turn 1 P4).
    const arbitrumRows = await screen.findAllByText("Arbitrum LP Rebalance");
    // Climb to the enclosing <button> — fireEvent.click on the inner text
    // triggers React's synthetic system regardless of the target tag.
    fireEvent.click(arbitrumRows[0]!);
    expect(useUiStore.getState().appShellView).toBe("session");
    expect(useUiStore.getState().activeSessionId).toBe(
      "fb7bf453-df76-43e9-b756-02c3b717f242",
    );
  });

  it("opens the remove dialog when the trash button is clicked", async () => {
    sessionsListMock.mockResolvedValueOnce({
      ok: true,
      data: [makeAgentRow("Remove me")],
    });
    renderShell();
    const trashButtons = await screen.findAllByRole("button", { name: "Remove session" });
    fireEvent.click(trashButtons[0]!);
    expect(await screen.findByRole("dialog", { name: /Remove session\?/i })).not.toBeNull();
    expect(screen.getByText(/Remove "Remove me"/)).not.toBeNull();
  });

  it("confirms removal, calls IPC, clears active session, and closes the dialog", async () => {
    const row = makeAgentRow("Goodbye");
    sessionsListMock.mockResolvedValueOnce({ ok: true, data: [row] });
    useUiStore.setState({ activeSessionId: row.id });

    renderShell();
    const trashButtons = await screen.findAllByRole("button", { name: "Remove session" });
    fireEvent.click(trashButtons[0]!);
    const confirmBtn = await screen.findByRole("button", { name: "Remove" });
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(sessionsDeleteMock).toHaveBeenCalledTimes(1));
    expect(sessionsDeleteMock).toHaveBeenCalledWith({ id: row.id });
    await waitFor(() => expect(useUiStore.getState().activeSessionId).toBeNull());
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /Remove session\?/i })).toBeNull(),
    );
  });

  it("keeps the dialog open and surfaces blocked-active copy when main refuses removal", async () => {
    const row = makeAgentRow("Mission alive");
    sessionsListMock.mockResolvedValueOnce({ ok: true, data: [row] });
    sessionsDeleteMock.mockResolvedValueOnce({
      ok: true,
      data: { outcome: "blocked_active_mission" },
    });
    useUiStore.setState({ activeSessionId: row.id });

    renderShell();
    fireEvent.click((await screen.findAllByRole("button", { name: "Remove session" }))[0]!);
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));

    await waitFor(() => expect(sessionsDeleteMock).toHaveBeenCalledTimes(1));
    await screen.findByText(/this mission is still active/i);
    expect(useUiStore.getState().activeSessionId).toBe(row.id);
  });

  it("surfaces blocked-pending copy without mutating cache", async () => {
    const row = makeAgentRow("Awaiting your nod");
    sessionsListMock.mockResolvedValueOnce({ ok: true, data: [row] });
    sessionsDeleteMock.mockResolvedValueOnce({
      ok: true,
      data: { outcome: "blocked_pending_approval" },
    });
    useUiStore.setState({ activeSessionId: row.id });

    renderShell();
    fireEvent.click((await screen.findAllByRole("button", { name: "Remove session" }))[0]!);
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));

    await screen.findByText(/pending approval/i);
    expect(useUiStore.getState().activeSessionId).toBe(row.id);
  });

  it("surfaces state_changed copy without mutating cache and lets the user retry", async () => {
    const row = makeAgentRow("Race-loser");
    sessionsListMock.mockResolvedValueOnce({ ok: true, data: [row] });
    sessionsDeleteMock.mockResolvedValueOnce({
      ok: true,
      data: { outcome: "state_changed" },
    });
    useUiStore.setState({ activeSessionId: row.id });

    renderShell();
    fireEvent.click((await screen.findAllByRole("button", { name: "Remove session" }))[0]!);
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));

    await screen.findByText(/state changed/i);
    expect(useUiStore.getState().activeSessionId).toBe(row.id);
  });

  it("clears active session + closes dialog when outcome is already_removed", async () => {
    const row = makeAgentRow("Stale list");
    sessionsListMock.mockResolvedValueOnce({ ok: true, data: [row] });
    sessionsDeleteMock.mockResolvedValueOnce({
      ok: true,
      data: { outcome: "already_removed" },
    });
    useUiStore.setState({ activeSessionId: row.id });

    renderShell();
    fireEvent.click((await screen.findAllByRole("button", { name: "Remove session" }))[0]!);
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));

    await waitFor(() => expect(useUiStore.getState().activeSessionId).toBeNull());
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /Remove session\?/i })).toBeNull(),
    );
  });

  it("clears active session when outcome is not_found", async () => {
    const row = makeAgentRow("Ghost row");
    sessionsListMock.mockResolvedValueOnce({ ok: true, data: [row] });
    sessionsDeleteMock.mockResolvedValueOnce({
      ok: true,
      data: { outcome: "not_found" },
    });
    useUiStore.setState({ activeSessionId: row.id });

    renderShell();
    fireEvent.click((await screen.findAllByRole("button", { name: "Remove session" }))[0]!);
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));

    await waitFor(() => expect(useUiStore.getState().activeSessionId).toBeNull());
  });

  it("Library view removes through the same dialog + IPC path", async () => {
    const row = makeAgentRow("Library-resident");
    sessionsListMock.mockResolvedValue({ ok: true, data: [row] });

    renderShell();
    useUiStore.setState({ appShellView: "sessionsLibrary" });

    // After switching to the library, both sidebar and library render the
    // same row → two trash buttons total. Click the library one (last).
    const trashButtons = await screen.findAllByRole("button", { name: "Remove session" });
    expect(trashButtons.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(trashButtons[trashButtons.length - 1]!);

    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    await waitFor(() => expect(sessionsDeleteMock).toHaveBeenCalledWith({ id: row.id }));
  });

  it("Cancel button closes the dialog without calling IPC", async () => {
    const row = makeAgentRow("Cancel me");
    sessionsListMock.mockResolvedValueOnce({ ok: true, data: [row] });

    renderShell();
    fireEvent.click((await screen.findAllByRole("button", { name: "Remove session" }))[0]!);
    const cancel = await screen.findByRole("button", { name: "Cancel" });
    fireEvent.click(cancel);

    expect(sessionsDeleteMock).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /Remove session\?/i })).toBeNull(),
    );
  });
});

function makeAgentRow(title: string): SessionListItem {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    mode: "agent",
    permission: "restricted",
    title,
    initialGoal: null,
    startedAt: localIsoDaysAgo(0),
    endedAt: null,
    missionStatus: null,
    pinnedAt: null,
  };
}

function renderShell(): ReturnType<typeof render> & {
  readonly queryClient: QueryClient;
} {
  const client = createQueryClient();
  client.setDefaultOptions({
    queries: {
      retry: false,
    },
  });
  const result = render(
    <QueryClientProvider client={client}>
      <AppShell />
    </QueryClientProvider>,
  );
  // Object.assign keeps the existing call-sites (which use `renderShell()`
  // without destructuring) working while letting new tests read the
  // QueryClient for direct cache assertions.
  return Object.assign(result, { queryClient: client });
}

// Same as `renderShell` but wrapped in <StrictMode> so dev mount-effect
// replay (subscribe → cleanup → subscribe) is exercised — the condition that
// detaches the chat MutationObserver mid-flight and froze `isPending`.
function renderShellStrict(): ReturnType<typeof render> {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false } });
  return render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <AppShell />
      </QueryClientProvider>
    </StrictMode>,
  );
}

function makeSessionRows(): readonly SessionListItem[] {
  return [
    {
      id: "fb7bf453-df76-43e9-b756-02c3b717f242",
      mode: "mission",
      permission: "restricted",
      title: "Arbitrum LP Rebalance",
      initialGoal: "Arbitrum LP Rebalance",
      startedAt: localIsoDaysAgo(0),
      endedAt: null,
      missionStatus: "running",
      pinnedAt: null,
    },
    {
      id: "2c7e7135-6d80-443c-b73e-b43717a09425",
      mode: "agent",
      permission: "restricted",
      title: null,
      initialGoal: null,
      startedAt: localIsoDaysAgo(0),
      endedAt: null,
      missionStatus: null,
      pinnedAt: null,
    },
    {
      id: "cf0788b8-87c7-4eb2-b4b9-4252779f906d",
      mode: "mission",
      permission: "full",
      title: "Open BTC Perp Position",
      initialGoal: "Open BTC Perp Position",
      startedAt: localIsoDaysAgo(1),
      endedAt: null,
      missionStatus: "paused_wake",
      pinnedAt: null,
    },
    {
      id: "db01d1f7-8b1e-4607-a59c-cda6a9ff1024",
      mode: "agent",
      permission: "restricted",
      title: "Portfolio Check",
      initialGoal: "Portfolio Check",
      startedAt: localIsoDaysAgo(3),
      endedAt: null,
      missionStatus: null,
      pinnedAt: null,
    },
  ];
}

function localIsoDaysAgo(days: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function makeHealthReport(overall: HealthReport["overall"]): HealthReport {
  return {
    os: {
      platform: "linux",
      arch: "x64",
      release: "test",
      distro: "test",
      homedir: "/home/test",
      userDataDir: "/tmp/vex-test",
      appVersion: "0.0.0-test",
      electronVersion: "0.0.0-test",
      nodeVersion: "0.0.0-test",
    },
    network: {
      online: true,
      latencyMs: 1,
      probedAt: new Date("2026-05-19T12:00:00.000Z").toISOString(),
    },
    setupComplete: true,
    overall,
  };
}
