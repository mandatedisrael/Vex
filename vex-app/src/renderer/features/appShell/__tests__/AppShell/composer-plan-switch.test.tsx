/**
 * Composer PLAN switch (S2) — the plan-mode toggle behavior that moved out of
 * `SessionPlanCard` into the composer chrome. Mounts the real SessionComposer
 * with the lib/api hooks mocked so the suite pins:
 *   - role="combobox" exposing the current composer mode,
 *   - selecting Plan Mode / Chat calls useSetPlanMode with the requested state,
 *   - real `disabled` on welcome (no session) and on a mission parked for
 *     plan acceptance (the state where the engine refuses toggles),
 *   - the plan-on placeholder. (The welcome trust letterpress moved onto the
 *     stage caption in phase 4 — pinned by SessionWelcomeHero.test now.)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { SessionListItem } from "@shared/schemas/sessions.js";
import { useUiStore } from "../../../../stores/uiStore.js";

vi.mock("@hugeicons/react", () => ({
  HugeiconsIcon: () => null,
}));

vi.mock("@hugeicons/core-free-icons", () => ({
  Add01Icon: "Add01Icon",
  CheckmarkCircle02Icon: "CheckmarkCircle02Icon",
  Download01Icon: "Download01Icon",
  ArrowDown01Icon: "ArrowDown01Icon",
  PercentSquareIcon: "PercentSquareIcon",
  FireIcon: "FireIcon",
  ChartLineData01Icon: "ChartLineData01Icon",
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

const mockUseSessionPlan = vi.fn();
const mockSetPlanMode = { mutate: vi.fn(), isPending: false };
vi.mock("../../../../lib/api/sessions.js", () => ({
  useSessionPlan: (...a: unknown[]) => mockUseSessionPlan(...a),
  useSetPlanMode: () => mockSetPlanMode,
  // S6: SessionComposer also reads the model capability — capability unknown
  // here, so the REASON control stays hidden in this suite.
  useSessionModel: () => ({ data: undefined }),
}));

const { SessionComposer } = await import("../../SessionComposer.js");

const SESSION = "00000000-0000-4000-8000-00000000bb01";

function agentRow(over: Partial<SessionListItem> = {}): SessionListItem {
  return {
    id: SESSION,
    mode: "agent",
    permission: "restricted",
    title: "Plan switch",
    initialGoal: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    missionStatus: null,
    pinnedAt: null,
    ...over,
  };
}

function planState(enabled: boolean) {
  return {
    data: {
      ok: true as const,
      data: { enabled, planMd: "", accepted: false },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSetPlanMode.isPending = false;
  mockUseSessionPlan.mockReturnValue(planState(false));
  useUiStore.setState({
    pendingFirstMessage: null,
    createSessionInitialMessage: null,
  });
});

describe("SessionComposer plan switch", () => {
  it("renders a Mode picker pill at the shared h-9 height", () => {
    render(<SessionComposer activeSession={agentRow()} activeSessionId={SESSION} />);
    const picker = screen.getByRole("combobox", { name: "Mode" });
    // Shared control-bank height (matches the round send + REASON chip).
    expect(picker.className).toContain("h-9");
    expect(picker.getAttribute("aria-expanded")).toBe("false");
    expect(picker.getAttribute("data-vex-plan-mode")).toBe("off");
    expect(picker.textContent).toContain("Mode");
    expect(picker.textContent).toContain("Chat");
    expect(picker.textContent).not.toContain("vex-text-shimmer");
  });

  it("selects Plan Mode via useSetPlanMode for the active session", () => {
    render(<SessionComposer activeSession={agentRow()} activeSessionId={SESSION} />);
    const picker = screen.getByRole("combobox", { name: "Mode" });
    expect(picker.getAttribute("data-vex-plan-mode")).toBe("off");
    fireEvent.click(picker);
    expect(screen.getByRole("option", { name: "Chat" })).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: "Plan Mode" }));
    expect(mockSetPlanMode.mutate).toHaveBeenCalledWith({
      sessionId: SESSION,
      enabled: true,
    });
  });

  it("reflects the ON state, swaps the placeholder, and selects Chat to turn OFF", () => {
    mockUseSessionPlan.mockReturnValue(planState(true));
    render(<SessionComposer activeSession={agentRow()} activeSessionId={SESSION} />);
    const picker = screen.getByRole("combobox", { name: "Mode" });
    expect(picker.getAttribute("data-vex-plan-mode")).toBe("on");
    expect(picker.textContent).toContain("Plan Mode");
    const draft = screen.getByLabelText("Session draft") as HTMLTextAreaElement;
    expect(draft.placeholder).toBe(
      "Describe the goal — Vex proposes a plan before anything executes.",
    );
    fireEvent.click(picker);
    fireEvent.click(screen.getByRole("option", { name: "Chat" }));
    expect(mockSetPlanMode.mutate).toHaveBeenCalledWith({
      sessionId: SESSION,
      enabled: false,
    });
  });

  it("is truly disabled on welcome (no session)", () => {
    render(<SessionComposer activeSession={null} activeSessionId={null} />);
    const picker = screen.getByRole("combobox", { name: "Mode" }) as HTMLButtonElement;
    expect(picker.disabled).toBe(true);
    expect(picker.title).toBe("Available once a session is open");
    // Phase 4: the trust letterpress no longer renders under the composer —
    // the stage caption (SessionWelcomeHero) carries the trust copy.
    expect(
      screen.queryByText(
        "Local-first · Private by default · You sign every action",
      ),
    ).toBeNull();
  });

  it("is disabled while a mission is parked for plan acceptance", () => {
    mockUseSessionPlan.mockReturnValue(planState(true));
    render(
      <SessionComposer
        activeSession={agentRow({ mode: "mission", missionStatus: "paused_plan_acceptance" })}
        activeSessionId={SESSION}
      />,
    );
    const picker = screen.getByRole("combobox", { name: "Mode" }) as HTMLButtonElement;
    expect(picker.disabled).toBe(true);
    expect(picker.title).toBe("Unavailable while a mission is running");
  });
});
