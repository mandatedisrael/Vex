import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Result } from "@shared/ipc/result.js";
import type {
  ChatSubmitInput,
  ChatSubmitResult,
} from "@shared/schemas/chat.js";
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
  (input: ChatSubmitInput) => Promise<Result<ChatSubmitResult>>
>();
const healthMock = vi.fn<() => Promise<Result<HealthReport>>>();

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
  useUiStore.setState({
    sidebarOpen: true,
    currentView: "appShell",
    wizardEntryMode: "setup",
    unlockReturnView: "appShell",
    logBuffer: [],
    sessionModeFilter: "all",
    activeSessionId: null,
    appShellView: "session",
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
  chatSubmitMock.mockResolvedValue({
    ok: true,
    data: {
      text: "Message sent.",
      toolCallsMade: 0,
      pendingApprovals: [],
      stopReason: null,
      missionStatus: null,
      treatedAsInitialGoal: false,
    },
  });
  healthMock.mockResolvedValue({ ok: true, data: makeHealthReport("ok") });
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
      system: {
        health: healthMock,
      },
      // Agent integration puzzle 2: SessionPanel mounts
      // `useTranscriptLiveSync` which subscribes to the engine bridge.
      // Stub returns a no-op unsubscribe so tests that exercise the panel
      // don't crash on missing bridge surface.
      engine: {
        onTranscriptAppend: () => () => {},
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
    await screen.findByText("Message sent.");
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
    chatSubmitMock.mockResolvedValueOnce({
      ok: true,
      data: {
        text: null,
        toolCallsMade: 0,
        pendingApprovals: [],
        stopReason: null,
        missionStatus: "draft",
        treatedAsInitialGoal: true,
      },
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
