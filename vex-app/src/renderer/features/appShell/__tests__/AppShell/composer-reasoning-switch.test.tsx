/**
 * Composer REASON control (S6) — mounts the real SessionComposer with the
 * lib/api hooks mocked (same harness as composer-plan-switch) so the suite
 * pins the renderer half of the reasoning seam:
 *   - the control renders ONLY when `sessions.getModel` reports
 *     `supportsReasoning === true` (false / null / unresolved → hidden),
 *   - clicking cycles the per-session uiStore choice medium → high → low,
 *   - `chat.submit` includes `reasoningEffort` for a supporting model and
 *     OMITS the field entirely otherwise (schema-optional, engine default).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { SessionListItem, SessionModelDto } from "@shared/schemas/sessions.js";
import { useUiStore } from "../../../../stores/uiStore.js";

vi.mock("@hugeicons/react", () => ({
  HugeiconsIcon: () => null,
}));

vi.mock("@hugeicons/core-free-icons", () => ({
  Add01Icon: "Add01Icon",
  CheckmarkCircle02Icon: "CheckmarkCircle02Icon",
  Download01Icon: "Download01Icon",
  ArrowDown01Icon: "ArrowDown01Icon",
  Wallet01Icon: "Wallet01Icon",
  Exchange01Icon: "Exchange01Icon",
  Fuel01Icon: "Fuel01Icon",
  AiBrain05Icon: "AiBrain05Icon",
  ArrowRight01Icon: "ArrowRight01Icon",
  ArrowUp01Icon: "ArrowUp01Icon",
  MapPinIcon: "MapPinIcon",
  StopCircleIcon: "StopCircleIcon",
}));

const mockSubmitChat = {
  isPending: false,
  mutateAsync: vi.fn(),
  stop: vi.fn(),
};
vi.mock("../../../../lib/api/chat.js", () => ({
  useSubmitChat: () => mockSubmitChat,
}));
vi.mock("../../../../lib/api/messages.js", () => ({
  useTranscriptInfinite: () => ({ data: undefined, isSuccess: false }),
  flattenTranscriptPages: () => [],
}));
vi.mock("../../../../lib/api/runtime.js", () => ({
  useRuntimeState: () => ({ data: { ok: true, data: { status: null } } }),
}));

const mockUseSessionModel = vi.fn();
vi.mock("../../../../lib/api/sessions.js", () => ({
  useSessionPlan: () => ({
    data: { ok: true, data: { enabled: false, planMd: "", accepted: false } },
  }),
  useSetPlanMode: () => ({ mutate: vi.fn(), isPending: false }),
  useSessionModel: (...a: unknown[]) => mockUseSessionModel(...a),
}));

const { SessionComposer } = await import("../../SessionComposer.js");

const SESSION = "00000000-0000-4000-8000-00000000cc01";

function agentRow(over: Partial<SessionListItem> = {}): SessionListItem {
  return {
    id: SESSION,
    mode: "agent",
    permission: "restricted",
    title: "Reasoning switch",
    initialGoal: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    missionStatus: null,
    pinnedAt: null,
    ...over,
  };
}

function modelState(supportsReasoning: boolean | null) {
  const dto: SessionModelDto = {
    sessionId: SESSION,
    provider: "openrouter",
    modelId: "anthropic/claude-sonnet-4",
    source: "global_default",
    updatedAt: null,
    supportsReasoning,
  };
  return { data: { ok: true as const, data: dto } };
}

function reasonButton(): HTMLButtonElement | null {
  return screen.queryByRole("button", {
    name: /Reasoning effort/,
  }) as HTMLButtonElement | null;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSubmitChat.isPending = false;
  mockSubmitChat.mutateAsync.mockResolvedValue({
    ok: true,
    data: {
      text: "ok",
      toolCallsMade: 0,
      pendingApprovals: [],
      stopReason: null,
      missionStatus: null,
      treatedAsInitialGoal: false,
    },
  });
  mockUseSessionModel.mockReturnValue(modelState(true));
  useUiStore.setState({
    pendingFirstMessage: null,
    createSessionInitialMessage: null,
    reasoningEffortBySession: {},
  });
});

async function submitText(text: string): Promise<void> {
  fireEvent.change(screen.getByLabelText("Session draft"), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(mockSubmitChat.mutateAsync).toHaveBeenCalled());
}

describe("SessionComposer reasoning switch", () => {
  it("is hidden when the model does not support reasoning", () => {
    mockUseSessionModel.mockReturnValue(modelState(false));
    render(<SessionComposer activeSession={agentRow()} activeSessionId={SESSION} />);
    expect(reasonButton()).toBeNull();
  });

  it("is hidden when capability is unknown (null) or the query is unresolved", () => {
    mockUseSessionModel.mockReturnValue(modelState(null));
    const { unmount } = render(
      <SessionComposer activeSession={agentRow()} activeSessionId={SESSION} />,
    );
    expect(reasonButton()).toBeNull();
    unmount();
    mockUseSessionModel.mockReturnValue({ data: undefined });
    render(<SessionComposer activeSession={agentRow()} activeSessionId={SESSION} />);
    expect(reasonButton()).toBeNull();
  });

  it("is hidden on welcome (no session) — capability unknown", () => {
    render(<SessionComposer activeSession={null} activeSessionId={null} />);
    expect(reasonButton()).toBeNull();
  });

  it("shows the default medium and cycles medium → high → low → medium", () => {
    render(<SessionComposer activeSession={agentRow()} activeSessionId={SESSION} />);
    const button = reasonButton();
    expect(button).not.toBeNull();
    expect(button!.getAttribute("data-vex-reasoning-effort")).toBe("medium");

    fireEvent.click(button!);
    expect(reasonButton()!.getAttribute("data-vex-reasoning-effort")).toBe("high");
    fireEvent.click(reasonButton()!);
    expect(reasonButton()!.getAttribute("data-vex-reasoning-effort")).toBe("low");
    fireEvent.click(reasonButton()!);
    expect(reasonButton()!.getAttribute("data-vex-reasoning-effort")).toBe("medium");
    // The choice is per-session uiStore state (launch-ephemeral).
    expect(
      useUiStore.getState().reasoningEffortBySession[SESSION],
    ).toBe("medium");
  });

  it("shares the composer control-bank height (h-9)", () => {
    render(<SessionComposer activeSession={agentRow()} activeSessionId={SESSION} />);
    expect(reasonButton()!.className).toContain("h-9");
  });

  it("is truly disabled while a turn is in flight", () => {
    mockSubmitChat.isPending = true;
    render(<SessionComposer activeSession={agentRow()} activeSessionId={SESSION} />);
    expect(reasonButton()!.disabled).toBe(true);
  });

  it("includes reasoningEffort in chat.submit when the model supports reasoning", async () => {
    render(<SessionComposer activeSession={agentRow()} activeSessionId={SESSION} />);
    fireEvent.click(reasonButton()!); // medium → high
    await submitText("Deep dive on the TAO thesis");
    expect(mockSubmitChat.mutateAsync).toHaveBeenCalledWith({
      sessionId: SESSION,
      message: "Deep dive on the TAO thesis",
      reasoningEffort: "high",
    });
  });

  it("omits reasoningEffort entirely when the model does not support reasoning", async () => {
    mockUseSessionModel.mockReturnValue(modelState(false));
    // A stale per-session choice must not leak into the submit input.
    useUiStore.setState({
      reasoningEffortBySession: { [SESSION]: "high" },
    });
    render(<SessionComposer activeSession={agentRow()} activeSessionId={SESSION} />);
    await submitText("hello");
    expect(mockSubmitChat.mutateAsync).toHaveBeenCalledWith({
      sessionId: SESSION,
      message: "hello",
    });
    const input = mockSubmitChat.mutateAsync.mock.calls[0]![0] as object;
    expect("reasoningEffort" in input).toBe(false);
  });
});
